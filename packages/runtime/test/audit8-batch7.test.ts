import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ImageRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-17T00:00:00.000Z";

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
      {
        subject_id: "alpha",
        dimension: "character_core",
        uncertainty: "low",
        impact: "high",
        basis: "explicit",
        action: "preserve_explicit",
      },
    ],
    status: "recorded",
    created_by: "director",
    created_at: now,
  };
}

function blueprintArtifact(projectId: string) {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({ schema_version: 1, characters: [{ id: "alpha", mode: "zhuji" }] }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    created_at: now,
    updated_at: now,
  };
}

function characterArtifact(id: string) {
  return {
    id,
    key: `character:${id}`,
    kind: "character",
    name: `Character ${id}`,
    content: JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: id } }),
    media_type: "application/json",
    content_hash: contentHash(`character-${id}`),
    revision: contentHash(`character-${id}`),
    status: "draft",
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
    created_at: now,
    updated_at: now,
  };
}

function fact() {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "is",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    status: "accepted" as const,
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
    created_by: "reviewer",
  };
}

function reviewRun() {
  return {
    id: "run-1",
    schema_version: 1,
    candidate_set_revision: "cset-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "policy-1",
    status: "completed" as const,
    created_by: "reviewer",
    created_at: now,
    completed_at: now,
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
    decision: "accepted" as const,
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
    status: "completed" as const,
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

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
    created_by: "director",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function baseRuntime(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready",
    interview: {
      schema_version: 1,
      flow: "source_adaptation",
      status: "complete",
      values: {},
      answers: [],
    },
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
  const runtime = new WorkspaceRuntime(repository);
  return { runtime, repository };
}

describe("#116 cover selection runtime", () => {
  it("records an explicit cover selection with audit lineage", async () => {
    const { runtime, repository } = await baseRuntime("batch7-rt-select");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      images: [image("img-a", { character_id: "alpha" })],
    }));
    const result = await runtime.setProjectCover("director", { image_id: "img-a" });
    const state = await repository.read();
    expect(result.cover_selection_id).toBeDefined();
    expect(state.cover_selections.at(-1)?.image_id).toBe("img-a");
    expect(state.cover_selections.at(-1)?.placeholder).toBe(false);
    expect(state.audit.some((e) => e.event === "cover.selection.updated")).toBe(true);
  });

  it("rejects an unknown image id", async () => {
    const { runtime } = await baseRuntime("batch7-rt-missing");
    await expect(
      runtime.setProjectCover("director", { image_id: "img-nope" }),
    ).rejects.toMatchObject({ code: "IMAGE_NOT_FOUND" });
  });

  it("falls back after removing the explicitly selected cover", async () => {
    const { runtime, repository } = await baseRuntime("batch7-rt-remove");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      images: [image("img-a", { character_id: "alpha" }), image("img-g", { character_id: undefined })],
    }));
    await runtime.setProjectCover("director", { image_id: "img-a" });
    const removed = await runtime.removeProjectImage("img-a", "director");
    expect(removed).toBe(true);
    const state = await repository.read();
    expect(state.cover_selections.at(-1)?.image_id).toBe("img-a");
    expect(state.cover_selections.at(-1)?.supersedes).toBeDefined();
    const snapshot = await runtime.dashboardSnapshot();
    expect(snapshot.active_cover.identity.selection_reason).toBe("global");
    expect(snapshot.active_cover.identity.image_id).toBe("img-g");
  });

  it("reports placeholder as the active cover when no images exist", async () => {
    const { runtime } = await baseRuntime("batch7-rt-placeholder");
    const snapshot = await runtime.dashboardSnapshot();
    expect(snapshot.active_cover.identity.mode).toBe("placeholder");
    expect(snapshot.active_cover.reason).toBe("placeholder");
    expect(snapshot.active_cover.fallback_order).toEqual(["primary", "global", "placeholder"]);
  });

  it("keeps explicit selection authoritative in the active_cover projection", async () => {
    const { runtime, repository } = await baseRuntime("batch7-rt-explicit");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      images: [image("img-a", { character_id: "alpha" }), image("img-b", { character_id: undefined })],
    }));
    await runtime.setProjectCover("director", { image_id: "img-b" });
    const snapshot = await runtime.dashboardSnapshot();
    expect(snapshot.active_cover.identity.image_id).toBe("img-b");
    expect(snapshot.active_cover.identity.selection_reason).toBe("explicit");
  });

  it("reselecting another image supersedes the previous selection", async () => {
    const { runtime, repository } = await baseRuntime("batch7-rt-reselect");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      images: [image("img-a", { character_id: "alpha" }), image("img-c", { character_id: "alpha" })],
    }));
    await runtime.setProjectCover("director", { image_id: "img-a" });
    await runtime.setProjectCover("director", { image_id: "img-c" });
    const state = await repository.read();
    const selections = state.cover_selections;
    expect(selections).toHaveLength(2);
    expect(selections[0]?.supersedes).toBeUndefined();
    expect(selections[1]?.supersedes).toBe(selections[0]?.id);
    const snapshot = await runtime.dashboardSnapshot();
    expect(snapshot.active_cover.identity.image_id).toBe("img-c");
  });
});
