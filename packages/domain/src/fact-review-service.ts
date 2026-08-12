import {
  contentHash,
  canonicalJson,
  internalId,
  type FactClassification,
  type FactEvidenceReference,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
} from "@st-workspace/core";
import { FACT_REVIEW_POLICY_REVISION, factCandidateRevision } from "./fact-policy.js";
import { candidateOccurrenceForFact, latestDecisionForOccurrence, reviewRunProjectionRevision as canonicalReviewRunProjectionRevision } from "./fact-projection.js";

export interface FactReviewContextOptions {
  cursor?: string;
  limit?: number;
  source_id?: string;
  classification?: FactClassification;
}

export interface FactReviewCandidateView {
  candidate_occurrence_id: string;
  fact_id: string;
  statement: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: FactClassification;
  coverage?: string[];
  status: FactRecord["status"];
  source_ids: string[];
  evidence: string[];
  evidence_refs?: FactEvidenceReference[];
  candidate_revision: string;
  last_decision?: FactReviewDecisionRecord["decision"];
  last_reviewer_identity?: string;
}

export interface FactReviewContextPage {
  run?: FactReviewRunRecord;
  projection_revision?: string;
  candidates: FactReviewCandidateView[];
  next_cursor?: string;
}

export function buildFactReviewContext(state: ProjectState, options: FactReviewContextOptions = {}): FactReviewContextPage {
  const run = [...state.fact_review_runs].reverse().find((candidate) => candidate.status === "open" || candidate.status === "blocked");
  const occurrenceIds = run?.candidate_occurrence_ids ?? state.facts.filter((fact) => fact.status === "candidate").map(candidateOccurrenceForFact);
  const candidates = occurrenceIds.flatMap((occurrenceId): FactReviewCandidateView[] => {
    const fact = state.facts.find((item) => candidateOccurrenceForFact(item) === occurrenceId);
    if (fact === undefined) return [];
    if (options.source_id !== undefined && !fact.source_ids.includes(options.source_id)) return [];
    if (options.classification !== undefined && fact.classification !== options.classification) return [];
    const lastDecision = run === undefined ? undefined : latestDecisionForOccurrence(state.fact_review_decisions, run.id, occurrenceId);
    if (lastDecision?.decision === "accepted" || lastDecision?.decision === "rejected") return [];
    const evidenceRefs = (fact.evidence_refs ?? []).map((reference) => {
      if (reference.chunk_id !== undefined) return reference;
      const chunk = state.knowledge_chunks.find((candidate) => candidate.source_id === reference.source_id && candidate.text.includes(reference.quote));
      return chunk === undefined ? reference : { ...reference, chunk_id: chunk.id, chunk_hash: chunk.hash };
    });
    return [{
      candidate_occurrence_id: occurrenceId,
      fact_id: fact.id,
      statement: fact.statement,
      ...(fact.subject === undefined ? {} : { subject: fact.subject }),
      ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
      ...(fact.value === undefined ? {} : { value: fact.value }),
      ...(fact.classification === undefined ? {} : { classification: fact.classification }),
      ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
      status: fact.status,
      source_ids: fact.source_ids,
      evidence: fact.evidence,
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
      candidate_revision: factCandidateRevision(fact, state.sources),
      ...(lastDecision === undefined ? {} : { last_decision: lastDecision.decision, last_reviewer_identity: lastDecision.reviewer_identity }),
    }];
  });
  const cursorIndex = options.cursor === undefined ? 0 : Number.parseInt(options.cursor.replace(/^index:/u, ""), 10);
  const effectiveCursor = Number.isFinite(cursorIndex) && cursorIndex >= 0 ? cursorIndex : 0;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const page = candidates.slice(effectiveCursor, effectiveCursor + limit);
  const nextCursor = effectiveCursor + page.length < candidates.length ? `index:${effectiveCursor + page.length}` : undefined;
  const base: FactReviewContextPage = run === undefined
    ? { candidates: page }
    : { run, projection_revision: reviewProjectionRevision(state, run.id), candidates: page };
  return nextCursor === undefined ? base : { ...base, next_cursor: nextCursor };
}

export function reviewProjectionRevision(state: ProjectState, runId: string): string {
  return canonicalReviewRunProjectionRevision(state, runId);
}

export interface FactReviewRunPlan {
  readonly run?: FactReviewRunRecord;
  readonly supersede_run_ids: string[];
  readonly inferred_curation_run_id?: string;
}

export function prepareFactReviewRun(state: ProjectState, actor: string, curationRunId?: string): FactReviewRunPlan {
  const pending = state.facts.filter((fact) => fact.status === "candidate");
  const inferredCurationRunId = curationRunId ?? [...state.audit].reverse().find((event) => event.event === "fact.curation.applied" || event.event === "knowledge.refreshed")?.operation_id;
  const sourceRevisions: FactReviewRunRecord["source_revisions"] = state.sources
    .filter((source) => pending.some((fact) => fact.source_ids.includes(source.id)))
    .map((source) => ({ source_id: source.id, revision: source.revision }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  const candidateOccurrenceIds = pending.map(candidateOccurrenceForFact).sort();
  const pendingOccurrenceSet = new Set(candidateOccurrenceIds);
  const activeRuns = [...state.fact_review_runs].reverse().filter((run) => {
    if (run.status !== "open" && run.status !== "blocked") return false;
    if (inferredCurationRunId !== undefined && run.curation_run_id !== inferredCurationRunId) return false;
    return true;
  });
  const openRun = activeRuns.find((run) => {
    if (run.candidate_occurrence_ids.some((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId))) {
      const settled = run.candidate_occurrence_ids.filter((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId));
      const settledDecisions = state.fact_review_decisions.filter((decision) => decision.review_run_id === run.id && settled.includes(decision.candidate_occurrence_id));
      if (settledDecisions.length === 0) return false;
    }
    if (!candidateOccurrenceIds.every((occurrenceId) => run.candidate_occurrence_ids.includes(occurrenceId))) return false;
    return run.source_revisions.every((sourceRevision) => state.sources.some((source) => source.id === sourceRevision.source_id && source.revision === sourceRevision.revision));
  });
  if (openRun !== undefined) return { run: openRun, supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  if (pending.length === 0) return { supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  const candidateSetRevision = contentHash(canonicalJson({
    curation_run_id: inferredCurationRunId,
    candidates: pending.map((fact) => ({ id: candidateOccurrenceForFact(fact), revision: factCandidateRevision(fact, state.sources) })).sort((left, right) => left.id.localeCompare(right.id)),
    source_revisions: sourceRevisions,
  }));
  const existing = state.fact_review_runs.find((run) => run.candidate_set_revision === candidateSetRevision && (inferredCurationRunId === undefined || run.curation_run_id === inferredCurationRunId) && run.status !== "superseded");
  if (existing !== undefined) return { run: existing, supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  const run: FactReviewRunRecord = {
    schema_version: 1,
    id: internalId("fact_review_run"),
    ...(inferredCurationRunId === undefined ? {} : { curation_run_id: inferredCurationRunId }),
    candidate_set_revision: candidateSetRevision,
    candidate_occurrence_ids: candidateOccurrenceIds,
    source_revisions: sourceRevisions,
    policy_revision: FACT_REVIEW_POLICY_REVISION,
    status: "open",
    created_by: actor,
    created_at: new Date().toISOString(),
  };
  return {
    run,
    supersede_run_ids: activeRuns.map((active) => active.id),
    ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }),
  };
}
