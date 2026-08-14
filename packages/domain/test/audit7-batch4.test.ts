import { describe, expect, it } from "vitest";
import {
  createProjectState,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type SourceRecord,
  type CoverageRequirementSetRecord,
  type CoverageAssessmentRecord,
  type CoverageResolution,
  type CoverageUserDecisionRecord,
  type BlueprintPrecheckRecord,
} from "@st-workspace/core";
import {
  fulfillEligibleUserSupplementResolutions,
  deriveSupplementLifecycleProjection,
  deriveCoverageCenterMatrix,
} from "../src/index.js";

function setupSupplementBaseState(): ProjectState {
  const base = createProjectState("test-proj");

  const precheck: BlueprintPrecheckRecord = {
    id: "precheck-1",
    schema_version: 1,
    project_id: "test-proj",
    operation_id: "op-precheck",
    blueprint_revision: "bp-rev-1",
    candidate_blueprint_revision: "bp-rev-1",
    blueprint: {
      schema_version: 1,
      title: "Test Blueprint",
      source_adaptation: true,
      characters: [{ id: "alpha", label: "Alpha", is_primary: true }],
      world: { enabled: true },
      relationships: { enabled: false },
    },
    valid: true,
    errors: [],
    created_at: "2026-08-14T00:00:00Z",
  };

  const reqSet: CoverageRequirementSetRecord = {
    id: "reqset-1",
    revision: "reqset-rev-1",
    items: [
      { id: "req.world_context", dimension: "world_context", label: "世界觀概覽", scope: "world", satisfaction: { min_accepted_facts: 1, evidence_match: "any" } },
    ],
    created_at: "2026-08-14T00:00:00Z",
    created_by: "system",
  };

  const assessment: CoverageAssessmentRecord = {
    id: "asm-1",
    revision: "asm-rev-1",
    requirement_set_id: "reqset-1",
    requirement_set_revision: "reqset-rev-1",
    pass: "formal",
    freshness: "fresh",
    readiness: {
      status: "blocked",
      blockers: [{ code: "COVERAGE_GAPS_REMAIN", message: "World overview missing." }],
    },
    items: [
      {
        requirement_id: "req.world_context",
        status: "missing",
        accepted_fact_ids: [],
        candidate_fact_ids: [],
        coverage_dimension: "world_context",
      },
    ],
    input_snapshot: {
      blueprint_revision: "bp-rev-1",
      fact_projection_revision: "fp-rev-1",
      fact_review_run_id: "run-rev-1",
      source_revisions: [{ source_id: "src-supp-1", revision: "src-rev-1" }],
    },
    created_at: "2026-08-14T00:00:00Z",
    created_by: "director",
  };

  const source: SourceRecord = {
    id: "src-supp-1",
    revision: "src-rev-1",
    title: "User Supplement Document",
    provenance_kind: "user_supplement",
    status: "ready",
    chunks: ["chunk-1"],
    created_at: "2026-08-14T00:01:00Z",
  };

  const userDecision: CoverageUserDecisionRecord = {
    id: "dec-user-1",
    action: "user_supplement",
    scope: { requirement_id: "req.world_context" },
    choice: "使用者提供背景補充資料",
    rationale: "由使用者直接提供核心背景設定",
    authorized_by: "director",
    operation_id: "op-supp-1",
    created_at: "2026-08-14T00:01:00Z",
  };

  const authResolution: CoverageResolution = {
    id: "res-auth-1",
    requirement_id: "req.world_context",
    mode: "user_supplement",
    status: "pending",
    assessment_id: "asm-1",
    assessment_revision: "asm-rev-1",
    requirement_set_revision: "reqset-rev-1",
    rationale: "由使用者直接提供核心背景設定",
    user_decision_id: "dec-user-1",
    authorized_by: "director",
    operation_id: "op-supp-1",
    created_by: "director",
    created_at: "2026-08-14T00:01:00Z",
  };

  const evidenceBoundResolution: CoverageResolution = {
    id: "res-bound-1",
    requirement_id: "req.world_context",
    mode: "user_supplement",
    status: "pending",
    assessment_id: "asm-1",
    assessment_revision: "asm-rev-1",
    requirement_set_revision: "reqset-rev-1",
    rationale: "由使用者直接提供核心背景設定",
    source_refs: [{ source_id: "src-supp-1", revision: "src-rev-1" }],
    user_decision_id: "dec-user-1",
    authorized_by: "director",
    operation_id: "op-supp-1",
    supersedes: "res-auth-1",
    created_by: "director",
    created_at: "2026-08-14T00:01:05Z",
  };

  const reviewRun: FactReviewRunRecord = {
    id: "run-rev-1",
    scope: "project",
    status: "completed",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "src-supp-1", revision: "src-rev-1" }],
    created_by: "director",
    created_at: "2026-08-14T00:02:00Z",
  };

  const reviewDecision: FactReviewDecisionRecord = {
    id: "dec-rev-1",
    review_run_id: "run-rev-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-1",
    reviewer_identity: "director",
    decision: "accepted",
    reason: "Valid background fact",
    evidence: [{ source_id: "src-supp-1", quote: "A detailed world description." }],
    resulting_fact_revision: 1,
    created_at: "2026-08-14T00:02:30Z",
  };

  const acceptedFact: FactRecord = {
    id: "fact-1",
    fact_revision: 1,
    accepted_fact_revision: 1,
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-rev-1",
    decision_id: "dec-rev-1",
    status: "accepted",
    classification: "world",
    coverage_targets: ["req.world_context"],
    coverage: ["world_context"],
    subject: "World",
    predicate: "setting",
    object: "Fantasy Realm",
    evidence: ["A detailed world description."],
    evidence_refs: [{ source_id: "src-supp-1", source_revision_id: "src-rev-1", quote: "A detailed world description." }],
    source_ids: ["src-supp-1"],
    created_at: "2026-08-14T00:02:00Z",
  };

  return {
    ...base,
    blueprint_prechecks: [precheck],
    coverage_requirement_sets: [reqSet],
    coverage_assessments: [assessment],
    sources: [source],
    coverage_user_decisions: [userDecision],
    coverage_resolutions: [authResolution, evidenceBoundResolution],
    fact_review_runs: [reviewRun],
    fact_review_decisions: [reviewDecision],
    facts: [acceptedFact],
  };
}

