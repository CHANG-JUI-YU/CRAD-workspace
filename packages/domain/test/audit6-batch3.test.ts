import { describe, expect, it } from "vitest";
import {
  contentHash,
  coverageFactProjectionRevision,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type ProjectState,
  type ResearchBatchRecord,
  type ResearchTaskRecord,
} from "@st-workspace/core";
import {
  createResearchBatchWithScope,
  deriveCoverageCenterMatrix,
  submitResearchTaskCandidates,
} from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";

function baseState(): ProjectState {
  return {
    schema_version: 1,
    project_id: "test-proj",
    name: "Test Project",
    created_at: now,
    updated_at: now,
    sources: [],
    knowledge_chunks: [],
    facts: [],
    candidates: [],
    blueprint_prechecks: [],
    coverage_assessments: [],
    coverage_resolutions: [],
    coverage_requirement_sets: [],
    coverage_research_batches: [],
    coverage_research_tasks: [],
    coverage_research_lineages: [],
    proposals: [],
    operations: [],
    events: [],
    artifacts: [],
    issues: [],
    authoring_coverage_bindings: [],
    fact_review_runs: [],
    fact_review_decisions: [],
  };
}

function sampleAssessment(state: ProjectState): { state: ProjectState; assessment: CoverageAssessment } {
  const reqSet: CoverageRequirementSet = {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    characters: [
      { character_id: "luna", requirement_ids: ["req.appearance", "req.personality"] },
    ],
    world_requirement_ids: ["req.world_context"],
    created_by: "system",
    created_at: now,
  };

  const assessment: CoverageAssessment = {
    id: "assess-1",
    revision: contentHash("assess-1"),
    pass: "formal",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    input_snapshot: {
      blueprint_revision: "bp-rev-1",
      source_revisions: [],
      fact_projection_revision: coverageFactProjectionRevision(state),
    },
    items: [
      { character_id: "luna", requirement_id: "req.appearance", status: "missing", candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { character_id: "luna", requirement_id: "req.personality", status: "missing", candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { requirement_id: "req.world_context", status: "missing", candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
    ],
    operation_id: "op-1",
    created_by: "system",
    created_at: now,
  };

  return {
    state: {
      ...state,
      blueprint_prechecks: [{
        id: "precheck-1",
        schema_version: 1,
        project_id: "test-proj",
        operation_id: "op-precheck",
        collaboration_mode: "assisted",
        candidate_blueprint: {
          schema_version: 1,
          project_id: "test-proj",
          flow: "character",
          collaboration_mode: "assisted",
          characters: [{ id: "luna", label: "Luna" }],
          primary_character_id: "luna",
        },
        candidate_blueprint_revision: "bp-rev-1",
        checks: [],
        status: "recorded",
        created_at: now,
        created_by: "system",
      }],
      coverage_requirement_sets: [reqSet],
      coverage_assessments: [assessment],
    },
    assessment,
  };
}

describe("Audit 6 Batch 3 - Domain Research Scope, Lineage & Recovery", () => {
  it("#50 & #61: creates research batch with scoped target requirements and prevents active duplicates", () => {
    const { state, assessment } = sampleAssessment(baseState());

    // 1. Start scoped research for only luna's appearance
    const outcome1 = createResearchBatchWithScope(
      state,
      assessment.id,
      { kind: "requirements", targets: [{ character_id: "luna", requirement_id: "req.appearance" }] },
      "director",
    );

    expect(outcome1.reused).toBe(false);
    expect(outcome1.new_task_ids.length).toBe(1);
    expect(outcome1.tasks[0]?.requirement_ids).toEqual(["req.appearance"]);
    expect(outcome1.tasks[0]?.character_id).toBe("luna");

    // 2. Starting exact same scope again should deduplicate and return reused: true
    const outcome2 = createResearchBatchWithScope(
      outcome1.state,
      assessment.id,
      { kind: "requirements", targets: [{ character_id: "luna", requirement_id: "req.appearance" }] },
      "director",
    );

    expect(outcome2.reused).toBe(true);
    expect(outcome2.new_task_ids.length).toBe(0);
    expect(outcome2.existing_task_ids).toContain(outcome1.tasks[0]?.id);

    // 3. Starting assessment-wide scope should only create tasks for uncovered targets
    const outcome3 = createResearchBatchWithScope(
      outcome1.state,
      assessment.id,
      { kind: "assessment" },
      "director",
    );

    expect(outcome3.reused).toBe(false);
    // Uncovered targets are: luna's personality and world_context
    expect(outcome3.requested_targets.length).toBe(3);
    expect(outcome3.existing_task_ids).toContain(outcome1.tasks[0]?.id);
    const createdReqIds = outcome3.tasks.flatMap((t) => t.requirement_ids);
    expect(createdReqIds).toContain("req.personality");
    expect(createdReqIds).toContain("req.world_context");
    expect(createdReqIds).not.toContain("req.appearance");
  });

  it("#44 BUG6-10: strictly validates target_requirement_ids in submitResearchTaskCandidates", () => {
    const { state, assessment } = sampleAssessment(baseState());
    const outcome = createResearchBatchWithScope(
      state,
      assessment.id,
      { kind: "requirements", targets: [{ character_id: "luna", requirement_id: "req.appearance" }] },
      "director",
    );

    const task = outcome.tasks[0]!;

    // Make task claimed with valid lease
    const claimedState: ProjectState = {
      ...outcome.state,
      coverage_research_tasks: outcome.state.coverage_research_tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: "claimed" as const,
              lease_owner: "researcher-1",
              lease_expires_at: "2099-01-01T00:00:00.000Z",
            }
          : t,
      ),
    };

    // 1. Providing target_requirement_ids outside task requirement scope must throw and NOT modify candidates
    expect(() =>
      submitResearchTaskCandidates(
        claimedState,
        task.id,
        task.claim_generation,
        "researcher-1",
        [
          {
            title: "Out of scope candidate",
            target_requirement_ids: ["req.world_context"],
          },
        ],
        "researcher-1",
      ),
    ).toThrowError(/not within task/);

    // Verify no candidates were added
    const taskAfterError = claimedState.coverage_research_tasks.find((t) => t.id === task.id)!;
    expect(taskAfterError.candidate_source_ids ?? []).toEqual([]);

    // 2. Providing valid target_requirement_ids inside task scope succeeds
    const successResult = submitResearchTaskCandidates(
      claimedState,
      task.id,
      task.claim_generation,
      "researcher-1",
      [
        {
          title: "Valid appearance candidate",
          target_requirement_ids: ["req.appearance"],
        },
      ],
      "researcher-1",
    );

    const updatedTask = successResult.state.coverage_research_tasks.find((t) => t.id === task.id)!;
    expect(updatedTask.status).toBe("completed");
    expect(successResult.candidates.length).toBe(1);
    expect(successResult.state.candidates.length).toBe(1);
    expect(successResult.state.coverage_research_lineages.length).toBe(1);
    expect(successResult.state.coverage_research_lineages[0]?.requirement_id).toBe("req.appearance");

    // 3. Omitting target_requirement_ids defaults to task's requirement_ids
    const omittedResult = submitResearchTaskCandidates(
      claimedState,
      task.id,
      task.claim_generation,
      "researcher-1",
      [
        {
          title: "Default candidate",
        },
      ],
      "researcher-1",
    );

    const omittedTask = omittedResult.state.coverage_research_tasks.find((t) => t.id === task.id)!;
    expect(omittedTask.status).toBe("completed");
    expect(omittedResult.candidates.length).toBe(1);
    expect(omittedResult.state.coverage_research_lineages.length).toBe(1);
    expect(omittedResult.state.coverage_research_lineages[0]?.requirement_id).toBe("req.appearance");
  });

  it("#49 & #55: separates Current and History tasks and resolutions in deriveCoverageCenterMatrix", () => {
    const { state, assessment } = sampleAssessment(baseState());

    // Current batch & task
    const currentBatch: ResearchBatchRecord = {
      id: "batch-cur",
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_id: "set-1",
      requirement_set_revision: "set-rev-1",
      status: "open",
      task_ids: ["task-cur-1"],
      created_by: "director",
      created_at: now,
    };

    const currentTask: ResearchTaskRecord = {
      id: "task-cur-1",
      batch_id: "batch-cur",
      character_id: "luna",
      requirement_ids: ["req.appearance"],
      dimension_paths: ["appearance"],
      query_seeds: ["luna appearance"],
      status: "exhausted",
      claim_generation: 1,
      attempt: 1,
      exhausted_reason: "no results",
      created_at: now,
      updated_at: now,
    };

    // History task from older assessment revision
    const historyBatch: ResearchBatchRecord = {
      id: "batch-old",
      assessment_id: assessment.id,
      assessment_revision: "old-assessment-revision",
      requirement_set_id: "set-1",
      requirement_set_revision: "set-rev-1",
      status: "completed",
      task_ids: ["task-old-1"],
      created_by: "director",
      created_at: "2026-08-01T00:00:00.000Z",
    };

    const historyTask: ResearchTaskRecord = {
      id: "task-old-1",
      batch_id: "batch-old",
      character_id: "luna",
      requirement_ids: ["req.appearance"],
      dimension_paths: ["appearance"],
      query_seeds: ["luna old query"],
      status: "exhausted",
      claim_generation: 1,
      attempt: 1,
      exhausted_reason: "old reason",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };

    const stateWithBoth: ProjectState = {
      ...state,
      coverage_research_batches: [currentBatch, historyBatch],
      coverage_research_tasks: [currentTask, historyTask],
    };

    const matrix = deriveCoverageCenterMatrix(stateWithBoth);
    const lunaAppearanceCell = matrix.cells.find(
      (c) => c.character_id === "luna" && c.requirement_id === "req.appearance",
    )!;

    expect(lunaAppearanceCell).toBeDefined();
    // Current tasks must contain only the current task
    expect(lunaAppearanceCell.current_research_tasks?.length).toBe(1);
    expect(lunaAppearanceCell.current_research_tasks?.[0]?.id).toBe("task-cur-1");
    expect(lunaAppearanceCell.research_task_ids).toEqual(["task-cur-1"]);

    // History tasks must contain the older task
    expect(lunaAppearanceCell.history_research_tasks?.length).toBe(1);
    expect(lunaAppearanceCell.history_research_tasks?.[0]?.id).toBe("task-old-1");
    expect(lunaAppearanceCell.history_research_tasks?.[0]?.assessment_revision).toBe("old-assessment-revision");

    // Recovery action is available because the CURRENT task is exhausted
    const reviseQueryAction = lunaAppearanceCell.typed_actions?.find((a) => a.action === "revise_query");
    expect(reviseQueryAction?.enabled).toBe(true);
  });
});
