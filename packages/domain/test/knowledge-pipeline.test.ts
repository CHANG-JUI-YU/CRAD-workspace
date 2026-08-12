import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type OperationRecord, type SourceRecord } from "@st-workspace/core";
import { KnowledgeService } from "../src/index.js";

function operation(id: string, kind: OperationRecord["kind"] = "knowledge"): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function source(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `candidate-${id}`,
    title: "official",
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: new Date().toISOString(),
  };
}

describe("knowledge pipeline invariants", () => {
  it("keeps candidate occurrence identity stable while evidence revision changes", async () => {
    const repository = new MemoryProjectRepository("knowledge-pipeline-identity");
    const firstSource = source("source-1", "Yukino is direct.");
    await repository.commit(0, (state) => ({ ...state, sources: [firstSource], operations: [operation("op-refresh")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh", "refresh", "fact-curator");
    const first = (await repository.read()).facts[0]!;
    expect(first.candidate_occurrence_id).toMatch(/^candidate_occurrence-/u);
    expect(first.evidence_revision).toMatch(/^[a-f0-9]{64}$/u);

    const secondSource = source("source-1", "Yukino is direct. Yukino is observant.");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, sources: [secondSource], operations: [...state.operations, operation("op-reextract")] }));
    await service.reextract("op-reextract", ["source-1"], "fact-curator");
    const after = await repository.read();
    const direct = after.facts.find((fact) => fact.statement === "Yukino is direct")!;
    expect(direct.candidate_occurrence_id).toBe(first.candidate_occurrence_id);
    expect(direct.evidence_revision).not.toBe(first.evidence_revision);
  });

  it("creates a successor review run when source evidence revisions move", async () => {
    const repository = new MemoryProjectRepository("knowledge-pipeline-successor");
    const firstSource = source("source-1", "Yukino is direct.");
    await repository.commit(0, (state) => ({ ...state, sources: [firstSource], operations: [operation("op-refresh"), operation("op-review-1", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh", "refresh", "fact-curator");
    const firstRun = await service.beginFactReviewRun("op-review-1", "fact-reviewer-1");

    const secondSource = source("source-1", "Yukino is direct. Yukino is observant.");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, sources: [secondSource], operations: [...state.operations, operation("op-review-2", "review")] }));
    const successor = await service.beginFactReviewRun("op-review-2", "fact-reviewer-2");
    expect(successor.id).not.toBe(firstRun.id);
    const after = await repository.read();
    expect(after.fact_review_runs.find((run) => run.id === firstRun.id)).toMatchObject({ status: "superseded", successor_run_id: successor.id });
    expect(successor.source_revisions[0]?.revision).toBe(secondSource.revision);
  });

  it("records an accepted fact revision separately from the candidate revision", async () => {
    const repository = new MemoryProjectRepository("knowledge-pipeline-accepted");
    const official = source("source-1", "Yukino is direct.");
    await repository.commit(0, (state) => ({ ...state, sources: [official], operations: [operation("op-refresh"), operation("op-review", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh", "refresh", "fact-curator");
    const run = await service.beginFactReviewRun("op-review", "fact-reviewer-1");
    const candidate = (await service.factReviewContext()).candidates[0]!;
    await service.applyReviewBatch("op-review", [{
      candidate_occurrence_id: candidate.candidate_occurrence_id,
      claim: candidate.statement,
      decision: "accept",
      reason: "Exact source evidence.",
      evidence: [{ source: official.title, quote: candidate.statement }],
    }], "fact-reviewer-1", "fact-reviewer-1", run.id);
    const fact = (await repository.read()).facts[0]!;
    expect(fact.status).toBe("accepted");
    expect(fact.accepted_fact_revision).toMatch(/^[a-f0-9]{64}$/u);
    expect(fact.evidence_revision).toMatch(/^[a-f0-9]{64}$/u);
  });
});
