import {
  canonicalJson,
  computeProjectProjection,
  contentHash,
  conversionProposalValueSchema,
  CoreError,
  internalId,
  paletteProposalValueSchema,
  zhujiProposalValueSchema,
  type ArtifactKind,
  type ArtifactRecord,
  type OperationRecord,
  type ProjectRepository,
  type ProjectProjection,
  type TemplateProposalValue,
} from "@st-workspace/core";
import { PALETTE_REQUIRED_MODULES, ZHUJI_REQUIRED_MODULES } from "./required-artifacts.js";

type ConversionProposal = Extract<TemplateProposalValue, { kind: "conversion" }>;
type TargetProposal = Extract<TemplateProposalValue, { kind: "zhuji" | "palette" }>;

export interface ConversionExecutionResult {
  artifact_id: string;
  artifact_ids: string[];
  target_artifact_ids: string[];
  status: "completed";
  summary: string;
}

interface ModeEnvelope {
  character_id?: unknown;
  module?: { mode?: unknown; module?: unknown };
}

interface SourceCandidate {
  artifact: ArtifactRecord;
  mode: unknown;
  module: unknown;
  formal: boolean;
}

interface SourceReference {
  artifact_id: string;
  revision: string;
  key: string;
  module: string;
}

interface BlueprintBinding {
  blueprint_precheck_id: string;
  blueprint_precheck_revision: string;
}

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function parseEnvelope(content: string): ModeEnvelope | undefined {
  try {
    const value: unknown = JSON.parse(content);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const envelope = value as { character_id?: unknown; module?: unknown };
    if (envelope.module === null || typeof envelope.module !== "object" || Array.isArray(envelope.module)) {
      return { character_id: envelope.character_id };
    }
    const module = envelope.module as { mode?: unknown; module?: unknown };
    return { character_id: envelope.character_id, module };
  } catch {
    return undefined;
  }
}

function sourceKind(mode: ConversionProposal["source_mode"]): Extract<ArtifactKind, "zhuji" | "palette"> {
  return mode;
}

function parseFormalSource(content: string, mode: ConversionProposal["source_mode"]): { mode: string; module: string } | undefined {
  try {
    const value: unknown = JSON.parse(content);
    const parsed = mode === "zhuji" ? zhujiProposalValueSchema.safeParse(value) : paletteProposalValueSchema.safeParse(value);
    return parsed.success ? { mode: parsed.data.module.mode, module: parsed.data.module.module } : undefined;
  } catch {
    return undefined;
  }
}

function requiredModules(mode: ConversionProposal["source_mode"]): readonly string[] {
  return mode === "zhuji" ? ZHUJI_REQUIRED_MODULES : PALETTE_REQUIRED_MODULES;
}

function targetProposalFor(proposal: ConversionProposal, module: ConversionProposal["modules"][number]): TargetProposal {
  const candidate = proposal.target_mode === "zhuji"
    ? { kind: "zhuji" as const, character_id: proposal.character_id, module }
    : { kind: "palette" as const, character_id: proposal.character_id, module };
  const parsed = proposal.target_mode === "zhuji"
    ? zhujiProposalValueSchema.safeParse(candidate)
    : paletteProposalValueSchema.safeParse(candidate);
  if (!parsed.success) throw new CoreError("CONVERSION_TARGET_INVALID", parsed.error.message, true);
  return parsed.data;
}

function targetKey(target: TargetProposal): string {
  return `${target.kind}:${target.character_id.toLocaleLowerCase()}-${target.module.module.toLocaleLowerCase()}`;
}

function targetName(target: TargetProposal): string {
  return `${target.character_id}/${target.module.module}`;
}

function latestArtifactByKey(projection: ProjectProjection, key: string): ArtifactRecord | undefined {
  return projection.currentArtifacts.find((artifact) => artifact.key === key);
}

function currentBlueprintBinding(state: { blueprint_prechecks: readonly { id: string; candidate_blueprint_revision: string; status: string }[] }): BlueprintBinding | undefined {
  const precheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
  return precheck === undefined
    ? undefined
    : { blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision };
}

function blueprintFields(binding: BlueprintBinding | undefined): Pick<ArtifactRecord, "blueprint_precheck_id" | "blueprint_precheck_revision"> {
  return binding === undefined ? {} : binding;
}

