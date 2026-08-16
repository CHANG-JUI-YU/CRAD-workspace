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
      expect(JSON.stringify(await invalidMcpContext.json())).toContain("TEMPLATE_KIND_REQUIRED");
      const invalidContext = await fetch(`${base}/workspace/template/context`);
      expect(invalidContext.status).toBe(400);
      const unknownAgent = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "status", agent: "missing-agent" }) });
      expect(unknownAgent.status).toBe(400);
      expect(await unknownAgent.json()).toMatchObject({ code: "AGENT_UNKNOWN" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("exposes audited issue actions at the HTTP boundary", async () => {
    const repository = new MemoryProjectRepository("issue-api");
    const runtime = new WorkspaceRuntime(repository);
    const proposal = { kind: "palette" as const, character_id: "demo", module: { schema_version: 1 as const, mode: "palette" as const, module: "basic_information" as const, title: "Basic", content: "Calm." } };
    await runtime.submitTemplateProposal(proposal, { actor: "opencode", attachments: [] });
    const target = (await repository.read()).artifacts[0]!;
    await runtime.submitTemplateProposal({ kind: "review", target: { kind: "palette", name: target.name, id: target.id }, findings: [{ id: "style", severity: "warning", summary: "Style can be more concrete.", evidence: [{ source: "test" }], overridable: true }], summary: "Review recorded." }, { actor: "opencode", attachments: [] });
    const issue = (await repository.read()).issues[0]!;
    const server = createWorkspaceServer({ runtime, actor: "opencode", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    try {
      const unauthorized = await fetch(`http://127.0.0.1:${address.port}/workspace/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: issue.id, action: "override", severity: "info", reason: "Creator cannot decide quality policy.", agent: "palette-creator" }) });
      expect(unauthorized.status).toBe(403);
      expect(await unauthorized.json()).toMatchObject({ code: "AGENT_CAPABILITY_DENIED" });
      const unknownAgent = await fetch(`http://127.0.0.1:${address.port}/workspace/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: issue.id, action: "override", severity: "info", reason: "Unknown agent must fail.", agent: "missing-agent" }) });
      expect(unknownAgent.status).toBe(400);
      expect(await unknownAgent.json()).toMatchObject({ code: "AGENT_UNKNOWN" });
      const response = await fetch(`http://127.0.0.1:${address.port}/workspace/issue`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue_id: issue.id, action: "ignore", reason: "Accepted for this release." }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "completed", completed: [issue.id] });
      const state = await repository.read();
      expect(state.issues[0]?.status).toBe("ignored");
      expect(state.audit.at(-1)).toMatchObject({ actor: "opencode", details: { agent_id: "director", operator: "director" } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
