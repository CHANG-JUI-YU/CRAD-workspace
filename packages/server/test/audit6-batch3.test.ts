import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  MemoryProjectRepository,
  type BlueprintPrecheckRecord,
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

describe("Audit 6 Batch 3 - Server Routes & Dashboard Panels", () => {
  it("#50, #55, #56, #64: Dashboard JS contains scope preview, exact task recovery, and current/history views without innerHTML", () => {
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("startCoverageResearch");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("research-start-modal-overlay");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("/workspace/coverage/research/preview");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("openRecoveryDialog");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("recovery-modal-overlay");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("選擇要恢復的 Exhausted 任務：");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("歷史任務");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("啟動全量缺口研究");
    expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("innerHTML");
    expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("tasks[tasks.length - 1]");
  });

  it("#56, #50: Routes /workspace/coverage/research/preview and /start with scope", async () => {
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
    const state: ProjectState = {
      ...base,
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
    };
    const assessment = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "actor");
    const stateWithAssessment: ProjectState = {
      ...state,
      coverage_assessments: [assessment],
    };

    const repository = new MemoryProjectRepository(stateWithAssessment.id, stateWithAssessment);
    const runtime = new WorkspaceRuntime(repository);
    const server = createWorkspaceServer({
      runtime,
      actor: "director",
      autoStartWorker: false,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Preview request
      const previewRes = await fetch(`${serverUrl}/workspace/coverage/research/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment_id: assessment.id,
          assessment_revision: assessment.revision,
          scope: {
            kind: "requirements",
            targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
          },
        }),
      });

      expect(previewRes.status).toBe(200);
      const previewBody = await previewRes.json();
      expect(previewBody.requested_targets.length).toBe(1);
      expect(previewBody.new_task_count).toBe(1);

      // 2. Start request with scope
      const startRes = await fetch(`${serverUrl}/workspace/coverage/research/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment_id: assessment.id,
          assessment_revision: assessment.revision,
          scope: {
            kind: "requirements",
            targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
          },
        }),
      });

      expect(startRes.status).toBe(200);
      const startBody = await startRes.json();
      expect(startBody.batch_id).toBeDefined();
      expect(startBody.new_task_ids.length).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
