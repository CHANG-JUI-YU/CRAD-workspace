import type {
  AuthoringUnresolvedFactReviewContext,
  FactRecord,
  FactReviewDecisionRecord,
  ProjectState,
} from "@st-workspace/core";

function candidateOccurrenceId(fact: FactRecord): string {
  return fact.candidate_occurrence_id ?? fact.id;
}

function latestDecisionForFact(state: ProjectState, fact: FactRecord): FactReviewDecisionRecord | undefined {
  const occurrenceId = candidateOccurrenceId(fact);
  return [...state.fact_review_decisions].reverse().find((decision) =>
    decision.fact_id === fact.id || decision.candidate_occurrence_id === occurrenceId,
  );
}

export function unresolvedFactReviewContext(
  state: ProjectState,
  unresolvedFacts: readonly FactRecord[],
): AuthoringUnresolvedFactReviewContext[] {
  return unresolvedFacts.map((fact) => {
    const latestDecision = latestDecisionForFact(state, fact);
    const stateKind: AuthoringUnresolvedFactReviewContext["state"] = fact.status === "conflict"
      ? "conflict"
      : latestDecision?.decision === "needs_evidence"
        ? "needs_evidence"
        : "pending_review";
    return {
      fact_id: fact.id,
      candidate_occurrence_id: candidateOccurrenceId(fact),
      state: stateKind,
      ...(latestDecision === undefined ? {} : {
        latest_decision: {
          id: latestDecision.id,
          review_run_id: latestDecision.review_run_id,
          reviewer_identity: latestDecision.reviewer_identity,
          decision: latestDecision.decision,
          reason: latestDecision.reason,
          created_at: latestDecision.created_at,
        },
      }),
    };
  });
}
