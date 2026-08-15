import { describe, expect, it } from "vitest";
import {
  BUILD_SNAPSHOT_PAYLOAD_VERSION,
  PROVENANCE_CONFIRMATION_VERSION,
  buildProvenanceCompositionSummary,
  computeBuildSnapshotHash,
  contentHash,
  createProjectState,
  deriveCoverImageFreshness,
  derivePublishedOutputPlan,
  provenanceCompositionSummarySchema,
  provenanceConfirmationFingerprint,
  resolveCoverImageIdentity,
  type BuildPlan,
  type CoverageSnapshot,
  type ImageRecord,
  type ProvenanceImageIdentity,
  type PublishedOutputPlan,
} from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";
const bp = "bp-1";

function image(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
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

function baseState(projectId = "batch8-core", overrides: Partial<ReturnType<typeof createProjectState>> & Record<string, unknown> = {}) {
  const state = createProjectState(projectId);
  return {
    ...state,
    project_name: "雪乃",
    artifacts: [
      {
        id: "character-1",
        key: "character:yukino",
        kind: "character",
        name: "Yukino",
        content: JSON.stringify({ kind: "character" }),
        media_type: "text/markdown",
        content_hash: contentHash("c1"),
        revision: "rev-1",
        status: "draft",
        created_at: now,
        updated_at: now,
        created_by: "writer",
        operation_id: "op-1",
      },
    ],
    images: [],
    ...overrides,
  };
}

function plan(): BuildPlan {
  return {
    mode_selection: undefined,
    export_roster: [],
    primary_character_id: "yukino",
    primary_character_id_explicit: true,
    world_enabled: false,
    relationships_enabled: false,
    world_artifact_ids: [],
    relationship_artifact_ids: [],
    entries: [{ key: "character:yukino", artifact_id: "character-1", kind: "character", revision: "rev-1" }],
    diagnostics: [],
  };
}

function snapshot(overrides: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  return {
    assessment_id: "assess-1",
    assessment_revision: "rev-assess-1",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    blueprint_revision: bp,
    fact_projection_revision: "fp-1",
    fact_review_run_id: "run-1",
    fact_review_projection_revision: "frp-1",
    source_revisions: [{ source_id: "source-1", revision: "r-1" }],
    source_covered_requirements: [{ character_id: "alpha", requirement_id: "req.personality" }],
    user_supplement_requirements: [],
    creative_completion_requirements: [],
    resolution_ids: ["res-1"],
    authoring_binding_ids: ["binding-1"],
    snapshot_hash: "hash-1",
    ...overrides,
  };
}

function uploadedIdentity(id: string, overrides: Partial<ProvenanceImageIdentity> = {}): ProvenanceImageIdentity {
  return {
    mode: "uploaded",
    image_id: id,
    character_id: "alpha",
    blob_hash: contentHash(`blob-${id}`),
    media_type: "image/png",
    width: 1024,
    height: 1536,
    aspect_ratio: "2:3",
    crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 },
    ...overrides,
  };
}

describe("#106 authoritative output plan", () => {
  it("derives the same export names as the authoritative build path for every mode", () => {
    const state = baseState();
    const zhuji = derivePublishedOutputPlan(state, "zhuji");
    expect(zhuji.json_path).toBe("exports/雪乃-珠璣角色卡.json");
    expect(zhuji.png_path).toBe("exports/雪乃-珠璣角色卡.png");
    expect(zhuji.sanitized_name).toBe("雪乃");
    expect(zhuji.mode).toBe("zhuji");
    const palette = derivePublishedOutputPlan(state, "palette");
    expect(palette.json_path).toBe("exports/雪乃-調色盤角色卡.json");
    const both = derivePublishedOutputPlan(state, "both");
    expect(both.json_path).toBe("exports/雪乃-雙模式角色卡.json");
    const legacy = derivePublishedOutputPlan(state, undefined);
    expect(legacy.json_path).toBe("exports/雪乃-角色卡.json");
    expect(legacy.mode).toBe("default");
  });

  it("preserves non-ASCII names and sanitizes unsafe names exactly like safeSegment", () => {
    const nonAscii = baseState();
    const planA = derivePublishedOutputPlan(nonAscii, "zhuji");
    expect(planA.sanitized_name).toBe("雪乃");
    expect(planA.json_path).toBe("exports/雪乃-珠璣角色卡.json");

    const unsafe = baseState("batch8-unsafe", { project_name: "a<b>:c/d\\e|f?g*h" });
    const planB = derivePublishedOutputPlan(unsafe, "zhuji");
    expect(planB.sanitized_name).not.toContain("<");
    expect(planB.sanitized_name).not.toContain("/");
    expect(planB.sanitized_name).not.toContain("\\");

    const blank = baseState("batch8-blank", { project_name: "   " });
    expect(derivePublishedOutputPlan(blank, "zhuji").sanitized_name).toBe("item");

    const missing = baseState("batch8-missing");
    const { project_name: _ignored, ...noName } = missing as Record<string, unknown>;
    void _ignored;
    const planC = derivePublishedOutputPlan(noName as ReturnType<typeof createProjectState>, "zhuji");
    expect(planC.sanitized_name).toBe("batch8-missing");
    expect(planC.project_name).toBeUndefined();
  });

  it("binds the output plan into the immutable build snapshot and confirmation fingerprint", () => {
    expect(BUILD_SNAPSHOT_PAYLOAD_VERSION).toBe("build-snapshot-v3");
    expect(PROVENANCE_CONFIRMATION_VERSION).toBe("provenance-confirmation-v3");
    const state = baseState();
    const hashA = computeBuildSnapshotHash(state, plan(), "zhuji", snapshot(), undefined, derivePublishedOutputPlan(state, "zhuji"));
    const renamed = baseState("batch8-core", { project_name: "另一名字" });
    const hashB = computeBuildSnapshotHash(renamed, plan(), "zhuji", snapshot(), undefined, derivePublishedOutputPlan(renamed, "zhuji"));
    expect(hashB).not.toBe(hashA);
    expect(computeBuildSnapshotHash(state, plan(), "zhuji", snapshot(), undefined, derivePublishedOutputPlan(state, "zhuji"))).toBe(hashA);

    const compositionA = buildProvenanceCompositionSummary(state, snapshot(), "build-hash-1", undefined, undefined, derivePublishedOutputPlan(state, "zhuji"));
    const fingerprintA = provenanceConfirmationFingerprint(compositionA);
    const compositionB = buildProvenanceCompositionSummary(renamed, snapshot(), "build-hash-1", undefined, undefined, derivePublishedOutputPlan(renamed, "zhuji"));
    expect(provenanceConfirmationFingerprint(compositionB)).not.toBe(fingerprintA);
  });

  it("round-trips the output plan in the composition schema and keeps legacy records readable", () => {
    const state = baseState();
    const outputPlan: PublishedOutputPlan = derivePublishedOutputPlan(state, "both");
    const summary = buildProvenanceCompositionSummary(state, snapshot(), "build-hash-1", undefined, undefined, outputPlan);
    const parsed = provenanceCompositionSummarySchema.parse(summary);
    expect(parsed.output_plan).toEqual(outputPlan);
    const legacy = provenanceCompositionSummarySchema.parse({ ...summary, output_plan: undefined });
    expect(legacy.output_plan).toBeUndefined();
  });
});

