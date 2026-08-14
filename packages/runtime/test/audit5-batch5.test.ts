import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
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
  };
}

function operation(id: string, kind: string): OperationRecord {
  return { id, kind, request: kind, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

async function coverageRuntime(): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; assessmentId: string; assessmentRevision: string }> {
  const repository = new MemoryProjectRepository("batch5-project");
  const projectId = "batch5-project";
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
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
  const { assessment } = await runtime.coverageAssessment("formal");
  return { runtime, repository, assessmentId: assessment.id, assessmentRevision: assessment.revision };
}

describe("Audit 5 batch 5: coverage production orchestration", () => {
  it("creates a research batch and queued tasks for missing coverage cells", async () => {
    const { runtime, assessmentId, assessmentRevision } = await coverageRuntime();
    const result = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    expect(result.operation_id).toBeDefined();
    expect(result.batch_id).toBeDefined();
    expect(Array.isArray(result.task_ids)).toBe(true);
    expect((result.task_ids as string[]).length).toBeGreaterThan(0);
    const state = await (runtime as unknown as { repository: ProjectRepository }).repository.read();
    expect(state.coverage_research_batches).toHaveLength(1);
    expect(state.coverage_research_tasks.length).toBeGreaterThan(0);
    expect(state.coverage_research_tasks.every((task) => task.status === "queued")).toBe(true);
    expect(state.audit.some((event) => event.event === "coverage.research.started")).toBe(true);
  });

  it("claims a research task with a lease and increments the generation", async () => {
    const { runtime, assessmentId, assessmentRevision } = await coverageRuntime();
    const started = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const claimed = await runtime.coverageResearchClaim("researcher-1", started.batch_id as string);
    expect(claimed.task).toMatchObject({ status: "claimed", claim_generation: 1, lease_owner: "researcher-1", attempt: 1 });
    expect(claimed.task.lease_expires_at).toBeDefined();
  });

  it("submits candidates that stay pending and keeps task/requirement lineage", async () => {
    const { runtime, assessmentId, assessmentRevision } = await coverageRuntime();
    const started = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const claimed = await runtime.coverageResearchCandidates ? await runtime.coverageResearchClaim("researcher-1", started.batch_id as string) : undefined;
    const task = claimed?.task as { id: string; claim_generation: number; lease_owner: string };
    const submitted = await runtime.coverageResearchCandidates("researcher-1", task.id, task.claim_generation, task.lease_owner, [
      { title: "Luna Wiki", url: "https://example.com/luna", target_requirement_ids: ["req.appearance"] },
    ]);
    expect(submitted.candidates).toHaveLength(1);
    expect(submitted.lineages).toHaveLength(1);
    const state = await (runtime as unknown as { repository: ProjectRepository }).repository.read();
    expect(state.candidates.at(-1)?.status).toBe("pending");
    expect(state.coverage_research_lineages.at(-1)).toMatchObject({ task_id: task.id, requirement_id: "req.appearance", batch_id: started.batch_id });
  });

  it("exhausts a task and derives the batch status", async () => {
    const { runtime, assessmentId, assessmentRevision } = await coverageRuntime();
    const started = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const claimed = await runtime.coverageResearchClaim("researcher-1", started.batch_id as string);
    const task = claimed?.task as { id: string; claim_generation: number; lease_owner: string };
    const exhausted = await runtime.coverageResearchExhaust("researcher-1", task.id, task.claim_generation, task.lease_owner, ["luna lore"], ["official"], "no further sources found");
    expect(exhausted.task).toMatchObject({ status: "exhausted", exhausted_reason: "no further sources found" });
    const state = await (runtime as unknown as { repository: ProjectRepository }).repository.read();
    const batch = state.coverage_research_batches.find((item) => item.id === started.batch_id);
    expect(batch).toBeDefined();
    expect(["exhausted", "open", "completed"].includes(batch!.status)).toBe(true);
  });

  it("previews resolution consequences without mutating state", async () => {
    const { runtime, repository, assessmentId, assessmentRevision } = await coverageRuntime();
    const before = await repository.read();
    const preview = await runtime.coverageResolutionPreview({
      assessment_id: assessmentId,
      assessment_revision: assessmentRevision,
      requirement_id: "req.appearance",
      character_id: "alpha",
      action: "user_supplement",
    });
    expect(preview.consequences.length).toBeGreaterThan(0);
    const after = await repository.read();
    expect(after.revision).toBe(before.revision);
    expect(after.coverage_user_decisions).toHaveLength(0);
    expect(after.coverage_resolutions).toHaveLength(0);
  });

  it("rejects a resolution confirm against a stale assessment revision", async () => {
    const { runtime, assessmentId } = await coverageRuntime();
    await expect(runtime.coverageResolutionConfirm("director", {
      assessment_id: assessmentId,
      assessment_revision: "stale-revision",
      requirement_id: "req.appearance",
      character_id: "alpha",
      action: "creative_completion",
      choice: "authorize",
      rationale: "original work",
    })).rejects.toMatchObject({ code: "COVERAGE_ASSESSMENT_STALE" });
  });

  it("confirms creative completion without fabricating sources or facts", async () => {
    const { runtime, repository, assessmentId, assessmentRevision } = await coverageRuntime();
    const confirmed = await runtime.coverageResolutionConfirm("director", {
      assessment_id: assessmentId,
      assessment_revision: assessmentRevision,
      requirement_id: "req.appearance",
      character_id: "alpha",
      action: "creative_completion",
      choice: "authorize",
      rationale: "original design",
    });
    expect(confirmed.resolutions).toHaveLength(1);
    expect(confirmed.resolutions[0]).toMatchObject({ mode: "creative_completion", status: "authorized" });
    const state = await repository.read();
    expect(state.coverage_user_decisions).toHaveLength(1);
    expect(state.sources).toHaveLength(1);
    expect(state.facts).toHaveLength(1);
    expect(state.audit.some((event) => event.event === "coverage.resolution.confirmed")).toBe(true);
  });

  it("ingests a user supplement text without requiring internal ids", async () => {
    const { runtime, repository, assessmentId, assessmentRevision } = await coverageRuntime();
    const result = await runtime.coverageSupplement("user-1", {
      assessment_id: assessmentId,
      assessment_revision: assessmentRevision,
      requirement_id: "req.background",
      character_id: "alpha",
      choice: "提供背景補充資料",
      rationale: "由作者補充背景設定",
      text: "The character grew up in the northern hills.",
    }, []);
    expect(result.source_id).toBeDefined();
    expect(result.chunk_count).toBeGreaterThan(0);
    const state = await repository.read();
    expect(state.sources.at(-1)?.provenance_kind).toBe("user_supplement");
    expect(state.knowledge_chunks.length).toBeGreaterThan(0);
    expect(state.audit.some((event) => event.event === "coverage.supplement.ingested")).toBe(true);
  });

  it("revises an exhausted task into a predecessor-linked successor", async () => {
    const { runtime, repository, assessmentId, assessmentRevision } = await coverageRuntime();
    const started = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const claimed = await runtime.coverageResearchClaim("researcher-1", started.batch_id as string);
    const task = claimed?.task as { id: string; claim_generation: number; lease_owner: string };
    await runtime.coverageResearchExhaust("researcher-1", task.id, task.claim_generation, task.lease_owner, ["query one"], ["official"], "exhausted");
    const recovered = await runtime.coverageResearchRecover("researcher-1", { task_id: task.id, action: "revise_query", query_seeds: ["revised query"] }, []);
    expect(recovered.task).toMatchObject({ status: "queued", predecessor_id: task.id });
    const state = await repository.read();
    const oldTask = state.coverage_research_tasks.find((item) => item.id === task.id);
    expect(oldTask?.status).toBe("exhausted");
    const batch = state.coverage_research_batches.find((item) => item.id === started.batch_id);
    expect(batch?.task_ids).toContain(recovered.task.id);
    expect(state.audit.some((event) => event.event === "coverage.research.recovered")).toBe(true);
  });

  it("does not duplicate records when a coverage command is replayed", async () => {
    const { runtime, repository, assessmentId, assessmentRevision } = await coverageRuntime();
    const started = await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const operationId = started.operation_id as string;
    const replay = await runtime.recoverOperation(operationId, { actor: "worker", attachments: [] });
    expect(replay.status).toBe("completed");
    const state = await repository.read();
    expect(state.coverage_research_batches).toHaveLength(1);
    expect(state.audit.filter((event) => event.event === "coverage.research.started")).toHaveLength(1);
  });

  it("exposes a coverage dashboard with per-cell actions", async () => {
    const { runtime, assessmentId, assessmentRevision } = await coverageRuntime();
    const dashboardBefore = await runtime.dashboardCoverage();
    expect(dashboardBefore.assessment).toMatchObject({ id: assessmentId, revision: assessmentRevision, pass: "formal" });
    expect(Array.isArray(dashboardBefore.cells)).toBe(true);
    const appearanceBefore = dashboardBefore.cells.find((cell: { requirement_id: string }) => cell.requirement_id === "req.appearance");
    expect(appearanceBefore).toBeDefined();
    expect(appearanceBefore!.actions).toEqual(expect.arrayContaining(["research", "supplement", "creative_completion"]));

    await runtime.coverageResearchStart("director", assessmentId, assessmentRevision);
    const dashboardAfter = await runtime.dashboardCoverage();
    const appearanceAfter = dashboardAfter.cells.find((cell: { requirement_id: string }) => cell.requirement_id === "req.appearance");
    expect(appearanceAfter).toBeDefined();
    expect(appearanceAfter!.actions).toEqual(expect.arrayContaining(["view_research_task", "supplement", "creative_completion"]));
  });
});
