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

function baseState(projectId = "batch7-1"): ProjectState {
  const base = createProjectState(projectId, "Batch7 Test");
  const pc = precheck(projectId);
  const reqSet: CoverageRequirementSet = {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.identity", "req.personality"] }],
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

describe("Audit 7 Batch 1 - Domain Eligibility Projection", () => {
  it("no assessment yields COVERAGE_ASSESSMENT_REQUIRED and non-actionable", () => {
    const state = baseState();
    const eligibility = deriveCoverageAssessmentEligibility(state);
    expect(eligibility.actionable).toBe(false);
    expect(eligibility.current).toBe(false);
    expect(eligibility.formal).toBe(false);
    expect(eligibility.fresh).toBe(false);
    expect(eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_REQUIRED");
    expect(eligibility.prerequisite).toBeTruthy();
  });

  it("fresh initial assessment is NOT actionable (formal false, fresh true)", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const initial = runInitialCoverageAssessment(state, reqSet, "op-initial", "director");
    const withAssessment: ProjectState = { ...state, coverage_assessments: [initial] };

    const eligibility = deriveCoverageAssessmentEligibility(withAssessment);
    expect(eligibility.fresh).toBe(true);
    expect(eligibility.formal).toBe(false);
    expect(eligibility.actionable).toBe(false);
    expect(eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_NOT_FORMAL");
    expect(eligibility.assessment?.pass).toBe("initial");
  });

  it("current formal fresh assessment is actionable", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const withAssessment: ProjectState = { ...state, coverage_assessments: [formal] };

    const eligibility = deriveCoverageAssessmentEligibility(withAssessment);
    expect(eligibility.actionable).toBe(true);
    expect(eligibility.current).toBe(true);
    expect(eligibility.formal).toBe(true);
    expect(eligibility.requirement_set_current).toBe(true);
    expect(eligibility.fresh).toBe(true);
    expect(eligibility.reason_code).toBeUndefined();
  });

  it("historical (non-latest) assessment is NOT actionable", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const first = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const second = runFormalCoverageAssessment(state, reqSet, "op-formal-2", "director");
    const withAssessments: ProjectState = { ...state, coverage_assessments: [first, second] };

    const eligibility = deriveCoverageAssessmentEligibility(withAssessments, first.id, first.revision);
    expect(eligibility.actionable).toBe(false);
    expect(eligibility.current).toBe(false);
    expect(eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_NOT_CURRENT");

    const revisionMismatch = deriveCoverageAssessmentEligibility(withAssessments, second.id, "wrong-rev");
    expect(revisionMismatch.actionable).toBe(false);
    expect(revisionMismatch.reason_code).toBe("COVERAGE_ASSESSMENT_NOT_CURRENT");

    const latestEligibility = deriveCoverageAssessmentEligibility(withAssessments, second.id, second.revision);
    expect(latestEligibility.actionable).toBe(true);
  });

  it("requirement set mismatch is NOT actionable", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const changedReqSet: CoverageRequirementSet = {
      ...reqSet,
      id: "set-2",
      revision: "set-rev-2",
      characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
    };
    const withMismatch: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      coverage_requirement_sets: [reqSet, changedReqSet],
    };

    const eligibility = deriveCoverageAssessmentEligibility(withMismatch);
    expect(eligibility.actionable).toBe(false);
    expect(eligibility.requirement_set_current).toBe(false);
    expect(eligibility.reason_code).toBe("COVERAGE_REQUIREMENT_SET_MISMATCH");
  });

  it("stale input (changed source revision) is NOT actionable while fresh=false", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const changedSource = sourceRecord("source-1", "Alpha is serene and calm.");
    const withChangedSource: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      sources: [changedSource],
    };

    const eligibility = deriveCoverageAssessmentEligibility(withChangedSource);
    expect(eligibility.fresh).toBe(false);
    expect(eligibility.actionable).toBe(false);
    expect(eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_STALE");
  });
});

