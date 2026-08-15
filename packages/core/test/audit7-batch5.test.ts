import { describe, expect, it } from "vitest";
import {
  BUILD_SNAPSHOT_PAYLOAD_VERSION,
  PROVENANCE_CONFIRMATION_VERSION,
  computeBuildSnapshotHash,
  contentHash,
  createProjectState,
  imageTransformationRevision,
  provenanceCompositionSummarySchema,
  provenanceConfirmationFingerprint,
  resolveCoverImageIdentity,
  type CoverageSnapshot,
  type ImageRecord,
} from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";

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

function baseState() {
  return createProjectState("batch5-core");
}

function snapshot(overrides: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  const base: CoverageSnapshot = {
    assessment_id: "assess-1",
    assessment_revision: "rev-assess-1",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    blueprint_revision: "bp-1",
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
  };
  return { ...base, ...overrides };
}

describe("#75 image identity helpers", () => {
  it("returns a placeholder identity when there are no images", () => {
    const { identity, selected } = resolveCoverImageIdentity(baseState(), "alpha");
    expect(identity.mode).toBe("placeholder");
    expect(selected).toBeUndefined();
  });

  it("prefers the primary character image and falls back to a character-agnostic image", () => {
    const state = { ...baseState(), images: [image("img-a", { character_id: "beta" }), image("img-b"), image("img-c", { character_id: "alpha" })] };
    const primary = resolveCoverImageIdentity(state, "alpha");
    expect(primary.identity.mode).toBe("uploaded");
    expect(primary.identity.image_id).toBe("img-c");
    const fallback = resolveCoverImageIdentity({ ...state, images: [image("img-a", { character_id: "beta" })] }, "alpha");
    expect(fallback.identity.mode).toBe("placeholder");
    const agnostic = resolveCoverImageIdentity({ ...baseState(), images: [image("img-a", { character_id: "beta" }), image("img-b")] }, "alpha");
    expect(agnostic.identity.image_id).toBe("img-b");
  });

  it("exposes the full uploaded identity including crop and transformation revision", () => {
    const { identity } = resolveCoverImageIdentity({ ...baseState(), images: [image("img-cover")] }, "alpha");
    expect(identity).toMatchObject({
      mode: "uploaded",
      image_id: "img-cover",
      blob_hash: contentHash("blob-img-cover"),
      media_type: "image/png",
      width: 1024,
      height: 1536,
      aspect_ratio: "2:3",
      crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 },
    });
    expect(identity.transformation_revision).toBe(imageTransformationRevision({ width: 800, height: 1200, offset_x: 0, offset_y: 0 }, "2:3"));
  });

  it("returns no transformation revision when there is no crop and no aspect ratio", () => {
    expect(imageTransformationRevision(undefined, undefined)).toBeUndefined();
    expect(imageTransformationRevision(undefined, "2:3")).toBeDefined();
    expect(imageTransformationRevision({ width: 800, height: 1200, offset_x: 0, offset_y: 0 }, undefined)).toBeDefined();
  });
});

