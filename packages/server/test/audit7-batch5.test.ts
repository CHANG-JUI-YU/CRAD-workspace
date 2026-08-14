import { describe, expect, it } from "vitest";
import { authoringBindingHash, computeProjectProjection, contentHash, coverageFactProjectionRevision, MemoryProjectRepository, type ArtifactRecord, type ImageRecord, type OperationRecord } from "@st-workspace/core";
import { writeCardToPng } from "@st-workspace/adapters-png";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer, type WorkspaceServer } from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";
const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];
const PALETTE_MODULES = ["basic_information", "personality_palette", "tri_faceted", "secondary_interpretation"];

const CHARACTERS = [
  { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
  { id: "saki", label: "Saki", ordinal: 2, mode: "palette" },
] as const;

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  return { id, kind, request: `${id} request`, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

function characterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: id === "alpha" ? "Alpha" : "Saki", aliases: [], summary: "A character.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm.", provenance: [], extensions: {} }], provenance: [], extensions: {} } });
  return { id: `character-${id}`, key: `character:${id}`, kind: "character", name: id, content, media_type: "text/markdown", content_hash: contentHash(content), revision: contentHash(`character-${id}`), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function greetingArtifact(): ArtifactRecord {
  const content = JSON.stringify({ kind: "greeting", document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } });
  return { id: "greeting-alpha", key: "greeting:alpha", kind: "greeting", name: "Greeting", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash("greeting-alpha"), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function modeArtifact(projectId: string, kind: "zhuji" | "palette", characterId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module, title: module, data: {} } });
  return { id: `${kind}-${module}`, key: `${kind}:${characterId}/${module}`, kind, name: module, content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash(`${kind}-${module}`), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function precheck(projectId: string, dualMode: boolean): unknown {
  const characters = dualMode ? CHARACTERS : [CHARACTERS[0]];
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: { schema_version: 1, flow: "source_adaptation", characters, primary_character_id: "alpha", export_modes: dualMode ? "both" : "zhuji" },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: characters.map((character) => ({ subject_id: character.id, dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" })),
    status: "recorded" as const,
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "blueprint", project_id: projectId, primary_character_id: "alpha" });
  return { id: "blueprint-1", key: `blueprint:${projectId}`, kind: "blueprint", name: "Blueprint", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash("blueprint-1"), status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: "op-precheck", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function fact(): unknown {
  return {
    id: "fact-acc",
    statement: "Alpha is calm and direct.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    status: "accepted",
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "reviewer",
  };
}

function reviewRun(): unknown {
  return { id: "run-1", schema_version: 1, curation_run_id: "cset-1", candidate_set_revision: "cset-1", candidate_occurrence_ids: ["occ-1"], source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }], policy_revision: "policy-1", status: "completed", created_by: "reviewer", created_at: now, completed_at: now };
}

function acceptedDecision(): unknown {
  return { id: "dec-1", schema_version: 1, operation_id: "op-review", review_run_id: "run-1", candidate_occurrence_id: "occ-1", fact_id: "fact-acc", decision: "accepted", reviewer_identity: "reviewer", reason: "proven", evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }], candidate_revision: "cand-1", expected_projection_revision: contentHash("projection-1"), resulting_fact_revision: 1, created_at: now };
}

function coverImage(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return { id, character_id: undefined, blob_hash: contentHash(`blob-${id}`), media_type: "image/png", width: 1024, height: 1536, aspect_ratio: "2:3", crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 }, source: "upload", license: "own", created_at: now, updated_at: now, created_by: "director", ...overrides };
}

async function pngBlobBytes(): Promise<Buffer> {
  return writeCardToPng(undefined, {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "雪乃",
      description: "A complete character.",
      personality: "Calm.",
      scenario: "A room.",
      first_mes: "Hello.",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: [],
      character_book: { entries: [], extensions: {} },
      tags: [],
      creator: "director",
      character_version: "1.0",
      extensions: {},
    },
  });
}

async function commitImageWithBlob(repository: MemoryProjectRepository, images: ImageRecord[]): Promise<ImageRecord[]> {
  const blob = await pngBlobBytes();
  const written = images.map((item) => ({ ...item, blob_hash: contentHash(blob) }));
  await repository.commit((await repository.read()).revision, (state) => ({ ...state, images: written }), { blobs: [{ hash: written[0]?.blob_hash ?? "", content: blob }] });
  return written;
}

