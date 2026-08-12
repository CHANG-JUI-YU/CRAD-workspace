import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeRuntimeRevision } from "../src/runtime-revision.js";
import { startWorkspaceServer } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRuntimeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-runtime-revision-"));
  roots.push(root);
  await mkdir(path.join(root, "packages", "alpha", "dist", "nested"), { recursive: true });
  await mkdir(path.join(root, "packages", "beta", "dist"), { recursive: true });
  await writeFile(path.join(root, "packages", "alpha", "dist", "nested", "module.js"), "export const alpha = 1;\n", "utf8");
  await writeFile(path.join(root, "packages", "beta", "dist", "index.js"), "export const beta = 2;\n", "utf8");
  return root;
}

describe("runtime build revision", () => {
  it("is stable for identical sorted dist paths and contents", async () => {
    const root = await createRuntimeWorkspace();
    const first = await computeRuntimeRevision(root);
    await writeFile(path.join(root, "packages", "alpha", "dist", "nested", "module.js"), "export const alpha = 1;\n", "utf8");
    await writeFile(path.join(root, "packages", "beta", "dist", "ignored.txt"), "mtime and non-js files are ignored\n", "utf8");
    expect(await computeRuntimeRevision(root)).toBe(first);

    await writeFile(path.join(root, "packages", "beta", "dist", "index.js"), "export const beta = 3;\n", "utf8");
    expect(await computeRuntimeRevision(root)).not.toBe(first);
  });

  it("snapshots the startup revision in health instead of recomputing it per request", async () => {
    const root = await createRuntimeWorkspace();
    const expected = await computeRuntimeRevision(root);
    const server = await startWorkspaceServer({ port: 0, projectRoot: root, workspaceRoot: root });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const first = await (await fetch(`${base}/workspace/health`)).json() as { runtime_revision?: string };
      expect(first.runtime_revision).toBe(expected);
      await writeFile(path.join(root, "packages", "beta", "dist", "index.js"), "export const beta = 99;\n", "utf8");
      const second = await (await fetch(`${base}/workspace/health`)).json() as { runtime_revision?: string };
      expect(second.runtime_revision).toBe(expected);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });
});
