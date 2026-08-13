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
  createEntityMatcher,
  factReferencesEntity,
  internalId,
  type CoverageAssessment,
  type CoverageAssessmentInputSnapshot,
  type CoverageAssessmentItem,
  type CoverageAssessmentItemStatus,
  type CoverageRequirementSet,
  type FactRecord,
  type ProjectState,
} from "@st-workspace/core";
import { candidateOccurrenceForFact, latestDecisionForOccurrence, reviewRunProjectionRevision } from "./fact-projection.js";

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
  return contentHash(canonicalJson({
    facts: state.facts.map((fact) => ({ id: fact.id, status: fact.status, fact_revision: fact.fact_revision ?? 0, coverage_targets: fact.coverage_targets ?? [], suggested_coverage_targets: fact.suggested_coverage_targets ?? [] })),
    runs: state.fact_review_runs.map((run) => ({ id: run.id, status: run.status, candidate_set_revision: run.candidate_set_revision })),
    decisions: state.fact_review_decisions.map((decision) => ({ id: decision.id, decision: decision.decision, candidate_occurrence_id: decision.candidate_occurrence_id })),
  }));
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

function formalItemStatus(state: ProjectState, matcher: ReturnType<typeof createEntityMatcher>, requirementId: string, characterId: string | undefined): { status: CoverageAssessmentItemStatus; acceptedIds: string[] } {
  const definition = coverageRequirementById(requirementId);
  if (definition === undefined) return { status: "missing", acceptedIds: [] };
  const related = requirementFacts(state, matcher, requirementId, characterId);
  if (hasOpenConflict(state, related)) return { status: "conflicted", acceptedIds: [] };
  const satisfied = related.filter((fact) => fact.status === "accepted"
    && currentAcceptedDecision(state, fact)
    && (fact.coverage_targets ?? []).includes(requirementId)
    && provenanceCurrent(state, fact));
  if (satisfied.length >= definition.satisfaction.min_accepted_facts) {
    return { status: "covered_by_source", acceptedIds: satisfied.map((fact) => fact.id) };
  }
  return { status: "missing", acceptedIds: [] };
}

function validateItemStatuses(items: CoverageAssessmentItem[], pass: "initial" | "formal"): void {
  const allowed = pass === "initial" ? COVERAGE_INITIAL_ITEM_STATUSES : COVERAGE_FORMAL_ITEM_STATUSES;
  for (const item of items) {
    if (!allowed.includes(item.status)) {
      throw new CoreError("COVERAGE_ASSESSMENT_INVALID", `Coverage assessment item ${item.requirement_id} uses status ${item.status} which is not allowed for ${pass} assessments.`, true);
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
        resolution_ids: [],
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
      resolution_ids: [],
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
