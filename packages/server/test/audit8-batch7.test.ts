import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import { contentHash, MemoryProjectRepository, type ImageRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

const now = "2026-08-17T00:00:00.000Z";

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function sourceRecord(id: string, text: string) {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: `Source ${id}`,
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
      characters: [
        { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
      ],
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
    content: JSON.stringify({ schema_version: 1, characters: [{ id: "alpha", mode: "zhuji" }], primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    operation_id: "op-author",
    created_at: now,
    updated_at: now,
    created_by: "director",
  };
}

function characterArtifact(id: string) {
  return {
    id,
    key: `character:${id}`,
    kind: "character",
    name: `Character ${id}`,
    content: JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: id, aliases: [], summary: "", relationships: [], sections: [], provenance: [], extensions: {} } }),
    media_type: "text/markdown",
    content_hash: contentHash(id),
    revision: contentHash(id),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
    operation_id: "op-author",
    created_at: now,
    updated_at: now,
    created_by: "director",
  };
}

function fact() {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    coverage: ["personality"],
    status: "accepted",
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [
      { source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." },
    ],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "researcher",
  };
}

function reviewRun() {
  return {
    id: "run-1",
    schema_version: 1,
    curation_run_id: "curation-1",
    candidate_set_revision: contentHash("cset-1"),
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: contentHash("policy-1"),
    status: "completed",
    created_by: "director",
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
    reviewer_identity: "reviewer",
    decision: "accepted",
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

function image(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id,
    character_id: "alpha",
    blob_hash: contentHash(`blob-${id}`),
    media_type: "image/png",
    width: 1024,
    height: 1536,
    aspect_ratio: "2:3",
    crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 },
    source: "upload",
    license: "own",
    created_by: "director",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function baseState(repository: MemoryProjectRepository, projectId: string) {
  await repository.commit(0, (state) => ({
    ...state,
    project_id: projectId,
    project_name: "雪乃",
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
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

async function startServer(projectId = "batch7-server"): Promise<{ runtime: WorkspaceRuntime; repository: MemoryProjectRepository; url: string; close: () => Promise<void> }> {
  const repository = new MemoryProjectRepository(projectId);
  await baseState(repository, projectId);
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("unexpected server address");
  }
  const url = `http://127.0.0.1:${address.port}`;
  return {
    runtime,
    repository,
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Audit 8 Batch 7 - cover selection manager and publish acknowledgement", () => {
  it("serves the cover manager and acknowledgement UI strings", async () => {
    const { url, close } = await startServer();
    try {
      const response = await fetch(`${url}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("目前發布使用");
      expect(html).toContain("設為目前封面");
      expect(html).toContain("確認並以此確切內容發布");
      expect(html).toContain("我批准畫面中顯示的這份確切組成與輸出");
      expect(html).toContain("/workspace/cover/select");
      expect(html).toContain("textContent");
      expect(html).not.toContain("innerHTML");
      expect(html).toContain("Coverage 角色設定覆蓋");
      expect(html).toContain("來源適配工作流程");
    } finally {
      await close();
    }
  });

  it("selects an existing image as the cover via POST /workspace/cover/select", async () => {
    const { repository, runtime, url, close } = await startServer("batch7-select");
    try {
      const state = await repository.read();
      await repository.commit(state.revision, (current) => ({
        ...current,
        images: [image("img-a"), image("img-b", { id: "img-b", character_id: undefined, source: "upload", license: "own" })],
      }));
      const response = await fetch(`${url}/workspace/cover/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_id: "img-b" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { cover_selection_id?: string };
      expect(typeof body.cover_selection_id).toBe("string");
      const after = await repository.read();
      expect(after.cover_selections.at(-1)?.image_id).toBe("img-b");
      expect(after.audit.some((entry) => entry.event === "cover.selection.updated")).toBe(true);
      const snapshot = await runtime.dashboardSnapshot();
      expect(snapshot.active_cover?.identity.image_id).toBe("img-b");
      expect(snapshot.active_cover?.identity.selection_reason).toBe("explicit");
    } finally {
      await close();
    }
  });

  it("rejects an empty cover selection body", async () => {
    const { url, close } = await startServer("batch7-empty");
    try {
      const response = await fetch(`${url}/workspace/cover/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_id: 123 }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe("COVER_SELECT_REQUIRED");
    } finally {
      await close();
    }
  });

  it("exposes the authoritative active cover in the dashboard summary", async () => {
    const { repository, url, close } = await startServer("batch7-summary");
    try {
      const state = await repository.read();
      await repository.commit(state.revision, (current) => ({
        ...current,
        images: [image("img-cover")],
      }));
      const response = await fetch(`${url}/workspace/dashboard/data`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        active_cover?: { identity?: { mode?: string; image_id?: string; selection_reason?: string }; fallback_order?: string[] };
      };
      expect(body.active_cover?.identity?.mode).toBe("uploaded");
      expect(body.active_cover?.identity?.image_id).toBe("img-cover");
      expect(body.active_cover?.identity?.selection_reason).toBe("primary");
      expect(body.active_cover?.fallback_order).toEqual(["primary", "global", "placeholder"]);
    } finally {
      await close();
    }
  });
});
