import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  authoringBindingHash,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ImageRecord,
  type OperationRecord,
  type ProjectRepository,
  type SourceRecord,
} from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";

function sourceRecord(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `candidate-${id}`,
    title: id,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: now,
  };
}

const characters = [
  { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
  { id: "saki", label: "Saki", ordinal: 2, mode: "palette" },
];

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];
const PALETTE_MODULES = ["basic_information", "personality_palette", "tri_faceted", "secondary_interpretation"];

function modeArtifact(projectId: string, kind: "zhuji" | "palette", characterId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module, title: module, data: { description: `${module} module.` } } });
  return {
    id: `${kind}-${module}`,
    key: `${kind}:${characterId}/${module}`,
    kind,
    name: `${characterId}/${module}`,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function precheck(projectId: string): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "character",
      collaboration_mode: "assisted",
      characters,
      primary_character_id: "alpha",
      export_modes: "both",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "blueprint",
    content: JSON.stringify({ kind: "blueprint", project_id: projectId, characters, primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(overrides: Partial<FactRecord> = {}): FactRecord {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "accepted",
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    coverage_targets: ["req.personality"],
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "fact-reviewer-1",
    ...overrides,
  };
}

function reviewRun(): FactReviewRunRecord {
  return {
    schema_version: 1,
    id: "run-1",
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "pol-1",
    status: "completed",
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id: "dec-1",
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted",
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: 1,
    created_at: now,
  };
}

function characterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ document: { schema_version: 1, id, display_name: id, aliases: [], summary: "Calm.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm and direct." }], provenance: [], extensions: {} } });
  return {
    id: `character-${id}`,
    key: `character:${id}`,
    kind: "character",
    name: id,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function greetingArtifact(): ArtifactRecord {
  const content = JSON.stringify({ document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } });
  return {
    id: "greeting-alpha",
    key: "greeting:alpha",
    kind: "greeting",
    name: "alpha",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function operation(id: string, kind: string): OperationRecord {
  return { id, kind, request: kind, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

async function pngBlobBytes(): Promise<Buffer> {
  const repository = new MemoryProjectRepository("blob-probe");
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    artifacts: [characterArtifact("alpha")],
    operations: [operation("op-author", "authoring")],
  }));
  return compileProject(await repository.read()).png;
}

async function commitImageWithBlob(repository: ProjectRepository, images: ImageRecord[]): Promise<ImageRecord[]> {
  const blob = await pngBlobBytes();
  const written = images.map((item) => ({ ...item, blob_hash: contentHash(blob) }));
  await repository.commit((await repository.read()).revision, (state) => ({ ...state, images: written }), {
    blobs: [{ hash: contentHash(blob), content: blob }],
  });
  return written;
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

async function baseRuntime(projectId = "batch5-runtime", dualMode = true): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository }> {
  const repository = new MemoryProjectRepository(projectId);
  const modeArtifacts = dualMode
    ? [
        ...ZHUJI_MODULES.map((module) => modeArtifact(projectId, "zhuji", "alpha", module)),
        ...PALETTE_MODULES.map((module) => modeArtifact(projectId, "palette", "saki", module)),
      ]
    : ZHUJI_MODULES.map((module) => modeArtifact(projectId, "zhuji", "alpha", module));
  const roster = dualMode ? characters : [characters[0]!];
  const pre = { ...precheck(projectId), candidate_blueprint: { ...precheck(projectId).candidate_blueprint, characters: roster } };
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [pre],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), ...(dualMode ? [characterArtifact("saki")] : []), greetingArtifact(), ...modeArtifacts],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, reviewRun()],
    fact_review_decisions: [...state.fact_review_decisions, acceptedDecision()],
  }));
  const runtime = new WorkspaceRuntime(repository);
  return { runtime, repository };
}

