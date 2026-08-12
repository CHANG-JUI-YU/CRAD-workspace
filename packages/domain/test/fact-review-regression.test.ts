import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type FactRecord,
  type FactReviewRunRecord,
  type KnowledgeChunk,
  type OperationRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { KnowledgeService } from "../src/index.js";
import { factCandidateRevision } from "../src/fact-policy.js";

const now = new Date().toISOString();

function operation(id: string, kind: string): OperationRecord {
  return { id, kind, request: kind, status: "running", created_at: now, updated_at: now, progress: [] };
}

function candidateFact(id: string, occurrenceId: string, statement: string, extra: Partial<FactRecord> = {}): FactRecord {
  return {
    id,
    candidate_occurrence_id: occurrenceId,
    statement,
    status: "candidate",
    confidence: 0.7,
    source_ids: [],
    evidence: [],
    fact_revision: 1,
    created_at: now,
    updated_at: now,
    created_by: "curator",
    ...extra,
  };
}

function sourceRecord(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `candidate-${id}`,
    title: "official",
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: now,
  };
}

describe("BUG4-03/06 fact review correctness regressions", () => {
  it("A: pages through 120 candidates in three pages without loss or duplication", async () => {
    const repository = new MemoryProjectRepository("fact-paging-120");
    const facts = Array.from({ length: 120 }, (_, index) => {
      const number = index + 1;
      const id = `fact-${String(number).padStart(3, "0")}`;
      const occurrence = `occ-${String(number).padStart(3, "0")}`;
      return candidateFact(id, occurrence, `Character ${number} has trait ${number}.`, {
        subject: `Character ${number}`,
        predicate: "has",
        value: `trait ${number}`,
        classification: "trait",
        coverage: ["personality"],
      });
    });
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-page", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-page", "fact-reviewer-1");

    const page1 = await service.factReviewContext({ limit: 50 });
    expect(page1.candidates).toHaveLength(50);
    expect(page1.next_cursor).toBeDefined();
    await service.applyReviewBatch("op-page", page1.candidates.map((candidate) => ({ candidate_occurrence_id: candidate.candidate_occurrence_id, claim: candidate.statement, decision: "reject" as const, reason: "Not needed for this project.", evidence: [] })), "fact-reviewer-1", "fact-reviewer-1", run.id);

    const page2 = await service.factReviewContext({ cursor: page1.next_cursor, limit: 50 });
    expect(page2.candidates).toHaveLength(50);
    expect(page2.next_cursor).toBeDefined();
    await service.applyReviewBatch("op-page", page2.candidates.map((candidate) => ({ candidate_occurrence_id: candidate.candidate_occurrence_id, claim: candidate.statement, decision: "reject" as const, reason: "Not needed for this project.", evidence: [] })), "fact-reviewer-1", "fact-reviewer-1", run.id);

    const page3 = await service.factReviewContext({ cursor: page2.next_cursor, limit: 50 });
    expect(page3.candidates).toHaveLength(20);
    expect(page3.next_cursor).toBeUndefined();

    const seen = [...page1.candidates, ...page2.candidates, ...page3.candidates].map((candidate) => candidate.candidate_occurrence_id);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
  });

  it("exposes bounded source metadata and local paragraph context for a candidate", async () => {
    const text = [
      "Series overview",
      "Characters",
      "Yukino is calm.",
      "The club meets after school.",
      "Production notes",
    ].join("\n");
    const source = {
      ...sourceRecord("source-context", text),
      title: "Official character page",
      canonical_url: "https://example.test/characters/yukino",
    };
    const chunk: KnowledgeChunk = {
      id: "chunk-context",
      source_id: source.id,
      ordinal: 0,
      text,
      hash: contentHash(text),
      created_at: now,
    };
    const fact = candidateFact("fact-context", "occ-context", "Yukino is calm.", {
      subject: "Yukino",
      predicate: "is",
      value: "calm",
      classification: "trait",
      entity_refs: ["character-1"],
      coverage: ["personality"],
      source_ids: [source.id],
      evidence: ["Yukino is calm."],
      evidence_refs: [{ source_id: source.id, source_revision_id: source.revision, chunk_id: chunk.id, chunk_hash: chunk.hash, quote: "Yukino is calm." }],
    });
    const repository = new MemoryProjectRepository("fact-context");
    await repository.commit(0, (state) => ({
      ...state,
      sources: [source],
      knowledge_chunks: [chunk],
      facts: [fact],
      operations: [operation("op-context", "review")],
    }));
    const service = new KnowledgeService(repository);
    await service.beginFactReviewRun("op-context", "fact-reviewer-1");

    const candidate = (await service.factReviewContext({ limit: 1 })).candidates[0]!;
    const context = candidate.evidence_context?.[0];
    expect(candidate.candidate_occurrence_id).toBe("occ-context");
    expect(candidate.entity_refs).toEqual(["character-1"]);
    expect(candidate.classification).toBe("trait");
    expect(candidate.coverage).toEqual(["personality"]);
    expect(context).toMatchObject({
      source_id: source.id,
      source_title: source.title,
      source_url: source.canonical_url,
      source_revision: source.revision,
      chunk_id: chunk.id,
      section_heading: "Characters",
      paragraph: "Yukino is calm.",
      preceding_context: "Characters",
      following_context: "The club meets after school.",
      evidence_span: { quote: "Yukino is calm." },
    });
    expect(context?.evidence_span?.end).toBeGreaterThan(context?.evidence_span?.start ?? -1);
    expect(JSON.stringify(candidate)).not.toContain("Production notes\n");
  });

  it("B: keeps needs_evidence and conflict candidates visible across pages", async () => {
    const repository = new MemoryProjectRepository("fact-mixed-decisions");
    const facts = [
      candidateFact("fact-b1", "occ-b1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-b2", "occ-b2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-b3", "occ-b3", "Hachiman is blunt.", { subject: "Hachiman", predicate: "is", value: "blunt", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-b4", "occ-b4", "Hachiman is quiet.", { subject: "Hachiman", predicate: "is", value: "quiet", classification: "trait", coverage: ["personality"] }),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-mixed", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-mixed", "fact-reviewer-1");

    const page1 = await service.factReviewContext({ limit: 2 });
    expect(page1.candidates).toHaveLength(2);
    await service.applyReviewBatch("op-mixed", [
      { candidate_occurrence_id: page1.candidates[0]!.candidate_occurrence_id, claim: page1.candidates[0]!.statement, decision: "reject", reason: "Unsupported by the source.", evidence: [] },
      { candidate_occurrence_id: page1.candidates[1]!.candidate_occurrence_id, claim: page1.candidates[1]!.statement, decision: "needs_evidence", reason: "Quote does not cover this claim.", evidence: [] },
    ], "fact-reviewer-1", "fact-reviewer-1", run.id);

    const page2 = await service.factReviewContext({ cursor: page1.next_cursor, limit: 2 });
    expect(page2.candidates).toHaveLength(2);
    await service.applyReviewBatch("op-mixed", [
      { candidate_occurrence_id: page2.candidates[0]!.candidate_occurrence_id, claim: page2.candidates[0]!.statement, decision: "conflict", reason: "Contradicts another accepted fact.", evidence: [] },
      { candidate_occurrence_id: page2.candidates[1]!.candidate_occurrence_id, claim: page2.candidates[1]!.statement, decision: "reject", reason: "Unsupported by the source.", evidence: [] },
    ], "fact-reviewer-1", "fact-reviewer-1", run.id);

    const remaining = await service.factReviewContext();
    expect(remaining.candidates.map((candidate) => candidate.candidate_occurrence_id)).toEqual(["occ-b2", "occ-b3"]);
    expect(remaining.candidates[0]!.last_decision).toBe("needs_evidence");
    expect(remaining.candidates[1]!.last_decision).toBe("conflict");
    const after = await repository.read();
    expect(after.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("blocked");
  });

  it("C: pages candidates by source_id filter with an opaque cursor", async () => {
    const repository = new MemoryProjectRepository("fact-filter-source");
    const facts = [
      ...Array.from({ length: 20 }, (_, index) => candidateFact(`fact-a${String(index + 1).padStart(2, "0")}`, `occ-a${String(index + 1).padStart(2, "0")}`, `Alpha ${index + 1} has trait ${index + 1}.`, { subject: `Alpha ${index + 1}`, predicate: "has", value: `trait ${index + 1}`, classification: "trait", coverage: ["personality"], source_ids: ["source-a"] })),
      ...Array.from({ length: 20 }, (_, index) => candidateFact(`fact-b${String(index + 1).padStart(2, "0")}`, `occ-b${String(index + 1).padStart(2, "0")}`, `Beta ${index + 1} has trait ${index + 1}.`, { subject: `Beta ${index + 1}`, predicate: "has", value: `trait ${index + 1}`, classification: "trait", coverage: ["personality"], source_ids: ["source-b"] })),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-filter-source", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-filter-source", "fact-reviewer-1");

    const page1 = await service.factReviewContext({ source_id: "source-a", limit: 15 });
    expect(page1.candidates).toHaveLength(15);
    expect(page1.candidates[0]!.candidate_occurrence_id).toBe("occ-a01");
    expect(page1.candidates[14]!.candidate_occurrence_id).toBe("occ-a15");
    expect(page1.next_cursor).toBeDefined();
    const page2 = await service.factReviewContext({ source_id: "source-a", cursor: page1.next_cursor });
    expect(page2.candidates.map((candidate) => candidate.candidate_occurrence_id)).toEqual(["occ-a16", "occ-a17", "occ-a18", "occ-a19", "occ-a20"]);
    expect(page2.next_cursor).toBeUndefined();
    expect((await repository.read()).fact_review_runs.find((item) => item.id === run.id)?.status).toBe("open");
  });

  it("D: pages candidates by classification filter with an opaque cursor", async () => {
    const repository = new MemoryProjectRepository("fact-filter-class");
    const facts = [
      ...Array.from({ length: 30 }, (_, index) => candidateFact(`fact-t${String(index + 1).padStart(2, "0")}`, `occ-t${String(index + 1).padStart(2, "0")}`, `Trait ${index + 1} is strong.`, { subject: `Trait ${index + 1}`, predicate: "is", value: "strong", classification: "trait", coverage: ["personality"] })),
      ...Array.from({ length: 30 }, (_, index) => candidateFact(`fact-w${String(index + 1).padStart(2, "0")}`, `occ-w${String(index + 1).padStart(2, "0")}`, `World ${index + 1} is ancient.`, { subject: `World ${index + 1}`, predicate: "is", value: "ancient", classification: "world", coverage: ["world_context"] })),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-filter-class", "review")] }));
    const service = new KnowledgeService(repository);
    await service.beginFactReviewRun("op-filter-class", "fact-reviewer-1");

    const page1 = await service.factReviewContext({ classification: "world", limit: 20 });
    expect(page1.candidates).toHaveLength(20);
    expect(page1.next_cursor).toBeDefined();
    const page2 = await service.factReviewContext({ classification: "world", cursor: page1.next_cursor });
    expect(page2.candidates).toHaveLength(10);
    expect(page2.next_cursor).toBeUndefined();
    const seen = [...page1.candidates, ...page2.candidates].map((candidate) => candidate.candidate_occurrence_id);
    expect(new Set(seen).size).toBe(30);
  });

  it("E: fails closed when a cursor is reused with a different filter", async () => {
    const repository = new MemoryProjectRepository("fact-filter-mismatch");
    const facts = [
      ...Array.from({ length: 12 }, (_, index) => candidateFact(`fact-a${String(index + 1).padStart(2, "0")}`, `occ-a${String(index + 1).padStart(2, "0")}`, `Alpha ${index + 1} has trait ${index + 1}.`, { subject: `Alpha ${index + 1}`, predicate: "has", value: `trait ${index + 1}`, classification: "trait", coverage: ["personality"], source_ids: ["source-a"] })),
      ...Array.from({ length: 12 }, (_, index) => candidateFact(`fact-b${String(index + 1).padStart(2, "0")}`, `occ-b${String(index + 1).padStart(2, "0")}`, `Beta ${index + 1} has trait ${index + 1}.`, { subject: `Beta ${index + 1}`, predicate: "has", value: `trait ${index + 1}`, classification: "trait", coverage: ["personality"], source_ids: ["source-b"] })),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-filter-mismatch", "review")] }));
    const service = new KnowledgeService(repository);
    await service.beginFactReviewRun("op-filter-mismatch", "fact-reviewer-1");

    const page = await service.factReviewContext({ source_id: "source-a", limit: 10 });
    expect(page.next_cursor).toBeDefined();
    await expect(service.factReviewContext({ source_id: "source-b", cursor: page.next_cursor })).rejects.toMatchObject({ code: "FACT_REVIEW_CURSOR_INVALID" });
    await expect(service.factReviewContext({ classification: "trait", cursor: page.next_cursor })).rejects.toMatchObject({ code: "FACT_REVIEW_CURSOR_INVALID" });
    const same = await service.factReviewContext({ source_id: "source-a", cursor: page.next_cursor });
    expect(same.candidates).toHaveLength(2);
  });

  it("F: fails closed when a cursor is reused after the run is superseded", async () => {
    const repository = new MemoryProjectRepository("fact-cursor-superseded");
    const facts = [
      candidateFact("fact-f1", "occ-f1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-f2", "occ-f2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"] }),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-cursor-stale", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-cursor-stale", "fact-reviewer-1");
    const page = await service.factReviewContext({ limit: 1 });
    expect(page.next_cursor).toBeDefined();

    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      facts: state.facts.map((fact) => fact.id === "fact-f1" ? { ...fact, statement: "Yukino is stubborn." } : fact),
    }));
    const successor = await service.beginFactReviewRun("op-cursor-stale", "fact-reviewer-1");
    expect(successor.id).not.toBe(run.id);
    expect((await repository.read()).fact_review_runs.find((item) => item.id === run.id)?.status).toBe("superseded");
    await expect(service.factReviewContext({ cursor: page.next_cursor })).rejects.toMatchObject({ code: "FACT_REVIEW_CURSOR_STALE" });
  });

  it("G: supersedes the run when any candidate field changes and snapshots the new revision", async () => {
    const repository = new MemoryProjectRepository("fact-field-mutation");
    const facts = [
      candidateFact("fact-g1", "occ-g1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"], source_ids: ["source-g"], evidence: ["original evidence"] }),
      candidateFact("fact-g2", "occ-g2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"], source_ids: ["source-g"], evidence: ["original evidence"] }),
    ];
    await repository.commit(0, (state) => ({ ...state, sources: [sourceRecord("source-g", "Yukino is calm and direct.")], facts, operations: [operation("op-mutate", "review")] }));
    const service = new KnowledgeService(repository);
    const run1 = await service.beginFactReviewRun("op-mutate", "fact-reviewer-1");

    const mutations: Array<(fact: FactRecord) => FactRecord> = [
      (fact) => ({ ...fact, statement: "Yukino is stubborn." }),
      (fact) => ({ ...fact, evidence: [...fact.evidence, "extra quote"] }),
      (fact) => ({ ...fact, evidence_refs: [{ source_id: "source-g", source_revision_id: contentHash("source-g"), quote: "Yukino is calm" }] }),
      (fact) => ({ ...fact, evidence_revision: contentHash("changed-revision") }),
      (fact) => ({ ...fact, coverage: ["background"] }),
      (fact) => ({ ...fact, classification: "world" }),
      (fact) => ({ ...fact, predicate: "has", value: "stubborn" }),
    ];
    let previousRun = run1;
    for (const mutate of mutations) {
      await repository.commit((await repository.read()).revision, (state) => ({
        ...state,
        facts: state.facts.map((fact) => fact.id === "fact-g1" ? mutate(fact) : fact),
      }));
      const current = await repository.read();
      const expected = factCandidateRevision(current.facts.find((fact) => fact.id === "fact-g1")!, current.sources);
      const next = await service.beginFactReviewRun("op-mutate", "fact-reviewer-1");
      expect(next.id).not.toBe(previousRun.id);
      expect(next.candidate_set_revision).not.toBe(previousRun.candidate_set_revision);
      expect(next.candidate_revisions?.["occ-g1"]).toBe(expected);
      expect((await repository.read()).fact_review_runs.find((item) => item.id === previousRun.id)?.status).toBe("superseded");
      previousRun = next;
    }
  });

  it("H: rejects a decision submitted after the candidate changed without side effects", async () => {
    const repository = new MemoryProjectRepository("fact-stale-batch");
    const facts = [
      candidateFact("fact-h1", "occ-h1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-h2", "occ-h2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"] }),
    ];
    await repository.commit(0, (state) => ({ ...state, facts, operations: [operation("op-stale-batch", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-stale-batch", "fact-reviewer-1");
    const context = await service.factReviewContext();
    const candidate = context.candidates.find((item) => item.candidate_occurrence_id === "occ-h1")!;

    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      facts: state.facts.map((fact) => fact.id === "fact-h1" ? { ...fact, statement: "Yukino is stubborn." } : fact),
    }));
    await expect(service.applyReviewBatch("op-stale-batch", [{ candidate_occurrence_id: candidate.candidate_occurrence_id, claim: candidate.statement, decision: "reject", reason: "Not needed.", evidence: [] }], "fact-reviewer-1", "fact-reviewer-1", run.id, context.projection_revision)).rejects.toMatchObject({ code: "FACT_REVIEW_CANDIDATE_STALE" });
    const after = await repository.read();
    expect(after.fact_review_decisions).toHaveLength(0);
    expect(after.facts.find((fact) => fact.id === "fact-h1")?.status).toBe("candidate");
    expect(after.operations.find((item) => item.id === "op-stale-batch")?.progress).toHaveLength(0);
  });

  it("I: keeps the same run for a partial review when only settled facts changed", async () => {
    const text = "Yukino is calm.";
    const repository = new MemoryProjectRepository("fact-partial-reuse");
    const facts = [
      candidateFact("fact-i1", "occ-i1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"], source_ids: ["source-i"] }),
      candidateFact("fact-i2", "occ-i2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"], source_ids: ["source-i"] }),
      candidateFact("fact-i3", "occ-i3", "Hachiman is blunt.", { subject: "Hachiman", predicate: "is", value: "blunt", classification: "trait", coverage: ["personality"], source_ids: ["source-i"] }),
    ];
    const chunk: KnowledgeChunk = { id: "chunk-i", source_id: "source-i", ordinal: 0, text, hash: contentHash(text), created_at: now };
    await repository.commit(0, (state) => ({ ...state, sources: [sourceRecord("source-i", text)], knowledge_chunks: [chunk], facts, operations: [operation("op-partial", "review")] }));
    const service = new KnowledgeService(repository);
    const run = await service.beginFactReviewRun("op-partial", "fact-reviewer-1");

    const page1 = await service.factReviewContext({ limit: 1 });
    const first = page1.candidates[0]!;
    const applied = await service.applyReviewBatch("op-partial", [{ candidate_occurrence_id: first.candidate_occurrence_id, claim: first.statement, decision: "accept", reason: "The exact sentence appears in the official source.", evidence: [{ source: "official", quote: first.statement }] }], "fact-reviewer-1", "fact-reviewer-1", run.id, page1.projection_revision);
    expect(applied.status).toBe("completed");
    expect((await repository.read()).facts.find((fact) => fact.id === first.fact_id)?.status).toBe("accepted");

    const run2 = await service.beginFactReviewRun("op-partial", "fact-reviewer-1");
    expect(run2.id).toBe(run.id);
    const after = await repository.read();
    expect(after.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("open");
    const remaining = await service.factReviewContext({ limit: 1 });
    expect(remaining.candidates.map((candidate) => candidate.candidate_occurrence_id)).not.toContain(first.candidate_occurrence_id);
  });

  it("J: supersedes a legacy run without candidate revisions and creates a snapshotted successor", async () => {
    const repository = new MemoryProjectRepository("fact-legacy-run");
    const facts = [
      candidateFact("fact-j1", "occ-j1", "Yukino is calm.", { subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["personality"] }),
      candidateFact("fact-j2", "occ-j2", "Yukino is direct.", { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", coverage: ["personality"] }),
    ];
    const legacyRun: FactReviewRunRecord = {
      schema_version: 1,
      id: "run-legacy",
      candidate_set_revision: contentHash("legacy-set"),
      candidate_occurrence_ids: ["occ-j1", "occ-j2"],
      source_revisions: [],
      policy_revision: contentHash("policy-v1"),
      status: "open",
      created_by: "fact-reviewer-1",
      created_at: now,
    };
    await repository.commit(0, (state) => ({ ...state, facts, fact_review_runs: [legacyRun], operations: [operation("op-legacy", "review")] }));
    const service = new KnowledgeService(repository);
    const next = await service.beginFactReviewRun("op-legacy", "fact-reviewer-1");
    expect(next.id).not.toBe(legacyRun.id);
    const after = await repository.read();
    expect(after.fact_review_runs.find((item) => item.id === legacyRun.id)).toMatchObject({ status: "superseded", successor_run_id: next.id });
    expect(next.candidate_revisions?.["occ-j1"]).toBeDefined();
    expect(next.candidate_revisions?.["occ-j2"]).toBeDefined();
    const jFact = after.facts.find((item) => item.id === "fact-j1")!;
    expect(next.candidate_revisions?.["occ-j1"]).toBe(factCandidateRevision(jFact, []));
  });
});
