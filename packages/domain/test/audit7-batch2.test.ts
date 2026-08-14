import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import {
  deriveAssessmentWideResearchProjection,
  deriveCoverageAssessmentEligibility,
  deriveCoverageCenterMatrix,
  deriveRequirementResearchEligibility,
  recordUserDecisionAndResolution,
  resolveResearchTargets,
  runFormalCoverageAssessment,
  runInitialCoverageAssessment,
} from "../src/index.js";

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

function precheck(projectId: string): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      title: "Test Blueprint",
      source_adaptation: true,
      characters: [{ id: "alpha", label: "Alpha", is_primary: true }],
      world: { enabled: false },
      relationships: { enabled: false },
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    status: "recorded",
    checks: [
      { subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    created_at: now,
  };
}

function baseState(projectId = "batch7-2-domain"): ProjectState {
  const base = createProjectState(projectId, "Batch7-2 Domain Test");
  const pc = precheck(projectId);
  const reqSet: CoverageRequirementSet = {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.identity", "req.personality", "req.appearance"] }],
    world_requirement_ids: [],
    created_by: "director",
    created_at: now,
  };
  const src = sourceRecord("source-1", "Alpha is calm.");
  const run: FactReviewRunRecord = {
    id: "run-1",
    status: "completed",
    candidate_occurrence_ids: ["occ-1"],
    candidate_set_revision: "cset-1",
    policy_revision: "policy-1",
    created_by: "reviewer",
    created_at: now,
    source_revisions: [{ source_id: src.id, revision: src.revision }],
  };
  const dec: FactReviewDecisionRecord = {
    id: "dec-1",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted",
    resulting_fact_revision: 1,
    reviewer_identity: "reviewer",
    reason: "proven",
    created_at: now,
  };
  return {
    ...base,
    project_status: "ready",
    interview: { ...base.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [pc],
    sources: [src],
    fact_review_runs: [run],
    fact_review_decisions: [dec],
    coverage_requirement_sets: [reqSet],
  };
}

describe("Audit 7 Batch 2 - Issue #78 Resolution Lineage and Freshness", () => {
  it("creative_completion resolution renders current assessment stale and non-actionable", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    // Before decision: assessment is fresh and actionable
    const beforeEligibility = deriveCoverageAssessmentEligibility(withFormal);
    expect(beforeEligibility.actionable).toBe(true);
    expect(beforeEligibility.fresh).toBe(true);

    // Confirm creative completion for req.personality
    const decisionRes = recordUserDecisionAndResolution(
      withFormal,
      "creative_completion",
      ["req.personality"],
      "授權創作補全",
      "來源不足，授權補全",
      "授權創作補全",
      "director",
      "op-decision-1",
      "alpha",
    );

    const withDecision = decisionRes.state;

    // After creative completion: assessment becomes stale and non-actionable
    const afterEligibility = deriveCoverageAssessmentEligibility(withDecision);
    expect(afterEligibility.actionable).toBe(false);
    expect(afterEligibility.fresh).toBe(false);
    expect(afterEligibility.reason_code).toBe("COVERAGE_ASSESSMENT_STALE");

    // Coverage Center matrix flags assessment as stale with resolutions in stale_components
    const matrix = deriveCoverageCenterMatrix(withDecision);
    expect(matrix.stale_components).toContain("resolutions");
    expect(matrix.assessment?.fresh).toBe(false);
    expect(matrix.assessment?.actionable).toBe(false);
  });

  it("user_supplement pending resolution does NOT render current assessment stale", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    // Confirm user_supplement (creates pending resolution)
    const decisionRes = recordUserDecisionAndResolution(
      withFormal,
      "user_supplement",
      ["req.personality"],
      "提供補充資料",
      "即將上傳補充資料",
      "提供補充資料",
      "director",
      "op-decision-supp-1",
      "alpha",
    );

    const withPendingDecision = decisionRes.state;

    // Pending user_supplement resolution must NOT make assessment stale before supplement ingest
    const eligibility = deriveCoverageAssessmentEligibility(withPendingDecision);
    expect(eligibility.fresh).toBe(true);
    expect(eligibility.actionable).toBe(true);
  });

  it("recordUserDecisionAndResolution prevents duplicate active resolutions for the same scope", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    const first = recordUserDecisionAndResolution(
      withFormal,
      "creative_completion",
      ["req.personality"],
      "授權創作補全",
      "理由一",
      "授權創作補全",
      "director",
      "op-decision-1",
      "alpha",
    );

    // Repeated confirmation with different operation_id must throw COVERAGE_RESOLUTION_DUPLICATE
    let caughtDup: Error | undefined;
    try {
      recordUserDecisionAndResolution(
        first.state,
        "creative_completion",
        ["req.personality"],
        "重複授權創作補全",
        "理由二",
        "重複授權創作補全",
        "director",
        "op-decision-2",
        "alpha",
      );
    } catch (err) {
      caughtDup = err as Error;
    }
    expect(caughtDup).toBeDefined();
    expect((caughtDup as { code?: string }).code).toBe("COVERAGE_RESOLUTION_DUPLICATE");

    // Replay with identical operation_id succeeds idempotently
    const replay = recordUserDecisionAndResolution(
      first.state,
      "creative_completion",
      ["req.personality"],
      "授權創作補全",
      "理由一",
      "授權創作補全",
      "director",
      "op-decision-1",
      "alpha",
    );
    expect(replay.decision.id).toBe(first.decision.id);
    expect(replay.state.coverage_resolutions.length).toBe(first.state.coverage_resolutions.length);
  });

  it("reassessment after creative completion updates item status to creative_completion_authorized and becomes fresh", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    const decisionRes = recordUserDecisionAndResolution(
      withFormal,
      "creative_completion",
      ["req.personality"],
      "授權創作補全",
      "理由",
      "授權創作補全",
      "director",
      "op-decision-1",
      "alpha",
    );

    // Re-run formal coverage assessment
    const reassessment = runFormalCoverageAssessment(decisionRes.state, reqSet, "op-formal-2", "director");
    const withReassessment: ProjectState = {
      ...decisionRes.state,
      coverage_assessments: [...decisionRes.state.coverage_assessments, reassessment],
    };

    const eligibility = deriveCoverageAssessmentEligibility(withReassessment);
    expect(eligibility.fresh).toBe(true);
    expect(eligibility.actionable).toBe(true);

    const personalityItem = reassessment.items.find(
      (item) => item.requirement_id === "req.personality" && item.character_id === "alpha",
    );
    expect(personalityItem?.status).toBe("creative_completion_authorized");
    expect(personalityItem?.resolution_ids).toContain(decisionRes.resolutions[0]?.id);
  });
});