async function readyState(projectId: string, dualMode: boolean): Promise<ReturnType<MemoryProjectRepository["read"] extends () => Promise<infer T> ? T : never>> {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready" as const,
    project_name: "雪乃",
    interview: { schema_version: 1, flow: "source_adaptation" as const, status: "complete" as const, values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId, dualMode)],
    artifacts: [
      blueprintArtifact(projectId),
      characterArtifact("alpha"),
      ...(dualMode ? [characterArtifact("saki")] : []),
      greetingArtifact(),
      ...(dualMode
        ? [...ZHUJI_MODULES.map((m) => modeArtifact(projectId, "zhuji", "alpha", m)), ...PALETTE_MODULES.map((m) => modeArtifact(projectId, "palette", "saki", m))]
        : ZHUJI_MODULES.map((m) => modeArtifact(projectId, "zhuji", "alpha", m))),
    ],
    sources: [{ id: "source-1", candidate_id: "cand-1", title: "Alpha's story", canonical_text: "Alpha is calm.", original_hash: contentHash("Alpha is calm."), revision: contentHash("Alpha is calm."), media_type: "text/plain", created_at: now }],
    facts: [fact()],
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [acceptedDecision()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "knowledge")],
  }));
  return repository.read();
}

async function healthyRuntime(projectId: string, dualMode: boolean): Promise<{ runtime: WorkspaceRuntime; repository: MemoryProjectRepository }> {
  const initial = await readyState(projectId, dualMode);
  const repository = new MemoryProjectRepository(projectId, initial);
  const runtime = new WorkspaceRuntime(repository);
  await runtime.coverageAssessment("formal");
  const state = await repository.read();
  const assessment = state.coverage_assessments.at(-1);
  await repository.commit(state.revision, (current) => ({
    ...current,
    coverage_assessments: (current.coverage_assessments ?? []).map((item) => (item.id === assessment?.id ? { ...item, items: (item.items ?? []).map((cell) => ({ ...cell, status: "covered_by_source" as const, accepted_fact_ids: ["fact-acc"] })) } : item)),
  }));
  const ready = await repository.read();
  const plan = computeProjectProjection(ready).publishPlan();
  const bindings = ready.artifacts.filter((item) => item.kind !== "blueprint").map((artifact) => ({
    id: `binding-${artifact.id}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment?.id ?? "assess-1",
    assessment_revision: assessment?.revision ?? "rev-1",
    requirement_set_revision: assessment?.requirement_set_revision ?? "set-rev-1",
    fact_projection_revision: coverageFactProjectionRevision(ready),
    fact_review_run_id: "run-1",
    resolution_ids: [],
    input_snapshot_hash: authoringBindingHash({ artifact_id: artifact.id, artifact_revision: artifact.revision, assessment_id: assessment?.id ?? "assess-1", assessment_revision: assessment?.revision ?? "rev-1", requirement_set_revision: assessment?.requirement_set_revision ?? "set-rev-1", fact_projection_revision: coverageFactProjectionRevision(ready), fact_review_run_id: "run-1", resolution_ids: [] }),
    created_by: "director",
    created_at: now,
  }));
  const artifactIds = plan.entries.map((entry) => entry.artifact_id);
  await repository.commit(ready.revision, (current) => ({
    ...current,
    coverage_authoring_bindings: bindings,
    builds: [{ id: "build-1", operation_id: "op-preview", status: "previewed" as const, artifact_ids: artifactIds, content_hash: contentHash("build-1"), diagnostics: [], created_at: now }],
    reviews: current.artifacts.filter((item) => item.kind !== "blueprint").map((item) => ({ id: `review-${item.id}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "reviewer", status: "passed" as const, issue_ids: [], created_at: now })),
  }));
  return { runtime, repository };
}

