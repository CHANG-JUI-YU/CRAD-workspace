import {
  COVERAGE_DIMENSIONS,
  COVERAGE_FORMAL_ITEM_STATUSES,
  COVERAGE_INITIAL_ITEM_STATUSES,
  WORLD_COVERAGE_DIMENSION,
  CoreError,
  artifactBinding,
  authoringBindingHash,
  computeProjectProjection,
  coverageAssessmentRevision,
  coverageFactProjectionRevision,
  coverageRequirementById,
  coverageRequirementSetRevision,
  coverageSnapshotHash,
  createEntityMatcher,
  factReferencesEntity,
  internalId,
  parseArtifactValue,
  type ArtifactRecord,
  type AuthoringCoverageBinding,
  type BuildPlan,
  type BuildPlanEntry,
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

function latestAuthoritativeRun(state: ProjectState) {
  return [...state.fact_review_runs].reverse().find((item) => item.status !== "superseded");
}

function worldEnabled(state: ProjectState): boolean {
  const world = latestRecordedPrecheck(state)?.candidate_blueprint.world as { enabled?: boolean } | undefined;
  return world?.enabled === true;
}

function factProjectionRevision(state: ProjectState): string {
  return coverageFactProjectionRevision(state);
}

function inputSnapshot(state: ProjectState): CoverageAssessmentInputSnapshot {
  const precheck = latestRecordedPrecheck(state);
  const run = latestAuthoritativeRun(state);
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
  const run = latestAuthoritativeRun(state);
  if (run === undefined) return false;
  return related.some((fact) => latestDecisionForOccurrence(state.fact_review_decisions, run.id, candidateOccurrenceForFact(fact))?.decision === "conflict");
}

function currentAcceptedDecision(state: ProjectState, fact: FactRecord): boolean {
  const run = latestAuthoritativeRun(state);
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
  // Check current resolutions (creative completion or fulfilled user supplement)
  const currentReqSetRevision = state.coverage_requirement_sets.at(-1)?.revision;
  const activeResolutions = state.coverage_resolutions.filter(
    (r) =>
      r.requirement_id === requirementId &&
      r.requirement_set_revision === currentReqSetRevision &&
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
  const run = latestAuthoritativeRun(state);
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

  if (action === "requirement_change" || action === "assessment_replacement") {
    throw new CoreError(
      "COVERAGE_USER_DECISION_INVALID",
      `Action "${action}" changes the requirement set; submit a new requirement set revision with an explicit user decision instead of a silent no-op.`,
      true,
    );
  }

  if (latestAssessment === undefined) {
    throw new CoreError("COVERAGE_RESOLUTION_INVALID", "No coverage assessment exists to bind the resolution; run an assessment first.", true);
  }

  const decisionId = internalId("user-decision");
  const decision: CoverageUserDecisionRecord = {
    id: decisionId,
    action,
    requirement_ids: requirementIds,
    ...(characterId === undefined ? {} : { character_id: characterId }),
    assessment_id: latestAssessment.id,
    assessment_revision: latestAssessment.revision,
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

  const reqSet = state.coverage_requirement_sets.at(-1);
  if (reqSet === undefined || pending.requirement_set_revision !== reqSet.revision) {
    throw new CoreError(
      "COVERAGE_RESOLUTION_INVALID",
      `Resolution "${pendingResolutionId}" targets requirement set revision ${pending.requirement_set_revision} which is no longer current.`,
      true,
    );
  }
  if (sourceRefs.length === 0 || factRefs.length === 0) {
    throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Resolution "${pendingResolutionId}" requires at least one source reference and one accepted fact reference.`, true);
  }

  const authoritativeRun = latestAuthoritativeRun(state);
  for (const ref of sourceRefs) {
    const source = state.sources.find((item) => item.id === ref.source_id);
    if (source === undefined || source.revision !== ref.revision) {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Source "${ref.source_id}" is missing or its revision does not match the current source record.`, true);
    }
  }
  for (const ref of factRefs) {
    const fact = state.facts.find((item) => item.id === ref.fact_id);
    if (fact === undefined || fact.status !== "accepted") {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Fact "${ref.fact_id}" does not exist or is not accepted.`, true);
    }
    if (ref.fact_revision !== fact.accepted_fact_revision) {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Fact "${ref.fact_id}" revision does not match the current accepted canonical revision.`, true);
    }
    const decision = state.fact_review_decisions.find((item) => item.id === ref.decision_id);
    if (
      decision === undefined ||
      authoritativeRun === undefined ||
      decision.review_run_id !== authoritativeRun.id ||
      decision.decision !== "accepted" ||
      decision.resulting_fact_revision !== fact.fact_revision
    ) {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Decision "${ref.decision_id}" is not the current accepted decision for fact "${ref.fact_id}".`, true);
    }
    if (!provenanceCurrent(state, fact)) {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Fact "${ref.fact_id}" no longer has current source provenance.`, true);
    }
    if (!(fact.coverage_targets ?? []).includes(pending.requirement_id)) {
      throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Fact "${ref.fact_id}" does not cover requirement "${pending.requirement_id}".`, true);
    }
    if (pending.character_id !== undefined) {
      const matcher = createEntityMatcher(state);
      if (!factReferencesEntity(fact, matcher, pending.character_id)) {
        throw new CoreError("COVERAGE_RESOLUTION_INVALID", `Fact "${ref.fact_id}" does not reference character "${pending.character_id}".`, true);
      }
    }
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

  const candidates = state.facts.filter((f) => f.status === "candidate");
  if (candidates.length > 0) return false;

  const hasConflict = state.facts.some((f) => f.status === "conflict");
  if (hasConflict) return false;

  const run = latestAuthoritativeRun(state);
  if (run === undefined || run.status !== "completed") return false;

  const accepted = state.facts.filter((f) => f.status === "accepted");
  for (const fact of accepted) {
    if (!provenanceCurrent(state, fact)) return false;
    const decision = latestDecisionForOccurrence(state.fact_review_decisions, run.id, candidateOccurrenceForFact(fact));
    if (decision === undefined || decision.decision !== "accepted" || decision.resulting_fact_revision !== fact.fact_revision) return false;
  }

  return true;
}

/**
 * Structured blocker describing why coverage readiness is not satisfied.
 */
export interface CoverageBlocker {
  code: string;
  character_id?: string;
  requirement_id?: string;
  current_status?: string;
  fact_ids?: string[];
  source_ids?: string[];
  conflict?: boolean;
  stale_component?: string;
  message: string;
  next_action?: string;
}

function staleComponent(state: ProjectState, assessment: CoverageAssessment): string {
  const precheck = latestRecordedPrecheck(state);
  if (assessment.input_snapshot.blueprint_revision !== precheck?.candidate_blueprint_revision) return "blueprint";
  if (assessment.input_snapshot.fact_review_run_id !== latestAuthoritativeRun(state)?.id) return "review_run";
  const currentSources = state.sources.map((source) => ({ source_id: source.id, revision: source.revision }));
  if (assessment.input_snapshot.source_revisions.length !== currentSources.length) return "sources";
  for (let index = 0; index < currentSources.length; index += 1) {
    const before = assessment.input_snapshot.source_revisions[index];
    const after = currentSources[index];
    if (before === undefined || after === undefined || before.source_id !== after.source_id || before.revision !== after.revision) return "sources";
  }
  return "facts";
}

/**
 * Single authoritative coverage readiness check consumed by authoring gates,
 * the publish workflow gate and the runtime. Returns structured blockers so
 * every consumer surfaces the same diagnostics.
 */
export function deriveCoverageReadiness(state: ProjectState): { ready: boolean; blockers: CoverageBlocker[] } {
  const blockers: CoverageBlocker[] = [];

  const reqSet = state.coverage_requirement_sets.at(-1);
  if (reqSet === undefined) {
    blockers.push({
      code: "COVERAGE_RESEARCH_REQUIRED",
      message: "尚未建立 requirement set；請先完成來源處理與初步評估。",
      next_action: "建立 requirement set 並執行 initial assessment。",
    });
    return { ready: false, blockers };
  }

  const latestAssessment = state.coverage_assessments.at(-1);
  const assessmentUsable = latestAssessment !== undefined && latestAssessment.pass === "formal";
  if (!assessmentUsable) {
    blockers.push({
      code: "COVERAGE_FACT_REVIEW_REQUIRED",
      message: "尚未建立通過 Fact Review 的 formal coverage assessment。",
      next_action: "完成 Fact Review 後執行 formal assessment。",
    });
  } else {
    if (latestAssessment.requirement_set_id !== reqSet.id || latestAssessment.requirement_set_revision !== reqSet.revision) {
      blockers.push({
        code: "COVERAGE_ASSESSMENT_STALE",
        stale_component: "requirement_set",
        message: "最新 assessment 對應的 requirement set 已變更。",
        next_action: "以新 requirement set 重新執行 formal assessment。",
      });
    }
    if (!coverageAssessmentFreshness(state, latestAssessment)) {
      blockers.push({
        code: "COVERAGE_ASSESSMENT_STALE",
        stale_component: staleComponent(state, latestAssessment),
        message: "最新 coverage assessment 已過期，輸入已變更。",
        next_action: "重新執行 formal assessment。",
      });
    }
  }

  if (state.facts.length > 0) {
    const candidates = state.facts.filter((f) => f.status === "candidate");
    if (candidates.length > 0) {
      blockers.push({
        code: "COVERAGE_FACT_REVIEW_REQUIRED",
        current_status: "candidate",
        fact_ids: candidates.map((f) => f.id),
        message: "仍有 candidate facts 尚未裁決。",
        next_action: "完成 Fact Review 所有候選裁決。",
      });
    }
    const conflicts = state.facts.filter((f) => f.status === "conflict");
    if (conflicts.length > 0) {
      blockers.push({
        code: "COVERAGE_RESOLUTION_REQUIRED",
        conflict: true,
        fact_ids: conflicts.map((f) => f.id),
        message: "存在未解決的 Fact conflict。",
        next_action: "由 Director 解析 conflict 後重新評估。",
      });
    }
    const run = latestAuthoritativeRun(state);
    if (run !== undefined && run.status !== "completed") {
      blockers.push({
        code: "COVERAGE_FACT_REVIEW_REQUIRED",
        current_status: run.status,
        message: "目前的事實審查 run 尚未完成。",
        next_action: "完成 Fact Review。",
      });
    }
    for (const fact of state.facts.filter((f) => f.status === "accepted")) {
      if (!provenanceCurrent(state, fact)) {
        const sourceIds = fact.evidence_refs?.map((ref) => ref.source_id) ?? [];
        blockers.push({
          code: "COVERAGE_ASSESSMENT_STALE",
          stale_component: "sources",
          fact_ids: [fact.id],
          ...(sourceIds.length === 0 ? {} : { source_ids: sourceIds }),
          message: "accepted fact 的來源佐證已失效。",
          next_action: "更新來源或重新審查。",
        });
      }
    }
  }

  const resolved = requirementsResolved(state);
  if (!resolved.resolved) {
    for (const ref of resolved.missing) {
      blockers.push({
        code: "COVERAGE_RESOLUTION_REQUIRED",
        ...(ref.character_id === undefined ? {} : { character_id: ref.character_id }),
        requirement_id: ref.requirement_id,
        message: `需求 ${ref.requirement_id} 尚未解決。`,
        next_action: "完成來源覆蓋或取得使用者 resolution。",
      });
    }
  }

  return { ready: blockers.length === 0, blockers };
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
  if (latestAssessment.pass !== "formal") return { resolved: false, missing: [], items: [] };
  if (latestAssessment.requirement_set_id !== reqSet.id || latestAssessment.requirement_set_revision !== reqSet.revision) {
    return { resolved: false, missing: [], items: [] };
  }

  const expected = new Map<string, CoverageRequirementRef>();
  for (const character of reqSet.characters) {
    for (const reqId of character.requirement_ids) {
      expected.set(`${character.character_id}/${reqId}`, { character_id: character.character_id, requirement_id: reqId });
    }
  }
  for (const reqId of reqSet.world_requirement_ids) {
    expected.set(`world/${reqId}`, { requirement_id: reqId });
  }

  const itemByKey = new Map<string, { character_id?: string; requirement_id: string; status: CoverageAssessmentItemStatus }>();
  for (const item of latestAssessment.items) {
    const key = `${item.character_id ?? "world"}/${item.requirement_id}`;
    if (itemByKey.has(key)) return { resolved: false, missing: [], items: [] };
    itemByKey.set(key, {
      ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
      requirement_id: item.requirement_id,
      status: item.status,
    });
  }
  if (itemByKey.size !== expected.size) return { resolved: false, missing: [], items: [] };

  const missing: CoverageRequirementRef[] = [];
  const items: Array<{ character_id?: string; requirement_id: string; status: CoverageAssessmentItemStatus }> = [];
  for (const [key, expectedRef] of expected) {
    const item = itemByKey.get(key);
    if (item === undefined) return { resolved: false, missing: [], items: [] };
    items.push(item);
    if (item.status === "missing" || item.status === "candidate_signal" || item.status === "conflicted") {
      missing.push(expectedRef);
    }
  }

  return {
    resolved: missing.length === 0,
    missing,
    items,
  };
}

/**
 * Artifact kinds that must carry a current coverage binding when the coverage
 * workflow is enabled. Workflow/intermediate artifacts (review, source_research,
 * fact_curation, fact_review, conversion, import_analysis, director_routing,
 * draft_note, unknown) and the Blueprint itself are intentionally excluded.
 */
export const COVERAGE_SENSITIVE_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  "character",
  "relationship",
  "world_lore",
  "greeting",
  "zhuji",
  "palette",
  "wardrobe",
  "plugin",
]);

export function isCoverageSensitiveArtifactKind(kind: string): boolean {
  return COVERAGE_SENSITIVE_ARTIFACT_KINDS.has(kind);
}

export interface ArtifactCoverageScope {
  character_ids: string[];
  world: boolean;
  global: boolean;
}

export function deriveArtifactCoverageScope(state: ProjectState, artifact: ArtifactRecord): ArtifactCoverageScope {
  switch (artifact.kind) {
    case "world_lore":
      return { character_ids: [], world: true, global: false };
    case "plugin":
      return { character_ids: [], world: false, global: true };
    case "character":
    case "zhuji":
    case "palette":
    case "wardrobe": {
      const bound = artifactBinding(artifact);
      if (bound.characterIds.length === 0) {
        throw new CoreError("COVERAGE_BINDING_SCOPE_INVALID", `Cannot derive a coverage scope for ${artifact.kind} artifact ${artifact.id}: no bound character id.`, true);
      }
      return { character_ids: [...bound.characterIds], world: false, global: false };
    }
    case "relationship": {
      const document = parseArtifactValue(artifact) as { document?: { character_ids?: unknown } };
      const raw = Array.isArray(document?.document?.character_ids) ? document.document.character_ids.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
      if (raw.length > 0) return { character_ids: raw, world: false, global: false };
      const bound = artifactBinding(artifact);
      if (bound.characterIds.length === 0) {
        throw new CoreError("COVERAGE_BINDING_SCOPE_INVALID", `Cannot derive a coverage scope for relationship artifact ${artifact.id}: no participant character ids.`, true);
      }
      return { character_ids: [...bound.characterIds], world: false, global: false };
    }
    case "greeting": {
      const bound = artifactBinding(artifact);
      if (bound.characterIds.length > 0) return { character_ids: [...bound.characterIds], world: false, global: false };
      const projection = computeProjectProjection(state).intent;
      const primary = projection.primary_character_id ?? projection.roster[0]?.id;
      if (primary === undefined) {
        throw new CoreError("COVERAGE_BINDING_SCOPE_INVALID", `Cannot derive a coverage scope for greeting artifact ${artifact.id}: no participant or primary character.`, true);
      }
      return { character_ids: [primary], world: false, global: false };
    }
    default:
      throw new CoreError("COVERAGE_BINDING_SCOPE_INVALID", `Artifact ${artifact.id} (${artifact.kind}) is not coverage-sensitive.`, true);
  }
}

export function deriveArtifactScopeResolutionIds(state: ProjectState, artifact: ArtifactRecord, assessment: CoverageAssessment): string[] {
  const scope = deriveArtifactCoverageScope(state, artifact);
  const relevant = assessment.items.filter((item) => {
    if (scope.world) return item.character_id === undefined;
    if (scope.global) return true;
    return item.character_id !== undefined && scope.character_ids.includes(item.character_id);
  });
  const ids = [...new Set(relevant.flatMap((item) => item.resolution_ids))].sort();
  const resolutionsById = new Map(state.coverage_resolutions.map((r) => [r.id, r]));
  for (const id of ids) {
    const resolution = resolutionsById.get(id);
    if (resolution === undefined || resolution.supersedes !== undefined || resolution.requirement_set_revision !== assessment.requirement_set_revision) {
      throw new CoreError("COVERAGE_BINDING_RESOLUTION_INVALID", `Resolution ${id} is not current or not compatible with assessment ${assessment.revision}.`, true);
    }
  }
  return ids;
}

export interface ActiveCoverageBindingProjection {
  entry: BuildPlanEntry;
  artifact: ArtifactRecord;
  status: "current" | "missing" | "stale" | "duplicate";
  binding?: AuthoringCoverageBinding;
  reason?: string;
}

export function projectActiveCoverageBindings(state: ProjectState, plan: BuildPlan): ActiveCoverageBindingProjection[] {
  const artifactsById = new Map(state.artifacts.map((a) => [a.id, a]));
  const assessment = state.coverage_assessments.at(-1);
  const result: ActiveCoverageBindingProjection[] = [];
  for (const entry of plan.entries) {
    if (!isCoverageSensitiveArtifactKind(entry.kind)) continue;
    const artifact = artifactsById.get(entry.artifact_id);
    if (artifact === undefined) continue;
    const byId = state.coverage_authoring_bindings.filter((b) => b.artifact_id === entry.artifact_id);
    if (byId.length === 0) {
      result.push({ entry, artifact, status: "missing" });
      continue;
    }
    const matches = byId.filter((b) => b.artifact_revision === entry.revision);
    if (matches.length > 1) {
      result.push({ entry, artifact, status: "duplicate", reason: `${matches.length} bindings match this artifact revision` });
      continue;
    }
    if (matches.length === 0) {
      result.push({ entry, artifact, status: "stale", binding: byId[0]!, reason: "artifact revision mismatch" });
      continue;
    }
    const binding = matches[0]!;
    if (assessment === undefined || assessment.pass !== "formal") {
      result.push({ entry, artifact, status: "stale", binding, reason: "no current formal assessment" });
      continue;
    }
    if (binding.assessment_id !== assessment.id || binding.assessment_revision !== assessment.revision) {
      result.push({ entry, artifact, status: "stale", binding, reason: "assessment mismatch" });
      continue;
    }
    const reqSet = state.coverage_requirement_sets.find((s) => s.id === assessment.requirement_set_id);
    if (reqSet === undefined || binding.requirement_set_revision !== reqSet.revision) {
      result.push({ entry, artifact, status: "stale", binding, reason: "requirement set mismatch" });
      continue;
    }
    if (binding.fact_projection_revision !== coverageFactProjectionRevision(state)) {
      result.push({ entry, artifact, status: "stale", binding, reason: "fact projection mismatch" });
      continue;
    }
    let expectedResolutionIds: string[];
    try {
      expectedResolutionIds = deriveArtifactScopeResolutionIds(state, artifact, assessment);
    } catch (error) {
      if (error instanceof CoreError && error.code === "COVERAGE_BINDING_RESOLUTION_INVALID") {
        result.push({ entry, artifact, status: "stale", binding, reason: "resolution scope invalid" });
        continue;
      }
      throw error;
    }
    if (expectedResolutionIds.join("\u0000") !== [...binding.resolution_ids].sort().join("\u0000")) {
      result.push({ entry, artifact, status: "stale", binding, reason: "resolution set mismatch" });
      continue;
    }
    const recomputed = authoringBindingHash({
      artifact_id: binding.artifact_id,
      artifact_revision: binding.artifact_revision,
      assessment_id: binding.assessment_id,
      assessment_revision: binding.assessment_revision,
      requirement_set_revision: binding.requirement_set_revision,
      fact_projection_revision: binding.fact_projection_revision,
      ...(binding.fact_review_run_id === undefined ? {} : { fact_review_run_id: binding.fact_review_run_id }),
      resolution_ids: [...binding.resolution_ids].sort(),
    });
    if (recomputed !== binding.input_snapshot_hash) {
      result.push({ entry, artifact, status: "stale", binding, reason: "input snapshot hash mismatch" });
      continue;
    }
    result.push({ entry, artifact, status: "current", binding });
  }
  return result;
}

/**
 * Build immutable CoverageSnapshot for preview/build/publish.
 */
export function buildCoverageSnapshot(state: ProjectState, assessment: CoverageAssessment, plan: BuildPlan): CoverageSnapshot {
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

  const activeBindings = projectActiveCoverageBindings(state, plan)
    .filter((p) => p.status === "current")
    .map((p) => p.binding!.id)
    .sort();

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
