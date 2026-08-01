import { describe, expect, it } from "vitest";
import {
  blueprintSchema,
  relationshipsDocumentSchema,
  sourceRecordSchema,
  projectionRangeMappingSchema,
  textLineMapEntrySchema,
  conflictMemberSchema,
  resolutionDecisionSchema,
  chunkProfileSchema,
  chunkSchema,
  chunkSetManifestSchema,
} from "../src/index.js";

const rev = "sha256:" + "a".repeat(64);
const time = "2026-07-20T00:00:00.000Z";

function baseBlueprint() {
  return {
    schema_version: 1,
    project_id: "demo",
    project_kind: "character_card",
    entry_kind: "original",
    purpose: "A card",
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }],
    world: { enabled: true, categories: [] },
    greetings: { enabled: false, character_ids: [] },
    relationships: { enabled: false, character_ids: [], requirements: [], extensions: {} },
    plugins: [],
  };
}

function relationshipBase() {
  const ids = ["alice", "bob"];
  return {
    schema_version: 1,
    team_code: "ABC123",
    character_ids: ids,
    character_summaries: ids.map((character_id) => ({ character_id, summary: "summary" })),
    perspectives: ids.flatMap((source_character_id) => ids.map((target_character_id) => ({ source_character_id, target_character_id, summary: "view" }))),
    groups: [],
    summary: { network_character: "network", inter_group_relations: "relations", stability: "stable", conflict_triggers: [], intimacy_opportunities: [] },
  };
}

function chunkBase() {
  return {
    schema_version: 1,
    id: "chunk-1",
    source_id: "source-1",
    source_revision_id: rev,
    chunk_set_id: "set-1",
    sequence: 0,
    chapter_path: [],
    normalized_character_range: [0, 100],
    normalized_line_range: [1, 5],
    main_range: [20, 80],
    raw_byte_range: [0, 100],
    token_count: 10,
    content_hash: rev,
    content: "content",
  };
}

