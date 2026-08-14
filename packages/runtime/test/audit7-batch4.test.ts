import { describe, expect, it } from "vitest";
import {
  contentHash,
  MemoryProjectRepository,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import {
  runFormalCoverageAssessment,
  KnowledgeService,
} from "@st-workspace/domain";
import {
  coverageSupplement,
  type CoverageApplicationDeps,
} from "../src/index.js";

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

async function setupRuntimeState() {
  const pc = precheck("test-proj");
  const initialState = createProjectState("test-proj");

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

  const assessment = runFormalCoverageAssessment(baseState, reqSet, "op-formal-1", "director");

  const state: ProjectState = {
    ...baseState,
    coverage_assessments: [assessment],
  };

  const repository = new MemoryProjectRepository("test-proj", state);
  const knowledge = new KnowledgeService(repository);
  let shouldFailFetch = false;

  const mockFetcher = async (url: string) => {
    if (shouldFailFetch) {
      throw new Error("Simulated network failure during evidence fetch.");
    }
    return {
      content: new TextEncoder().encode("Fetched content from " + url),
      media_type: "text/plain",
      title: "Mock Title",
    };
  };

  const deps: CoverageApplicationDeps = {
    repository,
    knowledge,
    fetcher: mockFetcher,
  };

  return { repository, deps, assessment, setShouldFailFetch: (v: boolean) => { shouldFailFetch = v; } };
}

describe("Audit 7 Batch 4 - Runtime Supplement Lineage & Retry", () => {
  it("atomically creates decision, authorization pending resolution, and evidence-bound pending successor", async () => {
    const { deps, assessment } = await setupRuntimeState();

    const result = await coverageSupplement(deps, "director", {
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_id: "req.identity",
      character_id: "alpha",
      choice: "由創作者補充 Alpha 的身份設定",
      rationale: "原始資料缺少關鍵身份背景",
      text: "Alpha 是一名資深探險家，擁有豐富的地質學知識。",
    });

    expect(result.status).toBe("completed");
    expect(result.source_id).toBeDefined();
    expect(result.chunk_count).toBeGreaterThan(0);
    expect(result.resolution_id).toBeDefined();

    const state = await deps.repository.read();
    expect(state.coverage_user_decisions).toHaveLength(1);
    expect(state.coverage_user_decisions[0]?.choice).toBe("由創作者補充 Alpha 的身份設定");

    // Resolutions should contain auth pending resolution and evidence-bound pending resolution
    expect(state.coverage_resolutions).toHaveLength(2);
    const authRes = state.coverage_resolutions[0]!;
    const boundRes = state.coverage_resolutions[1]!;

    expect(authRes.status).toBe("pending");
    expect(authRes.source_refs).toBeUndefined();

    expect(boundRes.status).toBe("pending");
    expect(boundRes.supersedes).toBe(authRes.id);
    expect(boundRes.source_refs).toEqual([{ source_id: result.source_id, revision: result.source_revision }]);
  });

  it("rejects new supplement submissions lacking explicit choice and rationale", async () => {
    const { deps, assessment } = await setupRuntimeState();

    await expect(
      coverageSupplement(deps, "director", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.identity",
        character_id: "alpha",
        // Missing choice & rationale
        text: "Some supplement text without decision rationale.",
      }),
    ).rejects.toThrowError(/choice/);

    const state = await deps.repository.read();
    // No resolutions or sources committed on failure
    expect(state.coverage_user_decisions).toHaveLength(0);
    expect(state.coverage_resolutions).toHaveLength(0);
    expect(state.sources).toHaveLength(0);
  });

  it("allows retrying a failed supplement operation with the same operation_id and re-executes", async () => {
    const { deps, assessment, setShouldFailFetch } = await setupRuntimeState();
    setShouldFailFetch(true);

    const opId = "op-retry-test-1";

    // First attempt fails due to fetch error
    await expect(
      coverageSupplement(deps, "director", {
        operation_id: opId,
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.identity",
        character_id: "alpha",
        choice: "補充資料授權",
        rationale: "由使用者提供遠端 URL",
        url: "https://example.com/alpha-bio",
      }),
    ).rejects.toThrowError(/Simulated network failure/);

    let state = await deps.repository.read();
    expect(state.operations.find((o) => o.id === opId)?.status).toBe("failed");
    expect(state.sources).toHaveLength(0);

    // Second attempt (retry) with fixed fetcher using the EXACT same operation_id
    setShouldFailFetch(false);
    const retryResult = await coverageSupplement(deps, "director", {
      operation_id: opId,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_id: "req.identity",
      character_id: "alpha",
      choice: "補充資料授權",
      rationale: "由使用者提供遠端 URL",
      url: "https://example.com/alpha-bio",
    });

    expect(retryResult.status).toBe("completed");
    expect(retryResult.replayed).toBeUndefined(); // re-executed rather than returning stale failed result!
    expect(retryResult.source_id).toBeDefined();

    state = await deps.repository.read();
    expect(state.operations.find((o) => o.id === opId)?.status).toBe("completed");
    expect(state.sources).toHaveLength(1);
  });

  it("rejects retry with modified command parameters", async () => {
    const { deps, assessment, setShouldFailFetch } = await setupRuntimeState();
    setShouldFailFetch(true);

    const opId = "op-mismatch-test-1";

    await expect(
      coverageSupplement(deps, "director", {
        operation_id: opId,
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.identity",
        character_id: "alpha",
        choice: "補充資料授權",
        rationale: "測試",
        url: "https://example.com/fail",
      }),
    ).rejects.toThrowError(/Simulated network failure/);

    setShouldFailFetch(false);

    // Attempt retry with different requirement_id
    await expect(
      coverageSupplement(deps, "director", {
        operation_id: opId,
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.world_context",
        character_id: "alpha",
        choice: "補充資料授權",
        rationale: "測試",
        url: "https://example.com/fail",
      }),
    ).rejects.toThrowError(/was initiated for requirement/);
  });
});