describe("Audit 7 Batch 1 - Assessment-wide Research Projection", () => {
  it("disabled with reason when no assessment exists", () => {
    const state = baseState();
    const projection = deriveAssessmentWideResearchProjection(state);
    expect(projection.enabled).toBe(false);
    expect(projection.target_count).toBe(0);
    expect(projection.disabled_reason).toBeTruthy();
    expect(projection.prerequisite).toBeTruthy();
  });

  it("disabled for a fresh initial assessment", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const initial = runInitialCoverageAssessment(state, reqSet, "op-initial", "director");
    const withInitial: ProjectState = { ...state, coverage_assessments: [initial] };

    const projection = deriveAssessmentWideResearchProjection(withInitial);
    expect(projection.enabled).toBe(false);
    expect(projection.target_count).toBe(0);
    expect(projection.disabled_reason).toContain("initial");
  });

  it("enabled with exact missing count for a valid formal assessment", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    const missingItems = formal.items.filter((item) => item.status === "missing");
    const projection = deriveAssessmentWideResearchProjection(withFormal);
    expect(projection.enabled).toBe(true);
    expect(projection.target_count).toBe(missingItems.length);
    expect(projection.target_count).toBeGreaterThan(0);
  });

  it("stale cells are not counted and the CTA is disabled when assessment is stale", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const changedSource = sourceRecord("source-1", "Alpha is serene and calm.");
    const withStale: ProjectState = {
      ...state,
      coverage_assessments: [formal],
      sources: [changedSource],
    };

    const projection = deriveAssessmentWideResearchProjection(withStale);
    expect(projection.enabled).toBe(false);
    expect(projection.target_count).toBe(0);
    expect(projection.disabled_reason).toContain("已過期");
  });

  it("disabled with zero-target message when no missing targets exist", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const resolvedItems = formal.items.map((item) => ({ ...item, status: "covered_by_source" as const }));
    const withResolved: ProjectState = {
      ...state,
      coverage_assessments: [{ ...formal, items: resolvedItems }],
    };

    const projection = deriveAssessmentWideResearchProjection(withResolved);
    expect(projection.enabled).toBe(false);
    expect(projection.target_count).toBe(0);
    expect(projection.disabled_reason).toContain("沒有可研究缺口");
  });

  it("candidate_signal items are not research targets", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const mixedItems = formal.items.map((item, index) => ({
      ...item,
      status: index === 0 ? ("missing" as const) : ("candidate_signal" as const),
    }));
    const withMixed: ProjectState = {
      ...state,
      coverage_assessments: [{ ...formal, items: mixedItems }],
    };

    const projection = deriveAssessmentWideResearchProjection(withMixed);
    expect(projection.enabled).toBe(true);
    expect(projection.target_count).toBe(1);
  });

  it("refreshes after reassessment supersedes the previous assessment", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const first = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "director");
    const withFirst: ProjectState = { ...state, coverage_assessments: [first] };

    const firstProjection = deriveAssessmentWideResearchProjection(withFirst);
    expect(firstProjection.enabled).toBe(true);

    const resolvedItems = first.items.map((item) => ({ ...item, status: "covered_by_source" as const }));
    const second = runFormalCoverageAssessment(withFirst, reqSet, "op-formal-2", "director");
    const withResolved: ProjectState = {
      ...state,
      coverage_assessments: [
        { ...first, status: "superseded" as const },
        { ...second, items: resolvedItems },
      ],
    };

    const refreshed = deriveAssessmentWideResearchProjection(withResolved);
    expect(refreshed.enabled).toBe(false);
    expect(refreshed.target_count).toBe(0);
    expect(refreshed.disabled_reason).toContain("沒有可研究缺口");
  });
});

describe("Audit 7 Batch 1 - Coverage Center Matrix Eligibility", () => {
  it("matrix exposes eligibility and wide-research projections", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    const matrix = deriveCoverageCenterMatrix(withFormal);
    expect(matrix.assessment_eligibility.actionable).toBe(true);
    expect(matrix.assessment_wide_research.enabled).toBe(true);
    expect(matrix.assessment_wide_research.target_count).toBeGreaterThan(0);
    expect(matrix.assessment?.formal).toBe(true);
    expect(matrix.assessment?.current).toBe(true);
    expect(matrix.assessment?.actionable).toBe(true);
    expect(matrix.assessment?.fresh).toBe(true);
    expect(matrix.assessment?.eligibility_reason).toBeUndefined();
  });

  it("initial assessment cells disable mutations and point to Fact Review", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const initial = runInitialCoverageAssessment(state, reqSet, "op-initial", "director");
    const withInitial: ProjectState = { ...state, coverage_assessments: [initial] };

    const matrix = deriveCoverageCenterMatrix(withInitial);
    expect(matrix.assessment?.fresh).toBe(true);
    expect(matrix.assessment?.formal).toBe(false);
    expect(matrix.assessment?.actionable).toBe(false);
    expect(matrix.assessment?.eligibility_reason_code).toBe("COVERAGE_ASSESSMENT_NOT_FORMAL");
    expect(matrix.cells.length).toBeGreaterThan(0);

    for (const cell of matrix.cells) {
      const reassess = cell.typed_actions.find((action) => action.action === "reassess");
      const research = cell.typed_actions.find((action) => action.action === "research");
      const supplement = cell.typed_actions.find((action) => action.action === "supplement");
      const creative = cell.typed_actions.find((action) => action.action === "creative_completion");
      expect(reassess?.enabled).toBe(true);
      expect(reassess?.label).toContain("Fact Review");
      expect(research?.enabled).toBe(false);
      expect(research?.disabled_reason).toBeTruthy();
      expect(supplement?.enabled).toBe(false);
      expect(creative?.enabled).toBe(false);
    }
  });

  it("valid formal assessment enables research actions on missing cells", () => {
    const state = baseState();
    const reqSet = state.coverage_requirement_sets[0]!;
    const formal = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const withFormal: ProjectState = { ...state, coverage_assessments: [formal] };

    const matrix = deriveCoverageCenterMatrix(withFormal);
    for (const cell of matrix.cells) {
      const research = cell.typed_actions.find((action) => action.action === "research");
      expect(research?.enabled).toBe(true);
    }
  });
});
