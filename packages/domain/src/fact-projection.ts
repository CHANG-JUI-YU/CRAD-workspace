import { canonicalJson, contentHash, type FactRecord, type FactReviewDecisionRecord, type FactReviewRunRecord, type SourceRecord } from "@st-workspace/core";
import { evidenceRevision } from "./fact-policy.js";

export function candidateOccurrenceForFact(fact: FactRecord): string {
  return fact.candidate_occurrence_id ?? fact.id;
}
export function factKey(fact: Pick<FactRecord, "statement" | "subject" | "predicate" | "value"> & Partial<Pick<FactRecord, "entity_refs">>): string {
  const structured = [fact.subject, fact.predicate, fact.value, ...(fact.entity_refs ?? [])].filter((value): value is string => value !== undefined).join("|");
  return structured.length > 0 ? structured.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "") : fact.statement.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function mergeFactEvidence(target: FactRecord, extra: FactRecord, sources: readonly SourceRecord[] = []): FactRecord {
  const sourceIds = [...new Set([...(target.source_ids ?? []), ...(extra.source_ids ?? [])])];
  const evidence = [...new Set([...(target.evidence ?? []), ...(extra.evidence ?? [])])];
  const refsByKey = new Map<string, NonNullable<FactRecord["evidence_refs"]>[number]>();
  for (const reference of [...(target.evidence_refs ?? []), ...(extra.evidence_refs ?? [])]) refsByKey.set(`${reference.source_id}:${reference.quote}`, reference);
  const merged = { ...target, source_ids: sourceIds, evidence, ...(refsByKey.size > 0 ? { evidence_refs: [...refsByKey.values()] } : {}) };
  return { ...merged, evidence_revision: evidenceRevision(merged, sources) };
}

export function latestDecisionForOccurrence(decisions: readonly FactReviewDecisionRecord[], runId: string, occurrenceId: string): FactReviewDecisionRecord | undefined {
  return [...decisions].reverse().find((decision) => decision.review_run_id === runId && decision.candidate_occurrence_id === occurrenceId);
}

export function reviewRunProjectionRevision(state: {
  facts: readonly FactRecord[];
  fact_review_decisions: readonly FactReviewDecisionRecord[];
  fact_review_runs?: readonly FactReviewRunRecord[];
}, runId: string): string {
  const run = state.fact_review_runs?.find((candidate) => candidate.id === runId);
  const occurrenceIds = new Set(run?.candidate_occurrence_ids ?? state.fact_review_decisions.filter((decision) => decision.review_run_id === runId).map((decision) => decision.candidate_occurrence_id));
  return contentHash(canonicalJson({
    run_id: runId,
    facts: state.facts.filter((fact) => occurrenceIds.has(candidateOccurrenceForFact(fact))).map((fact) => ({
      id: fact.id,
      candidate_occurrence_id: candidateOccurrenceForFact(fact),
      status: fact.status,
      fact_revision: fact.fact_revision ?? 0,
      evidence_revision: fact.evidence_revision,
    })).sort((left, right) => left.candidate_occurrence_id.localeCompare(right.candidate_occurrence_id)),
    decisions: state.fact_review_decisions.filter((decision) => decision.review_run_id === runId).map((decision) => ({
      id: decision.id,
      candidate_occurrence_id: decision.candidate_occurrence_id,
      decision: decision.decision,
      reviewer_identity: decision.reviewer_identity,
      candidate_revision: decision.candidate_revision,
    })),
  }));
}