describe("#75 build snapshot hash binds the image identity", () => {
  const plan = {
    mode_selection: undefined,
    export_roster: ["alpha"],
    primary_character_id: "alpha",
    primary_character_id_explicit: true,
    world_enabled: false,
    relationships_enabled: false,
    world_artifact_ids: [],
    relationship_artifact_ids: [],
    entries: [{ key: "character:alpha", artifact_id: "character-alpha", kind: "character", revision: "rev-1" }],
    diagnostics: [],
  };

  function hashWith(images: ImageRecord[], mode?: string) {
    const state = { ...baseState(), images };
    return computeBuildSnapshotHash(state, plan, mode, snapshot(), resolveCoverImageIdentity(state, "alpha").identity);
  }

  it("uses version build-snapshot-v2", () => {
    expect(BUILD_SNAPSHOT_PAYLOAD_VERSION).toBe("build-snapshot-v3");
    expect(PROVENANCE_CONFIRMATION_VERSION).toBe("provenance-confirmation-v3");
  });

  it("changes when the blob hash changes", () => {
    const before = hashWith([image("img-a")]);
    const after = hashWith([image("img-a", { blob_hash: contentHash("blob-other") })]);
    expect(before).not.toBe(after);
  });

  it("changes when the crop changes", () => {
    const before = hashWith([image("img-a")]);
    const after = hashWith([image("img-a", { crop: { width: 640, height: 960, offset_x: 50, offset_y: 50 } })]);
    expect(before).not.toBe(after);
  });

  it("changes when the selected image changes", () => {
    const before = hashWith([image("img-a", { character_id: "alpha" })]);
    const after = hashWith([image("img-b", { character_id: "alpha" })]);
    expect(before).not.toBe(after);
  });

  it("does not change when only created_at changes", () => {
    const before = hashWith([image("img-a", { created_at: now, updated_at: now })]);
    const after = hashWith([image("img-a", { created_at: "2027-01-01T00:00:00.000Z", updated_at: "2027-01-01T00:00:00.000Z" })]);
    expect(before).toBe(after);
  });

  it("distinguishes placeholder from uploaded identities", () => {
    const state = { ...baseState(), images: [] };
    const placeholder = computeBuildSnapshotHash(state, plan, undefined, snapshot(), { mode: "placeholder" });
    const uploaded = computeBuildSnapshotHash({ ...baseState(), images: [image("img-a")] }, plan, undefined, snapshot(), { mode: "uploaded", image_id: "img-a", blob_hash: contentHash("blob-img-a") });
    expect(placeholder).not.toBe(uploaded);
  });

  it("distinguishes both from single modes", () => {
    const state = baseState();
    const identity = { mode: "placeholder" } as const;
    const zhuji = computeBuildSnapshotHash(state, plan, "zhuji", snapshot(), identity);
    const palette = computeBuildSnapshotHash(state, plan, "palette", snapshot(), identity);
    const both = computeBuildSnapshotHash(state, plan, "both", snapshot(), identity);
    expect(both).not.toBe(zhuji);
    expect(both).not.toBe(palette);
    expect(zhuji).not.toBe(palette);
  });
});

describe("#75 provenance schema compatibility", () => {
  it("round-trips a modern composition with image identity", () => {
    const composition = {
      source_backed: { refs: [{ character_id: "alpha", requirement_id: "req.personality" }], count: 1 },
      user_supplement: { refs: [], count: 0 },
      creative_completion: { refs: [], count: 0 },
      overrides: [],
      quality_overrides: [],
      assessment: { id: "assess-1", revision: "rev-assess-1" },
      requirement_set: { id: "set-1", revision: "set-rev-1" },
      fact_review_run: { id: "run-1", projection_revision: "frp-1" },
      fact_projection_revision: "fp-1",
      source_revisions: [{ source_id: "source-1", revision: "r-1" }],
      resolution_ids: ["res-1"],
      authoring_binding_ids: ["binding-1"],
      coverage_snapshot_hash: "hash-1",
      build_snapshot_hash: contentHash("build-1"),
      compiled_content_hash: contentHash("compiled-1"),
      image_identity: { mode: "uploaded", image_id: "img-a", blob_hash: contentHash("blob-img-a"), media_type: "image/png", width: 1024, height: 1536, aspect_ratio: "2:3", crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 }, transformation_revision: "tr-1" },
    };
    expect(provenanceCompositionSummarySchema.parse(composition)).toEqual(composition);
  });

  it("round-trips a legacy composition without image identity", () => {
    const composition = {
      source_backed: { refs: [], count: 0 },
      user_supplement: { refs: [], count: 0 },
      creative_completion: { refs: [], count: 0 },
      overrides: [],
      quality_overrides: [],
      source_revisions: [],
      resolution_ids: [],
      authoring_binding_ids: [],
      build_snapshot_hash: contentHash("build-1"),
    };
    const parsed = provenanceCompositionSummarySchema.parse(composition);
    expect(parsed.image_identity).toBeUndefined();
  });

  it("fingerprint includes the image identity and is stable", () => {
    const composition = {
      source_backed: { refs: [], count: 0 },
      user_supplement: { refs: [], count: 0 },
      creative_completion: { refs: [], count: 0 },
      overrides: [],
      quality_overrides: [],
      source_revisions: [],
      resolution_ids: [],
      authoring_binding_ids: [],
      build_snapshot_hash: contentHash("build-1"),
      image_identity: { mode: "placeholder" },
    };
    const withImage = { ...composition, image_identity: { mode: "uploaded", image_id: "img-a", blob_hash: contentHash("blob-img-a") } };
    const fp1 = provenanceConfirmationFingerprint(composition);
    const fp2 = provenanceConfirmationFingerprint(composition);
    const fpImage = provenanceConfirmationFingerprint(withImage);
    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fpImage);
  });
});
