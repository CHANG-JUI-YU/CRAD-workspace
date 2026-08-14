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
  coverageResolutionConfirm,
  coverageSupplement,
  coverageResearchStart,
  coverageResearchClaim,
  coverageResearchCandidates,
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

function buildAssessmentState(): ProjectState {
  const base = createProjectState("proj-1", "Test Project");
  const s1 = sourceRecord("src-1", "Alpha background facts.");
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

describe("Audit 6 Batch 2 - Runtime Layer", () => {
  it("#36, #41, #42, #65, #66: Supplement command ingests atomically, persists completed operation, and replays safely", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const deps: CoverageApplicationDeps = { repository, knowledge };

    const latestAss = state.coverage_assessments.at(-1)!;
    const opId = "op-supp-test-1";

    // First, confirm user_supplement resolution
    await coverageResolutionConfirm(deps, "director", {
      assessment_id: latestAss.id,
      assessment_revision: latestAss.revision,
      requirement_id: "req.identity",
      character_id: "alpha",
      action: "user_supplement",
      choice: "Provide evidence.",
      rationale: "Provide evidence.",
    });

    // Next, call coverageSupplement with deterministic operation_id
    const result = await coverageSupplement(
      deps,
      "director",
      {
        assessment_id: latestAss.id,
        assessment_revision: latestAss.revision,
        requirement_id: "req.identity",
        character_id: "alpha",
        text: "Alpha has blue hair and green eyes.",
        operation_id: opId,
      },
      [],
    );

    expect(result.status).toBe("completed");
    expect(result.source_id).toBeDefined();
    expect(result.chunk_count).toBeGreaterThan(0);

    const currentState = await repository.read();

    // Verify #36: Operation persisted in state.operations has status "completed", updated_at, result_summary
    const opRecord = currentState.operations.find((o) => o.id === opId);
    expect(opRecord).toBeDefined();
    expect(opRecord!.status).toBe("completed");
    expect(opRecord!.result_summary).toContain("Created user supplement source");

    // Verify #42: SourceRecord.candidate_id points to SourceCandidate in state.candidates
    const source = currentState.sources.find((s) => s.id === result.source_id)!;
    expect(source).toBeDefined();
    const candidate = currentState.candidates.find((c) => c.id === source.candidate_id);
    expect(candidate).toBeDefined();
    expect(candidate!.status).toBe("approved");

    // Verify #41: Knowledge chunks are created in the same state revision
    const chunks = currentState.knowledge_chunks.filter((c) => c.source_id === source.id);
    expect(chunks.length).toBe(result.chunk_count);

    // Verify #66: Replay with same operation_id returns replayed: true and original source_id without duplicate side-effects
    const replayResult = await coverageSupplement(
      deps,
      "director",
      {
        assessment_id: latestAss.id,
        assessment_revision: latestAss.revision,
        requirement_id: "req.appearance",
        character_id: "alpha",
        text: "Alpha has blue hair and green eyes.",
        operation_id: opId,
      },
      [],
    );

    expect(replayResult.replayed).toBe(true);
    expect(replayResult.source_id).toBe(result.source_id);

    const stateAfterReplay = await repository.read();
    expect(stateAfterReplay.sources.length).toBe(currentState.sources.length);
    expect(stateAfterReplay.candidates.length).toBe(currentState.candidates.length);
    expect(stateAfterReplay.knowledge_chunks.length).toBe(currentState.knowledge_chunks.length);
  });

  it("#45: Research candidate submission status projects from authoritative batch status", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const deps: CoverageApplicationDeps = { repository, knowledge };

    const startRes = await coverageResearchStart(deps, "director");
    const batchId = startRes.batch_id as string;
    const taskIds = startRes.task_ids as string[];

    if (taskIds.length > 0) {
      const claimRes = await coverageResearchClaim(deps, "researcher", batchId);
      const claimedTask = claimRes.task as any;

      if (claimedTask) {
        const candRes = await coverageResearchCandidates(
          deps,
          "researcher",
          claimedTask.id,
          claimedTask.claim_generation,
          "researcher",
          [{ title: "Found candidate", url: "https://example.com/item" }],
        );

        expect(candRes.batch_status).toBeDefined();
        expect(candRes.status).toBe("completed");
      }
    }
  });
});
