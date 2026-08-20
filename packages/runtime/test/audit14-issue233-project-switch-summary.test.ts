import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "../src/index.js";
import { userFacingProjectSwitchResult } from "../src/project-manager-user-facing.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
});

function manager(root: string): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

describe("Audit 14 issue #233 user-facing project switch summary", () => {
  it("removes only the targeted-switch revision annotation", () => {
    const base = {
      operation_id: "operation-1",
      status: "completed" as const,
      summary: "已切換至專案「Alice」（revision 7），訪談將於目標專案上繼續。原摘要",
      completed: [],
      blocked: [],
    };
    const sanitized = userFacingProjectSwitchResult(base);
    expect(sanitized.summary).toBe("已切換至專案「Alice」，訪談將於目標專案上繼續。原摘要");
    expect(sanitized.summary).not.toContain("revision");

    const technical = { ...base, summary: "diagnostic revision 7" };
    expect(userFacingProjectSwitchResult(technical)).toBe(technical);
  });

  it("keeps targeted continue flow user-facing while retaining technical revision data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-audit14-summary-"));
    roots.push(root);
    const targetRepository = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const initial = await targetRepository.read();
    await targetRepository.commit(initial.revision, (state) => ({
      ...state,
      project_name: "目標專案",
      project_slug: "project-001",
      project_status: "ready",
    }));

    const projects = manager(root);
    await projects.answerInterview("繼續專案", { actor: "user", attachments: [] });
    const result = await projects.answerInterview("目標專案", { actor: "user", attachments: [] });

    expect(result.status).toBe("completed");
    expect(result.project_id).toBe("project-001");
    expect(result.summary).toContain("已切換至專案「目標專案」");
    expect(result.summary).not.toContain("revision");

    const listed = await projects.listProjects();
    const technical = listed.find((project) => project.project_id === "project-001");
    expect(technical?.revision).toBeTypeOf("number");
    expect((technical?.revision ?? 0)).toBeGreaterThan(0);
  });
});
