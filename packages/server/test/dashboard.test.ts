import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { dashboard } from "../src/dashboard.js";

describe("local Dashboard", () => {
  it("serves the main local workflow console and existing REST paths", async () => {
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(new MemoryProjectRepository("dashboard-test")),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    try {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("ST Workspace 本機工作台");
      expect(html).toContain("專案選擇");
      expect(html).toContain("目前專案 / 工作流狀態");
      expect(html).toContain("自然語言操作");
      expect(html).toContain("結構化訪談");
      expect(html).toContain("最近回應 / 診斷");
      for (const endpoint of [
        "/workspace/projects",
        "/workspace/project/select",
        "/workspace/status",
        "/workspace/agents",
        "/workspace/request",
        "/workspace/interview/context",
        "/workspace/interview/answer",
      ]) {
        expect(html).toContain(endpoint);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("uses DOM text APIs for untrusted API display values", () => {
    const html = dashboard();

    expect(html).toContain("textContent");
    expect(html).toContain("createElement");
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("insertAdjacentHTML");
    expect(html).toContain("canonical value");
  });

  it("includes the UX-03~12 panels and their REST endpoints", () => {
    const html = dashboard();
    for (const label of [
      "Blueprint 預檢矩陣",
      "Publish 就緒檢查",
      "Artifact 工作台",
      "品質門檻",
      "來源與事實",
      "打包選擇預覽",
      "Operation 管理",
      "專案修復",
      "Tavern 相容性",
      "逐項 issue 操作",
      "標記確認",
    ]) {
      expect(html).toContain(label);
    }
    for (const endpoint of [
      "/workspace/dashboard/data",
      "/workspace/publish/preview",
      "/workspace/tavern/compat",
      "/workspace/build/preview",
      "/workspace/quality/profile",
      "/workspace/operation/",
      "/workspace/repair/preview",
      "/workspace/repair/run",
    ]) {
      expect(html).toContain(endpoint);
    }
  });

  it("exposes the dashboard data, readiness, build, repair and quality endpoints", async () => {
    const server = createWorkspaceServer({
      runtime: new WorkspaceRuntime(new MemoryProjectRepository("dashboard-endpoints")),
      actor: "dashboard-test",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const data = await (await fetch(`${base}/workspace/dashboard/data`)).json();
      expect(data.project).toMatchObject({ project_id: "dashboard-endpoints" });
      expect(Array.isArray(data.artifacts)).toBe(true);
      expect(Array.isArray(data.operations)).toBe(true);
      expect(Array.isArray(data.reviews)).toBe(true);
      expect(Array.isArray(data.issues)).toBe(true);
      expect(data.repair).toMatchObject({ legacy_files: [], orphan_backups: [] });
      const readiness = await (await fetch(`${base}/workspace/publish/preview`)).json();
      expect(typeof readiness.ok).toBe("boolean");
      expect(Array.isArray(readiness.diagnostics)).toBe(true);
      const build = await (await fetch(`${base}/workspace/build/preview`)).json();
      expect(isRecordWith(build, "entries")).toBe(true);
      const tavern = await (await fetch(`${base}/workspace/tavern/compat`)).json();
      expect(tavern.available).toBe(false);
      const repair = await (await fetch(`${base}/workspace/repair/preview`)).json();
      expect(Array.isArray(repair.legacy_files)).toBe(true);
      const quality = await (await fetch(`${base}/workspace/quality/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: "strict" }),
      })).json();
      expect(quality.status).toBe("completed");
      const dataAfter = await (await fetch(`${base}/workspace/dashboard/data`)).json();
      expect(dataAfter.quality?.level).toBe("strict");
      const failed = await (await fetch(`${base}/workspace/operation/fail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation_id: "missing-operation" }),
      })).json();
      expect(failed.status).toBe("cancelled");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});

function isRecordWith(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && key in value;
}