async function withHealthyState(projectId = "batch5-runtime", dualMode = true): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessment: CoverageAssessment }> {
  const { runtime, repository } = await baseRuntime(projectId, dualMode);
  const { assessment } = await runtime.coverageAssessment("formal");
  const state = await repository.read();
  await repository.commit(state.revision, (current) => ({
    ...current,
    coverage_assessments: current.coverage_assessments.map((item) => item.id === assessment.id
      ? { ...item, items: item.items.map((cell) => ({ ...cell, status: "covered_by_source" as const, accepted_fact_ids: ["fact-acc"] })) }
      : item),
  }));
  const ready = await repository.read();
  const plan = computeProjectProjection(ready).publishPlan();
  const coverageSensitiveArtifacts = ready.artifacts.filter((item) => item.kind === "character" || item.kind === "zhuji" || item.kind === "palette" || item.kind === "greeting");
  const requirementSet = ready.coverage_requirement_sets.at(-1)!;
  const factProjection = coverageFactProjectionRevision(ready);
  const bindings = coverageSensitiveArtifacts.map((artifact, index) => {
    const input = {
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_revision: requirementSet.revision,
      fact_projection_revision: factProjection,
      fact_review_run_id: "run-1",
      resolution_ids: [] as string[],
    };
    return {
      id: `binding-${index + 1}`,
      ...input,
      input_snapshot_hash: authoringBindingHash(input),
      created_by: "director",
      created_at: now,
    };
  });
  const reviewable = coverageSensitiveArtifacts;
  await repository.commit(ready.revision, (current) => ({
    ...current,
    coverage_authoring_bindings: bindings,
    builds: [...current.builds, {
      id: "build-1",
      operation_id: "op-build",
      status: "previewed" as const,
      artifact_ids: plan.entries.map((entry) => entry.artifact_id),
      content_hash: contentHash("build-1"),
      diagnostics: [],
      created_at: now,
    }],
    reviews: [...current.reviews, ...reviewable.map((item, index) => ({ id: `review-${index + 1}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "reviewer", status: "passed" as const, issue_ids: [], created_at: now }))],
  }));
  return { runtime, repository, assessment };
}

describe("Audit 7 batch 5: provenance image identity, both mode and forced confirmation (runtime)", () => {
  it("previews with both mode and returns the effective mode selection", async () => {
    const { runtime } = await withHealthyState("batch5-preview-both");
    const preview = await runtime.publishProvenancePreview("both");
    expect(preview.available).toBe(true);
    expect(preview.mode_selection).toBe("both");
    expect(preview.fingerprint).toBeDefined();
  });

  it("confirms a both-mode publish and stores a typed provenance_publish command", async () => {
    const { runtime, repository } = await withHealthyState("batch5-confirm-both");
    const preview = await runtime.publishProvenancePreview("both");
    const result = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "both", idempotency_key: "confirm-both-1" }, { actor: "director", attachments: [] });
    expect(result.status).toBe("completed");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
    const op = after.operations.find((item) => item.idempotency_key === "confirm-both-1");
    expect(op?.command?.type).toBe("provenance_publish");
    if (op?.command?.type === "provenance_publish") {
      expect(op.command.payload.fingerprint).toBe(preview.fingerprint);
      expect(op.command.payload.mode_selection).toBe("both");
    }
    expect(after.publishes.at(-1)?.provenance_summary?.build_snapshot_hash).toBe(preview.build_snapshot_hash);
  });

  it("rejects a stale fingerprint when an image is added after preview", async () => {
    const { runtime, repository } = await withHealthyState("batch5-image-stale", false);
    const preview = await runtime.publishProvenancePreview();
    await commitImageWithBlob(repository, [coverImage("img-new")]);
    await expect(runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] }))
      .rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
  });

  it("rejects a stale fingerprint when the crop changes after preview", async () => {
    const { runtime, repository } = await withHealthyState("batch5-crop-stale", false);
    await commitImageWithBlob(repository, [coverImage("img-cover", { crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 } })]);
    const preview = await runtime.publishProvenancePreview();
    const afterPreview = await repository.read();
    await repository.commit(afterPreview.revision, (current) => ({
      ...current,
      images: [coverImage("img-cover", { crop: { width: 640, height: 960, offset_x: 50, offset_y: 50 } })],
    }));
    await expect(runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] }))
      .rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
  });

  it("blocks natural-language publish requests with PROVENANCE_CONFIRMATION_REQUIRED", async () => {
    const { runtime, repository } = await withHealthyState("batch5-natural-language", false);
    const result = await runtime.request("發布目前卡片", { actor: "director", attachments: [] });
    expect(result.status).toBe("blocked");
    expect(result.summary).toContain("confirmation");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.audit.some((item) => item.event === "publish.confirmation_required")).toBe(true);
  });

  it("replays a confirmed operation with the saved fingerprint and does not double-publish", async () => {
    const { runtime, repository } = await withHealthyState("batch5-replay", false);
    const preview = await runtime.publishProvenancePreview();
    await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji", idempotency_key: "replay-1" }, { actor: "director", attachments: [] });
    const state = await repository.read();
    const op = state.operations.find((item) => item.idempotency_key === "replay-1")!;
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => (item.id === op.id ? { ...item, status: "running" as const, lease_owner: "worker", lease_token: "token", fencing_generation: 1 } : item)),
    }));
    const recovered = await runtime.recoverOperation(op.id, { actor: "director", attachments: [] });
    expect(recovered.status).toBe("completed");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
  });

  it("rejects recovery with a stale fingerprint when state changed after the typed command was saved", async () => {
    const { runtime, repository } = await withHealthyState("batch5-replay-stale", false);
    const preview = await runtime.publishProvenancePreview();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [...current.operations, {
        id: "op-confirm-pending",
        kind: "build",
        request: "發布（provenance 已確認）",
        actor: "director",
        status: "running" as const,
        created_at: now,
        updated_at: now,
        progress: [],
        command: { version: 1, type: "provenance_publish", payload: { fingerprint: preview.fingerprint!, mode_selection: "zhuji" } },
        lease_owner: "worker",
        lease_token: "tok",
        fencing_generation: 1,
        attempt: 1,
      }],
    }));
    await commitImageWithBlob(repository, [coverImage("img-late")]);
    const recovered = await runtime.recoverOperation("op-confirm-pending", { actor: "director", attachments: [] });
    expect(recovered.status).toBe("blocked");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.audit.some((item) => item.event === "provenance.confirmation.rejected")).toBe(true);
  });

  it("does not create a second publish on idempotent confirm replay", async () => {
    const { runtime, repository } = await withHealthyState("batch5-idempotent", false);
    const preview = await runtime.publishProvenancePreview();
    const input = { fingerprint: preview.fingerprint!, mode_selection: "zhuji" as const, idempotency_key: "same-key" };
    const first = await runtime.publishProvenanceConfirm(input, { actor: "director", attachments: [] });
    const second = await runtime.publishProvenanceConfirm(input, { actor: "director", attachments: [] });
    expect(second.operation_id).toBe(first.operation_id);
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
    expect(after.audit.filter((item) => item.event === "request.idempotent_replay").length).toBeGreaterThanOrEqual(1);
  });
});
