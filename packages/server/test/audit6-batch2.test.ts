import { describe, expect, it } from "vitest";
import {
  contentHash,
  createProjectState,
  MemoryProjectRepository,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type ProjectState,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { runFormalCoverageAssessment } from "@st-workspace/domain";

import { createWorkspaceServer } from "../src/index.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";

const now = "2026-08-14T00:00:00.000Z";

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

describe("Audit 6 Batch 2 - Server Dashboard Guided Supplement & Routes", () => {
  it("#43, #54, #57, #60, #63: Dashboard JS includes openSupplementDialog modal flow", () => {
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("openSupplementDialog");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("supplement-modal-overlay");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("請至少提供補充文字、URL 或上傳附件其中一項。");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("/workspace/coverage/supplement");
  });

  it("#40: Route POST /workspace/coverage/supplement handles attachment-only request", async () => {
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

    const base = createProjectState("proj-1", "Test Project");
    const initialRepoState: ProjectState = {
      ...base,
      project_status: "interviewing",
      blueprint_prechecks: [pc],
      coverage_requirement_sets: [reqSet],
    };

    const assessment = runFormalCoverageAssessment(initialRepoState, reqSet, "op-formal-1", "actor");
    const repoState: ProjectState = {
      ...initialRepoState,
      coverage_assessments: [assessment],
    };
    const repository = new MemoryProjectRepository("proj-1", repoState);
    const runtime = new WorkspaceRuntime(repository);
    const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const serverUrl = `http://127.0.0.1:${address.port}`;

    const ass = assessment;

    try {
      // Confirm resolution first
      const confirmRes = await fetch(`${serverUrl}/workspace/coverage/resolution/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment_id: ass.id,
          assessment_revision: ass.revision,
          requirement_id: "req.identity",
          character_id: "alpha",
          action: "user_supplement",
          choice: "Rationale text",
          rationale: "Rationale text",
        }),
      });
      if (confirmRes.status !== 200) {
        console.error("confirmRes error:", confirmRes.status, await confirmRes.text());
      }
      expect(confirmRes.status).toBe(200);

      // Send supplement with attachment-only (base64 encoded UTF-8 text)
      const base64Content = Buffer.from("Alpha is a brave hero.", "utf-8").toString("base64");
      const suppRes = await fetch(`${serverUrl}/workspace/coverage/supplement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessment_id: ass.id,
          assessment_revision: ass.revision,
          requirement_id: "req.identity",
          character_id: "alpha",
          attachments: [
            { name: "evidence.txt", content_base64: base64Content, media_type: "text/plain" },
          ],
        }),
      });

      expect(suppRes.status).toBe(200);
      const payload = await suppRes.json();
      expect(payload.status).toBe("completed");
      expect(payload.source_id).toBeDefined();
      expect(payload.chunk_count).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err === undefined ? resolve() : reject(err)));
    }
  });
});
