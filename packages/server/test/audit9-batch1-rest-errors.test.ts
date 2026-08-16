import { afterAll, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import type { Server } from "node:http";

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected numeric address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function startServer(projectId: string, options: { authToken?: string } = {}) {
  const repository = new MemoryProjectRepository(projectId);
  const runtime = new WorkspaceRuntime(repository);
  const workspace = createWorkspaceServer({ runtime, actor: "batch1-test", autoStartWorker: false, ...options });
  return { runtime, repository, url: await listen(workspace) };
}

describe("unified REST error envelope", () => {
  it("rejects unauthenticated requests with a 401 envelope", async () => {
    const { url } = await startServer("batch1-auth", { authToken: "secret-token" });
    const response = await fetch(`${url}/workspace/status`);
    expect(response.status).toBe(401);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("UNAUTHORIZED");
    expect(typeof payload.message_zh).toBe("string");
    expect(payload.next_actions).toBeInstanceOf(Array);
    expect(payload).not.toHaveProperty("error");
    expect(JSON.stringify(payload)).not.toContain("stack");
  });

  it("accepts a bearer token", async () => {
    const { url } = await startServer("batch1-auth-ok", { authToken: "secret-token" });
    const response = await fetch(`${url}/workspace/status`, {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(response.status).toBe(200);
  });

  it("returns a uniform 404 envelope for an unknown dashboard artifact", async () => {
    const { url } = await startServer("batch1-404");
    const response = await fetch(`${url}/workspace/dashboard/artifacts/nonexistent-id`);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("DASHBOARD_ARTIFACT_NOT_FOUND");
    expect(payload.category).toBeDefined();
    expect(payload.recoverable).toBe(true);
    expect(payload.message_zh).toBeTruthy();
    expect(payload.impact).toBeTruthy();
    expect(payload.next_actions).toBeInstanceOf(Array);
    expect(payload).not.toHaveProperty("error");
    expect(payload).not.toHaveProperty("stack");
  });

  it("returns a uniform 404 envelope for an unknown route", async () => {
    const { url } = await startServer("batch1-404-route");
    const response = await fetch(`${url}/workspace/definitely-not-a-route`);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload).not.toHaveProperty("error");
  });

  it("returns a 400 envelope for a missing request body field", async () => {
    const { url } = await startServer("batch1-400");
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("REQUEST_REQUIRED");
    expect(payload.message_zh).toBeTruthy();
  });

  it("returns a 413 envelope for an oversized body", async () => {
    const { url } = await startServer("batch1-413");
    const huge = "x".repeat(11 * 1024 * 1024);
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: huge }),
    });
    expect(response.status).toBe(413);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("REQUEST_TOO_LARGE");
  });

  it("keeps the envelope stable across an interview answer validation error", async () => {
    const { url } = await startServer("batch1-interview");
    const response = await fetch(`${url}/workspace/interview/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "任何答案" }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe("INTERVIEW_CHOICE_INVALID");
    expect(payload).not.toHaveProperty("error");
  });
});
