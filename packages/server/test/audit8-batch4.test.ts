import { afterAll, describe, expect, it } from "vitest";
import { contentHash, MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import type { Server } from "node:http";

const now = "2026-08-15T00:00:00.000Z";
const later = "2026-08-16T00:00:00.000Z";

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

async function baseState(repository: MemoryProjectRepository, projectId: string) {
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("character-alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
  }));
}

async function startServer(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await baseState(repository, projectId);
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("unexpected server address");
  }
  return { runtime, repository, url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("Audit 8 Batch 4 - Dashboard pagination sorting and cursor binding (#109/#114)", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterAll(async () => {
    await Promise.allSettled(servers.map((entry) => entry.close()));
  });

  it("returns newest first and issues a next_cursor when more records exist", async () => {
    const entry = await startServer("batch8-facts");
    servers.push(entry);
    const state = await entry.repository.read();
    await entry.repository.commit(state.revision, (current) => ({ ...current, facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is steady.", created_at: later, updated_at: later })] }));
    const response = await fetch(`${entry.url}/workspace/dashboard/facts?limit=1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number; next_cursor?: string };
    expect(body.items.map((item) => item.id)).toEqual(["fact-2"]);
    expect(body.total).toBe(2);
    expect(body.next_cursor).toBeDefined();
    const second = (await (await fetch(`${entry.url}/workspace/dashboard/facts?limit=1&cursor=${encodeURIComponent(body.next_cursor ?? "")}`)).json()) as { items: Array<{ id: string }>; next_cursor?: string };
    expect(second.items.map((item) => item.id)).toEqual(["fact-acc"]);
    expect(second.next_cursor).toBeUndefined();
  });

  it("sorts review runs newest first on the first page", async () => {
    const entry = await startServer("batch8-runs");
    servers.push(entry);
    const state = await entry.repository.read();
    await entry.repository.commit(state.revision, (current) => ({
      ...current,
      fact_review_runs: [...current.fact_review_runs, reviewRun({ id: "run-2", candidate_occurrence_ids: ["occ-2"], created_at: later, completed_at: later })],
    }));
    const response = await fetch(`${entry.url}/workspace/dashboard/fact-review/runs?limit=20`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((item) => item.id)).toEqual(["run-2", "run-1"]);
  });

  it("exposes an authoritative latest review run in the dashboard summary", async () => {
    const entry = await startServer("batch8-latest");
    servers.push(entry);
    const response = await fetch(`${entry.url}/workspace/dashboard/data`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { latest_review_run?: { id: string } };
    expect(body.latest_review_run?.id).toBe("run-1");
  });

  it("rejects a stale cursor with a structured recoverable error", async () => {
    const entry = await startServer("batch8-stale");
    servers.push(entry);
    const state = await entry.repository.read();
    await entry.repository.commit(state.revision, (current) => ({ ...current, facts: [...current.facts, fact({ id: "fact-2", statement: "Alpha is steady.", created_at: later, updated_at: later })] }));
    const first = (await (await fetch(`${entry.url}/workspace/dashboard/facts?limit=1`)).json()) as { next_cursor?: string };
    expect(first.next_cursor).toBeDefined();
    const nextState = await entry.repository.read();
    await entry.repository.commit(nextState.revision, (current) => ({ ...current, sources: [sourceRecord("source-2", "Alpha is serene.")] }));
    const response = await fetch(`${entry.url}/workspace/dashboard/facts?limit=1&cursor=${encodeURIComponent(first.next_cursor ?? "")}`);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { code: string; recoverable: boolean };
    expect(payload.code).toBe("DASHBOARD_CURSOR_STALE");
    expect(payload.recoverable).toBe(true);
  });

  it("renders collection controls with counts and load-more buttons while preserving regressions", async () => {
    const entry = await startServer("batch8-html");
    servers.push(entry);
    const response = await fetch(`${entry.url}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("載入更多");
    expect(html).toContain("目前顯示");
    expect(html).toContain("candidates-more");
    expect(html).toContain("sources-more");
    expect(html).toContain("facts-more");
    expect(html).toContain("runs-more");
    expect(html).toContain("aria-label");
    expect(html).toContain("aria-live");
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("來源適配工作流程");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });
});