describe("core schema branch matrix", () => {
  it("rejects blueprint relationship/plugin/roster invariants", () => {
    expect(blueprintSchema.safeParse({ ...baseBlueprint(), project_kind: "worldbook", plugins: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }] }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...baseBlueprint(), characters: [], world: { enabled: false, categories: [] } }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...baseBlueprint(), characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", core_concept: "Lead" }, { id: "alice", display_name: "Alice 2", mode: "zhuji", core_concept: "Lead" }] }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...baseBlueprint(), relationships: { enabled: true, character_ids: ["missing", "alice"], requirements: [], extensions: {} } }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...baseBlueprint(), relationships: { enabled: true, character_ids: ["alice", "alice"], requirements: [], extensions: {} } }).success).toBe(false);
  });

  it("rejects relationship participant, summary, perspective, and group invariants", () => {
    const base = relationshipBase();
    expect(relationshipsDocumentSchema.safeParse({ ...base, character_ids: ["alice", "alice"] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, character_summaries: [...base.character_summaries, { character_id: "nobody", summary: "x" }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, character_summaries: [...base.character_summaries, { character_id: "alice", summary: "duplicate" }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, character_summaries: [{ character_id: "alice", summary: "only" }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, perspectives: [...base.perspectives, { source_character_id: "nobody", target_character_id: "alice", summary: "x" }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, perspectives: [...base.perspectives, { source_character_id: "alice", target_character_id: "bob", summary: "duplicate" }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, perspectives: base.perspectives.filter((item) => !(item.source_character_id === "bob" && item.target_character_id === "bob")) }).success).toBe(false);
    const group = { id: "group", name: "Group", member_ids: ["alice", "alice"], formation_cause: "cause", operating_pattern: "pattern", exclusivity: "exclusive", joining_conditions: "join" };
    expect(relationshipsDocumentSchema.safeParse({ ...base, groups: [group, { ...group, id: "group-2", member_ids: ["alice", "nobody"] }] }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...base, groups: [group, { ...group, id: "group", member_ids: ["alice", "bob"] }] }).success).toBe(false);
  });

  it("rejects source ranges and line-map invariants", () => {
    expect(sourceRecordSchema.safeParse({ id: "source", title: "Source", tier: "primary", current_revision_id: rev, revision_ids: [] }).success).toBe(false);
    expect(sourceRecordSchema.safeParse({ id: "source", title: "Source", tier: "primary", current_chunk_set: { source_revision_id: rev, chunk_set_id: "set" }, revision_ids: [] }).success).toBe(false);
    expect(projectionRangeMappingSchema.safeParse({ normalized_character_range: [3, 2] }).success).toBe(false);
    expect(projectionRangeMappingSchema.safeParse({ normalized_character_range: [0, 1], raw_byte_range: [4, 2] }).success).toBe(false);
    expect(projectionRangeMappingSchema.safeParse({ evidence_kind: "field_projection", normalized_character_range: [0, 1], raw_byte_range: [0, 1] }).success).toBe(false);
    const line = { normalized_line: 1, normalized_character_range: [0, 1], source_character_range: [2, 1], source_byte_range: [0, 1], line_ending: "none" };
    expect(textLineMapEntrySchema.safeParse(line).success).toBe(false);
    expect(textLineMapEntrySchema.safeParse({ ...line, source_character_range: [0, 1], line_ending: "lf" }).success).toBe(false);
    expect(textLineMapEntrySchema.safeParse({ ...line, source_character_range: [0, 1], line_ending: "none", source_line_ending_character_range: [0, 0] }).success).toBe(false);
  });

  it("rejects conflict decisions and member identity invariants", () => {
    expect(conflictMemberSchema.safeParse({ source_id: "source", source_revision_id: rev, value: "x" }).success).toBe(false);
    expect(conflictMemberSchema.safeParse({ fact_id: "fact", candidate_id: "candidate", source_id: "source", source_revision_id: rev, value: "x" }).success).toBe(false);
    const base = { schema_version: 1, id: "decision", conflict_id: "conflict", rationale: "why", actor: "actor", decided_at: time, accepted_fact_ids: [], rejected_fact_ids: [], temporal_assignments: [], scope_assignments: [], extensions: {} };
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "choose_one" }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "supersede" }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "temporal", temporal_assignments: [{ fact_id: "fact", valid_time: {} }] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "scope_split", scope_assignments: [{ fact_id: "fact", scope: { character_ids: [] } }] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "coexist", accepted_fact_ids: ["fact"] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "unresolved", accepted_fact_ids: ["fact"] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "choose_one", accepted_fact_ids: ["fact"], rejected_fact_ids: ["fact"] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "choose_one", accepted_fact_ids: ["fact"], rejected_fact_ids: ["other"], temporal_assignments: [{ fact_id: "fact", valid_time: {} }] }).success).toBe(false);
    expect(resolutionDecisionSchema.safeParse({ ...base, type: "choose_one", accepted_fact_ids: ["fact"], rejected_fact_ids: ["other"], scope_assignments: [{ fact_id: "fact", scope: { character_ids: [] } }] }).success).toBe(false);
  });

  it("rejects chunk overlap and manifest consistency invariants", () => {
    expect(chunkProfileSchema.safeParse({ id: "profile", strategy: "fixed", version: "1", tokenizer_id: "tok", tokenizer_version: "1", target_tokens: 5000, overlap_tokens: 2000 }).success).toBe(false);
    expect(chunkSchema.safeParse({ ...chunkBase(), main_range: [0, 120] }).success).toBe(false);
    expect(chunkSchema.safeParse({ ...chunkBase(), leading_overlap_range: [50, 60] }).success).toBe(false);
    expect(chunkSchema.safeParse({ ...chunkBase(), trailing_overlap_range: [70, 90] }).success).toBe(false);
    const profile = { id: "profile", strategy: "fixed", version: "1", tokenizer_id: "tok", tokenizer_version: "1", target_tokens: 5000, overlap_tokens: 100 };
    expect(chunkSetManifestSchema.safeParse({ schema_version: 1, id: "set", source_id: "source", source_revision_id: rev, normalized_hash: rev, profile, chunk_ids: ["chunk-1", "chunk-1"], chunk_count: 1, total_tokens: 10 }).success).toBe(false);
    expect(chunkSetManifestSchema.safeParse({ schema_version: 1, id: "set", source_id: "source", source_revision_id: rev, normalized_hash: rev, profile, chunk_ids: ["chunk-1"], chunk_count: 2, total_tokens: 10 }).success).toBe(false);
  });
});