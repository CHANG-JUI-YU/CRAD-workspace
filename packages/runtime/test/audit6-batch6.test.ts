import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  authoringBindingHash,
  buildProvenanceCompositionSummary,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  provenanceConfirmationFingerprint,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type OperationRecord,
  type ProjectRepository,
  type SourceRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";

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

function zhujiArtifact(projectId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module, title: module, data: { description: `${module} module.` } } });
  return {
    id: `zhuji-${module}`,
    key: `zhuji:alpha/${module}`,
    kind: "zhuji",
    name: `alpha/${module}`,
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
    id: "fact-1",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "candidate",
    confidence: 0.8,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    candidate_occurrence_id: "occ-2",
    created_at: now,
    updated_at: now,
    created_by: "fact-curator",
    ...overrides,
  };
}

function acceptedAlphaFact(): FactRecord {
  return fact({
    id: "fact-acc",
    value: "calm",
    status: "accepted",
    coverage_targets: ["req.personality"],
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_by: "fact-reviewer-1",
  });
}

function reviewRun(status: "open" | "blocked" | "completed", id = "run-1", occurrenceIds: string[] = ["occ-1"]): FactReviewRunRecord {
  return {
    schema_version: 1,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: occurrenceIds,
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "pol-1",
    status,
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(factId: string, occurrenceId: string, resultingFactRevision: number, runId = "run-1", id = "dec-1"): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id,
    operation_id: "op-review",
    review_run_id: runId,
    candidate_occurrence_id: occurrenceId,
    fact_id: factId,
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted",
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: resultingFactRevision,
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

async function baseRuntime(projectId = "batch6-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; projectId: string }> {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), greetingArtifact(), ...ZHUJI_MODULES.map((module) => zhujiArtifact(projectId, module))],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, reviewRun("completed")],
    fact_review_decisions: [...state.fact_review_decisions, acceptedDecision("fact-acc", "occ-1", 1)],
  }));
  const runtime = new WorkspaceRuntime(repository);
  return { runtime, repository, projectId };
}

async function withFormalAssessment(runtime: WorkspaceRuntime, repository: ProjectRepository): Promise<{ assessment: CoverageAssessment; requirementSet: CoverageRequirementSet }> {
  const { assessment, requirement_set } = await runtime.coverageAssessment("formal");
  return { assessment, requirementSet: requirement_set };
}