function sourceReferenceSort(mode: ConversionProposal["source_mode"], left: SourceReference, right: SourceReference): number {
  const order = requiredModules(mode);
  const leftIndex = order.indexOf(left.module);
  const rightIndex = order.indexOf(right.module);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    || left.key.localeCompare(right.key)
    || left.artifact_id.localeCompare(right.artifact_id);
}

function validateTargetModules(proposal: ConversionProposal): ConversionProposal["modules"] {
  const expected = requiredModules(proposal.target_mode);
  const moduleNames: string[] = proposal.modules.map((module) => module.module);
  const duplicateModules = [...new Set(moduleNames.filter((module, index) => moduleNames.indexOf(module) !== index))];
  if (duplicateModules.length > 0) {
    throw new CoreError(
      "CONVERSION_TARGET_DUPLICATE",
      `Conversion target modules must be unique; duplicated modules: ${duplicateModules.join(", ")}.`,
      true,
      { duplicate_modules: duplicateModules, target_mode: proposal.target_mode },
    );
  }
  const expectedSet = new Set<string>(expected);
  const unknownModules = moduleNames.filter((module) => !expectedSet.has(module));
  if (unknownModules.length > 0) {
    throw new CoreError(
      "CONVERSION_TARGET_UNKNOWN_MODULE",
      `Conversion target contains unknown ${proposal.target_mode} modules: ${[...new Set(unknownModules)].join(", ")}.`,
      true,
      { unknown_modules: [...new Set(unknownModules)], expected_modules: expected, target_mode: proposal.target_mode },
    );
  }
  const missingModules = expected.filter((module) => !moduleNames.includes(module));
  if (missingModules.length > 0) {
    throw new CoreError(
      "CONVERSION_TARGET_INCOMPLETE",
      `Conversion target ${proposal.target_mode} modules are incomplete; missing: ${missingModules.join(", ")}.`,
      true,
      { missing_modules: missingModules, present_modules: moduleNames, expected_modules: expected, target_mode: proposal.target_mode },
    );
  }
  return [...proposal.modules].sort((left, right) => expected.indexOf(left.module) - expected.indexOf(right.module));
}

function sourceReferencesFor(
  projection: ProjectProjection,
  proposal: ConversionProposal,
  binding: BlueprintBinding | undefined,
): SourceReference[] {
  const latest = projection.currentArtifacts;
  const candidates: SourceCandidate[] = latest.flatMap((artifact) => {
    if (artifact.kind !== sourceKind(proposal.source_mode)) return [];
    const envelope = parseEnvelope(artifact.content);
    if (envelope?.character_id !== proposal.character_id) return [];
    const module = envelope.module;
    const formal = parseFormalSource(artifact.content, proposal.source_mode);
    return [{ artifact, mode: formal?.mode ?? module?.mode, module: formal?.module ?? module?.module, formal: formal !== undefined }];
  });
  if (candidates.length === 0) {
    throw new CoreError(
      "CONVERSION_SOURCE_NOT_FOUND",
      `No ${proposal.source_mode} artifacts exist for character ${proposal.character_id}.`,
      true,
      { source_mode: proposal.source_mode, character_id: proposal.character_id },
    );
  }

  const expected = requiredModules(proposal.source_mode);
  const valid = candidates.filter((candidate): candidate is SourceCandidate & { mode: ConversionProposal["source_mode"]; module: string; formal: true } => candidate.formal && candidate.mode === proposal.source_mode && typeof candidate.module === "string");
  const known = valid.filter((candidate) => expected.includes(candidate.module));
  const present = [...new Set(known.map((candidate) => candidate.module))];
  const missing = expected.filter((module) => !present.includes(module));
  const unknown = [...new Set(candidates
    .filter((candidate): candidate is SourceCandidate & { mode: ConversionProposal["source_mode"]; module: string } => candidate.mode === proposal.source_mode && typeof candidate.module === "string")
    .map((candidate) => candidate.module)
    .filter((module) => !expected.includes(module)))];
  if (missing.length > 0 || unknown.length > 0) {
    throw new CoreError(
      "CONVERSION_SOURCE_INCOMPLETE",
      `Conversion source ${proposal.source_mode} modules are incomplete; missing: ${missing.length > 0 ? missing.join(", ") : "none"}${unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""}.`,
      true,
      { missing_modules: missing, unknown_modules: unknown, present_modules: present, expected_modules: expected, source_mode: proposal.source_mode, character_id: proposal.character_id },
    );
  }

  const duplicateModules = expected.filter((module) => known.filter((candidate) => candidate.module === module).length > 1);
  if (duplicateModules.length > 0) {
    throw new CoreError(
      "CONVERSION_SOURCE_DUPLICATE",
      `Conversion source modules are ambiguous; duplicated modules: ${duplicateModules.join(", ")}.`,
      true,
      { duplicate_modules: duplicateModules, source_mode: proposal.source_mode, character_id: proposal.character_id },
    );
  }

  const stale = known.filter(({ artifact }) => binding !== undefined
    && (artifact.blueprint_precheck_id !== binding.blueprint_precheck_id || artifact.blueprint_precheck_revision !== binding.blueprint_precheck_revision));
  if (stale.length > 0) {
    throw new CoreError(
      "CONVERSION_SOURCE_BLUEPRINT_STALE",
      `Conversion source artifacts are not bound to the current Blueprint revision ${binding!.blueprint_precheck_revision.slice(0, 12)}.`,
      true,
      {
        expected_blueprint: binding,
        stale_artifacts: stale.map(({ artifact, module }) => ({ artifact_id: artifact.id, revision: artifact.revision, key: artifact.key, module, blueprint_precheck_id: artifact.blueprint_precheck_id, blueprint_precheck_revision: artifact.blueprint_precheck_revision })),
      },
    );
  }

  return known
    .map(({ artifact, module }) => ({ artifact_id: artifact.id, revision: artifact.revision, key: artifact.key, module }))
    .sort((left, right) => sourceReferenceSort(proposal.source_mode, left, right));
}

