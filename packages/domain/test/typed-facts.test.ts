import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  MemoryProjectRepository,
  type ArtifactRecord,
  type FactDecision,
  type FactRecord,
  type KnowledgeChunk,
  type OperationRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { KnowledgeService } from "../src/index.js";

const sourceText = "Yukino is calm.";
const timestamp = new Date().toISOString();

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function blueprint(projectId: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "blueprint", flow: "source_adaptation", characters: [{ id: "character-1", label: "雪之下雪乃", aliases: ["雪乃", "Yukino"] }] });
  const hash = contentHash(content);
  return { id: "blueprint-typed", key: `blueprint:${projectId}`, kind: "blueprint", name: "project-blueprint", content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "director", operation_id: "interview" };
}

function source(): SourceRecord {
  const hash = contentHash(sourceText);
  return { id: "source-typed", candidate_id: "candidate-typed", title: "official", canonical_text: sourceText, original_hash: hash, revision: hash, media_type: "text/plain", created_at: timestamp };
}

function chunk(): KnowledgeChunk {
  return { id: "chunk-typed", source_id: "source-typed", ordinal: 0, text: sourceText, hash: contentHash(sourceText), created_at: timestamp };
}

function candidate(overrides: Partial<FactRecord> = {}): FactRecord {
  return {
    id: "fact-typed",
    candidate_occurrence_id: "occ-typed",
    statement: "Yukino has_trait calm",
    subject: "Yukino",
    predicate: "has_trait",
    value: "calm",
    classification: "trait",
    entity_refs: ["character-1"],
    coverage: ["personality"],
    status: "candidate",
    confidence: 0.9,
    source_ids: ["source-typed"],
    evidence: [sourceText],
    evidence_refs: [{ source_id: "source-typed", source_revision_id: source().revision, chunk_id: "chunk-typed", chunk_hash: chunk().hash, quote: sourceText }],
    fact_revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "fact-curator",
    ...overrides,
  };
}

async function reviewCandidate(fact: FactRecord, decisionPatch: Partial<FactDecision> = {}) {
  const repository = new MemoryProjectRepository(`typed-fact-review-${fact.id}`);
  const state = createProjectState(`typed-fact-review-${fact.id}`);
  state.project_status = "ready";
  state.interview = { ...state.interview, status: "complete", flow: "source_adaptation" };
  state.artifacts = [blueprint(state.project_id)];
  state.sources = [source()];
  state.knowledge_chunks = [chunk()];
  state.facts = [fact];
  state.operations = [operation("op-review", "review")];
  await repository.commit(0, () => state);
  const service = new KnowledgeService(repository);
  const run = await service.beginFactReviewRun("op-review", "fact-reviewer-1");
  const decision: FactDecision = {
    candidate_occurrence_id: fact.candidate_occurrence_id,
    claim: fact.statement,
    decision: "accept",
    reason: "test",
    evidence: [{ source: "official", quote: sourceText }],
    ...decisionPatch,
  };
  await expect(service.applyReviewBatch("op-review", [decision], "fact-reviewer-1", "fact-reviewer-1", run.id)).rejects.toMatchObject({ recoverable: true });
  expect((await repository.read()).facts[0]?.status).toBe("candidate");
}

describe("Agent-first typed fact validation", () => {
  it("rejects URL, markup, fallback predicate, invalid coverage and unknown entity without partial acceptance", async () => {
    await reviewCandidate(candidate({ subject: "https://example.test/page" }));
    await reviewCandidate(candidate({ statement: "<div>Yukino</div> is calm" }));
    await reviewCandidate(candidate({ predicate: "described_by" }));
    await reviewCandidate(candidate({ coverage: ["雪之下雪乃"] }));
    await reviewCandidate(candidate({ entity_refs: ["character-999"] }));
  });

  it("rejects evidence from a stale source revision", async () => {
    await reviewCandidate(candidate(), {
      evidence_refs: [{ source_id: "source-typed", source_revision_id: "stale-revision", chunk_id: "chunk-typed", chunk_hash: chunk().hash, quote: sourceText }],
    });
  });
});
