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
  KnowledgeService,
  runFormalCoverageAssessment,
} from "@st-workspace/domain";
import {
  coverageResearchStart,
  coverageResearchStartPreview,
  coverageResearchClaim,
  coverageResearchExhaust,
  coverageResearchRecover,
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

function buildAssessmentState(): ProjectState {
  const base = createProjectState("proj-1", "Test Project");
  const s1 = sourceRecord("src-1", "Alpha background facts.");
  const pc = precheck("proj-1");
  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.identity", "req.personality"] }],
    world_requirement_ids: ["req.world_context"],
    created_by: "director",
    created_at: now,
  };
  const state: ProjectState = {
    ...base,
    sources: [s1],
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };
  const assessment = runFormalCoverageAssessment(state, reqSet, "op-formal-1", "actor");
  return {
    ...state,
    coverage_assessments: [assessment],
  };
}

describe("Audit 6 Batch 3 - Runtime Research Preview and Recovery", () => {
  it("#56 UX6-04: coverageResearchStartPreview calculates requested, existing, and new tasks accurately", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const deps: CoverageApplicationDeps = { repository, knowledge };

    const latestAss = state.coverage_assessments.at(-1)!;

    // 1. Preview assessment-wide scope when no tasks exist
    const preview1 = await coverageResearchStartPreview(deps, {
      assessment_id: latestAss.id,
      assessment_revision: latestAss.revision,
      scope: { kind: "assessment" },
    });

    expect(preview1.requested_targets.length).toBe(3);
    expect(preview1.existing_targets.length).toBe(0);
    expect(preview1.new_task_count).toBeGreaterThan(0);
    expect(preview1.already_covered).toBe(false);

    // 2. Start scoped research for alpha's identity
    await coverageResearchStart(deps, "director", latestAss.id, latestAss.revision, {
      kind: "requirements",
      targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
    });

    // 3. Preview scoped research for alpha's identity again
    const preview2 = await coverageResearchStartPreview(deps, {
      assessment_id: latestAss.id,
      assessment_revision: latestAss.revision,
      scope: {
        kind: "requirements",
        targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
      },
    });

    expect(preview2.requested_targets.length).toBe(1);
    expect(preview2.existing_targets.length).toBe(1);
    expect(preview2.new_task_count).toBe(0);
    expect(preview2.already_covered).toBe(true);
  });

  it("#37 & #64: coverageResearchRecover executes all 5 recovery actions with exact task locking", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const deps: CoverageApplicationDeps = { repository, knowledge };

    const latestAss = state.coverage_assessments.at(-1)!;

    // Start research batch
    const startResult = await coverageResearchStart(deps, "director", latestAss.id, latestAss.revision, {
      kind: "requirements",
      targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
    });

    const batchId = startResult.batch_id as string;

    // Claim and exhaust the task
    const claimResult = await coverageResearchClaim(deps, "researcher-1", batchId);
    const claimedTask = claimResult.task as ResearchTaskRecord;
    const taskId = claimedTask.id;
    const claimGen = claimedTask.claim_generation;
    const leaseOwner = claimedTask.lease_owner!;

    await coverageResearchExhaust(deps, "researcher-1", taskId, claimGen, leaseOwner, ["query 1"], ["wiki"], "No sources found");

    // Verify task is exhausted
    const stateAfterExhaust = await repository.read();
    const exhaustedTask = stateAfterExhaust.coverage_research_tasks.find((t) => t.id === taskId)!;
    expect(exhaustedTask.status).toBe("exhausted");

    // Action 1: revise_query creates a successor task
    const recover1 = await coverageResearchRecover(deps, "director", {
      task_id: taskId,
      action: "revise_query",
      query_seeds: ["Alpha revised query 2"],
    });

    expect(recover1.action).toBe("revise_query");
    const successorTaskId = (recover1.task as ResearchTaskRecord).id;
    expect(successorTaskId).toBeDefined();

    const stateAfterRecover1 = await repository.read();
    const successorTask = stateAfterRecover1.coverage_research_tasks.find((t) => t.id === successorTaskId)!;
    expect(successorTask.predecessor_id).toBe(taskId);
    expect(successorTask.query_seeds).toEqual(["Alpha revised query 2"]);
    expect(successorTask.status).toBe("queued");

    // Trying to recover the same exhausted task again fails because it now has a successor
    await expect(
      coverageResearchRecover(deps, "director", {
        task_id: taskId,
        action: "manual_url",
        url: "https://example.com/alpha",
      }),
    ).rejects.toThrowError(/has already been recovered/);

    // Now exhaust the successor task to test manual_url
    const claim2 = await coverageResearchClaim(deps, "researcher-1", batchId);
    const claimedTask2 = claim2.task as ResearchTaskRecord;
    await coverageResearchExhaust(deps, "researcher-1", claimedTask2.id, claimedTask2.claim_generation, claimedTask2.lease_owner!, ["query 2"], ["wiki"], "Still no sources");

    // Action 2: manual_url ingests source and creates lineage
    const recover2 = await coverageResearchRecover(deps, "director", {
      task_id: claimedTask2.id,
      action: "manual_url",
      url: "https://example.com/alpha-official-doc",
    });

    expect(recover2.action).toBe("manual_url");
    expect(recover2.source_id).toBeDefined();

    const stateAfterRecover2 = await repository.read();
    const ingestedSource = stateAfterRecover2.sources.find((s) => s.id === recover2.source_id);
    expect(ingestedSource).toBeDefined();
    expect(ingestedSource?.canonical_url).toBe("https://example.com/alpha-official-doc");
    expect(stateAfterRecover2.coverage_research_lineages.some((l) => l.task_id === claimedTask2.id)).toBe(true);
  });
});
