import type {
  ConflictRegister,
  Fact,
  FactCandidate,
  FactRegister,
  JsonObject,
} from "@card-workspace/schemas";

import { compareFactClaims, type FactComparisonTrace } from "./canonical-fact.js";
import {
  findConflictingFacts,
  proposeCandidateConflict,
  type ClaimSource,
  type ConflictProposal,
} from "./conflicts.js";

export type CandidateDisposition =
  | "exact_duplicate"
  | "deterministic_equivalent"
  | "conflict"
  | "semantic_suggestion"
  | "novel";

export type CandidateProposal =
  | { kind: "reference_existing"; fact_id: string }
  | { kind: "merge_evidence_review"; fact_id: string; candidate_id: string }
  | ConflictProposal
  | { kind: "review_semantic_suggestion"; suggestion: JsonObject }
  | { kind: "review_new_candidate"; candidate_id: string };

export interface CandidateEvaluationTrace {
  comparisons: FactComparisonTrace[];
  rules: string[];
  lineage: FactComparisonTrace["lineage"];
}

export interface CandidateEvaluation {
  disposition: CandidateDisposition;
  trace: CandidateEvaluationTrace;
  proposal: CandidateProposal;
  semantic_suggestion?: JsonObject;
}

export interface EvaluateFactCandidateInput {
  candidate: FactCandidate;
  register: FactRegister;
  conflicts: ConflictRegister;
  semanticSuggestion?: JsonObject;
  candidateSource?: ClaimSource;
  factSources?: Readonly<Record<string, ClaimSource>>;
}

function sortedFacts(register: FactRegister): Fact[] {
  return [...register.facts].sort((left, right) => left.id.localeCompare(right.id));
}

function traceFor(comparisons: FactComparisonTrace[], rules: string[]): CandidateEvaluationTrace {
  const lineage = comparisons.flatMap((comparison) => comparison.lineage).sort((left, right) =>
    `${left.source_id}:${left.candidate_revision_id}:${left.target_revision_id}`
      .localeCompare(`${right.source_id}:${right.candidate_revision_id}:${right.target_revision_id}`));
  return { comparisons, rules, lineage };
}

function withSuggestion(
  evaluation: Omit<CandidateEvaluation, "semantic_suggestion">,
  suggestion: JsonObject | undefined,
): CandidateEvaluation {
  return suggestion === undefined ? evaluation : { ...evaluation, semantic_suggestion: suggestion };
}

export function evaluateFactCandidate(input: EvaluateFactCandidateInput): CandidateEvaluation {
  const facts = sortedFacts(input.register);
  const comparisons = facts.map((fact) => compareFactClaims(input.candidate, fact));
  const exact = comparisons.find((comparison) => comparison.exact_duplicate);
  if (exact !== undefined) {
    return withSuggestion({
      disposition: "exact_duplicate",
      trace: traceFor(comparisons, [`與 fact ${exact.target_id} 的 canonical dimensions 及 evidence 相同`]),
      proposal: { kind: "reference_existing", fact_id: exact.target_id },
    }, input.semanticSuggestion);
  }

  const equivalent = comparisons.find((comparison) => comparison.deterministic_equivalent);
  if (equivalent !== undefined) {
    return withSuggestion({
      disposition: "deterministic_equivalent",
      trace: traceFor(comparisons, [`與 fact ${equivalent.target_id} dimensions 相同但 evidence 不同`, "只提出 evidence merge review，不修改 accepted fact"]),
      proposal: { kind: "merge_evidence_review", fact_id: equivalent.target_id, candidate_id: input.candidate.id },
    }, input.semanticSuggestion);
  }

  const conflicting = findConflictingFacts(input.candidate, facts);
  const alreadyInConflict = input.conflicts.conflicts.some((conflict) =>
    conflict.members.some((member) => member.candidate_id === input.candidate.id));
  if (conflicting.length > 0 || alreadyInConflict) {
    const proposal = proposeCandidateConflict({
      candidate: input.candidate,
      conflictingFacts: conflicting.map(({ fact }) => fact),
      conflicts: input.conflicts,
      ...(input.candidateSource === undefined ? {} : { candidateSource: input.candidateSource }),
      ...(input.factSources === undefined ? {} : { factSources: input.factSources }),
    });
    return withSuggestion({
      disposition: "conflict",
      trace: traceFor(comparisons, [
        "subject/predicate 相同、canonical value 不同，且 scope/time 未證明互斥",
        proposal.kind === "update_conflict" ? `更新既有 conflict ${proposal.conflict.id}` : `提出新 conflict ${proposal.conflict.id}`,
        "source tier 不參與 winner 判定",
      ]),
      proposal,
    }, input.semanticSuggestion);
  }

  if (input.semanticSuggestion !== undefined) {
    return {
      disposition: "semantic_suggestion",
      trace: traceFor(comparisons, ["semantic suggestion 由呼叫端提供；核心不推導、不合併、不裁決"]),
      proposal: { kind: "review_semantic_suggestion", suggestion: input.semanticSuggestion },
      semantic_suggestion: input.semanticSuggestion,
    };
  }

  return {
    disposition: "novel",
    trace: traceFor(comparisons, ["沒有 exact、equivalent 或 deterministic conflict match"]),
    proposal: { kind: "review_new_candidate", candidate_id: input.candidate.id },
  };
}
