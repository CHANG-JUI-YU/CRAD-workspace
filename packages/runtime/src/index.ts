import { readCardFromPng, cropPngCover, readPngImageInfo, pngSignature } from "@st-workspace/adapters-png";
import {
  buildZhujiTemplateContext,
  buildTemplateContext,
  beginInterview,
  canonicalJson,
  CoreError,
  contentHash,
  createQualityPolicySnapshot,
  validateFactReferences,
  FORMAL_NAME_QUESTION_PREFIX,
  internalId,
  InMemoryAttachmentStore,
  InterviewError,
  normalizeInterviewStateForDisplay,
  parseRelationshipParticipants,
  parseWardrobeMarkdown,
  templateJsonSchemaFor,
  templateProposalValueSchema,
  zhujiProposalJsonSchema,
  zhujiProposalValueSchema,
  sourceContextFromRecord,
  workflow_answer_interview,
  type BlueprintPrecheckDimension,
  type OperationRecord,
  type ArtifactRecord,
  type AdaptationDecision,
  type AttachmentStore,
  type AuthoringKnowledgeContext,
  type FactReviewContext,
  type InterviewFlow,
  type InterviewQuestion,
  type OperationCommand,
  type ProjectState,
  type ProjectRepository,
  type RequestResult,
  type SourceAttachment,
  type BlueprintPrecheckCheck,
  type BlueprintPrecheckRecord,
  type InterviewState,
  type InterviewCharacterSubject,
  type QualityLevel,
  type IssueSeverity,
  type TemplateKind,
  type TemplateInstance,
  type TemplateProposalValue,
  type WorkspaceContext,
  type SourceAdaptationIntent,
  type ZhujiModuleKind,
  type ZhujiProposalValue,
  type ArtifactKind,
  type RepairInspection,
  type RepairReport,
} from "@st-workspace/core";
import {
  AuthoringService,
  BuildService,
  ImportService,
  KnowledgeService,
  ReviewService,
  SourceService,
  inferAuthoringKind,
  PALETTE_REQUIRED_MODULES,
  ZHUJI_REQUIRED_MODULES,
  validateWorkflow,
  buildRequiredArtifactManifest,
  type IssueUpdateInput,
  type SourceSelectionDecision,
  type SourceFetcher,
  type WorkflowGateResult,
} from "@st-workspace/domain";
import { AgentRouter } from "./agent-router.js";

function now(): string {
  return new Date().toISOString();
}

type BuildModeSelection = "zhuji" | "palette" | "both";

const OPERATION_LEASE_MS = 60_000;

/** Remove lease fields from a record so they are absent (not `undefined`) in persisted state. */
function stripLease<TOperation extends { lease_owner?: string; lease_token?: string; lease_expires_at?: string }>(
  operation: TOperation,
): Omit<TOperation, "lease_owner" | "lease_token" | "lease_expires_at"> {
  const { lease_owner: _owner, lease_token: _token, lease_expires_at: _expires, ...rest } = operation;
  return rest;
}

function parseBuildModeSelection(value: string): BuildModeSelection | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (/(?:both|兩者|兩個都有|兩種|珠璣[、,\s]+調色盤|調色盤[、,\s]+珠璣)/iu.test(normalized)) return "both";
  if (/(?:zhuji|珠璣|珠玑|珠机)/iu.test(normalized) && !/(?:palette|調色盤|调色盘)/iu.test(normalized)) return "zhuji";
  if (/(?:palette|調色盤|调色盘)/iu.test(normalized) && !/(?:zhuji|珠璣|珠玑|珠机)/iu.test(normalized)) return "palette";
  return undefined;
}

