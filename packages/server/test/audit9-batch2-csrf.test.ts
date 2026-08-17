import { describe, expect, it, afterAll } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import type { Server } from "node:http";
import { createWorkspaceServer } from "../src/index.js";

const servers: Array<Server> = [];

async function startServer(): Promise<string> {
  const repository = new MemoryProjectRepository("batch2-csrf");
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "batch9-batch2-csrf", autoStartWorker: false });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("audit9-batch2 CSRF protection (#129)", () => {
  it("rejects cross-origin mutations with CSRF_DENIED", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ request: "hello" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("CSRF_DENIED");
  });

  it("rejects mutations flagged cross-site by Sec-Fetch-Site", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ request: "hello" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("CSRF_DENIED");
  });

  it("allows mutations with no CSRF signal (non-browser clients)", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("REQUEST_REQUIRED");
  });

  it("allows same-origin mutations", async () => {
    const url = await startServer();
    const origin = url;
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("REQUEST_REQUIRED");
  });

  it("allows mutations carrying the X-Requested-With header even with an origin present", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).not.toBe(403);
  });

  it("allows mutations carrying a non-empty X-Workspace-CSRF header", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/request`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
        "X-Workspace-CSRF": "csrf-token",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).not.toBe(403);
  });

  it("applies the CSRF policy to every mutation endpoint (repair/run)", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/repair/run`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("CSRF_DENIED");
  });

  it("requires X-Workspace-Confirm for high-impact repair/run", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/repair/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("CSRF_CONFIRMATION_REQUIRED");
  });

  it("accepts high-impact repair/run with the confirmation header", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/repair/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Workspace-Confirm": "repair" },
      body: JSON.stringify({}),
    });
    expect(response.status).not.toBe(403);
  });

  it("requires X-Workspace-Confirm for high-impact publish confirmation", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/publish/provenance/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: "fp" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("CSRF_CONFIRMATION_REQUIRED");
  });

  it("accepts high-impact publish confirmation with the confirmation header", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/workspace/publish/provenance/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Workspace-Confirm": "publish" },
      body: JSON.stringify({}),
    });
    expect(response.status).not.toBe(403);
  });

  it("does not reject read-only GET routes", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/`, { headers: { origin: "http://evil.example" } });
    expect(response.status).toBe(200);
  });
});