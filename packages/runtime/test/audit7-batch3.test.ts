import { describe, expect, it } from "vitest";
import {
  contentHash,
  MemoryProjectRepository,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
  type SourceRecord,
  type ResearchTaskRecord,
  type SourceCandidate,
} from "@st-workspace/core";
import {
  KnowledgeService,
  runFormalCoverageAssessment,
} from "@st-workspace/domain";
import {
  coverageResearchStart,
  coverageResearchClaim,
  coverageResearchExhaust,
  coverageResearchRecover,
  coverageSupplement,
  type CoverageApplicationDeps,
  WorkspaceRuntime,
  InMemoryAgentAdapter,
  WorkspaceAgents,
  fetchAndValidateUrlContent,
  ingestUserSupplementEvidence,
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

describe("Audit 7 Batch 3 - Runtime Supplement, URL Ingestion & Re-upload (#71, #72, #79, #93, #96)", () => {
  it("#72 BUG7-04: manual_url fails when fetcher is unavailable or URL fetch fails, task remains exhausted", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const depsNoFetcher: CoverageApplicationDeps = { repository, knowledge };

    const latestAss = state.coverage_assessments.at(-1)!;
    const startResult = await coverageResearchStart(depsNoFetcher, "director", latestAss.id, latestAss.revision, {
      kind: "requirements",
      targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
    });
    const batchId = startResult.batch_id as string;
    const claimResult = await coverageResearchClaim(depsNoFetcher, "researcher-1", batchId);
    const claimedTask = claimResult.task as ResearchTaskRecord;

    await coverageResearchExhaust(depsNoFetcher, "researcher-1", claimedTask.id, claimedTask.claim_generation, claimedTask.lease_owner!, ["query 1"], ["wiki"], "No sources");

    // 1. Without fetcher -> fails with URL_FETCHER_UNAVAILABLE
    await expect(coverageResearchRecover(depsNoFetcher, "director", {
      task_id: claimedTask.id,
      action: "manual_url",
      url: "https://example.com/alpha-source",
    })).rejects.toThrowError(/URL fetcher is not configured/);

    // Task must remain exhausted
    const stateAfterFailed = await repository.read();
    const taskAfterFailed = stateAfterFailed.coverage_research_tasks.find((t) => t.id === claimedTask.id)!;
    expect(taskAfterFailed.status).toBe("exhausted");

    // 2. With failing fetcher -> fails with URL_FETCH_FAILED
    const failingFetcher = async () => { throw new Error("Connection timeout"); };
    const depsFailingFetcher: CoverageApplicationDeps = { repository, knowledge, fetcher: failingFetcher };

    await expect(coverageResearchRecover(depsFailingFetcher, "director", {
      task_id: claimedTask.id,
      action: "manual_url",
      url: "https://example.com/alpha-source",
    })).rejects.toThrowError(/Connection timeout/);

    // 3. With empty content fetcher -> fails with URL_CONTENT_EMPTY
    const emptyFetcher = async (url: string) => ({
      final_url: url,
      content: new Uint8Array([]),
    });
    const depsEmptyFetcher: CoverageApplicationDeps = { repository, knowledge, fetcher: emptyFetcher };

    await expect(coverageResearchRecover(depsEmptyFetcher, "director", {
      task_id: claimedTask.id,
      action: "manual_url",
      url: "https://example.com/alpha-source",
    })).rejects.toThrowError(/returned empty content/);
  });

  it("#72 BUG7-04 & #93 USER7-03: manual_url succeeds with valid text, structures projection and completes task", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const validFetcher = async (url: string) => ({
      final_url: `${url}/redirected`,
      content: new TextEncoder().encode("Official canonical background about Alpha from verified website."),
      media_type: "text/html",
      title: "Alpha Official Biography",
    });
    const deps: CoverageApplicationDeps = { repository, knowledge, fetcher: validFetcher };

    const latestAss = state.coverage_assessments.at(-1)!;
    const startResult = await coverageResearchStart(deps, "director", latestAss.id, latestAss.revision, {
      kind: "requirements",
      targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
    });
    const batchId = startResult.batch_id as string;
    const claimResult = await coverageResearchClaim(deps, "researcher-1", batchId);
    const claimedTask = claimResult.task as ResearchTaskRecord;

    await coverageResearchExhaust(deps, "researcher-1", claimedTask.id, claimedTask.claim_generation, claimedTask.lease_owner!, ["query 1"], ["wiki"], "No sources");

    const recoverResult = await coverageResearchRecover(deps, "director", {
      task_id: claimedTask.id,
      action: "manual_url",
      url: "https://example.com/alpha-source",
    });

    expect(recoverResult.status).toBe("completed");
    expect(recoverResult.source_id).toBeDefined();
    expect(recoverResult.chunk_count).toBeGreaterThan(0);

    const stateAfter = await repository.read();
    const taskAfter = stateAfter.coverage_research_tasks.find((t) => t.id === claimedTask.id)!;
    expect(taskAfter.status).toBe("completed");

    const source = stateAfter.sources.find((s) => s.id === recoverResult.source_id)!;
    expect(source.canonical_url).toBe("https://example.com/alpha-source");
    expect(source.final_url).toBe("https://example.com/alpha-source/redirected");
    expect(source.provenance_kind).toBe("external_source");
    expect(source.canonical_text).toBe("Official canonical background about Alpha from verified website.");

    // Lineage is created
    const lineage = stateAfter.coverage_research_lineages.find((l) => l.task_id === claimedTask.id)!;
    expect(lineage).toBeDefined();
    expect(lineage.source_id).toBe(source.id);
  });

  it("#79 BUG7-11: supplement in research recover binds decision, pending resolution and lineage", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const knowledge = new KnowledgeService(repository);
    const deps: CoverageApplicationDeps = { repository, knowledge };

    const latestAss = state.coverage_assessments.at(-1)!;
    const startResult = await coverageResearchStart(deps, "director", latestAss.id, latestAss.revision, {
      kind: "requirements",
      targets: [{ character_id: "alpha", requirement_id: "req.identity" }],
    });
    const batchId = startResult.batch_id as string;
    const claimResult = await coverageResearchClaim(deps, "researcher-1", batchId);
    const claimedTask = claimResult.task as ResearchTaskRecord;

    await coverageResearchExhaust(deps, "researcher-1", claimedTask.id, claimedTask.claim_generation, claimedTask.lease_owner!, ["query 1"], ["wiki"], "No sources");

    const recoverResult = await coverageResearchRecover(deps, "director", {
      task_id: claimedTask.id,
      action: "supplement",
      text: "Direct user supplement text for task recovery.",
      choice: "提供補充資料以完成 Alpha 設定",
      rationale: "由使用者直接提供權威設定細節",
    });

    expect(recoverResult.status).toBe("completed");
    expect(recoverResult.resolution_ids).toHaveLength(1);

    const stateAfter = await repository.read();
    const taskAfter = stateAfter.coverage_research_tasks.find((t) => t.id === claimedTask.id)!;
    expect(taskAfter.status).toBe("completed");

    const resolution = stateAfter.coverage_resolutions.find((r) => r.id === recoverResult.resolution_ids?.[0])!;
    expect(resolution).toBeDefined();
    expect(resolution.mode).toBe("user_supplement");
    expect(resolution.status).toBe("pending");

    const lineage = stateAfter.coverage_research_lineages.find((l) => l.task_id === claimedTask.id)!;
    expect(lineage).toBeDefined();
    expect(lineage.resolution_id).toBe(resolution.id);
  });

  it("#96 USER7-06 & #88 UX7-06: reuploadOperationAttachments recovers operation under the same operation id", async () => {
    const state = buildAssessmentState();
    const repository = new MemoryProjectRepository(state.id, state);
    const runtime = new WorkspaceRuntime(repository);

    const latestAss = state.coverage_assessments.at(-1)!;

    // Create an in-flight running operation with missing attachment refs
    const opId = "op-supplement-replay-test";
    const opRecord = {
      id: opId,
      kind: "knowledge" as const,
      request: "coverage_supplement",
      actor: "user-1",
      status: "running" as const,
      created_at: now,
      updated_at: now,
      progress: [],
      command: {
        version: 1 as const,
        type: "coverage_supplement" as const,
        payload: {
          assessment_id: latestAss.id,
          assessment_revision: latestAss.revision,
          requirement_id: "req.identity",
          character_id: "alpha",
        },
        attachment_refs: [{ id: "missing-att-1", name: "initial-doc.txt", media_type: "text/plain" }],
      },
      execution_snapshot: {
        execution_agent_id: "director",
        execution_agent_role: "orchestrator",
        initiated_by: "user-1",
        route_kind: "coverage",
        created_at: now,
      },
    };

    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [...current.operations, opRecord as any],
    }));

    // Replay the operation -> missing attachment causes needs_input
    const replayResult = await runtime.recoverOperation(opId, { actor: "user-1", attachments: [] });
    expect(replayResult.status).toBe("needs_input");
    expect(replayResult.question).toContain("ATTACHMENT_REUPLOAD_REQUIRED");

    // Check dashboard read model
    const dashboard = await runtime.dashboardOperations();
    const opView = dashboard.items.find((o) => o.id === opId)!;
    expect(opView).toBeDefined();
    expect(opView.replayability?.state).toBe("requires_reupload");
    expect(opView.replayability?.attachment_count).toBe(1);
    expect(opView.replayability?.attachments[0]?.available).toBe(false);

    // Now re-upload replacement attachment under the same operation
    const replacement = {
      original_ref_id: opView.replayability?.attachments[0]?.id,
      name: "replaced-doc.txt",
      content: new TextEncoder().encode("Replaced canonical evidence text"),
      media_type: "text/plain",
    };

    const reuploadResult = await runtime.reuploadOperationAttachments(opId, [replacement], { actor: "user-1", attachments: [] });
    expect(reuploadResult.status).toBe("completed");
    expect(reuploadResult.operation_id).toBe(opId);

    // Verify audit contains reupload event without raw bytes
    const finalState = await repository.read();
    const reuploadAudit = finalState.audit.find((a) => a.event === "operation.attachments.reuploaded")!;
    expect(reuploadAudit).toBeDefined();
    expect(reuploadAudit.details.replaced_count).toBe(1);
    expect(reuploadAudit.details).not.toHaveProperty("content");
    expect(reuploadAudit.details).not.toHaveProperty("content_base64");
  });
});
