import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startWorkspaceServer } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project manager HTTP and MCP boundary", () => {
  it("runs the high-level interview and exposes project selection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-server-manager-"));
    roots.push(root);
    const server = await startWorkspaceServer({ port: 0, projectRoot: root, actor: "user" });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (url: string, value: unknown) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
    try {
      expect((await (await fetch(`${base}/workspace/projects`)).json()).projects).toEqual([]);
      expect((await (await fetch(`${base}/workspace/interview/context`)).json()).status).toBe("idle");
      const started = await post("/workspace/request", { request: "建立新專案" });
      expect((await started.json() as { status: string; question: string }).status).toBe("needs_input");
      expect((await (await fetch(`${base}/workspace/zhuji/context`)).json()).context).toBeDefined();
      expect((await (await fetch(`${base}/workspace/template/context?kind=palette`)).json()).context).toBeDefined();
      expect((await post("/workspace/interview/answer", {})).status).toBe(400);
      expect((await post("/workspace/interview/answer", { answer: "   " })).status).toBe(400);

      const answers = [
        "角色設定",
        "單角色卡",
        "完全原創",
        "palette",
        "一個冷靜觀察、重視界線且具辨識度的角色概念",
        "在普通家庭成長，後來學會獨立生活與承擔責任",
        "說話直接但不刻薄，遇到衝突會先確認事實",
        "我直接命名",
        "HTTP 專案",
        "不需要",
        "外冷內熱、重視界線，對重要的人逐步建立信任",
        "自由創作",
        "沒有",
      ];
      let last: { status: string; project_name?: string } | undefined;
      for (const answer of answers) last = await (await post("/workspace/interview/answer", { answer })).json() as { status: string; project_name?: string };
      expect(last).toMatchObject({ status: "completed", project_name: "HTTP 專案" });
      const projects = (await (await fetch(`${base}/workspace/projects`)).json() as { projects: Array<{ project_name?: string }> }).projects;
      expect(projects.map((project) => project.project_name)).toContain("HTTP 專案");
      expect((await (await post("/workspace/project/select", { project: "HTTP 專案" })).json() as { project_name: string }).project_name).toBe("HTTP 專案");

      const list = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(JSON.stringify(await list.json())).toContain("workspace_interview_answer");
      const contextCall = await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace_interview_context", arguments: {} } });
      expect(JSON.stringify(await contextCall.json())).toContain("HTTP 專案");
      const projectsCall = await post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "workspace_projects", arguments: {} } });
      expect(JSON.stringify(await projectsCall.json())).toContain("HTTP 專案");
      const selectCall = await post("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "workspace_project_select", arguments: { project: "HTTP 專案" } } });
      expect(JSON.stringify(await selectCall.json())).toContain("HTTP 專案");
      const missingProject = await post("/workspace/project/select", {});
      expect(missingProject.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
