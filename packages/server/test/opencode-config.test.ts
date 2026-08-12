import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenCode workspace integration contract", () => {
  it("mounts the local engine MCP and permits Director question UI", async () => {
    const config = JSON.parse(await readFile(resolve(process.cwd(), "opencode.jsonc"), "utf8")) as {
      agent?: { director?: { permission?: { question?: unknown } } };
      mcp?: Record<string, { type?: unknown; command?: unknown; url?: unknown; oauth?: unknown; enabled?: unknown }>;
    };
    expect(config.agent?.director?.permission?.question).toBe("allow");
    expect(config.mcp?.["st-workspace"]).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:8787/mcp",
      oauth: false,
      enabled: true,
    });
    expect(config.mcp?.["st-workspace"]?.command).toBeUndefined();
  });

  it("provides a relocatable Windows launcher command", async () => {
    const launcher = await readFile(resolve(process.cwd(), "ST-Workspace-Dashboard.cmd"), "utf8");
    expect(launcher).toContain("cd /d \"%~dp0\"");
    expect(launcher).toContain("node --import tsx/esm tools/dashboard-launcher.ts");
    expect(launcher).toContain("DASHBOARD_NODE_MISSING");
    expect(launcher).toContain("DASHBOARD_DEPENDENCY_MISSING");
  });
});
