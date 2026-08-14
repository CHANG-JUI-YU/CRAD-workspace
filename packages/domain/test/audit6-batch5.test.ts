import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
  type WorkflowDiagnostic,
} from "@st-workspace/core";
import { deriveStructuredPublishDiagnostics, runFormalCoverageAssessment, validateWorkflow } from "../src/index.js";

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
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: bp,
    candidate_blueprint_revision: contentHash(JSON.stringify(bp)),
    status: "recorded",
    checks: [],
    created_at: now,
    created_by: "director",
  };
}

function buildUnresolvedState(): ProjectState {
  const base = createProjectState("proj-1", "Test Project");
  const pc = precheck("proj-1");
  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [
      { character_id: "alpha", requirement_ids: ["req.identity", "req.personality"] },
    ],
    world_requirement_ids: ["req.world_context"],
    created_by: "director",
    created_at: now,
  };
  const withPrecheck: ProjectState = {
    ...base,
    project_status: "interviewing",
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };
  const assessment = runFormalCoverageAssessment(withPrecheck, reqSet, "op-formal-1", "director");
  return {
    ...withPrecheck,
    coverage_assessments: [assessment],
  };
}

describe("Audit 6 Batch 5 - Publish Diagnostics Precise Navigation", () => {
  it("COVERAGE_RESOLUTION_REQUIRED carries structured coverage_refs from the authoritative projection", () => {
    const state = buildUnresolvedState();
    const result = validateWorkflow(state, "publish");
    const diagnostic = result.diagnostics.find((item) => item.code === "COVERAGE_RESOLUTION_REQUIRED");
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.coverage_refs).toEqual([
      { character_id: "alpha", requirement_id: "req.identity" },
      { character_id: "alpha", requirement_id: "req.personality" },
      { requirement_id: "req.world_context" },
    ]);
    expect(diagnostic!.message).toContain("req.identity");
  });

  it("coverage_refs produce per-cell targets with character_id and requirement_id, and world cells omit character_id", () => {
    const diagnostic: WorkflowDiagnostic = {
      code: "COVERAGE_RESOLUTION_REQUIRED",
      message: "Unresolved coverage requirements remain.",
      severity: "error",
      coverage_refs: [
        { character_id: "alpha", requirement_id: "req.identity" },
        { requirement_id: "req.world_context" },
      ],
    };
    const structured = deriveStructuredPublishDiagnostics([diagnostic]);
    expect(structured.has_unknown).toBe(false);
    const row = structured.rows[0]!;
    expect(row.affected).toEqual([
      { kind: "coverage_cell", character_id: "alpha", requirement_id: "req.identity" },
      { kind: "coverage_cell", requirement_id: "req.world_context" },
    ]);
    expect(row.targets).toEqual([
      { panel: "coverage", kind: "coverage_cell", character_id: "alpha", requirement_id: "req.identity" },
      { panel: "coverage", kind: "coverage_cell", requirement_id: "req.world_context" },
    ]);
    expect(row.target).toEqual(row.targets![0]);
    expect(row.targets![0]!.character_id).toBe("alpha");
    expect(row.targets![0]!.requirement_id).toBe("req.identity");
    expect(row.targets![1]!.character_id).toBeUndefined();
    expect(row.targets![1]!.requirement_id).toBe("req.world_context");
  });

  it("maps fact/artifact/source ids to exact-object targets and derives target from targets[0]", () => {
    const diagnostics: WorkflowDiagnostic[] = [
      { code: "FACT_REVIEW_NEEDS_EVIDENCE", message: "needs evidence", severity: "error", fact_ids: ["fact-1", "fact-2"] },
      { code: "ARTIFACT_REVIEW_REQUIRED", message: "review needed", severity: "error", artifact_ids: ["character-alpha"] },
      { code: "SOURCE_RESEARCH_NOT_INGESTED", message: "not ingested", severity: "error", source_ids: ["source-1"] },
    ];
    const structured = deriveStructuredPublishDiagnostics(diagnostics);
    expect(structured.rows).toHaveLength(3);
    const facts = structured.rows.find((row) => row.code === "FACT_REVIEW_NEEDS_EVIDENCE")!;
    expect(facts.targets).toEqual([
      { panel: "facts", kind: "fact", id: "fact-1" },
      { panel: "facts", kind: "fact", id: "fact-2" },
    ]);
    expect(facts.target).toEqual(facts.targets![0]);
    expect(facts.target!.id).toBe("fact-1");
    const artifact = structured.rows.find((row) => row.code === "ARTIFACT_REVIEW_REQUIRED")!;
    expect(artifact.targets).toEqual([{ panel: "artifacts", kind: "artifact", id: "character-alpha" }]);
    expect(artifact.target).toEqual(artifact.targets![0]);
    const source = structured.rows.find((row) => row.code === "SOURCE_RESEARCH_NOT_INGESTED")!;
    expect(source.targets).toEqual([{ panel: "sources", kind: "source", id: "source-1" }]);
  });

  it("panel-level fallback is used when a known diagnostic carries no object ids", () => {
    const diagnostic: WorkflowDiagnostic = {
      code: "COVERAGE_ASSESSMENT_STALE",
      message: "assessment stale",
      severity: "error",
    };
    const structured = deriveStructuredPublishDiagnostics([diagnostic]);
    const row = structured.rows[0]!;
    expect(row.affected).toEqual([]);
    expect(row.targets).toEqual([{ panel: "coverage" }]);
    expect(row.targets![0]!.id).toBeUndefined();
    expect(row.target).toEqual(row.targets![0]);
  });

  it("coverage-panel diagnostics never misuse fact ids as coverage cell ids", () => {
    const diagnostic: WorkflowDiagnostic = {
      code: "FACT_COVERAGE_INCOMPLETE",
      message: "coverage incomplete",
      severity: "error",
      fact_ids: ["fact-9"],
    };
    const structured = deriveStructuredPublishDiagnostics([diagnostic]);
    const row = structured.rows[0]!;
    expect(row.affected).toEqual([{ kind: "fact", id: "fact-9" }]);
    expect(row.targets).toEqual([{ panel: "coverage", kind: "fact", id: "fact-9" }]);
  });

  it("unknown diagnostics safely fall back to the Publish Readiness panel", () => {
    const diagnostic: WorkflowDiagnostic = { code: "MYSTERY_CODE", message: "mystery", severity: "error" };
    const structured = deriveStructuredPublishDiagnostics([diagnostic]);
    expect(structured.has_unknown).toBe(true);
    const row = structured.rows[0]!;
    expect(row.affected).toEqual([]);
    expect(row.targets).toEqual([{ panel: "readiness" }]);
    expect(row.target!.panel).toBe("readiness");
  });

  it("targets JSON contract round-trips through serialization", () => {
    const diagnostic: WorkflowDiagnostic = {
      code: "COVERAGE_RESOLUTION_REQUIRED",
      message: "Unresolved coverage requirements remain.",
      severity: "error",
      coverage_refs: [{ character_id: "alpha", requirement_id: "req.identity" }],
    };
    const structured = deriveStructuredPublishDiagnostics([diagnostic]);
    const revived = JSON.parse(JSON.stringify(structured)) as typeof structured;
    expect(revived.rows[0]!.targets).toEqual(structured.rows[0]!.targets);
    expect(revived.rows[0]!.target).toEqual(structured.rows[0]!.target);
    expect(revived.rows[0]!.target!.panel).toBe("coverage");
  });
});
