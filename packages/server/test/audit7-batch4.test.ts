import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspaceServer } from "../src/index.js";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
  type CoverageAssessmentRecord,
} from "@st-workspace/core";
import { runFormalCoverageAssessment } from "@st-workspace/domain";

const now = "2026-08-14T00:00:00.000Z";

function precheck(projectId: string): BlueprintPrecheckRecord {
  const bp = {
    schema_version: 1,
    title: "Test Blueprint",
    source_adaptation: true,
    characters: [{ id: "alpha", label: "Alpha", is_primary: true }],
    world: { enabled: true },
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

describe("Audit 7 Batch 4 - Server Coverage Supplement & Lifecycle API", () => {
  let server: any;
  let port: number;
  let repository: MemoryProjectRepository;
  let runtime: WorkspaceRuntime;
  let assessment: CoverageAssessmentRecord;

  beforeAll(async () => {
    const pc = precheck("test-server-proj");
    const initialState = createProjectState("test-server-proj");

    const reqSet: CoverageRequirementSet = {
      id: "reqset-1",
      revision: "reqset-rev-1",
      source: "default",
      blueprint_revision: pc.candidate_blueprint_revision,
      characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
      world_requirement_ids: [],
      created_at: now,
      created_by: "system",
    };

    const baseState: ProjectState = {
      ...initialState,
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
    };

    assessment = runFormalCoverageAssessment(baseState, reqSet, "op-formal-1", "director");

    const state: ProjectState = {
      ...baseState,
      coverage_assessments: [assessment],
    };

    repository = new MemoryProjectRepository("test-server-proj", state);
    runtime = new WorkspaceRuntime(repository);

    server = createWorkspaceServer({
      runtime,
      actor: "director",
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("handles atomic POST /workspace/coverage/supplement in a single request", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/coverage/supplement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.identity",
        character_id: "alpha",
        choice: "提供角色補充文檔",
        rationale: "由作者提供第一手背景",
        text: "Alpha 生於北部山區，是一位富有經驗的冒險家。",
      }),
    });

    const bodyText = await res.text();
    if (res.status !== 200) {
      console.error("Server supplement response error:", res.status, bodyText);
    }
    expect(res.status).toBe(200);
    const body = JSON.parse(bodyText);
    expect(body.status).toBe("completed");
    expect(body.source_id).toBeDefined();
    expect(body.chunk_count).toBeGreaterThan(0);
    expect(body.resolution_id).toBeDefined();

    // Verify Dashboard coverage center reflects supplement_lifecycle
    const ccRes = await fetch(`http://127.0.0.1:${port}/workspace/dashboard/coverage-center`);
    expect(ccRes.status).toBe(200);
    const ccData = await ccRes.json();
    expect(ccData.matrix).toBeDefined();

    const cell = ccData.matrix.cells.find((c: any) => c.requirement_id === "req.identity");
    expect(cell).toBeDefined();
    expect(cell.supplement_lifecycle).toBeDefined();
    expect(cell.supplement_lifecycle.current_resolution_id).toBe(body.resolution_id);
    expect(cell.supplement_lifecycle.authorization_saved).toBe(true);
  });
});
