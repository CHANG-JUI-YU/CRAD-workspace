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
import { DASHBOARD_LISTENERS_JS } from "../src/dashboard-listeners.js";
import { dashboard } from "../src/dashboard.js";

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
    checks: [
      {
        subject_id: "alpha",
        dimension: "character_core",
        uncertainty: "low",
        impact: "low",
        basis: "blueprint character",
        action: "preserve_explicit",
      },
      {
        subject_id: "beta",
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

describe("Audit 6 Batch 4 - Server Coverage Center Integration & Closure Fix", () => {
  it("#53 Dashboard HTML and listeners contain single authoritative Coverage Center", () => {
    const html = dashboard();
    // 1. Single coverage section in HTML
    expect(html).toContain("Coverage Center");
    expect(html).toContain("id=\"coverage-center\"");
    expect(html).toContain("id=\"coverage-center-message\"");
    expect(html).toContain("id=\"research-monitor\"");
    expect(html).not.toContain("id=\"coverage-grid\"");

    // 2. Single click listener for load-coverage in listeners
    const loadMatches = DASHBOARD_LISTENERS_JS.match(/byId\("load-coverage"\)\.addEventListener/g);
    expect(loadMatches).toHaveLength(1);
    expect(DASHBOARD_LISTENERS_JS).toContain("loadCoverageCenterData");
    expect(DASHBOARD_LISTENERS_JS).not.toContain("loadCoverageData");
  });

  it("#46 JS renderer binds immutable cell snapshot to action buttons without closure leakage", () => {
    // Check that legacy renderCoverage is removed and JS uses coverageCenterCellElement
    expect(DASHBOARD_PANELS_COVERAGE_JS).not.toContain("function renderCoverage(");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("function renderCellActionButton(cell, actionOpt)");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("function coverageCenterCellElement(cell, tasks)");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-cell-id");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-scope");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("data-requirement-id");
  });

  it("#48 Server REST endpoints /coverage and /coverage-center serve synchronized views", async () => {
    const pc = precheck("proj-1");
    const reqSet: CoverageRequirementSet = {
      id: "reqset-1",
      revision: "set-rev-1",
      source: "default",
      blueprint_revision: pc.candidate_blueprint_revision,
      characters: [
        { character_id: "alpha", requirement_ids: ["req.identity"] },
        { character_id: "beta", requirement_ids: ["req.identity"] },
      ],
      world_requirement_ids: ["req.world_context"],
      created_at: now,
      created_by: "director",
    };

    const base = createProjectState("proj-1", "Test Project");
    const initial: ProjectState = {
      ...base,
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
    };

    const assessment = runFormalCoverageAssessment(initial, reqSet, "op-formal-1", "director");
    const readyState: ProjectState = {
      ...initial,
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository("proj-1", readyState);
    const runtime = new WorkspaceRuntime(repo);
    const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Fresh state
      const centerRes = await fetch(`${serverUrl}/workspace/dashboard/coverage-center`);
      expect(centerRes.status).toBe(200);
      const centerData = await centerRes.json();

      const legacyRes = await fetch(`${serverUrl}/workspace/dashboard/coverage`);
      expect(legacyRes.status).toBe(200);
      const legacyData = await legacyRes.json();

      expect(centerData.matrix.assessment.fresh).toBe(true);
      expect(legacyData.assessment.current).toBe(true);
      expect(legacyData.cells).toHaveLength(centerData.matrix.cells.length);

      // Verify world cell does not have character_id in legacy view
      const worldCell = legacyData.cells.find((c: { requirement_id: string }) => c.requirement_id === "req.world_context");
      expect(worldCell).toBeDefined();
      expect(worldCell.character_id).toBeUndefined();

      // 2. Add new source to make assessment stale
      await repo.commit((await repo.read()).revision, (curr) => ({
        ...curr,
        sources: [{
          id: "src-new",
          candidate_id: "cand-new",
          title: "New Source",
          canonical_text: "New text",
          original_hash: contentHash("New text"),
          revision: contentHash("New text"),
          media_type: "text/plain",
          created_at: now,
        }],
      }));

      const staleCenterRes = await fetch(`${serverUrl}/workspace/dashboard/coverage-center`);
      const staleCenterData = await staleCenterRes.json();

      const staleLegacyRes = await fetch(`${serverUrl}/workspace/dashboard/coverage`);
      const staleLegacyData = await staleLegacyRes.json();

      expect(staleCenterData.matrix.assessment.fresh).toBe(false);
      expect(staleLegacyData.assessment.current).toBe(false);
      expect(staleLegacyData.cells[0].status).toBe("stale");
      expect(staleCenterData.matrix.cells[0].status).toBe("stale");
      expect(staleLegacyData.cells[0].actions).toEqual(["reassess"]);
      expect(staleCenterData.matrix.cells[0].actions).toEqual(["reassess"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
