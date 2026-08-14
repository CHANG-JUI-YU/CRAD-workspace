import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, provenanceConfirmationFingerprint, type ArtifactRecord, type ImageRecord, type OperationRecord } from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { BuildService, resolveBuildModeSelection } from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";

function characterContent(): string {
  return JSON.stringify({
    kind: "character",
    document: {
      schema_version: 1,
      id: "yukino",
      display_name: "雪乃",
      aliases: [],
      summary: "A complete character.",
      relationships: [],
      sections: [{ id: "personality", title: "Personality", content: "Calm and direct.", provenance: [], extensions: {} }],
      provenance: [],
      extensions: {},
    },
  });
}

async function pngBlobBytes(): Promise<Buffer> {
  const repository = new MemoryProjectRepository("blob-probe");
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    artifacts: [artifact("op-author", characterContent())],
    operations: [operation("op-author", "authoring")],
  }));
  return compileProject(await repository.read()).png;
}

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  return { id, kind, request: kind, status: "running", created_at: now, updated_at: now, progress: [] };
}

function artifact(operationId: string, content: string): ArtifactRecord {
  const hash = contentHash(content);
  return { id: "artifact-1", key: "character:yukino", kind: "character", name: "Yukino", content, media_type: "text/markdown", content_hash: hash, revision: hash, status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: operationId };
}

function coverImage(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id,
    character_id: undefined,
    blob_hash: contentHash(`blob-${id}`),
    media_type: "image/png",
    width: 1024,
    height: 1536,
    aspect_ratio: "2:3",
    crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 },
    source: "upload",
    license: "own",
    created_at: now,
    updated_at: now,
    created_by: "director",
    ...overrides,
  };
}

async function writeImageBlobs(repository: MemoryProjectRepository, images: ImageRecord[]): Promise<ImageRecord[]> {
  const blob = await pngBlobBytes();
  const blobHash = contentHash(blob);
  const updated = images.map((item) => ({ ...item, blob_hash: blobHash }));
  await repository.commit((await repository.read()).revision, (state) => ({ ...state, images: updated }), {
    blobs: [{ hash: blobHash, content: blob }],
  });
  return updated;
}

async function readyRepository(projectId: string, buildOperationId = "op-build") {
  const repository = new MemoryProjectRepository(projectId);
  const characterContent = JSON.stringify({
    kind: "character",
    document: {
      schema_version: 1,
      id: "yukino",
      display_name: "雪乃",
      aliases: [],
      summary: "A complete character.",
      relationships: [],
      sections: [{ id: "personality", title: "Personality", content: "Calm and direct.", provenance: [], extensions: {} }],
      provenance: [],
      extensions: {},
    },
  });
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    artifacts: [artifact("op-author", characterContent)],
    operations: [operation("op-author", "authoring"), operation(buildOperationId, "build")],
  }));
  return repository;
}

describe("#69 publish without confirmation is blocked with PROVENANCE_CONFIRMATION_REQUIRED", () => {
  it("blocks a publish request without a fingerprint and writes no publish or export", async () => {
    const repository = await readyRepository("batch5-domain-required", "op-publish");
    const service = new BuildService(repository);
    const result = await service.run("op-publish", "發布目前卡片", "publisher");
    expect(result.status).toBe("blocked");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.builds).toHaveLength(0);
    expect(after.project_status).not.toBe("published");
    expect(after.operations.find((item) => item.id === "op-publish")?.status).toBe("blocked");
    const audit = after.audit.filter((item) => item.event === "publish.confirmation_required");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details.codes).toEqual(["PROVENANCE_CONFIRMATION_REQUIRED"]);
  });

  it("a preview request without a fingerprint still runs", async () => {
    const repository = await readyRepository("batch5-domain-preview-ok", "op-preview");
    const service = new BuildService(repository);
    const result = await service.run("op-preview", "preview current card", "builder");
    expect(result.status).toBe("completed");
    const after = await repository.read();
    expect(after.builds).toHaveLength(1);
    expect(after.publishes).toHaveLength(0);
  });
});