function artifact(
  operationId: string,
  actor: string,
  kind: ArtifactKind,
  key: string,
  name: string,
  content: string,
  previous?: ArtifactRecord,
  binding?: BlueprintBinding,
): ArtifactRecord {
  const hash = contentHash(content);
  return {
    id: internalId("artifact"),
    key,
    kind,
    name,
    content,
    media_type: "application/json",
    content_hash: hash,
    revision: hash,
    status: "draft",
    created_at: now(),
    updated_at: now(),
    created_by: actor,
    operation_id: operationId,
    ...(previous === undefined ? {} : { based_on: previous.revision }),
    ...blueprintFields(binding),
  };
}

function withConversionProvenance(
  target: TargetProposal,
  sourceMode: ConversionProposal["source_mode"],
  targetMode: ConversionProposal["target_mode"],
  mappingDigest: string,
  sourceReferences: readonly SourceReference[],
  binding?: BlueprintBinding,
): TargetProposal {
  const extensionRoot = target.module.extensions ?? {};
  return {
    ...target,
    module: {
      ...target.module,
      extensions: {
        ...extensionRoot,
        "card-workspace": {
          ...(typeof extensionRoot["card-workspace"] === "object" && extensionRoot["card-workspace"] !== null && !Array.isArray(extensionRoot["card-workspace"])
            ? extensionRoot["card-workspace"]
            : {}),
          conversion: {
            source_mode: sourceMode,
            target_mode: targetMode,
            mapping_digest: mappingDigest,
            source_artifacts: sourceReferences,
            ...blueprintFields(binding),
          },
        },
      },
    },
  } as TargetProposal;
}

export class ConversionService {
  constructor(private readonly repository: ProjectRepository) {}

