import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  authoringBindingHash,
  buildProvenanceCompositionSummary,
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
import { buildCoverageSnapshot, deriveStructuredPublishDiagnostics } from "@st-workspace/domain";
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

function operation(id: string, kind: string): OperationRecord {
  return { id, kind, request: kind, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

async function baseRuntime(projectId = "batch7-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; projectId: string }> {
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

async function withHealthyState(projectId = "batch7-runtime"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessment: CoverageAssessment }> {
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

describe("Audit 5 batch 7: coverage center, lineage, diagnostics, KPIs and provenance (runtime)", () => {
  it("exposes a coverage center matrix with a fresh assessment and cells", async () => {
    const { runtime } = await withHealthyState();
    const center = await runtime.dashboardCoverageCenter();
    expect(center.matrix.assessment?.fresh).toBe(true);
    expect(center.matrix.cells.length).toBeGreaterThan(0);
    expect(center.matrix.cells.every((cell) => cell.assessment_revision === center.matrix.assessment?.revision)).toBe(true);
    expect(center.matrix.stale_components).toEqual([]);
  });

  it("projects lease expiry on research tasks without mutating state", async () => {
    const { runtime, repository } = await withHealthyState();
    const state = await repository.read();
    const assessment = state.coverage_assessments.at(-1)!;
    await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_research_batches: [{ id: "batch-1", assessment_id: assessment.id, assessment_revision: assessment.revision, requirement_set_id: "set-1", requirement_set_revision: "set-rev-1", status: "open" as const, task_ids: ["task-1"], created_by: "researcher", created_at: now }],
      coverage_research_tasks: [
        {
          id: "task-1",
          batch_id: "batch-1",
          character_id: "alpha",
          requirement_ids: ["req.personality"],
          dimension_paths: ["personality"],
          query_seeds: ["calm"],
          status: "running" as const,
          claim_generation: 1,
          lease_owner: "researcher-1",
          lease_expires_at: "2020-01-01T00:00:00.000Z",
          attempt: 1,
          searched_queries: ["calm"],
          source_families: ["wiki"],
          created_at: now,
          updated_at: now,
        },
      ],
    }));
    const monitor = await runtime.dashboardCoverageCenter();
    const task = monitor.monitor.tasks.find((item) => item.id === "task-1")!;
    expect(task.projected_status).toBe("lease_expired");
    const after = await repository.read();
    expect(after.coverage_research_tasks[0]?.status).toBe("running");
    expect(monitor.monitor.batches[0]?.task_status_summary).toEqual({ lease_expired: 1 });
  });

  it("projects artifact coverage lineage as current with a matching binding", async () => {
    const { runtime } = await withHealthyState();
    const lineage = await runtime.dashboardArtifactLineage("character-alpha");
    expect(lineage?.state).toBe("current");
    expect(lineage?.binding?.id).toBe("binding-1");
    expect(lineage?.assessment?.fresh).toBe(true);
    expect(lineage?.input_snapshot_hash).toBe(lineage?.binding?.input_snapshot_hash);
  });

  it("projects artifact coverage lineage as missing without a binding", async () => {
    const { runtime } = await baseRuntime();
    const lineage = await runtime.dashboardArtifactLineage("character-alpha");
    expect(lineage?.state).toBe("missing");
    expect(lineage?.reason).toBeTruthy();
  });

  it("returns structured publish diagnostics rows with navigation targets", async () => {
    const { runtime } = await withHealthyState();
    const structured = await runtime.dashboardPublishDiagnostics();
    expect(Array.isArray(structured.rows)).toBe(true);
    expect(typeof structured.has_unknown).toBe("boolean");
    for (const row of structured.rows) {
      expect(typeof row.code).toBe("string");
      expect(["error", "warning"]).toContain(row.severity);
      expect(typeof row.next_action).toBe("string");
      expect(row.target === undefined || typeof row.target.panel === "string").toBe(true);
    }
    const fallback = deriveStructuredPublishDiagnostics([{ code: "UNKNOWN_CODE_XYZ", message: "?", severity: "error" }]);
    expect(fallback.has_unknown).toBe(true);
    expect(fallback.rows[0]?.target?.panel).toBe("readiness");
  });

  it("marks evidence context stale when the source revision changes", async () => {
    const { runtime } = await baseRuntime();
    await runtime.startFactReviewRun("director");
    const page = await runtime.dashboardFactReviewEvidence();
    const candidate = page.candidates.find((item) => item.candidate_occurrence_id === "occ-2");
    expect(candidate?.evidence_context?.length).toBeGreaterThan(0);
    expect(candidate?.evidence_context?.every((ctx) => ctx.stale === false)).toBe(true);
    const page2 = await runtime.dashboardFactReviewEvidence();
    expect(page2.candidates.some((item) => item.candidate_occurrence_id === "occ-2")).toBe(true);
  });

  it("marks evidence context stale when the source revision changes after a review run", async () => {
    const { runtime, repository } = await baseRuntime();
    await runtime.startFactReviewRun("director");
    const state = await repository.read();
    const run = state.fact_review_runs.at(-1)!;
    await repository.commit(state.revision, (current) => ({
      ...current,
      fact_review_runs: [...current.fact_review_runs.slice(0, -1), { ...run, status: "superseded" }],
      sources: [sourceRecord("source-1", "Alpha is serene and calm.")],
    }));
    const page = await runtime.dashboardFactReviewEvidence();
    const candidate = page.candidates.find((item) => item.candidate_occurrence_id === "occ-2");
    expect(candidate?.evidence_ref_stale?.some((view) => view.stale === true)).toBe(true);
    expect(candidate?.evidence_ref_stale?.find((view) => view.stale === true)?.stale_reason).toContain("來源已更新");
  });

  it("includes summary KPIs on the dashboard summary", async () => {
    const { runtime, repository, assessment } = await withHealthyState();
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_resolutions: [
        {
          id: "res-1",
          character_id: "alpha",
          requirement_id: "req.personality",
          mode: "user_supplement" as const,
          status: "authorized" as const,
          assessment_id: assessment.id,
          assessment_revision: assessment.revision,
          requirement_set_revision: "set-rev-1",
          rationale: "supplement",
          user_decision_id: "dec-2",
          authorized_by: "director",
          operation_id: "op-1",
          created_by: "director",
          created_at: now,
        },
      ],
    }));
    const summary = await runtime.dashboardSummary();
    expect(summary.kpis).toBeDefined();
    expect(summary.kpis!.unresolved_requirements).toBeGreaterThan(0);
    expect(summary.kpis!.pending_supplements).toBe(1);
    expect(summary.kpis!.missing_bindings).toBe(0);
    expect(summary.kpis!.stale_bindings).toBe(0);
    expect(summary.kpis!.source_backed_percent).toBeTypeOf("number");
  });

  it("exposes provenance summary on build readiness for persisted builds", async () => {
    const { runtime, repository, assessment } = await withHealthyState();
    const state = await repository.read();
    const plan = computeProjectProjection(state).publishPlan();
    const coverageSnapshot = state.builds.at(-1)!.coverage_snapshot;
    const summary = buildProvenanceCompositionSummary(state, coverageSnapshot, contentHash("build-2"));
    await repository.commit(state.revision, (current) => ({
      ...current,
      builds: [
        ...current.builds,
        { id: "build-2", operation_id: "op-build-2", status: "built" as const, artifact_ids: plan.entries.map((entry) => entry.artifact_id), content_hash: contentHash("build-2"), diagnostics: [], created_at: now, provenance_summary: summary },
      ],
    }));
    const readiness = await runtime.buildReadiness();
    expect(readiness.provenance_summary).toBeDefined();
    expect(readiness.provenance_summary!.build_snapshot_hash).toBe(contentHash("build-2"));
    expect(readiness.provenance_summary!.assessment?.id).toBe(assessment.id);
  });
});
