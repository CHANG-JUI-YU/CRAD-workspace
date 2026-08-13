import { describe, expect, it } from "vitest";
import {
  createProjectState,
  coverageAssessmentRevision,
  coverageRequirementSetRevision,
  buildDefaultRequirementSet,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import {
  approveSourceCandidate,
  assertResearchCapability,
  claimResearchTask,
  createResearchBatchFromAssessment,
  exhaustResearchTask,
  fetchApprovedSource,
  getTaskBoundChunksAndHints,
  submitResearchTaskCandidates,
} from "../src/index.js";

function setupStateWithAssessment(): { state: ProjectState; assessmentId: string } {
  let state = createProjectState("test-proj");

  // Create default requirement set
  const reqSetObj = buildDefaultRequirementSet(["char-luna"], true, "blueprint", "bp-1", "rev-1", "user-1");
  const reqSetRev = coverageRequirementSetRevision(reqSetObj);
  const reqSet: CoverageRequirementSet = { ...reqSetObj, id: "reqset-1", revision: reqSetRev, created_at: new Date().toISOString() };

  // Create assessment with missing items
  const assessmentObj = {
    pass: "initial" as const,
    requirement_set_id: reqSet.id,
    requirement_set_revision: reqSet.revision,
    input_snapshot: { source_revisions: [] },
    items: [
      { character_id: "char-luna", requirement_id: "req.appearance", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { character_id: "char-luna", requirement_id: "req.personality", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { character_id: "char-luna", requirement_id: "req.relationships", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      { requirement_id: "req.world_context", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
    ],
    operation_id: "op-1",
  };
  const assessmentRev = coverageAssessmentRevision(assessmentObj);
  const assessment: CoverageAssessment = { ...assessmentObj, id: "assess-1", revision: assessmentRev, created_by: "system", created_at: new Date().toISOString() };

  state = {
    ...state,
    coverage_requirement_sets: [reqSet],
    coverage_assessments: [assessment],
  };

  return { state, assessmentId: assessment.id };
}

describe("Research Orchestration (Batches 4-6)", () => {
  it("should create research batch and tasks from missing assessment items", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, tasks, state } = createResearchBatchFromAssessment(initial, assessmentId, "director");

    expect(batch.status).toBe("open");
    expect(tasks.length).toBeGreaterThan(0);
    expect(state.coverage_research_batches.length).toBe(1);
    expect(state.coverage_research_tasks.length).toBe(tasks.length);
  });

  it("should enforce claim fencing and max 3 active parallel claims", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, state: stateWithBatch } = createResearchBatchFromAssessment(initial, assessmentId, "director");

    // Claim task 1
    const claimed1 = claimResearchTask(stateWithBatch, batch.id, "worker-1");
    expect(claimed1).toBeDefined();
    expect(claimed1!.task.status).toBe("claimed");
    expect(claimed1!.task.claim_generation).toBe(1);

    // Claim task 2
    const claimed2 = claimResearchTask(claimed1!.state, batch.id, "worker-2");
    expect(claimed2).toBeDefined();

    // Claim task 3
    const claimed3 = claimResearchTask(claimed2!.state, batch.id, "worker-3");
    expect(claimed3).toBeDefined();

    // Claim task 4 should throw error due to 3 active claims limit
    expect(() => claimResearchTask(claimed3!.state, batch.id, "worker-4")).toThrowError(/maximum 3 active research claims/iu);
  });

  it("should submit candidates, perform deduplication and preserve lineage links", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, state: stateWithBatch } = createResearchBatchFromAssessment(initial, assessmentId, "director");
    const claimed = claimResearchTask(stateWithBatch, batch.id, "worker-1")!;

    const candidateInputs = [
      {
        title: "Luna Wiki Page",
        url: "https://example.com/luna",
        canonical_url: "https://example.com/luna",
        snippet: "Luna has blue eyes and silver hair.",
        target_requirement_ids: ["req.appearance"],
      },
    ];

    const result = submitResearchTaskCandidates(
      claimed.state,
      claimed.task.id,
      claimed.task.claim_generation,
      claimed.task.lease_owner!,
      candidateInputs,
      "researcher-1",
    );

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.status).toBe("pending"); // NEVER auto-approve
    expect(result.lineages.length).toBe(1);
    expect(result.lineages[0]!.requirement_id).toBe("req.appearance");

    // Deduplication check: submit identical candidate URL
    const resubmit = submitResearchTaskCandidates(
      result.state,
      claimed.task.id,
      claimed.task.claim_generation,
      claimed.task.lease_owner!,
      candidateInputs,
      "researcher-1",
    );

    // Candidate count in state should remain 1 (deduplicated), but new lineage added
    expect(resubmit.state.candidates.length).toBe(1);
    expect(resubmit.state.coverage_research_lineages.length).toBe(2);
  });

  it("should enforce capability check (Researcher cannot approve or fetch unapproved)", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, state: stateWithBatch } = createResearchBatchFromAssessment(initial, assessmentId, "director");
    const claimed = claimResearchTask(stateWithBatch, batch.id, "worker-1")!;
    const { candidates, state: stateWithCand } = submitResearchTaskCandidates(
      claimed.state,
      claimed.task.id,
      claimed.task.claim_generation,
      claimed.task.lease_owner!,
      [{ title: "Test Doc", canonical_url: "https://example.com/test" }],
      "researcher-1",
    );

    const candId = candidates[0]!.id;

    // Researcher attempt to approve source must be denied
    expect(() => assertResearchCapability("researcher-1", "approve_source")).toThrowError(/lacks capability/iu);
    expect(() => approveSourceCandidate(stateWithCand, candId, undefined, "researcher-1", "op-1")).toThrowError(/lacks capability/iu);

    // Fetch unapproved candidate must throw COVERAGE_RESEARCH_APPROVAL_REQUIRED
    expect(() => fetchApprovedSource(stateWithCand, candId, "text content", "director")).toThrowError(/not approved for fetch/iu);

    // Director approves source candidate
    const approved = approveSourceCandidate(stateWithCand, candId, undefined, "director", "op-1");
    expect(approved.candidate.status).toBe("approved");

    // Director fetches approved source
    const fetched = fetchApprovedSource(approved.state, candId, "canonical source text content", "director");
    expect(fetched.source.canonical_text).toBe("canonical source text content");
    expect(fetched.state.sources.length).toBe(1);
  });

  it("should enforce bounded exhaustion policy", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, state: stateWithBatch } = createResearchBatchFromAssessment(initial, assessmentId, "director");
    const claimed = claimResearchTask(stateWithBatch, batch.id, "worker-1")!;

    // Exhaustion with empty search queries should fail
    expect(() =>
      exhaustResearchTask(
        claimed.state,
        claimed.task.id,
        claimed.task.claim_generation,
        claimed.task.lease_owner!,
        [],
        ["web"],
        "no results found",
        "researcher-1",
      ),
    ).toThrowError(/empty query history/iu);

    // Exhaustion with temporary error reason should fail
    expect(() =>
      exhaustResearchTask(
        claimed.state,
        claimed.task.id,
        claimed.task.claim_generation,
        claimed.task.lease_owner!,
        ["search query 1"],
        ["web"],
        "temporary network error",
        "researcher-1",
      ),
    ).toThrowError(/temporary failure cannot be recorded/iu);

    // Valid bounded exhaustion
    const exhausted = exhaustResearchTask(
      claimed.state,
      claimed.task.id,
      claimed.task.claim_generation,
      claimed.task.lease_owner!,
      ["search query 1", "search query 2"],
      ["web"],
      "Searched official wiki and fansite, no information available.",
      "researcher-1",
    );

    expect(exhausted.task.status).toBe("exhausted");
  });

  it("should provide task-bound chunks and hints", () => {
    const { state: initial, assessmentId } = setupStateWithAssessment();
    const { batch, state: stateWithBatch } = createResearchBatchFromAssessment(initial, assessmentId, "director");
    const task = stateWithBatch.coverage_research_tasks[0]!;

    const result = getTaskBoundChunksAndHints(stateWithBatch, task.id);
    expect(result.task.id).toBe(task.id);
    expect(result.requirement_hints.length).toBeGreaterThan(0);
  });
});
