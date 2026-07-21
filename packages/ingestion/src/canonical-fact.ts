import { canonicalJson } from "@card-workspace/project";
import type {
  Fact,
  FactCandidate,
  FactEvidence,
  FactScope,
  FactValidTime,
  JsonValue,
} from "@card-workspace/schemas";

export type FactClaim = Fact | FactCandidate;

export interface OverlapTrace {
  overlaps: boolean;
  certainty: "exact" | "possible" | "disjoint";
  reasons: string[];
}

export interface FactComparisonTrace {
  target_id: string;
  same_subject: boolean;
  same_predicate: boolean;
  same_value: boolean;
  same_scope: boolean;
  same_valid_time: boolean;
  same_evidence: boolean;
  scope_overlap: OverlapTrace;
  time_overlap: OverlapTrace;
  exact_duplicate: boolean;
  deterministic_equivalent: boolean;
  conflict: boolean;
  lineage: Array<{
    source_id: string;
    candidate_revision_id: string;
    target_revision_id: string;
  }>;
}

function canonical(value: unknown): string {
  return canonicalJson(value);
}

export function canonicalFactValue(value: JsonValue): string {
  return canonical(value);
}

export function canonicalFactScope(scope: FactScope): string {
  return canonical({
    ...scope,
    character_ids: [...new Set(scope.character_ids)].sort(),
  });
}

export function canonicalFactValidTime(validTime: FactValidTime): string {
  return canonical(validTime);
}

export function canonicalFactEvidence(evidence: readonly FactEvidence[]): string {
  return canonical([...new Set(evidence.map((item) => canonical(item)))].sort());
}

function explicitScopeDifferences(left: FactScope, right: FactScope): string[] {
  const reasons: string[] = [];
  for (const key of ["world", "timeline", "location"] as const) {
    if (left[key] !== undefined && right[key] !== undefined && left[key] !== right[key]) {
      reasons.push(`${key} 明確不同：${left[key]} / ${right[key]}`);
    }
  }

  if (left.character_ids.length > 0 && right.character_ids.length > 0) {
    const rightCharacters = new Set(right.character_ids);
    if (!left.character_ids.some((id) => rightCharacters.has(id))) {
      reasons.push("character_ids 明確互斥");
    }
  }

  for (const key of Object.keys(left.extensions).filter((key) => key in right.extensions).sort()) {
    if (canonical(left.extensions[key]) !== canonical(right.extensions[key])) {
      reasons.push(`extensions.${key} 明確不同`);
    }
  }
  return reasons;
}

export function explainScopeOverlap(left: FactScope, right: FactScope): OverlapTrace {
  const differences = explicitScopeDifferences(left, right);
  if (differences.length > 0) {
    return { overlaps: false, certainty: "disjoint", reasons: differences };
  }
  if (canonicalFactScope(left) === canonicalFactScope(right)) {
    return { overlaps: true, certainty: "exact", reasons: ["scope canonical form 相同"] };
  }
  return {
    overlaps: true,
    certainty: "possible",
    reasons: ["沒有可證明互斥的 scope 維度；缺失維度保守視為可能重疊"],
  };
}

interface ParsedTimePoint {
  domain: "number" | "date";
  value: number;
}

function parseTimePoint(value: string | undefined): ParsedTimePoint | undefined {
  if (value === undefined) return undefined;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? { domain: "number", value: parsed } : undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : { domain: "date", value: parsed };
}

function isStrictlyBefore(left: ParsedTimePoint | undefined, right: ParsedTimePoint | undefined): boolean {
  return left !== undefined && right !== undefined && left.domain === right.domain && left.value < right.value;
}

export function explainValidTimeOverlap(left: FactValidTime, right: FactValidTime): OverlapTrace {
  if (canonicalFactValidTime(left) === canonicalFactValidTime(right)) {
    return { overlaps: true, certainty: "exact", reasons: ["valid_time canonical form 相同"] };
  }

  const leftEnd = parseTimePoint(left.end);
  const rightStart = parseTimePoint(right.start);
  if (isStrictlyBefore(leftEnd, rightStart)) {
    return {
      overlaps: false,
      certainty: "disjoint",
      reasons: [`左側 end ${left.end} 早於右側 start ${right.start}`],
    };
  }
  const rightEnd = parseTimePoint(right.end);
  const leftStart = parseTimePoint(left.start);
  if (isStrictlyBefore(rightEnd, leftStart)) {
    return {
      overlaps: false,
      certainty: "disjoint",
      reasons: [`右側 end ${right.end} 早於左側 start ${left.start}`],
    };
  }
  return {
    overlaps: true,
    certainty: "possible",
    reasons: ["沒有可解析且可證明分離的時間邊界；未知時間保守視為可能重疊"],
  };
}

function sourceRevisions(claim: FactClaim): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const evidence of claim.evidence) {
    const revisions = result.get(evidence.source_id) ?? new Set<string>();
    revisions.add(evidence.source_revision_id);
    result.set(evidence.source_id, revisions);
  }
  return result;
}

function lineageBetween(candidate: FactClaim, target: FactClaim): FactComparisonTrace["lineage"] {
  const candidateSources = sourceRevisions(candidate);
  const targetSources = sourceRevisions(target);
  const lineage: FactComparisonTrace["lineage"] = [];
  for (const sourceId of [...candidateSources.keys()].filter((id) => targetSources.has(id)).sort()) {
    for (const candidateRevision of [...candidateSources.get(sourceId)!].sort()) {
      for (const targetRevision of [...targetSources.get(sourceId)!].sort()) {
        if (candidateRevision !== targetRevision) {
          lineage.push({
            source_id: sourceId,
            candidate_revision_id: candidateRevision,
            target_revision_id: targetRevision,
          });
        }
      }
    }
  }
  return lineage;
}

export function compareFactClaims(candidate: FactClaim, target: FactClaim): FactComparisonTrace {
  const sameSubject = candidate.subject === target.subject;
  const samePredicate = candidate.predicate === target.predicate;
  const sameValue = canonicalFactValue(candidate.value) === canonicalFactValue(target.value);
  const sameScope = canonicalFactScope(candidate.scope) === canonicalFactScope(target.scope);
  const sameValidTime = canonicalFactValidTime(candidate.valid_time) === canonicalFactValidTime(target.valid_time);
  const sameEvidence = canonicalFactEvidence(candidate.evidence) === canonicalFactEvidence(target.evidence);
  const scopeOverlap = explainScopeOverlap(candidate.scope, target.scope);
  const timeOverlap = explainValidTimeOverlap(candidate.valid_time, target.valid_time);
  const sameDimensions = sameSubject && samePredicate && sameValue && sameScope && sameValidTime;
  return {
    target_id: target.id,
    same_subject: sameSubject,
    same_predicate: samePredicate,
    same_value: sameValue,
    same_scope: sameScope,
    same_valid_time: sameValidTime,
    same_evidence: sameEvidence,
    scope_overlap: scopeOverlap,
    time_overlap: timeOverlap,
    exact_duplicate: sameDimensions && sameEvidence,
    deterministic_equivalent: sameDimensions && !sameEvidence,
    conflict: sameSubject && samePredicate && !sameValue && scopeOverlap.overlaps && timeOverlap.overlaps,
    lineage: lineageBetween(candidate, target),
  };
}
