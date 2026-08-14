import { describe, expect, it } from "vitest";
import {
  authoringBindingHash,
  contentHash,
  coverageFactProjectionRevision,
  createProjectState,
  type ArtifactRecord,
  type AuthoringCoverageBinding,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageAssessmentItem,
  type CoverageRequirementSet,
  type CoverageResearchLineageLink,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type ResearchBatchRecord,
  type ResearchTaskRecord,
  type SourceRecord,
} from "@st-workspace/core";
import {
  deriveArtifactCoverageLineage,
  deriveCoverageCenterMatrix,
  deriveEvidenceContextViews,
  deriveEvidenceReferenceStale,
  deriveResearchMonitor,
  deriveStructuredPublishDiagnostics,
  deriveSummaryKPIs,
  type CoverageCenterCellStatus,
  type WorkflowDiagnostic,
} from "../src/index.js";

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
    candidate_occurrence_ids: ["occ-1", "occ-2"],
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

function requirementSet(): CoverageRequirementSet {
  return {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    characters: [{ character_id: "alpha", requirement_ids: ["req.personality"] }],
    world_requirement_ids: [],
    created_by: "director",
    created_at: now,
  };
}

function formalAssessment(state: ProjectState, overrides: Partial<CoverageAssessment> = {}): CoverageAssessment {
  return {
    id: "assess-1",
    revision: contentHash("assess-1"),
    pass: "formal",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    input_snapshot: {
      blueprint_revision: contentHash("blueprint-1"),
      source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
      fact_projection_revision: coverageFactProjectionRevision(state),
      fact_review_run_id: "run-1",
      fact_review_projection_revision: contentHash("run-1"),
    },
    items: [],
    operation_id: "op-assess",
    created_by: "director",
    created_at: now,
    ...overrides,
  };
}

function assessmentItem(requirementId: string, status: CoverageAssessmentItem["status"], characterId?: string): CoverageAssessmentItem {
  return {
    ...(characterId === undefined ? {} : { character_id: characterId }),
    requirement_id: requirementId,
    status,
    candidate_fact_ids: [],
    accepted_fact_ids: [],
    research_task_ids: [],
    resolution_ids: [],
  };
}

function binding(artifact: ArtifactRecord, assessment: CoverageAssessment): AuthoringCoverageBinding {
  const base = {
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: "set-rev-1",
    fact_projection_revision: assessment.input_snapshot.fact_projection_revision ?? "",
    fact_review_run_id: "run-1" as string | undefined,
    resolution_ids: [] as string[],
  };
  return {
    id: "binding-1",
    ...base,
    input_snapshot_hash: authoringBindingHash(base),
    created_by: "director",
    created_at: now,
  };
}

function researchBatch(overrides: Partial<ResearchBatchRecord> = {}): ResearchBatchRecord {
  return {
    id: "batch-1",
    assessment_id: "assess-1",
    assessment_revision: contentHash("assess-1"),
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    status: "open",
    task_ids: ["task-1"],
    created_by: "director",
    created_at: now,
    ...overrides,
  };
}