describe("#75 image identity is bound into the snapshot and publish record", () => {
  it("persists the confirmed image identity into the PublishRecord", async () => {
    const repository = await readyRepository("batch5-domain-image", "op-preview");
    const [written] = await writeImageBlobs(repository, [coverImage("img-cover")]);
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    const summary = afterPreview.builds[0]?.provenance_summary;
    expect(summary?.image_identity?.mode).toBe("uploaded");
    expect(summary?.image_identity?.image_id).toBe("img-cover");
    expect(summary?.image_identity?.blob_hash).toBe(written.blob_hash);
    expect(summary?.image_identity?.crop).toEqual({ width: 800, height: 1200, offset_x: 0, offset_y: 0 });
    const fingerprint = provenanceConfirmationFingerprint(summary!);

    await repository.commit(afterPreview.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-publish", "build")] }));
    const confirmed = await service.run("op-publish", "publish current card", "publisher", { expected_provenance_fingerprint: fingerprint });
    expect(confirmed.status).toBe("completed");
    const after = await repository.read();
    const publish = after.publishes.at(-1);
    expect(publish?.provenance_summary?.image_identity?.image_id).toBe("img-cover");
    expect(publish?.provenance_summary?.image_identity?.blob_hash).toBe(written.blob_hash);
    expect(after.builds.at(-1)?.provenance_summary?.image_identity?.image_id).toBe("img-cover");
  });

  it("rejects a stale fingerprint when the image is added or replaced after preview", async () => {
    const repository = await readyRepository("batch5-domain-image-stale", "op-preview");
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    const summary = afterPreview.builds[0]?.provenance_summary;
    expect(summary?.image_identity?.mode).toBe("placeholder");
    const fingerprint = provenanceConfirmationFingerprint(summary!);

    await writeImageBlobs(repository, [coverImage("img-new")]);
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-publish", "build")] }));
    const rejected = await service.run("op-publish", "publish current card", "publisher", { expected_provenance_fingerprint: fingerprint });
    expect(rejected.status).toBe("blocked");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    const audit = after.audit.filter((item) => item.event === "provenance.confirmation.rejected").at(-1);
    expect(audit?.details.codes).toEqual(["PROVENANCE_CONFIRMATION_STALE"]);
  });

  it("rejects a stale fingerprint when the crop changes after preview", async () => {
    const repository = await readyRepository("batch5-domain-crop-stale", "op-preview");
    await writeImageBlobs(repository, [coverImage("img-cover")]);
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    const fingerprint = provenanceConfirmationFingerprint(afterPreview.builds[0]?.provenance_summary!);

    await repository.commit(afterPreview.revision, (state) => ({
      ...state,
      images: [coverImage("img-cover", { crop: { width: 640, height: 960, offset_x: 50, offset_y: 50 } })],
      operations: [...state.operations, operation("op-publish", "build")],
    }));
    const rejected = await service.run("op-publish", "publish current card", "publisher", { expected_provenance_fingerprint: fingerprint });
    expect(rejected.status).toBe("blocked");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.audit.some((item) => item.event === "provenance.confirmation.rejected")).toBe(true);
  });
});

function modeArtifact(id: string, key: string, kind: "zhuji" | "palette", characterId = "yukino"): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module: "personality", title: "Personality", data: {} } });
  return {
    id,
    key,
    kind,
    name: "Personality",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(id),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "writer",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function precheckRecord(projectId: string, exportModes: "zhuji" | "palette" | "both") {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: { schema_version: 1, flow: "character", characters: [{ id: "yukino", label: "Yukino", ordinal: 1, mode: "zhuji" }], primary_character_id: "yukino", export_modes: exportModes },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "yukino", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded" as const,
    created_at: now,
    created_by: "director",
  };
}

describe("#76 both mode selection validation", () => {
  it("rejects both when only a zhuji-style manifest is permitted", async () => {
    const repository = await readyRepository("batch5-domain-both-single", "op-build");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      blueprint_prechecks: [...state.blueprint_prechecks, precheckRecord("batch5-domain-both-single", "zhuji")],
      artifacts: [...state.artifacts, modeArtifact("zhuji-1", "zhuji:yukino/personality", "zhuji")],
    }));
    const state = await repository.read();
    const resolution = resolveBuildModeSelection(state, "both");
    expect(resolution.status).toBe("invalid");
    expect(resolution.reason).toBe("BUILD_MODE_INVALID");
    const single = resolveBuildModeSelection(state, "zhuji");
    expect(single.status).toBe("ok");
    expect(single.mode_selection).toBe("zhuji");
  });

  it("falls back to needs_input when both modes are available but none selected", async () => {
    const repository = await readyRepository("batch5-domain-both-auto", "op-build");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      blueprint_prechecks: [...state.blueprint_prechecks, {
        ...precheckRecord("batch5-domain-both-auto", "both"),
        candidate_blueprint: { schema_version: 1, flow: "character", characters: [{ id: "yukino", label: "Yukino", ordinal: 1, mode: "zhuji" }, { id: "saki", label: "Saki", ordinal: 2, mode: "palette" }], primary_character_id: "yukino", export_modes: "both" },
      }],
      artifacts: [
        ...state.artifacts,
        modeArtifact("zhuji-1", "zhuji:yukino/personality", "zhuji"),
        modeArtifact("palette-1", "palette:saki/basic_information", "palette", "saki"),
      ],
    }));
    const state = await repository.read();
    const resolution = resolveBuildModeSelection(state);
    expect(resolution.status).toBe("needs_input");
    expect(resolution.reason).toBe("MODE_SELECTION_REQUIRED");
    expect(resolution.question).toContain("兩者");
    const both = resolveBuildModeSelection(state, "both");
    expect(both.status).toBe("ok");
    expect(both.mode_selection).toBe("both");
  });
});
