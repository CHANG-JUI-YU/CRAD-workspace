import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

function sourceRecord(id: string, text: string) {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: text,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    provenance_kind: "external_source" as const,
    created_at: now,
  };
}

function precheck(projectId: string) {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "source_adaptation",
      collaboration_mode: "assisted",
      characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }],
      primary_character_id: "alpha",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [
      { subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string) {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({ flow: "source_adaptation", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }], primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
  };
}

function characterArtifact(id: string) {
  return {
    id,
    key: "character:alpha",
    kind: "character",
    name: "Alpha",
    content: JSON.stringify({ kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "", relationships: [], sections: [], provenance: [], extensions: {} } }),
    media_type: "text/markdown",
    content_hash: contentHash(`character-${id}`),
    revision: contentHash(`character-${id}`),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
  };
}

function fact(overrides: Record<string, unknown> = {}) {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    status: "accepted",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "director",
    ...overrides,
  };
}

function reviewRun(status: string, id = "run-1") {
  return {
    id,
    schema_version: 1,
    curation_run_id: "cset-1",
    candidate_set_revision: "cset-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "policy-1",
    status,
    created_by: "reviewer",
    created_at: now,
  };
}

function decision() {
  return {
    id: "dec-1",
    schema_version: 1,
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted",
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    candidate_revision: "cand-1",
    expected_projection_revision: contentHash("projection-1"),
    resulting_fact_revision: 1,
    created_at: now,
  };
}

function operation(id: string, kind: string) {
  return {
    id,
    kind,
    request: kind,
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

async function baseRuntime(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("character-alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit((await repository.read()).revision, (state) => ({
    ...state,
    fact_review_runs: [reviewRun("completed")],
    fact_review_decisions: [decision()],
  }));
  const runtime = new WorkspaceRuntime(repository);
  return { runtime, repository };
}

describe("#109 stable ordering and cursor contract", () => {
  it("returns the newest records on the first page and appends without duplicates across pages", async () => {
    const { runtime, repository } = await baseRuntime("batch4-order");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is patient.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" })],
    }));
    const first = await runtime.dashboardFacts({ limit: 1 });
    expect(first.items.map((item) => item.id)).toEqual(["fact-2"]);
    expect(first.total).toBe(2);
    expect(first.next_cursor).toBeDefined();
    const second = await runtime.dashboardFacts({ limit: 1, cursor: first.next_cursor });
    const seen = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(seen.size).toBe(2);
    expect(second.next_cursor).toBeUndefined();
  });

  it("breaks timestamp ties with the stable id descending", async () => {
    const { runtime, repository } = await baseRuntime("batch4-tie");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      facts: [
        ...current.facts,
        fact({ id: "fact-b", statement: "Alpha is patient.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" }),
        fact({ id: "fact-a", statement: "Alpha is steady.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" }),
      ],
    }));
    const page = await runtime.dashboardFacts({ limit: 2 });
    expect(page.items.map((item) => item.id)).toEqual(["fact-b", "fact-a"]);
  });

  it("rejects a cursor bound to a different collection", async () => {
    const { runtime, repository } = await baseRuntime("batch4-cross");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is steady.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" })],
    }));
    const facts = await runtime.dashboardFacts({ limit: 1 });
    expect(facts.next_cursor).toBeDefined();
    await expect(runtime.dashboardSources({ limit: 1, cursor: facts.next_cursor })).rejects.toMatchObject({ code: "DASHBOARD_CURSOR_INVALID" });
  });

  it("rejects a cursor bound to a different filter", async () => {
    const { runtime, repository } = await baseRuntime("batch4-filter");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is steady.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" })],
    }));
    const filtered = await runtime.dashboardFacts({ limit: 1, filter: { status: "accepted" } });
    expect(filtered.next_cursor).toBeDefined();
    await expect(runtime.dashboardFacts({ limit: 1, cursor: filtered.next_cursor })).rejects.toMatchObject({ code: "DASHBOARD_CURSOR_INVALID" });
  });

  it("reports a stale cursor after the project state changes", async () => {
    const { runtime, repository } = await baseRuntime("batch4-stale");
    const state0 = await repository.read();
    await repository.commit(state0.revision, (current) => ({
      ...current,
      facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is steady.", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" })],
    }));
    const first = await runtime.dashboardFacts({ limit: 1 });
    expect(first.next_cursor).toBeDefined();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      sources: [sourceRecord("source-2", "Alpha is serene.")],
    }));
    await expect(runtime.dashboardFacts({ limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: "DASHBOARD_CURSOR_STALE" });
  });

  it("rejects malformed and legacy cursors", async () => {
    const { runtime } = await baseRuntime("batch4-malformed");
    await expect(runtime.dashboardFacts({ limit: 1, cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "DASHBOARD_CURSOR_INVALID" });
    await expect(runtime.dashboardFacts({ limit: 1, cursor: "cursor:bm90LXN0cmluZ3M=" })).rejects.toMatchObject({ code: "DASHBOARD_CURSOR_INVALID" });
  });

  it("does not mutate the underlying project state arrays when sorting", async () => {
    const { runtime, repository } = await baseRuntime("batch4-nomutate");
    const state = await repository.read();
    const state2 = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      facts: [...current.facts, fact({ id: "fact-2", created_at: "2026-08-16T00:00:00.000Z", updated_at: "2026-08-16T00:00:00.000Z" })],
    }));
    await runtime.dashboardFacts({ limit: 1 });
    const after = await repository.read();
    expect(after.facts.map((item) => item.id)).toEqual(state2.facts.map((item) => item.id).concat(["fact-2"]));
  });
});

describe("#109 authoritative latest review run", () => {
  it("reports undefined with no review runs", async () => {
    const { runtime, repository } = await baseRuntime("batch4-runs-0");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({ ...current, fact_review_runs: [], fact_review_decisions: [] }));
    const summary = await runtime.dashboardSummary();
    expect(summary.latest_review_run).toBeUndefined();
  });

  it("reports the newest run regardless of pagination for 1, 21 and 101 runs", async () => {
    for (const count of [1, 21, 101]) {
      const projectId = `batch4-runs-${count}`;
      const { runtime, repository } = await baseRuntime(projectId);
      const state = await repository.read();
      const runs = Array.from({ length: count - 1 }, (_, index) => reviewRun("completed", `run-extra-${index}`));
      const newest = { ...reviewRun("completed", "run-newest"), created_at: "2026-08-17T00:00:00.000Z" };
      await repository.commit(state.revision, (current) => ({
        ...current,
        fact_review_runs: [...runs, newest],
      }));
      const summary = await runtime.dashboardSummary();
      expect(summary.latest_review_run).toBeDefined();
      expect(summary.latest_review_run!.id).toBe("run-newest");
      const runsPage = await runtime.dashboardReviewRuns({ limit: 20 });
      expect(runsPage.items[0]!.id).toBe("run-newest");
    }
  });
});