function researchTask(overrides: Partial<ResearchTaskRecord> = {}): ResearchTaskRecord {
  return {
    id: "task-1",
    batch_id: "batch-1",
    character_id: "alpha",
    requirement_ids: ["req.personality"],
    dimension_paths: ["personality"],
    query_seeds: ["Alpha calm personality"],
    status: "running",
    claim_generation: 1,
    lease_owner: "researcher-1",
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    attempt: 1,
    searched_queries: ["Alpha calm"],
    source_families: ["wiki"],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function lineageLink(overrides: Partial<CoverageResearchLineageLink> = {}): CoverageResearchLineageLink {
  return {
    id: "link-1",
    candidate_id: "cand-1",
    source_id: "source-1",
    task_id: "task-1",
    batch_id: "batch-1",
    assessment_id: "assess-1",
    requirement_id: "req.personality",
    character_id: "alpha",
    created_at: now,
    ...overrides,
  };
}

function baseState(projectId = "batch7-domain"): ProjectState {
  const seed = createProjectState(projectId);
  return {
    ...seed,
    project_status: "ready",
    interview: { ...seed.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact()],
    fact_review_runs: [reviewRun("completed")],
    fact_review_decisions: [acceptedDecision("fact-acc", "occ-1", 1)],
  };
}

function withFormalAssessment(state: ProjectState, items: CoverageAssessmentItem[] = []): { state: ProjectState; assessment: CoverageAssessment } {
  const assessment = formalAssessment(state, { items });
  const next: ProjectState = {
    ...state,
    coverage_requirement_sets: [...state.coverage_requirement_sets, requirementSet()],
    coverage_assessments: [...state.coverage_assessments, assessment],
  };
  return { state: next, assessment };
}

describe("Audit 5 batch 7 domain", () => {
  describe("#24 evidence context views", () => {
    it("marks evidence contexts stale when the source revision or chunk hash changes", () => {
      const state = baseState();
      const freshContext = {
        source_id: "source-1",
        source_title: "source-1",
        source_revision: state.sources[0]!.revision,
        evidence_span: { start: 0, end: 15, quote: "Alpha is calm." },
      };
      expect(deriveEvidenceContextViews(state, [freshContext])[0]!.stale).toBe(false);

      const revised: ProjectState = { ...state, sources: [sourceRecord("source-1", "Alpha is calm. Revised.")] };
      const staleRevision = deriveEvidenceContextViews(revised, [freshContext])[0]!;
      expect(staleRevision.stale).toBe(true);
      expect(staleRevision.stale_reason).toContain("來源已更新");

      const chunked = { ...freshContext, chunk_id: "chunk-1", chunk_hash: contentHash("old-chunk") };
      const withChunk: ProjectState = {
        ...state,
        knowledge_chunks: [{ id: "chunk-1", source_id: "source-1", ordinal: 0, text: "Alpha is calm.", hash: contentHash("new-chunk"), created_at: now }],
      };
      const staleChunk = deriveEvidenceContextViews(withChunk, [chunked])[0]!;
      expect(staleChunk.stale).toBe(true);
      expect(staleChunk.stale_reason).toContain("chunk");

      const missing = deriveEvidenceContextViews(state, [{ ...freshContext, source_id: "source-gone" }])[0]!;
      expect(missing.stale).toBe(true);
      expect(missing.stale_reason).toContain("不存在");
    });

    it("projects evidence reference staleness against current sources", () => {
      const state = baseState();
      const reference = { source_id: "source-1", source_revision_id: state.sources[0]!.revision };
      expect(deriveEvidenceReferenceStale(state, reference).stale).toBe(false);
      const revised: ProjectState = { ...state, sources: [sourceRecord("source-1", "Alpha is calm. Revised.")] };
      const result = deriveEvidenceReferenceStale(revised, reference);
      expect(result.stale).toBe(true);
      expect(result.stale_reason).toContain("來源已更新");
    });
  });

  describe("#19 coverage center matrix", () => {
    it("maps every assessment item status to the seven cell statuses", () => {
      const { state } = withFormalAssessment(baseState(), [
        assessmentItem("req.identity", "missing", "alpha"),
        assessmentItem("req.appearance", "candidate_signal", "alpha"),
        assessmentItem("req.personality", "covered_by_source", "alpha"),
        assessmentItem("req.values", "covered_by_user_supplement", "alpha"),
        assessmentItem("req.motivation_goals", "creative_completion_authorized", "alpha"),
        assessmentItem("req.background", "conflicted", "alpha"),
      ]);
      const matrix = deriveCoverageCenterMatrix(state);
      const statuses = matrix.cells.map((cell) => cell.status);
      const expected: CoverageCenterCellStatus[] = ["missing", "candidate_signal", "source_covered", "supplement", "creative_completion", "conflict"];
      expect(statuses).toEqual(expected);
      expect(matrix.assessment).toEqual({ id: "assess-1", revision: contentHash("assess-1"), pass: "formal", fresh: true });
      expect(matrix.requirement_set).toEqual({ id: "set-1", revision: "set-rev-1" });
      const personality = matrix.cells.find((cell) => cell.requirement_id === "req.personality")!;
      expect(personality.requirement_label).toBe("人格特質");
      expect(personality.dimension_path).toBe("personality");
      expect(personality.scope).toBe("character");
      expect(personality.actions).toEqual(["view_details"]);
    });

    it("projects every cell as stale when the assessment is no longer fresh", () => {
      const { state } = withFormalAssessment(baseState(), [assessmentItem("req.personality", "covered_by_source", "alpha")]);
      const revised: ProjectState = { ...state, sources: [sourceRecord("source-1", "Alpha is calm. Revised.")] };
      const matrix = deriveCoverageCenterMatrix(revised);
      expect(matrix.assessment!.fresh).toBe(false);
      expect(matrix.stale_components.length).toBeGreaterThan(0);
      const cell = matrix.cells[0]!;
      expect(cell.status).toBe("stale");
      expect(cell.assessment_stale).toBe(true);
      expect(cell.reason).toBeDefined();
    });


    it("includes accepted/candidate fact references, evidence sources, resolutions, and research tasks per cell", () => {
      const { state, assessment } = withFormalAssessment(baseState(), [
        assessmentItem("req.personality", "covered_by_source", "alpha"),
      ]);
      const items = assessment.items.map((item) => ({ ...item, accepted_fact_ids: ["fact-acc"], candidate_fact_ids: ["fact-1"] }));
      const next: ProjectState = {
        ...state,
        facts: [...state.facts, fact()],
        coverage_assessments: [{ ...assessment, items }],
        coverage_resolutions: [{ id: "res-1", character_id: "alpha", requirement_id: "req.personality", mode: "creative_completion", status: "authorized", assessment_id: "assess-1", assessment_revision: assessment.revision, requirement_set_revision: "set-rev-1", rationale: "creative", user_decision_id: "ud-1", authorized_by: "director", operation_id: "op-res", created_by: "director", created_at: now }],
        coverage_research_batches: [researchBatch()],
        coverage_research_tasks: [researchTask()],
      };
      const cell = deriveCoverageCenterMatrix(next).cells[0]!;
      expect(cell.accepted_fact_ids).toEqual(["fact-acc"]);
      expect(cell.candidate_fact_ids).toEqual(["fact-1"]);
      expect(cell.evidence_source_ids).toContain("source-1");
      expect(cell.resolution_ids).toEqual(["res-1"]);
      expect(cell.research_task_ids).toEqual(["task-1"]);
    });
  });

  describe("#21 research monitor", () => {
    it("exposes batch and task monitoring fields with lineage", () => {
      const state: ProjectState = {
        ...baseState(),
        coverage_research_batches: [researchBatch()],
        coverage_research_tasks: [researchTask(), researchTask({ id: "task-2", status: "completed", predecessor_id: "task-1" })],
        coverage_research_lineages: [lineageLink()],
      };
      const monitor = deriveResearchMonitor(state, "2026-08-14T00:00:00.000Z");
      const batch = monitor.batches[0]!;
      expect(batch.id).toBe("batch-1");
      expect(batch.assessment_revision).toBe(contentHash("assess-1"));
      expect(batch.requirement_set_revision).toBe("set-rev-1");
      expect(batch.task_ids).toEqual(["task-1", "task-2"]);
      expect(batch.task_status_summary).toEqual({ running: 1, completed: 1 });
      const task = monitor.tasks.find((item) => item.id === "task-1")!;
      expect(task.requirement_ids).toEqual(["req.personality"]);
      expect(task.dimension_paths).toEqual(["personality"]);
      expect(task.query_seeds).toEqual(["Alpha calm personality"]);
      expect(task.claim_generation).toBe(1);
      expect(task.attempt).toBe(1);
      expect(task.lease_owner).toBe("researcher-1");
      expect(task.lease_expires_at).toBe("2099-01-01T00:00:00.000Z");
      expect(task.searched_queries).toEqual(["Alpha calm"]);
      expect(task.source_families).toEqual(["wiki"]);
      expect(task.successor_ids).toEqual(["task-2"]);
      expect(task.candidate_source_ids).toEqual(["cand-1", "source-1"]);
    });

    it("projects lease_expired without mutating the underlying task", () => {
      const task = researchTask({ lease_expires_at: "2020-01-01T00:00:00.000Z" });
      const state: ProjectState = { ...baseState(), coverage_research_tasks: [task] };
      const monitor = deriveResearchMonitor(state, "2099-02-01T00:00:00.000Z");
      expect(monitor.tasks[0]!.projected_status).toBe("lease_expired");
      expect(state.coverage_research_tasks[0]!.status).toBe("running");
      const early = deriveResearchMonitor(state, "2019-01-01T00:00:00.000Z");
      expect(early.tasks[0]!.projected_status).toBe("running");
    });
  });

  describe("#22 artifact coverage lineage", () => {
    it("projects current binding state with full lineage", () => {
      const { state, assessment } = withFormalAssessment(baseState());
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      const next: ProjectState = { ...state, coverage_authoring_bindings: [binding(artifact, assessment)] };
      const lineage = deriveArtifactCoverageLineage(next, artifact.id)!;
      expect(lineage.state).toBe("current");
      expect(lineage.assessment).toEqual({ id: "assess-1", revision: contentHash("assess-1"), fresh: true });
      expect(lineage.requirement_set).toEqual({ id: "set-1", revision: "set-rev-1" });
      expect(lineage.binding!.id).toBe("binding-1");
      expect(lineage.fact_projection_revision).toBeDefined();
      expect(lineage.fact_review_run).toEqual({ id: "run-1", projection_revision: "set-1" });
    });

    it("projects missing when there is no binding and stale when the binding no longer matches", () => {
      const { state, assessment } = withFormalAssessment(baseState());
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      expect(deriveArtifactCoverageLineage(state, artifact.id)!.state).toBe("missing");

      const nextAssessment: CoverageAssessment = formalAssessment(state, { id: "assess-2", revision: contentHash("assess-2") });
      const stale: ProjectState = {
        ...state,
        coverage_assessments: [assessment, nextAssessment],
        coverage_authoring_bindings: [binding(artifact, assessment)],
      };
      const lineage = deriveArtifactCoverageLineage(stale, artifact.id)!;
      expect(lineage.state).toBe("stale");
      expect(lineage.reason).toBeDefined();
    });

    it("projects duplicate bindings as stale and non-plan artifacts as undefined", () => {
      const { state, assessment } = withFormalAssessment(baseState());
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      const first = binding(artifact, assessment);
      const duplicate: ProjectState = {
        ...state,
        coverage_authoring_bindings: [first, { ...first, id: "binding-2", input_snapshot_hash: "hash-2" }],
      };
      const lineage = deriveArtifactCoverageLineage(duplicate, artifact.id)!;
      expect(lineage.state).toBe("stale");
      expect(lineage.reason).toContain("bindings");
      const blueprint = state.artifacts.find((item) => item.kind === "blueprint")!;
      expect(deriveArtifactCoverageLineage(duplicate, blueprint.id)).toBeUndefined();
    });
  });

  describe("#23 structured publish diagnostics", () => {
    it("maps known diagnostics to affected objects, next actions, and navigation targets", () => {
      const diagnostics: WorkflowDiagnostic[] = [
        { code: "COVERAGE_ASSESSMENT_STALE", message: "assessment stale", severity: "error", fact_ids: ["fact-1"] },
        { code: "ARTIFACT_REVIEW_REQUIRED", message: "review needed", severity: "error", artifact_ids: ["character-alpha"] },
        { code: "UNKNOWN_CODE", message: "mystery", severity: "error" },
      ];
      const structured = deriveStructuredPublishDiagnostics(diagnostics);
      expect(structured.has_unknown).toBe(true);
      const assessment = structured.rows.find((row) => row.code === "COVERAGE_ASSESSMENT_STALE")!;
      expect(assessment.severity).toBe("error");
      expect(assessment.affected).toEqual([{ kind: "fact", id: "fact-1" }]);
      expect(assessment.targets).toEqual([{ panel: "coverage", kind: "fact", id: "fact-1" }]);
      expect(assessment.target).toEqual(assessment.targets![0]);
      expect(assessment.next_action).toBeTruthy();
      expect(assessment.target!.panel).toBe("coverage");
      const review = structured.rows.find((row) => row.code === "ARTIFACT_REVIEW_REQUIRED")!;
      expect(review.affected).toEqual([{ kind: "artifact", id: "character-alpha" }]);
      expect(review.targets).toEqual([{ panel: "artifacts", kind: "artifact", id: "character-alpha" }]);
      expect(review.target!.panel).toBe("artifacts");
      const fallback = structured.rows.find((row) => row.code === "UNKNOWN_CODE")!;
      expect(fallback.next_action).toContain("Readiness");
      expect(fallback.targets).toEqual([{ panel: "readiness" }]);
      expect(fallback.target!.panel).toBe("readiness");
    });
  });

  describe("#25 summary KPIs", () => {
    it("counts unresolved requirements, conflicts, supplements, research tasks, and bindings", () => {
      const { state, assessment } = withFormalAssessment(baseState(), [
        assessmentItem("req.personality", "covered_by_source", "alpha"),
        assessmentItem("req.values", "conflicted", "alpha"),
        assessmentItem("req.identity", "missing", "alpha"),
      ]);
      const artifact = state.artifacts.find((item) => item.kind === "character")!;
      const next: ProjectState = {
        ...state,
        coverage_requirement_sets: [{ ...state.coverage_requirement_sets[0]!, characters: [{ character_id: "alpha", requirement_ids: ["req.personality", "req.values", "req.identity"] }] }],
        coverage_assessments: [{ ...assessment, items: assessment.items }],
        coverage_resolutions: [{ id: "res-1", character_id: "alpha", requirement_id: "req.values", mode: "user_supplement", status: "authorized", assessment_id: "assess-1", assessment_revision: assessment.revision, requirement_set_revision: "set-rev-1", rationale: "supplement", user_decision_id: "ud-1", authorized_by: "director", operation_id: "op-res", created_by: "director", created_at: now }],
        coverage_research_tasks: [researchTask()],
      };
      const kpis = deriveSummaryKPIs(next);
      expect(kpis.unresolved_requirements).toBeGreaterThan(0);
      expect(kpis.conflicts).toBe(1);
      expect(kpis.pending_supplements).toBe(1);
      expect(kpis.active_research_tasks).toBe(1);
      expect(kpis.stale_assessments).toBe(0);
      expect(kpis.missing_bindings).toBe(1);
      expect(kpis.stale_bindings).toBe(0);
      expect(kpis.source_backed_percent).toBeGreaterThan(0);
      expect(kpis.creative_completion_percent).toBe(0);
    });

    it("returns null percentages when no assessment exists", () => {
      const kpis = deriveSummaryKPIs(baseState());
      expect(kpis.source_backed_percent).toBeNull();
      expect(kpis.creative_completion_percent).toBeNull();
      expect(kpis.stale_assessments).toBe(0);
    });
  });
});