describe("Audit 7 Batch 4 - Domain Fulfillment and Lifecycle", () => {
  it("fulfills eligible pending user_supplement resolution upon fact acceptance", () => {
    const state = setupSupplementBaseState();
    const result = fulfillEligibleUserSupplementResolutions(state, "director", "op-fulfillment-1");

    expect(result.fulfilled).toHaveLength(1);
    const fulfilledRes = result.fulfilled[0]!;
    expect(fulfilledRes.mode).toBe("user_supplement");
    expect(fulfilledRes.status).toBe("fulfilled");
    expect(fulfilledRes.supersedes).toBe("res-bound-1");
    expect(fulfilledRes.source_refs).toEqual([{ source_id: "src-supp-1", revision: "src-rev-1" }]);
    expect(fulfilledRes.fact_refs).toEqual([
      { fact_id: "fact-1", fact_revision: 1, decision_id: "dec-rev-1" },
    ]);

    // Check state has the new resolution
    expect(result.state.coverage_resolutions).toHaveLength(3);
    expect(result.state.coverage_resolutions.at(-1)?.id).toBe(fulfilledRes.id);

    // Idempotency: calling again does not produce new resolutions
    const secondResult = fulfillEligibleUserSupplementResolutions(result.state, "director", "op-fulfillment-2");
    expect(secondResult.fulfilled).toHaveLength(0);
  });

  it("does not fulfill if source revision does not match", () => {
    const state = setupSupplementBaseState();
    // Tamper with source revision
    const stateWithMismatchedSource: ProjectState = {
      ...state,
      sources: [{ ...state.sources[0]!, revision: "src-rev-2-tampered" }],
    };

    const result = fulfillEligibleUserSupplementResolutions(stateWithMismatchedSource, "director", "op-fulfillment-3");
    expect(result.fulfilled).toHaveLength(0);
  });

  it("derives supplement lifecycle projection across different stages", () => {
    const state = setupSupplementBaseState();

    // Stage 1: Before fulfillment, fact review is in progress / completed
    const projBeforeFulfill = deriveSupplementLifecycleProjection(state, "req.world_context");
    expect(projBeforeFulfill).toBeDefined();
    expect(projBeforeFulfill?.stage).toBe("accepted_facts");
    expect(projBeforeFulfill?.authorization_saved).toBe(true);
    expect(projBeforeFulfill?.current_resolution_id).toBe("res-bound-1");

    // Stage 2: After fulfillment, requires reassessment
    const { state: fulfilledState } = fulfillEligibleUserSupplementResolutions(state, "director", "op-fulfillment");
    const projAfterFulfill = deriveSupplementLifecycleProjection(fulfilledState, "req.world_context");
    expect(projAfterFulfill?.stage).toBe("reassessment_required");
    expect(projAfterFulfill?.stage_status).toBe("completed");
    expect(projAfterFulfill?.next_action).toBe("重新執行 Formal Assessment");
    expect(projAfterFulfill?.requires_attention).toBe(true);

    // Stage 3: After formal reassessment passes
    const reassessedState: ProjectState = {
      ...fulfilledState,
      coverage_assessments: [
        {
          ...fulfilledState.coverage_assessments[0]!,
          id: "asm-2",
          revision: "asm-rev-2",
          items: [
            {
              requirement_id: "req.world_context",
              status: "covered_by_user_supplement",
              resolution_ids: [fulfilledState.coverage_resolutions.at(-1)!.id],
              accepted_fact_ids: ["fact-1"],
              candidate_fact_ids: [],
            },
          ],
        },
      ],
    };

    const projReassessed = deriveSupplementLifecycleProjection(reassessedState, "req.world_context");
    expect(projReassessed?.stage).toBe("reassessed");
    expect(projReassessed?.stage_status).toBe("completed");
    expect(projReassessed?.next_action).toBe("檢視細節與 Provenance");
    expect(projReassessed?.requires_attention).toBe(false);
  });

  it("projects '繼續補件' CTA action when a pending resolution exists", () => {
    const state = setupSupplementBaseState();
    const matrix = deriveCoverageCenterMatrix(state);
    const cell = matrix.cells.find((c) => c.requirement_id === "req.world_context");

    expect(cell).toBeDefined();
    expect(cell?.supplement_lifecycle).toBeDefined();
    expect(cell?.supplement_lifecycle?.current_resolution_id).toBe("res-bound-1");

    const supplementAction = cell?.typed_actions.find((a) => a.action === "supplement");
    expect(supplementAction).toBeDefined();
    expect(supplementAction?.label).toBe("繼續補件");
    expect(supplementAction?.target_resolution_id).toBe("res-bound-1");
  });
});
