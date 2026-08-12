import { canonicalJson, contentHash, internalId, type FactClaim, type FactRecord, type SourceRecord } from "@st-workspace/core";
import { evidenceRevision, evidenceText, sourceMatches, structureSentence, coverageForClassification } from "./fact-policy.js";
import { factKey, mergeFactEvidence } from "./fact-projection.js";

function now(): string { return new Date().toISOString(); }

export interface CandidateMergeResult {
  readonly facts: FactRecord[];
  readonly mergedFacts: Map<string, FactRecord>;
  readonly mergedCount: number;
}

export function candidateOccurrenceId(sourceId: string, sourceRevision: string, statement: string, ordinal: number): string {
  return `candidate_occurrence-${contentHash(canonicalJson({ source_id: sourceId, source_revision: sourceRevision, statement, ordinal })).slice(0, 32)}`;
}

export function claimOccurrenceId(claim: FactClaim, sources: readonly SourceRecord[]): string {
  const sourceRevisions = claim.evidence.flatMap((evidence) => sources.filter((source) => sourceMatches(source, evidence.source)).map((source) => ({ id: source.id, revision: source.revision })));
  return `candidate_occurrence-${contentHash(canonicalJson({ claim: { subject: claim.subject, predicate: claim.predicate, value: claim.value, classification: claim.classification }, source_revisions: sourceRevisions })).slice(0, 32)}`;
}

export function factFromSentence(source: SourceRecord, statement: string, actor: string, ordinal: number, curationRunId?: string): FactRecord {
  const structured = structureSentence(source.title, statement);
  const fact: FactRecord = {
    id: internalId("fact"),
    candidate_occurrence_id: candidateOccurrenceId(source.id, source.revision, statement, ordinal),
    statement,
    ...structured,
    coverage: coverageForClassification(structured.classification ?? "other"),
    status: "candidate",
    confidence: 0.7,
    source_ids: [source.id],
    evidence: [statement],
    evidence_refs: [{ source_id: source.id, source_revision_id: source.revision, quote: statement }],
    fact_revision: 1,
    created_at: now(),
    updated_at: now(),
    created_by: actor,
    evidence_revision: evidenceRevision({ source_ids: [source.id], evidence: [statement], evidence_refs: [{ source_id: source.id, source_revision_id: source.revision, quote: statement }] }, [source]),
    ...(curationRunId === undefined ? {} : { curation_run_id: curationRunId }),
  };
  return fact;
}

export function claimToFact(claim: FactClaim, sourceRecords: readonly SourceRecord[], actor: string, curationRunId?: string): FactRecord {
  const statement = `${claim.subject} ${claim.predicate} ${claim.value}`.trim();
  const sourceIds = [...new Set(claim.evidence.flatMap((item) => sourceRecords.filter((source) => sourceMatches(source, item.source)).map((source) => source.id)))];
  const fact: FactRecord = {
    id: internalId("fact"),
    candidate_occurrence_id: claimOccurrenceId(claim, sourceRecords),
    statement,
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.value,
    classification: claim.classification,
    coverage: claim.coverage,
    status: "candidate",
    confidence: claim.confidence,
    source_ids: sourceIds,
    evidence: claim.evidence.map((evidence) => evidenceText(evidence)),
    fact_revision: 1,
    created_at: now(),
    updated_at: now(),
    created_by: actor,
    ...(curationRunId === undefined ? {} : { curation_run_id: curationRunId }),
  };
  return { ...fact, evidence_revision: evidenceRevision(fact, sourceRecords) };
}

export function mergeFactCandidates(existingFacts: readonly FactRecord[], candidates: readonly FactRecord[], sources: readonly SourceRecord[]): CandidateMergeResult {
  const existingByKey = new Map(existingFacts.map((fact) => [factKey(fact), fact]));
  const newByKey = new Map<string, FactRecord>();
  const mergedFacts = new Map<string, FactRecord>();
  let mergedCount = 0;
  for (const candidate of candidates) {
    const key = factKey(candidate);
    const existing = existingByKey.get(key);
    if (existing !== undefined) {
      const currentTarget = mergedFacts.get(existing.id) ?? existing;
      const merged = mergeFactEvidence(currentTarget, candidate, sources);
      const hasNewEvidence = merged.source_ids.length > currentTarget.source_ids.length
        || merged.evidence.length > currentTarget.evidence.length
        || (merged.evidence_refs?.length ?? 0) > (currentTarget.evidence_refs?.length ?? 0)
        || merged.evidence_revision !== currentTarget.evidence_revision;
      if (hasNewEvidence) {
        const base = {
          ...merged,
          fact_revision: (currentTarget.fact_revision ?? 1) + 1,
          updated_at: now(),
          status: existing.status === "accepted" ? "candidate" as const : existing.status,
        };
        const { accepted_fact_revision: _acceptedRevision, ...withoutAcceptedRevision } = base;
        mergedFacts.set(existing.id, {
          ...(existing.status === "accepted" ? withoutAcceptedRevision : base),
        });
        mergedCount += 1;
      }
      continue;
    }
    const existingInBatch = newByKey.get(key);
    if (existingInBatch !== undefined) {
      newByKey.set(key, { ...mergeFactEvidence(existingInBatch, candidate, sources), updated_at: now() });
      continue;
    }
    newByKey.set(key, candidate);
  }
  return { facts: [...newByKey.values()], mergedFacts, mergedCount };
}
