import { canonicalJson, computeRevision } from "@card-workspace/project";
import type {
  Conflict,
  ConflictMember,
  ConflictRegister,
  Fact,
  FactCandidate,
  Revision,
} from "@card-workspace/schemas";

import {
  canonicalFactScope,
  canonicalFactValidTime,
  compareFactClaims,
  explainScopeOverlap,
  explainValidTimeOverlap,
  type FactClaim,
} from "./canonical-fact.js";

export interface ClaimSource {
  source_id: string;
  source_revision_id: Revision;
}

export interface ConflictProposal {
  kind: "create_conflict" | "update_conflict";
  conflict: Conflict;
  matched_conflict_ids: string[];
}

function memberOrigin(member: ConflictMember): ["candidate" | "fact", string] {
  return member.candidate_id === undefined
    ? ["fact", member.fact_id!]
    : ["candidate", member.candidate_id];
}

function memberKey(member: ConflictMember): string {
  const [kind, id] = memberOrigin(member);
  return `${kind}:${id}`;
}

export function normalizeConflictMembers(members: readonly ConflictMember[]): ConflictMember[] {
  const byOrigin = new Map<string, ConflictMember>();
  for (const member of members) {
    const key = memberKey(member);
    const previous = byOrigin.get(key);
    if (previous === undefined || canonicalJson(member) < canonicalJson(previous)) {
      byOrigin.set(key, member);
    }
  }
  return [...byOrigin.values()].sort((left, right) => {
    const originOrder = memberKey(left).localeCompare(memberKey(right));
    return originOrder === 0 ? canonicalJson(left).localeCompare(canonicalJson(right)) : originOrder;
  });
}

function sourceForClaim(claim: FactClaim, supplied?: ClaimSource): ClaimSource {
  if (supplied !== undefined) return supplied;
  const evidence = [...claim.evidence].sort((left, right) =>
    `${left.source_id}:${left.source_revision_id}`.localeCompare(`${right.source_id}:${right.source_revision_id}`));
  const first = evidence[0];
  if (first === undefined) {
    throw new TypeError(`無 evidence 的 claim ${claim.id} 需要明確 ClaimSource`);
  }
  return { source_id: first.source_id, source_revision_id: first.source_revision_id };
}

export function conflictMemberForClaim(claim: Fact, source?: ClaimSource): ConflictMember;
export function conflictMemberForClaim(claim: FactCandidate, source?: ClaimSource): ConflictMember;
export function conflictMemberForClaim(claim: FactClaim, source?: ClaimSource): ConflictMember {
  const resolvedSource = sourceForClaim(claim, source);
  if ("fact_revision" in claim) {
    return { fact_id: claim.id, ...resolvedSource, value: claim.value };
  }
  return { candidate_id: claim.id, ...resolvedSource, value: claim.value };
}

function canonicalClaimOrder(left: FactClaim, right: FactClaim): number {
  return canonicalJson({ scope: left.scope, valid_time: left.valid_time, id: left.id })
    .localeCompare(canonicalJson({ scope: right.scope, valid_time: right.valid_time, id: right.id }));
}

function conflictId(subject: string, predicate: string, scope: FactClaim["scope"], validTime: FactClaim["valid_time"]): string {
  const revision = computeRevision({
    subject,
    predicate,
    scope: JSON.parse(canonicalFactScope(scope)) as unknown,
    valid_time: JSON.parse(canonicalFactValidTime(validTime)) as unknown,
  });
  return `conflict-${revision.slice("sha256:".length)}`;
}

function timestampRange(claims: readonly FactClaim[]): { opened: string; updated: string } {
  const timestamps = claims.map((claim) => claim.created_at).sort();
  return { opened: timestamps[0]!, updated: timestamps[timestamps.length - 1]! };
}

function matchingOpenConflicts(candidate: FactCandidate, register: ConflictRegister): Conflict[] {
  return register.conflicts
    .filter((conflict) =>
      conflict.status === "open"
      && conflict.subject === candidate.subject
      && conflict.predicate === candidate.predicate
      && explainScopeOverlap(candidate.scope, conflict.scope).overlaps
      && explainValidTimeOverlap(candidate.valid_time, conflict.valid_time).overlaps)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function proposeCandidateConflict(input: {
  candidate: FactCandidate;
  conflictingFacts: readonly Fact[];
  conflicts: ConflictRegister;
  candidateSource?: ClaimSource;
  factSources?: Readonly<Record<string, ClaimSource>>;
}): ConflictProposal {
  const { candidate, conflictingFacts, conflicts } = input;
  const existing = matchingOpenConflicts(candidate, conflicts);
  const primary = existing[0];
  const claims: FactClaim[] = [candidate, ...conflictingFacts].sort(canonicalClaimOrder);
  const members = normalizeConflictMembers([
    ...existing.flatMap((conflict) => conflict.members),
    conflictMemberForClaim(candidate, input.candidateSource),
    ...conflictingFacts.map((fact) => conflictMemberForClaim(fact, input.factSources?.[fact.id])),
  ]);

  if (members.length < 2) {
    throw new TypeError(`conflict proposal 至少需要兩個不同 origin members：${candidate.id}`);
  }

  const timestamps = timestampRange(claims);
  const scope = primary?.scope ?? claims[0]!.scope;
  const validTime = primary?.valid_time ?? claims[0]!.valid_time;
  const conflict: Conflict = {
    schema_version: 1,
    id: primary?.id ?? conflictId(candidate.subject, candidate.predicate, scope, validTime),
    subject: candidate.subject,
    predicate: candidate.predicate,
    scope,
    valid_time: validTime,
    members,
    status: "open",
    opened_at: primary?.opened_at ?? timestamps.opened,
    updated_at: primary === undefined || primary.updated_at < timestamps.updated ? timestamps.updated : primary.updated_at,
    extensions: primary?.extensions ?? {},
  };
  return {
    kind: primary === undefined ? "create_conflict" : "update_conflict",
    conflict,
    matched_conflict_ids: existing.map((item) => item.id),
  };
}

export function findConflictingFacts(candidate: FactCandidate, facts: readonly Fact[]): Array<{
  fact: Fact;
  comparison: ReturnType<typeof compareFactClaims>;
}> {
  return facts
    .map((fact) => ({ fact, comparison: compareFactClaims(candidate, fact) }))
    .filter(({ comparison }) => comparison.conflict)
    .sort((left, right) => left.fact.id.localeCompare(right.fact.id));
}
