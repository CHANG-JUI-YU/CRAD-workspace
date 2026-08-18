import { describe, expect, it, afterAll } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { request as httpRequest, type Server } from "node:http";
import { createWorkspaceServer } from "../src/index.js";

const servers: Array<Server> = [];
const LOOPBACK_TRUSTED_HOSTNAMES = ["127.0.0.1", "localhost", "::1"] as const;

async function startServer(): Promise<string> {
  const repository = new MemoryProjectRepository("batch2-csrf");
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({
    runtime,
    actor: "batch9-batch2-csrf",
    autoStartWorker: false,
    trustedHostnames: LOOPBACK_TRUSTED_HOSTNAMES,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function rawRequest(
  urlString: string,
  options: { method?: string; host: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  const target = new URL(urlString);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: options.method ?? "GET",
        headers: { host: options.host, ...options.headers },
      },
      (response) => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function responseCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
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

  it("rejects DNS-rebinding mutations even when Origin and Host match the attacker name", async () => {
    const url = await startServer();
    const port = Number(new URL(url).port);
    const attackerHost = `attacker.example:${port}`;
    const response = await rawRequest(`${url}/workspace/request`, {
      method: "POST",
      host: attackerHost,
      headers: {
        "content-type": "application/json",
        origin: `http://${attackerHost}`,
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(403);
    expect(responseCode(response.body)).toBe("CSRF_DENIED");
  });

  it("rejects untrusted Host values for read-only Dashboard requests", async () => {
    const url = await startServer();
    const port = Number(new URL(url).port);
    const response = await rawRequest(`${url}/`, { host: `attacker.example:${port}` });
    expect(response.status).toBe(403);
    expect(responseCode(response.body)).toBe("CSRF_DENIED");
  });

  it("accepts trusted loopback aliases on the actual listening port", async () => {
    const url = await startServer();
    const port = Number(new URL(url).port);
    const response = await rawRequest(`${url}/`, { host: `localhost:${port}` });
    expect(response.status).toBe(200);
  });

  it("rejects a trusted hostname carrying the wrong port", async () => {
    const url = await startServer();
    const port = Number(new URL(url).port);
    const response = await rawRequest(`${url}/`, { host: `127.0.0.1:${port + 1}` });
    expect(response.status).toBe(403);
    expect(responseCode(response.body)).toBe("CSRF_DENIED");
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
