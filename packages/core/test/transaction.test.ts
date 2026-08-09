import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileProjectRepository } from "../src/index.js";

describe("file repository transaction and CAS", () => {
  it("exposes a transaction value while committing state and files together", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-transaction-"));
    try {
      const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const result = await repository.transaction(0, (state) => ({
        state: { ...state, project_name: "transactional" },
        value: "committed",
        writeSet: { files: [{ path: "exports/receipt.txt", content: "receipt" }] },
      }));
      expect(result).toMatchObject({ revision: 1, value: "committed", state: { project_name: "transactional" } });
      await expect(readFile(path.join(root, "demo", "exports", "receipt.txt"), "utf8")).resolves.toBe("receipt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a stale writer across repository instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-cas-"));
    try {
      const first = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const second = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const initial = await first.read();
      const results = await Promise.all([
        first.commit(initial.revision, (state) => ({ ...state, project_name: "first" })).then(() => "ok", (error: { code?: string }) => error.code),
        second.commit(initial.revision, (state) => ({ ...state, project_name: "second" })).then(() => "ok", (error: { code?: string }) => error.code),
      ]);
      expect(results.filter((value) => value === "ok")).toHaveLength(1);
      expect(results.filter((value) => value === "REVISION_CONFLICT")).toHaveLength(1);
      expect((await first.read()).revision).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back state when a materialized output cannot be replaced", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-rollback-"));
    try {
      const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const initial = await repository.read();
      await mkdir(path.join(root, "demo", ".workspace"), { recursive: true });
      await writeFile(path.join(root, "demo", "exports"), "blocking file", "utf8");
      await expect(repository.commit(initial.revision, (state) => ({ ...state, project_status: "published" }), { files: [{ path: "exports/card.png", content: Buffer.from("not a png") }] })).rejects.toBeDefined();
      const restored = await repository.read();
      expect(restored.revision).toBe(0);
      expect(restored.project_status).toBe("uninitialized");
      await expect(readFile(path.join(root, "demo", "exports"), "utf8")).resolves.toBe("blocking file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
