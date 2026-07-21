import {
  conflictSchema,
  factCandidateSchema,
  factEvidenceSchema,
  factSchema,
  type Conflict,
  type ConflictMember,
  type Fact,
  type FactCandidate,
  type FactEvidence,
} from "@card-workspace/schemas";

import { fixtureRevision } from "./source-builder.js";

const timestamp = "2026-07-13T10:00:00.000Z";
const sourceRevision = fixtureRevision("fixture source");
const chunkHash = fixtureRevision("Alice has silver hair.");

type CandidateOverrides = Partial<Omit<FactCandidate, "evidence" | "scope" | "valid_time">> & {
  evidence?: FactEvidence[];
  scope?: Partial<FactCandidate["scope"]>;
  valid_time?: Partial<FactCandidate["valid_time"]>;
};

type FactOverrides = Partial<Omit<Fact, "evidence" | "scope" | "valid_time">> & {
  evidence?: FactEvidence[];
  scope?: Partial<Fact["scope"]>;
  valid_time?: Partial<Fact["valid_time"]>;
};

export function buildFactEvidence(overrides: Partial<FactEvidence> = {}): FactEvidence {
  return factEvidenceSchema.parse({
    id: "evidence-1",
    source_id: "novel",
    source_revision_id: sourceRevision,
    chunk_set_id: "novel-set-1",
    chunk_id: "novel-chunk-1",
    chunk_hash: chunkHash,
    quote: "Alice has silver hair.",
    normalized_character_range: [0, 22],
    normalized_line_range: [1, 1],
    raw_byte_range: [0, 22],
    ...overrides,
  });
}

export function buildFactCandidate(overrides: CandidateOverrides = {}): FactCandidate {
  return factCandidateSchema.parse({
    schema_version: 1,
    id: "candidate-1",
    subject: "alice",
    predicate: "appearance.hair",
    value: "silver",
    classification: "source_fact",
    confidence: 0.95,
    scope: { character_ids: ["alice"], extensions: {}, ...overrides.scope },
    valid_time: { extensions: {}, ...overrides.valid_time },
    evidence: overrides.evidence ?? [buildFactEvidence()],
    status: "pending_review",
    created_by: "fixture-curator",
    created_at: timestamp,
    ...overrides,
  });
}

export function buildFact(overrides: FactOverrides = {}): Fact {
  return factSchema.parse({
    schema_version: 1,
    id: "fact-1",
    subject: "alice",
    predicate: "appearance.hair",
    value: "silver",
    classification: "source_fact",
    confidence: 0.95,
    scope: { character_ids: ["alice"], extensions: {}, ...overrides.scope },
    valid_time: { extensions: {}, ...overrides.valid_time },
    evidence: overrides.evidence ?? [buildFactEvidence()],
    source_tiers: ["official"],
    status: "accepted",
    fact_revision: 1,
    decision_id: "decision-1",
    decision_ids: ["decision-1"],
    created_by: "fixture-curator",
    created_at: timestamp,
    ...overrides,
  });
}

export function buildConflict(
  overrides: Partial<Omit<Conflict, "members" | "scope" | "valid_time">> & {
    members?: ConflictMember[];
    scope?: Partial<Conflict["scope"]>;
    valid_time?: Partial<Conflict["valid_time"]>;
  } = {},
): Conflict {
  return conflictSchema.parse({
    schema_version: 1,
    id: "conflict-1",
    subject: "alice",
    predicate: "appearance.hair",
    scope: { character_ids: ["alice"], extensions: {}, ...overrides.scope },
    valid_time: { extensions: {}, ...overrides.valid_time },
    members: overrides.members ?? [
      { fact_id: "fact-1", source_id: "novel", source_revision_id: sourceRevision, value: "silver" },
      { candidate_id: "candidate-2", source_id: "novel", source_revision_id: sourceRevision, value: "black" },
    ],
    status: "open",
    opened_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  });
}

export function buildFactScenarioFixtures(): {
  exactDuplicate: [FactCandidate, FactCandidate];
  equivalent: [FactCandidate, FactCandidate];
  conflict: Conflict;
  temporal: [Fact, Fact];
  scopeSplit: [Fact, Fact];
} {
  return {
    exactDuplicate: [
      buildFactCandidate({ id: "candidate-exact-a" }),
      buildFactCandidate({ id: "candidate-exact-b" }),
    ],
    equivalent: [
      buildFactCandidate({ id: "candidate-equivalent-a", value: { color: "silver", shade: "pale" } }),
      buildFactCandidate({ id: "candidate-equivalent-b", value: { shade: "pale", color: "silver" } }),
    ],
    conflict: buildConflict(),
    temporal: [
      buildFact({ id: "fact-temporal-a", valid_time: { label: "childhood" } }),
      buildFact({ id: "fact-temporal-b", value: "black", valid_time: { label: "adulthood" } }),
    ],
    scopeSplit: [
      buildFact({ id: "fact-scope-a", scope: { timeline: "canon" } }),
      buildFact({ id: "fact-scope-b", value: "black", scope: { timeline: "alternate" } }),
    ],
  };
}

export function corruptEvidenceFixture(
  kind: "range" | "quote",
): Record<string, unknown> {
  const evidence = buildFactEvidence() as unknown as Record<string, unknown>;
  return kind === "range"
    ? { ...evidence, normalized_character_range: [22, 0] }
    : { ...evidence, quote: "This quote is absent." };
}
