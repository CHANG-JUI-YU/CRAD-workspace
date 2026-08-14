import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
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
  const bp = {
    schema_version: 1,
    title: "Test Blueprint",
    source_adaptation: true,
    characters: [{ id: "alpha", label: "Alpha", is_primary: true }],
    world: { enabled: false },
    relationships: { enabled: false },
  };
  const rev = contentHash(JSON.stringify(bp));
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: bp,
    candidate_blueprint_revision: rev,
    status: "recorded",
    checks: [{
      subject_id: "alpha",
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "blueprint character",
      action: "preserve_explicit",
    }],
    created_at: now,
    created_by: "director",
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

    const base = createProjectState("proj-1", "Test Project");
    const initialRepoState: ProjectState = {
      ...base,
      project_status: "interviewing",
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
    };

    const assessment = runFormalCoverageAssessment(initialRepoState, reqSet, "op-formal-1", "director");
    const repoState: ProjectState = {
      ...initialRepoState,
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository("proj-1", repoState);

    const runtime = new WorkspaceRuntime(repo);
    const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Fresh state coverage-center response
      const freshRes = await fetch(`${serverUrl}/workspace/dashboard/coverage-center`);
      if (freshRes.status !== 200) {
        console.error("freshRes error:", freshRes.status, await freshRes.text());
      }
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
            candidate_blueprint_revision: "1111111111111111111111111111111111111111111111111111111111111111",
          },
        ],
      }));

      const staleRes = await fetch(`${serverUrl}/workspace/dashboard/coverage-center`);
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
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err === undefined ? resolve() : reject(err)));
    }
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
