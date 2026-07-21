import {
  conflictRegisterSchema,
  factCandidateSchema,
  factRegisterSchema,
  factSchema,
  type ConflictRegister,
  type Fact,
  type FactCandidate,
  type FactEvidence,
  type FactScope,
  type FactValidTime,
  type JsonValue,
} from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  evaluateFactCandidate,
  explainScopeOverlap,
  explainValidTimeOverlap,
  normalizeConflictMembers,
} from "../src/index.js";

const sha = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const timestamp = "2026-07-13T10:00:00.000Z";

function evidence(id = "evidence-1", revision = sha("a"), source = "novel"): FactEvidence {
  return {
    id,
    source_id: source,
    source_revision_id: revision,
    chunk_set_id: "set-1",
    chunk_id: "chunk-1",
    chunk_hash: sha("c"),
    quote: "quoted claim",
    normalized_character_range: [0, 12],
    normalized_line_range: [1, 1],
    extensions: {},
  };
}

function candidate(input: {
  id?: string;
  value?: JsonValue;
  evidence?: FactEvidence[];
  scope?: Partial<FactScope>;
  validTime?: Partial<FactValidTime>;
  subject?: string;
} = {}): FactCandidate {
  return factCandidateSchema.parse({
    schema_version: 1,
    id: input.id ?? "candidate-1",
    subject: input.subject ?? "alice",
    predicate: "appearance.hair",
    value: input.value ?? "black",
    classification: "source_fact",
    confidence: 0.9,
    scope: input.scope,
    valid_time: input.validTime,
    evidence: input.evidence ?? [evidence()],
    status: "pending_review",
    created_by: "curator",
    created_at: timestamp,
  });
}

function fact(input: {
  id?: string;
  value?: JsonValue;
  evidence?: FactEvidence[];
  scope?: Partial<FactScope>;
  validTime?: Partial<FactValidTime>;
  sourceTier?: "official" | "unknown";
  subject?: string;
} = {}): Fact {
  const claim = candidate({
    id: input.id ?? "fact-1",
    value: input.value,
    evidence: input.evidence,
    scope: input.scope,
    validTime: input.validTime,
    subject: input.subject,
  });
  return factSchema.parse({
    ...claim,
    status: "accepted",
    source_tiers: [input.sourceTier ?? "unknown"],
    fact_revision: 1,
    decision_id: "decision-1",
    decision_ids: ["decision-1"],
  });
}

function registers(facts: Fact[], conflicts?: ConflictRegister) {
  return {
    register: factRegisterSchema.parse({ schema_version: 1, revision: sha("d"), facts }),
    conflicts: conflicts ?? conflictRegisterSchema.parse({ schema_version: 1, revision: sha("e"), conflicts: [] }),
  };
}

describe("deterministic fact deduplication", () => {
  it("JSON object key order 不影響 exact match，但 value array order 有語義", () => {
    const existing = fact({ value: { a: 1, b: 2 } });
    const exact = evaluateFactCandidate({
      candidate: candidate({ value: { b: 2, a: 1 } }),
      ...registers([existing]),
    });
    expect(exact.disposition).toBe("exact_duplicate");
    expect(exact.proposal).toEqual({ kind: "reference_existing", fact_id: "fact-1" });

    const ordered = evaluateFactCandidate({
      candidate: candidate({ value: [2, 1] }),
      ...registers([fact({ value: [1, 2] })]),
    });
    expect(ordered.disposition).toBe("conflict");
  });

  it("只有 evidence 不同時提出 merge review，不修改 accepted fact", () => {
    const existing = fact();
    const before = structuredClone(existing);
    const result = evaluateFactCandidate({
      candidate: candidate({ evidence: [evidence("evidence-2")] }),
      ...registers([existing]),
    });
    expect(result.disposition).toBe("deterministic_equivalent");
    expect(result.proposal).toEqual({
      kind: "merge_evidence_review",
      fact_id: "fact-1",
      candidate_id: "candidate-1",
    });
    expect(existing).toEqual(before);
  });

  it("呼叫端 semantic suggestion 只被保存，永不自動合併", () => {
    const suggestion = { target_id: "fact-1", rationale: "可能是別名", score: 0.91 };
    const result = evaluateFactCandidate({
      candidate: candidate({ subject: "bob" }),
      ...registers([fact()]),
      semanticSuggestion: suggestion,
    });
    expect(result.disposition).toBe("semantic_suggestion");
    expect(result.proposal).toEqual({ kind: "review_semantic_suggestion", suggestion });
    expect(result.semantic_suggestion).toBe(suggestion);
  });
});

