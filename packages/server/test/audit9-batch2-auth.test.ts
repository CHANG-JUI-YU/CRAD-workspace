import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorkspaceServer } from "../src/index.js";
import { timingSafeTextEqual } from "../src/http-security.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "batch2-auth-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("#128 dashboard authentication", () => {
  it("refuses to start with a blank or whitespace-only auth token", async () => {
    await withTempDir(async (projectRoot) => {
      await expect(
        startWorkspaceServer({ host: "127.0.0.1", port: 0, projectRoot, authToken: "   " }),
      ).rejects.toMatchObject({ code: "AUTH_TOKEN_BLANK" });
      await expect(
        startWorkspaceServer({ host: "127.0.0.1", port: 0, projectRoot, authToken: "" }),
      ).rejects.toMatchObject({ code: "AUTH_TOKEN_BLANK" });
    });
  });

  it("requires a non-blank secret for non-loopback binding", async () => {
    await withTempDir(async (projectRoot) => {
      await expect(
        startWorkspaceServer({ host: "0.0.0.0", port: 0, projectRoot, authToken: undefined }),
      ).rejects.toMatchObject({ code: "EXTERNAL_HOST_AUTH_REQUIRED" });
      await expect(
        startWorkspaceServer({ host: "0.0.0.0", port: 0, projectRoot, authToken: " \t " }),
      ).rejects.toMatchObject({ code: "AUTH_TOKEN_BLANK" });
    });
  });

  it("rejects blank query tokens, malformed bearer headers and length-mismatched tokens", async () => {
    await withTempDir(async (projectRoot) => {
      const server = await startWorkspaceServer({
        host: "127.0.0.1",
        port: 0,
        projectRoot,
        authToken: "secret-token",
      });
      try {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        const base = `http://127.0.0.1:${address.port}`;

        const blankQuery = await fetch(`${base}/?token=`);
        expect(blankQuery.status).toBe(401);

        const bareBearer = await fetch(`${base}/`, {
          headers: { authorization: "Bearer" },
        });
        expect(bareBearer.status).toBe(401);

        const wrongScheme = await fetch(`${base}/`, {
          headers: { authorization: "Basic secret-token" },
        });
        expect(wrongScheme.status).toBe(401);

        const wrongLength = await fetch(`${base}/`, {
          headers: { authorization: "Bearer secret-tokenX" },
        });
        expect(wrongLength.status).toBe(401);

        const validBearer = await fetch(`${base}/`, {
          headers: { authorization: "Bearer secret-token" },
        });
        expect(validBearer.status).toBe(200);

        const validQuery = await fetch(`${base}/?token=secret-token`);
        expect(validQuery.status).toBe(200);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  it("returns 401 for a Unicode token with equal JS length but a different UTF-8 byte length", async () => {
    await withTempDir(async (projectRoot) => {
      const server = await startWorkspaceServer({
        host: "127.0.0.1",
        port: 0,
        projectRoot,
        authToken: "a",
      });
      try {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        const base = `http://127.0.0.1:${address.port}`;
        const response = await fetch(`${base}/?token=${encodeURIComponent("é")}`);
        expect(response.status).toBe(401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  it("compares tokens in constant time and tolerates byte-length differences without throwing", () => {
    expect(timingSafeTextEqual("same-token", "same-token")).toBe(true);
    expect(timingSafeTextEqual("same-token", "different")).toBe(false);
    expect(timingSafeTextEqual("abc", "abcdef")).toBe(false);
    expect("é".length).toBe("a".length);
    expect(Buffer.byteLength("é", "utf8")).not.toBe(Buffer.byteLength("a", "utf8"));
    expect(() => timingSafeTextEqual("é", "a")).not.toThrow();
    expect(timingSafeTextEqual("é", "a")).toBe(false);
    expect(timingSafeTextEqual("", "")).toBe(true);
  });
});
