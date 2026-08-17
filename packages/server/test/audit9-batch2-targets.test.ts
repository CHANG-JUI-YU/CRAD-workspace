import { describe, expect, it, afterAll } from "vitest";
import net from "node:net";
import { createWorkspaceServer } from "../src/index.js";
import { parseRequestTarget } from "../src/http-security.js";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { MemoryProjectRepository } from "@st-workspace/core";

const servers: Array<{ close: () => Promise<void> }> = [];

async function startServer(): Promise<string> {
  const repository = new MemoryProjectRepository("batch2-targets");
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "batch2-targets", autoStartWorker: false });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

function rawRequest(port: number, payload: Buffer | string): Promise<{ statusLine: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(payload);
    });
    let received = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.includes(Buffer.from("\r\n\r\n"))) {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      const text = received.toString("utf8");
      const headerEnd = text.indexOf("\r\n\r\n");
      resolve({
        statusLine: text.slice(0, text.indexOf("\r\n")),
        body: headerEnd >= 0 ? text.slice(headerEnd + 4) : "",
      });
    });
    socket.on("error", reject);
    setTimeout(() => socket.destroy(), 5000);
  });
}

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

describe("#127 malformed request target", () => {
  it("parseRequestTarget parses valid targets and returns null for malformed ones", () => {
    const parsed = parseRequestTarget("/workspace/status", "http://localhost");
    expect(parsed).not.toBeNull();
    expect(parsed?.pathname).toBe("/workspace/status");

    const root = parseRequestTarget(undefined, "http://localhost");
    expect(root).not.toBeNull();
    expect(root?.pathname).toBe("/");

    expect(parseRequestTarget("http://[::1", "http://localhost")).toBeNull();
    expect(parseRequestTarget("http://exa mple", "http://localhost")).toBeNull();
  });

  it("rejects a malformed absolute-form target with a stable 400 and keeps the server healthy", async () => {
    const url = await startServer();
    const port = Number(new URL(url).port);

    const response = await rawRequest(port, "GET http://[::1 HTTP/1.1\r\nHost: localhost\r\n\r\n");
    expect(response.statusLine).toContain("400");
    expect(response.body).toContain("REQUEST_TARGET_INVALID");

    const healthy = await fetch(`${url}/`);
    expect(healthy.status).toBe(200);
  });

  it("handles an invalid UTF-8 body on /mcp through the saved URL without re-parsing", async () => {
    const url = await startServer();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.from([0xff, 0xfe, 0xfd]),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.jsonrpc).toBe("2.0");
    expect(payload.error.code).toBe(-32700);
  });
});