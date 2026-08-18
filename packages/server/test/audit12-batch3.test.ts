import { request as httpRequest, type IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer, type WorkspaceServer } from "../src/index.js";
import { MAX_BODY_BYTES } from "../src/http-utils.js";

function createServer(): WorkspaceServer {
  return createWorkspaceServer({
    runtime: new WorkspaceRuntime(new MemoryProjectRepository("audit12-body-limit")),
    autoStartWorker: false,
  });
}

async function listen(server: WorkspaceServer): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: WorkspaceServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function responseJson(response: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("Audit 12 BUG12-03 oversized request streaming", () => {
  it("rejects an oversized declared Content-Length before the client sends the body", async () => {
    const server = createServer();
    try {
      const base = await listen(server);
      const request = httpRequest(`${base}/workspace/request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_BODY_BYTES + 1),
        },
      });
      request.on("error", () => {});
      const responsePromise = new Promise<IncomingMessage>((resolve) => request.once("response", resolve));

      request.flushHeaders();
      const response = await within(responsePromise, 5_000);

      expect(request.writableEnded).toBe(false);
      expect(response.statusCode).toBe(413);
      expect(await responseJson(response)).toMatchObject({ code: "REQUEST_TOO_LARGE" });
      request.destroy();
    } finally {
      await close(server);
    }
  }, 10_000);

  it("rejects a chunked body as soon as bytes cross the limit without waiting for EOF", async () => {
    const server = createServer();
    try {
      const base = await listen(server);
      const request = httpRequest(`${base}/workspace/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      request.on("error", () => {});
      const responsePromise = new Promise<IncomingMessage>((resolve) => request.once("response", resolve));

      request.write(Buffer.alloc(MAX_BODY_BYTES, 0x61));
      request.write(Buffer.from("x"));
      const response = await within(responsePromise, 5_000);

      expect(request.writableEnded).toBe(false);
      expect(response.statusCode).toBe(413);
      expect(response.headers.connection).toBe("close");
      expect(await responseJson(response)).toMatchObject({ code: "REQUEST_TOO_LARGE" });
      request.destroy();
    } finally {
      await close(server);
    }
  }, 10_000);
});
