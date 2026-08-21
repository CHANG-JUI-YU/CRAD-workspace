import { readFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CoreError } from "@st-workspace/core";
import type { WorkspaceRuntime, WorkspaceWorker } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { applyBrowserSecurityHeaders, restError } from "../src/http-utils.js";
import { handleRestRequest, type WorkspaceRouteDeps } from "../src/routes.js";

const servers: Server[] = [];
const CONTRACT_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "cache-control",
  "referrer-policy",
  "x-content-type-options",
  "content-security-policy",
] as const;

const outputs = {
  json: {
    media_type: "application/json",
    filename: "雪乃-card.json",
    content: new TextEncoder().encode('{"name":"雪乃"}'),
  },
  png: {
    media_type: "image/png",
    filename: "雪乃-card.png",
    content: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
  },
} as const;

function runtimeStub(): WorkspaceRuntime {
  return {
    publishDownload: vi.fn(async (publishId: string, kind: "json" | "png") => {
      if (publishId === "missing-publish") {
        throw new CoreError("PUBLISH_NOT_FOUND", "Publish not found", true);
      }
      if (publishId === "missing-blob") {
        throw new CoreError("PUBLISH_DOWNLOAD_MISSING", "Publish blob missing", true);
      }
      return outputs[kind];
    }),
  } as unknown as WorkspaceRuntime;
}

function workerStub(): WorkspaceWorker {
  return {
    status: () => ({ running: false }),
    stop: async () => undefined,
  } as unknown as WorkspaceWorker;
}

function deps(runtime: WorkspaceRuntime): WorkspaceRouteDeps {
  return {
    actor: "audit14-223",
    runtime,
    worker: workerStub(),
    runtimeRevision: "audit14-223",
    getRuntime: async () => runtime,
    getAgentAdapter: async () => { throw new Error("agent adapter not expected"); },
  };
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function startDirectRouter(runtime: WorkspaceRuntime): Promise<string> {
  const routeDeps = deps(runtime);
  return listen(createServer(async (request, response) => {
    applyBrowserSecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (!await handleRestRequest(request, response, url, routeDeps)) {
        restError(response, new CoreError("NOT_FOUND", "Not found", false));
      }
    } catch (error) {
      restError(response, error);
    }
  }));
}

async function startFullServer(runtime: WorkspaceRuntime, authToken?: string): Promise<string> {
  return listen(createWorkspaceServer({
    runtime,
    worker: workerStub(),
    autoStartWorker: false,
    trustedHostnames: ["127.0.0.1", "localhost", "::1"],
    ...(authToken === undefined ? {} : { authToken }),
  }));
}

async function responseSnapshot(response: Response): Promise<{
  status: number;
  headers: Record<string, string | null>;
  body: Uint8Array;
}> {
  return {
    status: response.status,
    headers: Object.fromEntries(CONTRACT_HEADERS.map((name) => [name, response.headers.get(name)])),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

async function rawRequest(
  urlString: string,
  options: { method?: string; host: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  const target = new URL(urlString);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: options.method ?? "GET",
      headers: { host: options.host, ...options.headers },
    }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Audit 14 #223 canonical publish-download HTTP contract", () => {
  it.each(["json", "png"] as const)("keeps direct router and full server %s downloads byte-for-byte identical", async (kind) => {
    const runtime = runtimeStub();
    const direct = await startDirectRouter(runtime);
    const full = await startFullServer(runtime);
    const path = `/workspace/publish/download?publish_id=publish-1&kind=${kind}`;

    const [directResponse, fullResponse] = await Promise.all([fetch(`${direct}${path}`), fetch(`${full}${path}`)]);
    const directSnapshot = await responseSnapshot(directResponse);
    const fullSnapshot = await responseSnapshot(fullResponse);

    expect(directSnapshot).toEqual(fullSnapshot);
    expect(directSnapshot.status).toBe(200);
    expect(directSnapshot.headers["content-type"]).toBe(outputs[kind].media_type);
    expect(directSnapshot.headers["content-disposition"]).toContain("attachment;");
    expect(Number(directSnapshot.headers["content-length"])).toBe(outputs[kind].content.byteLength);
    expect(directSnapshot.headers["cache-control"]).toBe("no-store");
    expect(directSnapshot.body).toEqual(outputs[kind].content);
  });

  it.each([
    ["missing publish id", "/workspace/publish/download?kind=json", "PUBLISH_ID_REQUIRED", 400],
    ["invalid kind", "/workspace/publish/download?publish_id=publish-1&kind=bogus", "PUBLISH_DOWNLOAD_KIND_INVALID", 400],
    ["runtime not found", "/workspace/publish/download?publish_id=missing-publish&kind=json", "PUBLISH_NOT_FOUND", 404],
    ["runtime missing blob", "/workspace/publish/download?publish_id=missing-blob&kind=json", "PUBLISH_DOWNLOAD_MISSING", 400],
  ] as const)("keeps %s errors identical across both entry points", async (_label, path, code, status) => {
    const runtime = runtimeStub();
    const direct = await startDirectRouter(runtime);
    const full = await startFullServer(runtime);
    const [directResponse, fullResponse] = await Promise.all([fetch(`${direct}${path}`), fetch(`${full}${path}`)]);
    const directBody = await directResponse.json() as Record<string, unknown>;
    const fullBody = await fullResponse.json() as Record<string, unknown>;

    expect(directResponse.status).toBe(status);
    expect(fullResponse.status).toBe(status);
    expect(directBody).toEqual(fullBody);
    expect(directBody.code).toBe(code);
  });

  it("keeps authentication, Host/Origin checks and browser security headers ahead of downloads", async () => {
    const runtime = runtimeStub();
    const full = await startFullServer(runtime, "secret-token");
    const path = "/workspace/publish/download?publish_id=publish-1&kind=json";

    const unauthorized = await fetch(`${full}${path}`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("no-store");
    expect(unauthorized.headers.get("content-security-policy")).toContain("default-src 'none'");

    const authenticated = await fetch(`${full}${path}`, {
      headers: { authorization: "Bearer secret-token" },
    });
    expect(authenticated.status).toBe(200);
    expect(authenticated.headers.get("cache-control")).toBe("no-store");
    expect(authenticated.headers.get("x-content-type-options")).toBe("nosniff");

    const port = Number(new URL(full).port);
    const hostileHost = await rawRequest(`${full}${path}`, {
      host: `attacker.example:${port}`,
      headers: { authorization: "Bearer secret-token" },
    });
    expect(hostileHost.status).toBe(403);
    expect(JSON.parse(hostileHost.body)).toMatchObject({ code: "CSRF_DENIED" });

    const hostileOrigin = await fetch(`${full}${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        origin: "http://attacker.example",
      },
    });
    expect(hostileOrigin.status).toBe(403);
    expect(await hostileOrigin.json()).toMatchObject({ code: "CSRF_DENIED" });
  });

  it("keeps routes.ts as a delegate and forbids a second base64 download contract", async () => {
    const source = await readFile("packages/server/src/routes.ts", "utf8");
    const start = source.indexOf('url.pathname === "/workspace/publish/download"');
    const end = source.indexOf('url.pathname === "/workspace/tavern/compat"', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end);
    expect(branch).toContain("handlePublishDownloadRequest");
    expect(branch).not.toContain("toString(\"base64\")");
    expect(branch).not.toContain("content:");
  });
});
