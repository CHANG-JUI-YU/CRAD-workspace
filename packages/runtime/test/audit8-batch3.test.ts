import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, authoringBindingHash, contentHash, coverageFactProjectionRevision, provenanceConfirmationFingerprint, type ArtifactRecord, type ImageRecord, type OperationRecord, type PublishRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

function sourceRecord(id: string, text: string) {
  return { id, candidate_id: `cand-${id}`, title: text, canonical_text: text, canonical_url: undefined, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", original_name: `${id}.txt`, provenance_kind: "external_source" as const, created_at: now };
}

function characters(dualMode = false) {
  return [
    { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" as const },
    ...(dualMode ? [{ id: "saki", label: "Saki", ordinal: 2, mode: "palette" as const }] : []),
  ];
}

function precheck(projectId: string, dualMode = false) {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      flow: "source_adaptation",
      collaboration_mode: "assisted",
      characters: characters(dualMode),
      primary_character_id: "alpha",
      export_modes: dualMode ? "both" : "zhuji",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded" as const,
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "blueprint", document: { schema_version: 1, project_id: projectId, characters: characters(false), primary_character_id: "alpha", export_modes: "zhuji" } });
  return { id: "blueprint-1", key: `blueprint:${projectId}`, kind: "blueprint", name: "Blueprint", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash("blueprint-1"), status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: "op-precheck", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function characterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: id === "alpha" ? "Alpha" : "Saki", aliases: [], summary: "A complete character.", sections: [{ id: "personality", title: "Personality", content: "Calm.", provenance: [], extensions: {} }], provenance: [], extensions: {} } });
  return { id: `character-${id}`, key: `character:${id}`, kind: "character", name: id === "alpha" ? "Alpha" : "Saki", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash(`character-${id}`), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function fact(): Record<string, unknown> {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    status: "accepted",
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
    created_by: "curator",
  };
}

function reviewRun() {
  return {
    id: "run-1",
    schema_version: 1,
    curation_run_id: undefined,
    candidate_set_revision: contentHash("set-1"),
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: contentHash("policy-1"),
    status: "completed" as const,
    created_by: "director",
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
    decision: "accepted" as const,
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    candidate_revision: contentHash("cand-1"),
    expected_projection_revision: contentHash("projection-1"),
    resulting_fact_revision: 1,
    created_at: now,
  };
}

function operation(id: string, kind: string): OperationRecord {
  return { id, kind: kind as OperationRecord["kind"], request: kind, status: "completed", created_at: now, updated_at: now, progress: [] };
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

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"] as const;

function modeArtifact(module: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module, title: module, data: {} } });
  return {
    id: `zhuji-${module}`,
    key: `zhuji:alpha/${module}`,
    kind: "zhuji",
    name: module,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(`zhuji-${module}`),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "writer",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function greetingArtifact(): ArtifactRecord {
  const content = JSON.stringify({ kind: "greeting", document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } });
  return {
    id: "greeting-alpha",
    key: "greeting:alpha",
    kind: "greeting",
    name: "Greeting",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash("greeting-alpha"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "writer",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

async function baseState(repository: MemoryProjectRepository, projectId: string): Promise<void> {
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready" as const,
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), ...ZHUJI_MODULES.map(modeArtifact), greetingArtifact()],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact() as never],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [reviewRun() as never],
    fact_review_decisions: [decision() as never],
  }));
}

async function baseRuntime(projectId: string): Promise<{ runtime: WorkspaceRuntime; repository: MemoryProjectRepository; formal: { id: string; revision: string } }> {
  const repository = new MemoryProjectRepository(projectId);
  await baseState(repository, projectId);
  const runtime = new WorkspaceRuntime(repository);
  const formal = await runtime.coverageAssessment("formal");
  return { runtime, repository, formal: { id: formal.assessment.id, revision: formal.assessment.revision } };
}

