import { describe, expect, it } from "vitest";

import {
  candidateBatchSchema,
  candidateBatchSubmissionDraftSchema,
  candidateStatusSchema,
  chunkProfileSchema,
  chunkSchema,
  conflictSchema,
  conflictMemberSchema,
  factCandidateSchema,
  factCoverageDimensionSchema,
  evidenceLocatorSchema,
  factSchema,
  factStatusSchema,
  ingestionJobSchema,
  ingestionTaskStatusSchema,
  journalEventEnvelopeSchema,
  provenanceIndexSchema,
  provenanceRefSchema,
  resolutionDecisionSchema,
  resolutionTypeSchema,
  sourceManifestSchema,
  extractedTextProjectionSchema,
  sourceRevisionSchema,
  sourceTierSchema,
} from "../src/index.js";

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;
const timestamp = "2026-07-13T10:00:00+08:00";

const evidence = {
  id: "evidence-1",
  source_id: "novel",
  source_revision_id: sha("a"),
  chunk_set_id: "set-1",
  chunk_id: "chunk-1",
  chunk_hash: sha("c"),
  quote: "黑色長髮",
  normalized_character_range: [10, 15],
  normalized_line_range: [2, 2],
};

const candidate = {
  schema_version: 1,
  id: "candidate-1",
  subject: "alice",
  predicate: "appearance.hair",
  value: "黑色長髮",
  classification: "source_fact",
  confidence: 0.95,
  evidence: [evidence],
  status: "pending_review",
  created_by: "fact-curator",
  created_at: timestamp,
};

describe("source schemas", () => {
  it("只接受批准的 source tiers", () => {
    expect(sourceTierSchema.options).toEqual([
      "official",
      "common_fanon",
      "single_author_fanon",
      "user_original",
      "unknown",
    ]);
    expect(sourceTierSchema.safeParse("community").success).toBe(false);
  });

  it("revision 使用 raw bytes SHA-256 並保存 raw/normalized hashes", () => {
    const valid = {
      schema_version: 1,
      source_id: "novel",
      id: sha("a"),
      media_type: "text/plain",
      raw_hash: sha("a"),
      normalized_hash: sha("b"),
      acquired_at: timestamp,
      tier: "official",
      origin: { kind: "local", uri: "C:/books/novel.txt" },
      snapshot: { path: `sources/snapshots/novel/${sha("a")}.txt`, byte_size: 42, raw_hash: sha("a") },
      adapter_id: "plain-text",
      adapter_version: "1",
      normalizer_id: "newline",
      normalizer_version: "1",
    };
    expect(sourceRevisionSchema.parse(valid).normalized_hash).toBe(sha("b"));
    expect(sourceRevisionSchema.safeParse({ ...valid, id: sha("c") }).success).toBe(false);
    expect(sourceRevisionSchema.safeParse({ ...valid, raw_hash: "abc" }).success).toBe(false);
  });

  it("retrieved source 需要完整 URL 與 fetched metadata", () => {
    const base = {
      schema_version: 1,
      source_id: "web-page",
      id: sha("a"),
      media_type: "text/html",
      raw_hash: sha("a"),
      normalized_hash: sha("b"),
      acquired_at: timestamp,
      tier: "official",
      snapshot: { path: "sources/snapshots/web-page/page.html", byte_size: 42, raw_hash: sha("a") },
      adapter_id: "html",
      adapter_version: "1",
      normalizer_id: "newline",
      normalizer_version: "1",
    };
    expect(sourceRevisionSchema.safeParse({ ...base, origin: { kind: "retrieved", uri: "https://example.com" } }).success).toBe(false);
  });

  it("區分 raw snapshot 與 field projection mapping", () => {
    const projection = {
      schema_version: 1,
      id: "projection-1",
      source_id: "novel",
      source_revision_id: sha("a"),
      text: "甲",
      normalized_hash: sha("b"),
      adapter_id: "text",
      adapter_version: "1",
      normalizer_id: "utf8-newline",
      normalizer_version: "1",
      mappings: [{
        evidence_kind: "field_projection",
        normalized_character_range: [0, 1],
        field_path: ["data", "description"],
      }],
    };
    expect(extractedTextProjectionSchema.safeParse(projection).success).toBe(true);
    expect(extractedTextProjectionSchema.safeParse({
      ...projection,
      mappings: [{ ...projection.mappings[0], raw_byte_range: [0, 3] }],
    }).success).toBe(false);
  });
});

