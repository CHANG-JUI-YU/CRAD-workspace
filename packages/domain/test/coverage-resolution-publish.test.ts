import { describe, expect, test } from "vitest";
import {
  contentHash,
  createProjectState,
  internalId,
  type ProjectState,
} from "@st-workspace/core";
import {
  buildCoverageSnapshot,
  buildDefaultRequirementSet,
  fulfillUserSupplementResolution,
  recordUserDecisionAndResolution,
  requirementsResolved,
  runFormalCoverageAssessment,
  sourceFactsReady,
  validateWorkflow,
} from "../src/index.js";

describe("Source Coverage Assessment Batches 7-9", () => {
  const actorInput = { actor: "director", executionAgent: { id: "director", name: "director", role: "orchestrator" as const } };
  const mockOpId = "op-101";

  test("Batch 7: Creative completion resolution lifecycle", () => {
    let state = createProjectState("proj-test-1");
    const reqSet: CoverageRequirementSet = {
      ...buildDefaultRequirementSet(state, "director"),
      characters: [{ character_id: "char-1", requirement_ids: ["req.identity", "req.background"] }],
    };
    state = { ...state, coverage_requirement_sets: [reqSet] };

    const initialAssessment = runFormalCoverageAssessment(state, reqSet, mockOpId, "director");
    state = { ...state, coverage_assessments: [initialAssessment] };

    // Record creative completion for req.identity
    const { decision, resolutions, state: state1 } = recordUserDecisionAndResolution(
      state,
      "creative_completion",
      ["req.identity"],
      "creative_freedom",
      "Character identity is original work.",
      "Custom user text",
      actorInput,
      mockOpId,
      "char-1",
    );

    expect(decision.action).toBe("creative_completion");
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.mode).toBe("creative_completion");
    expect(resolutions[0]?.status).toBe("authorized");

    // Formal assessment should reflect creative completion
    const updatedAssessment = runFormalCoverageAssessment(state1, reqSet, mockOpId, "director");
    const identityItem = updatedAssessment.items.find((i) => i.requirement_id === "req.identity" && i.character_id === "char-1");
    expect(identityItem?.status).toBe("creative_completion_authorized");
  });

  test("Batch 7: User supplement pending and fulfillment successor resolution", () => {
    let state = createProjectState("proj-test-2");
    const reqSet: CoverageRequirementSet = {
      ...buildDefaultRequirementSet(state, "director"),
      characters: [{ character_id: "char-1", requirement_ids: ["req.identity", "req.background"] }],
    };
    const now = new Date().toISOString();
    const sourceRevision = contentHash("supplement-source");
    const acceptedFactRevision = contentHash("fact-accepted");
    const runId = "run-1";
    const decisionId = "dec-1";
    const factId = "fact-1";
    state = {
      ...state,
      coverage_requirement_sets: [reqSet],
      interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
      sources: [{ id: "src-1", candidate_id: "candidate-1", title: "Supplement", canonical_text: "The character was raised in the northern hills.", canonical_url: "https://example.test/supplement", original_hash: contentHash("h"), revision: sourceRevision, media_type: "text/plain", created_at: now }],
      artifacts: [{ id: "blueprint-1", key: "blueprint:proj-test-2", kind: "blueprint", name: "Blueprint", content: JSON.stringify({ kind: "blueprint", project_id: "proj-test-2", characters: [{ id: "char-1", label: "Char", ordinal: 1, mode: "zhuji" }] }), media_type: "application/json", content_hash: contentHash("blueprint"), revision: contentHash("blueprint"), status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: mockOpId }],
      facts: [{ id: factId, statement: "The character was raised in the northern hills.", subject: "char-1", predicate: "was_raised", value: "in the northern hills", classification: "event", coverage: ["background"], coverage_targets: ["req.background"], entity_refs: ["char-1"], status: "accepted", confidence: 0.9, source_ids: ["src-1"], evidence: ["The character was raised in the northern hills."], evidence_refs: [{ source_id: "src-1", source_revision_id: sourceRevision, quote: "The character was raised in the northern hills." }], fact_revision: 1, accepted_fact_revision: acceptedFactRevision, candidate_occurrence_id: "occ-1", review_run_id: runId, decision_id: decisionId, created_at: now, updated_at: now, created_by: "director" }],
      fact_review_runs: [{ schema_version: 1, id: runId, candidate_set_revision: contentHash("set"), candidate_occurrence_ids: ["occ-1"], source_revisions: [{ source_id: "src-1", revision: sourceRevision }], policy_revision: contentHash("policy"), status: "completed", created_by: "director", created_at: now, completed_at: now }],
      fact_review_decisions: [{ schema_version: 1, id: decisionId, operation_id: mockOpId, review_run_id: runId, candidate_occurrence_id: "occ-1", fact_id: factId, reviewer_identity: "director", decision: "accepted", reason: "verified", evidence: [{ source_id: "src-1", source_revision_id: sourceRevision, quote: "The character was raised in the northern hills." }], candidate_revision: contentHash("cand"), expected_projection_revision: contentHash("proj"), resulting_fact_revision: 1, created_at: now }],
    };

    const initialAssessment = runFormalCoverageAssessment(state, reqSet, mockOpId, "director");
    state = { ...state, coverage_assessments: [initialAssessment] };

    // 1. Record user supplement -> pending
    const { resolutions, state: state1 } = recordUserDecisionAndResolution(
      state,
      "user_supplement",
      ["req.background"],
      "supplement_source",
      "User provided background link.",
      "URL link",
      actorInput,
      mockOpId,
      "char-1",
    );

    const pendingRes = resolutions[0]!;
    expect(pendingRes.status).toBe("pending");

    // Requirements should NOT be resolved yet while pending
    const reqCheck1 = requirementsResolved(state1);
    expect(reqCheck1.resolved).toBe(false);

    // 2. Fulfill resolution with accepted fact & source -> successor resolution
    const { resolution: successor, state: state2 } = fulfillUserSupplementResolution(
      state1,
      pendingRes.id,
      [{ source_id: "src-1", revision: sourceRevision }],
      [{ fact_id: factId, fact_revision: acceptedFactRevision, decision_id: decisionId }],
      actorInput,
      mockOpId,
    );

    expect(successor.status).toBe("fulfilled");
    expect(successor.supersedes).toBe(pendingRes.id);

    // Re-evaluate assessment with fulfilled resolution
    const updatedAssessment = runFormalCoverageAssessment(state2, reqSet, mockOpId, "director");
    const bgItem = updatedAssessment.items.find((i) => i.requirement_id === "req.background" && i.character_id === "char-1");
    expect(bgItem?.status).toBe("covered_by_user_supplement");
  });

  test("Batch 8: Readiness separation and authoring coverage binding staleness", () => {
    let state = createProjectState("proj-test-3");
    const reqSet: CoverageRequirementSet = {
      ...buildDefaultRequirementSet(state, "director"),
      characters: [{ character_id: "char-1", requirement_ids: ["req.identity", "req.background"] }],
    };
    state = { ...state, coverage_requirement_sets: [reqSet] };

    const initialAssessment = runFormalCoverageAssessment(state, reqSet, mockOpId, "director");
    state = { ...state, coverage_assessments: [initialAssessment] };

    // Initially requirements are not resolved
    expect(requirementsResolved(state).resolved).toBe(false);

    // Add stale authoring binding
    state = {
      ...state,
      coverage_authoring_bindings: [
        {
          id: "binding-1",
          artifact_id: "art-1",
          artifact_revision: "rev-1",
          assessment_id: "old-assessment",
          assessment_revision: "old-rev",
          requirement_set_revision: reqSet.revision,
          fact_projection_revision: "fp-rev",
          resolution_ids: [],
          input_snapshot_hash: "hash-1",
          created_by: "director",
          created_at: new Date().toISOString(),
        },
      ],
    };

    const gate = validateWorkflow(state, "publish");
    expect(gate.ok).toBe(false);
    expect(gate.diagnostics.some((d) => d.code === "COVERAGE_RESOLUTION_REQUIRED")).toBe(true);
    expect(gate.diagnostics.some((d) => d.code === "COVERAGE_AUTHORING_BINDING_STALE")).toBe(true);
  });

  test("Batch 9: Preview and publish coverage snapshot stale detection", () => {
    let state = createProjectState("proj-test-4");
    const reqSet = buildDefaultRequirementSet(state, "director");
    state = { ...state, coverage_requirement_sets: [reqSet] };

    const assessment = runFormalCoverageAssessment(state, reqSet, mockOpId, "director");
    state = { ...state, coverage_assessments: [assessment] };

    const snapshot = buildCoverageSnapshot(state, assessment);

    // Add a build record with snapshot
    state = {
      ...state,
      builds: [
        {
          id: "build-1",
          operation_id: mockOpId,
          status: "previewed",
          artifact_ids: ["art-1"],
          content_hash: "hash-1234567890123456789012345678901234567890123456789012345678901234",
          diagnostics: [],
          created_at: new Date().toISOString(),
          coverage_snapshot: snapshot,
        },
      ],
    };

    // Mutate state (add a new requirement set / assessment)
    const newAssessment = { ...assessment, revision: "new-assessment-rev" };
    state = { ...state, coverage_assessments: [...state.coverage_assessments, newAssessment] };

    const gate = validateWorkflow(state, "publish");
    expect(gate.ok).toBe(false);
    expect(gate.diagnostics.some((d) => d.code === "COVERAGE_PUBLISH_SNAPSHOT_STALE")).toBe(true);
  });
});