describe("conservative scope/time conflict detection", () => {
  it("明確不同 scope 或明確不重疊時間不形成 conflict", () => {
    const scoped = evaluateFactCandidate({
      candidate: candidate({ value: "white", scope: { timeline: "timeline-b" } }),
      ...registers([fact({ scope: { timeline: "timeline-a" } })]),
    });
    expect(scoped.disposition).toBe("novel");
    expect(explainScopeOverlap(
      candidate({ scope: { extensions: { continuity: "a" } } }).scope,
      candidate({ scope: { extensions: { continuity: "b" } } }).scope,
    )).toMatchObject({ overlaps: false, certainty: "disjoint" });

    const timed = evaluateFactCandidate({
      candidate: candidate({ value: "white", validTime: { start: "2020-01-01", end: "2020-12-31" } }),
      ...registers([fact({ validTime: { start: "2010-01-01", end: "2010-12-31" } })]),
    });
    expect(timed.disposition).toBe("novel");
    expect(explainValidTimeOverlap(
      candidate({ validTime: { start: "1", end: "2" } }).valid_time,
      candidate({ validTime: { start: "3", end: "4" } }).valid_time,
    )).toMatchObject({ overlaps: false, certainty: "disjoint" });
  });

  it("未知 scope/time 保守視為重疊並留下可解釋 trace", () => {
    const result = evaluateFactCandidate({
      candidate: candidate({ value: "white", validTime: { label: "later" } }),
      ...registers([fact({ validTime: { label: "early era" } })]),
    });
    expect(result.disposition).toBe("conflict");
    expect(result.trace.comparisons[0]?.scope_overlap.certainty).toBe("exact");
    expect(result.trace.comparisons[0]?.time_overlap).toMatchObject({ overlaps: true, certainty: "possible" });
  });
});

describe("conflict proposals", () => {
  it("同 source 新 revision 值改變形成 lineage，source tier 不決勝", () => {
    const result = evaluateFactCandidate({
      candidate: candidate({ value: "white", evidence: [evidence("evidence-new", sha("b"))] }),
      ...registers([fact({ value: "black", sourceTier: "official", evidence: [evidence("evidence-old", sha("a"))] })]),
    });
    expect(result.disposition).toBe("conflict");
    expect(result.trace.lineage).toEqual([{
      source_id: "novel",
      candidate_revision_id: sha("b"),
      target_revision_id: sha("a"),
    }]);
    expect(result.trace.rules).toContain("source tier 不參與 winner 判定");
    expect(result.proposal.kind).toBe("create_conflict");
  });

  it("重複評估 deterministic 更新同一 conflict，members 不重複", () => {
    const incoming = candidate({ value: "white" });
    const state = registers([fact({ value: "black" })]);
    const first = evaluateFactCandidate({ candidate: incoming, ...state });
    expect(first.proposal.kind).toBe("create_conflict");
    if (first.proposal.kind !== "create_conflict") throw new Error("expected conflict proposal");
    const conflictState = conflictRegisterSchema.parse({
      schema_version: 1,
      revision: sha("f"),
      conflicts: [first.proposal.conflict],
    });
    const second = evaluateFactCandidate({ candidate: incoming, ...registers(state.register.facts, conflictState) });
    expect(second.proposal.kind).toBe("update_conflict");
    if (second.proposal.kind !== "update_conflict") throw new Error("expected conflict update");
    expect(second.proposal.conflict.id).toBe(first.proposal.conflict.id);
    expect(second.proposal.conflict.members).toHaveLength(2);
    expect(second.proposal.conflict.members).toEqual(first.proposal.conflict.members);
  });

  it("member normalize 以 candidate/fact origin 去重且固定排序", () => {
    const source = { source_id: "novel", source_revision_id: sha("a"), value: "A" };
    expect(normalizeConflictMembers([
      { fact_id: "fact-2", ...source },
      { candidate_id: "candidate-1", ...source },
      { fact_id: "fact-2", ...source },
    ])).toEqual([
      { candidate_id: "candidate-1", ...source },
      { fact_id: "fact-2", ...source },
    ]);
  });
});