describe("chunk and job schemas", () => {
  it("限制 profile target 與 overlap", () => {
    const profile = {
      id: "default",
      strategy: "sliding-window",
      version: "1",
      tokenizer_id: "cl100k-base",
      tokenizer_version: "1",
      target_tokens: 7_500,
      overlap_tokens: 750,
    };
    expect(chunkProfileSchema.safeParse(profile).success).toBe(true);
    expect(chunkProfileSchema.safeParse({ ...profile, target_tokens: 4_999 }).success).toBe(false);
    expect(chunkProfileSchema.safeParse({ ...profile, overlap_tokens: 2_000 }).success).toBe(false);
  });

  it("驗證 sequence、token count、hash refs 與 main/overlap ranges", () => {
    const valid = {
      schema_version: 1,
      id: "chunk-1",
      source_id: "novel",
      source_revision_id: sha("a"),
      chunk_set_id: "set-1",
      sequence: 0,
      normalized_character_range: [0, 100],
      normalized_line_range: [1, 10],
      main_range: [10, 90],
      leading_overlap_range: [0, 10],
      trailing_overlap_range: [90, 100],
      token_count: 50,
      content_hash: sha("c"),
      content: "text",
    };
    expect(chunkSchema.safeParse(valid).success).toBe(true);
    expect(chunkSchema.safeParse({ ...valid, sequence: -1 }).success).toBe(false);
    expect(chunkSchema.safeParse({ ...valid, token_count: 0 }).success).toBe(false);
    expect(chunkSchema.safeParse({ ...valid, leading_overlap_range: [0, 11] }).success).toBe(false);
  });

  it("task 與 job status enums 精確，processing/completed metadata 受約束", () => {
    expect(ingestionTaskStatusSchema.options).toEqual(["pending", "processing", "completed", "failed", "superseded"]);
    const job = {
      schema_version: 1,
      id: "job-1",
      kind: "fact_extraction",
      revision: 0,
      status: "pending",
      source_id: "novel",
      source_revision_id: sha("a"),
      chunk_set_id: "set-1",
      input_revision: sha("d"),
      created_by: "user",
      created_at: timestamp,
      tasks: [{ chunk_id: "chunk-1", chunk_hash: sha("c"), status: "pending", attempt: 0 }],
    };
    expect(ingestionJobSchema.safeParse(job).success).toBe(true);
    expect(ingestionJobSchema.safeParse({ ...job, tasks: [{ ...job.tasks[0], status: "processing" }] }).success).toBe(false);
    expect(ingestionJobSchema.safeParse({
      ...job,
      tasks: [{ ...job.tasks[0], lease: { id: "lease-1", owner: "worker", claimed_at: timestamp, expires_at: timestamp } }],
    }).success).toBe(false);
    expect(ingestionJobSchema.safeParse({ ...job, tasks: [job.tasks[0], job.tasks[0]] }).success).toBe(false);
    expect(ingestionJobSchema.safeParse({ ...job, status: "completed" }).success).toBe(false);
  });
});

