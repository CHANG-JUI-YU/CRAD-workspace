import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileProjectRepository, MemoryProjectRepository, type OperationRecord, type ZhujiProposalValue } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer, startWorkspaceServer, toolDefinitions } from "../src/index.js";

function zhujiProposal(): ZhujiProposalValue {
  const instant = "這是一段符合語料條件、包含自然標點的角色話語。";
  return {
    kind: "zhuji",
    character_id: "demo",
    module: {
      schema_version: 1,
      mode: "zhuji",
      module: "trait_dialogue",
      title: "特質對話",
      data: {
        人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
        人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
        扮演關鍵要點: ["先觀察再回答"],
        Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: [instant], Results: ["對話保持角色一致"] })),
      },
    },
  };
}

describe("runtime-facing server contract", () => {
  it("exposes only high-level request and status tools", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual(["workspace_request", "workspace_status", "workspace_agents", "workspace_zhuji_context", "workspace_zhuji_submit", "workspace_template_context", "workspace_template_submit", "workspace_issue_update", "workspace_authoring_context", "workspace_source_candidates", "workspace_source_select", "workspace_adaptation_decision", "workspace_interview_context", "workspace_interview_answer", "workspace_projects", "workspace_project_select"]);
    expect(toolDefinitions[0]?.inputSchema.properties).toMatchObject({ request: { type: "string" }, agent: { type: "string" } });
    expect(JSON.stringify(toolDefinitions)).not.toMatch(/project_id|revision|capability|stage|steps|file_path|bytes_base64/iu);
    expect(toolDefinitions.find((tool) => tool.name === "workspace_interview_context")?.description).toMatch(/exactly one current/iu);
    expect(toolDefinitions.find((tool) => tool.name === "workspace_interview_answer")?.description).toMatch(/one answer atomically.*batch answers/iu);
    const templateSubmit = toolDefinitions.find((tool) => tool.name === "workspace_template_submit");
    expect(JSON.stringify(templateSubmit)).toContain("official.html");
    expect(templateSubmit?.inputSchema).toMatchObject({ type: "object" });
  });

  it("serves the dashboard, REST request/status and MCP tool calls", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${base}/`)).status).toBe(200);
      expect((await fetch(`${base}/workspace/status`)).status).toBe(200);
      const health = await fetch(`${base}/workspace/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ service: "st-workspace-v3", status: "ready", worker: { running: true } });
      const agentsResponse = await fetch(`${base}/workspace/agents`);
      expect(JSON.stringify(await agentsResponse.json())).toContain("director");
      const zhujiContextResponse = await fetch(`${base}/workspace/zhuji/context?character_id=demo`);
      expect(JSON.stringify(await zhujiContextResponse.json())).toContain("trait_dialogue");
      const allZhujiContextResponse = await fetch(`${base}/workspace/zhuji/context`);
      expect(JSON.stringify(await allZhujiContextResponse.json())).toContain("self_introduction");
      const requestResponse = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "Draft note: Create character: Demo. Personality: calm and clear.", agent: "director" }) });
      expect((await requestResponse.json() as { status: string }).status).toBe("completed");
      const listResponse = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(JSON.stringify(await listResponse.json())).toContain("workspace_zhuji_submit");
      const agentsCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "workspace_agents", arguments: {} } }) });
      expect(JSON.stringify(await agentsCall.json())).toContain("director");
      const contextCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "workspace_zhuji_context" } }) });
      expect(JSON.stringify(await contextCall.json())).toContain("appearance");
      const filteredContextCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "workspace_zhuji_context", arguments: { character_id: "demo" } } }) });
      expect(JSON.stringify(await filteredContextCall.json())).toContain("trait_dialogue");
      const callResponse = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "workspace_status", arguments: {} } }) });
      expect((await callResponse.json() as { result?: unknown }).result).toBeDefined();
      expect((await fetch(`${base}/missing`)).status).toBe(404);
      expect((await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status).toBe(400);
      expect((await fetch(`${base}/workspace/request`, { method: "POST" })).status).toBe(400);
      const attachmentResponse = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "Import character card", attachments: [null, {}, { name: 3, content_base64: "" }, { name: "invalid", content_base64: 3, media_type: 3 }, { name: "card.json", content_base64: Buffer.from(JSON.stringify({ name: "Attached", description: "A complete attached card" })).toString("base64"), media_type: "application/json" }] }) });
      expect((await attachmentResponse.json() as { status: string }).status).toBe("completed");
      const initialize = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } }) });
      expect(await initialize.json()).toMatchObject({ result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "st-workspace-v3" } } });
      const modernInitialize = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "initialize", params: { protocolVersion: "2025-11-25" } }) });
      expect(await modernInitialize.json()).toMatchObject({ result: { protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "st-workspace-v3" } } });
      const requestCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "workspace_request", arguments: { request: "Draft note: Create greeting: Hello. This is enough content." } } }) });
      expect(JSON.stringify(await requestCall.json())).toContain("completed");
      const zhujiRest = await fetch(`${base}/workspace/zhuji`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(zhujiProposal()) });
      expect((await zhujiRest.json() as { status: string }).status).toBe("completed");
      const zhujiCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "workspace_zhuji_submit", arguments: zhujiProposal() } }) });
      expect(JSON.stringify(await zhujiCall.json())).toContain("completed");
      const invalidZhuji = await fetch(`${base}/workspace/zhuji`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "zhuji" }) });
      expect(invalidZhuji.status).toBe(400);
      const invalidCall = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "workspace_request", arguments: {} } }) });
      const invalidCallBody = JSON.stringify(await invalidCall.json());
      expect(invalidCallBody).toContain("-32602");
      expect(invalidCallBody).toContain("REQUEST_REQUIRED");
      const unknownTool = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "not-a-tool", arguments: {} } }) });
      expect(JSON.stringify(await unknownTool.json())).toContain("tool not found");
      const unknownMethod = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "nope" }) });
      expect(JSON.stringify(await unknownMethod.json())).toContain("method not found");
      const badJson = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" });
      expect(badJson.status).toBe(200);
      expect(JSON.stringify(await badJson.json())).toContain("-32700");
      const invalidUtf8 = Buffer.from([0x7b, 0x22, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
      const invalidEncoding = await fetch(`${base}/workspace/interview/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: invalidUtf8 });
      expect(invalidEncoding.status).toBe(400);
      expect(await invalidEncoding.json()).toMatchObject({ code: "REQUEST_INVALID_UTF8" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("can start the file-backed server through the same entry point", async () => {
    const server = await startWorkspaceServer({ port: 0, projectRoot: os.tmpdir(), projectId: `server-${Date.now()}` });
    expect(server.listening).toBe(true);
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  });

  it("rejects instead of hanging when the requested port is already occupied", async () => {
    const occupied = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("occupied")), actor: "test", autoStartWorker: false });
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    try {
      await expect(startWorkspaceServer({ port: address.port, projectRoot: os.tmpdir(), projectId: `blocked-${Date.now()}` })).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>((resolve, reject) => occupied.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("accepts defaults from environment when no server options are supplied", async () => {
    const oldPort = process.env.ST_WORKSPACE_PORT;
    const oldRoot = process.env.ST_WORKSPACE_PROJECT_ROOT;
    const oldProject = process.env.ST_WORKSPACE_PROJECT;
    process.env.ST_WORKSPACE_PORT = "0";
    process.env.ST_WORKSPACE_PROJECT_ROOT = os.tmpdir();
    process.env.ST_WORKSPACE_PROJECT = `server-default-${Date.now()}`;
    try {
      const server = await startWorkspaceServer();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    } finally {
      if (oldPort === undefined) delete process.env.ST_WORKSPACE_PORT; else process.env.ST_WORKSPACE_PORT = oldPort;
      if (oldRoot === undefined) delete process.env.ST_WORKSPACE_PROJECT_ROOT; else process.env.ST_WORKSPACE_PROJECT_ROOT = oldRoot;
      if (oldProject === undefined) delete process.env.ST_WORKSPACE_PROJECT; else process.env.ST_WORKSPACE_PROJECT = oldProject;
    }
  });

  it("keeps the manager-backed server responsive while a worker is paused or resumed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-server-manager-"));
    const manager = new WorkspaceProjectManager({ root, createRuntime: (repository) => new WorkspaceRuntime(repository) });
    await manager.ensureRuntime();
    const server = createWorkspaceServer({ projectManager: manager, actor: "manager", autoStartWorker: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect(await (await fetch(`${base}/workspace/health`)).json()).toMatchObject({ status: "ready", worker: { running: false } });
      expect((await fetch(`${base}/workspace/interview/context`)).status).toBe(200);
      expect((await fetch(`${base}/workspace/projects`)).status).toBe(200);
      expect((await fetch(`${base}/workspace/template/context`)).status).toBe(400);
      expect((await fetch(`${base}/workspace/template/context?kind=character`)).status).toBe(200);
      expect((await fetch(`${base}/workspace/project/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status).toBe(400);
      expect((await fetch(`${base}/workspace/project/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "project-001" }) })).status).toBe(200);
      expect((await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "status" }) })).status).toBe(200);
      expect((await fetch(`${base}/workspace/interview/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status).toBe(400);
      expect((await fetch(`${base}/workspace/interview/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: "角色設定" }) })).status).toBe(200);
      const rpc = async (id: number, name: string, args?: unknown) => fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } }) });
      expect(JSON.stringify(await (await rpc(20, "workspace_projects")).json())).toContain("project-001");
      expect(JSON.stringify(await (await rpc(21, "workspace_interview_context")).json())).toContain("project-001");
      expect(JSON.stringify(await (await rpc(22, "workspace_interview_answer")).json())).toContain("ANSWER_REQUIRED");
      expect(JSON.stringify(await (await rpc(23, "workspace_project_select")).json())).toContain("PROJECT_REQUIRED");
      expect(JSON.stringify(await (await rpc(24, "workspace_project_select", { project: "project-001" })).json())).toContain("project-001");
      expect(JSON.stringify(await (await rpc(25, "workspace_status")).json())).toContain("project-001");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes a persisted operation when the server starts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-server-recovery-"));
    const repository = new FileProjectRepository(root, "recover", { layout: "project", materialize: true });
    const timestamp = new Date().toISOString();
    const operation: OperationRecord = { id: "op-restart", kind: "authoring", request: "Draft note: Create character: Restarted. Personality: calm and clear.", actor: "before-restart", status: "running", created_at: timestamp, updated_at: timestamp, progress: [], execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "before-restart", route_kind: "authoring", created_at: timestamp } };
    await repository.commit(0, (state) => ({ ...state, operations: [operation] }));
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(repository), workerOptions: { pollIntervalMs: 10, retryDelayMs: 1 } });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const started = Date.now();
      while (Date.now() - started < 5_000 && (await repository.read()).operations[0]?.status !== "completed") await new Promise((resolve) => setTimeout(resolve, 25));
      expect((await repository.read()).operations[0]?.status).toBe("completed");
      expect((await repository.read()).artifacts[0]?.name).toBe("Restarted");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON and oversized bodies as client errors", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const malformed = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not-json" });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ code: "REQUEST_INVALID_JSON" });
      const oversized = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "x".repeat(11 * 1024 * 1024) }) });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("ignores attachments whose base64 payload is not strict base64", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "status", attachments: [{ name: "bad", content_base64: "not-base64!" }, { name: "empty", content_base64: "" }] }) });
      expect(response.status).toBe(200);
      expect((await response.json() as { status: string }).status).toBe("completed");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("requires the bearer token when authentication is enabled", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test", authToken: "secret-token" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const denied = await fetch(`${base}/workspace/status`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: "UNAUTHORIZED", recoverable: true });
      const wrong = await fetch(`${base}/workspace/status`, { headers: { authorization: "Bearer wrong" } });
      expect(wrong.status).toBe(401);
      const accepted = await fetch(`${base}/workspace/status`, { headers: { authorization: "Bearer secret-token" } });
      expect(accepted.status).toBe(200);
      const mcpAccepted = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret-token" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "workspace_status", arguments: {} } }) });
      expect(mcpAccepted.status).toBe(200);
      const queryAccepted = await fetch(`${base}/?token=secret-token`);
      expect(queryAccepted.status).toBe(200);
      const queryDenied = await fetch(`${base}/`);
      expect(queryDenied.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("returns a structured error payload for recoverable input errors", async () => {
    const server = createWorkspaceServer({ runtime: new WorkspaceRuntime(new MemoryProjectRepository("demo")), actor: "test" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/workspace/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "   " }) });
      expect(response.status).toBe(400);
      const payload = await response.json() as { code: string; recoverable: boolean; message_zh: string; impact: string; next_actions: string[] };
      expect(payload.code).toBe("REQUEST_REQUIRED");
      expect(payload.recoverable).toBe(true);
      expect(typeof payload.message_zh).toBe("string");
      expect(typeof payload.impact).toBe("string");
      expect(Array.isArray(payload.next_actions)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("refuses to expose an external host without an auth token", async () => {
    await expect(startWorkspaceServer({ port: 0, host: "0.0.0.0", projectRoot: os.tmpdir(), projectId: `server-ext-${Date.now()}` }))
      .rejects.toMatchObject({ code: "EXTERNAL_HOST_AUTH_REQUIRED" });
    const server = await startWorkspaceServer({ port: 0, host: "0.0.0.0", projectRoot: os.tmpdir(), projectId: `server-ext-auth-${Date.now()}`, authToken: "external-secret" });
    expect(server.listening).toBe(true);
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  });
});
