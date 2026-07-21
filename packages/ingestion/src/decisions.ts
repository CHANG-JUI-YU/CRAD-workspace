import {
  resolutionDecisionSchema,
  reviewDecisionSchema,
  type Conflict,
  type ResolutionDecision,
  type ReviewDecision,
} from "@card-workspace/schemas";

import { explainScopeOverlap, explainValidTimeOverlap } from "./canonical-fact.js";
import { IngestionError } from "./types.js";

function invalid(message: string, cause?: unknown): never {
  throw new IngestionError("FACT_DECISION_INVALID", message, cause);
}

export function validateReviewDecision(input: unknown): ReviewDecision {
  const parsed = reviewDecisionSchema.safeParse(input);
  if (!parsed.success) invalid("review decision schema 無效", parsed.error);
  return parsed.data;
}

function assertKnownFactIds(ids: readonly string[], members: Set<string>, label: string): void {
  for (const id of ids) {
    if (!members.has(id)) invalid(`${label} 引用非 conflict member fact：${id}`);
  }
}

export function validateResolutionDecision(input: unknown, conflict: Conflict): ResolutionDecision {
  const parsed = resolutionDecisionSchema.safeParse(input);
  if (!parsed.success) invalid("conflict resolution schema 無效", parsed.error);
  const decision = parsed.data;
  if (decision.conflict_id !== conflict.id) invalid(`resolution conflict ID 不符：${decision.conflict_id}`);
  const members = new Set(conflict.members.flatMap((member) => member.fact_id === undefined ? [] : [member.fact_id]));
  if (decision.type !== "unresolved" && conflict.members.some((member) => member.candidate_id !== undefined)) {
    invalid("非 unresolved resolution 前必須先將所有 candidate members 審核為 facts");
  }
  assertKnownFactIds(decision.accepted_fact_ids, members, "accepted_fact_ids");
  assertKnownFactIds(decision.rejected_fact_ids, members, "rejected_fact_ids");

  if (decision.type === "choose_one" && decision.accepted_fact_ids.length !== 1) {
    invalid("choose_one 必須恰好採納一個 fact");
  }
  if (decision.type === "supersede" && decision.accepted_fact_ids.length !== 1) {
    invalid("supersede 必須恰好指定一個取代後 fact");
  }
  if (["choose_one", "supersede"].includes(decision.type)) {
    const covered = new Set([...decision.accepted_fact_ids, ...decision.rejected_fact_ids]);
    if (covered.size !== members.size || [...members].some((id) => !covered.has(id))) {
      invalid(`${decision.type} 必須裁決全部 fact members`);
    }
  }
  if (decision.type === "coexist") {
    assertKnownFactIds(decision.accepted_fact_ids, members, "coexist accepted_fact_ids");
    if (decision.accepted_fact_ids.length !== members.size) invalid("coexist 必須採納全部 fact members");
  }
  if (decision.type === "temporal") {
    const ids = decision.temporal_assignments.map((assignment) => assignment.fact_id);
    assertKnownFactIds(ids, members, "temporal_assignments");
    if (new Set(ids).size !== ids.length) invalid("temporal assignment fact ID 不得重複");
    if (ids.length !== members.size) invalid("temporal assignments 必須涵蓋全部 fact members");
    for (let left = 0; left < decision.temporal_assignments.length; left += 1) {
      for (let right = left + 1; right < decision.temporal_assignments.length; right += 1) {
        if (explainValidTimeOverlap(
          decision.temporal_assignments[left]!.valid_time,
          decision.temporal_assignments[right]!.valid_time,
        ).overlaps) invalid("temporal assignments 必須明確不重疊");
      }
    }
  }
  if (decision.type === "scope_split") {
    const ids = decision.scope_assignments.map((assignment) => assignment.fact_id);
    assertKnownFactIds(ids, members, "scope_assignments");
    if (new Set(ids).size !== ids.length) invalid("scope assignment fact ID 不得重複");
    if (ids.length !== members.size) invalid("scope assignments 必須涵蓋全部 fact members");
    for (let left = 0; left < decision.scope_assignments.length; left += 1) {
      for (let right = left + 1; right < decision.scope_assignments.length; right += 1) {
        if (explainScopeOverlap(
          decision.scope_assignments[left]!.scope,
          decision.scope_assignments[right]!.scope,
        ).overlaps) invalid("scope assignments 必須明確不重疊");
      }
    }
  }
  return decision;
}
