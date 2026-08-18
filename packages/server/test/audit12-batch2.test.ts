import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer, type WorkspaceServer } from "../src/index.js";

function createRuntime(): WorkspaceRuntime {
  return new WorkspaceRuntime(new MemoryProjectRepository("audit12-auth-factory"));
}

function expectFactoryTokenRejected(token: string): void {
  let error: unknown;
  try {
    createWorkspaceServer({
      runtime: createRuntime(),
      authToken: token,
      autoStartWorker: false,
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code: "AUTH_TOKEN_BLANK" });
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

describe("Audit 12 BUG12-04 server factory auth token policy", () => {
  it("preserves intentional no-token semantics when authToken is undefined", async () => {
    const server = createWorkspaceServer({
      runtime: createRuntime(),
      authToken: undefined,
      autoStartWorker: false,
    });
    try {
      const base = await listen(server);
      const response = await fetch(`${base}/`);
      expect(response.status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it("rejects explicitly blank and whitespace-only tokens at construction", () => {
    expectFactoryTokenRejected("");
    expectFactoryTokenRejected(" \t\n ");
  });

  it("normalizes a configured token once and rejects blank bootstrap tokens", async () => {
    const server = createWorkspaceServer({
      runtime: createRuntime(),
      authToken: "  secret-token  ",
      autoStartWorker: false,
    });
    try {
      const base = await listen(server);

      expect((await fetch(`${base}/`)).status).toBe(401);
      expect((await fetch(`${base}/?token=`)).status).toBe(401);
      expect((await fetch(`${base}/?token=${encodeURIComponent("  secret-token  ")}`)).status).toBe(401);
      expect((await fetch(`${base}/?token=secret-token`)).status).toBe(200);

      expect((await fetch(`${base}/`, {
        headers: { authorization: "Bearer secret-token" },
      })).status).toBe(200);
    } finally {
      await close(server);
    }
  });

  it("keeps exact matching for a valid nonblank factory token", async () => {
    const server = createWorkspaceServer({
      runtime: createRuntime(),
      authToken: "factory-secret",
      autoStartWorker: false,
    });
    try {
      const base = await listen(server);

      expect((await fetch(`${base}/`, {
        headers: { authorization: "Bearer factory-secret" },
      })).status).toBe(200);
      expect((await fetch(`${base}/`, {
        headers: { authorization: "Bearer factory-secret-x" },
      })).status).toBe(401);
      expect((await fetch(`${base}/?token=factory-secret`)).status).toBe(200);
      expect((await fetch(`${base}/?token=factory-secret-x`)).status).toBe(401);
    } finally {
      await close(server);
    }
  });
});
