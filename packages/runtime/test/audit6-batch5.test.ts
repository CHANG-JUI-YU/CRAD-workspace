import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import { runFormalCoverageAssessment } from "@st-workspace/domain";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";

function precheck(projectId: string): BlueprintPrecheckRecord {
  const bp = {
    schema_version: 1,
    title: "Test Blueprint",
    source_adaptation: true,
    characters: [
      { id: "alpha", label: "Alpha", is_primary: true },
      { id: "beta", label: "Beta", is_primary: false },
    ],
    world: { enabled: true },
    relationships: { enabled: false },
  };
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: bp,
    candidate_blueprint_revision: contentHash(JSON.stringify(bp)),
    status: "recorded",
    checks: [
      {
        subject_id: "alpha",
        dimension: "character_core",
        uncertainty: "low",
        impact: "low",
        basis: "blueprint character",
        action: "preserve_explicit",
      },
    ],
    created_at: now,
    created_by: "director",
  };
}

function buildState(projectId: string): ProjectState {
  const base = createProjectState(projectId, "Test Project");
  const pc = precheck(projectId);
  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [
      { character_id: "alpha", requirement_ids: ["req.identity"] },
      { character_id: "beta", requirement_ids: ["req.personality"] },
    ],
    world_requirement_ids: ["req.world_context"],
    created_by: "director",
    created_at: now,
  };
  const withPrecheck: ProjectState = {
    ...base,
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };
  const assessment = runFormalCoverageAssessment(withPrecheck, reqSet, "op-formal-1", "director");
  return {
    ...withPrecheck,
    coverage_assessments: [assessment],
  };
}

function makeRuntime(projectId: string): WorkspaceRuntime {
  const repository = new MemoryProjectRepository(projectId, buildState(projectId));
  return new WorkspaceRuntime(repository);
}

describe("Audit 6 Batch 5 - Runtime Publish Diagnostics Targets Contract", () => {
  it("dashboardPublishDiagnostics exposes canonical targets with coverage cell identities", async () => {
    const runtime = makeRuntime("batch6-b5-runtime");
    const structured = await runtime.dashboardPublishDiagnostics();
    const resolution = structured.rows.find((row) => row.code === "COVERAGE_RESOLUTION_REQUIRED");
    expect(resolution).toBeDefined();
    expect(Array.isArray(resolution!.targets)).toBe(true);
    expect(resolution!.targets!.length).toBeGreaterThanOrEqual(3);
    const alphaTarget = resolution!.targets!.find((t) => t.character_id === "alpha");
    expect(alphaTarget).toBeDefined();
    expect(alphaTarget!.kind).toBe("coverage_cell");
    expect(alphaTarget!.panel).toBe("coverage");
    expect(alphaTarget!.requirement_id).toBe("req.identity");
    const worldTarget = resolution!.targets!.find((t) => t.requirement_id === "req.world_context");
    expect(worldTarget).toBeDefined();
    expect(worldTarget!.character_id).toBeUndefined();
    expect(worldTarget!.kind).toBe("coverage_cell");
    expect(resolution!.target).toEqual(resolution!.targets![0]);
  });

  it("keeps legacy target field and next_action for compatibility", async () => {
    const runtime = makeRuntime("batch6-b5-runtime-compat");
    const structured = await runtime.dashboardPublishDiagnostics();
    expect(structured.rows.length).toBeGreaterThan(0);
    for (const row of structured.rows) {
      expect(typeof row.code).toBe("string");
      expect(row.severity === "error" || row.severity === "warning").toBe(true);
      expect(typeof row.next_action).toBe("string");
      if (row.targets !== undefined && row.targets.length > 0) {
        expect(row.target).toEqual(row.targets[0]);
      }
    }
  });

  it("every target carries a stable panel for safe fallback navigation", async () => {
    const runtime = makeRuntime("batch6-b5-runtime-unknown");
    const structured = await runtime.dashboardPublishDiagnostics();
    expect(Array.isArray(structured.rows)).toBe(true);
    for (const row of structured.rows) {
      if (row.targets === undefined || row.targets.length === 0) continue;
      for (const target of row.targets) {
        expect(typeof target.panel).toBe("string");
        expect(target.panel.length).toBeGreaterThan(0);
      }
      expect(row.target).toEqual(row.targets[0]);
    }
  });
});
