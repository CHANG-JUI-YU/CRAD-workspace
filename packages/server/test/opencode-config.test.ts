import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJsoncFile } from "../../../tools/structured-config.js";
import { parseOpenCodeDocument } from "../../../tools/agent-lint.js";
import { describe, expect, it } from "vitest";

describe("OpenCode workspace integration contract", () => {
  it("mounts the remote MCP and permits Director question UI", async () => {
    const config = parseOpenCodeDocument(await parseJsoncFile(resolve(process.cwd(), "opencode.jsonc")));
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
    expect(launcher).toContain("DASHBOARD_PNPM_MISSING");
    expect(launcher).toContain("DASHBOARD_DEPENDENCY_MISSING");
    expect(launcher).toContain("pnpm -r build");
    expect(launcher).toContain("DASHBOARD_BUILD_FAILED");
    expect(launcher.indexOf("pnpm -r build")).toBeLessThan(launcher.indexOf("node --import tsx/esm tools/dashboard-launcher.ts"));
  });

  it("keeps endpoint, startup command, ownership, and legacy documentation aligned", async () => {
    const root = resolve(process.cwd());
    const config = parseOpenCodeDocument(await parseJsoncFile(resolve(root, "opencode.jsonc")));
    const mcpUrl = config.mcp["st-workspace"]?.url;
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const integrationDocs = await readFile(resolve(root, "docs/opencode-integration.md"), "utf8");
    const legacyHelper = await readFile(resolve(root, "tools/opencode-mcp.ts"), "utf8");
    const rootPackage = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const serverPackage = JSON.parse(await readFile(resolve(root, "packages/server/package.json"), "utf8")) as { scripts?: Record<string, string> };

    expect(typeof mcpUrl).toBe("string");
    expect(readme).toContain("http://127.0.0.1:8787/");
    expect(readme).toContain("GET /workspace/health");
    expect(readme).toContain(mcpUrl!);
    expect(integrationDocs).toContain("http://127.0.0.1:8787/");
    expect(integrationDocs).toContain("http://127.0.0.1:8787/workspace/health");
    expect(integrationDocs).toContain(mcpUrl!);
    expect(integrationDocs).toContain("legacy/diagnostic");
    expect(legacyHelper).toMatch(/legacy\/diagnostic stdio bridge/i);
    expect(`${readme}\n${integrationDocs}`).not.toMatch(/OpenCode[^\n]*(?:啟動|建立).*tools\/opencode-mcp\.ts/iu);
    expect(rootPackage.scripts?.["audit:truncation"]).toBe("tsx tools/audit-truncation-scan.ts");
    expect(rootPackage.scripts?.["agent:lint"]).toBe("tsx tools/agent-lint.ts");
    expect(serverPackage.scripts?.start).toBe("node dist/index.js");
    expect(integrationDocs).toContain("pnpm --filter @st-workspace/server start");
    expect(integrationDocs).toContain("ST-Workspace-Dashboard.cmd");
  });
});
