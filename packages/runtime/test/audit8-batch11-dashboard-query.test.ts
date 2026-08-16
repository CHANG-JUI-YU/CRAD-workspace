import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, createProjectState } from "@st-workspace/core";
import {
  dashboardArtifact,
  dashboardArtifactHistory,
  dashboardArtifacts,
  dashboardAudit,
  dashboardBuilds,
  dashboardCandidate,
  dashboardCandidates,
  dashboardFacts,
  dashboardIssues,
  dashboardOperation,
  dashboardOperations,
  dashboardPublishes,
  dashboardReviewRun,
  dashboardReviewRuns,
  dashboardReviews,
  dashboardSource,
  dashboardSources,
  dashboardSummary,
} from "../src/index.js";

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
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
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

function characterArtifact() {
  return {
    id: "character-alpha",
    key: "character:alpha",
    kind: "character",
    name: "Alpha",
    content: JSON.stringify({ kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "", relationships: [], sections: [], provenance: [], extensions: {} } }),
    media_type: "text/markdown",
    content_hash: contentHash("character-alpha"),
    revision: contentHash("character-alpha"),
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

function reviewRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    schema_version: 1,
    candidate_set_revision: "cset-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "policy-1",
    status: "completed",
    created_by: "director",
    created_at: now,
    completed_at: now,
    ...overrides,
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
    reviewer_identity: "director",
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
    actor: "director",
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

async function seededRepository(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact()],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    candidates: [{ id: "cand-source-1", title: "Alpha is calm.", status: "approved", domain: "official", official: true, source_revision: contentHash("rev-1"), approved_at: now }],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
  }));
  return repository;
}

