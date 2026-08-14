import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import {
  deriveArtifactScopeResolutionIds,
  deriveCoverageCenterMatrix,
  deriveCoverageReadiness,
  deriveCoverageRequirementExplanations,
  deriveStructuredPublishDiagnostics,
  fulfillUserSupplementResolution,
  isCurrentResolution,
  recordUserDecisionAndResolution,
  runFormalCoverageAssessment,
  validateWorkflow,
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

function buildBaseState(): ProjectState {
  const base = createProjectState("proj-1", "Test Project");
  const pc = precheck("proj-1");

  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.identity", "req.personality"] }],
    world_requirement_ids: [],
    created_by: "director",
    created_at: now,
  };

  return {
    ...base,
    project_status: "interviewing",
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };
}

describe("Audit 6 Batch 1 - Domain Semantics", () => {
  it("#35 Fulfilled successor resolution is current and not rejected by deriveArtifactScopeResolutionIds", () => {
    const state = buildBaseState();
    const reqSet = state.coverage_requirement_sets[0]!;

    const initialAssessment = runFormalCoverageAssessment(state, reqSet, "op-init", "director");
    const stateWithAssess: ProjectState = {
      ...state,
      coverage_assessments: [initialAssessment],
    };

    // Record pending user supplement resolution
    const pendingRes = recordUserDecisionAndResolution(
      stateWithAssess,
      "user_supplement",
      ["req.personality"],
      "need extra data",
      "user will provide info",
      "user input data",
      "director",
      "op-supp-1",
      "alpha",
    );

    const pendingState = pendingRes.state;
    const pendingResolution = pendingRes.resolutions[0]!;

    expect(isCurrentResolution(pendingState, pendingResolution, reqSet.revision)).toBe(true);

    // Now ingest a source and fact to fulfill the supplement
    const src = sourceRecord("src-1", "Alpha is very brave and heroic.");
    const fact: FactRecord = {
      id: "fact-1",
      statement: "Alpha is brave",
      status: "accepted",
      subject: "alpha",
      entity_refs: ["alpha"],
      coverage_targets: ["req.personality"],
      source_ids: [src.id],
      fact_revision: 1,
      accepted_fact_revision: 1,
      evidence: ["Alpha is very brave"],
      evidence_refs: [{ source_id: src.id, source_revision_id: src.revision, quote: "Alpha is very brave" }],
      review_run_id: "run-1",
      decision_id: "dec-1",
    };

    const run: FactReviewRunRecord = {
      id: "run-1",
      status: "completed",
      candidate_occurrence_ids: ["occ-1"],
      candidate_set_revision: "cset-1",
      policy_revision: "policy-1",
      created_by: "reviewer",
      created_at: now,
      source_revisions: [{ source_id: src.id, revision: src.revision }],
    };

    const dec: FactReviewDecisionRecord = {
      id: "dec-1",
      review_run_id: "run-1",
      candidate_occurrence_id: "occ-1",
      fact_id: fact.id,
      decision: "accepted",
      resulting_fact_revision: 1,
      reviewer_identity: "reviewer",
      reason: "proven",
      created_at: now,
    };

    const stateWithFact: ProjectState = {
      ...pendingState,
      sources: [src],
      facts: [fact],
      fact_review_runs: [run],
      fact_review_decisions: [dec],
    };

    const fulfilledResult = fulfillUserSupplementResolution(
      stateWithFact,
      pendingResolution.id,
      [{ source_id: src.id, revision: src.revision }],
      [{ fact_id: fact.id, fact_revision: 1, decision_id: dec.id }],
      "director",
      "op-fulfill-1",
    );

    const finalState = fulfilledResult.state;
    const successorResolution = fulfilledResult.resolution;

    // Verify successor has supersedes set to pendingResolution.id
    expect(successorResolution.supersedes).toBe(pendingResolution.id);

    // Pending resolution is now superseded, so NOT current
    expect(isCurrentResolution(finalState, pendingResolution, reqSet.revision)).toBe(false);
    // Successor resolution IS current
    expect(isCurrentResolution(finalState, successorResolution, reqSet.revision)).toBe(true);

    // Re-run formal assessment
    const formalAssessment = runFormalCoverageAssessment(finalState, reqSet, "op-formal-2", "director");
    const evaluatedState: ProjectState = {
      ...finalState,
      coverage_assessments: [...finalState.coverage_assessments, formalAssessment],
    };

    const item = formalAssessment.items.find((i) => i.requirement_id === "req.personality");
    expect(item?.status).toBe("covered_by_user_supplement");
    expect(item?.resolution_ids).toEqual([successorResolution.id]);

    // deriveArtifactScopeResolutionIds must NOT throw because successor has supersedes !== undefined!
    const charArtifact: ArtifactRecord = {
      id: "art-char-1",
      key: "character:alpha",
      kind: "character",
      name: "Alpha Card",
      content: JSON.stringify({ kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha" } }),

      media_type: "application/json",
      content_hash: "hash-1",
      revision: "rev-1",
      status: "draft",
      created_at: now,
      updated_at: now,
      created_by: "author",
      operation_id: "op-author",
      bindings: [{ character_id: "alpha" }],
    } as unknown as ArtifactRecord;

    const scopeResIds = deriveArtifactScopeResolutionIds(evaluatedState, charArtifact, formalAssessment);
    expect(scopeResIds).toContain(successorResolution.id);
  });

  it("#38 Legacy hard-coded fact matrix is removed and creative completion resolves requirement", () => {
    const state = buildBaseState();
    const reqSet = state.coverage_requirement_sets[0]!;

    const initialAssessment = runFormalCoverageAssessment(state, reqSet, "op-init", "director");
    const stateWithAssess: ProjectState = {
      ...state,
      coverage_assessments: [initialAssessment],
    };

    // Authorize creative completion for req.identity and req.personality
    const creativeRes1 = recordUserDecisionAndResolution(
      stateWithAssess,
      "creative_completion",
      ["req.identity"],
      "creative authorization",
      "authorizing creative writing",
      "creative input",
      "director",
      "op-creative-1",
      "alpha",
    );
    const creativeRes2 = recordUserDecisionAndResolution(
      creativeRes1.state,
      "creative_completion",
      ["req.personality"],
      "creative authorization",
      "authorizing creative writing",
      "creative input",
      "director",
      "op-creative-2",
      "alpha",
    );

    const formalAssessment = runFormalCoverageAssessment(creativeRes2.state, reqSet, "op-formal", "director");
    const stateWithFormal: ProjectState = {
      ...creativeRes2.state,
      coverage_assessments: [...creativeRes2.state.coverage_assessments, formalAssessment],
    };

    const readiness = deriveCoverageReadiness(stateWithFormal);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);

    // validateWorkflow must not produce legacy FACT_COVERAGE_INCOMPLETE
    const gateResult = validateWorkflow(stateWithFormal, "publish");
    const legacyBlocker = gateResult.diagnostics.find((d) => d.code === "FACT_COVERAGE_INCOMPLETE");
    expect(legacyBlocker).toBeUndefined();
  });

  it("#67 Shared CoverageRequirementExplanation matches across authoring blockers, publish diagnostics, and coverage center", () => {
    const state = buildBaseState();
    const reqSet = state.coverage_requirement_sets[0]!;

    const formalAssessment = runFormalCoverageAssessment(state, reqSet, "op-formal", "director");
    const stateWithFormal: ProjectState = {
      ...state,
      coverage_assessments: [formalAssessment],
    };

    const explanations = deriveCoverageRequirementExplanations(stateWithFormal);
    expect(explanations.length).toBeGreaterThan(0);

    const identityExp = explanations.find((e) => e.requirement_id === "req.identity" && e.character_id === "alpha");
    expect(identityExp).toBeDefined();
    expect(identityExp?.scope).toBe("character");
    expect(identityExp?.status).toBe("missing");
    expect(identityExp?.reason).toContain("尚未滿足覆蓋");
    expect(identityExp?.missing_prerequisite).toBe("完成來源覆蓋或取得使用者 resolution");

    const matrix = deriveCoverageCenterMatrix(stateWithFormal);
    const cell = matrix.cells.find((c) => c.requirement_id === "req.identity" && c.character_id === "alpha");
    expect(cell).toBeDefined();
    expect(cell?.reason).toBe(identityExp?.reason);
    expect(cell?.missing_prerequisite).toBe(identityExp?.missing_prerequisite);

    const gate = validateWorkflow(stateWithFormal, "publish");
    const structured = deriveStructuredPublishDiagnostics(gate.diagnostics);
    const covRow = structured.rows.find((r) => r.code === "COVERAGE_RESOLUTION_REQUIRED");
    expect(covRow).toBeDefined();
  });
});
