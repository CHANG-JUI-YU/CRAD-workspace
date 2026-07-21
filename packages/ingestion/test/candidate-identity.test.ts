import { describe, expect, it } from "vitest";

import {
  candidateOccurrenceId,
  createCandidateOccurrence,
  materializeCandidateBatch,
  type CandidateBatchMaterializationDraft,
} from "../src/index.js";

const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
const timestamp = "2026-07-18T10:00:00.000Z";

function draft(overrides: Partial<CandidateBatchMaterializationDraft> = {}): CandidateBatchMaterializationDraft {
  return {
    schema_version: 1,
    source_id: "novel",
    source_revision_id: sha("a"),
    chunk_set_id: "set-1",
    chunk_id: "chunk-1",
    chunk_hash: sha("b"),
    job_id: "job-1",
    input_revision: sha("c"),
    candidates: [{
      schema_version: 1,
      subject: "alice",
      predicate: "appearance.hair",
      value: "black",
      classification: "creative_completion",
      confidence: 0.9,
      scope: { character_ids: [], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [],
      rationale: "identity test",
      status: "submitted",
      extensions: {},
    }],
    created_at: timestamp,
    extensions: {},
    ...overrides,
  };
}

describe("candidate identity materialization", () => {
  it("由 trusted actor 與 batch time 產生 deterministic candidate identity", () => {
    const first = materializeCandidateBatch(draft(), "trusted-curator");
    const retry = materializeCandidateBatch(draft(), "trusted-curator");
    expect(retry).toEqual(first);
    expect(first.candidates[0]!.id).toMatch(/^candidate-[a-f0-9]{64}$/u);
    expect(first.candidates[0]).toMatchObject({
      created_by: "trusted-curator",
      created_at: timestamp,
    });
  });

  it("不同 ordinal、語意內容或 chunk 產生不同 candidate identity", () => {
    const base = draft();
    const ordinal = materializeCandidateBatch({
      ...base,
      candidates: [base.candidates[0]!, base.candidates[0]!],
    }, "trusted-curator");
    const changedContent = materializeCandidateBatch(draft({
      candidates: [{ ...base.candidates[0]!, value: "brown" }],
    }), "trusted-curator");
    const changedChunk = materializeCandidateBatch(draft({
      chunk_id: "chunk-2",
      chunk_hash: sha("d"),
    }), "trusted-curator");
    const ids = [
      ordinal.candidates[0]!.id,
      ordinal.candidates[1]!.id,
      changedContent.candidates[0]!.id,
      changedChunk.candidates[0]!.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("occurrence clone 保存 immutable batch/raw identity", () => {
    const batch = materializeCandidateBatch(draft(), "trusted-curator");
    const raw = batch.candidates[0]!;
    const occurrence = createCandidateOccurrence(batch.id, raw);
    expect(occurrence.id).toBe(candidateOccurrenceId(batch.id, raw.id));
    expect(occurrence.extensions).toMatchObject({
      source_candidate_id: raw.id,
      source_batch_id: batch.id,
    });
    expect(batch.candidates[0]).toEqual(raw);
  });
});