describe("Audit 7 Batch 2 - Issue #74 Requirement-scoped Research Eligibility", () => {
  it("deriveRequirementResearchEligibility produces correct results for all item statuses", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");

    // Construct an assessment containing various statuses
    const customItems = [
      { requirement_id: "req.missing", character_id: "alpha", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { requirement_id: "req.candidate", character_id: "alpha", status: "candidate_signal" as const, candidate_fact_ids: ["occ-1"], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { requirement_id: "req.src_covered", character_id: "alpha", status: "covered_by_source" as const, candidate_fact_ids: [], accepted_fact_ids: ["fact-1"], research_task_ids: [], resolution_ids: [] },
      { requirement_id: "req.supp_covered", character_id: "alpha", status: "covered_by_user_supplement" as const, candidate_fact_ids: [], accepted_fact_ids: ["fact-2"], research_task_ids: [], resolution_ids: ["res-1"] },
      { requirement_id: "req.creative", character_id: "alpha", status: "creative_completion_authorized" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: ["res-2"] },
      { requirement_id: "req.conflict", character_id: "alpha", status: "conflicted" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
    ];

    const assessment = { ...formal, items: customItems };
    const withAssessment: ProjectState = { ...state, coverage_assessments: [assessment] };

    // 1. missing -> eligible and startable
    const missingEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.missing", character_id: "alpha" });
    expect(missingEl.eligible).toBe(true);
    expect(missingEl.startable).toBe(true);
    expect(missingEl.reason_code).toBe("ELIGIBLE");

    // 2. candidate_signal -> ineligible
    const candidateEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.candidate", character_id: "alpha" });
    expect(candidateEl.eligible).toBe(false);
    expect(candidateEl.startable).toBe(false);
    expect(candidateEl.reason_code).toBe("CANDIDATE_SIGNAL");

    // 3. covered_by_source -> ineligible
    const srcEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.src_covered", character_id: "alpha" });
    expect(srcEl.eligible).toBe(false);
    expect(srcEl.startable).toBe(false);
    expect(srcEl.reason_code).toBe("COVERED_BY_SOURCE");

    // 4. covered_by_user_supplement -> ineligible
    const suppEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.supp_covered", character_id: "alpha" });
    expect(suppEl.eligible).toBe(false);
    expect(suppEl.startable).toBe(false);
    expect(suppEl.reason_code).toBe("COVERED_BY_USER_SUPPLEMENT");

    // 5. creative_completion_authorized -> ineligible
    const creativeEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.creative", character_id: "alpha" });
    expect(creativeEl.eligible).toBe(false);
    expect(creativeEl.startable).toBe(false);
    expect(creativeEl.reason_code).toBe("CREATIVE_COMPLETION_AUTHORIZED");

    // 6. conflicted -> ineligible
    const conflictEl = deriveRequirementResearchEligibility(withAssessment, assessment, { requirement_id: "req.conflict", character_id: "alpha" });
    expect(conflictEl.eligible).toBe(false);
    expect(conflictEl.startable).toBe(false);
    expect(conflictEl.reason_code).toBe("CONFLICTED");
  });

  it("resolveResearchTargets rejects non-missing explicit requirement scope", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");

    // Modify assessment to have covered_by_source for req.identity
    const customItems = formal.items.map((item) =>
      item.requirement_id === "req.identity" ? { ...item, status: "covered_by_source" as const } : item,
    );
    const assessment = { ...formal, items: customItems };

    // Requesting covered_by_source requirement explicitly must throw COVERAGE_RESEARCH_TARGET_INELIGIBLE
    let caughtIneligible: Error | undefined;
    try {
      resolveResearchTargets(assessment, {
        kind: "requirements",
        targets: [{ requirement_id: "req.identity", character_id: "alpha" }],
      });
    } catch (err) {
      caughtIneligible = err as Error;
    }
    expect(caughtIneligible).toBeDefined();
    expect((caughtIneligible as { code?: string }).code).toBe("COVERAGE_RESEARCH_TARGET_INELIGIBLE");

    // Requesting non-existent requirement throws COVERAGE_RESEARCH_SCOPE_INVALID
    let caughtInvalid: Error | undefined;
    try {
      resolveResearchTargets(assessment, {
        kind: "requirements",
        targets: [{ requirement_id: "req.nonexistent", character_id: "alpha" }],
      });
    } catch (err) {
      caughtInvalid = err as Error;
    }
    expect(caughtInvalid).toBeDefined();
    expect((caughtInvalid as { code?: string }).code).toBe("COVERAGE_RESEARCH_SCOPE_INVALID");

    // Assessment-wide scope filters down to missing items without error
    const wideTargets = resolveResearchTargets(assessment, { kind: "assessment" });
    expect(wideTargets.length).toBeGreaterThan(0);
    expect(wideTargets.some((t) => t.requirement_id === "req.identity")).toBe(false);
  });
});

describe("Audit 7 Batch 2 - Issue #95 In-flight Research and Dashboard CTA", () => {
  it("replaces start CTA with view_research_task for in-flight tasks in current lineage", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");

    const inFlightBatch = {
      id: "batch-1",
      assessment_id: formal.id,
      assessment_revision: formal.revision,
      requirement_set_id: reqSet.id,
      requirement_set_revision: reqSet.revision,
      status: "open" as const,
      created_by: "director",
      created_at: now,
      task_ids: ["task-inflight-1"],
    };

    const inFlightTask = {
      id: "task-inflight-1",
      batch_id: "batch-1",
      character_id: "alpha",
      requirement_ids: ["req.personality"],
      dimension_paths: ["personality"],
      query_seeds: ["Alpha personality"],
      status: "running" as const,
      claim_generation: 1,
      attempt: 1,
      searched_queries: [],
      source_families: [],
      created_at: now,
      updated_at: now,
    };

    const withInFlight: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      coverage_research_batches: [inFlightBatch],
      coverage_research_tasks: [inFlightTask],
    };

    const matrix = deriveCoverageCenterMatrix(withInFlight);
    const personalityCell = matrix.cells.find(
      (c) => c.requirement_id === "req.personality" && c.character_id === "alpha",
    );

    expect(personalityCell).toBeDefined();
    expect(personalityCell?.existing_in_flight_task_ids).toContain("task-inflight-1");
    expect(personalityCell?.research_eligibility?.startable).toBe(false);
    expect(personalityCell?.research_eligibility?.reason_code).toBe("IN_FLIGHT");

    // Standard start CTA should NOT be present; view_research_task should be present and enabled
    const researchAction = personalityCell?.typed_actions.find((a) => a.action === "research");
    expect(researchAction).toBeUndefined();

    const viewTaskAction = personalityCell?.typed_actions.find((a) => a.action === "view_research_task");
    expect(viewTaskAction).toBeDefined();
    expect(viewTaskAction?.enabled).toBe(true);
    expect(viewTaskAction?.target_task_id).toBe("task-inflight-1");
    expect(viewTaskAction?.label).toContain("查看進行中研究");
  });

  it("historical assessment in-flight task does not block current assessment research", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const oldFormal = runFormalCoverageAssessment(state, reqSet, "op-formal-old", "director");
    const currentFormal = runFormalCoverageAssessment(state, reqSet, "op-formal-cur", "director");

    // Task associated with old assessment revision
    const oldBatch = {
      id: "batch-old",
      assessment_id: oldFormal.id,
      assessment_revision: oldFormal.revision,
      requirement_set_id: reqSet.id,
      requirement_set_revision: reqSet.revision,
      status: "open" as const,
      created_by: "director",
      created_at: now,
      task_ids: ["task-old-1"],
    };

    const oldTask = {
      id: "task-old-1",
      batch_id: "batch-old",
      character_id: "alpha",
      requirement_ids: ["req.personality"],
      dimension_paths: ["personality"],
      query_seeds: ["Alpha personality"],
      status: "running" as const,
      claim_generation: 1,
      attempt: 1,
      searched_queries: [],
      source_families: [],
      created_at: now,
      updated_at: now,
    };

    const withOldTask: ProjectState = {
      ...state,
      coverage_assessments: [oldFormal, currentFormal],
      coverage_research_batches: [oldBatch],
      coverage_research_tasks: [oldTask],
    };

    const matrix = deriveCoverageCenterMatrix(withOldTask);
    const personalityCell = matrix.cells.find(
      (c) => c.requirement_id === "req.personality" && c.character_id === "alpha",
    );

    // Since the task is in historical lineage, current assessment cell should allow new research
    expect(personalityCell?.existing_in_flight_task_ids).toHaveLength(0);
    const researchAction = personalityCell?.typed_actions.find((a) => a.action === "research");
    expect(researchAction?.enabled).toBe(true);
  });

  it("deriveAssessmentWideResearchProjection excludes in-flight targets from target_count and disables when fully covered", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");

    const totalMissing = formal.items.filter((item) => item.status === "missing").length;

    // Create in-flight task for 1 missing item
    const inFlightBatch = {
      id: "batch-1",
      assessment_id: formal.id,
      assessment_revision: formal.revision,
      requirement_set_id: reqSet.id,
      requirement_set_revision: reqSet.revision,
      status: "open" as const,
      created_by: "director",
      created_at: now,
      task_ids: ["task-1"],
    };

    const inFlightTask = {
      id: "task-1",
      batch_id: "batch-1",
      character_id: "alpha",
      requirement_ids: ["req.personality"],
      dimension_paths: ["personality"],
      query_seeds: ["Alpha personality"],
      status: "running" as const,
      claim_generation: 1,
      attempt: 1,
      searched_queries: [],
      source_families: [],
      created_at: now,
      updated_at: now,
    };

    const withPartial: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      coverage_research_batches: [inFlightBatch],
      coverage_research_tasks: [inFlightTask],
    };

    const partialProjection = deriveAssessmentWideResearchProjection(withPartial);
    expect(partialProjection.enabled).toBe(true);
    expect(partialProjection.target_count).toBe(totalMissing - 1);
    expect(partialProjection.in_flight_target_count).toBe(1);

    // When all missing items have in-flight tasks
    const allInFlightTasks = formal.items
      .filter((item) => item.status === "missing")
      .map((item, idx) => ({
        id: `task-all-${idx}`,
        batch_id: "batch-1",
        character_id: item.character_id,
        requirement_ids: [item.requirement_id],
        dimension_paths: [],
        query_seeds: [],
        status: "queued" as const,
        claim_generation: 0,
        attempt: 0,
        searched_queries: [],
        source_families: [],
        created_at: now,
        updated_at: now,
      }));

    const withAllInFlight: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      coverage_research_batches: [{ ...inFlightBatch, task_ids: allInFlightTasks.map((t) => t.id) }],
      coverage_research_tasks: allInFlightTasks,
    };

    const allInFlightProjection = deriveAssessmentWideResearchProjection(withAllInFlight);
    expect(allInFlightProjection.enabled).toBe(false);
    expect(allInFlightProjection.target_count).toBe(0);
    expect(allInFlightProjection.in_flight_target_count).toBe(totalMissing);
    expect(allInFlightProjection.disabled_reason).toContain("已有正在執行的研究任務");
  });
});
