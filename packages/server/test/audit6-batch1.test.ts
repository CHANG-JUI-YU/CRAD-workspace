import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { runFormalCoverageAssessment } from "@st-workspace/domain";

import { createWorkspaceServer } from "../src/index.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";

const now = "2026-08-14T00:00:00.000Z";

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
    candidate_blueprint_revision: "bp-rev-1",
    status: "recorded",
    checks: [],
    created_at: now,
  };
}

describe("Audit 6 Batch 1 - Server Dashboard & Action Availability", () => {
  it("#62 Disables general mutation actions on stale cell and provides typed_actions options", async () => {
    const pc = precheck("proj-1");
    const reqSet: CoverageRequirementSet = {
      id: "reqset-1",
      revision: "set-rev-1",
      source: "default",
      blueprint_revision: pc.candidate_blueprint_revision,
      characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
      world_requirement_ids: [],
      created_by: "director",
      created_at: now,
    };

    const initialRepoState: ProjectState = {
      id: "proj-1",
      name: "Test Project",
      project_status: "interviewing",
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
      coverage_assessments: [],
      coverage_research_batches: [],
      coverage_research_tasks: [],
      coverage_research_lineages: [],
      coverage_resolutions: [],
      sources: [],
      facts: [],
      fact_review_runs: [],
      fact_review_decisions: [],
      artifacts: [],
      audit: [],
      operations: [],
      revision: 1,
    };

    const assessment = runFormalCoverageAssessment(initialRepoState, reqSet, "op-formal-1", "director");

    const repo = new MemoryProjectRepository({
      ...initialRepoState,
      coverage_assessments: [assessment],
    });

    const runtime = new WorkspaceRuntime({ repository: repo });
    const app = createWorkspaceServer({ runtime });

    // 1. Fresh state coverage-center response
    const freshRes = await app.request("/workspace/dashboard/coverage-center");
    expect(freshRes.status).toBe(200);
    const freshData = await freshRes.json();
    expect(freshData.matrix.cells).toHaveLength(1);
    const freshCell = freshData.matrix.cells[0];
    expect(freshCell.assessment_stale).toBe(false);
    expect(freshCell.typed_actions).toBeDefined();

    const freshResearchAction = freshCell.typed_actions.find((a: any) => a.action === "research");
    expect(freshResearchAction).toBeDefined();
    expect(freshResearchAction.enabled).toBe(true);

    // 2. Make assessment stale by modifying blueprint revision in repository
    await repo.commit((await repo.read()).revision, (curr) => ({
      ...curr,
      blueprint_prechecks: [
        {
          ...curr.blueprint_prechecks[0]!,
          candidate_blueprint_revision: "bp-rev-stale",
        },
      ],
    }));

    const staleRes = await app.request("/workspace/dashboard/coverage-center");
    expect(staleRes.status).toBe(200);
    const staleData = await staleRes.json();
    const staleCell = staleData.matrix.cells[0];

    expect(staleCell.assessment_stale).toBe(true);
    expect(staleCell.status).toBe("stale");

    // Mutation actions must be disabled
    const staleResearch = staleCell.typed_actions.find((a: any) => a.action === "research");
    expect(staleResearch.enabled).toBe(false);
    expect(staleResearch.disabled_reason).toContain("Coverage Assessment 已過期");
    expect(staleResearch.prerequisite?.action).toBe("reassess");
    expect(staleResearch.prerequisite?.target_panel).toBe("coverage");

    const staleReassess = staleCell.typed_actions.find((a: any) => a.action === "reassess");
    expect(staleReassess.enabled).toBe(true);

    // Actions list for backward compatibility must only contain enabled actions
    expect(staleCell.actions).toEqual(["reassess"]);
  });

  it("DASHBOARD_PANELS_COVERAGE_JS includes data attributes and typed_actions support", () => {
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-character-id");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-requirement-id");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-assessment-id");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-assessment-revision");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-action");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("cell.typed_actions");
  });
});