  async materialize(operationId: string, proposal: ConversionProposal, actor: string, auditActor = actor): Promise<ConversionExecutionResult> {
    const parsed = conversionProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("CONVERSION_SCHEMA_INVALID", parsed.error.message, true);
    const targetModules = validateTargetModules(parsed.data);
    const normalizedProposal: ConversionProposal = { ...parsed.data, modules: targetModules };
    const initial = await this.repository.read();
    const result = await this.repository.transaction(initial.revision, (current) => {
      const operation = current.operations.find((item) => item.id === operationId);
      if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
      const projection = computeProjectProjection(current);
      const binding = currentBlueprintBinding(current);
      const sourceReferences = sourceReferencesFor(projection, normalizedProposal, binding);
      const mappingDigest = contentHash(canonicalJson(normalizedProposal.mappings));
      const conversionContent = canonicalJson({
        ...normalizedProposal,
        source_artifacts: sourceReferences,
        mapping_digest: mappingDigest,
        ...blueprintFields(binding),
      });
      const conversionKey = `conversion:${normalizedProposal.character_id.toLocaleLowerCase()}-${normalizedProposal.source_mode}-to-${normalizedProposal.target_mode}`;
      const previousConversion = latestArtifactByKey(projection, conversionKey);
      const conversionArtifact = previousConversion?.content_hash === contentHash(conversionContent)
        ? previousConversion
        : artifact(operationId, actor, "conversion", conversionKey, `${normalizedProposal.character_id}/${normalizedProposal.source_mode}-to-${normalizedProposal.target_mode}`, conversionContent, previousConversion, binding);

      const targets = normalizedProposal.modules.map((module) => {
        const base = targetProposalFor(normalizedProposal, module);
        const target = withConversionProvenance(base, normalizedProposal.source_mode, normalizedProposal.target_mode, mappingDigest, sourceReferences, binding);
        const content = canonicalJson(target);
        const key = targetKey(target);
        const previous = latestArtifactByKey(projection, key);
        const stored = previous?.content_hash === contentHash(content)
          ? previous
          : artifact(operationId, actor, target.kind, key, targetName(target), content, previous, binding);
        return { target, stored, key, content };
      });
      const generated = [conversionArtifact, ...targets.map((item) => item.stored)]
        .filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index)
        .filter((candidate) => !current.artifacts.some((existing) => existing.id === candidate.id));
      const allArtifactIds = [conversionArtifact.id, ...targets.map((item) => item.stored.id)];
      const targetArtifactIds = targets.map((item) => item.stored.id);
      const materializedNewArtifact = generated.length > 0;
      const progress = allArtifactIds.map((id) => ({
        item_id: id,
        status: "completed" as const,
        message: materializedNewArtifact
          ? id === conversionArtifact.id ? "conversion report materialized" : "target mode draft materialized"
          : id === conversionArtifact.id ? "conversion report reused" : "target mode draft reused",
        artifact_id: id,
      }));
      const next = {
        ...current,
        ...(materializedNewArtifact && current.project_status === "published" ? { project_status: "ready" as const } : {}),
        artifacts: [...current.artifacts, ...generated],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            status: "completed",
            progress: [...item.progress, ...progress],
            result_summary: materializedNewArtifact
              ? `Materialized ${targets.length} ${normalizedProposal.target_mode} draft module(s) from ${normalizedProposal.source_mode}.`
              : `Reused ${targets.length} ${normalizedProposal.target_mode} draft module(s) from ${normalizedProposal.source_mode}; no new revision was created.`,
          })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "conversion.materialized",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: {
            conversion_artifact_id: conversionArtifact.id,
            target_artifact_ids: targetArtifactIds,
            source_artifacts: sourceReferences,
            source_mode: normalizedProposal.source_mode,
            target_mode: normalizedProposal.target_mode,
            mapping_digest: mappingDigest,
            unmapped: normalizedProposal.unmapped,
            expected_loss: normalizedProposal.mappings.map((mapping) => ({ source: mapping.source, target: mapping.target, expected_loss: mapping.expected_loss })),
            noop: !materializedNewArtifact,
            ...blueprintFields(binding),
            agent_id: actor,
          },
        }],
      };
      return {
        state: next,
        value: {
          artifact_id: conversionArtifact.id,
          artifact_ids: allArtifactIds,
          target_artifact_ids: targetArtifactIds,
          status: "completed" as const,
          summary: materializedNewArtifact
            ? `Materialized ${targets.length} ${normalizedProposal.target_mode} draft module(s) from ${normalizedProposal.source_mode}.`
            : `Reused ${targets.length} ${normalizedProposal.target_mode} draft module(s) from ${normalizedProposal.source_mode}; no new revision was created.`,
        },
      };
    });
    return result.value;
  }
}
