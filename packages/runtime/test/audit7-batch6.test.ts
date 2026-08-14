import { describe, expect, it } from "vitest";
import {
  CoreError,
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
  return { id, kind: kind as any, request: kind, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

async function baseRuntime(projectId = "batch6-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository }> {
  const repository = new MemoryProjectRepository(projectId);
  const modeArtifacts = ZHUJI_MODULES.map((module) => modeArtifact(projectId, "zhuji", "alpha", module));
  const pre = { ...precheck(projectId), candidate_blueprint: { ...precheck(projectId).candidate_blueprint, characters } };
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [pre],
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

async function withHealthyState(projectId = "batch6-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessment: CoverageAssessment }> {
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
      id: `binding-${artifact.id}-${index}`,
      ...input,
      input_snapshot_hash: authoringBindingHash(input),
      created_by: "director",
      created_at: now,
    };
  });
  const reviewable = ready.artifacts.filter((item) => item.kind !== "blueprint");
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

describe("Audit 7 Batch 6 - Runtime Provenance Confirm Idempotent Replay (#77, #92, #100)", () => {
  it("#77, #92: initial confirm succeeds and returns full publish outcome", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-1");
    const preview = await runtime.publishProvenancePreview();
    expect(preview.available).toBe(true);
    expect(preview.fingerprint).toBeDefined();

    const idempotencyKey = "key-publish-1";
    const result = await runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] });

    expect(result.status).toBe("completed");
    expect(result.operation_id).toBeDefined();
    expect(result.build_id).toBeDefined();
    expect(result.publish_id).toBeDefined();
    expect(result.published_at).toBeDefined();
    expect(result.idempotent_replay).toBe(false);
    expect(result.completed).toContain(result.build_id);
    expect(result.completed).toContain(result.publish_id);

    const state = await repository.read();
    expect(state.publishes.length).toBe(1);
    expect(state.builds.filter((b) => b.status === "built").length).toBe(1);
    expect(state.operations.filter((o) => o.command?.type === "provenance_publish").length).toBe(1);
  });

  it("#77, #92: idempotent replay returns identical outcome without live state validation even after state changes", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-2");
    const preview = await runtime.publishProvenancePreview();
    const idempotencyKey = "key-publish-2";

    const firstResult = await runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] });

    expect(firstResult.status).toBe("completed");
    const stateAfterFirst = await repository.read();
    const buildsCountAfterFirst = stateAfterFirst.builds.length;
    const publishesCountAfterFirst = stateAfterFirst.publishes.length;

    // Modify state (e.g. add a new source/fact/artifact) so that live preview fingerprint changes
    await repository.commit(stateAfterFirst.revision, (current) => ({
      ...current,
      sources: [...current.sources, sourceRecord("source-2", "New extraneous source text.")],
    }));

    // Replay with identical key and original fingerprint
    const replayResult = await runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] });

    expect(replayResult.status).toBe("completed");
    expect(replayResult.idempotent_replay).toBe(true);
    expect(replayResult.operation_id).toBe(firstResult.operation_id);
    expect(replayResult.build_id).toBe(firstResult.build_id);
    expect(replayResult.publish_id).toBe(firstResult.publish_id);
    expect(replayResult.published_at).toBe(firstResult.published_at);
    expect(replayResult.completed).toEqual(firstResult.completed);

    // Verify record counts have not increased
    const afterState = await repository.read();
    expect(afterState.publishes.length).toBe(publishesCountAfterFirst);
    expect(afterState.builds.length).toBe(buildsCountAfterFirst);
    expect(afterState.operations.filter((o) => o.command?.type === "provenance_publish").length).toBe(1);
  });

  it("#77: rejects replay when same idempotency key is paired with different fingerprint", async () => {
    const { runtime } = await withHealthyState("batch6-test-3");
    const preview = await runtime.publishProvenancePreview();
    const idempotencyKey = "key-publish-3";

    await runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] });

    // Retry with different fingerprint
    await expect(runtime.publishProvenanceConfirm({
      fingerprint: "different-fingerprint-xxx",
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] })).rejects.toThrowError(CoreError);
  });

  it("#77: rejects replay when same idempotency key is paired with different mode_selection", async () => {
    const { runtime } = await withHealthyState("batch6-test-4");
    const preview = await runtime.publishProvenancePreview("zhuji");
    const idempotencyKey = "key-publish-4";

    await runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      mode_selection: "zhuji",
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] });

    // Retry with conflicting mode_selection
    await expect(runtime.publishProvenanceConfirm({
      fingerprint: preview.fingerprint!,
      mode_selection: "palette",
      idempotency_key: idempotencyKey,
    }, { actor: "director", attachments: [] })).rejects.toThrowError(CoreError);
  });

  it("#77: fails closed when operation_id and idempotency_key point to different operations", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-5");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        {
          id: "op-diff-1",
          kind: "build",
          request: "publish 1",
          status: "completed",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-1",
          command: { version: 1, type: "provenance_publish", payload: { fingerprint: "fp-1" } },
        },
        {
          id: "op-diff-2",
          kind: "build",
          request: "publish 2",
          status: "completed",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-2",
          command: { version: 1, type: "provenance_publish", payload: { fingerprint: "fp-1" } },
        },
      ],
    }));

    await expect(runtime.publishProvenanceConfirm({
      fingerprint: "fp-1",
      operation_id: "op-diff-1",
      idempotency_key: "key-2",
    }, { actor: "director", attachments: [] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("#77: rejects replay when operation_id points to non-publish command", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-6");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        {
          id: "op-non-publish",
          kind: "authoring",
          request: "authoring proposal",
          status: "completed",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-non-publish",
          command: { version: 1, type: "template_proposal", payload: { template_kind: "character", values: {} } as any },
        },
      ],
    }));

    await expect(runtime.publishProvenanceConfirm({
      fingerprint: "fp-1",
      operation_id: "op-non-publish",
    }, { actor: "director", attachments: [] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("#77: returns in-flight status for running operation without spawning a new one", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-7");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        {
          id: "op-running-1",
          kind: "build",
          request: "publish running",
          status: "running",
          result_summary: "發布正在進行中...",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-running-1",
          command: { version: 1, type: "provenance_publish", payload: { fingerprint: "fp-running" } },
        },
      ],
    }));

    const result = await runtime.publishProvenanceConfirm({
      fingerprint: "fp-running",
      idempotency_key: "key-running-1",
    }, { actor: "director", attachments: [] });

    expect(result.status).toBe("running");
    expect(result.idempotent_replay).toBe(true);
    expect(result.summary).toContain("發布正在進行中");

    const afterState = await repository.read();
    expect(afterState.operations.filter((o) => o.id === "op-running-1").length).toBe(1);
    expect(afterState.publishes.length).toBe(0);
  });

  it("#77: preserves terminal outcome for failed or blocked operations without re-running", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-8");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        {
          id: "op-failed-1",
          kind: "build",
          request: "publish failed",
          status: "failed",
          result_summary: "發布失敗：資源不足",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-failed-1",
          command: { version: 1, type: "provenance_publish", payload: { fingerprint: "fp-failed" } },
        },
      ],
    }));

    const result = await runtime.publishProvenanceConfirm({
      fingerprint: "fp-failed",
      idempotency_key: "key-failed-1",
    }, { actor: "director", attachments: [] });

    expect(result.status).toBe("failed");
    expect(result.idempotent_replay).toBe(true);
    expect(result.summary).toContain("發布失敗");

    const afterState = await repository.read();
    expect(afterState.publishes.length).toBe(0);
  });

  it("#77: handles concurrent confirm calls with the same key safely", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-9");
    const preview = await runtime.publishProvenancePreview();
    const idempotencyKey = "key-concurrent-1";

    const [res1, res2] = await Promise.all([
      runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: idempotencyKey }, { actor: "director", attachments: [] }),
      runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: idempotencyKey }, { actor: "director", attachments: [] }),
    ]);

    // One of them is completed, the other is in-flight (running) or replayed completed
    const completedRes = res1.status === "completed" ? res1 : res2;
    const concurrentRes = res1.status === "completed" ? res2 : res1;

    expect(completedRes.status).toBe("completed");
    expect(concurrentRes.operation_id).toBe(completedRes.operation_id);
    expect(concurrentRes.idempotent_replay).toBe(true);

    // After completion, another replay returns completed with same IDs
    const res3 = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: idempotencyKey }, { actor: "director", attachments: [] });
    expect(res3.status).toBe("completed");
    expect(res3.idempotent_replay).toBe(true);
    expect(res3.build_id).toBe(completedRes.build_id);
    expect(res3.publish_id).toBe(completedRes.publish_id);
    expect(res3.published_at).toBe(completedRes.published_at);

    const state = await repository.read();
    expect(state.publishes.length).toBe(1);
    expect(state.builds.filter((b) => b.status === "built").length).toBe(1);
    expect(state.operations.filter((o) => o.command?.type === "provenance_publish").length).toBe(1);
  });

  it("#92: does not mismatch recent build/publish when replaying legacy operation missing records", async () => {
    const { runtime, repository } = await withHealthyState("batch6-test-10");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        {
          id: "op-legacy-1",
          kind: "build",
          request: "publish legacy",
          status: "completed",
          created_at: now,
          updated_at: now,
          progress: [],
          idempotency_key: "key-legacy-1",
          command: { version: 1, type: "provenance_publish", payload: { fingerprint: "fp-legacy" } },
        },
      ],
    }));

    const result = await runtime.publishProvenanceConfirm({
      fingerprint: "fp-legacy",
      idempotency_key: "key-legacy-1",
    }, { actor: "director", attachments: [] });

    expect(result.status).toBe("completed");
    expect(result.idempotent_replay).toBe(true);
    // Should NOT attach build-1 or any other operation's build/publish
    expect(result.publish_id).toBeUndefined();
    expect(result.published_at).toBeUndefined();
  });
});
