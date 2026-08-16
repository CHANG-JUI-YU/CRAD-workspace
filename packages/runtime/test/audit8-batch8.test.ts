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
  type OperationRecord,
  type ProjectRepository,
  type SourceRecord,
} from "@st-workspace/core";
import { compileProject } from "@st-workspace/compiler";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-18T00:00:00.000Z";

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
];

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];

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
      export_modes: "zhuji",
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

async function baseRuntime(projectId = "batch8-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository }> {
  const repository = new MemoryProjectRepository(projectId);
  const modeArtifacts = ZHUJI_MODULES.map((module) => modeArtifact(projectId, "zhuji", "alpha", module));
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), greetingArtifact(), ...modeArtifacts],
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

async function withHealthyState(projectId = "batch8-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessment: CoverageAssessment }> {
  const { runtime, repository } = await baseRuntime(projectId);
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
  const coverageSensitiveArtifacts = ready.artifacts.filter((item) => item.kind === "character" || item.kind === "zhuji" || item.kind === "greeting");
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
    reviews: [...current.reviews, ...coverageSensitiveArtifacts.map((item, index) => ({ id: `review-${index + 1}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "reviewer", status: "passed" as const, issue_ids: [], created_at: now }))],
  }));
  return { runtime, repository, assessment };
}

describe("Audit 8 batch 8: durable publish intent and publish-completion handoff (runtime)", () => {
  it("replays the same confirmed publish without creating a second record", async () => {
    const { runtime, repository } = await withHealthyState("batch8-replay");
    const preview = await runtime.publishProvenancePreview();
    const first = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    expect(first.execution_kind).toBe("new");
    expect(first.publish_id).toBeDefined();
    const second = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    expect(second.execution_kind).toBe("replayed");
    expect(second.publish_id).toBe(first.publish_id);
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
    expect(after.publish_intents).toHaveLength(1);
    expect(after.publish_intents.at(-1)?.status).toBe("completed");
  });

  it("creates a fresh intent and publish when republish is explicitly requested", async () => {
    const { runtime, repository } = await withHealthyState("batch8-republish");
    const preview = await runtime.publishProvenancePreview();
    const first = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    const second = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji", republish: true }, { actor: "director", attachments: [] });
    expect(second.execution_kind).toBe("republished");
    expect(second.publish_id).not.toBe(first.publish_id);
    const after = await repository.read();
    expect(after.publishes).toHaveLength(2);
    expect(after.publish_intents).toHaveLength(2);
    expect(after.publish_intents.at(-1)?.republished).toBe(true);
  });

  it("resumes a pending intent whose operation is still running", async () => {
    const { runtime, repository } = await withHealthyState("batch8-resume");
    const preview = await runtime.publishProvenancePreview();
    const state = await repository.read();
    const intentId = "intent-pending-1";
    await repository.commit(state.revision, (current) => ({
      ...current,
      publish_intents: [...current.publish_intents, {
        id: intentId,
        fingerprint: preview.fingerprint!,
        mode_selection: "zhuji",
        output_plan: preview.output_plan,
        operation_id: "op-running-1",
        status: "pending" as const,
        created_at: now,
        updated_at: now,
      }],
      operations: [...current.operations, { id: "op-running-1", kind: "build", request: "發布（provenance 已確認）", actor: "director", status: "running", created_at: now, updated_at: now, progress: [] }],
    }));
    const result = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    expect(result.execution_kind).toBe("resumed");
    expect(result.operation_id).toBe("op-running-1");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
  });

  it("rejects a stale fingerprint for the old intent and requires re-preview", async () => {
    const { runtime, repository } = await withHealthyState("batch8-stale");
    const preview = await runtime.publishProvenancePreview();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      sources: [sourceRecord("source-2", "Alpha is serene and calm now.")],
    }));
    await expect(runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] }))
      .rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.publish_intents).toHaveLength(0);
  });

  it("reports publish completion with verified files from the final PublishRecord", async () => {
    const { runtime } = await withHealthyState("batch8-completion");
    const preview = await runtime.publishProvenancePreview();
    const result = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    const completion = await runtime.publishCompletion(result.publish_id!);
    expect(completion.publish_id).toBe(result.publish_id);
    expect(completion.result_kind).toBe("new");
    expect(completion.files).toHaveLength(2);
    expect(completion.files.every((file) => file.status === "verified")).toBe(true);
    expect(completion.files.some((file) => file.kind === "json" && file.content_hash.length === 64)).toBe(true);
    expect(completion.files.some((file) => file.kind === "png" && file.content_hash.length === 64)).toBe(true);
    expect(completion.mode).toBe("zhuji");
  });

  it("reports legacy result kind and unverifiable state for legacy publishes", async () => {
    const { runtime, repository } = await withHealthyState("batch8-legacy-publish");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: [...current.publishes, {
        id: "publish-legacy-1",
        operation_id: "op-legacy-1",
        artifact_ids: [],
        content_hash: contentHash("legacy-json"),
        export_json_path: "exports/雪乃-珠璣角色卡.json",
        export_png_path: "exports/雪乃-珠璣角色卡.png",
        created_at: now,
      }],
    }));
    const completion = await runtime.publishCompletion("publish-legacy-1");
    expect(completion.result_kind).toBe("legacy");
    expect(completion.files).toHaveLength(2);
    expect(completion.files.every((file) => file.status === "missing")).toBe(true);
    expect(completion.files.every((file) => file.content_hash === "")).toBe(true);
  });

  it("downloads verified json content with base64 body", async () => {
    const { runtime, repository } = await withHealthyState("batch8-download");
    const preview = await runtime.publishProvenancePreview();
    const result = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, mode_selection: "zhuji" }, { actor: "director", attachments: [] });
    const download = await runtime.publishDownload(result.publish_id!, "json");
    expect(download.media_type).toBe("application/json");
    expect(download.filename).toContain("珠璣角色卡");
    expect(download.content.length).toBeGreaterThan(0);
    const publish = (await repository.read()).publishes.find((item) => item.id === result.publish_id);
    expect(contentHash(Buffer.from(download.content.buffer, download.content.byteOffset, download.content.byteLength))).toBe(publish?.content_hash);
  });

  it("rejects download paths that escape the export root", async () => {
    const { runtime, repository } = await withHealthyState("batch8-path");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: [...current.publishes, {
        id: "publish-path-1",
        operation_id: "op-path-1",
        artifact_ids: [],
        content_hash: contentHash("x"),
        content_ref: { hash: contentHash("x"), size: 1 },
        output_plan: {
          mode: "zhuji" as const,
          sanitized_name: "雪乃",
          json_path: "../../etc/passwd",
          png_path: "exports/雪乃-珠璣角色卡.png",
        },
        export_json_path: "../../etc/passwd",
        export_png_path: "exports/雪乃-珠璣角色卡.png",
        created_at: now,
      }],
    }));
    await expect(runtime.publishDownload("publish-path-1", "json"))
      .rejects.toMatchObject({ code: "PUBLISH_DOWNLOAD_PATH_INVALID" });
  });

  it("reports missing blobs and hash mismatches with structured errors", async () => {
    const { runtime, repository } = await withHealthyState("batch8-missing");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      publishes: [...current.publishes, {
        id: "publish-missing-1",
        operation_id: "op-missing-1",
        artifact_ids: [],
        content_hash: contentHash("missing"),
        content_ref: { hash: contentHash("no-such-blob"), size: 4 },
        output_plan: {
          mode: "zhuji" as const,
          sanitized_name: "雪乃",
          json_path: "exports/雪乃-珠璣角色卡.json",
          png_path: "exports/雪乃-珠璣角色卡.png",
        },
        export_json_path: "exports/雪乃-珠璣角色卡.json",
        export_png_path: "exports/雪乃-珠璣角色卡.png",
        created_at: now,
      }],
    }));
    await expect(runtime.publishDownload("publish-missing-1", "json"))
      .rejects.toMatchObject({ code: "PUBLISH_DOWNLOAD_MISSING" });
  });
});
