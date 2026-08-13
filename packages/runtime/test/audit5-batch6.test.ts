import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  artifactDependencyFingerprint,
  authoringBindingHash,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
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
import { buildCoverageSnapshot } from "@st-workspace/domain";
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
  { id: "beta", label: "Beta", ordinal: 2, mode: "palette" },
];

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

function reviewRun(status: "open" | "blocked" | "completed", id = "run-1"): FactReviewRunRecord {
  return {
    schema_version: 1,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
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
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact(), fact()],
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
  const plan = computeProjectProjection(state).publishPlan();
  const artifact = state.artifacts.find((item) => item.kind === "character")!;
  const requirementSet = state.coverage_requirement_sets.at(-1)!;
  const binding = {
    id: "binding-1",
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: requirementSet.revision,
    fact_projection_revision: coverageFactProjectionRevision(state),
    fact_review_run_id: "run-1",
    resolution_ids: [],
    input_snapshot_hash: authoringBindingHash({
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_revision: requirementSet.revision,
      fact_projection_revision: coverageFactProjectionRevision(state),
      fact_review_run_id: "run-1",
      resolution_ids: [],
    }),
    created_by: "director",
    created_at: now,
  };
  const build = {
    id: "build-1",
    operation_id: "op-build",
    status: "previewed" as const,
    artifact_ids: plan.entries.map((entry) => entry.artifact_id),
    content_hash: contentHash("build-1"),
    diagnostics: [],
    created_at: now,
    coverage_snapshot: buildCoverageSnapshot({ ...state, coverage_authoring_bindings: [binding] }, assessment, plan),
  };
  await repository.commit(state.revision, (current) => ({
    ...current,
    coverage_authoring_bindings: [binding],
    builds: [...current.builds, build],
    reviews: [...current.reviews, { id: "review-1", artifact_id: artifact.id, artifact_revision: artifact.revision, reviewer: "reviewer", status: "passed" as const, issue_ids: [], created_at: now }],
  }));
  return { runtime, repository, assessment };
}

describe("Audit 5 batch 6: workflow invalidation read model (runtime)", () => {
  it("returns a structured empty invalidation report on the first coverage mutation", async () => {
    const { runtime } = await baseRuntime();
    const result = await runtime.coverageAssessment("formal");
    expect(result.downstream_invalidation).toBeDefined();
    expect(result.downstream_invalidation.invalidated).toBe(false);
    expect(result.downstream_invalidation.items).toHaveLength(0);
    expect(result.downstream_invalidation.sources.some((source) => source.kind === "coverage_assessment")).toBe(true);
  });

  it("reports assessment and snapshot invalidation from a new fact review run", async () => {
    const { runtime } = await withHealthyState();
    const started = await runtime.startFactReviewRun("director");
    const report = (started as { downstream_invalidation: { invalidated: boolean; items: { reason_code: string; reason: string }[] } }).downstream_invalidation;
    expect(report.invalidated).toBe(true);
    expect(report.items.some((item) => item.reason_code === "COVERAGE_ASSESSMENT_STALE" && item.reason.includes("fact_review_run"))).toBe(true);
    expect(report.items.some((item) => item.reason_code === "COVERAGE_PUBLISH_SNAPSHOT_STALE")).toBe(true);
  });

  it("reports binding invalidation when a fresh coverage assessment is recorded", async () => {
    const { runtime } = await withHealthyState();
    const second = await runtime.coverageAssessment("formal");
    expect(second.downstream_invalidation.invalidated).toBe(true);
    expect(second.downstream_invalidation.items.some((item) => item.reason_code === "COVERAGE_AUTHORING_BINDING_STALE" && item.reason.includes("assessment"))).toBe(true);
    expect(second.downstream_invalidation.items.some((item) => item.reason_code === "COVERAGE_PUBLISH_SNAPSHOT_STALE")).toBe(true);
  });

  it("keeps mutation responses authoritative after external source changes", async () => {
    const { runtime, repository, assessment } = await withHealthyState();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      sources: [sourceRecord("source-1", "Alpha is calm and measured.")],
    }));
    const current = await runtime.dashboardInvalidations();
    expect(current.items.some((item) => item.reason_code === "COVERAGE_ASSESSMENT_STALE" && item.reason.includes("sources"))).toBe(true);
    const started = await runtime.coverageResearchStart("director", assessment.id, assessment.revision);
    expect(started.downstream_invalidation.invalidated).toBe(false);
  });

  it("does not duplicate records when a coverage command is replayed", async () => {
    const { runtime, repository, assessment } = await withHealthyState();
    const started = await runtime.coverageResearchStart("director", assessment.id, assessment.revision);
    expect(started.downstream_invalidation.invalidated).toBe(false);
    const replay = await runtime.recoverOperation(started.operation_id as string, { actor: "worker", attachments: [] });
    expect(replay.status).toBe("completed");
    expect((replay as { downstream_invalidation?: { invalidated: boolean } }).downstream_invalidation?.invalidated).toBe(false);
    const state = await repository.read();
    expect(state.coverage_research_batches).toHaveLength(1);
    expect(state.audit.filter((event) => event.event === "coverage.research.started")).toHaveLength(1);
  });

  it("exposes a nine-stage workflow model through the runtime", async () => {
    const { runtime } = await withHealthyState();
    const workflow = await runtime.dashboardWorkflow();
    expect(workflow.is_source_adaptation).toBe(true);
    expect(workflow.stages).toHaveLength(9);
    expect(workflow.stages.map((stage) => stage.id)).toEqual(["sources", "fact_curation", "fact_review", "coverage", "research_resolution", "authoring", "review", "preview", "publish"]);
    expect(workflow.current_stage).toBeDefined();
    const statuses = new Set(workflow.stages.map((stage) => stage.status));
    for (const status of statuses) {
      expect(["completed", "current", "blocked", "stale", "not_applicable"]).toContain(status);
    }
  });

  it("reports current invalidations through the runtime and marks upstream stages stale", async () => {
    const { runtime, repository } = await withHealthyState();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      sources: [sourceRecord("source-1", "Alpha is calm and measured.")],
    }));
    const invalidations = await runtime.dashboardInvalidations();
    expect(invalidations.invalidated).toBe(true);
    const workflow = await runtime.dashboardWorkflow();
    expect(workflow.stages.find((stage) => stage.id === "fact_review")?.status).toBe("stale");
    expect(workflow.stages.find((stage) => stage.id === "coverage")?.status).toBe("blocked");
    expect(workflow.current_stage).toBe("fact_review");
  });

  it("returns a not-applicable model for non source-adaptation projects", async () => {
    const { runtime } = await baseRuntime("batch6-other");
    const repository = (runtime as unknown as { repository: ProjectRepository }).repository;
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      interview: { ...current.interview, flow: "character" },
    }));
    const workflow = await runtime.dashboardWorkflow();
    expect(workflow.is_source_adaptation).toBe(false);
    expect(workflow.stages).toHaveLength(9);
    expect(workflow.stages.every((stage) => stage.status === "not_applicable")).toBe(true);
  });
});