async function withHealthyState(projectId = "batch6-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessment: CoverageAssessment }> {
  const { runtime, repository } = await baseRuntime(projectId);
  const { assessment } = await withFormalAssessment(runtime, repository);
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
  const bindings = coverageSensitiveArtifacts.map((artifact, index) => ({
    id: `binding-${index + 1}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: requirementSet.revision,
    fact_projection_revision: coverageFactProjectionRevision(ready),
    fact_review_run_id: "run-1",
    resolution_ids: [],
    input_snapshot_hash: authoringBindingHash({
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_revision: requirementSet.revision,
      fact_projection_revision: coverageFactProjectionRevision(ready),
      fact_review_run_id: "run-1",
      resolution_ids: [],
    }),
    created_by: "director",
    created_at: now,
  }));
  const character = ready.artifacts.find((item) => item.kind === "character")!;
  const reviewable = ready.artifacts.filter((item) => item.kind === "character" || item.kind === "zhuji" || item.kind === "greeting");
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

describe("Audit 6 batch 6: provenance preview, confirmation and dashboard (runtime)", () => {
  it("previews an available composition with fingerprint and separated hashes", async () => {
    const { runtime } = await withHealthyState("batch6-preview");
    const preview = await runtime.publishProvenancePreview();
    expect(preview.available).toBe(true);
    expect(preview.fingerprint).toBeDefined();
    expect(preview.build_snapshot_hash).toBeDefined();
    expect(preview.composition).toBeDefined();
    expect(preview.composition?.build_snapshot_hash).toBe(preview.build_snapshot_hash);
    expect(preview.composition?.compiled_content_hash).toBeUndefined();
    expect(preview.historical_decisions).toEqual([]);
  });

  it("fails closed when no formal assessment or the assessment is stale", async () => {
    const { runtime } = await baseRuntime("batch6-unavailable");
    const required = await runtime.publishProvenancePreview();
    expect(required.available).toBe(false);
    expect(required.reason).toBe("COVERAGE_ASSESSMENT_REQUIRED");

    const { runtime: runtime2, repository } = await withHealthyState("batch6-stale");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      sources: [...current.sources.map((item) => (item.id === "source-1" ? { ...item, revision: contentHash("Alpha is serene.") } : item))],
    }));
    const stale = await runtime2.publishProvenancePreview();
    expect(stale.available).toBe(false);
    expect(stale.reason).toBe("COVERAGE_ASSESSMENT_STALE");
  });

  it("publishes after confirm with the same immutable refs and audit fingerprint", async () => {
    const { runtime, repository } = await withHealthyState("batch6-confirm");
    const preview = await runtime.publishProvenancePreview();
    const result = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "confirm-key-1" }, { actor: "publisher" });
    expect(result.status).toBe("completed");
    expect(result.downstream_invalidation.invalidated).toBe(false);

    const state = await repository.read();
    expect(state.publishes).toHaveLength(1);
    const publish = state.publishes[0]!;
    const confirmed = publish.provenance_summary!;
    expect(confirmed.build_snapshot_hash).toBe(preview.build_snapshot_hash);
    expect(confirmed.compiled_content_hash).toBe(publish.content_hash);
    expect(confirmed.source_backed).toEqual(preview.composition?.source_backed);
    expect(confirmed.overrides).toEqual(preview.composition?.overrides);
    const audit = state.audit.find((item) => item.event === "publish.committed");
    expect(audit?.details.confirmation_fingerprint).toBe(preview.fingerprint);
    expect(audit?.details.build_snapshot_hash).toBe(preview.build_snapshot_hash);
    expect(audit?.details.compiled_content_hash).toBe(publish.content_hash);
    expect(audit?.details.publish_id).toBe(publish.id);
    const confirmOperation = state.operations.find((item) => item.idempotency_key === "confirm-key-1");
    expect(confirmOperation?.status).toBe("completed");
  });

  it("rejects a stale fingerprint and does not create a publish record", async () => {
    const { runtime, repository } = await withHealthyState("batch6-stale-confirm");
    const preview = await runtime.publishProvenancePreview();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      artifacts: current.artifacts.map((item) => (item.kind === "character" ? { ...item, content_hash: contentHash("changed-v2") } : item)),
    }));
    await expect(runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint! }, { actor: "publisher" }))
      .rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
  });

  it("replays the same idempotency key without creating a second publish record", async () => {
    const { runtime, repository } = await withHealthyState("batch6-replay");
    const preview = await runtime.publishProvenancePreview();
    const first = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "confirm-replay" }, { actor: "publisher" });
    expect(first.status).toBe("completed");
    const second = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, idempotency_key: "confirm-replay" }, { actor: "publisher" });
    expect(second.operation_id).toBe(first.operation_id);
    const state = await repository.read();
    expect(state.publishes).toHaveLength(1);
    expect(state.audit.some((item) => item.event === "request.idempotent_replay")).toBe(true);
  });

  it("rejects reusing an operation id with a different payload", async () => {
    const { runtime, repository } = await withHealthyState("batch6-reuse");
    const preview = await runtime.publishProvenancePreview();
    const first = await runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, operation_id: "op-confirm-1" }, { actor: "publisher" });
    expect(first.status).toBe("completed");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      artifacts: current.artifacts.map((item) => (item.kind === "character" ? { ...item, content_hash: contentHash("changed-v3") } : item)),
    }));
    await expect(runtime.publishProvenanceConfirm({ fingerprint: preview.fingerprint!, operation_id: "op-confirm-1" }, { actor: "publisher" }))
      .rejects.toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
  });

  it("exposes dashboard provenance with separated history and legacy flag", async () => {
    const { runtime, repository } = await withHealthyState("batch6-dashboard");
    const state = await repository.read();
    const legacy = buildProvenanceCompositionSummary(state, undefined, contentHash("legacy-snapshot"));
    await repository.commit(state.revision, (current) => ({
      ...current,
      builds: [...current.builds, {
        id: "build-legacy",
        operation_id: "op-legacy",
        status: "previewed" as const,
        artifact_ids: ["character-alpha"],
        content_hash: contentHash("legacy-build"),
        diagnostics: [],
        created_at: now,
        provenance_summary: legacy,
      }],
    }));
    const view = await runtime.dashboardProvenance();
    expect(view.build_id).toBe("build-legacy");
    expect(view.legacy_build_snapshot_hash).toBe(true);
    expect(view.compiled_content_hash).toBeUndefined();
    expect(view.build_snapshot_hash).toBe(legacy.build_snapshot_hash);
    expect(view.historical_decisions).toEqual([]);

    const freshState = await repository.read();
    await repository.commit(freshState.revision, (current) => ({
      ...current,
      builds: [...current.builds, {
        id: "build-new",
        operation_id: "op-new",
        status: "previewed" as const,
        artifact_ids: ["character-alpha"],
        content_hash: contentHash("new-build"),
        diagnostics: [],
        created_at: now,
        provenance_summary: buildProvenanceCompositionSummary(current, undefined, contentHash("new-snapshot"), contentHash("new-build")),
      }],
    }));
    const freshView = await runtime.dashboardProvenance();
    expect(freshView.build_id).toBe("build-new");
    expect(freshView.legacy_build_snapshot_hash).toBe(false);
    expect(freshView.compiled_content_hash).toBe(contentHash("new-build"));
    expect(freshView.build_snapshot_hash).toBe(contentHash("new-snapshot"));
  });
});
