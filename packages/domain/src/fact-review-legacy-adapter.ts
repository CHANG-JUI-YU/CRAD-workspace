import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  type FactDecision,
  type FactReviewDecisionRecord,
  type FactReviewPassRecord,
  type OperationRecord,
  type ProjectRepository,
} from "@st-workspace/core";
import { candidateOccurrenceForFact } from "./fact-projection.js";
import { factCandidateRevision, normalize, evidenceText } from "./fact-policy.js";

function now(): string { return new Date().toISOString(); }

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

export interface LegacyFactReviewExecutionResult {
  fact_ids: string[];
  status: "completed" | "needs_input";
  summary: string;
}

/**
 * Compatibility-only adapter for persisted v2 fact_review_passes. New review
 * requests must use FactReviewRun/FactReviewDecision and never enter here.
 */
export async function applyLegacyFactReview(
  repository: ProjectRepository,
  operationId: string,
  decisions: FactDecision[],
  actor: string,
  reviewPass?: 1 | 2 | 3,
): Promise<LegacyFactReviewExecutionResult> {
  const initial = await repository.read();
  const operation = initial.operations.find((item) => item.id === operationId);
  if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
  const targetIds: string[] = [];
  for (const decision of decisions) {
    const candidates = decision.fact_id !== undefined
      ? initial.facts.filter((fact) => fact.id === decision.fact_id)
      : initial.facts.filter((fact) => normalize(fact.statement) === normalize(decision.claim) || normalize([fact.subject, fact.predicate, fact.value].filter((item): item is string => item !== undefined).join(" ")) === normalize(decision.claim));
    if (candidates.length !== 1) {
      const reason = candidates.length === 0 ? "no matching fact" : "ambiguous fact claim";
      throw new CoreError("FACT_REVIEW_TARGET_INVALID", `Fact review target is ${reason}: ${decision.fact_id ?? decision.claim}`, true);
    }
    const target = candidates[0]!;
    if (targetIds.includes(target.id)) throw new CoreError("FACT_REVIEW_TARGET_DUPLICATE", `Fact ${target.id} appears more than once in this review`, true);
    targetIds.push(target.id);
  }
  const byId = new Map(decisions.map((decision, index) => [targetIds[index], decision]));
  const summary = `Adjudicated ${targetIds.length} fact candidates.`;
  const inferredPass = reviewPass ?? (/[-_ ]([123])$/u.exec(actor)?.[1] as "1" | "2" | "3" | undefined);
  const pass: 1 | 2 | 3 = inferredPass === "2" ? 2 : inferredPass === "3" ? 3 : 1;
  const decisionsHash = contentHash(canonicalJson(decisions));
  const passRecord: FactReviewPassRecord = { id: internalId("fact_review_pass"), operation_id: operationId, reviewer: actor, pass, fact_ids: targetIds, decisions_hash: decisionsHash, created_at: now() };
  const legacyDecisionRecords: FactReviewDecisionRecord[] = decisions.map((decision, index) => ({
    schema_version: 1,
    id: internalId("fact_review_decision"),
    operation_id: operationId,
    review_run_id: "legacy",
    candidate_occurrence_id: candidateOccurrenceForFact(initial.facts.find((fact) => fact.id === targetIds[index])!),
    ...(targetIds[index] === undefined ? {} : { fact_id: targetIds[index] }),
    reviewer_identity: actor,
    decision: decision.decision === "accept" ? "accepted" : decision.decision === "reject" ? "rejected" : decision.decision === "conflict" ? "conflict" : "needs_evidence",
    reason: decision.reason,
    evidence: [],
    candidate_revision: factCandidateRevision(initial.facts.find((fact) => fact.id === targetIds[index])!, initial.sources),
    expected_projection_revision: contentHash(canonicalJson({ legacy: true, operation_id: operationId, fact_ids: targetIds })),
    created_at: now(),
  }));
  await repository.commit(initial.revision, (current) => ({
    ...current,
    ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
    facts: current.facts.map((fact) => {
      const decision = byId.get(fact.id);
      if (decision === undefined) return fact;
      const status = decision.decision === "accept" ? "accepted" : decision.decision === "reject" ? "rejected" : decision.decision === "conflict" ? "conflict" : "candidate";
      const addedEvidence = decision.evidence.map((evidence) => evidenceText(evidence));
      const decisionId = legacyDecisionRecords.find((record) => record.fact_id === fact.id)?.id;
      return { ...fact, status, evidence: [...new Set([...fact.evidence, ...addedEvidence])], fact_revision: (fact.fact_revision ?? 0) + 1, ...(decisionId === undefined ? {} : { decision_id: decisionId }), updated_at: now() };
    }),
    operations: current.operations.map((item) => item.id === operationId
      ? updateOperation(item, { status: "completed", progress: [...item.progress, ...targetIds.map((id) => ({ item_id: id, status: "completed" as const, message: "Fact review decision applied." }))], result_summary: summary })
      : item),
    audit: [...current.audit, {
      id: internalId("audit"), operation_id: operationId, event: "fact.review.applied", actor, occurred_at: now(), project_revision: current.revision + 1,
      details: { fact_ids: targetIds, decisions: decisions.map((decision) => ({ fact_id: decision.fact_id, claim: decision.claim, decision: decision.decision })), review_pass: pass, decisions_hash: decisionsHash, legacy_adapter: true },
    }],
    fact_review_passes: [...current.fact_review_passes, passRecord],
    fact_review_decisions: [...current.fact_review_decisions, ...legacyDecisionRecords],
  }));
  return { fact_ids: targetIds, status: "completed", summary };
}
