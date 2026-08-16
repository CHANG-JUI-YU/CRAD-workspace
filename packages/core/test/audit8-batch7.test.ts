import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  resolveCoverImageIdentity,
  type ImageRecord,
} from "../src/index.js";

const now = "2026-08-18T00:00:00.000Z";

function image(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id,
    character_id: undefined,
    blob_hash: contentHash(`blob-${id}`),
    media_type: "image/png",
    width: 1024,
    height: 1536,
    aspect_ratio: "2:3",
    source: "upload",
    license: "own",
    created_by: "director",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function baseState(projectId = "batch7-core") {
  return createProjectState(projectId);
}

describe("#116 authoritative cover resolution", () => {
  it("uses placeholder as the only active cover when there are no images", () => {
    const state = baseState();
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("placeholder");
    expect(result.identity.selection_reason).toBe("placeholder");
    expect(result.selected).toBeUndefined();
  });

  it("falls back to the primary-character image when no explicit selection exists", () => {
    const state = baseState();
    state.images = [image("img-b", { character_id: undefined }), image("img-a", { character_id: "alpha" })];
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("uploaded");
    expect(result.identity.image_id).toBe("img-a");
    expect(result.identity.selection_reason).toBe("primary");
    expect(result.selected?.id).toBe("img-a");
  });

  it("falls back to the global image when no primary candidate exists", () => {
    const state = baseState();
    state.images = [image("img-b", { character_id: undefined })];
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("uploaded");
    expect(result.identity.image_id).toBe("img-b");
    expect(result.identity.selection_reason).toBe("global");
  });

  it("prefers an explicit selection over fallbacks", () => {
    const state = baseState();
    state.images = [image("img-b", { character_id: undefined }), image("img-a", { character_id: "alpha" })];
    state.cover_selections = [
      { id: "cover-1", image_id: "img-b", placeholder: false, created_by: "director", created_at: now },
    ];
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("uploaded");
    expect(result.identity.image_id).toBe("img-b");
    expect(result.identity.selection_reason).toBe("explicit");
    expect(result.selected?.id).toBe("img-b");
  });

  it("re-selects another image by superseding the previous selection", () => {
    const state = baseState();
    state.images = [image("img-a", { character_id: "alpha" }), image("img-c", { character_id: "alpha" })];
    state.cover_selections = [
      { id: "cover-1", image_id: "img-a", placeholder: false, created_by: "director", created_at: now },
      { id: "cover-2", image_id: "img-c", placeholder: false, created_by: "director", created_at: now, supersedes: "cover-1" },
    ];
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.image_id).toBe("img-c");
    expect(result.identity.selection_reason).toBe("explicit");
  });

  it("keeps the active cover unchanged when an unrelated image is removed", () => {
    const state = baseState();
    state.images = [image("img-other", { character_id: "beta" }), image("img-a", { character_id: "alpha" })];
    state.cover_selections = [
      { id: "cover-1", image_id: "img-a", placeholder: false, created_by: "director", created_at: now },
    ];
    const before = resolveCoverImageIdentity(state, "alpha");
    state.images = state.images.filter((item) => item.id !== "img-other");
    const after = resolveCoverImageIdentity(state, "alpha");
    expect(before.identity.image_id).toBe("img-a");
    expect(after.identity.image_id).toBe("img-a");
    expect(after.identity.selection_reason).toBe("explicit");
  });

  it("falls back to the resolver rules when the selected cover image is removed", () => {
    const state = baseState();
    state.images = [image("img-b", { character_id: undefined }), image("img-a", { character_id: "alpha" })];
    state.cover_selections = [
      { id: "cover-1", image_id: "img-a", placeholder: false, created_by: "director", created_at: now },
    ];
    state.images = state.images.filter((item) => item.id !== "img-a");
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("uploaded");
    expect(result.identity.image_id).toBe("img-b");
    expect(result.identity.selection_reason).toBe("global");
  });

  it("honours an explicit placeholder selection", () => {
    const state = baseState();
    state.images = [image("img-a", { character_id: "alpha" })];
    state.cover_selections = [
      { id: "cover-1", placeholder: true, created_by: "director", created_at: now },
    ];
    const result = resolveCoverImageIdentity(state, "alpha");
    expect(result.identity.mode).toBe("placeholder");
    expect(result.identity.selection_reason).toBe("explicit");
    expect(result.selected).toBeUndefined();
  });
});
