import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspaceServer } from "../src/index.js";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import { runFormalCoverageAssessment } from "@st-workspace/domain";

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

describe("Audit 7 Batch 3 - Server Re-upload & Operation Replayability (#88, #96)", () => {
  let server: ReturnType<typeof createWorkspaceServer>;
  let baseUrl: string;
  let runtime: WorkspaceRuntime;
  let repository: MemoryProjectRepository;

  beforeAll(async () => {
    const state = buildAssessmentState();
    repository = new MemoryProjectRepository(state.id, state);
    runtime = new WorkspaceRuntime(repository);
    server = createWorkspaceServer({
      runtime,
      actor: "director",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("#88 UX7-06 & #96 USER7-06: /workspace/operation/attachments/reupload and dashboard replayability projection", async () => {
    const state = await repository.read();
    const latestAss = state.coverage_assessments.at(-1)!;

    // 1. Create a running operation with missing attachment refs
    const opId = "op-server-reupload-test";
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
        attachment_refs: [{ id: "missing-att-1", name: "initial.txt", media_type: "text/plain" }],
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

    // 2. Replay operation -> turns into needs_input
    await runtime.recoverOperation(opId, { actor: "user-1", attachments: [] });

    // 3. Fetch dashboard operations via GET /workspace/dashboard/operations
    const dashRes = await fetch(`${baseUrl}/workspace/dashboard/operations`);
    expect(dashRes.status).toBe(200);
    const dashData = await dashRes.json() as { items: Array<{ id: string; replayability?: { state: string; attachment_count: number; attachments: Array<{ name: string; available: boolean }> } }> };
    const opView = dashData.items.find((o) => o.id === opId);
    expect(opView).toBeDefined();
    expect(opView?.replayability?.state).toBe("requires_reupload");
    expect(opView?.replayability?.attachment_count).toBe(1);
    expect(opView?.replayability?.attachments[0]?.available).toBe(false);

    // 4. POST /workspace/operation/attachments/reupload
    const b64 = Buffer.from("Replacement content for reupload test").toString("base64");
    const reuploadRes = await fetch(`${baseUrl}/workspace/operation/attachments/reupload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation_id: opId,
        replacements: [{
          original_ref_id: opView?.replayability?.attachments[0]?.id,
          name: "replacement.txt",
          content_base64: b64,
          media_type: "text/plain",
        }],
      }),
    });

    expect(reuploadRes.status).toBe(200);
    const reuploadBody = await reuploadRes.json() as { status: string; operation_id: string };
    expect(reuploadBody.status).toBe("completed");
    expect(reuploadBody.operation_id).toBe(opId);
  });
});