describe("Audit 8 Batch 11: dashboard query surface (#112 coverage)", () => {
  it("returns a summary from the repository state", async () => {
    const repository = await seededRepository("batch11-summary");
    const summary = await dashboardSummary({ repository });
    expect(summary.project.project_id).toBe("batch11-summary");
    expect(summary.project.project_name).toBe("雪乃");
    expect(summary.project.revision).toBeGreaterThanOrEqual(0);
    expect(summary.counts.facts).toBeGreaterThanOrEqual(1);
  });

  it("queries artifacts, details and history with and without options", async () => {
    const repository = await seededRepository("batch11-artifacts");
    const deps = { repository };
    const all = await dashboardArtifacts(deps);
    expect(all.items).toHaveLength(2);
    expect(all.total).toBe(2);

    const limited = await dashboardArtifacts(deps, { limit: 1 });
    expect(limited.items).toHaveLength(1);
    expect(limited.total).toBe(2);

    const detail = await dashboardArtifact(deps, "character-alpha");
    expect(detail?.name).toBe("Alpha");
    expect(detail?.revision).toBeDefined();
    const withRevision = await dashboardArtifact(deps, "character-alpha", contentHash("character-alpha"));
    expect(withRevision?.id).toBe("character-alpha");
    expect(await dashboardArtifact(deps, "missing")).toBeUndefined();
    expect(await dashboardArtifact(deps, "character-alpha", "wrong-revision")).toBeUndefined();

    const history = await dashboardArtifactHistory(deps, "character:alpha");
    expect(history.items.length).toBeGreaterThanOrEqual(1);
    const historyById = await dashboardArtifactHistory(deps, "character-alpha");
    expect(historyById.items.length).toBeGreaterThanOrEqual(1);
    const historyQuery = await dashboardArtifactHistory(deps, "character:alpha", { limit: 1 });
    expect(historyQuery.items).toHaveLength(1);
    expect(await dashboardArtifactHistory(deps, "nope")).toMatchObject({ items: [] });
  });

  it("queries facts with defaults and pagination", async () => {
    const repository = await seededRepository("batch11-facts");
    const deps = { repository };
    const all = await dashboardFacts(deps);
    expect(all.items).toHaveLength(1);
    expect(all.items[0]).toMatchObject({ id: "fact-acc", statement: "Alpha is calm." });
    const paged = await dashboardFacts(deps, { limit: 1 });
    expect(paged.items).toHaveLength(1);
  });

  it("queries sources and candidates and resolves details", async () => {
    const repository = await seededRepository("batch11-sources");
    const deps = { repository };
    const sources = await dashboardSources(deps);
    expect(sources.items).toHaveLength(1);
    expect(sources.items[0]).toMatchObject({ id: "source-1", title: "Alpha is calm." });
    const candidates = await dashboardCandidates(deps);
    expect(candidates.items).toHaveLength(1);
    expect((await dashboardSources(deps, { limit: 1 })).items).toHaveLength(1);
    expect((await dashboardCandidates(deps, { limit: 1 })).items).toHaveLength(1);
    const detail = await dashboardSource(deps, "source-1");
    expect(detail?.title).toBe("Alpha is calm.");
    expect(await dashboardSource(deps, "missing")).toBeUndefined();
    const candidate = await dashboardCandidate(deps, "cand-source-1");
    expect(candidate?.id).toBe("cand-source-1");
    expect(await dashboardCandidate(deps, "missing")).toBeUndefined();
  });

  it("queries operations and resolves operation details", async () => {
    const repository = await seededRepository("batch11-operations");
    const deps = { repository };
    const operations = await dashboardOperations(deps);
    expect(operations.items).toHaveLength(2);
    expect(operations.items.map((item) => item.kind).sort()).toEqual(["interview", "review"]);
    const detail = await dashboardOperation(deps, "op-review");
    expect(detail?.kind).toBe("review");
    expect(await dashboardOperation(deps, "missing")).toBeUndefined();
    expect((await dashboardOperations(deps, { limit: 1 })).items).toHaveLength(1);
  });

  it("returns empty pages for unpopulated collections", async () => {
    const repository = await seededRepository("batch11-empty");
    const deps = { repository };
    expect((await dashboardAudit(deps)).items).toEqual([]);
    expect((await dashboardIssues(deps)).items).toEqual([]);
    expect((await dashboardReviews(deps)).items).toEqual([]);
    expect((await dashboardPublishes(deps)).items).toEqual([]);
    expect((await dashboardBuilds(deps)).items).toEqual([]);
    expect((await dashboardAudit(deps, { limit: 5 })).items).toEqual([]);
    expect((await dashboardIssues(deps, { limit: 5 })).items).toEqual([]);
    expect((await dashboardReviews(deps, { limit: 5 })).items).toEqual([]);
    expect((await dashboardPublishes(deps, { limit: 5 })).items).toEqual([]);
    expect((await dashboardBuilds(deps, { limit: 5 })).items).toEqual([]);
  });

  it("queries review runs and resolves review run details", async () => {
    const repository = await seededRepository("batch11-reviews");
    const deps = { repository };
    const runs = await dashboardReviewRuns(deps);
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({ id: "run-1", status: "completed" });
    const detail = await dashboardReviewRun(deps, "run-1");
    expect(detail?.candidate_occurrence_ids).toEqual(["occ-1"]);
    expect(await dashboardReviewRun(deps, "missing")).toBeUndefined();
    expect((await dashboardReviewRuns(deps, { limit: 1 })).items).toHaveLength(1);
  });

  it("works against an empty fresh project state", async () => {
    const repository = new MemoryProjectRepository("batch11-fresh");
    await repository.commit(0, (state) => state);
    const deps = { repository };
    const summary = await dashboardSummary(deps);
    expect(summary.project.project_id).toBe("batch11-fresh");
    expect(summary.project.revision).toBeGreaterThanOrEqual(0);
    expect((await dashboardArtifacts(deps)).items).toEqual([]);
    expect((await dashboardFacts(deps)).items).toEqual([]);
    expect((await dashboardSources(deps)).items).toEqual([]);
    expect((await dashboardOperations(deps)).items).toEqual([]);
    expect((await dashboardArtifact(deps, "anything"))).toBeUndefined();
    expect(createProjectState("batch11-fresh-2").project_id).toBe("batch11-fresh-2");
  });
});