async function startServer(projectId: string, dualMode: boolean): Promise<{ url: string; runtime: WorkspaceRuntime; repository: MemoryProjectRepository; close: () => Promise<void> }> {
  const { runtime, repository } = await healthyRuntime(projectId, dualMode);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    runtime,
    repository,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Audit 7 batch 5 provenance publish REST contract", () => {
  it("serves a both-mode provenance preview and confirms a both-mode publish", async () => {
    const server = await startServer("batch5-server-both", true);
    try {
      const previewResponse = await fetch(`${server.url}/workspace/publish/provenance/preview?mode=both`);
      expect(previewResponse.status).toBe(200);
      const preview = (await previewResponse.json()) as { available: boolean; mode_selection?: string; fingerprint?: string };
      expect(preview.available).toBe(true);
      expect(preview.mode_selection).toBe("both");
      expect(typeof preview.fingerprint).toBe("string");

      const confirmResponse = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint, mode_selection: "both", idempotency_key: "both-publish-1" }),
      });
      expect(confirmResponse.status).toBe(200);
      const confirmed = (await confirmResponse.json()) as { status: string; };
      expect(confirmed.status).toBe("completed");
      const state = await server.repository.read();
      expect(state.publishes).toHaveLength(1);
      expect(state.publishes[0]?.provenance_summary?.build_snapshot_hash).toBe(preview.fingerprint === undefined ? undefined : state.builds.at(-1)?.provenance_summary?.build_snapshot_hash);
    } finally {
      await server.close();
    }
  });

  it("rejects invalid REST modes with BUILD_MODE_INVALID instead of silently treating them as auto", async () => {
    const server = await startServer("batch5-server-invalid", false);
    try {
      const previewResponse = await fetch(`${server.url}/workspace/publish/preview?mode=bogus`);
      expect(previewResponse.status).toBe(400);
      const previewError = (await previewResponse.json()) as { code?: string };
      expect(previewError.code).toBe("BUILD_MODE_INVALID");
      const provenanceResponse = await fetch(`${server.url}/workspace/publish/provenance/preview?mode=palette`);
      expect(provenanceResponse.status).toBe(200);
      const provenanceBody = (await provenanceResponse.json()) as { available: boolean; reason?: string };
      expect(provenanceBody.available).toBe(false);
      expect(provenanceBody.reason).toBe("BUILD_MODE_INVALID");
    } finally {
      await server.close();
    }
  });

  it("rejects a confirm without a fingerprint with PROVENANCE_CONFIRMATION_REQUIRED", async () => {
    const server = await startServer("batch5-server-missing", false);
    try {
      const response = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode_selection: "zhuji" }),
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe("PROVENANCE_CONFIRMATION_REQUIRED");
      expect((await server.repository.read()).publishes).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("rejects a natural-language publish request because it lacks provenance confirmation", async () => {
    const server = await startServer("batch5-server-natural", false);
    try {
      const response = await fetch(`${server.url}/workspace/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: "發布目前卡片" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status?: string; summary?: string };
      expect(body.status).toBe("blocked");
      expect(body.summary?.toLowerCase()).toContain("confirmation");
      const state = await server.repository.read();
      expect(state.publishes).toHaveLength(0);
      expect(state.audit.some((item) => item.event === "publish.confirmation_required")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("exposes the image identity through the dashboard provenance endpoint after a confirmed publish", async () => {
    const server = await startServer("batch5-server-dashboard", false);
    try {
      await commitImageWithBlob(server.repository, [coverImage("img-cover")]);
      const previewResponse = await fetch(`${server.url}/workspace/publish/provenance/preview?mode=zhuji`);
      const preview = (await previewResponse.json()) as { fingerprint?: string };
      const confirmResponse = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint, mode_selection: "zhuji" }),
      });
      expect(confirmResponse.status).toBe(200);
      const dashboardResponse = await fetch(`${server.url}/workspace/dashboard/provenance`);
      expect(dashboardResponse.status).toBe(200);
      const view = (await dashboardResponse.json()) as { provenance_summary?: { image_identity?: { mode?: string; image_id?: string } }; legacy_build_snapshot_hash?: boolean };
      expect(view.provenance_summary?.image_identity?.mode).toBe("uploaded");
      expect(view.provenance_summary?.image_identity?.image_id).toBe("img-cover");
      expect(view.legacy_build_snapshot_hash).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("renders the dashboard with the both mode option and image identity UI without innerHTML", async () => {
    const server = await startServer("batch5-server-html", true);
    try {
      const htmlResponse = await fetch(`${server.url}/`);
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("Both（兩者）");
      expect(html).toContain("readiness-both-mode");
      expect(html).toContain("封面圖片");
      expect(html).toContain("textContent");
      expect(html).not.toContain("innerHTML");
      expect(html).toContain("Coverage 角色設定覆蓋");
      expect(html).toContain("/workspace/dashboard/coverage");
      expect(html).toContain("來源適配工作流程");
      expect(html).toContain("/workspace/publish/provenance/preview");
      expect(html).toContain("/workspace/publish/provenance/confirm");
    } finally {
      await server.close();
    }
  });
});