async function withHealthyState(projectId: string): Promise<{ runtime: WorkspaceRuntime; repository: MemoryProjectRepository; formal: { id: string; revision: string } }> {
  const { runtime, repository, formal } = await baseRuntime(projectId);
  const state = await repository.read();
  const items = state.coverage_assessments.at(-1)!.items.map((item) => ({
    ...item,
    status: "covered_by_source" as const,
    accepted_fact_ids: ["fact-acc"],
  }));
  const current = state.artifacts.filter((item) => item.kind !== "blueprint");
  const factProjection = coverageFactProjectionRevision(state);
  const bindings = current.map((artifact) => ({
    id: `binding-${artifact.id}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: formal.id,
    assessment_revision: formal.revision,
    requirement_set_revision: state.coverage_requirement_sets.at(-1)!.revision,
    fact_projection_revision: factProjection,
    fact_review_run_id: "run-1",
    resolution_ids: [] as string[],
    input_snapshot_hash: authoringBindingHash({
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: formal.id,
      assessment_revision: formal.revision,
      requirement_set_revision: state.coverage_requirement_sets.at(-1)!.revision,
      fact_projection_revision: factProjection,
      fact_review_run_id: "run-1",
      resolution_ids: [] as string[],
    }),
    created_by: "director",
    created_at: now,
  }));
  const ready = await repository.read();
  await repository.commit(ready.revision, (currentState) => ({
    ...currentState,
    coverage_assessments: currentState.coverage_assessments.map((item) => (item.id === formal.id ? { ...item, items } : item)),
    coverage_authoring_bindings: bindings,
    reviews: current.map((artifact) => ({
      id: `review-${artifact.id}`,
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      reviewer: "reviewer",
      status: "passed" as const,
      issue_ids: [],
      created_at: now,
    })),
  }));
  return { runtime, repository, formal };
}

async function commitBuild(repository: MemoryProjectRepository, publishOverrides: Partial<PublishRecord> = {}) {
  const state = await repository.read();
  await repository.commit(state.revision, (current) => ({
    ...current,
    builds: [...current.builds, { id: "build-1", operation_id: "op-build", status: "previewed" as const, artifact_ids: [], content_hash: contentHash("build-1"), diagnostics: [], created_at: now }],
    publishes: [...current.publishes, {
      id: "publish-1",
      operation_id: "op-build",
      artifact_ids: [],
      content_hash: contentHash("publish-1"),
      export_json_path: "exports/雪乃-珠璣角色卡.json",
      export_png_path: "exports/雪乃-珠璣角色卡.png",
      created_at: now,
      ...publishOverrides,
    }],
  }));
}

describe("#106 authoritative output plan", () => {
  it("prepares an output plan identical to the recorded PublishRecord export paths", async () => {
    const { runtime, repository } = await withHealthyState("batch8-output-plan");
    const preview = await runtime.publishProvenancePreview();
    expect(preview.available).toBe(true);
    const outputPlan = (preview as { output_plan?: { json_path: string; png_path: string; sanitized_name: string; mode: string } }).output_plan;
    expect(outputPlan?.json_path).toBe("exports/雪乃-珠璣角色卡.json");
    expect(outputPlan?.png_path).toBe("exports/雪乃-珠璣角色卡.png");
    expect(outputPlan?.mode).toBe("zhuji");
    expect(outputPlan?.sanitized_name).toBe("雪乃");
    const confirmed = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "plan-1" }, { actor: "director", attachments: [] });
    expect(confirmed.status).toBe("completed");
    const recorded = await repository.read();
    expect(recorded.publishes.at(-1)?.export_json_path).toBe("exports/雪乃-珠璣角色卡.json");
    expect(recorded.publishes.at(-1)?.output_plan?.json_path).toBe("exports/雪乃-珠璣角色卡.json");


  });

  it("fails closed when the confirmed output plan no longer matches the current project", async () => {
    const { runtime, repository, formal } = await withHealthyState("batch8-output-mismatch");
    const preview = await runtime.publishProvenancePreview();
    expect(preview.available).toBe(true);
    const confirmed = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "plan-2" }, { actor: "director", attachments: [] });
    expect(confirmed.status).toBe("completed");
    const state = await repository.read();
    expect(state.publishes.at(-1)?.export_json_path).toBe("exports/雪乃-珠璣角色卡.json");
    expect(state.publishes.at(-1)?.output_plan).toBeDefined();
    expect(state.publishes.at(-1)?.output_plan?.json_path).toBe("exports/雪乃-珠璣角色卡.json");
    const oldFingerprint = preview.fingerprint!;
    await repository.commit((await repository.read()).revision, (current) => ({ ...current, project_name: "更名後專案" }));
    await expect(
      runtime.publishProvenanceConfirm({ fingerprint: oldFingerprint, idempotency_key: "plan-3" }, { actor: "director", attachments: [] }),
    ).rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    expect((await repository.read()).publishes).toHaveLength(1);
  });

  it("keeps legacy PublishRecords readable without an output plan", async () => {
    const { repository } = await withHealthyState("batch8-legacy-plan");
    await commitBuild(repository, { output_plan: undefined });
    const state = await repository.read();
    expect(state.publishes.at(-1)?.export_json_path).toBe("exports/雪乃-珠璣角色卡.json");
    expect(state.publishes.at(-1)?.output_plan).toBeUndefined();
  });
});

describe("#110 cover identity freshness", () => {
  it("exposes consistent unknown freshness for legacy publishes without image identity", async () => {
    const { runtime, repository } = await withHealthyState("batch8-freshness");
    await commitBuild(repository);
    const snapshot = await runtime.dashboardSnapshot();
    const summary = await runtime.dashboardSummary();
    expect(snapshot.images_freshness.status).toBe("unknown");
    expect(summary.images_freshness.status).toBe("unknown");
    expect(snapshot.images_stale).toBe(false);
    expect(summary.images_stale).toBe(false);
    expect(snapshot.images_stale_reason).toContain("舊版記錄");
  });

  it("does not mark unrelated secondary-character images as stale", async () => {
    const { runtime, repository } = await withHealthyState("batch8-freshness-unrelated");
    const preview = await runtime.publishProvenancePreview();
    await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "cover-unrelated" }, { actor: "director", attachments: [] });
    const state = await repository.read();
    const unrelated = coverImage("img-beta", { character_id: "beta", updated_at: "2026-08-20T00:00:00.000Z" });
    await repository.commit(state.revision, (current) => ({ ...current, images: [unrelated] }));
    const snapshot = await runtime.dashboardSnapshot();
    const summary = await runtime.dashboardSummary();
    expect(snapshot.images_freshness.status).toBe("fresh");
    expect(summary.images_freshness.status).toBe("fresh");
    expect(snapshot.images_stale).toBe(false);
    expect(summary.images_stale).toBe(false);
  });

  it("marks a newer eligible primary cover as stale across both layers", async () => {
    const { runtime, repository } = await withHealthyState("batch8-freshness-eligible");
    const preview = await runtime.publishProvenancePreview();
    await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "cover-eligible" }, { actor: "director", attachments: [] });
    const state = await repository.read();
    const primary = coverImage("img-primary", { character_id: "alpha", updated_at: "2026-08-20T00:00:00.000Z" });
    await repository.commit(state.revision, (current) => ({ ...current, images: [primary] }));
    const snapshot = await runtime.dashboardSnapshot();
    const summary = await runtime.dashboardSummary();
    expect(snapshot.images_freshness.status).toBe("stale");
    expect(summary.images_freshness.status).toBe("stale");
    expect(snapshot.images_stale).toBe(true);
    expect(summary.images_stale).toBe(true);
  });
});
