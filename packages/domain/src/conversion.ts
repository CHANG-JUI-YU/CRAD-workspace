import {
  canonicalJson,
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
  type TemplateProposalValue,
} from "@st-workspace/core";

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

interface SourceReference {
  artifact_id: string;
  revision: string;
  key: string;
  module: string;
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

function latestArtifactByKey(artifacts: readonly ArtifactRecord[], key: string): ArtifactRecord | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.key === key);
}

function artifact(
  operationId: string,
  actor: string,
  kind: ArtifactKind,
  key: string,
  name: string,
  content: string,
  previous?: ArtifactRecord,
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
  };
}

function withConversionProvenance(
  target: TargetProposal,
  sourceMode: ConversionProposal["source_mode"],
  targetMode: ConversionProposal["target_mode"],
  mappingDigest: string,
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
          },
        },
      },
    },
  } as TargetProposal;
}

export class ConversionService {
  constructor(private readonly repository: ProjectRepository) {}

  async materialize(operationId: string, proposal: ConversionProposal, actor: string): Promise<ConversionExecutionResult> {
    const parsed = conversionProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("CONVERSION_SCHEMA_INVALID", parsed.error.message, true);
    const initial = await this.repository.read();
    const result = await this.repository.transaction(initial.revision, (current) => {
      const operation = current.operations.find((item) => item.id === operationId);
      if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);

      const sourceArtifacts = current.artifacts.filter((candidate) => {
        if (candidate.kind !== sourceKind(parsed.data.source_mode)) return false;
        const envelope = parseEnvelope(candidate.content);
        return envelope?.character_id === parsed.data.character_id
          && envelope.module?.mode === parsed.data.source_mode;
      });
      if (sourceArtifacts.length === 0) {
        throw new CoreError(
          "CONVERSION_SOURCE_NOT_FOUND",
          `No ${parsed.data.source_mode} artifacts exist for character ${parsed.data.character_id}.`,
          true,
        );
      }

      const moduleNames = parsed.data.modules.map((module) => module.module);
      if (new Set(moduleNames).size !== moduleNames.length) {
        throw new CoreError("CONVERSION_TARGET_DUPLICATE", "Conversion target modules must be unique.", true);
      }

      const mappingDigest = contentHash(canonicalJson(parsed.data.mappings));
      const sourceReferences: SourceReference[] = sourceArtifacts
        .map((source) => ({
          artifact_id: source.id,
          revision: source.revision,
          key: source.key,
          module: parseEnvelope(source.content)?.module?.module,
        }))
        .filter((source): source is SourceReference => typeof source.module === "string")
        .sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
      const conversionContent = canonicalJson({
        ...parsed.data,
        source_artifacts: sourceReferences,
        mapping_digest: mappingDigest,
      });
      const conversionKey = `conversion:${parsed.data.character_id.toLocaleLowerCase()}-${parsed.data.source_mode}-to-${parsed.data.target_mode}`;
      const previousConversion = latestArtifactByKey(current.artifacts, conversionKey);
      const conversionArtifact = previousConversion?.content_hash === contentHash(conversionContent)
        ? previousConversion
        : artifact(operationId, actor, "conversion", conversionKey, `${parsed.data.character_id}/${parsed.data.source_mode}-to-${parsed.data.target_mode}`, conversionContent, previousConversion);

      const targets = parsed.data.modules.map((module) => {
        const base = targetProposalFor(parsed.data, module);
        const target = withConversionProvenance(base, parsed.data.source_mode, parsed.data.target_mode, mappingDigest);
        const content = canonicalJson(target);
        const key = targetKey(target);
        const previous = latestArtifactByKey(current.artifacts, key);
        const stored = previous?.content_hash === contentHash(content)
          ? previous
          : artifact(operationId, actor, target.kind, key, targetName(target), content, previous);
        return { target, stored, key, content };
      });
      const generated = [conversionArtifact, ...targets.map((item) => item.stored)]
        .filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index)
        .filter((candidate) => !current.artifacts.some((existing) => existing.id === candidate.id));
      const allArtifactIds = [conversionArtifact.id, ...targets.map((item) => item.stored.id)];
      const targetArtifactIds = targets.map((item) => item.stored.id);
      const progress = allArtifactIds.map((id) => ({
        item_id: id,
        status: "completed" as const,
        message: id === conversionArtifact.id ? "conversion report materialized" : "target mode draft materialized",
        artifact_id: id,
      }));
      const next = {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        artifacts: [...current.artifacts, ...generated],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            status: "completed",
            progress: [...item.progress, ...progress],
            result_summary: `Materialized ${targets.length} ${parsed.data.target_mode} draft module(s) from ${parsed.data.source_mode}.`,
          })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "conversion.materialized",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: {
            conversion_artifact_id: conversionArtifact.id,
            target_artifact_ids: targetArtifactIds,
            source_artifacts: sourceReferences,
            source_mode: parsed.data.source_mode,
            target_mode: parsed.data.target_mode,
            mapping_digest: mappingDigest,
            unmapped: parsed.data.unmapped,
            expected_loss: parsed.data.mappings.map((mapping) => ({ source: mapping.source, target: mapping.target, expected_loss: mapping.expected_loss })),
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
          summary: `Materialized ${targets.length} ${parsed.data.target_mode} draft module(s) from ${parsed.data.source_mode}.`,
        },
      };
    });
    return result.value;
  }
}
