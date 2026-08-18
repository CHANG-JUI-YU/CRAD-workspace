import { describe, expect, it, afterAll } from "vitest";
import { MemoryProjectRepository, contentHash, type ImageRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

const VALID_TOKEN = "secret-token-123";
const RESERVED_TOKEN = "tok+/=%&?";

const now = "2026-08-15T00:00:00.000Z";

async function startServer(token: string) {
  const repository = new MemoryProjectRepository("batch8-server");
  const pngBytes = Buffer.from("fake-png-bytes-for-cover");
  const image: ImageRecord = {
    id: "img-1",
    character_id: undefined,
    blob_hash: contentHash(pngBytes.toString()),
    media_type: "image/png",
    width: 512,
    height: 768,
    aspect_ratio: "2:3",
    source: "upload",
    license: "own",
    created_at: now,
    updated_at: now,
    created_by: "director",
  };
  await repository.commit(0, (state) => ({ ...state, images: [image] }), {
    blobs: [{ hash: image.blob_hash, content: pngBytes }],
  });
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", authToken: token, autoStartWorker: false });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("expected TCP address");
  }
  const url = `http://127.0.0.1:${address.port}`;
  return { server, url };
}

const servers: Awaited<ReturnType<typeof startServer>>[] = [];

async function withServer<T>(token: string, fn: (ctx: Awaited<ReturnType<typeof startServer>>) => Promise<T>): Promise<T> {
  const ctx = await startServer(token);
  servers.push(ctx);
  try {
    return await fn(ctx);
  } finally {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
  }
}

afterAll(async () => {
  for (const ctx of servers) {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
  }
});

describe("Audit 8 batch 1: #105 authenticated dashboard writes and image credentials", () => {
  it("serves the dashboard with a valid query token and rejects missing or invalid tokens", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const ok = await fetch(`${url}/?token=${VALID_TOKEN}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
      expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
      const csp = ok.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("connect-src 'self'");
      expect(csp).toContain("script-src 'unsafe-inline'");
      expect(csp).toContain("style-src 'unsafe-inline'");
      const html = await ok.text();
      expect(html).toContain("來源適配工作流程");
      expect(html).not.toContain(VALID_TOKEN);
      expect(html).toContain("window.history.replaceState(null, \"\", window.location.pathname + window.location.hash)");

      const missing = await fetch(`${url}/`);
      expect(missing.status).toBe(401);

      const invalid = await fetch(`${url}/?token=wrong-token`);
      expect(invalid.status).toBe(401);
    });
  });

  it("requires bearer credentials for protected GET endpoints and rejects query-token reuse", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const headerResponse = await fetch(`${url}/workspace/dashboard/data`, {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(headerResponse.status).toBe(200);
      expect(headerResponse.headers.get("cache-control")).toBe("no-store");
      expect(headerResponse.headers.get("referrer-policy")).toBe("no-referrer");
      expect(headerResponse.headers.get("x-content-type-options")).toBe("nosniff");
      expect(headerResponse.headers.get("content-security-policy")).toContain("default-src 'none'");

      const queryResponse = await fetch(`${url}/workspace/dashboard/data?token=${VALID_TOKEN}`);
      expect(queryResponse.status).toBe(401);

      const queryWithBearer = await fetch(`${url}/workspace/dashboard/data?token=${VALID_TOKEN}`, {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(queryWithBearer.status).toBe(401);
    });
  });

  it("performs authenticated writes with the bearer header", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const response = await fetch(`${url}/workspace/request`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${VALID_TOKEN}` },
        body: JSON.stringify({ request: "查看目前狀態" }),
      });
      expect(response.status).toBe(200);
    });
  });

  it("does not accept a query token for POST (server auth stays method-aware)", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const response = await fetch(`${url}/workspace/request?token=${VALID_TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: "查看目前狀態" }),
      });
      expect(response.status).toBe(401);
    });
  });

  it("round-trips tokens containing reserved characters exactly once via the header", async () => {
    await withServer(RESERVED_TOKEN, async ({ url }) => {
      const encoded = new URLSearchParams({ token: RESERVED_TOKEN }).toString();
      const initial = await fetch(`${url}/?${encoded}`);
      expect(initial.status).toBe(200);

      const data = await fetch(`${url}/workspace/dashboard/data`, {
        headers: { authorization: `Bearer ${RESERVED_TOKEN}` },
      });
      expect(data.status).toBe(200);

      const image = await fetch(`${url}/workspace/images/img-1`, {
        headers: { authorization: `Bearer ${RESERVED_TOKEN}` },
      });
      expect(image.status).toBe(200);
    });
  });

  it("serves protected images to authenticated clients with the right content type", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const response = await fetch(`${url}/workspace/images/img-1`, {
        headers: { authorization: `Bearer ${VALID_TOKEN}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.toString()).toBe("fake-png-bytes-for-cover");

      const anonymous = await fetch(`${url}/workspace/images/img-1`);
      expect(anonymous.status).toBe(401);
    });
  });

  it("keeps the dashboard html free of the token and preserves immediate URL sanitization", async () => {
    await withServer(VALID_TOKEN, async ({ url }) => {
      const response = await fetch(`${url}/?token=${VALID_TOKEN}`);
      const html = await response.text();
      expect(html).not.toContain(VALID_TOKEN);
      expect(html).not.toContain("tokenQuery()");
      expect(html).toContain("setProtectedImageSource");
      expect(html).toContain("window.history.replaceState");
      expect(html).toContain("window.location.pathname + window.location.hash");
    });
  });
});