function nonEmptyInterviewValue(values: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = values[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function collaborationMode(values: Record<string, unknown>): "free" | "assisted" {
  const value = String(values.collaboration_mode ?? "");
  return /assisted|assist|協助/iu.test(value) ? "assisted" : "free";
}

function isBlueprintRevisionRequest(value: string): boolean {
  return /(?:blueprint|藍圖|方向)/iu.test(value) && /(?:修改|更新|調整|改成|revise|change|update)/iu.test(value);
}

function isBlueprintConfirmation(value: string): boolean {
  return /^(?:確認|確定|接受|同意|可以|好|yes|y|ok|okay|confirm|accept)(?:[\s,，。.!！]|$)/iu.test(value.trim());
}

const ZHUJI_MODULE_ORDER: readonly string[] = ZHUJI_REQUIRED_MODULES;

const PALETTE_MODULE_ORDER: readonly string[] = PALETTE_REQUIRED_MODULES;

function hasUsableArtifact(_artifact: ProjectState["artifacts"][number]): boolean {
  // v3 currently models artifact liveness through revision replacement rather
  // than stale/missing statuses; keep this boundary for future status growth.
  return true;
}

function parsedModeModules(state: ProjectState, kind: "zhuji" | "palette", characterId: string): Set<string> {
  const modules = new Set<string>();
  for (const artifact of state.artifacts) {
    if (artifact.kind !== kind || !hasUsableArtifact(artifact)) continue;
    try {
      const value = JSON.parse(artifact.content) as { character_id?: unknown; module?: { module?: unknown } };
      if (value.character_id === characterId && typeof value.module?.module === "string") modules.add(value.module.module);
    } catch {
      // Malformed historical artifacts are ignored here and reported by normal review/gate diagnostics.
    }
  }
  return modules;
}

function blueprintKey(projectId: string): string {
  return `blueprint:${projectId}`;
}

function blueprintContent(precheck: BlueprintPrecheckRecord): string {
  const candidate = precheck.candidate_blueprint;
  return canonicalJson({
    schema_version: 1,
    kind: "blueprint",
    project_id: precheck.project_id,
    flow: candidate.flow,
    collaboration_mode: precheck.collaboration_mode,
    source_adaptation: candidate.source_adaptation,
    world: candidate.world,
    characters: candidate.characters,
    relationships: candidate.relationships,
    blueprint_direction: candidate.blueprint_direction,
    primary_character_id: candidate.primary_character_id,
    intake_values: candidate.intake_values,
    provenance: {
      blueprint_precheck_id: precheck.id,
      candidate_blueprint_revision: precheck.candidate_blueprint_revision,
      checks: precheck.checks,
    },
  });
}

function canonPolicyFromValues(values: Record<string, unknown>): Exclude<SourceAdaptationIntent["canon_policy"], undefined> {
  const value = nonEmptyInterviewValue(values, ["canon_policy"]);
  if (value !== undefined) {
    if (/參考原作|reference/iu.test(value)) return "reference_only";
    if (/忠實原作|faithful/iu.test(value)) return "canon_faithful";
    if (/二創詮釋|inspired/iu.test(value)) return "canon_inspired";
  }
  return "canon_inspired";
}

function sourceAdaptationIntentFromValues(values: Record<string, unknown>, subjects: Array<{ id: string; label: string }>): SourceAdaptationIntent | undefined {
  const subject = nonEmptyInterviewValue(values, ["source_subject"]);
  const multi = subjects.length > 1;
  if (subject === undefined && !multi) return undefined;
  const identifiers = nonEmptyInterviewValue(values, ["source_identifiers"])
    ?.split(/[\n,，、]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const medium = nonEmptyInterviewValue(values, ["source_medium"]);
  const perCharacter = subjects.flatMap((character) => {
    const scoped = (key: string): string | undefined => nonEmptyInterviewValue(values, [`${key}:${character.id}`]) ?? nonEmptyInterviewValue(values, [key]);
    const subjectName = scoped("source_subject");
    if (subjectName === undefined) return [];
    const scopedIdentifiers = scoped("source_identifiers")?.split(/[\n,，、]+/u).map((item) => item.trim()).filter((item) => item.length > 0);
    const scopedMedium = scoped("source_medium");
    return [{
      character_id: character.id,
      subject_name: subjectName,
      ...(scopedMedium === undefined ? {} : { source_medium: scopedMedium }),
      ...(scopedIdentifiers === undefined || scopedIdentifiers.length === 0 ? {} : { source_identifiers: scopedIdentifiers }),
    }];
  });
  return {
    subject_name: subject ?? perCharacter[0]?.subject_name ?? "source",
    ...(medium === undefined ? {} : { source_medium: medium }),
    ...(identifiers === undefined || identifiers.length === 0 ? {} : { source_identifiers: identifiers }),
    adaptation_intent: nonEmptyInterviewValue(values, ["concept"]) ?? subject ?? perCharacter[0]?.subject_name ?? "source",
    canon_policy: canonPolicyFromValues(values),
    ...(perCharacter.length > 0 ? { subjects: perCharacter } : {}),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function latestBlueprintSnapshot(state: ProjectState): Record<string, unknown> | undefined {
  const artifact = [...state.artifacts].reverse().find((item) => item.kind === "blueprint" && hasUsableArtifact(item));
  if (artifact === undefined) return undefined;
  try {
    return objectValue(JSON.parse(artifact.content));
  } catch {
    return undefined;
  }
}

function isSourceAdaptationProject(state: ProjectState): boolean {
  if (state.interview.flow === "source_adaptation") return true;
  return objectValue(latestBlueprintSnapshot(state)?.source_adaptation)?.subject_name !== undefined;
}

function sourceFactsReady(state: ProjectState): boolean {
  if (state.sources.length === 0 || state.facts.length === 0) return false;
  if (state.facts.some((fact) => fact.status === "candidate" || fact.status === "conflict")) return false;
  const run = [...state.fact_review_runs].reverse().find((candidate) => candidate.status !== "superseded");
  if (run === undefined || run.status !== "completed") return false;
  const latest = new Map<string, ProjectState["fact_review_decisions"][number]>();
  for (const decision of state.fact_review_decisions) {
    if (decision.review_run_id === run.id) latest.set(decision.candidate_occurrence_id, decision);
  }
  if (run.candidate_occurrence_ids.some((occurrenceId) => latest.get(occurrenceId)?.decision !== "accepted" && latest.get(occurrenceId)?.decision !== "rejected")) return false;
  const sourceById = new Map(state.sources.map((source) => [source.id, source]));
  return state.facts.every((fact) => {
    if (fact.status !== "accepted") return true;
    const refs = fact.evidence_refs ?? [];
    return refs.length > 0 && refs.every((reference) => sourceById.get(reference.source_id)?.revision === reference.source_revision_id);
  });
}

function buildAuthoringKnowledgeContext(state: ProjectState): AuthoringKnowledgeContext {
  const blueprint = latestBlueprintSnapshot(state);
  const candidateById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  return {
    ...(blueprint === undefined ? {} : { blueprint }),
    ...(objectValue(blueprint?.source_adaptation)?.subject_name === undefined ? {} : { source_adaptation: blueprint?.source_adaptation as SourceAdaptationIntent }),
    accepted_facts: state.facts.filter((fact) => fact.status === "accepted"),
    unresolved_facts: state.facts.filter((fact) => fact.status !== "accepted"),
    sources: state.sources.map((source) => sourceContextFromRecord(source, candidateById.get(source.candidate_id))),
    fact_register_revision: contentHash(canonicalJson(state.facts.map((fact) => ({ id: fact.id, status: fact.status, updated_at: fact.updated_at })))),
    adaptation_decisions: [...state.adaptation_decisions],
  };
}

function createBlueprintArtifact(state: ProjectState, precheck: BlueprintPrecheckRecord, operationId: string, actor: string): ArtifactRecord | undefined {
  const content = blueprintContent(precheck);
  const hash = contentHash(content);
  const key = blueprintKey(state.project_id);
  const previous = [...state.artifacts].reverse().find((artifact) => artifact.key === key);
  if (previous?.content_hash === hash) return undefined;
  return {
    id: internalId("artifact"),
    key,
    kind: "blueprint",
    name: "project-blueprint",
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
    blueprint_precheck_id: precheck.id,
    blueprint_precheck_revision: precheck.candidate_blueprint_revision,
  };
}

function mergeExpansionIntoBlueprint(state: ProjectState, expansionPrecheck: BlueprintPrecheckRecord, operationId: string, actor: string): { artifact: ArtifactRecord | undefined; precheck: BlueprintPrecheckRecord } {
  const previousBlueprint = latestBlueprintSnapshot(state);
  const previousPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
  if (previousBlueprint === undefined || previousPrecheck === undefined) {
    // No existing Blueprint to merge into; fall back to a fresh project Blueprint.
    return { artifact: createBlueprintArtifact(state, expansionPrecheck, operationId, actor), precheck: expansionPrecheck };
  }
  const expansion = objectValue(expansionPrecheck.candidate_blueprint) ?? {};
  const expansionCharacters = Array.isArray(expansion.characters) ? expansion.characters as Array<Record<string, unknown>> : [];
  const existingCharacters = Array.isArray(previousBlueprint.characters) ? previousBlueprint.characters as Array<Record<string, unknown>> : [];
  const existingOrdinals = existingCharacters.map((candidate) => typeof candidate.ordinal === "number" ? candidate.ordinal as number : 0);
  const newSubject = expansionCharacters[0];
  if (newSubject === undefined) {
    return { artifact: createBlueprintArtifact(state, expansionPrecheck, operationId, actor), precheck: expansionPrecheck };
  }
  const maxOrdinal = existingOrdinals.length === 0 ? 0 : Math.max(...existingOrdinals);
  const mergedCharacters = [
    ...existingCharacters,
    {
      id: `character-${maxOrdinal + 1}`,
      label: typeof newSubject.label === "string" ? newSubject.label : "新角色",
      ordinal: maxOrdinal + 1,
      display_name: typeof newSubject.display_name === "string" ? newSubject.display_name : (typeof newSubject.label === "string" ? newSubject.label : "新角色"),
      ...(typeof newSubject.mode === "string" ? { mode: newSubject.mode } : {}),
      ...(objectValue(newSubject.direction) === undefined ? {} : { direction: newSubject.direction }),
    },
  ];
  const existingIntake = objectValue(previousBlueprint.intake_values);
  const expansionIntake = objectValue(expansion.intake_values);
  const mergedCandidate: Record<string, unknown> = {
    ...previousBlueprint,
    characters: mergedCharacters,
    primary_character_id: typeof previousBlueprint.primary_character_id === "string" ? previousBlueprint.primary_character_id : mergedCharacters[0]?.id,
    intake_values: { ...(existingIntake ?? {}), ...(expansionIntake ?? {}) },
  };
  const mergedRevision = contentHash(canonicalJson(mergedCandidate));
  const mergedPrecheck: BlueprintPrecheckRecord = {
    id: internalId("blueprint_precheck"),
    schema_version: 1,
    project_id: state.project_id,
    operation_id: operationId,
    collaboration_mode: expansionPrecheck.collaboration_mode,
    candidate_blueprint: mergedCandidate,
    candidate_blueprint_revision: mergedRevision,
    checks: [
      ...previousPrecheck.checks,
      ...expansionPrecheck.checks,
    ],
    status: "recorded",
    created_at: now(),
    created_by: actor,
  };
  const content = blueprintContent(mergedPrecheck);
  const hash = contentHash(content);
  const key = blueprintKey(state.project_id);
  const previousArtifact = [...state.artifacts].reverse().find((artifact) => artifact.key === key);
  if (previousArtifact?.content_hash === hash) return { artifact: undefined, precheck: mergedPrecheck };
  return {
    artifact: {
      id: internalId("artifact"),
      key,
      kind: "blueprint",
      name: "project-blueprint",
      content,
      media_type: "application/json",
      content_hash: hash,
      revision: hash,
      status: "draft",
      created_at: now(),
      updated_at: now(),
      created_by: actor,
      operation_id: operationId,
      ...(previousArtifact === undefined ? {} : { based_on: previousArtifact.revision }),
      blueprint_precheck_id: mergedPrecheck.id,
      blueprint_precheck_revision: mergedPrecheck.candidate_blueprint_revision,
    },
    precheck: mergedPrecheck,
  };
}

function interviewCharacterSubjects(interview: InterviewState): InterviewCharacterSubject[] {
  if (interview.flow === "world" && !/建立含世界的角色卡|character\s*card\s*with\s*world/iu.test(interview.values.world_kind ?? "")) return [];
  return interview.characters !== undefined && interview.characters.length > 0
    ? interview.characters
    : [{ id: "character-1", label: "角色", ordinal: 1 }];
}

function directionForSubject(interview: InterviewState, subject: InterviewCharacterSubject, intakeRevision: string): Record<string, unknown> | undefined {
  const scopedQuestionId = `blueprint_direction:${subject.id}`;
  const questionIds = subject.ordinal === 1 ? [scopedQuestionId, "blueprint_direction"] : [scopedQuestionId];
  const directionAnswers = interview.answers
    .filter((item) => questionIds.includes(item.question_id))
    .map((item) => ({ answer: item.answer, actor: item.actor, occurred_at: item.occurred_at, question_id: item.question_id }));
  const selectedDirectionAnswer = directionAnswers.filter((item) => !/再給幾個|換一批|regenerate|more options/iu.test(item.answer)).at(-1);
  const selected = selectedDirectionAnswer?.answer ?? nonEmptyInterviewValue(interview.values, questionIds);
  if (selected === undefined) return undefined;
  return {
    scope: "character_setting",
    selected,
    character_setting_direction: selected,
    source_question_id: selectedDirectionAnswer?.question_id ?? scopedQuestionId,
    candidate_summary: selected,
    ...(selectedDirectionAnswer?.occurred_at === undefined ? {} : { selected_at: selectedDirectionAnswer.occurred_at }),
    intake_revision: intakeRevision,
    history: directionAnswers,
  };
}

function authoringModeForSubject(interview: InterviewState, subject: InterviewCharacterSubject): "zhuji" | "palette" | undefined {
  const perCharacter = nonEmptyInterviewValue(interview.values, [`authoring_mode:${subject.id}`]);
  if (perCharacter === "zhuji" || perCharacter === "palette") return perCharacter;
  const shared = nonEmptyInterviewValue(interview.values, ["authoring_mode", "expansion_mode"]);
  if (shared === "zhuji" || shared === "palette") return shared;
  return undefined;
}

function relationshipConfig(interview: InterviewState, subjects: readonly InterviewCharacterSubject[]): Record<string, unknown> | undefined {
  const enabledValue = nonEmptyInterviewValue(interview.values, ["relationship_enable"]);
  if (enabledValue === undefined) return undefined;
  const enabled = /^(?:啟用|enable|yes|y|true)$/iu.test(enabledValue);
  if (!enabled) return { enabled: false, scope: "none", character_ids: [] };
  const scope = nonEmptyInterviewValue(interview.values, ["relationship_scope"]);
  const completeRoster = scope === "完整 roster" || /full|完整/iu.test(scope ?? "");
  const characterIds = completeRoster
    ? subjects.map((subject) => subject.id)
    : parseRelationshipParticipants(String(interview.values.relationship_participants ?? ""), subjects);
  return {
    enabled: true,
    scope: completeRoster ? "full_roster" : "participant_subset",
    character_ids: characterIds,
  };
}

function worldConfig(interview: InterviewState): Record<string, unknown> | undefined {
  const values = interview.values;
  const enabledValue = nonEmptyInterviewValue(values, ["world_enabled"]);
  const worldCharacterKind = /建立含世界的角色卡|character\s*card\s*with\s*world/iu.test(String(values.world_kind ?? ""));
  const enabledText = enabledValue ?? "";
  const explicitlyDisabled = /^(?:不需要|不要|不啟用|關閉|no|n|false)$/iu.test(enabledText) || /不需要(?:任何|什麼)?(?:設定|世界)/iu.test(enabledText);
  const explicitlyEnabled = /^(?:需要|啟用|enabled|yes|y|true)$/iu.test(enabledText) || /需要(?:世界|設定)/iu.test(enabledText);
  const enabled = interview.flow === "world" || worldCharacterKind || (!explicitlyDisabled && explicitlyEnabled);
  if (enabledValue === undefined && interview.flow !== "world" && !worldCharacterKind) return undefined;
  const timing = /之前|before/iu.test(String(values.world_timing ?? ""))
    ? "before_characters"
    : /之後|after/iu.test(String(values.world_timing ?? ""))
      ? "after_characters"
      : undefined;
  return {
    enabled,
    ...(nonEmptyInterviewValue(values, ["world_kind"]) === undefined ? {} : { kind: nonEmptyInterviewValue(values, ["world_kind"]) }),
    ...(nonEmptyInterviewValue(values, ["world_concept"]) === undefined ? {} : { concept: nonEmptyInterviewValue(values, ["world_concept"]) }),
    ...(timing === undefined ? {} : { authoring_timing: timing }),
  };
}

function buildBlueprintPrecheck(projectId: string, operationId: string, interview: InterviewState, actor: string): BlueprintPrecheckRecord {
  const values = interview.values;
  const mode = collaborationMode(values);
  const intakeRevision = contentHash(canonicalJson(values));
  const subjects = interviewCharacterSubjects(interview);
  const characters = subjects.map((subject) => ({
    id: subject.id,
    label: subject.label,
    ordinal: subject.ordinal,
    display_name: nonEmptyInterviewValue(values, [`${FORMAL_NAME_QUESTION_PREFIX}:${subject.id}`, ...(interview.flow === "character_expansion" ? ["expansion_name"] : [])]) ?? subject.label,
    ...(authoringModeForSubject(interview, subject) === undefined ? {} : { mode: authoringModeForSubject(interview, subject) }),
    direction: directionForSubject(interview, subject, intakeRevision),
  }));
  const firstDirection = characters[0]?.direction;
  const candidateBlueprint: Record<string, unknown> = {
    schema_version: 1,
    project_id: projectId,
    flow: interview.flow,
    collaboration_mode: mode,
    ...(worldConfig(interview) === undefined ? {} : { world: worldConfig(interview) }),
    characters,
    ...(characters[0] === undefined ? {} : { primary_character_id: characters[0].id }),
    ...(relationshipConfig(interview, subjects) === undefined ? {} : { relationships: relationshipConfig(interview, subjects) }),
    ...(interview.flow === "source_adaptation" ? { source_adaptation: sourceAdaptationIntentFromValues(values, subjects) } : {}),
    // Keep the legacy mirror for old creators and readers when there is one subject.
    ...(subjects.length === 1 && firstDirection !== undefined ? { blueprint_direction: firstDirection } : {}),
    intake_values: values,
  };
  const perCharacterCore = subjects.length > 1;
  const dimensions: Array<{
    dimension: BlueprintPrecheckCheck["dimension"];
    valueKeys: string[];
    impact: BlueprintPrecheckCheck["impact"];
    scope: "character" | "project";
  }> = [
    { dimension: "character_core", valueKeys: perCharacterCore ? [`concept:${subjects[0]!.id}`] : ["concept", "expansion_concept"], impact: "high", scope: "character" },
    { dimension: "background", valueKeys: perCharacterCore ? [`background:${subjects[0]!.id}`] : ["background", "expansion_background"], impact: "high", scope: "character" },
    { dimension: "personality", valueKeys: perCharacterCore ? [`personality:${subjects[0]!.id}`] : ["personality", "expansion_personality"], impact: "high", scope: "character" },
    { dimension: "relationships_boundaries", valueKeys: ["relationships", "relationship_enable", "expansion_relationships"], impact: "low", scope: "project" },
    { dimension: "world_dependencies", valueKeys: ["world_concept", "world_enabled", "world_kind", "world_timing"], impact: "low", scope: "project" },
    { dimension: "cross_module_impact", valueKeys: ["authoring_mode", "expansion_mode", "card_shape"], impact: "high", scope: "character" },
  ];
  let needsInput = false;
  const checks: BlueprintPrecheckCheck[] = [];
  for (const { dimension, valueKeys, impact, scope } of dimensions) {
    const subjectsForDimension = scope === "character" ? subjects : [{ id: projectId, label: "project", ordinal: 0 }];
    for (const subject of subjectsForDimension) {
      const perCharacterMode = dimension === "cross_module_impact" && /每名角色分別指定/iu.test(String(values.authoring_mode ?? ""));
      const perCharacterCoreKey = perCharacterCore && (dimension === "character_core" || dimension === "background" || dimension === "personality");
      const explicitKeys = perCharacterMode
        ? [...valueKeys.filter((key) => key !== "authoring_mode"), `authoring_mode:${subject.id}`]
        : perCharacterCoreKey
          ? [`${dimension}:${subject.id}`]
          : valueKeys;
      const explicit = nonEmptyInterviewValue(values, explicitKeys);
      if (explicit !== undefined) {
        checks.push({
          subject_id: subject.id,
          dimension,
          uncertainty: "low",
          impact,
          basis: `Interview answer recorded for ${dimension} (${subject.label}).`,
          action: "preserve_explicit",
        });
        continue;
      }
      const highImpact = impact === "high";
      const needsExplicitConfirmation = mode === "assisted" && highImpact;
      if (needsExplicitConfirmation) needsInput = true;
      checks.push({
        subject_id: subject.id,
        dimension,
        // A free-flow safe extension is intentionally treated as a resolved
        // low-uncertainty default; the schema rejects high/high safe_extension.
        uncertainty: needsExplicitConfirmation ? "high" : "low",
        // Assisted mode never silently extends an unresolved high-impact item.
        impact: highImpact ? "high" : "low",
        basis: needsExplicitConfirmation
          ? `No explicit interview answer for ${dimension} (${subject.label}); confirmation is required.`
          : `No explicit interview answer for ${dimension} (${subject.label}); a safe default may be extended.`,
        ...(needsExplicitConfirmation
          ? { action: "user_confirmed" as const, user_answer: "pending confirmation", ...(explicitKeys[0] === undefined ? {} : { intake_key: explicitKeys[0] }) }
          : { action: "safe_extension" as const }),
      });
    }
  }
  const candidateRevision = contentHash(canonicalJson(candidateBlueprint));
  return {
    id: internalId("blueprint_precheck"),
    schema_version: 1,
    project_id: projectId,
    operation_id: operationId,
    collaboration_mode: mode,
    candidate_blueprint: candidateBlueprint,
    candidate_blueprint_revision: candidateRevision,
    checks,
    status: needsInput ? "needs_input" : "recorded",
    created_at: now(),
    created_by: actor,
  };
}
function responseFromOperation(operation: OperationRecord): RequestResult {
  const completed = operation.progress.filter((item) => item.status === "completed").map((item) => item.item_id);
  const blocked = operation.progress.filter((item) => item.status !== "completed").map((item) => item.item_id);
  return {
    operation_id: operation.id,
    status: operation.status,
    summary: operation.result_summary ?? "操作正在處理中。",
    completed,
    blocked,
    ...(operation.question === undefined ? {} : { question: operation.question }),
  };
}

const PRECHECK_CONFIRM_PREFIX = "precheck_confirm";

function parsePrecheckConfirmQuestionId(questionId: string): { subjectId: string; dimension: string } | undefined {
  const prefix = `${PRECHECK_CONFIRM_PREFIX}:`;
  if (!questionId.startsWith(prefix)) return undefined;
  const rest = questionId.slice(prefix.length);
  const colon = rest.indexOf(":");
  if (colon === -1) return undefined;
  return { subjectId: rest.slice(0, colon), dimension: rest.slice(colon + 1) };
}

function precheckConfirmQuestion(check: BlueprintPrecheckCheck, subjectLabel: string): InterviewQuestion {
  return {
    id: `${PRECHECK_CONFIRM_PREFIX}:${check.subject_id}:${check.dimension}`,
    text: `請確認或補充「${check.dimension}」（${subjectLabel}）：${check.basis}。可直接回答「確認」沿用建議，或直接提供你的設定。`,
    kind: "confirmation",
  };
}

function precheckSubjectLabel(precheck: BlueprintPrecheckRecord, check: BlueprintPrecheckCheck): string {
  const characters = Array.isArray(precheck.candidate_blueprint.characters)
    ? (precheck.candidate_blueprint.characters as Array<{ id?: unknown; label?: unknown; display_name?: unknown }>)
    : [];
  const character = characters.find((item) => item.id === check.subject_id);
  if (character !== undefined) return typeof character.display_name === "string" ? character.display_name : typeof character.label === "string" ? character.label : check.subject_id;
  return check.subject_id === precheck.project_id ? "專案" : check.subject_id;
}

function intakeKeyForConfirmation(precheck: BlueprintPrecheckRecord, check: BlueprintPrecheckCheck): string {
  if (check.intake_key !== undefined) return check.intake_key;
  const characters = Array.isArray(precheck.candidate_blueprint.characters)
    ? precheck.candidate_blueprint.characters as Array<{ id?: unknown }>
    : [];
  const single = characters.length === 1;
  switch (check.dimension) {
    case "character_core": return single ? "concept" : `concept:${check.subject_id}`;
    case "background": return single ? "background" : `background:${check.subject_id}`;
    case "personality": return single ? "personality" : `personality:${check.subject_id}`;
    case "relationships_boundaries": return "relationships";
    case "world_dependencies": return "world_concept";
    case "cross_module_impact": return "authoring_mode";
    default: return check.dimension;
  }
}

function isBarePrecheckConfirmation(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return false;
  return /^(確認|是|對|好|可以|沒問題|就用|這樣就好|不用|沒有|暫用)/iu.test(trimmed) || trimmed.length <= 4;
}

export interface DashboardProjectView {
  project_id: string;
  project_name?: string;
  project_status: string;
  revision: number;
  interview_status: string;
  interview_flow?: string;
  answers_count: number;
}

export interface DashboardBlueprint {
  revision: string;
  characters: Array<{ id: string; label: string; mode: string }>;
  world?: Record<string, unknown>;
}

export interface DashboardArtifactView {
  id: string;
  key: string;
  kind: string;
  name: string;
  revision: string;
  status: string;
  created_by?: string;
  based_on?: string;
  content_hash: string;
  blueprint_precheck_id?: string;
  blueprint_precheck_revision?: string;
}

export interface DashboardFactView {
  id: string;
  statement: string;
  status: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: string;
  coverage?: string[];
  source_ids: string[];
  review_run_id?: string;
  decision_id?: string;
  evidence_quote?: string;
  last_reviewer?: string;
  last_decision?: string;
}

export interface DashboardOperationView {
  id: string;
  kind: string;
  status: string;
  request: string;
  actor?: string;
  question?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  attempt?: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
  progress_count: number;
}

export interface DashboardIssueView {
  id: string;
  artifact_id: string;
  code: string;
  message: string;
  severity: string;
  effective_severity: string;
  status: string;
  created_at: string;
}

export interface DashboardSnapshot {
  project: DashboardProjectView;
  blueprint?: DashboardBlueprint;
  prechecks: Array<{ id: string; status: string; candidate_blueprint_revision: string; checks_count: number }>;
  artifacts: DashboardArtifactView[];
  images: Array<{ id: string; character_id?: string; width: number; height: number; aspect_ratio?: string; source?: string; license?: string; created_at: string }>;
  facts: DashboardFactView[];
  sources: Array<{ id: string; candidate_id: string; title: string; revision: string }>;
  candidates: Array<{ id: string; title: string; url?: string; status: string; official?: boolean }>;
  operations: DashboardOperationView[];
  issues: DashboardIssueView[];
  reviews: Array<{ id: string; artifact_id: string; artifact_revision: string; reviewer: string; status: string }>;
  quality: { level?: string; blocking_severity: string; overrides: Record<string, string> };
  review_runs: Array<{ id: string; status: string; candidate_occurrence_ids: string[] }>;
  publishes: Array<{ id: string; content_hash: string; created_at: string; export_json_path?: string; export_png_path?: string }>;
  builds: Array<{ id: string; status: string; content_hash: string; created_at: string }>;
  repair: RepairInspection;
}

export interface DashboardBuildReadiness {
  modes: { zhuji: boolean; palette: boolean };
  primary_character?: { id: string; label: string; mode: string };
  export_modes?: string;
  entries: Array<{ kind: string; name: string; char_count: number; estimated_tokens: number }>;
  greeting_entries: number;
  png_expected: boolean;
  missing: string[];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
}

export interface TavernCompatibilityReport {
  available: boolean;
  report: string[];
}

export class WorkspaceRuntime {
  private readonly sources: SourceService;
  private readonly knowledge: KnowledgeService;
  private readonly authoring: AuthoringService;
  private readonly review: ReviewService;
  private readonly build: BuildService;
  private readonly importer: ImportService;
  private readonly searcher: ((request: string) => Promise<Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string }>>) | undefined;
  private readonly fetcher: SourceFetcher | undefined;
  private readonly interviewRequired: boolean;
  private readonly attachmentStore: AttachmentStore;
  private readonly agents = new AgentRouter();

  constructor(private readonly repository: ProjectRepository, options: { searcher?: (request: string) => Promise<Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>>; fetcher?: SourceFetcher; interviewRequired?: boolean; attachmentStore?: AttachmentStore } = {}) {
    this.sources = new SourceService(repository);
    this.knowledge = new KnowledgeService(repository);
    this.authoring = new AuthoringService(repository);
    this.review = new ReviewService(repository);
    this.build = new BuildService(repository);
    this.importer = new ImportService(repository, { pngDecoder: async (input) => readCardFromPng(input) });
    this.searcher = options.searcher;
    this.fetcher = options.fetcher;
    this.interviewRequired = options.interviewRequired ?? false;
    this.attachmentStore = options.attachmentStore ?? new InMemoryAttachmentStore();
  }

  async interviewContext(): Promise<{
    project_id: string;
    status: InterviewState["status"];
    flow: InterviewState["flow"];
    question?: InterviewState["current"];
    answers: InterviewState["answers"];
    values: InterviewState["values"];
    characters?: InterviewState["characters"];
    active_character_id?: string;
  }> {
    const state = await this.repository.read();
    const interview = normalizeInterviewStateForDisplay(state.interview);
    return {
      project_id: state.project_id,
      status: interview.status,
      flow: interview.flow,
      ...(interview.current === undefined ? {} : { question: interview.current }),
      answers: interview.answers,
      values: interview.values,
      ...(interview.characters === undefined ? {} : { characters: interview.characters }),
      ...(interview.active_character_id === undefined ? {} : { active_character_id: interview.active_character_id }),
    };
  }

  private async startInterview(request: string, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    const interview = beginInterview(initial.interview);
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "interview",
      request,
      actor: context.actor,
      status: "needs_input",
      created_at: now(),
      updated_at: now(),
      progress: [],
      ...(interview.current?.text === undefined ? {} : { question: interview.current.text }),
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      project_status: "interviewing",
      interview,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "interview.started",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { question_id: interview.current?.id, request },
      }],
    }));
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary: "已開始專案訪談，請回答目前問題。",
      completed: [],
      blocked: [],
      ...(interview.current?.text === undefined ? {} : { question: interview.current.text }),
      project_id: initial.project_id,
      ...(interview.current === undefined ? {} : { interview_question: interview.current }),
    };
  }

  async answerInterview(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    let state = initial;
    let operation = [...initial.operations].reverse().find((item) => item.kind === "interview" && !["completed", "cancelled", "failed"].includes(item.status));
    if (state.interview.status === "idle") {
      const interview = beginInterview(state.interview);
      const created: OperationRecord = {
        id: internalId("operation"),
        kind: "interview",
        request: "project interview",
        actor: context.actor,
        status: "needs_input",
        created_at: now(),
        updated_at: now(),
        progress: [],
        ...(interview.current?.text === undefined ? {} : { question: interview.current.text }),
      };
      state = await this.repository.commit(state.revision, (current) => ({
        ...current,
        project_status: "interviewing",
        interview,
        operations: [...current.operations, created],
      }));
      operation = created;
    }
    if (operation === undefined) throw new CoreError("INTERVIEW_OPERATION_NOT_FOUND", "找不到目前的訪談操作", true);
    const pendingPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (state.interview.status === "complete" && pendingPrecheck !== undefined) {
      const parsed = state.interview.current === undefined ? undefined : parsePrecheckConfirmQuestionId(state.interview.current.id);
      const pendingChecks = pendingPrecheck.checks.filter((check) => check.action === "user_confirmed");
      if (pendingChecks.length === 0) throw new CoreError("INTERVIEW_PRECHECK_INVALID", "Blueprint precheck 沒有需要確認的項目", true);
      if (parsed === undefined) {
        const first = pendingChecks[0]!;
        const question = precheckConfirmQuestion(first, precheckSubjectLabel(pendingPrecheck, first));
        const committed = await this.repository.commit(state.revision, (current) => ({
          ...current,
          interview: { ...current.interview, current: question },
        }));
        return {
          operation_id: operation.id,
          status: "needs_input",
          summary: "訪談已收集完成，請逐項確認 blueprint precheck。",
          completed: [],
          blocked: [],
          question: question.text,
          interview_question: question,
          project_id: committed.project_id,
          flow: state.interview.flow,
        };
      }
      const confirmation = answer.trim();
      if (confirmation.length === 0) throw new CoreError("INTERVIEW_ANSWER_EMPTY", "interview answer 不可為空", true);
      const checkIndex = pendingChecks.findIndex((check) => check.subject_id === parsed.subjectId && check.dimension === parsed.dimension);
      if (checkIndex === -1) throw new CoreError("INTERVIEW_PRECHECK_STALE", "確認問題已過期，請重新確認", true);
      const currentCheck = pendingChecks[checkIndex]!;
      let updatedPrecheck: BlueprintPrecheckRecord = {
        ...pendingPrecheck,
        checks: pendingPrecheck.checks.map((check) => check === currentCheck ? { ...check, user_answer: confirmation } : check),
      };
      if (!isBarePrecheckConfirmation(confirmation)) {
        const intakeKey = intakeKeyForConfirmation(pendingPrecheck, currentCheck);
        const intake = {
          ...(typeof pendingPrecheck.candidate_blueprint.intake_values === "object" && pendingPrecheck.candidate_blueprint.intake_values !== null
            ? pendingPrecheck.candidate_blueprint.intake_values as Record<string, unknown>
            : {}),
          [intakeKey]: confirmation,
        };
        updatedPrecheck = {
          ...updatedPrecheck,
          candidate_blueprint: { ...pendingPrecheck.candidate_blueprint, intake_values: intake },
          candidate_blueprint_revision: contentHash(canonicalJson({ ...pendingPrecheck.candidate_blueprint, intake_values: intake })),
        };
      }
      const nextCheck = pendingChecks[checkIndex + 1];
      const nextQuestion = nextCheck === undefined ? undefined : precheckConfirmQuestion(nextCheck, precheckSubjectLabel(updatedPrecheck, nextCheck));
      const allDone = nextCheck === undefined;
      const confirmedPrecheck: BlueprintPrecheckRecord = { ...updatedPrecheck, status: allDone ? "recorded" : "needs_input" };
      const mergedExpansion = allDone && state.interview.flow === "character_expansion"
        ? mergeExpansionIntoBlueprint(state, confirmedPrecheck, operation.id, context.actor)
        : undefined;
      const recordedPrecheck = mergedExpansion?.precheck ?? confirmedPrecheck;
      const blueprintArtifact = allDone
        ? (mergedExpansion?.artifact ?? createBlueprintArtifact(state, confirmedPrecheck, operation.id, context.actor))
        : undefined;
      const finalized = await this.repository.commit(state.revision, (current) => ({
        ...current,
        project_status: allDone ? "ready" : "interviewing",
        blueprint_prechecks: mergedExpansion === undefined
          ? current.blueprint_prechecks.map((item) => item.id === pendingPrecheck.id ? confirmedPrecheck : item)
          : current.blueprint_prechecks.map((item) => item.id === pendingPrecheck.id ? recordedPrecheck : item),
        artifacts: blueprintArtifact === undefined ? current.artifacts : [...current.artifacts, blueprintArtifact],
        interview: nextQuestion === undefined
          ? (() => { const { current: _current, ...rest } = current.interview; return rest; })()
          : { ...current.interview, current: nextQuestion },
        operations: current.operations.map((item) => item.id === operation!.id
          ? {
            ...item,
            status: allDone ? "completed" as const : "needs_input" as const,
            result_summary: allDone ? "Blueprint precheck confirmed; Blueprint saved." : "請繼續確認 precheck 項目。",
            updated_at: now(),
            ...(nextQuestion === undefined ? {} : { question: nextQuestion.text }),
            progress: blueprintArtifact === undefined
              ? item.progress
              : [
                ...item.progress,
                { item_id: confirmedPrecheck.id, status: "completed" as const, message: "Blueprint precheck confirmed." },
                { item_id: blueprintArtifact.id, status: "completed" as const, message: "Blueprint revision saved." },
              ],
          }
          : item),
        audit: [
          ...current.audit,
          ...(blueprintArtifact === undefined ? [] : [{
            id: internalId("audit"),
            operation_id: operation!.id,
            event: "blueprint.created",
            actor: context.actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { artifact_id: blueprintArtifact.id, precheck_id: confirmedPrecheck.id, revision: blueprintArtifact.revision, based_on: blueprintArtifact.based_on },
          }]),
          {
            id: internalId("audit"),
            operation_id: operation!.id,
            event: "blueprint.precheck.confirmed",
            actor: context.actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: {
              precheck_id: pendingPrecheck.id,
              subject_id: parsed.subjectId,
              dimension: parsed.dimension,
              answer: confirmation,
              blueprint_artifact_id: blueprintArtifact?.id,
              confirmation_index: checkIndex + 1,
              confirmation_total: pendingChecks.length,
            },
          },
        ],
      }));
      return {
        operation_id: operation.id,
        status: allDone ? "completed" : "needs_input",
        summary: allDone ? (blueprintArtifact === undefined ? "Blueprint precheck confirmed." : "Blueprint precheck confirmed; Blueprint saved.") : "請繼續確認 precheck 項目。",
        completed: allDone ? [pendingPrecheck.id, ...(blueprintArtifact === undefined ? [] : [blueprintArtifact.id])] : [],
        blocked: [],
        ...(nextQuestion === undefined ? {} : { question: nextQuestion.text, interview_question: nextQuestion }),
        project_id: finalized.project_id,
        flow: state.interview.flow,
      };
    }
    let interview: InterviewState;
    try {
      interview = workflow_answer_interview(state.interview, { answer, actor: context.actor });
    } catch (error) {
      if (error instanceof InterviewError) throw new CoreError(error.code, error.message, error.recoverable);
      throw error;
    }
    const projectName = typeof interview.values.project_name === "string" ? interview.values.project_name : undefined;
    const interviewComplete = interview.status === "complete";
    const precheck = interviewComplete ? buildBlueprintPrecheck(state.project_id, operation.id, interview, context.actor) : undefined;
    const workflowComplete = interviewComplete && precheck?.status !== "needs_input";
    const complete = workflowComplete;
    const firstConfirmQuestion = precheck !== undefined && precheck.status === "needs_input"
      ? (() => {
        const pending = precheck.checks.find((check) => check.action === "user_confirmed");
        return pending === undefined ? undefined : precheckConfirmQuestion(pending, precheckSubjectLabel(precheck, pending));
      })()
      : undefined;
    const mergedExpansion = workflowComplete && precheck !== undefined && interview.flow === "character_expansion"
      ? mergeExpansionIntoBlueprint(state, precheck, operation.id, context.actor)
      : undefined;
    const recordedPrecheck = mergedExpansion?.precheck ?? precheck;
    const blueprintArtifact = workflowComplete && precheck !== undefined
      ? (mergedExpansion?.artifact ?? createBlueprintArtifact(state, precheck, operation.id, context.actor))
      : undefined;
    const precheckAudit = precheck === undefined ? [] : [{
      id: internalId("audit"),
      operation_id: operation.id,
      event: "blueprint.precheck.recorded" as const,
      actor: context.actor,
      occurred_at: now(),
      project_revision: state.revision + 1,
      details: { precheck_id: recordedPrecheck?.id, candidate_blueprint_revision: recordedPrecheck?.candidate_blueprint_revision, collaboration_mode: recordedPrecheck?.collaboration_mode, status: recordedPrecheck?.status },
    }];
    const updated = await this.repository.commit(state.revision, (current) => ({
      ...current,
      ...(projectName === undefined ? {} : { project_name: projectName }),
      project_status: workflowComplete ? "ready" : "interviewing",
      interview: firstConfirmQuestion === undefined ? interview : { ...interview, current: firstConfirmQuestion },
      ...(precheck === undefined ? {} : {
        blueprint_prechecks: mergedExpansion === undefined
          ? [
            ...current.blueprint_prechecks.map((item) => item.status === "recorded" ? { ...item, status: "superseded" as const } : item),
            precheck,
          ]
          : [
            ...current.blueprint_prechecks.map((item) => item.id === precheck.id || item.status === "recorded" ? { ...item, status: item.id === precheck.id ? item.status : "superseded" as const } : item),
            mergedExpansion.precheck,
          ],
      }),
      artifacts: blueprintArtifact === undefined ? current.artifacts : [...current.artifacts, blueprintArtifact],
      operations: current.operations.map((item) => {
        if (item.id !== operation!.id) return item;
        const updatedOperation = { ...item, status: complete ? "completed" as const : "needs_input" as const, result_summary: complete ? "專案訪談完成，已保存所有 intake_answers。" : "訪談回答已保存，請回答下一題。", updated_at: now() };
        const withProgress = blueprintArtifact === undefined
          ? updatedOperation
          : { ...updatedOperation, progress: [...updatedOperation.progress, { item_id: blueprintArtifact.id, status: "completed" as const, message: "Blueprint saved." }] };
        return interview.current === undefined ? withProgress : { ...withProgress, question: interview.current.text };
      }),
      audit: [
        ...current.audit,
        ...precheckAudit,
        ...(blueprintArtifact === undefined ? [] : [{
          id: internalId("audit"),
          operation_id: operation!.id,
          event: "blueprint.created",
          actor: context.actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { artifact_id: blueprintArtifact.id, precheck_id: recordedPrecheck?.id, revision: blueprintArtifact.revision, based_on: blueprintArtifact.based_on },
        }]),
        {
          id: internalId("audit"),
          operation_id: operation!.id,
          event: "interview.answer.recorded",
          actor: context.actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { question_id: state.interview.current?.id, answer, complete, blueprint_artifact_id: blueprintArtifact?.id },
        },
      ],
    }));
    const effectiveInterview: InterviewState = firstConfirmQuestion === undefined ? interview : { ...interview, current: firstConfirmQuestion };
    return {
      operation_id: operation.id,
      status: workflowComplete ? "completed" : "needs_input",
      summary: complete ? "專案訪談完成，已保存所有 intake_answers。" : "回答已保存，請繼續目前的訪談。",
      completed: workflowComplete ? ["interview", ...(precheck === undefined ? [] : [precheck.id]), ...(blueprintArtifact === undefined ? [] : [blueprintArtifact.id])] : [],
      blocked: [],
      ...(effectiveInterview.current === undefined ? {} : { question: effectiveInterview.current.text, interview_question: effectiveInterview.current }),
      project_id: updated.project_id,
      ...(projectName === undefined ? {} : { project_name: projectName }),
      flow: interview.flow,
    };
  }

  /** Return operations that can be safely resumed after a process restart. */
  async recoverableOperations(): Promise<readonly OperationRecord[]> {
    const state = await this.repository.read();
    return state.operations.filter((operation) => ["created", "resolving", "running"].includes(operation.status));
  }

  /**
   * Atomically claim a persisted operation with an ownership lease. Only one
   * caller (synchronous request or worker) may hold an unexpired lease at a
   * time; a stale lease can be reclaimed after expiry.
   */
  async claimOperation(operationId: string, owner: string, leaseMs: number = OPERATION_LEASE_MS): Promise<OperationRecord | undefined> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || !["created", "resolving", "running"].includes(operation.status)) return undefined;
    if (operation.lease_owner !== undefined && operation.lease_expires_at !== undefined && Date.parse(operation.lease_expires_at) > Date.now()) return undefined;
    const token = internalId("lease");
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    const claimed = await this.repository.commit(state.revision, (current) => {
      const latest = current.operations.find((item) => item.id === operationId);
      if (latest === undefined || !["created", "resolving", "running"].includes(latest.status)) return current;
      if (latest.lease_owner !== undefined && latest.lease_expires_at !== undefined && Date.parse(latest.lease_expires_at) > Date.now()) return current;
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? { ...item, lease_owner: owner, lease_token: token, lease_expires_at: leaseExpires, attempt: (item.attempt ?? 0) + 1, updated_at: now() }
          : item),
      };
    });
    const latest = claimed.operations.find((item) => item.id === operationId);
    return latest !== undefined && latest.lease_token === token ? latest : undefined;
  }

  /** Extend a lease held by the owner. Returns false when ownership was lost. */
  async renewOperationLease(operationId: string, owner: string, token: string, leaseMs: number = OPERATION_LEASE_MS): Promise<boolean> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || operation.lease_owner !== owner || operation.lease_token !== token) return false;
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...item, lease_expires_at: leaseExpires, updated_at: now() }
        : item),
    }));
    return true;
  }

  /** Clear the lease when the holder still owns it; silently ignores others. */
  async releaseOperationLease(operationId: string, owner: string, token: string): Promise<void> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || operation.lease_owner !== owner || operation.lease_token !== token) return;
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...stripLease(item), updated_at: now() }
        : item),
    }));
  }

  /**
   * Continue one persisted operation without creating a duplicate operation.
   * Operations that asked a user a question are intentionally excluded from this path.
   */
  async recoverOperation(operationId: string, context: WorkspaceContext = { actor: "worker", attachments: [] }, options: { agent?: string } = {}): Promise<RequestResult> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    if (!["created", "resolving", "running"].includes(operation.status)) return responseFromOperation(operation);
    const actor = context.actor.trim().length > 0 ? context.actor : operation.actor ?? "worker";
    const effectiveContext = { ...context, actor };
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...item, actor, status: "running", updated_at: now() }
        : item),
    }));
    const resolution = this.agents.resolve(operation.request, options.agent);
    return this.replayOperation(operation, effectiveContext, resolution.agent_id);
  }

  /** Mark an operation failed after the worker exhausted its retry budget. */
  async failOperation(operationId: string, error: unknown, actor = "worker"): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...item, status: "failed", result_summary: message, updated_at: now() }
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "operation.failed",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { message },
      }],
    }));
  }

  /* c8 ignore start -- recovery delegates to the same domain services covered by the runtime and worker tests. */
  private hasAuditMarker(operationId: string, event: string, state: ProjectState): boolean {
    return state.audit.some((item) => item.operation_id === operationId && item.event === event);
  }

  private async markedStep<T>(operationId: string, event: string, run: () => Promise<T>): Promise<T | undefined> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operationId, event, state)) return undefined;
    return run();
  }

  private async markNeedsInput(operation: OperationRecord, question: string): Promise<RequestResult> {
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...item, status: "needs_input" as const, question, updated_at: now() }
        : item),
    }));
    return { operation_id: operation.id, status: "needs_input", summary: question, completed: [], blocked: [], question };
  }

  private async loadOperationAttachments(operation: OperationRecord, command: OperationCommand | undefined): Promise<SourceAttachment[] | undefined> {
    const refs = command?.attachment_refs ?? [];
    if (refs.length === 0) return [];
    try {
      return await this.attachmentStore.load(operation.id, refs);
    } catch (error) {
      if (error instanceof CoreError && error.code === "ATTACHMENT_NOT_FOUND") return undefined;
      throw error;
    }
  }

  private async completeReplayedOperation(operation: OperationRecord): Promise<OperationRecord> {
    const state = await this.repository.read();
    const latest = state.operations.find((item) => item.id === operation.id);
    if (latest !== undefined && latest.status === "running") {
      await this.repository.commit(state.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "completed" as const, updated_at: now() } : item),
      }));
      return { ...latest, status: "completed", updated_at: now() };
    }
    return latest ?? operation;
  }

  private async replayOperation(operation: OperationRecord, context: WorkspaceContext, agent?: string): Promise<RequestResult> {
    const command = operation.command;
    if (command?.type === "template_proposal") return this.replayTemplateProposal(operation, command.payload as TemplateProposalValue, context.actor, agent);
    if (command?.type === "zhuji_proposal") return this.replayZhujiProposal(operation, command.payload as ZhujiProposalValue, context.actor, agent);
    if (command?.type === "source_select") return this.replaySourceSelection(operation, command, agent);
    if (command?.type === "source_search") return this.replaySourceSearch(operation, context, agent);
    if (command?.type === "issue_update") return this.replayIssueUpdate(operation, command, agent);
    if (command?.type === "import" || operation.kind === "import") return this.replayImport(operation, command, context, agent);
    if (command?.type === "source_resume" || operation.kind === "source") return this.replaySource(operation, context, agent);
    return this.replayRequest(operation, context, agent);
  }

  private async replayTemplateProposal(operation: OperationRecord, proposal: TemplateProposalValue, actor: string, agent?: string): Promise<RequestResult> {
    const resolution = this.agents.resolve(`create ${proposal.kind}`, agent ?? defaultAgentForTemplate(proposal));
    const proposalAgent = resolution.agent_id;
    const candidateResult = proposal.kind === "source_research" && proposal.candidates.length > 0
      ? await this.markedStep(operation.id, "source.candidates_registered", () => this.sources.registerCandidates(operation.id, proposal.candidates.map((candidate) => ({
        title: candidate.title,
        ...(candidate.url === undefined ? {} : { url: candidate.url }),
        ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
        ...(candidate.official === undefined ? {} : { official: candidate.official }),
        ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
        ...(candidate.content === undefined ? {} : { content: candidate.content }),
      })), actor))
      : undefined;
    let domainSummary: string | undefined;
    let domainCompleted: string[] = [];
    if (proposal.kind === "fact_curation") {
      const applied = await this.markedStep(operation.id, "fact.curation.applied", () => this.knowledge.applyCuration(operation.id, proposal.claims, proposalAgent, actor));
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = applied.facts;
      }
    } else if (proposal.kind === "fact_review") {
      const run = await this.markedStep(operation.id, "fact.review.run.created", () => this.knowledge.beginFactReviewRun(operation.id, proposalAgent, undefined, actor));
      const runId = run?.id ?? (await this.repository.read()).fact_review_runs.filter((item) => item.status !== "superseded").at(-1)?.id;
      let applied;
      if (runId !== undefined) {
        try {
          applied = await this.markedStep(operation.id, "fact.review.batch.applied", async () => {
            const reviewProjection = (await this.knowledge.factReviewContext()).projection_revision;
            return this.knowledge.applyReviewBatch(operation.id, proposal.decisions, actor, proposalAgent, runId, reviewProjection);
          });
        } catch (error) {
          if (!(error instanceof CoreError && error.code === "FACT_CANDIDATE_NOT_ACTIVE")) throw error;
        }
      }
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = applied.fact_ids;
      }
      const result = await this.markedStep(operation.id, "template.created", () => this.authoring.createTemplate(operation.id, proposal, proposalAgent, actor));
      if (result === undefined) return responseFromOperation(await this.completeReplayedOperation(operation));
      const finalOperation = (await this.repository.read()).operations.find((item) => item.id === operation.id);
      const needsInput = finalOperation?.status === "needs_input";
      return {
        operation_id: operation.id,
        status: needsInput ? "needs_input" : result.status,
        summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
        completed: [...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
        blocked: needsInput ? domainCompleted : [],
        agent_id: proposalAgent,
        agent_role: resolution.agent_role,
      };
    } else if (proposal.kind === "review") {
      const applied = await this.markedStep(operation.id, "review.proposal.applied", () => this.review.applyProposal(operation.id, proposal, proposalAgent, actor));
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = [...(applied.review_id === undefined ? [] : [applied.review_id]), ...applied.issue_ids];
      }
    }
    const created = await this.markedStep(operation.id, "template.created", () => this.authoring.createTemplate(operation.id, proposal, proposalAgent, actor));
    if (created === undefined) return responseFromOperation(await this.completeReplayedOperation(operation));
    return {
      operation_id: operation.id,
      status: created.status,
      summary: [domainSummary, created.summary].filter((item): item is string => item !== undefined).join(" "),
      completed: [...(candidateResult?.completed ?? []), ...domainCompleted, ...(created.artifact_ids ?? (created.artifact_id === undefined ? [] : [created.artifact_id]))],
      blocked: [],
      agent_id: proposalAgent,
      agent_role: resolution.agent_role,
    };
  }

  private async replayZhujiProposal(operation: OperationRecord, proposal: ZhujiProposalValue, actor: string, agent?: string): Promise<RequestResult> {
    const resolution = this.agents.resolve(`建立珠璣 ${proposal.character_id} ${proposal.module.module}`, agent ?? "zhuji-creator");
    const created = await this.markedStep(operation.id, "zhuji.created", () => this.authoring.createZhuji(operation.id, proposal, resolution.agent_id, actor));
    if (created === undefined) {
      const state = await this.repository.read();
      const artifact = state.artifacts.find((item) => item.operation_id === operation.id && item.kind === "zhuji");
      await this.completeReplayedOperation(operation);
      return {
        operation_id: operation.id,
        status: "completed",
        summary: "珠璣已還原（先前已套用）。",
        completed: artifact === undefined ? [] : [artifact.id],
        blocked: [],
        agent_id: resolution.agent_id,
        agent_role: resolution.agent_role,
      };
    }
    return {
      operation_id: operation.id,
      status: created.status,
      summary: created.summary,
      completed: created.artifact_id === undefined ? [] : [created.artifact_id],
      blocked: [],
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  private async replaySourceSearch(operation: OperationRecord, context: WorkspaceContext, agent?: string): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.candidates_registered", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
    const results = this.searcher === undefined ? [] : await this.searcher(operation.request);
    const searched = await this.sources.registerCandidates(operation.id, results, context.actor);
    return { operation_id: operation.id, status: searched.status, summary: searched.summary, completed: searched.completed, blocked: searched.blocked, ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  private async replaySource(operation: OperationRecord, context: WorkspaceContext, agent?: string): Promise<RequestResult> {
    const refs = operation.command?.attachment_refs ?? [];
    let attachments: SourceAttachment[];
    if (refs.length === 0) {
      attachments = context.attachments;
    } else {
      const stored = await this.loadOperationAttachments(operation, operation.command);
      if (stored === undefined) return this.markNeedsInput(operation, "無法還原來源操作所需的附件，請重新上傳來源檔案。");
      attachments = stored;
    }
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.ingested", state) || this.hasAuditMarker(operation.id, "source.blocked", state)) {
      return responseFromOperation(await this.completeReplayedOperation(operation));
    }
    const executionContext = this.fetcher === undefined ? context : { ...context, fetcher: this.fetcher };
    const resume = attachments.length > 0 || /https?:\/\//iu.test(operation.request);
    const result = resume
      ? await this.sources.resume(operation.id, operation.request, { ...executionContext, attachments })
      : await this.sources.execute(operation.id, executionContext);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.completed, blocked: result.blocked, ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  private async replaySourceSelection(operation: OperationRecord, command: OperationCommand, agent?: string): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.selection.updated", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
    const decisions = command.payload as SourceSelectionDecision[] | undefined;
    if (decisions === undefined || decisions.length === 0) {
      return this.markNeedsInput(operation, "無法還原來源選擇操作，請重新提交候選來源選擇。");
    }
    const result = await this.sources.selectCandidates(operation.id, decisions, operation.actor ?? "worker");
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.approved, ...result.rejected], blocked: [], ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  private async replayIssueUpdate(operation: OperationRecord, command: OperationCommand, agent?: string): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "review.issue.updated", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
    const input = command.payload as IssueUpdateInput | undefined;
    if (input === undefined || typeof input !== "object" || typeof (input as IssueUpdateInput).action !== "string" || typeof (input as IssueUpdateInput).issue_id !== "string") {
      return this.markNeedsInput(operation, "無法還原 issue 更新操作，請重新提交。");
    }
    const result = await this.review.updateIssue(operation.id, input, agent ?? "director", operation.actor ?? "worker");
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [result.issue_id], blocked: [], agent_id: agent ?? "director" };
  }

  private async replayImport(operation: OperationRecord, command: OperationCommand | undefined, context: WorkspaceContext, agent?: string): Promise<RequestResult> {
    const refs = command?.attachment_refs ?? [];
    let attachments: SourceAttachment[];
    if (refs.length === 0) {
      attachments = context.attachments;
    } else {
      const stored = await this.loadOperationAttachments(operation, command);
      if (stored === undefined) return this.markNeedsInput(operation, "無法還原匯入操作所需的附件，請重新上傳要匯入的檔案。");
      attachments = stored;
    }
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "import.committed", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
    const result = await this.importer.run(operation.id, operation.request, context.actor, attachments);
    const latest = await this.repository.read();
    const finalOperation = latest.operations.find((item) => item.id === operation.id);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.artifact_id === undefined ? (result.import_id === undefined ? [] : [result.import_id]) : [result.artifact_id], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  private async replayRequest(operation: OperationRecord, context: WorkspaceContext, agent?: string): Promise<RequestResult> {
    const kind = operation.kind;
    if (kind === "knowledge") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "knowledge.refreshed", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
      const result = await this.knowledge.refresh(operation.id, operation.request, context.actor);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    if (kind === "authoring") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "artifact.created", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
      const result = await this.authoring.create(operation.id, operation.request, context.actor);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.artifact_id === undefined ? [] : [result.artifact_id], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    if (kind === "review") {
      if (/^issue /iu.test(operation.request)) {
        const state = await this.repository.read();
        if (this.hasAuditMarker(operation.id, "review.issue.updated", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
        return this.markNeedsInput(operation, "issue 更新無法自動還原，請重新提交。");
      }
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "artifact.reviewed", state) || this.hasAuditMarker(operation.id, "review.reevaluated", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
      const result = /re-?evaluate|quality profile/iu.test(operation.request)
        ? await this.review.reevaluate(operation.id, context.actor)
        : await this.review.review(operation.id, operation.request, context.actor);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.review_id === undefined ? [] : [result.review_id], blocked: result.status === "blocked" ? [operation.id] : [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    if (kind === "build") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "publish.committed", state) || this.hasAuditMarker(operation.id, "build.previewed", state)) return responseFromOperation(await this.completeReplayedOperation(operation));
      const result = await this.build.run(operation.id, operation.request, context.actor);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.build_id === undefined ? [] : [result.build_id], blocked: result.status === "blocked" ? [operation.id] : [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...item, status: "needs_input", question: "請描述要執行的來源、知識、創作、審查或建置操作。", updated_at: now() }
        : item),
    }));
    return { operation_id: operation.id, status: "needs_input", summary: "需要更多工作描述才能繼續。", completed: [], blocked: [], question: "請描述要執行的來源、知識、創作、審查或建置操作。", ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  /* c8 ignore stop */
  async zhujiContext(characterId?: string): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildZhujiTemplateContext> }> {
    const state = await this.repository.read();
    const knowledge = buildAuthoringKnowledgeContext(state);
    const existing = state.artifacts.flatMap((artifact) => {
      if (artifact.kind !== "zhuji") return [];
      try {
        const value = JSON.parse(artifact.content) as { character_id?: unknown; module?: { module?: unknown; title?: unknown } };
        if (typeof value.character_id !== "string" || typeof value.module?.module !== "string" || typeof value.module.title !== "string") return [];
        if (characterId !== undefined && value.character_id !== characterId) return [];
        return [{ artifact_id: artifact.id, character_id: value.character_id, module: value.module.module as ZhujiModuleKind, title: value.module.title, content: value, revision: artifact.revision }];
      } catch {
        return [];
      }
    });
    return { schema: zhujiProposalJsonSchema as Record<string, unknown>, context: buildZhujiTemplateContext(existing, knowledge) };
  }

  async templateContext(kind: TemplateKind): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildTemplateContext> }> {
    const state = await this.repository.read();
    const factReview = kind === "fact_review" ? await this.knowledge.factReviewContext() : undefined;
    const knowledge: AuthoringKnowledgeContext = {
      ...buildAuthoringKnowledgeContext(state),
      ...(factReview === undefined ? {} : { fact_review: factReview as FactReviewContext }),
    };
    const existing = state.artifacts.flatMap<TemplateInstance>((artifact): TemplateInstance[] => {
      if (kind === "wardrobe" && artifact.kind === "wardrobe") {
        const characterId = artifact.name.split("/")[0]?.trim();
        if (characterId === undefined || characterId.length === 0) return [];
        const content = artifact.content;
        const parsed = parseWardrobeMarkdown(content);
        return [{ artifact_id: artifact.id, kind, name: artifact.name, value: { kind: "wardrobe", character_id: characterId, content }, content: parsed.document, markdown: content, revision: artifact.revision }];
      }
      try {
        const value = JSON.parse(artifact.content) as { kind?: unknown };
        if (value.kind !== kind) return [];
        const name = artifact.name;
        return [{ artifact_id: artifact.id, kind, name, value, content: value, revision: artifact.revision }];
      } catch {
        return [];
      }
    });
    const context = buildTemplateContext(kind, existing, knowledge);
    return { schema: templateJsonSchemaFor(kind), context };
  }

  async authoringKnowledgeContext(): Promise<AuthoringKnowledgeContext> {
    return buildAuthoringKnowledgeContext(await this.repository.read());
  }

  async sourceCandidates(): Promise<ReadonlyArray<ProjectState["candidates"][number]>> {
    return (await this.repository.read()).candidates;
  }

  async selectSourceCandidates(decisions: SourceSelectionDecision[], context: WorkspaceContext): Promise<RequestResult> {
    if (decisions.length === 0) throw new CoreError("SOURCE_SELECTION_EMPTY", "至少要選擇一個候選來源。", true);
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "source",
      request: "select source candidates",
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "source_select", payload: { decisions } },
      lease_owner: context.actor,
      lease_token: internalId("lease"),
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "source_selection", candidate_ids: decisions.map((decision) => decision.candidate_id) },
      }],
    }));
    const result = await this.sources.selectCandidates(operation.id, decisions, context.actor);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: [...result.approved, ...result.rejected],
      blocked: [],
    };
  }

  async createAdaptationDecision(input: Omit<AdaptationDecision, "id" | "created_at" | "created_by">, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    const factFindings = validateFactReferences({ fact_refs: input.fact_refs ?? [] }, initial.facts, initial.sources);
    if (factFindings.length > 0) throw new CoreError("ADAPTATION_DECISION_FACT_INVALID", "Adaptation decision refers to unusable facts.", true, factFindings);
    const decision: AdaptationDecision = { ...input, id: internalId("adaptation_decision"), created_at: now(), created_by: context.actor };
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "authoring",
      request: `adaptation decision ${decision.topic}`,
      actor: context.actor,
      status: "completed",
      created_at: now(),
      updated_at: now(),
      progress: [{ item_id: decision.id, status: "completed", message: "Adaptation decision saved." }],
      result_summary: "Adaptation decision saved.",
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      adaptation_decisions: [...current.adaptation_decisions, decision],
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "adaptation.decision.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { decision_id: decision.id, topic: decision.topic, choice: decision.choice, fact_refs: decision.fact_refs ?? [] },
      }],
    }));
    return { operation_id: operation.id, status: "completed", summary: "Adaptation decision saved.", completed: [decision.id], blocked: [] };
  }

  async submitTemplateProposal(proposal: unknown, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const parsed = templateProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("TEMPLATE_SCHEMA_INVALID", parsed.error.message, true);
    await this.ensureInterviewComplete();
    const knowledgeState = await this.repository.read();
    if (parsed.data.kind !== "source_research" && parsed.data.kind !== "fact_curation" && parsed.data.kind !== "fact_review" && parsed.data.kind !== "review") {
      this.ensureSourceAdaptationFactsReady(knowledgeState);
    }
    const factFindings = validateFactReferences(parsed.data, knowledgeState.facts, knowledgeState.sources);
    if (factFindings.length > 0) {
      throw new CoreError("FACT_REFERENCE_INVALID", "Fact provenance validation failed.", true, factFindings);
    }
    if (parsed.data.kind === "palette") {
      await this.ensureBlueprintAuthoringReady("palette", parsed.data.character_id, parsed.data.module.module);
    }
    if (parsed.data.kind === "wardrobe") {
      await this.ensureWardrobeAuthoringReady(parsed.data.character_id);
    }
    const worldOrderKind: ArtifactKind | undefined = parsed.data.kind === "world"
      ? "world_lore"
      : parsed.data.kind === "character"
        ? "character"
        : parsed.data.kind === "zhuji"
          ? "zhuji"
          : parsed.data.kind === "palette"
            ? "palette"
            : parsed.data.kind === "wardrobe"
              ? "wardrobe"
              : undefined;
    if (worldOrderKind !== undefined) await this.ensureWorldAuthoringOrder(worldOrderKind);
    const request = `create ${parsed.data.kind}`;
    const fallbackAgent = parsed.data.kind === "fact_review"
      ? nextFactReviewer(knowledgeState)
      : defaultAgentForTemplate(parsed.data);
    const resolution = this.agents.resolve(request, options.agent ?? fallbackAgent);
    if (!this.agents.registryView().canSubmitProposal(resolution.agent_id, parsed.data.kind, proposalCapability(parsed.data))) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to submit ${parsed.data.kind} proposals.`, true, { agent_id: resolution.agent_id, proposal_kind: parsed.data.kind });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: parsed.data.kind === "review" || parsed.data.kind === "fact_review" ? "review" : "authoring",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "template_proposal", payload: parsed.data },
      lease_owner: context.actor,
      lease_token: internalId("lease"),
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { template_kind: parsed.data.kind, agent_id: resolution.agent_id },
      }],
    }));
    const candidateResult = parsed.data.kind === "source_research" && parsed.data.candidates.length > 0
      ? await this.sources.registerCandidates(operation.id, parsed.data.candidates.map((candidate) => ({
        title: candidate.title,
        ...(candidate.url === undefined ? {} : { url: candidate.url }),
        ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
        ...(candidate.official === undefined ? {} : { official: candidate.official }),
        ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
        ...(candidate.content === undefined ? {} : { content: candidate.content }),
      })), context.actor)
      : undefined;
    let domainSummary: string | undefined;
    let domainCompleted: string[] = [];
    if (parsed.data.kind === "fact_curation") {
      const applied = await this.knowledge.applyCuration(operation.id, parsed.data.claims, resolution.agent_id, context.actor);
      domainSummary = applied.summary;
      domainCompleted = applied.facts;
    } else if (parsed.data.kind === "fact_review") {
      const run = await this.knowledge.beginFactReviewRun(operation.id, resolution.agent_id, undefined, context.actor);
      const reviewProjection = (await this.knowledge.factReviewContext()).projection_revision;
      const applied = await this.knowledge.applyReviewBatch(operation.id, parsed.data.decisions, context.actor, resolution.agent_id, run.id, reviewProjection);
      domainSummary = applied.summary;
      domainCompleted = applied.fact_ids;
      const result = await this.authoring.createTemplate(operation.id, parsed.data as TemplateProposalValue, resolution.agent_id, context.actor);
      if (applied.status === "needs_input") {
        const latest = await this.repository.read();
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === operation.id
            ? { ...item, status: "needs_input" as const, question: "Fact review needs additional evidence or Director conflict resolution.", updated_at: now() }
            : item),
        }));
      }
      return {
        operation_id: operation.id,
        status: applied.status === "needs_input" ? "needs_input" : result.status,
        summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
        completed: [...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
        blocked: applied.status === "needs_input" ? domainCompleted : [],
        agent_id: resolution.agent_id,
        agent_role: resolution.agent_role,
      };
    } else if (parsed.data.kind === "review") {
      const applied = await this.review.applyProposal(operation.id, parsed.data, resolution.agent_id, context.actor);
      domainSummary = applied.summary;
      domainCompleted = [...(applied.review_id === undefined ? [] : [applied.review_id]), ...applied.issue_ids];
    }
    const result = await this.authoring.createTemplate(operation.id, parsed.data as TemplateProposalValue, resolution.agent_id, context.actor);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
      completed: [...(candidateResult?.completed ?? []), ...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
      blocked: [],
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  /** Director-only fact review submission; bypasses reviewer rotation so conflicts can be resolved. */
  async submitConflictResolution(proposal: unknown, context: WorkspaceContext): Promise<RequestResult> {
    return this.submitTemplateProposal(proposal, context, { agent: "director" });
  }

  async submitZhujiProposal(proposal: unknown, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const parsed = zhujiProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("ZHUJI_SCHEMA_INVALID", parsed.error.message, true);
    await this.ensureInterviewComplete();
    const knowledgeState = await this.repository.read();
    this.ensureSourceAdaptationFactsReady(knowledgeState);
    const factFindings = validateFactReferences(parsed.data, knowledgeState.facts, knowledgeState.sources);
    if (factFindings.length > 0) throw new CoreError("FACT_REFERENCE_INVALID", "Fact provenance validation failed.", true, factFindings);
    await this.ensureBlueprintAuthoringReady("zhuji", parsed.data.character_id, parsed.data.module.module);
    const request = `建立珠璣 ${parsed.data.character_id} ${parsed.data.module.module}`;
    const resolution = this.agents.resolve(request, options.agent ?? "zhuji-creator");
    if (!this.agents.registryView().canSubmitProposal(resolution.agent_id, parsed.data.kind)) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to submit ${parsed.data.kind} proposals.`, true, { agent_id: resolution.agent_id, proposal_kind: parsed.data.kind });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "authoring",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "zhuji_proposal", payload: parsed.data },
      lease_owner: context.actor,
      lease_token: internalId("lease"),
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "authoring", request, agent_id: resolution.agent_id, module: parsed.data.module.module },
      }],
    }));
    const result = await this.authoring.createZhuji(operation.id, parsed.data as ZhujiProposalValue, resolution.agent_id, context.actor);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: result.artifact_id === undefined ? [] : [result.artifact_id],
      blocked: [],
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  /** Configure quality with a compact preset instead of exposing blocking internals. */
  async configureQualityProfile(level: QualityLevel, context: WorkspaceContext, overrides: Record<string, IssueSeverity> = {}): Promise<RequestResult> {
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "status",
      request: `quality profile ${level}`,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
    };
    const created = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "quality_profile", level },
      }],
    }));
    const result = await this.review.configureQualityProfile(operation.id, level, context.actor, overrides);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: [operation.id],
      blocked: [],
      project_id: created.project_id,
    };
  }

  async updateIssue(input: IssueUpdateInput, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const request = `issue ${input.action} ${input.issue_id}`;
    const resolution = this.agents.resolve(request, options.agent ?? "director");
    if (!this.agents.registryView().canUpdateIssue(resolution.agent_id)) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to update review issues.`, true, { agent_id: resolution.agent_id, capability: "issue_update" });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "review",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "issue_update", payload: input },
      lease_owner: context.actor,
      lease_token: internalId("lease"),
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
    };
    const created = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "issue_update", issue_id: input.issue_id, action: input.action, agent_id: resolution.agent_id },
      }],
    }));
    const result = await this.review.updateIssue(operation.id, input, resolution.agent_id, context.actor);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: [result.issue_id],
      blocked: [],
      project_id: created.project_id,
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  private async proposeBlueprintRevision(request: string, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    const previousPrecheck = [...initial.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    if (previousPrecheck === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，再提出方向修改。", true);
    }
    const candidateBeforeRevision = previousPrecheck.candidate_blueprint;
    const rawCharacters = Array.isArray(candidateBeforeRevision.characters)
      ? candidateBeforeRevision.characters.map(objectValue).filter((value): value is Record<string, unknown> => value !== undefined)
      : [];
    const revisionCharacters = rawCharacters.length > 0
      ? rawCharacters
      : [{ id: "character-1", label: "角色", ordinal: 1 }];
    const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const namedMatches = revisionCharacters.filter((character) => {
      const label = nonEmptyString(character.label);
      return label !== undefined && new RegExp(escapeRegex(label), "iu").test(request);
    });
    const ordinalMatch = request.match(/(?:character[- _]?(\d+)|第\s*(\d+)\s*名|角色\s*(\d+))/iu);
    const ordinal = ordinalMatch === null ? undefined : Number(ordinalMatch[1] ?? ordinalMatch[2] ?? ordinalMatch[3]);
    const ordinalMatchCharacter = ordinal === undefined ? undefined : revisionCharacters.find((character) => Number(character.ordinal) === ordinal || character.id === `character-${ordinal}`);
    const targetCharacter = namedMatches.length === 1
      ? namedMatches[0]
      : ordinalMatchCharacter ?? (revisionCharacters.length === 1 ? revisionCharacters[0] : undefined);
    if (targetCharacter === undefined) {
      const labels = revisionCharacters.map((character) => nonEmptyString(character.label) ?? String(character.id ?? "角色")).join("、");
      throw new CoreError("BLUEPRINT_CHARACTER_REQUIRED", `請指出要修改哪名角色的方向（${labels}）。`, true);
    }
    const targetCharacterId = nonEmptyString(targetCharacter.id) ?? "character-1";
    const targetCharacterLabel = nonEmptyString(targetCharacter.label) ?? targetCharacterId;
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "interview",
      request,
      actor: context.actor,
      status: "needs_input",
      created_at: now(),
      updated_at: now(),
      progress: [],
       question: `已更新「${targetCharacterLabel}」的 Blueprint 方向草案；請回答「確認」保存，或繼續提供短句修改。`,
    };
    const candidate = JSON.parse(JSON.stringify(previousPrecheck.candidate_blueprint)) as Record<string, unknown>;
    const existingIntake = candidate.intake_values !== null && typeof candidate.intake_values === "object" && !Array.isArray(candidate.intake_values)
      ? candidate.intake_values as Record<string, unknown>
      : {};
    const requestWithoutCommand = request.replace(/^\s*(?:修改|更新|調整|change|revise|update)\s*/iu, "").trim();
    const genericStripped = request.replace(/^\s*(?:修改|更新|調整|change|revise|update)\s*(?:blueprint\s*)?(?:方向|direction)?\s*[:：-]?\s*/iu, "").trim();
    const directionPrefixes = [
      `${targetCharacterLabel}的 Blueprint 方向`,
      `${targetCharacterLabel}的角色設定方向`,
      `${targetCharacterId} Blueprint direction`,
      `${targetCharacterId} direction`,
    ];
    const normalizedRequest = requestWithoutCommand.toLocaleLowerCase();
    const matchedPrefix = directionPrefixes.find((prefix) => normalizedRequest.startsWith(prefix.toLocaleLowerCase()));
    const selected = (matchedPrefix === undefined
      ? (revisionCharacters.length === 1 ? genericStripped || request.trim() : request.trim())
      : requestWithoutCommand.slice(matchedPrefix.length).replace(/^[\s:：-]+/u, "").trim()) || request.trim();
    const revisedIntake = { ...existingIntake, [`blueprint_direction:${targetCharacterId}`]: selected };
    if (revisionCharacters.length === 1) revisedIntake.blueprint_direction = selected;
    const candidateCharacters = revisionCharacters.map((character) => {
      if (String(character.id) !== targetCharacterId) return character;
      const previousDirection = objectValue(character.direction) ?? {};
      const history = Array.isArray(previousDirection.history) ? previousDirection.history : [];
      return {
        ...character,
        direction: {
          ...previousDirection,
          scope: "character_setting",
          selected,
          character_setting_direction: selected,
          candidate_summary: selected,
          source_question_id: `blueprint_direction:${targetCharacterId}`,
          selected_at: now(),
          intake_revision: contentHash(canonicalJson(revisedIntake)),
          history: [...history, { answer: selected, actor: context.actor, occurred_at: now() }],
        },
      };
    });
    candidate.intake_values = revisedIntake;
    candidate.characters = candidateCharacters;
    if (candidateCharacters.length === 1) candidate.blueprint_direction = objectValue(candidateCharacters[0]?.direction);
    const confirmationCheck: BlueprintPrecheckCheck = {
      subject_id: targetCharacterId,
      dimension: "cross_module_impact",
      uncertainty: "high",
      impact: "high",
      basis: "A direction revision can affect downstream mode modules.",
      action: "user_confirmed",
      user_answer: "pending confirmation",
    };
    const checks = previousPrecheck.checks.some((check) => check.dimension === "cross_module_impact" && check.subject_id === targetCharacterId)
      ? previousPrecheck.checks.map((check) => check.dimension === "cross_module_impact" && check.subject_id === targetCharacterId ? confirmationCheck : check)
      : [...previousPrecheck.checks, confirmationCheck];
    const precheck: BlueprintPrecheckRecord = {
      id: internalId("blueprint_precheck"),
      schema_version: 1,
      project_id: initial.project_id,
      operation_id: operation.id,
      collaboration_mode: previousPrecheck.collaboration_mode,
      candidate_blueprint: candidate,
      candidate_blueprint_revision: contentHash(canonicalJson(candidate)),
      checks,
      status: "needs_input",
      created_at: now(),
      created_by: context.actor,
    };
    const updated = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      project_status: current.project_status === "published" ? "ready" : current.project_status,
      blueprint_prechecks: [
        ...current.blueprint_prechecks.map((item) => item.status === "recorded" ? { ...item, status: "superseded" as const } : item),
        precheck,
      ],
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "blueprint.revision.proposed",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { precheck_id: precheck.id, previous_precheck_id: previousPrecheck.id, candidate_blueprint_revision: precheck.candidate_blueprint_revision },
      }],
    }));
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary: "已建立 Blueprint 方向修訂草案；請確認後才會保存新版本。",
      completed: [],
      blocked: [precheck.id],
      ...(operation.question === undefined ? {} : { question: operation.question }),
      project_id: updated.project_id,
      agent_id: "director",
      agent_role: "orchestrator",
    };
  }

  async request(request: string, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const trimmed = request.trim();
    if (trimmed.length === 0) {
      throw new CoreError("REQUEST_EMPTY", "請描述想完成的事情", true);
    }
    const qualityRequest = trimmed.match(/(?:quality|品質|審查)\s*(?:profile|模式|設定)?\s*[:：\s]*(none|light|normal|strict|無|輕量|正常|嚴格)/iu);
    if (qualityRequest?.[1] !== undefined) {
      const labels: Record<string, QualityLevel> = { none: "none", light: "light", normal: "normal", strict: "strict", "無": "none", "輕量": "light", "正常": "normal", "嚴格": "strict" };
      const level = labels[qualityRequest[1].toLocaleLowerCase()];
      if (level !== undefined) return this.configureQualityProfile(level, context);
    }
    const resolution = this.agents.resolve(trimmed, options.agent);
    const kind = resolution.kind;
    if (kind === "status") return this.status();
    if (kind === "authoring" || kind === "knowledge" || kind === "build" || kind === "import" || kind === "source") {
      const definition = this.agents.registryView().get(resolution.agent_id);
      if (definition?.read_only === true) {
        throw new CoreError("AGENT_READ_ONLY", `Agent ${resolution.agent_id} is read-only and cannot execute ${kind} requests.`, true, { agent_id: resolution.agent_id, kind });
      }
    }
    const existing = await this.repository.read();
    const pendingBlueprintPrecheck = [...existing.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (this.interviewRequired && pendingBlueprintPrecheck !== undefined) {
      const midConfirmation = existing.interview.current !== undefined && parsePrecheckConfirmQuestionId(existing.interview.current.id) !== undefined;
      if (existing.interview.status === "complete" && (isBlueprintConfirmation(trimmed) || midConfirmation)) {
        return this.answerInterview(trimmed, context);
      }
      throw new CoreError("BLUEPRINT_PRECHECK_REQUIRED", "Blueprint precheck needs a short confirmation before the next workflow step.", true);
    }
    if (this.interviewRequired && existing.interview.status === "complete" && isBlueprintRevisionRequest(trimmed)) {
      return this.proposeBlueprintRevision(trimmed, context);
    }
    const projectNeedsInterview = (existing.project_status === "uninitialized" || existing.project_status === "interviewing") && existing.interview.status !== "complete";
    if (this.interviewRequired && projectNeedsInterview) {
      return existing.interview.status === "active"
        ? this.answerInterview(trimmed, context)
        : this.startInterview(trimmed, context);
    }
    const pending = [...existing.operations].reverse().find((operation) => operation.status === "needs_input");
    if (pending !== undefined) {
      const resumed = await this.resumePendingIfAnswered(pending, trimmed, context, kind);
      if (resumed !== undefined) return resumed;
    }
    const state = existing;
    if (kind === "authoring") this.ensureSourceAdaptationFactsReady(state);
    if (kind === "authoring") {
      const inferred = inferAuthoringKind(trimmed);
      if (inferred === "character" || inferred === "world_lore" || inferred === "zhuji" || inferred === "palette" || inferred === "wardrobe") {
        await this.ensureWorldAuthoringOrder(inferred);
      }
    }
    const isSourceSearch = kind === "source" && /搜尋|找來源|research|search/iu.test(trimmed) && !/加入|匯入|保存|批准/iu.test(trimmed);
    const operationId = internalId("operation");
    const attachmentRefs = context.attachments.length > 0 ? await this.attachmentStore.save(operationId, context.attachments) : [];
    const operation: OperationRecord = {
      id: operationId,
      kind,
      request: trimmed,
      actor: context.actor,
      status: "resolving",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: {
        version: 1,
        type: kind === "import" ? "import" : kind === "source" ? (isSourceSearch ? "source_search" : "source_resume") : "request",
        ...(attachmentRefs.length === 0 ? {} : { attachment_refs: attachmentRefs }),
      },
      lease_owner: context.actor,
      lease_token: internalId("lease"),
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
    };
    const created = await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind, request: trimmed, agent_id: resolution.agent_id },
      }],
    }));
    if (kind === "source") {
      await this.repository.commit(created.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
      }));
      if (isSourceSearch) {
        const results = context.research_results ?? (this.searcher === undefined ? [] : await this.searcher(trimmed));
        const searched = await this.sources.registerCandidates(operation.id, results, context.actor);
        return { operation_id: operation.id, status: searched.status, summary: searched.summary, completed: searched.completed, blocked: searched.blocked };
      }
      const executionContext = this.fetcher === undefined ? context : { ...context, fetcher: this.fetcher };
      if (context.attachments.length > 0 || /https?:\/\//iu.test(trimmed)) {
        const resumed = await this.sources.resume(operation.id, trimmed, executionContext);
        const latestResume = await this.repository.read();
        const finalResume = latestResume.operations.find((item) => item.id === operation.id);
        if (finalResume === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operation.id} does not exist`);
        return { ...responseFromOperation(finalResume), status: resumed.status, summary: resumed.summary, completed: resumed.completed, blocked: resumed.blocked };
      }
      const beforeExecute = await this.repository.read();
      const snapshotCandidate = beforeExecute.candidates.find((candidate) => candidate.status === "approved" && candidate.selection_snapshot !== undefined);
      const executeOperationId = snapshotCandidate?.selection_snapshot?.operation_id ?? operation.id;
      const result = await this.sources.execute(executeOperationId, executionContext);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === executeOperationId);
      if (finalOperation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${executeOperationId} does not exist`);
      if (executeOperationId !== operation.id) {
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "completed", updated_at: now() } : item),
        }));
      }
      return { ...responseFromOperation(finalOperation), status: result.status, summary: result.summary, completed: result.completed, blocked: result.blocked };
    }
    if (kind === "knowledge" || kind === "authoring" || kind === "review") {
      await this.repository.commit(created.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
      }));
      if (kind === "knowledge") {
        const result = await this.knowledge.refresh(operation.id, trimmed, context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }) };
      }
      if (kind === "authoring") {
        const result = await this.authoring.create(operation.id, trimmed, resolution.agent_id, context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return {
          operation_id: operation.id,
          status: result.status,
          summary: result.summary,
          completed: result.artifact_id === undefined ? [] : [result.artifact_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: resolution.agent_id,
          agent_role: resolution.agent_role,
        };
      }
      const result = /重新評估|re-?evaluate|quality profile/iu.test(trimmed)
        ? await this.review.reevaluate(operation.id, context.actor)
        : await this.review.review(operation.id, trimmed, resolution.agent_id, context.actor);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return {
        operation_id: operation.id,
        status: result.status,
        summary: result.summary,
        completed: result.review_id === undefined ? [] : [result.review_id],
        blocked: result.status === "blocked" ? [operation.id] : [],
        ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        agent_id: resolution.agent_id,
        agent_role: resolution.agent_role,
      };
    }
    if (kind === "build" || kind === "import") {
      await this.repository.commit(created.revision, (current) => ({
        ...current,
        operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
      }));
      if (kind === "build") {
        const result = await this.build.run(operation.id, trimmed, context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return {
          operation_id: operation.id,
          status: result.status,
          summary: result.summary,
          completed: result.build_id === undefined ? [] : [result.build_id],
          blocked: result.status === "blocked" ? [operation.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        };
      }
      const result = await this.importer.run(operation.id, trimmed, context.actor, context.attachments);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return {
        operation_id: operation.id,
        status: result.status,
        summary: result.summary,
        completed: result.artifact_id === undefined ? (result.import_id === undefined ? [] : [result.import_id]) : [result.artifact_id],
        blocked: [],
        ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
      };
    }
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...item, status: "needs_input", question: "請描述要執行的來源、知識、創作、審查或建置操作。", updated_at: now() }
        : item),
    }));
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary: "我需要更明確的操作目標。",
      completed: [],
      blocked: [],
      question: "請描述要執行的來源、知識、創作、審查或建置操作。",
    };
  }

  async status(): Promise<RequestResult> {
    const state = await this.repository.read();
    const active = [...state.operations].reverse().find((operation) => !["completed", "cancelled", "failed"].includes(operation.status));
    if (active !== undefined) return responseFromOperation(active);
    return {
      status: "completed",
      summary: `目前有 ${state.sources.length} 個已入庫來源、${state.candidates.length} 個候選來源。`,
      completed: state.sources.map((source) => source.id),
      blocked: state.candidates.filter((candidate) => candidate.status === "blocked_external" || candidate.status === "failed").map((candidate) => candidate.id),
    };
  }

  async dashboardSnapshot(): Promise<DashboardSnapshot> {
    const state = await this.repository.read();
    const repair = await this.repository.inspectRepair();
    const blueprintArtifact = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint");
    let blueprint: DashboardBlueprint | undefined;
    if (blueprintArtifact !== undefined) {
      try {
        const parsed = JSON.parse(blueprintArtifact.content) as Record<string, unknown>;
        const characters = Array.isArray(parsed.characters) ? parsed.characters.map((item: unknown) => {
          const record = item as { id?: unknown; label?: unknown; mode?: unknown };
          return { id: String(record.id ?? ""), label: String(record.label ?? record.id ?? ""), mode: String(record.mode ?? "") };
        }) : [];
        const worldValue = parsed.world !== null && typeof parsed.world === "object" && !Array.isArray(parsed.world) ? parsed.world as Record<string, unknown> : undefined;
        blueprint = { revision: blueprintArtifact.revision, characters, ...(worldValue === undefined ? {} : { world: worldValue }) };
      } catch {
        blueprint = undefined;
      }
    }
    return {
      project: {
        project_id: state.project_id,
        ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
        project_status: state.project_status,
        revision: state.revision,
        interview_status: state.interview.status,
        ...(state.interview.flow === undefined ? {} : { interview_flow: state.interview.flow }),
        answers_count: state.interview.answers.length,
      },
      ...(blueprint === undefined ? {} : { blueprint }),
      prechecks: state.blueprint_prechecks.map((precheck) => ({ id: precheck.id, status: precheck.status, candidate_blueprint_revision: precheck.candidate_blueprint_revision, checks_count: precheck.checks.length })),
      artifacts: state.artifacts.map((artifact) => ({
        id: artifact.id,
        key: artifact.key,
        kind: artifact.kind,
        name: artifact.name,
        revision: artifact.revision,
        status: artifact.status,
        ...(artifact.created_by === undefined ? {} : { created_by: artifact.created_by }),
        ...(artifact.based_on === undefined ? {} : { based_on: artifact.based_on }),
        content_hash: artifact.content_hash,
        ...(artifact.blueprint_precheck_id === undefined ? {} : { blueprint_precheck_id: artifact.blueprint_precheck_id }),
        ...(artifact.blueprint_precheck_revision === undefined ? {} : { blueprint_precheck_revision: artifact.blueprint_precheck_revision }),
      })),
      images: state.images.map((image) => ({
        id: image.id,
        ...(image.character_id === undefined ? {} : { character_id: image.character_id }),
        width: image.width,
        height: image.height,
        ...(image.aspect_ratio === undefined ? {} : { aspect_ratio: image.aspect_ratio }),
        ...(image.source === undefined ? {} : { source: image.source }),
        ...(image.license === undefined ? {} : { license: image.license }),
        created_at: image.created_at,
      })),
      facts: state.facts.map((fact) => {
        const evidenceQuote = fact.evidence[0] ?? fact.evidence_refs?.[0]?.quote;
        const decision = fact.decision_id === undefined ? undefined : state.fact_review_decisions.find((item) => item.id === fact.decision_id);
        return {
          id: fact.id,
          statement: fact.statement,
          status: fact.status,
          ...(fact.subject === undefined ? {} : { subject: fact.subject }),
          ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
          ...(fact.value === undefined ? {} : { value: fact.value }),
          ...(fact.classification === undefined ? {} : { classification: fact.classification }),
          ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
          source_ids: fact.source_ids,
          ...(fact.review_run_id === undefined ? {} : { review_run_id: fact.review_run_id }),
          ...(fact.decision_id === undefined ? {} : { decision_id: fact.decision_id }),
          ...(evidenceQuote === undefined ? {} : { evidence_quote: String(evidenceQuote) }),
          ...(decision === undefined ? {} : { last_reviewer: decision.reviewer_identity, last_decision: decision.decision }),
        };
      }),
      sources: state.sources.map((source) => ({ id: source.id, candidate_id: source.candidate_id, title: source.title, revision: source.revision })),
      candidates: state.candidates.map((candidate) => ({ id: candidate.id, title: candidate.title, ...(candidate.url === undefined ? {} : { url: candidate.url }), status: candidate.status, ...(candidate.official === undefined ? {} : { official: candidate.official }) })),
      operations: state.operations.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        status: operation.status,
        request: operation.request,
        ...(operation.actor === undefined ? {} : { actor: operation.actor }),
        ...(operation.question === undefined ? {} : { question: operation.question }),
        ...(operation.lease_owner === undefined ? {} : { lease_owner: operation.lease_owner }),
        ...(operation.lease_expires_at === undefined ? {} : { lease_expires_at: operation.lease_expires_at }),
        ...(operation.attempt === undefined ? {} : { attempt: operation.attempt }),
        ...(operation.last_error === undefined ? {} : { last_error: operation.last_error }),
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        progress_count: operation.progress.length,
      })),
      issues: state.issues.map((issue) => ({
        id: issue.id,
        artifact_id: issue.artifact_id,
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
        effective_severity: issue.effective_severity,
        status: issue.status,
        created_at: issue.created_at,
      })),
      reviews: state.reviews.map((review) => ({ id: review.id, artifact_id: review.artifact_id, artifact_revision: review.artifact_revision, reviewer: review.reviewer, status: review.status })),
      quality: { ...(state.quality_profile.level === undefined ? {} : { level: state.quality_profile.level }), blocking_severity: state.quality_profile.blocking_severity, overrides: state.quality_profile.overrides },
      review_runs: state.fact_review_runs.map((run) => ({ id: run.id, status: run.status, candidate_occurrence_ids: run.candidate_occurrence_ids })),
      publishes: state.publishes.map((publish) => ({ id: publish.id, content_hash: publish.content_hash, created_at: publish.created_at, ...(publish.export_json_path === undefined ? {} : { export_json_path: publish.export_json_path }), ...(publish.export_png_path === undefined ? {} : { export_png_path: publish.export_png_path }) })),
      builds: state.builds.map((build) => ({ id: build.id, status: build.status, content_hash: build.content_hash, created_at: build.created_at })),
      repair,
    };
  }

  async publishPreview(): Promise<WorkflowGateResult> {
    const state = await this.repository.read();
    return validateWorkflow(state, "publish");
  }

  async buildReadiness(): Promise<DashboardBuildReadiness> {
    const state = await this.repository.read();
    const manifest = buildRequiredArtifactManifest(state);
    const blueprintArtifact = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint");
    let primary: { id: string; label: string; mode: string } | undefined;
    let modes: { zhuji: boolean; palette: boolean } = { zhuji: false, palette: false };
    if (blueprintArtifact !== undefined) {
      try {
        const parsed = JSON.parse(blueprintArtifact.content) as { characters?: Array<{ id?: unknown; label?: unknown; mode?: unknown }> };
        const characters = Array.isArray(parsed.characters) ? parsed.characters : [];
        const first = characters[0];
        if (first !== undefined) primary = { id: String(first.id ?? ""), label: String(first.label ?? first.id ?? ""), mode: String(first.mode ?? "") };
        for (const character of characters) {
          const mode = String(character.mode ?? "");
          if (mode === "zhuji") modes.zhuji = true;
          if (mode === "palette") modes.palette = true;
        }
      } catch {
        primary = undefined;
      }
    }
    const entries = state.artifacts.filter((artifact) => ["world_lore", "relationship", "greeting", "wardrobe", "plugin"].includes(artifact.kind)).map((artifact) => ({ kind: artifact.kind, name: artifact.name, char_count: artifact.content.length, estimated_tokens: Math.ceil(artifact.content.length / 4) }));
    const missing = manifest === undefined ? [] : manifest.characters.flatMap((character) => character.missing_modules.map((module) => `${character.character_id}:${module}`));
    return {
      modes,
      ...(primary === undefined ? {} : { primary_character: primary }),
      ...(manifest === undefined ? {} : { export_modes: manifest.export_modes }),
      entries,
      greeting_entries: entries.filter((entry) => entry.kind === "greeting").length,
      png_expected: modes.zhuji || modes.palette,
      missing,
      diagnostics: manifest?.diagnostics ?? [],
    };
  }

  async tavernCompat(): Promise<TavernCompatibilityReport> {
    const state = await this.repository.read();
    const latest = state.publishes.at(-1);
    if (latest === undefined) return { available: false, report: ["尚未有 publish 記錄，先完成打包再檢查相容性。"] };
    const report: string[] = [];
    let jsonText: string | undefined;
    if (latest.content_ref !== undefined) {
      const blob = await this.repository.readBlob(latest.content_ref.hash);
      if (blob === undefined) report.push("content blob 遺失，請執行專案修復。");
      else jsonText = new TextDecoder("utf-8").decode(blob);
    } else {
      jsonText = latest.content;
    }
    if (jsonText !== undefined) {
      try {
        const card = JSON.parse(jsonText) as Record<string, unknown>;
        const data = card.data !== null && typeof card.data === "object" && !Array.isArray(card.data) ? card.data as Record<string, unknown> : {};
        report.push(`spec=${String(card.spec ?? "未知")} spec_version=${String(card.spec_version ?? "未知")}`);
        const book = data.character_book !== null && typeof data.character_book === "object" && !Array.isArray(data.character_book) ? data.character_book as Record<string, unknown> : undefined;
        report.push(book === undefined ? "無 character_book 條目。" : `character_book「${String(book.name ?? "未命名")}」共 ${Array.isArray(book.entries) ? book.entries.length : 0} 條目。`);
        let greetings = 0;
        if (typeof data.first_mes === "string" && data.first_mes.length > 0) greetings += 1;
        if (Array.isArray(data.alternate_greetings)) greetings += data.alternate_greetings.filter((item) => typeof item === "string" && item.length > 0).length;
        report.push(`greeting 首發＋備選共 ${greetings} 組。`);
        const extensions = data.extensions !== null && typeof data.extensions === "object" && !Array.isArray(data.extensions) ? data.extensions as Record<string, unknown> : {};
        const pluginIds = Object.keys(extensions).filter((key) => key.startsWith("plugin."));
        report.push(pluginIds.length === 0 ? "無 plugin 依賴。" : `plugin 需求：${pluginIds.join(", ")}。`);
      } catch (error) {
        report.push(`內容 JSON 解析失敗：${error instanceof Error ? error.message : String(error)}。`);
      }
    } else {
      report.push("無內容 JSON（publish 只含 PNG 或 blob 遺失）。");
    }
    let pngBytes: Uint8Array | undefined;
    if (latest.png_ref !== undefined) pngBytes = await this.repository.readBlob(latest.png_ref.hash);
    else if (latest.png_base64 !== undefined) pngBytes = Buffer.from(latest.png_base64, "base64");
    if (pngBytes !== undefined) {
      const imageInfo = readPngImageInfo(pngBytes);
      if (imageInfo !== undefined) {
        const placeholder = imageInfo.width === 512 && imageInfo.height === 768;
        report.push(`PNG 尺寸 ${imageInfo.width}×${imageInfo.height}px（${placeholder ? "使用內建佔位圖，請上傳角色圖後重新打包" : "已嵌入角色圖像"}）。`);
      } else {
        report.push("PNG 簽名不符（可能不是有效 PNG）。");
      }
      try {
        const decoded = readCardFromPng(pngBytes);
        report.push(`PNG 內嵌卡片以 ${decoded.authority} 解析成功。`);
        if (jsonText !== undefined) {
          try {
            const parsed = JSON.parse(jsonText) as Record<string, unknown>;
            report.push(JSON.stringify(decoded.card) === JSON.stringify(parsed.data ?? parsed) ? "PNG 內嵌卡片與 JSON 內容一致。" : "PNG 內嵌卡片與 JSON 內容不一致（欄位順序或版本差異）。");
          } catch {
            report.push("JSON 無法解析，無法比對 PNG 內嵌卡片。");
          }
        }
      } catch (error) {
        report.push(`PNG 卡片解析失敗：${error instanceof Error ? error.message : String(error)}。`);
      }
    } else {
      report.push("無 PNG 輸出。");
    }
    return { available: true, report };
  }

  async repairPreview(): Promise<RepairInspection> {
    return this.repository.inspectRepair();
  }

  async repairRun(): Promise<RepairReport> {
    return this.repository.runRepair();
  }

  async setProjectImage(context: WorkspaceContext, options: { character_id?: string; aspect_ratio?: string; source?: string; license?: string } = {}): Promise<{ image_id: string; width: number; height: number }> {
    if (context.attachments.length !== 1) throw new CoreError("CARD_IMAGE_REQUIRED", "角色圖需要剛好一張 PNG 附件", true, { received: context.attachments.length });
    const attachment = context.attachments[0]!;
    const content = Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);
    if (!pngSignature.equals(content.subarray(0, 8))) throw new CoreError("CARD_IMAGE_REQUIRED", "角色圖必須是 PNG 檔案", true);
    let processed = content;
    let aspectRatio: string | undefined;
    let crop: { width: number; height: number; offset_x: number; offset_y: number } | undefined;
    if (options.aspect_ratio !== undefined) {
      aspectRatio = options.aspect_ratio;
      const original = readPngImageInfo(processed);
      if (original === undefined) throw new CoreError("CARD_IMAGE_REQUIRED", "角色圖必須是 PNG 檔案", true);
      const cropped = cropPngCover(processed, aspectRatio);
      const croppedInfo = readPngImageInfo(cropped);
      if (croppedInfo === undefined) throw new CoreError("CARD_IMAGE_DECODE_FAILED", "角色圖裁切後無法讀取", true);
      crop = {
        width: croppedInfo.width,
        height: croppedInfo.height,
        offset_x: original.width === croppedInfo.width ? 0 : Math.max(0, Math.floor((original.width - croppedInfo.width) / 2)),
        offset_y: original.height === croppedInfo.height ? 0 : Math.max(0, Math.floor((original.height - croppedInfo.height) / 2)),
      };
      processed = cropped;
    }
    const info = readPngImageInfo(processed);
    if (info === undefined) throw new CoreError("CARD_IMAGE_REQUIRED", "角色圖必須是 PNG 檔案", true);
    const blobHash = contentHash(processed);
    await this.repository.writeBlob(blobHash, processed);
    const now = new Date().toISOString();
    const id = internalId("image");
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => {
      return {
        ...current,
        images: [...current.images, {
          id,
          ...(options.character_id === undefined ? {} : { character_id: options.character_id }),
          blob_hash: blobHash,
          media_type: "image/png",
          width: info.width,
          height: info.height,
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(crop === undefined ? {} : { crop }),
          ...(options.source === undefined ? {} : { source: options.source }),
          ...(options.license === undefined ? {} : { license: options.license }),
          created_at: now,
          updated_at: now,
          ...(context.actor === undefined ? {} : { created_by: context.actor }),
        }],
      };
    });
    return { image_id: id, width: info.width, height: info.height };
  }

  async getProjectImage(imageId: string): Promise<{ media_type: string; content: Uint8Array } | undefined> {
    const state = await this.repository.read();
    const image = state.images.find((item) => item.id === imageId);
    if (image === undefined) return undefined;
    const content = await this.repository.readBlob(image.blob_hash);
    if (content === undefined) return undefined;
    return { media_type: image.media_type, content };
  }

  async removeProjectImage(imageId: string): Promise<boolean> {
    const state = await this.repository.read();
    if (!state.images.some((item) => item.id === imageId)) return false;
    await this.repository.commit(state.revision, (current) => {
      return { ...current, images: current.images.filter((item) => item.id !== imageId) };
    });
    return true;
  }

  private async resumePendingIfAnswered(pending: OperationRecord, trimmed: string, context: WorkspaceContext, kind: string): Promise<RequestResult | undefined> {
    if (pending.kind === "source" && (context.attachments.length > 0 || /重試|retry|上傳|貼上|https?:\/\//iu.test(trimmed))) {
      const resumed = await this.sources.resume(pending.id, trimmed, this.fetcher === undefined ? context : { ...context, fetcher: this.fetcher });
      return { operation_id: pending.id, status: resumed.status, summary: resumed.summary, completed: resumed.completed, blocked: resumed.blocked };
    }
    if (pending.kind === "build" && /模式|珠璣|調色盤|zhuji|palette/iu.test(pending.question ?? "")) {
      const pendingBuildMode = parseBuildModeSelection(trimmed);
      if (pendingBuildMode !== undefined) {
        const resumed = await this.build.run(pending.id, pending.request, context.actor, { mode_selection: pendingBuildMode });
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: resumed.status,
          summary: resumed.summary,
          completed: resumed.build_id === undefined ? [] : [resumed.build_id],
          blocked: resumed.status === "blocked" ? [pending.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        };
      }
      if (/不需要|先不要|不用了|skip|defer|之後再|後續/iu.test(trimmed)) {
        const latest = await this.repository.read();
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === pending.id ? { ...item, status: "completed", result_summary: "使用者略過本次打包。", updated_at: now() } : item),
        }));
        return { operation_id: pending.id, status: "completed", summary: "已略過本次打包。", completed: [], blocked: [] };
      }
      if (kind === "unknown") {
        return {
          operation_id: pending.id,
          status: "needs_input",
          summary: pending.question ?? "請選擇本次打包要使用的模式：珠璣、調色盤，或兩者。",
          completed: [],
          blocked: [],
          ...(pending.question === undefined ? {} : { question: pending.question }),
        };
      }
      return undefined;
    }
    if (kind === "unknown") {
      if (pending.kind === "knowledge") {
        const result = await this.knowledge.refresh(pending.id, trimmed, context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return { operation_id: pending.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }) };
      }
      if (pending.kind === "authoring") {
        const result = await this.authoring.create(pending.id, trimmed, "director", context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.artifact_id === undefined ? [] : [result.artifact_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: "director",
          agent_role: "orchestrator",
        };
      }
      if (pending.kind === "review") {
        const result = /重新評估|re-?evaluate|quality profile/iu.test(trimmed)
          ? await this.review.reevaluate(pending.id, context.actor)
          : await this.review.review(pending.id, trimmed, "fact-reviewer-1", context.actor);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.review_id === undefined ? [] : [result.review_id],
          blocked: result.status === "blocked" ? [pending.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        };
      }
      if (pending.kind === "import" && context.attachments.length > 0) {
        const result = await this.importer.run(pending.id, trimmed, context.actor, context.attachments);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.import_id === undefined ? [] : [result.import_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          ...(result.artifact_id === undefined ? {} : { artifact_id: result.artifact_id }),
        };
      }
    }
    return undefined;
  }

  private async ensureBlueprintAuthoringReady(kind: "zhuji" | "palette", characterId: string, module: string): Promise<void> {
    // The low-level template endpoints remain usable for isolated authoring and
    // migration fixtures. The Blueprint-first contract is enforced for the
    // interview-backed workspace runtime only.
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && hasUsableArtifact(artifact)
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    if (blueprint === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，確認後才能開始珠璣或調色盤模組創作。", true);
    }
    const order: readonly string[] = kind === "zhuji" ? ZHUJI_MODULE_ORDER : PALETTE_MODULE_ORDER;
    const index = order.indexOf(module);
    if (index < 0) return;
    const existing = parsedModeModules(state, kind, characterId);
    const missing = order.slice(0, index).filter((required) => !existing.has(required));
    if (missing.length > 0) {
      throw new CoreError(
        "AUTHORING_PREVIOUS_MODULE_REQUIRED",
        `請先完成前置模組：${missing.join("、")}，再建立 ${module}。`,
        true,
      );
    }
  }

  private ensureSourceAdaptationFactsReady(state: ProjectState): void {
    if (!this.interviewRequired || !isSourceAdaptationProject(state) || sourceFactsReady(state)) return;
    throw new CoreError(
      "SOURCE_FACTS_REQUIRED",
      "原作改編必須先完成來源搜尋、來源擷取、事實提取與固定 Review Run 的嚴格裁決，才能開始世界設定或角色創作。",
      true,
    );
  }

  private async ensureWardrobeAuthoringReady(characterId: string): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && hasUsableArtifact(artifact)
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    if (blueprint === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，確認後才能建立衣櫃。", true);
    }
    const hasCharacterSettings = state.artifacts.some((artifact) => {
      if (artifact.kind !== "zhuji" && artifact.kind !== "palette") return false;
      try {
        const value = JSON.parse(artifact.content) as { character_id?: unknown };
        return value.character_id === characterId;
      } catch {
        return false;
      }
    });
    if (!hasCharacterSettings) {
      throw new CoreError("CHARACTER_SETTINGS_REQUIRED", "請先完成至少一個珠璣或調色盤角色設定模組，再建立衣櫃。", true);
    }
  }

  private async ensureWorldAuthoringOrder(kind: ArtifactKind): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && hasUsableArtifact(artifact)
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    const world = blueprint === undefined ? undefined : (() => {
      try {
        return objectValue(JSON.parse(blueprint.content)?.world);
      } catch {
        return undefined;
      }
    })();
    if (world?.enabled !== true) return;
    const timing = typeof world.authoring_timing === "string" && world.authoring_timing.length > 0 ? world.authoring_timing : "before_characters";
    const characterKinds: readonly ArtifactKind[] = ["character", "zhuji", "palette", "wardrobe"];
    const hasWorldLore = state.artifacts.some((artifact) => artifact.kind === "world_lore" && hasUsableArtifact(artifact));
    const hasCharacterSide = state.artifacts.some((artifact) => characterKinds.includes(artifact.kind) && hasUsableArtifact(artifact));
    if (timing === "before_characters") {
      if (characterKinds.includes(kind) && !hasWorldLore) {
        throw new CoreError("WORLD_AUTHORING_ORDER", "世界設定需在角色創作之前完成；請先建立世界設定。", true);
      }
      return;
    }
    if (timing === "after_characters" && kind === "world_lore" && !hasCharacterSide) {
      throw new CoreError("CHARACTER_AUTHORING_ORDER", "角色創作需在世界設定之前完成；請先建立角色設定。", true);
    }
  }

  private async ensureInterviewComplete(): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    if ((state.project_status === "uninitialized" || state.project_status === "interviewing") && state.interview.status !== "complete") {
      throw new CoreError("INTERVIEW_REQUIRED", state.interview.current?.text ?? "請先完成專案訪談。", true);
    }
    const pendingPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (pendingPrecheck !== undefined) {
      throw new CoreError("BLUEPRINT_PRECHECK_REQUIRED", "Blueprint precheck needs a short confirmation before authoring can continue.", true);
    }
  }
}

function defaultAgentForTemplate(proposal: TemplateProposalValue): string {
  if (proposal.kind === "plugin") {
    if (proposal.plugin_id === "official.ejs") return "ejs-creator";
    if (proposal.plugin_id === "official.html") return "html-creator";
    return "mvu-creator";
  }
  if (proposal.kind === "review") {
    const target = `${proposal.target.kind} ${proposal.target.name}`.toLocaleLowerCase();
    if (/world|lore/iu.test(target)) return "world-lore-critic";
    if (/greeting/iu.test(target)) return "greetings-critic";
    if (/mvu/iu.test(target)) return "mvu-critic";
    if (/ejs/iu.test(target)) return "ejs-critic";
    if (/html/iu.test(target)) return "html-critic";
    return "character-critic";
  }
  switch (proposal.kind) {
    case "director_routing": return "director";
    case "source_research": return "source-researcher";
    case "fact_curation": return "fact-curator";
    case "fact_review": return "fact-reviewer-1";
    case "zhuji": return "zhuji-creator";
    case "palette": return "palette-creator";
    case "wardrobe": return "wardrobe-creator";
    case "character": return "director";
    case "relationships": return "relationship-creator";
    case "greetings": return "greetings-creator";
    case "world": return "world-lore-creator";
    case "conversion": return "mode-conversion";
    case "import_analysis": return "card-import-analyst";
  }
}

function proposalCapability(proposal: TemplateProposalValue): string | undefined {
  if (proposal.kind === "plugin") return proposal.plugin_id;
  if (proposal.kind === "review") return `${proposal.target.kind} ${proposal.target.name}`;
  return undefined;
}

function nextFactReviewer(state: ProjectState): string {
  const reviewers = ["fact-reviewer-1", "fact-reviewer-2", "fact-reviewer-3"] as const;
  const counts = new Map(reviewers.map((reviewer) => [reviewer, 0]));
  for (const decision of state.fact_review_decisions) {
    if (counts.has(decision.reviewer_identity as (typeof reviewers)[number])) {
      const reviewer = decision.reviewer_identity as (typeof reviewers)[number];
      counts.set(reviewer, (counts.get(reviewer) ?? 0) + 1);
    }
  }
  return [...reviewers].sort((left, right) => (counts.get(left)! - counts.get(right)!) || left.localeCompare(right))[0]!;
}

export { AgentAdapter, type AgentRequest } from "./agent-adapter.js";
export { AgentRegistry, AGENT_ALIASES, AGENT_DEFINITIONS, type AgentDefinition, type AgentRole } from "./agent-registry.js";
export { AgentRouter, classifyIntent, type AgentResolution } from "./agent-router.js";
export { WorkspaceWorker, type WorkspaceRuntimeProvider, type WorkspaceWorkerEvent, type WorkspaceWorkerOptions, type WorkspaceWorkerStatus } from "./worker.js";
export { WorkspaceProjectManager, type WorkspaceProjectManagerOptions, type WorkspaceProjectSummary } from "./project-manager.js";
