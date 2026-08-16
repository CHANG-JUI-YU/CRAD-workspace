import {
  amendInterviewAnswer as amendInterviewAnswerCore,
  beginInterview,
  canonicalJson,
  computeProjectProjection,
  CoreError,
  contentHash,
  FORMAL_NAME_QUESTION_PREFIX,
  hasValidMultiCharacterRoster,
  internalId,
  normalizeInterviewStateForDisplay,
  parseRelationshipParticipants,
  replayInterviewState,
  type ArtifactRecord,
  type BlueprintPrecheckCheck,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type InterviewAnswer,
  type InterviewCharacterSubject,
  type InterviewQuestion,
  type InterviewState,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type RequestResult,
  type SourceAdaptationIntent,
  type WorkspaceContext,
} from "@st-workspace/core";
import {
  deriveDownstreamInvalidation,
  emptyDownstreamInvalidationReport,
  PALETTE_REQUIRED_MODULES,
  ZHUJI_REQUIRED_MODULES,
  type DownstreamInvalidationReport,
} from "@st-workspace/domain";
import { now } from "./operation-runner.js";

export interface InterviewApplicationDeps {
  repository: ProjectRepository;
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
  return computeProjectProjection(state).blueprint?.artifact_value;
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
  const existingIds = new Set(existingCharacters.map((candidate) => typeof candidate.id === "string" ? candidate.id as string : ""));
  const existingOrdinals = existingCharacters.map((candidate) => typeof candidate.ordinal === "number" ? candidate.ordinal as number : 0);
  const newSubject = expansionCharacters[0];
  if (newSubject === undefined) {
    return { artifact: createBlueprintArtifact(state, expansionPrecheck, operationId, actor), precheck: expansionPrecheck };
  }
  const maxOrdinal = existingOrdinals.length === 0 ? 0 : Math.max(...existingOrdinals);
  let nextIndex = 1;
  while (existingIds.has(`character-${nextIndex}`)) {
    nextIndex += 1;
  }
  const newCharacterId = `character-${nextIndex}`;
  const newOrdinal = maxOrdinal + 1;
  const mergedCharacters = [
    ...existingCharacters,
    {
      id: newCharacterId,
      label: typeof newSubject.label === "string" ? newSubject.label : "新角色",
      ordinal: newOrdinal,
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

function mergeWorldIntoBlueprint(state: ProjectState, worldPrecheck: BlueprintPrecheckRecord, operationId: string, actor: string): { artifact: ArtifactRecord | undefined; precheck: BlueprintPrecheckRecord } {
  const previousBlueprint = latestBlueprintSnapshot(state);
  const previousPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
  if (previousBlueprint === undefined || previousPrecheck === undefined) {
    return { artifact: createBlueprintArtifact(state, worldPrecheck, operationId, actor), precheck: worldPrecheck };
  }
  const worldCandidate = objectValue(worldPrecheck.candidate_blueprint) ?? {};
  const newWorld = objectValue(worldCandidate.world);
  const existingIntake = objectValue(previousBlueprint.intake_values);
  const newIntake = objectValue(worldCandidate.intake_values);

  const mergedCandidate: Record<string, unknown> = {
    ...previousBlueprint,
    ...(newWorld === undefined ? {} : { world: newWorld }),
    intake_values: { ...(existingIntake ?? {}), ...(newIntake ?? {}) },
  };
  const mergedRevision = contentHash(canonicalJson(mergedCandidate));
  const mergedPrecheck: BlueprintPrecheckRecord = {
    id: internalId("blueprint_precheck"),
    schema_version: 1,
    project_id: state.project_id,
    operation_id: operationId,
    collaboration_mode: worldPrecheck.collaboration_mode,
    candidate_blueprint: mergedCandidate,
    candidate_blueprint_revision: mergedRevision,
    checks: [
      ...previousPrecheck.checks,
      ...worldPrecheck.checks,
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

function mergePatchBlueprint(state: ProjectState, precheck: BlueprintPrecheckRecord, operationId: string, actor: string): { artifact: ArtifactRecord | undefined; precheck: BlueprintPrecheckRecord } | undefined {
  if (state.interview.flow === "character_expansion") {
    return mergeExpansionIntoBlueprint(state, precheck, operationId, actor);
  }
  const isExistingWorldFlow = state.interview.flow === "world" && typeof state.interview.values.world_kind === "string" && state.interview.values.world_kind.replace(/\s+/gu, "").includes("既有專案");
  if (isExistingWorldFlow) {
    return mergeWorldIntoBlueprint(state, precheck, operationId, actor);
  }
  return undefined;
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
  if (!hasValidMultiCharacterRoster(interview)) {
    throw new CoreError("INTERVIEW_MULTI_ROSTER_INCOMPLETE", "Multi-character cards require at least two roster entries before a Blueprint can be created.", true);
  }
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

export interface InterviewHistoryEntry {
  question_id: string;
  question_text?: string;
  answer: string;
  actor: string;
  occurred_at: string;
  status: "current" | "superseded" | "amendment";
  superseded_by?: { question_id: string; occurred_at: string };
  amendment_of?: { question_id: string; occurred_at: string };
}

export function interviewHistory(answers: readonly InterviewAnswer[]): InterviewHistoryEntry[] {
  const replayed = replayInterviewState(answers);
  return answers.map((item) => ({
    question_id: item.question_id,
    ...(replayed === undefined || replayed.questions[item.question_id] === undefined ? {} : { question_text: replayed.questions[item.question_id]!.text }),
    answer: item.answer,
    actor: item.actor,
    occurred_at: item.occurred_at,
    status: item.amendment_of !== undefined ? "amendment" as const : item.superseded_by !== undefined ? "superseded" as const : "current" as const,
    ...(item.superseded_by === undefined ? {} : { superseded_by: item.superseded_by }),
    ...(item.amendment_of === undefined ? {} : { amendment_of: item.amendment_of }),
  }));
}

export async function interviewContext(deps: InterviewApplicationDeps): Promise<{
  project_id: string;
  status: InterviewState["status"];
  flow: InterviewState["flow"];
  question?: InterviewState["current"];
  answers: InterviewState["answers"];
  values: InterviewState["values"];
  characters?: InterviewState["characters"];
  active_character_id?: string;
  revision: number;
  history: InterviewHistoryEntry[];
}> {
  const state = await deps.repository.read();
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
    revision: state.revision,
    history: interviewHistory(interview.answers),
  };
}

function recordedPrecheckIds(state: ProjectState): string[] {
  return [...state.blueprint_prechecks].reverse().filter((item) => item.status === "recorded").map((item) => item.id);
}

export interface InterviewAmendmentPreviewResult {
  project_id: string;
  revision: number;
  noop: boolean;
  question_id: string;
  status: InterviewState["status"];
  flow: InterviewState["flow"];
  question?: InterviewState["current"];
  answers: InterviewState["answers"];
  values: InterviewState["values"];
  characters?: InterviewState["characters"];
  active_character_id?: string;
  history: InterviewHistoryEntry[];
  downstream_invalidation: DownstreamInvalidationReport;
  superseded_precheck_ids: string[];
}

export async function interviewAmendmentImpactPreview(
  deps: InterviewApplicationDeps,
  input: { question_id: string; answer: string },
): Promise<InterviewAmendmentPreviewResult> {
  const state = await deps.repository.read();
  const amended = amendInterviewAnswerCore(state.interview, { question_id: input.question_id, answer: input.answer, actor: "preview" });
  const noop = amended === state.interview;
  const precheckIds = noop ? [] : recordedPrecheckIds(state);
  const downstream_invalidation = noop
    ? emptyDownstreamInvalidationReport()
    : deriveDownstreamInvalidation(state, { ...state, interview: amended });
  return {
    project_id: state.project_id,
    revision: state.revision,
    noop,
    question_id: input.question_id,
    status: amended.status,
    flow: amended.flow,
    ...(amended.current === undefined ? {} : { question: amended.current }),
    answers: amended.answers,
    values: amended.values,
    ...(amended.characters === undefined ? {} : { characters: amended.characters }),
    ...(amended.active_character_id === undefined ? {} : { active_character_id: amended.active_character_id }),
    history: interviewHistory(amended.answers),
    downstream_invalidation,
    superseded_precheck_ids: precheckIds,
  };
}

export interface InterviewAmendmentResult extends RequestResult {
  project_id: string;
  revision: number;
  noop: boolean;
  downstream_invalidation: DownstreamInvalidationReport;
  superseded_precheck_ids: string[];
  history: InterviewHistoryEntry[];
}

export async function amendInterviewAnswer(
  deps: InterviewApplicationDeps,
  input: { question_id: string; answer: string },
  context: WorkspaceContext,
): Promise<InterviewAmendmentResult> {
  const initial = await deps.repository.read();
  const amended = amendInterviewAnswerCore(initial.interview, { question_id: input.question_id, answer: input.answer, actor: context.actor });
  const noop = amended === initial.interview;
  if (noop) {
    return {
      operation_id: "",
      status: "completed",
      summary: "答案與現行內容相同，未產生任何變更。",
      completed: [],
      blocked: [],
      project_id: initial.project_id,
      revision: initial.revision,
      noop: true,
      downstream_invalidation: emptyDownstreamInvalidationReport(),
      superseded_precheck_ids: [],
      history: interviewHistory(initial.interview.answers),
    };
  }
  const precheckIds = recordedPrecheckIds(initial);
  const afterState: ProjectState = { ...initial, interview: amended };
  const downstream_invalidation = deriveDownstreamInvalidation(initial, afterState);
  const operation = [...initial.operations].reverse().find((item) => item.kind === "interview" && !["cancelled", "failed"].includes(item.status));
  const amendment = amended.answers.at(-1);
  const previous = initial.interview.answers.filter((item) => item.question_id === input.question_id && item.superseded_by === undefined).at(-1);
  const resumed = amended.status === "active" && amended.current !== undefined;
  const finalized = await deps.repository.commit(initial.revision, (current) => ({
    ...current,
    project_status: resumed ? "interviewing" : current.project_status,
    interview: amended,
    blueprint_prechecks: current.blueprint_prechecks.map((item) => precheckIds.includes(item.id) ? { ...item, status: "superseded" as const } : item),
    operations: current.operations.map((item) => item.id === operation?.id
      ? {
        ...item,
        status: resumed ? "needs_input" as const : "completed" as const,
        ...(amended.current === undefined ? {} : { question: amended.current.text }),
        result_summary: resumed ? "訪談回答已修訂，請繼續回答目前的問題。" : "訪談回答已修訂，訪談維持完成狀態。",
        updated_at: now(),
      }
      : item),
    audit: [
      ...current.audit,
      {
        id: internalId("audit"),
        operation_id: operation?.id ?? "",
        event: "interview.answer.amended" as const,
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: {
          question_id: input.question_id,
          previous_answer: previous?.answer,
          amended_answer: amendment?.answer,
          amendment_occurred_at: amendment?.occurred_at,
          resumed,
          superseded_precheck_ids: precheckIds,
        },
      },
    ],
  }));
  return {
    operation_id: operation?.id ?? "",
    status: resumed ? "needs_input" : "completed",
    summary: resumed ? "訪談回答已修訂，請繼續回答目前的問題。" : "訪談回答已修訂，下游元件已重新評估。",
    completed: [],
    blocked: [],
    ...(amended.current === undefined ? {} : { question: amended.current.text, interview_question: amended.current }),
    project_id: finalized.project_id,
    ...(typeof finalized.interview.values.project_name === "string" ? { project_name: finalized.interview.values.project_name } : {}),
    flow: amended.flow,
    revision: finalized.revision,
    noop: false,
    downstream_invalidation,
    superseded_precheck_ids: precheckIds,
    history: interviewHistory(amended.answers),
  };
}

export async function startInterview(deps: InterviewApplicationDeps, request: string, context: WorkspaceContext): Promise<RequestResult> {
  const initial = await deps.repository.read();
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
  await deps.repository.commit(initial.revision, (current) => ({
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

export {
  ZHUJI_MODULE_ORDER,
  PALETTE_MODULE_ORDER,
  objectValue,
  nonEmptyString,
  nonEmptyInterviewValue,
  collaborationMode,
  isBlueprintRevisionRequest,
  isBlueprintConfirmation,
  blueprintKey,
  blueprintContent,
  canonPolicyFromValues,
  sourceAdaptationIntentFromValues,
  latestBlueprintSnapshot,
  isSourceAdaptationProject,
  sourceFactsReady,
  createBlueprintArtifact,
  mergeExpansionIntoBlueprint,
  mergeWorldIntoBlueprint,
  mergePatchBlueprint,
  interviewCharacterSubjects,
  directionForSubject,
  authoringModeForSubject,
  relationshipConfig,
  worldConfig,
  buildBlueprintPrecheck,
  PRECHECK_CONFIRM_PREFIX,
  parsePrecheckConfirmQuestionId,
  precheckConfirmQuestion,
  precheckSubjectLabel,
  intakeKeyForConfirmation,
  isBarePrecheckConfirmation,
};
