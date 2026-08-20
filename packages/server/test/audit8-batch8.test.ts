import { afterAll, describe, expect, it } from "vitest";
import { authoringBindingHash, contentHash, coverageFactProjectionRevision, MemoryProjectRepository, type ImageRecord, type OperationRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import type { Server } from "node:http";

const now = "2026-08-18T00:00:00.000Z";

function sourceRecord(id: string, text: string) {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: text.slice(0, 40),
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    provenance_kind: "external_source",
    created_at: now,
  } as const;
}

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];

function modeArtifact(module: string) {
  return {
    id: `zhuji-${module}`,
    key: `zhuji:alpha/${module}`,
    kind: "zhuji",
    name: `Zhuji ${module}`,
    content: JSON.stringify({
      kind: "zhuji",
      character_id: "alpha",
      module: { schema_version: 1, mode: "zhuji", module, title: module, data: {} },
    }),
    media_type: "application/json",
    content_hash: contentHash(`zhuji-${module}`),
    revision: contentHash(`zhuji-${module}`),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  } as const;
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
      export_modes: "zhuji",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [
      { subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    status: "recorded",
    created_at: now,
    created_by: "director",
  } as const;
}

function blueprintArtifact(projectId: string) {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({ schema_version: 1, project_id: projectId, flow: "source_adaptation", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }], primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  } as const;
}

function characterArtifact(id: string) {
  return {
    id,
    key: `character:${id}`,
    kind: "character",
    name: `Character ${id}`,
    content: JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: id, aliases: [], summary: "", relationships: [], sections: [], provenance: [], extensions: {} } }),
    media_type: "application/json",
    content_hash: contentHash(`character-${id}`),
    revision: contentHash(`character-${id}`),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  } as const;
}

function greetingArtifact() {
  return {
    id: "greeting-alpha",
    key: "greeting:alpha",
    kind: "greeting",
    name: "Greeting",
    content: JSON.stringify({ kind: "greeting", document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } }),
    media_type: "application/json",
    content_hash: contentHash("greeting-alpha"),
    revision: contentHash("greeting-alpha"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  } as const;
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
    confidence: 0.9,
    status: "accepted",
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
  } as const;
}

function reviewRun() {
  return {
    id: "run-1",
    schema_version: 1,
    curation_run_id: "cur-1",
    candidate_set_revision: contentHash("cset-1"),
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: contentHash("policy-1"),
    status: "completed",
    created_by: "director",
    created_at: now,
    completed_at: now,
  } as const;
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
    candidate_revision: contentHash("cand-1"),
    expected_projection_revision: contentHash("projection-1"),
    resulting_fact_revision: 1,
    created_at: now,
  } as const;
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
  } as OperationRecord;
}

function image(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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
  } as ImageRecord;
}

async function baseState(repository: MemoryProjectRepository, projectId: string) {
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), greetingArtifact(), ...ZHUJI_MODULES.map((m) => modeArtifact(m))],
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

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await baseState(repository, projectId);
  const runtime = new WorkspaceRuntime(repository);
  const formal = await runtime.coverageAssessment("formal");
  const state = await repository.read();
  const plan = await (runtime as unknown as { dashboardCoverageCenter(): Promise<unknown> }).dashboardCoverageCenter();
  void plan;
  await repository.commit(state.revision, (current) => ({
    ...current,
    coverage_assessments: current.coverage_assessments.map((a) => a.id === formal.assessment.id ? { ...a, items: a.items.map((i) => ({ ...i, status: "covered_by_source" as const, accepted_fact_ids: ["fact-acc"] })) } : a),
  }));
  const ready = await repository.read();
  const current = ready.artifacts.filter((a) => a.kind !== "blueprint");
  const factProjection = coverageFactProjectionRevision(ready);
  await repository.commit(ready.revision, (currentState) => ({
    ...currentState,
    coverage_authoring_bindings: current.map((artifact) => ({
      id: `binding-${artifact.id}`,
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_set_revision: (currentState.coverage_requirement_sets.at(-1) as { revision: string }).revision,
      fact_projection_revision: factProjection,
      fact_review_run_id: "run-1",
      resolution_ids: [],
      input_snapshot_hash: authoringBindingHash({
        artifact_id: artifact.id,
        artifact_revision: artifact.revision,
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        requirement_set_revision: (currentState.coverage_requirement_sets.at(-1) as { revision: string }).revision,
        fact_projection_revision: factProjection,
        fact_review_run_id: "run-1",
        resolution_ids: [],
      }),
      created_by: "director",
      created_at: now,
    })),
    reviews: current.map((artifact) => ({
      id: `review-${artifact.id}`,
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      reviewer: "reviewer",
      status: "passed",
      issue_ids: [],
      created_at: now,
    })),
  }));
  const workspace = createWorkspaceServer({ runtime, actor: "batch8-test", autoStartWorker: false });
  servers.push(workspace);
  await new Promise<void>((resolve) => workspace.listen(0, "127.0.0.1", () => resolve()));
  const address = workspace.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected numeric address");
  }
  return { runtime, repository, url: `http://127.0.0.1:${address.port}`, close: () => workspace.close() };
}

async function preparePublish(runtime: WorkspaceRuntime) {
  const preview = await runtime.publishProvenancePreview();
  const result = await runtime.publishProvenanceConfirm(
    { fingerprint: preview.fingerprint as string, idempotency_key: "b8-key-1" },
    { actor: "batch8-test", attachments: [] },
  );
  return { preview, result, publishId: (result as unknown as { publish_id?: string }).publish_id };
}