describe("#110 cover identity freshness", () => {
  it("is fresh when the selected cover identity is unchanged", () => {
    const state = baseState("batch8-fresh", { images: [image("img-a", { character_id: "alpha" })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    expect(deriveCoverImageFreshness(state, recorded, "alpha").status).toBe("fresh");
  });

  it("stays fresh when an unrelated secondary-character image is added", () => {
    const state = baseState("batch8-unrelated", { images: [image("img-a", { character_id: "alpha" })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    state.images = [...state.images, image("img-beta", { character_id: "beta", updated_at: "2026-08-16T00:00:00.000Z" })];
    expect(deriveCoverImageFreshness(state, recorded, "alpha").status).toBe("fresh");
  });

  it("becomes stale when a newer eligible primary cover is added", () => {
    const state = baseState("batch8-newer", { images: [image("img-old", { character_id: "alpha" })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    state.images = [...state.images, image("img-new", { character_id: "alpha", updated_at: "2026-08-16T00:00:00.000Z" })];
    const result = deriveCoverImageFreshness(state, recorded, "alpha");
    expect(result.status).toBe("stale");
    expect(result.reason).toBeTruthy();
  });

  it("becomes stale when the primary cover is removed and falls back to a global image", () => {
    const state = baseState("batch8-fallback", { images: [image("img-a", { character_id: "alpha" })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    state.images = [image("img-g", { character_id: undefined })];
    const result = deriveCoverImageFreshness(state, recorded, "alpha");
    expect(result.status).toBe("stale");
    expect(result.reason).toContain("封面");
  });

  it("becomes stale when the global fallback is removed and the cover becomes placeholder", () => {
    const state = baseState("batch8-placeholder", { images: [image("img-g", { character_id: undefined })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    state.images = [];
    const result = deriveCoverImageFreshness(state, recorded, "alpha");
    expect(result.status).toBe("stale");
  });

  it("becomes stale when a placeholder cover is replaced by a real image", () => {
    const state = baseState("batch8-upgrade", { images: [] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    expect(recorded.mode).toBe("placeholder");
    state.images = [image("img-a", { character_id: "alpha" })];
    const result = deriveCoverImageFreshness(state, recorded, "alpha");
    expect(result.status).toBe("stale");
  });

  it("becomes stale when the crop of the selected cover changes", () => {
    const state = baseState("batch8-crop", { images: [image("img-a", { character_id: "alpha" })] });
    const recorded = resolveCoverImageIdentity(state, "alpha").identity;
    state.images = [image("img-a", { character_id: "alpha", crop: { width: 640, height: 960, offset_x: 50, offset_y: 50 } })];
    const result = deriveCoverImageFreshness(state, recorded, "alpha");
    expect(result.status).toBe("stale");
    expect(result.reason).toContain("裁切");
  });

  it("reports unknown instead of fresh when the published record has no image identity", () => {
    const state = baseState("batch8-legacy", { images: [image("img-a", { character_id: "alpha" })] });
    const result = deriveCoverImageFreshness(state, undefined, "alpha");
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("舊版記錄");
  });
});