describe("fact schemas", () => {
  it("coverage dimensions 使用受控 vocabulary，legacy candidate 仍可讀", () => {
    expect(factCoverageDimensionSchema.options).toEqual([
      "identity", "appearance", "personality", "speech", "habits", "background",
      "relationships", "goals", "abilities", "world_context",
    ]);
    expect(factCandidateSchema.parse(candidate).coverage_dimensions).toBeUndefined();
    expect(factCandidateSchema.parse({
      ...candidate,
      coverage_dimensions: ["appearance", "identity"],
    }).coverage_dimensions).toEqual(["appearance", "identity"]);
    expect(factCandidateSchema.safeParse({ ...candidate, coverage_dimensions: ["unknown"] }).success).toBe(false);
    expect(factCandidateSchema.safeParse({ ...candidate, coverage_dimensions: [] }).success).toBe(false);
  });

  it("candidate batch 必須綁定單一 chunk，且允許空 candidates", () => {
    const batch = {
      schema_version: 1,
      id: "batch-1",
      source_id: "novel",
      source_revision_id: sha("a"),
      chunk_set_id: "set-1",
      chunk_id: "chunk-1",
      chunk_hash: sha("c"),
      job_id: "job-1",
      input_revision: sha("d"),
      candidates: [],
      created_by: "worker",
      created_at: timestamp,
      content_hash: sha("e"),
    };
    expect(candidateBatchSchema.safeParse(batch).success).toBe(true);
    const withoutChunkId: Partial<typeof batch> = { ...batch };
    delete withoutChunkId.chunk_id;
    expect(candidateBatchSchema.safeParse(withoutChunkId).success).toBe(false);
    const withoutChunkHash: Partial<typeof batch> = { ...batch };
    delete withoutChunkHash.chunk_hash;
    expect(candidateBatchSchema.safeParse(withoutChunkHash).success).toBe(false);
  });

  it("evidence 指定完整引用鏈、quote 與 ranges", () => {
    expect(factCandidateSchema.safeParse(candidate).success).toBe(true);
    const incompleteEvidence: Partial<typeof evidence> = { ...evidence };
    delete incompleteEvidence.chunk_id;
    expect(factCandidateSchema.safeParse({ ...candidate, evidence: [incompleteEvidence] }).success).toBe(false);
  });

  it("MCP submission draft 只接受 strict evidence locator，不接受 server-derived 欄位", () => {
    const locator = { id: "evidence-1", quote: "黑色長髮", occurrence: 0, extensions: {} };
    const candidateDraft = { ...candidate } as Record<string, unknown>;
    delete candidateDraft.id;
    delete candidateDraft.created_by;
    delete candidateDraft.created_at;
    expect(evidenceLocatorSchema.safeParse(locator).success).toBe(true);
    expect(evidenceLocatorSchema.safeParse({ ...locator, source_id: "novel" }).success).toBe(false);
    expect(evidenceLocatorSchema.safeParse({ ...locator, normalized_character_range: [10, 15] }).success).toBe(false);

    const draft = {
      schema_version: 1,
      source_id: "novel",
      source_revision_id: sha("a"),
      chunk_set_id: "set-1",
      chunk_id: "chunk-1",
      chunk_hash: sha("c"),
      job_id: "job-1",
      input_revision: sha("d"),
      candidates: [{ ...candidateDraft, evidence: [locator] }],
      created_at: timestamp,
      extensions: {},
    };
    expect(candidateBatchSubmissionDraftSchema.safeParse(draft).success).toBe(true);
    expect(candidateBatchSubmissionDraftSchema.parse({
      ...draft,
      candidates: [{ ...candidateDraft, coverage_dimensions: ["appearance"], evidence: [locator] }],
    }).candidates[0]?.coverage_dimensions).toEqual(["appearance"]);
    expect(candidateBatchSubmissionDraftSchema.safeParse({ ...draft, id: "caller-batch" }).success).toBe(false);
    expect(candidateBatchSubmissionDraftSchema.safeParse({ ...draft, created_by: "caller" }).success).toBe(false);
    for (const identity of ["id", "created_by", "created_at"] as const) {
      expect(candidateBatchSubmissionDraftSchema.safeParse({
        ...draft,
        candidates: [{ ...draft.candidates[0], [identity]: identity === "created_at" ? timestamp : "caller" }],
      }).success).toBe(false);
    }
  });

  it("source fact 與 reasonable inference 需要 evidence，creative completion 需要 rationale", () => {
    expect(factCandidateSchema.safeParse({ ...candidate, evidence: [] }).success).toBe(false);
    expect(factCandidateSchema.safeParse({ ...candidate, classification: "reasonable_inference", evidence: [] }).success).toBe(false);
    expect(factCandidateSchema.safeParse({ ...candidate, classification: "creative_completion", evidence: [] }).success).toBe(false);
    expect(factCandidateSchema.safeParse({ ...candidate, classification: "creative_completion", evidence: [], rationale: "補足互動空白" }).success).toBe(true);
  });

  it("fact/candidate statuses 精確，accepted fact 需要正整數 revision 與 decision reference", () => {
    expect(candidateStatusSchema.options).toEqual(["submitted", "validated", "pending_review", "accepted", "rejected", "superseded", "withdrawn"]);
    expect(factStatusSchema.options).toEqual(["accepted", "rejected", "superseded", "withdrawn"]);
    const fact = {
      ...candidate,
      id: "fact-1",
      status: "accepted",
      source_tiers: ["official"],
      fact_revision: 1,
      decision_id: "decision-1",
      decision_ids: ["decision-1"],
    };
    expect(factSchema.safeParse(fact).success).toBe(true);
    expect(factSchema.safeParse({ ...fact, fact_revision: 0 }).success).toBe(false);
    expect(factSchema.safeParse({ ...fact, decision_ids: ["decision-2"] }).success).toBe(false);
  });
});

