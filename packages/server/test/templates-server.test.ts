import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

describe("template HTTP and MCP boundary", () => {
  it("serves context and accepts a high-level template proposal", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const contextResponse = await fetch(`${base}/workspace/template/context?kind=palette`);
      expect(contextResponse.status).toBe(200);
      expect(JSON.stringify(await contextResponse.json())).toContain("personality_palette");
      const authoringContext = await fetch(`${base}/workspace/authoring/context`);
      expect(authoringContext.status).toBe(200);
      expect(JSON.stringify(await authoringContext.json())).toContain("accepted_facts");
      const candidates = await fetch(`${base}/workspace/source/candidates`);
      expect(candidates.status).toBe(200);
      expect(JSON.stringify(await candidates.json())).toContain("candidates");
      const decisionResponse = await fetch(`${base}/workspace/adaptation/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "temperament", choice: "keep_blueprint", rationale: "Personal interpretation is intentional." }) });
      expect((await decisionResponse.json() as { status: string }).status).toBe("completed");
      const proposal = { kind: "palette", character_id: "demo", module: { schema_version: 1, mode: "palette", module: "basic_information", title: "Basic", content: "Calm." } };
      const submitResponse = await fetch(`${base}/workspace/template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proposal) });
      expect((await submitResponse.json() as { status: string }).status).toBe("completed");
      const mcpResponse = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "workspace_template_context", arguments: { kind: "review" } } }) });
      expect(JSON.stringify(await mcpResponse.json())).toContain("Review report");
      const mcpSubmit = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace_template_submit", arguments: proposal } }) });
      expect(JSON.stringify(await mcpSubmit.json())).toContain("completed");
      const invalidMcpContext = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "workspace_template_context", arguments: { kind: "unknown" } } }) });
      expect(JSON.stringify(await invalidMcpContext.json())).toContain("kind is required");
      const invalidContext = await fetch(`${base}/workspace/template/context`);
      expect(invalidContext.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
