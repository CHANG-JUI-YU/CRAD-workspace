import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { createTrustedContext } from "../src/context.js";
import { agentCanAccessTool } from "../src/authorization.js";
import { registeredToolNames } from "../src/tool-registry.js";
import { repositoryRoot } from "./helpers.js";

describe("MCP lifecycle", () => {
  it("fails fast for missing or unknown bound identity", async () => {
    await expect(createTrustedContext({ CARD_WORKSPACE_ROOT: repositoryRoot })).rejects.toMatchObject({ code: "MCP_AGENT_ID_REQUIRED" });
    await expect(createTrustedContext({ CARD_WORKSPACE_ROOT: repositoryRoot, CARD_WORKSPACE_AGENT_ID: "not-an-agent" })).rejects.toMatchObject({ code: "MCP_AGENT_UNKNOWN" });
  });

  it("initializes, lists, calls, and closes over stdio without protocol noise", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", `${repositoryRoot}/packages/mcp-server/src/index.ts`],
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        CARD_WORKSPACE_ROOT: repositoryRoot,
        CARD_WORKSPACE_AGENT_ID: "director",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    const context = await createTrustedContext({ CARD_WORKSPACE_ROOT: repositoryRoot, CARD_WORKSPACE_AGENT_ID: "director" });
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      registeredToolNames.filter((name) => agentCanAccessTool("director", name, context.config)),
    );
    expect(listed.tools.some((tool) => tool.name === "blueprint_submit_proposal")).toBe(true);
    expect(listed.tools.some((tool) => tool.name === "character_submit_proposal")).toBe(false);
    const called = await client.callTool({ name: "workflow_status", arguments: { project_id: "missing", agent_id: "zhuji-creator" } });
    expect(called.isError).toBe(true);
    expect(JSON.stringify(called)).not.toContain(repositoryRoot);
    await client.close();
  });
});
