import {
  factCandidateSchema,
  factSchema,
  projectCharacterSchema,
  type FactCandidate,
} from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  buildFactsCoverageReport,
  diagnoseFactCandidateQuality,
} from "../src/index.js";

const timestamp = "2026-07-18T00:00:00.000Z";
const sha = `sha256:${"a".repeat(64)}` as const;

function candidate(id: string, subject: string, dimensions?: FactCandidate["coverage_dimensions"]): FactCandidate {
  return factCandidateSchema.parse({
    schema_version: 1,
    id,
    subject,
    predicate: "character.detail",
    value: `${id} value`,
    classification: "source_fact",
    confidence: 0.9,
    coverage_dimensions: dimensions,
    evidence: [{
      id: `evidence-${id}`,
      source_id: "source",
      source_revision_id: sha,
      chunk_set_id: "set",
      chunk_id: "chunk",
      chunk_hash: sha,
      quote: `${id} value`,
      normalized_character_range: [0, 1],
      normalized_line_range: [1, 1],
    }],
    status: "submitted",
    created_by: "curator",
    created_at: timestamp,
  });
}

function fact(id: string) {
  const source = candidate(`candidate-${id}`, "alice", ["identity"]);
  const factSource = structuredClone(source);
  delete factSource.coverage_dimensions;
  return factSchema.parse({
    ...factSource,
    id,
    status: "accepted",
    source_tiers: ["official"],
    fact_revision: 1,
    decision_id: `decision-${id}`,
    decision_ids: [`decision-${id}`],
  });
}

describe("fact candidate quality", () => {
  it("只拒絕佔據語意或 trusted identity 欄位的明確 marker，不以 ID/substring 誤殺", () => {
    const base = candidate("test-candidate-context", "alice", ["identity"]);
    expect(diagnoseFactCandidateQuality(base)).toEqual([]);
    expect(diagnoseFactCandidateQuality({ ...base, value: "contest winner" })).toEqual([]);
    expect(diagnoseFactCandidateQuality({ ...base, value: { nested: "測試" } })).toMatchObject([
      { code: "CANDIDATE_PLACEHOLDER_FORBIDDEN", path: "value.nested", value: "測試" },
    ]);
    expect(diagnoseFactCandidateQuality({ ...base, created_by: "fixture" })).toMatchObject([
      { path: "created_by", value: "fixture" },
    ]);
  });
});

describe("facts coverage report", () => {
  it("primary 需要六個核心維度加一個替代維度；supporting 需要三個核心維度", () => {
    const characters = [
      projectCharacterSchema.parse({ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }),
      projectCharacterSchema.parse({ id: "bob", display_name: "Bob", mode: "palette", role: "supporting" }),
    ];
    const candidates = [
      candidate("alice-core", "alice", ["identity", "personality", "speech", "habits", "background", "relationships"]),
      candidate("alice-option", "alice", ["appearance"]),
      candidate("bob-core", "bob", ["identity", "personality", "relationships"]),
      candidate("orphan", "alice", ["goals"]),
      candidate("legacy", "bob"),
    ];
    const activeCandidates = new Map(candidates.slice(0, 3).map((item) => [item.id, item]));
    const facts = [fact("alice-core-fact"), fact("alice-option-fact"), fact("bob-core-fact")];
    const report = buildFactsCoverageReport({
      characters,
      facts,
      activeCandidates,
      candidateFactIds: new Map([
        ["alice-core", "alice-core-fact"],
        ["alice-option", "alice-option-fact"],
        ["bob-core", "bob-core-fact"],
        ["orphan", "alice-option-fact"],
      ]),
    });
    expect(report.gate_ready).toBe(true);
    expect(report.characters[0]).toMatchObject({ ready: true, alternative_satisfied: true });
    expect(report.characters[1]).toMatchObject({ ready: true, alternative_satisfied: true });

    const withoutAlternative = buildFactsCoverageReport({
      characters,
      facts,
      activeCandidates: new Map([...activeCandidates].filter(([id]) => id !== "alice-option")),
      candidateFactIds: new Map([["alice-core", "alice-core-fact"], ["bob-core", "bob-core-fact"]]),
    });
    expect(withoutAlternative.gate_ready).toBe(false);
    expect(withoutAlternative.characters[0]).toMatchObject({
      missing_required_dimensions: [],
      alternative_satisfied: false,
      ready: false,
    });
  });

  it("忽略 rejected、creative completion、inactive 與無 dimensions 的 legacy candidates", () => {
    const character = projectCharacterSchema.parse({ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" });
    const active = candidate("active", "alice", ["identity"]);
    const rejected = { ...fact("rejected"), status: "rejected" as const };
    const creativeCandidate = {
      ...candidate("creative", "alice", ["identity"]),
      classification: "creative_completion" as const,
      evidence: [],
      rationale: "Useful prose that is not source-derived",
    };
    const creativeFact = {
      ...fact("creative-fact"),
      classification: "creative_completion" as const,
      evidence: [],
    };
    const report = buildFactsCoverageReport({
      characters: [character],
      facts: [rejected, creativeFact],
      activeCandidates: new Map([[active.id, active], [creativeCandidate.id, creativeCandidate]]),
      candidateFactIds: new Map([[active.id, rejected.id], [creativeCandidate.id, creativeFact.id]]),
    });
    expect(report.characters[0]?.covered_dimensions).toEqual([]);
    expect(report.gate_ready).toBe(false);
  });
});
