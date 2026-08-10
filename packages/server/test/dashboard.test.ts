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
});
