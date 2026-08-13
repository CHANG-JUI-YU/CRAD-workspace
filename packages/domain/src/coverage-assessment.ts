import {
  COVERAGE_DIMENSIONS,
  COVERAGE_FORMAL_ITEM_STATUSES,
  COVERAGE_INITIAL_ITEM_STATUSES,
  WORLD_COVERAGE_DIMENSION,
  CoreError,
  canonicalJson,
  computeProjectProjection,
  contentHash,
  coverageAssessmentRevision,
  coverageRequirementById,
  coverageRequirementSetRevision,
  coverageSnapshotHash,
  createEntityMatcher,
  factReferencesEntity,
  internalId,
  type AuthoringCoverageBinding,
  type CoverageAssessment,
  type CoverageAssessmentInputSnapshot,
  type CoverageAssessmentItem,
  type CoverageAssessmentItemStatus,
  type CoverageRequirementRef,
  type CoverageRequirementSet,
  type CoverageResolution,
  type CoverageSnapshot,
  type CoverageUserDecisionAction,
  type CoverageUserDecisionRecord,
  type FactRecord,
  type ProjectState,
} from "@st-workspace/core";
import { resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";
import { candidateOccurrenceForFact, latestDecisionForOccurrence } from "./fact-projection.js";

function now(): string {
  return new Date().toISOString();
}

function latestRecordedPrecheck(state: ProjectState) {
  return [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
}

function latestActiveRun(state: ProjectState) {
  return [...state.fact_review_runs].reverse().find((item) => item.status === "open" || item.status === "blocked");
}

function worldEnabled(state: ProjectState): boolean {
  const world = latestRecordedPrecheck(state)?.candidate_blueprint.world as { enabled?: boolean } | undefined;
  return world?.enabled === true;
}

function factProjectionRevision(state: ProjectState): string {
  return contentHash(
    canonicalJson({
      facts: state.facts.map((fact) => ({
        id: fact.id,
        status: fact.status,
        fact_revision: fact.fact_revision ?? 0,
        coverage_targets: fact.coverage_targets ?? [],
        suggested_coverage_targets: fact.suggested_coverage_targets ?? [],
      })),
      runs: state.fact_review_runs.map((run) => ({ id: run.id, status: run.status, candidate_set_revision: run.candidate_set_revision })),
      decisions: state.fact_review_decisions.map((decision) => ({ id: decision.id, decision: decision.decision, candidate_occurrence_id: decision.candidate_occurrence_id })),
    }),
  );
}

function inputSnapshot(state: ProjectState): CoverageAssessmentInputSnapshot {
  const precheck = latestRecordedPrecheck(state);
  const run = latestActiveRun(state);
  return {
    ...(precheck === undefined ? {} : { blueprint_revision: precheck.candidate_blueprint_revision }),
    source_revisions: state.sources.map((source) => ({ source_id: source.id, revision: source.revision })),
    fact_projection_revision: factProjectionRevision(state),
    ...(run === undefined ? {} : { fact_review_run_id: run.id, fact_review_projection_revision: run.candidate_set_revision }),
  };
}

function requirementFacts(state: ProjectState, matcher: ReturnType<typeof createEntityMatcher>, requirementId: string, characterId: string | undefined): FactRecord[] {
  const definition = coverageRequirementById(requirementId);
  if (definition === undefined) return [];
  if (characterId !== undefined) {
    return state.facts.filter((fact) => factReferencesEntity(fact, matcher, characterId));
  }
  return state.facts.filter((fact) => fact.classification === "world" || (fact.coverage ?? []).includes(WORLD_COVERAGE_DIMENSION));
}

function hasOpenConflict(state: ProjectState, related: FactRecord[]): boolean {
  if (related.some((fact) => fact.status === "conflict")) return true;
  const run = latestActiveRun(state);
  if (run === undefined) return false;
  return related.some((fact) => latestDecisionForOccurrence(state.fact_review_decisions, run.id, candidateOccurrenceForFact(fact))?.decision === "conflict");
}

function currentAcceptedDecision(state: ProjectState, fact: FactRecord): boolean {
  const run = latestActiveRun(state);
  if (run === undefined) return false;
  const decision = latestDecisionForOccurrence(state.fact_review_decisions, run.id, candidateOccurrenceForFact(fact));
  return decision?.decision === "accepted" && decision.resulting_fact_revision === fact.fact_revision;
}

function provenanceCurrent(state: ProjectState, fact: FactRecord): boolean {
  const refs = fact.evidence_refs ?? [];
  if (refs.length === 0) return false;
  return refs.every((reference) => {
    const source = state.sources.find((candidate) => candidate.id === reference.source_id);
    return source !== undefined && source.revision === reference.source_revision_id;
  });
}

function initialItemStatus(state: ProjectState, matcher: ReturnType<typeof createEntityMatcher>, requirementId: string, characterId: string | undefined): CoverageAssessmentItemStatus {
  const related = requirementFacts(state, matcher, requirementId, characterId);
  if (hasOpenConflict(state, related)) return "conflicted";
  const hasCandidateSignal = related.some((fact) => fact.status === "candidate" && (fact.suggested_coverage_targets ?? []).includes(requirementId));
  return hasCandidateSignal ? "candidate_signal" : "missing";
}

function formalItemStatus(
  state: ProjectState,
  matcher: ReturnType<typeof createEntityMatcher>,
  requirementId: string,
  characterId: string | undefined,
): { status: CoverageAssessmentItemStatus; acceptedIds: string[]; resolutionIds: string[] } {
  const definition = coverageRequirementById(requirementId);
  if (definition === undefined) return { status: "missing", acceptedIds: [], resolutionIds: [] };

  const related = requirementFacts(state, matcher, requirementId, characterId);
  if (hasOpenConflict(state, related)) return { status: "conflicted", acceptedIds: [], resolutionIds: [] };

  // Check source-covered accepted facts
  const satisfied = related.filter(
    (fact) =>
      fact.status === "accepted" &&
      currentAcceptedDecision(state, fact) &&
      (fact.coverage_targets ?? []).includes(requirementId) &&
      provenanceCurrent(state, fact),
  );
  if (satisfied.length >= definition.satisfaction.min_accepted_facts) {
    return { status: "covered_by_source", acceptedIds: satisfied.map((fact) => fact.id), resolutionIds: [] };
  }

  // Check current resolutions (creative completion or fulfilled user supplement)
  const activeResolutions = state.coverage_resolutions.filter(
    (r) =>
      r.requirement_id === requirementId &&
      (characterId === undefined ? r.character_id === undefined : r.character_id === characterId) &&
      !state.coverage_resolutions.some((other) => other.supersedes === r.id),
  );

  const fulfilledSupplement = activeResolutions.find((r) => r.mode === "user_supplement" && r.status === "fulfilled");
  if (fulfilledSupplement !== undefined) {
    return { status: "covered_by_user_supplement", acceptedIds: [], resolutionIds: [fulfilledSupplement.id] };
  }

  const creativeAuth = activeResolutions.find((r) => r.mode === "creative_completion" && r.status === "authorized");
  if (creativeAuth !== undefined) {
    return { status: "creative_completion_authorized", acceptedIds: [], resolutionIds: [creativeAuth.id] };
  }

  return { status: "missing", acceptedIds: [], resolutionIds: [] };
}

function validateItemStatuses(items: CoverageAssessmentItem[], pass: "initial" | "formal"): void {
  const allowed = pass === "initial" ? COVERAGE_INITIAL_ITEM_STATUSES : COVERAGE_FORMAL_ITEM_STATUSES;
  for (const item of items) {
    if (!allowed.includes(item.status)) {
      throw new CoreError(
        "COVERAGE_ASSESSMENT_INVALID",
        `Coverage assessment item ${item.requirement_id} uses status ${item.status} which is not allowed for ${pass} assessments.`,
        true,
      );
    }
  }
}

export function buildDefaultRequirementSet(state: ProjectState, actor: string): CoverageRequirementSet {
  const roster = computeProjectProjection(state).intent.roster;
  const requirementIds = COVERAGE_DIMENSIONS.map((dimension) => `req.${dimension}`);
  const characters = roster.map((character) => ({ character_id: character.id, requirement_ids: [...requirementIds] }));
  const precheck = latestRecordedPrecheck(state);
  const base: Omit<CoverageRequirementSet, "id" | "revision" | "created_at"> = {
    source: "default",
    ...(precheck === undefined ? {} : { blueprint_revision: precheck.candidate_blueprint_revision }),
    characters,
    world_requirement_ids: worldEnabled(state) ? [`req.${WORLD_COVERAGE_DIMENSION}`] : [],
    created_by: actor,
  };
  return { id: internalId("requirement-set"), revision: coverageRequirementSetRevision(base), ...base, created_at: now() };
}

export function runInitialCoverageAssessment(state: ProjectState, requirementSet: CoverageRequirementSet, operationId: string, actor: string): CoverageAssessment {
  const matcher = createEntityMatcher(state);
  const items: CoverageAssessmentItem[] = [];
  for (const character of requirementSet.characters) {
    for (const requirementId of character.requirement_ids) {
      const related = requirementFacts(state, matcher, requirementId, character.character_id);
      items.push({
        character_id: character.character_id,
        requirement_id: requirementId,
        status: initialItemStatus(state, matcher, requirementId, character.character_id),
        candidate_fact_ids: related.filter((fact) => fact.status === "candidate").map((fact) => fact.id),
        accepted_fact_ids: [],
        research_task_ids: [],
        resolution_ids: [],
      });
    }
  }
  for (const requirementId of requirementSet.world_requirement_ids) {
    const related = requirementFacts(state, matcher, requirementId, undefined);
    items.push({
      requirement_id: requirementId,
      status: initialItemStatus(state, matcher, requirementId, undefined),
      candidate_fact_ids: related.filter((fact) => fact.status === "candidate").map((fact) => fact.id),
      accepted_fact_ids: [],
      research_task_ids: [],
      resolution_ids: [],
    });
  }
  validateItemStatuses(items, "initial");
  const base: Omit<CoverageAssessment, "id" | "revision" | "created_at"> = {
    pass: "initial",
    requirement_set_id: requirementSet.id,
    requirement_set_revision: requirementSet.revision,
    input_snapshot: inputSnapshot(state),
    items,
    operation_id: operationId,
    created_by: actor,
  };
  return { id: internalId("assessment"), revision: coverageAssessmentRevision(base), ...base, created_at: now() };
}

export function runFormalCoverageAssessment(state: ProjectState, requirementSet: CoverageRequirementSet, operationId: string, actor: string): CoverageAssessment {
  const matcher = createEntityMatcher(state);
  const items: CoverageAssessmentItem[] = [];
  for (const character of requirementSet.characters) {
    for (const requirementId of character.requirement_ids) {
      const related = requirementFacts(state, matcher, requirementId, character.character_id);
      const evaluated = formalItemStatus(state, matcher, requirementId, character.character_id);
      items.push({
        character_id: character.character_id,
        requirement_id: requirementId,
        status: evaluated.status,
        candidate_fact_ids: related.filter((fact) => fact.status === "candidate").map((fact) => fact.id),
        accepted_fact_ids: evaluated.acceptedIds,
        research_task_ids: [],
        resolution_ids: evaluated.resolutionIds,
      });
    }
  }
  for (const requirementId of requirementSet.world_requirement_ids) {
    const related = requirementFacts(state, matcher, requirementId, undefined);
    const evaluated = formalItemStatus(state, matcher, requirementId, undefined);
    items.push({
      requirement_id: requirementId,
      status: evaluated.status,
      candidate_fact_ids: related.filter((fact) => fact.status === "candidate").map((fact) => fact.id),
      accepted_fact_ids: evaluated.acceptedIds,
      research_task_ids: [],
      resolution_ids: evaluated.resolutionIds,
    });
  }
  validateItemStatuses(items, "formal");
  const base: Omit<CoverageAssessment, "id" | "revision" | "created_at"> = {
    pass: "formal",
    requirement_set_id: requirementSet.id,
    requirement_set_revision: requirementSet.revision,
    input_snapshot: inputSnapshot(state),
    items,
    operation_id: operationId,
    created_by: actor,
  };
  return { id: internalId("assessment"), revision: coverageAssessmentRevision(base), ...base, created_at: now() };
}

export function coverageAssessmentFreshness(state: ProjectState, assessment: CoverageAssessment): boolean {
  const snapshot = assessment.input_snapshot;
  const precheck = latestRecordedPrecheck(state);
  const run = latestActiveRun(state);
  if (snapshot.blueprint_revision !== precheck?.candidate_blueprint_revision) return false;
  if (snapshot.fact_review_run_id !== run?.id) return false;
  const currentSources = state.sources.map((source) => ({ source_id: source.id, revision: source.revision }));
  if (snapshot.source_revisions.length !== currentSources.length) return false;
  for (let index = 0; index < currentSources.length; index += 1) {
    const before = snapshot.source_revisions[index];
    const after = currentSources[index];
    if (before === undefined || after === undefined || before.source_id !== after.source_id || before.revision !== after.revision) return false;
  }
  if (snapshot.fact_projection_revision !== factProjectionRevision(state)) return false;
  return true;
}

/**
 * Record user decision and create corresponding resolutions.
 */
export function recordUserDecisionAndResolution(
  state: ProjectState,
  action: CoverageUserDecisionAction,
  requirementIds: string[],
  choice: string,
  rationale: string,
  userInput: string,
  executionInput: ExecutionActorInput,
  operationId: string,
  characterId?: string,
): { decision: CoverageUserDecisionRecord; resolutions: CoverageResolution[]; state: ProjectState } {
  const { auditActor } = resolveExecutionActors(executionInput);
  const reqSet = state.coverage_requirement_sets.at(-1);
  const latestAssessment = state.coverage_assessments.at(-1);

  const decisionId = internalId("user-decision");
  const decision: CoverageUserDecisionRecord = {
    id: decisionId,
    action,
    requirement_ids: requirementIds,
    ...(characterId === undefined ? {} : { character_id: characterId }),
    ...(latestAssessment === undefined ? {} : { assessment_id: latestAssessment.id, assessment_revision: latestAssessment.revision }),
    requirement_set_revision: reqSet?.revision ?? "",
    choice,
    rationale,
    user_input: userInput,
    actor: auditActor,
    operation_id: operationId,
    created_at: now(),
  };

  const resolutions: CoverageResolution[] = [];
  for (const reqId of requirementIds) {
    const resId = internalId("resolution");
    if (action === "creative_completion") {
      const res: CoverageResolution = {
        id: resId,
        ...(characterId === undefined ? {} : { character_id: characterId }),
        requirement_id: reqId,
        mode: "creative_completion",
        status: "authorized",
        assessment_id: latestAssessment?.id ?? "",
        assessment_revision: latestAssessment?.revision ?? "",
        requirement_set_revision: reqSet?.revision ?? "",
        rationale,
        user_decision_id: decisionId,
        authorized_by: auditActor,
        operation_id: operationId,
        created_by: auditActor,
        created_at: now(),
      };
      resolutions.push(res);
    } else if (action === "user_supplement") {
      const res: CoverageResolution = {
        id: resId,
        ...(characterId === undefined ? {} : { character_id: characterId }),
        requirement_id: reqId,
        mode: "user_supplement",
        status: "pending",
        assessment_id: latestAssessment?.id ?? "",
        assessment_revision: latestAssessment?.revision ?? "",
        requirement_set_revision: reqSet?.revision ?? "",
        rationale,
        user_decision_id: decisionId,
        authorized_by: auditActor,
        operation_id: operationId,
        created_by: auditActor,
        created_at: now(),
      };
      resolutions.push(res);
    }
  }

  const updatedState: ProjectState = {
    ...state,
    coverage_user_decisions: [...state.coverage_user_decisions, decision],
    coverage_resolutions: [...state.coverage_resolutions, ...resolutions],
  };

  return { decision, resolutions, state: updatedState };
}

/**
 * Fulfill a pending user_supplement resolution with accepted facts and sources.
 */
export function fulfillUserSupplementResolution(
  state: ProjectState,
  pendingResolutionId: string,
  sourceRefs: Array<{ source_id: string; revision: string }>,
  factRefs: Array<{ fact_id: string; fact_revision: string; decision_id: string }>,
  executionInput: ExecutionActorInput,
  operationId: string,
): { resolution: CoverageResolution; state: ProjectState } {
  const { auditActor } = resolveExecutionActors(executionInput);
  const pending = state.coverage_resolutions.find((r) => r.id === pendingResolutionId);
  if (pending === undefined) {
    throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Resolution "${pendingResolutionId}" not found.`, true);
  }
  if (pending.mode !== "user_supplement" || pending.status !== "pending") {
    throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Resolution "${pendingResolutionId}" is not a pending user_supplement resolution.`, true);
  }

  const successorId = internalId("resolution");
  const successor: CoverageResolution = {
    id: successorId,
    ...(pending.character_id === undefined ? {} : { character_id: pending.character_id }),
    requirement_id: pending.requirement_id,
    mode: "user_supplement",
    status: "fulfilled",
    assessment_id: pending.assessment_id,
    assessment_revision: pending.assessment_revision,
    requirement_set_revision: pending.requirement_set_revision,
    rationale: pending.rationale,
    source_refs: sourceRefs,
    fact_refs: factRefs,
    user_decision_id: pending.user_decision_id,
    authorized_by: pending.authorized_by,
    operation_id: operationId,
    supersedes: pending.id,
    created_by: auditActor,
    created_at: now(),
  };

  const updatedState: ProjectState = {
    ...state,
    coverage_resolutions: [...state.coverage_resolutions, successor],
  };

  return { resolution: successor, state: updatedState };
}

/**
 * Check if source-derived / user-supplement facts are valid, reviewed, and consistent.
 */
export function sourceFactsReady(state: ProjectState): boolean {
  if (state.facts.length === 0) {
    // Vacuous true if all requirements resolved via creative resolutions & research exhausted
    const latestAssessment = state.coverage_assessments.at(-1);
    if (latestAssessment === undefined) return false;
    const unfulfilled = latestAssessment.items.filter(
      (item) => item.status === "missing" || item.status === "candidate_signal" || item.status === "conflicted",
    );
    return unfulfilled.length === 0;
  }

  // All accepted facts must have valid provenance and no open conflicts
  const accepted = state.facts.filter((f) => f.status === "accepted");
  for (const fact of accepted) {
    if (!provenanceCurrent(state, fact)) return false;
  }

  const hasConflict = state.facts.some((f) => f.status === "conflict");
  return !hasConflict;
}

/**
 * Check if all active requirements are resolved by source, user_supplement, or creative completion.
 */
export function requirementsResolved(state: ProjectState): {
  resolved: boolean;
  missing: CoverageRequirementRef[];
  items: Array<{ character_id?: string; requirement_id: string; status: CoverageAssessmentItemStatus }>;
} {
  const reqSet = state.coverage_requirement_sets.at(-1);
  if (reqSet === undefined) return { resolved: false, missing: [], items: [] };

  const latestAssessment = state.coverage_assessments.at(-1);
  if (latestAssessment === undefined) return { resolved: false, missing: [], items: [] };

  const missing: CoverageRequirementRef[] = [];
  const items: Array<{ character_id?: string; requirement_id: string; status: CoverageAssessmentItemStatus }> = [];

  for (const item of latestAssessment.items) {
    items.push({
      ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
      requirement_id: item.requirement_id,
      status: item.status,
    });

    if (item.status === "missing" || item.status === "candidate_signal" || item.status === "conflicted") {
      missing.push({
        ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
        requirement_id: item.requirement_id,
      });
    }
  }

  return {
    resolved: missing.length === 0,
    missing,
    items,
  };
}

/**
 * Build immutable CoverageSnapshot for preview/build/publish.
 */
export function buildCoverageSnapshot(state: ProjectState, assessment: CoverageAssessment): CoverageSnapshot {
  const reqSet = state.coverage_requirement_sets.find((s) => s.id === assessment.requirement_set_id);
  const precheck = latestRecordedPrecheck(state);

  const sourceCovered: CoverageRequirementRef[] = [];
  const supplementCovered: CoverageRequirementRef[] = [];
  const creativeCovered: CoverageRequirementRef[] = [];
  const resolutionIds: string[] = [];

  for (const item of assessment.items) {
    const ref: CoverageRequirementRef = {
      ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
      requirement_id: item.requirement_id,
    };
    if (item.status === "covered_by_source") sourceCovered.push(ref);
    if (item.status === "covered_by_user_supplement") supplementCovered.push(ref);
    if (item.status === "creative_completion_authorized") creativeCovered.push(ref);
    resolutionIds.push(...item.resolution_ids);
  }

  const activeBindings = state.coverage_authoring_bindings.map((b) => b.id);

  const snapshotObj: Omit<CoverageSnapshot, "snapshot_hash"> = {
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_id: assessment.requirement_set_id,
    requirement_set_revision: assessment.requirement_set_revision,
    blueprint_revision: precheck?.candidate_blueprint_revision ?? "",
    fact_projection_revision: factProjectionRevision(state),
    ...(assessment.input_snapshot.fact_review_run_id === undefined ? {} : { fact_review_run_id: assessment.input_snapshot.fact_review_run_id }),
    ...(assessment.input_snapshot.fact_review_projection_revision === undefined ? {} : { fact_review_projection_revision: assessment.input_snapshot.fact_review_projection_revision }),
    source_revisions: state.sources.map((s) => ({ source_id: s.id, revision: s.revision })),
    source_covered_requirements: sourceCovered,
    user_supplement_requirements: supplementCovered,
    creative_completion_requirements: creativeCovered,
    resolution_ids: [...new Set(resolutionIds)],
    authoring_binding_ids: activeBindings,
  };

  const hash = coverageSnapshotHash(snapshotObj);
  return { ...snapshotObj, snapshot_hash: hash };
}