describe("#120/#118 publish intent and completion handoff (server)", () => {
  it("serves publish completion with verified files from the final PublishRecord", async () => {
    const { runtime, url } = await startServer("batch8-server-completion");
    const { publishId } = await preparePublish(runtime);
    expect(publishId).toBeDefined();
    const response = await fetch(`${url}/workspace/publish/completion?publish_id=${encodeURIComponent(publishId as string)}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      publish_id: string;
      files: Array<{ kind: string; status: string; content_hash: string; size: number }>;
      result_kind: string;
    };
    expect(body.publish_id).toBe(publishId);
    expect(body.files).toHaveLength(2);
    expect(body.files.every((f) => f.status === "verified")).toBe(true);
    expect(body.files.every((f) => f.content_hash.length === 64)).toBe(true);
    expect(body.files.every((f) => f.size > 0)).toBe(true);
    expect(body.result_kind).toBe("new");
  });

  it("rejects completion without publish id", async () => {
    const { url } = await startServer("batch8-server-completion-missing");
    const response = await fetch(`${url}/workspace/publish/completion`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("PUBLISH_ID_REQUIRED");
  });

  it("downloads verified json and png outputs as binary attachments", async () => {
    const { runtime, url } = await startServer("batch8-server-download");
    const { publishId } = await preparePublish(runtime);
    const expectedJson = await runtime.publishDownload(publishId as string, "json");
    const jsonResponse = await fetch(`${url}/workspace/publish/download?publish_id=${encodeURIComponent(publishId as string)}&kind=json`);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get("content-type")).toBe("application/json");
    expect(jsonResponse.headers.get("content-disposition")).toContain("attachment;");
    expect(jsonResponse.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(Number(jsonResponse.headers.get("content-length"))).toBe(expectedJson.content.byteLength);
    expect(new Uint8Array(await jsonResponse.arrayBuffer())).toEqual(new Uint8Array(expectedJson.content));

    const expectedPng = await runtime.publishDownload(publishId as string, "png");
    const pngResponse = await fetch(`${url}/workspace/publish/download?publish_id=${encodeURIComponent(publishId as string)}&kind=png`);
    expect(pngResponse.status).toBe(200);
    expect(pngResponse.headers.get("content-type")).toBe("image/png");
    expect(Number(pngResponse.headers.get("content-length"))).toBe(expectedPng.content.byteLength);
    expect(new Uint8Array(await pngResponse.arrayBuffer())).toEqual(new Uint8Array(expectedPng.content));
  });

  it("rejects invalid download kind", async () => {
    const { runtime, url } = await startServer("batch8-server-kind");
    const { publishId } = await preparePublish(runtime);
    const response = await fetch(`${url}/workspace/publish/download?publish_id=${encodeURIComponent(publishId as string)}&kind=bogus`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("PUBLISH_DOWNLOAD_KIND_INVALID");
  });

  it("reports missing files when the recorded blob is gone", async () => {
    const { runtime, repository, url } = await startServer("batch8-server-missing");
    const { publishId } = await preparePublish(runtime);
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: current.publishes.map((p) => (p.id === publishId ? { ...p, content_ref: { hash: contentHash("no-such-blob"), size: 12 } } : p)),
    }));
    const response = await fetch(`${url}/workspace/publish/completion?publish_id=${encodeURIComponent(publishId as string)}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: Array<{ kind: string; status: string }> };
    expect(body.files.find((f) => f.kind === "json")?.status).toBe("missing");
  });

  it("returns structured errors for missing download blob", async () => {
    const { runtime, repository, url } = await startServer("batch8-server-dl-missing");
    const { publishId } = await preparePublish(runtime);
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: current.publishes.map((p) => (p.id === publishId ? { ...p, content_ref: { hash: contentHash("gone"), size: 5 } } : p)),
    }));
    const response = await fetch(`${url}/workspace/publish/download?publish_id=${encodeURIComponent(publishId as string)}&kind=json`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; recoverable: boolean };
    expect(body.code).toBe("PUBLISH_DOWNLOAD_MISSING");
    expect(body.recoverable).toBe(true);
  });

  it("keeps legacy publishes readable and marks completion as legacy", async () => {
    const { runtime, repository, url } = await startServer("batch8-server-legacy");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: [
        ...current.publishes,
        {
          id: "publish-legacy",
          operation_id: "op-legacy-pub",
          artifact_ids: ["character-alpha"],
          content_hash: contentHash("legacy-json"),
          export_json_path: "exports/legacy.json",
          export_png_path: "exports/legacy.png",
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
    }));
    const response = await fetch(`${url}/workspace/publish/completion?publish_id=publish-legacy`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result_kind: string; files: Array<{ status: string }> };
    expect(body.result_kind).toBe("legacy");
    expect(body.files.every((f) => f.status === "missing")).toBe(true);
  });

  it("serves the dashboard with completion UI strings and keeps regression assertions", async () => {
    const { url } = await startServer("batch8-server-html");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("發布完成");
    expect(html).toContain("publish-completion");
    expect(html).toContain("再次發布");
    expect(html).toContain("/workspace/publish/completion");
    expect(html).toContain("/workspace/publish/download");
    expect(html).toContain("response.blob()");
    expect(html).not.toContain("atob(");
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("來源適配工作流程");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });
});