import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { workflowStateSchema } from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpServer } from "../src/server.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("Forge MCP adapters", () => {
  it("returns the diagnostics library audit result as machine JSON", async () => {
    const fixture = await setupMcpWorkspace("forge-mcp");
    cleanups.push(fixture.workspace.cleanup);
    await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: 0, eventId: "compile-stage", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "compile_preview" }),
    });
    const { server } = await createMcpServer({ environment: fixture.environment });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientTransport);
    const response = await client.callTool({ name: "card_audit", arguments: {
      project_id: "forge-mcp", card: { spec: "not-a-card" }, strict: true,
    } });
    expect(response.isError).not.toBe(true);
    const payload = JSON.parse((response.content[0] as { text: string }).text) as { result: { blocked: boolean; findings: unknown[] } };
    expect(payload.result.blocked).toBe(true);
    expect(payload.result.findings.length).toBeGreaterThan(0);
    await client.close();
    await server.close();
  });
});