describe("conflict, journal and provenance schemas", () => {
  it("conflict member 恰有 candidate_id 或 fact_id，並保留來源 revision/value", () => {
    const base = { source_id: "novel", source_revision_id: sha("a"), value: "A" };
    expect(conflictMemberSchema.safeParse({ ...base, candidate_id: "candidate-1" }).success).toBe(true);
    expect(conflictMemberSchema.safeParse({ ...base, fact_id: "fact-1" }).success).toBe(true);
    expect(conflictMemberSchema.safeParse(base).success).toBe(false);
    expect(conflictMemberSchema.safeParse({ ...base, candidate_id: "candidate-1", fact_id: "fact-1" }).success).toBe(false);
  });

  it("resolution enum 精確且 choose_one 需要採納與未採納 IDs", () => {
    expect(resolutionTypeSchema.options).toEqual(["choose_one", "coexist", "temporal", "scope_split", "unresolved", "supersede"]);
    const decision = {
      schema_version: 1,
      id: "decision-1",
      conflict_id: "conflict-1",
      type: "choose_one",
      accepted_fact_ids: ["fact-1"],
      rejected_fact_ids: ["fact-2"],
      rationale: "採納目前世界線",
      actor: "user",
      decided_at: timestamp,
    };
    expect(resolutionDecisionSchema.safeParse(decision).success).toBe(true);
    expect(resolutionDecisionSchema.safeParse({ ...decision, rejected_fact_ids: [] }).success).toBe(false);
  });

  it("internal objects strict，只有 extensions/payload 接受任意 JSON keys", () => {
    const manifest = { schema_version: 1, revision: sha("a"), sources: [], surprise: true };
    expect(sourceManifestSchema.safeParse(manifest).success).toBe(false);
    expect(provenanceIndexSchema.safeParse({ schema_version: 1, project_id: "demo", revision: sha("a"), nodes: [], edges: [], surprise: true }).success).toBe(false);
    const event = {
      schema_version: 1,
      id: "event-1",
      sequence: 1,
      kind: "fact.accepted",
      aggregate_id: "fact-1",
      actor: "user",
      timestamp,
      payload_hash: sha("e"),
      payload: { vendor: { nested: [1, true, null] } },
    };
    expect(journalEventEnvelopeSchema.parse(event).payload).toEqual(event.payload);
    expect(sourceManifestSchema.parse({ schema_version: 1, revision: sha("a"), sources: [], extensions: { vendor: { x: 1 } } }).extensions).toEqual({ vendor: { x: 1 } });
  });

  it("resolved conflict 需要 decision reference", () => {
    const member = { fact_id: "fact-1", source_id: "novel", source_revision_id: sha("a"), value: "A" };
    const conflict = {
      schema_version: 1,
      id: "conflict-1",
      subject: "alice",
      predicate: "appearance.hair",
      scope: {},
      valid_time: {},
      members: [member, { ...member, fact_id: "fact-2", value: "B" }],
      status: "resolved",
      opened_at: timestamp,
      updated_at: timestamp,
    };
    expect(conflictSchema.safeParse(conflict).success).toBe(false);
  });

  it("作者 kind: fact provenance ref 必須是 stable fact ID", () => {
    expect(provenanceRefSchema.safeParse({ kind: "fact", ref: "fact-1" }).success).toBe(true);
    expect(provenanceRefSchema.safeParse({ kind: "fact", ref: "facts/fact-1" }).success).toBe(false);
    expect(provenanceRefSchema.safeParse({ kind: "fact" }).success).toBe(false);
  });
});
