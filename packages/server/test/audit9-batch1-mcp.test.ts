import { afterAll, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import type { Server } from "node:http";

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startServer(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  const runtime = new WorkspaceRuntime(repository);
  const workspace = createWorkspaceServer({ runtime, actor: "batch1-mcp", autoStartWorker: false });
  servers.push(workspace);
  await new Promise<void>((resolve) => workspace.listen(0, "127.0.0.1", () => resolve()));
  const address = workspace.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected numeric address");
  }
  return { runtime, repository, url: `http://127.0.0.1:${address.port}` };
}

async function sendJson(url: string, body: unknown) {
  return fetch(`${url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("JSON-RPC 2.0 request handling over /mcp", () => {
  it("does not respond to a valid notification", async () => {
    const { url } = await startServer("batch1-mcp-notification");
    const response = await sendJson(url, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("preserves a numeric id including 0", async () => {
    const { url } = await startServer("batch1-mcp-id0");
    const response = await sendJson(url, { jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
    expect(response.status).toBe(200);
    expect((await response.json() as { id: unknown }).id).toBe(0);
  });

  it("preserves an empty-string id", async () => {
    const { url } = await startServer("batch1-mcp-id-empty");
    const response = await sendJson(url, { jsonrpc: "2.0", id: "", method: "tools/list" });
    expect(response.status).toBe(200);
    expect((await response.json() as { id: unknown }).id).toBe("");
  });

  it("preserves a null id", async () => {
    const { url } = await startServer("batch1-mcp-id-null");
    const response = await sendJson(url, { jsonrpc: "2.0", id: null, method: "tools/list" });
    expect(response.status).toBe(200);
    expect((await response.json() as { id: unknown }).id).toBe(null);
  });

  it("preserves a string id", async () => {
    const { url } = await startServer("batch1-mcp-id-string");
    const response = await sendJson(url, { jsonrpc: "2.0", id: "req-42", method: "tools/list" });
    expect(response.status).toBe(200);
    expect((await response.json() as { id: unknown }).id).toBe("req-42");
  });

  it("answers initialize with capabilities and server info", async () => {
    const { url } = await startServer("batch1-mcp-init");
    const response = await sendJson(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const payload = await response.json() as { result: { protocolVersion: string; capabilities: unknown; serverInfo: unknown } };
    expect(payload.result.protocolVersion).toBe("2025-11-25");
    expect(payload.result.capabilities).toBeDefined();
    expect(payload.result.serverInfo).toBeDefined();
  });

  it("handles a batch of requests in order", async () => {
    const { url } = await startServer("batch1-mcp-batch");
    const response = await sendJson(url, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    expect(response.status).toBe(200);
    const payload = await response.json() as Array<{ id: number; result?: unknown; error?: { code: number } }>;
    expect(payload).toHaveLength(2);
    expect(payload[0].id).toBe(1);
    expect(payload[1].id).toBe(2);
  });

  it("rejects an empty batch as invalid request", async () => {
    const { url } = await startServer("batch1-mcp-empty-batch");
    const response = await sendJson(url, []);
    expect(response.status).toBe(200);
    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32600);
  });

  it("rejects a non-2.0 jsonrpc version", async () => {
    const { url } = await startServer("batch1-mcp-version");
    const response = await sendJson(url, { jsonrpc: "1.0", id: 1, method: "tools/list" });
    const payload = await response.json() as { error: { code: number } };
    expect(payload.error.code).toBe(-32600);
  });

  it("rejects tools/call with non-object params as invalid params", async () => {
    const { url } = await startServer("batch1-mcp-params");
    const response = await sendJson(url, { jsonrpc: "2.0", id: 1, method: "tools/call", params: "nope" });
    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32602);
    expect(payload.error.message).toBe("Invalid params");
  });

  it("rejects an unknown tool with method not found", async () => {
    const { url } = await startServer("batch1-mcp-unknown-tool");
    const response = await sendJson(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });
    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32601);
    expect(payload.error.message).toBe("tool not found");
  });

  it("rejects an unknown method with method not found", async () => {
    const { url } = await startServer("batch1-mcp-unknown-method");
    const response = await sendJson(url, { jsonrpc: "2.0", id: 1, method: "no/such/method" });
    const payload = await response.json() as { error: { code: number; message: string } };
    expect(payload.error.code).toBe(-32601);
    expect(payload.error.message).toBe("method not found");
  });

  it("returns parse error for a malformed body", async () => {
    const { url } = await startServer("batch1-mcp-parse");
    const response = await sendJson(url, "not-json{{");
    expect(response.status).toBe(200);
    const payload = await response.json() as { error: { code: number } };
    expect(payload.error.code).toBe(-32700);
  });

  it("maps a recoverable domain error to invalid params with its code in data", async () => {
    const { url } = await startServer("batch1-mcp-domain");
    const response = await sendJson(url, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "workspace_request", arguments: {} },
    });
    const payload = await response.json() as { id: number; error: { code: number; data?: { code?: string } } };
    expect(payload.id).toBe(7);
    expect(payload.error.code).toBe(-32602);
    expect(payload.error.data?.code).toBe("REQUEST_REQUIRED");
  });

  it("maps a project-manager domain error with its code in data while keeping the id", async () => {
    const { url } = await startServer("batch1-mcp-manager");
    const response = await sendJson(url, {
      jsonrpc: "2.0",
      id: "boom",
      method: "tools/call",
      params: { name: "workspace_project_select", arguments: {} },
    });
    const payload = await response.json() as { id: string; error: { code: number; data?: { code?: string } } };
    expect(payload.id).toBe("boom");
    expect(payload.error.code).toBe(-32602);
    expect(payload.error.data?.code).toBe("PROJECT_MANAGER_REQUIRED");
  });
});
