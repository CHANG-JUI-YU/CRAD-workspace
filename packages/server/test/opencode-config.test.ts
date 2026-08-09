import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenCode workspace integration contract", () => {
  it("mounts the local engine MCP and permits Director question UI", async () => {
    const config = JSON.parse(await readFile(resolve(process.cwd(), "opencode.jsonc"), "utf8")) as {
      agent?: { director?: { permission?: { question?: unknown } } };
      mcp?: Record<string, { type?: unknown; command?: unknown; enabled?: unknown }>;
    };
    expect(config.agent?.director?.permission?.question).toBe("allow");
    expect(config.mcp?.["st-workspace"]).toMatchObject({ type: "local", enabled: true });
    expect(config.mcp?.["st-workspace"]?.command).toEqual(["node", "--import", "tsx/esm", "tools/opencode-mcp.ts"]);
  });
});
