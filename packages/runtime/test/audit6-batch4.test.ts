import { describe, expect, it } from "vitest";
import {
  contentHash,
  MemoryProjectRepository,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import {
  deriveCoverageCenterMatrix,
  runFormalCoverageAssessment,
} from "@st-workspace/domain";
import {
  dashboardCoverage,
  dashboardCoverageCenter,
  type CoverageApplicationDeps,
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

describe("Audit 6 Batch 4 - Runtime Coverage Projection & Freshness", () => {
  it("#48 dashboardCoverage is a pure projection of deriveCoverageCenterMatrix in fresh state", async () => {
    const pc = precheck("proj-1");
    const reqSet: CoverageRequirementSet = {
      id: "reqset-1",
      revision: "set-rev-1",
      source: "default",
      blueprint_revision: pc.candidate_blueprint_revision,
      characters: [
        { character_id: "alpha", requirement_ids: ["req.identity", "req.personality"] },
        { character_id: "beta", requirement_ids: ["req.identity"] },
      ],
      world_requirement_ids: ["req.world_context"],
      created_at: now,
      created_by: "director",
    };

    const s1 = sourceRecord("src-1", "Alpha and Beta background text");
    const base = createProjectState("proj-1", "Test Project");
    const stateWithSources: ProjectState = {
      ...base,
      blueprint_prechecks: [pc],
      sources: [s1],
      coverage_requirement_sets: [reqSet],
    };

    const assessment = runFormalCoverageAssessment(stateWithSources, reqSet, "op-formal-1", "director");

    const readyState: ProjectState = {
      ...stateWithSources,
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository("proj-1", readyState);
    const deps: CoverageApplicationDeps = { repository: repo };

    const matrixView = await dashboardCoverageCenter(deps);
    const legacyView = await dashboardCoverage(deps);

    expect(matrixView.matrix.assessment?.fresh).toBe(true);
    expect((legacyView.assessment as { current: boolean }).current).toBe(true);
    expect(typeof legacyView.ready).toBe("boolean");

    const legacyCells = legacyView.cells as Array<{
      character_id?: string;
      requirement_id: string;
      status: string;
      actions: string[];
    }>;

    expect(legacyCells).toHaveLength(matrixView.matrix.cells.length);

    for (let i = 0; i < matrixView.matrix.cells.length; i++) {
      const mCell = matrixView.matrix.cells[i];
      const lCell = legacyCells[i];

      expect(lCell.requirement_id).toBe(mCell.requirement_id);
      expect(lCell.character_id).toBe(mCell.character_id);
      expect(lCell.status).toBe(mCell.status);
      expect(lCell.actions).toEqual(mCell.actions);

      if (mCell.scope === "world") {
        expect(lCell.character_id).toBeUndefined();
      }
    }
  });

  it("#48 dashboardCoverage reflects stale status consistently when sources/facts change", async () => {
    const pc = precheck("proj-1");
    const reqSet: CoverageRequirementSet = {
      id: "reqset-1",
      revision: "set-rev-1",
      source: "default",
      blueprint_revision: pc.candidate_blueprint_revision,
      characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
      world_requirement_ids: [],
      created_at: now,
      created_by: "director",
    };

    const s1 = sourceRecord("src-1", "Alpha background");
    const base = createProjectState("proj-1", "Test Project");
    const stateWithSources: ProjectState = {
      ...base,
      blueprint_prechecks: [pc],
      sources: [s1],
      coverage_requirement_sets: [reqSet],
    };

    const assessment = runFormalCoverageAssessment(stateWithSources, reqSet, "op-formal-1", "director");

    // Now introduce a new source s2 after assessment, making the assessment stale
    const s2 = sourceRecord("src-2", "New Alpha info");
    const staleState: ProjectState = {
      ...stateWithSources,
      sources: [s1, s2],
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository("proj-1", staleState);
    const deps: CoverageApplicationDeps = { repository: repo };

    const matrixView = await dashboardCoverageCenter(deps);
    const legacyView = await dashboardCoverage(deps);

    expect(matrixView.matrix.assessment?.fresh).toBe(false);
    expect((legacyView.assessment as { current: boolean }).current).toBe(false);

    const legacyCells = legacyView.cells as Array<{
      character_id?: string;
      requirement_id: string;
      status: string;
      actions: string[];
    }>;

    expect(legacyCells[0].status).toBe("stale");
    expect(matrixView.matrix.cells[0].status).toBe("stale");
    expect(legacyCells[0].actions).toEqual(["reassess"]);
    expect(matrixView.matrix.cells[0].actions).toEqual(["reassess"]);
  });
});
