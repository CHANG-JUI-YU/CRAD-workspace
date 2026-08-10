import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash, FileProjectRepository } from "../src/index.js";

describe("file repository transaction and CAS", () => {
  const wait = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  it("restores the current backup when staged installation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-rollback-hole-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await initialRepository.read();
      const repository = new FileProjectRepository(root, "demo", {
        layout: "project",
        materialize: true,
        failure_injection: { point: "before_install", mode: "error" },
      });
      await expect(repository.commit(0, (state) => ({ ...state, project_name: "should roll back" }))).rejects.toMatchObject({ code: "INJECTED_FAILURE" });
      const restored = await new FileProjectRepository(root, "demo", { layout: "project", materialize: true }).read();
      expect(restored.revision).toBe(0);
      expect(restored.project_name).toBeUndefined();
      await expect(readFile(path.join(root, "demo", ".workspace", "state.json"), "utf8")).resolves.toContain('"revision":0');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores the complete old version after an install crash without a commit marker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-journal-after-install-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await initialRepository.read();
      const crashingRepository = new FileProjectRepository(root, "demo", {
        layout: "project",
        materialize: true,
        failure_injection: { point: "after_install", mode: "crash" },
      });
      await expect(crashingRepository.commit(0, (state) => ({ ...state, project_name: "must roll back" }))).rejects.toThrow("Injected repository crash");
      const [transactionId] = await readdir(path.join(root, "demo", ".workspace", "transactions"));
      expect(transactionId).toBeDefined();

      const recoveryRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const recovered = await recoveryRepository.read();
      expect(recovered.revision).toBe(0);
      expect(recovered.project_name).toBeUndefined();
      await expect(readFile(path.join(root, "demo", ".workspace", "state.json"), "utf8")).resolves.toContain('"revision":0');
      await expect(readFile(path.join(root, "demo", "project.json"), "utf8")).resolves.toContain('"revision":0');
      await expect(readFile(path.join(root, "demo", ".workspace", "workflow.json"), "utf8")).resolves.toContain('"revision":0');

      const recoveryAudit = await recoveryRepository.readRecoveryLedger();
      expect(recoveryAudit).toContainEqual(expect.objectContaining({
        kind: "transaction_recovery",
        transaction_id: transactionId,
        direction: "rollback",
        outcome: "completed",
      }));
      const restartedRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      expect(await restartedRepository.readRecoveryLedger()).toEqual(recoveryAudit);
      expect((await restartedRepository.read()).revision).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recovers an interrupted transaction from its durable journal on the next read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-journal-recovery-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await initialRepository.read();
      const crashingRepository = new FileProjectRepository(root, "demo", {
        layout: "project",
        materialize: true,
        failure_injection: { point: "after_backup", mode: "crash" },
      });
      await expect(crashingRepository.commit(0, (state) => ({ ...state, project_name: "must not partially apply" }))).rejects.toThrow("Injected repository crash");

      const recovered = await new FileProjectRepository(root, "demo", { layout: "project", materialize: true }).read();
      expect(recovered.revision).toBe(0);
      expect(recovered.project_name).toBeUndefined();
      await expect(readFile(path.join(root, "demo", ".workspace", "state.json"), "utf8")).resolves.toContain('"revision":0');
      await expect(readFile(path.join(root, "demo", ".workspace", "workflow.json"), "utf8")).resolves.toContain('"revision":0');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finalizes the new version after a crash following the committed marker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-journal-commit-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await initialRepository.read();
      const crashingRepository = new FileProjectRepository(root, "demo", {
        layout: "project",
        materialize: true,
        failure_injection: { point: "before_cleanup", mode: "crash" },
      });
      await expect(crashingRepository.commit(0, (state) => ({ ...state, project_name: "committed" }))).rejects.toThrow("Injected repository crash");
      const [transactionId] = await readdir(path.join(root, "demo", ".workspace", "transactions"));
      expect(transactionId).toBeDefined();

      const recoveryRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      const recovered = await recoveryRepository.read();
      expect(recovered.revision).toBe(1);
      expect(recovered.project_name).toBe("committed");
      await expect(readFile(path.join(root, "demo", "project.json"), "utf8")).resolves.toContain('"revision":1');

      const recoveryAudit = await recoveryRepository.readRecoveryLedger();
      expect(recoveryAudit).toContainEqual(expect.objectContaining({
        kind: "transaction_recovery",
        transaction_id: transactionId,
        direction: "finalize",
        outcome: "completed",
      }));
      expect(await new FileProjectRepository(root, "demo", { layout: "project" }).readRecoveryLedger()).toEqual(recoveryAudit);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps committed data when cleanup fails and retries cleanup on restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-journal-cleanup-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
      await initialRepository.read();
      const repository = new FileProjectRepository(root, "demo", {
        layout: "project",
        materialize: true,
        failure_injection: { point: "before_cleanup", mode: "error" },
      });
      await expect(repository.commit(0, (state) => ({ ...state, project_name: "cleanup later" }))).resolves.toMatchObject({ revision: 1 });

      const recovered = await new FileProjectRepository(root, "demo", { layout: "project", materialize: true }).read();
      expect(recovered.project_name).toBe("cleanup later");
      expect(recovered.revision).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores a removed original when the remove entry crashes after backup", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-journal-remove-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "legacy", materialize: true });
      await initialRepository.read();
      const withRemovableFile = await initialRepository.commit(0, (state) => state, {
        files: [{ path: "exports/removable.txt", content: "keep me" }],
      });
      const crashingRepository = new FileProjectRepository(root, "demo", {
        layout: "legacy",
        materialize: true,
        failure_injection: {
          point: "after_backup",
          mode: "crash",
          relative_path: "exports/removable.txt",
        },
      });
      await expect(crashingRepository.commit(withRemovableFile.revision, (state) => ({ ...state, project_name: "must roll back" }), {
        remove: ["exports/removable.txt"],
      })).rejects.toThrow("Injected repository crash");

      const recovered = await new FileProjectRepository(root, "demo", { layout: "legacy", materialize: true }).read();
      expect(recovered.revision).toBe(withRemovableFile.revision);
      expect(recovered.project_name).toBeUndefined();
      await expect(readFile(path.join(root, "demo", "exports", "removable.txt"), "utf8")).resolves.toBe("keep me");
      await expect(readFile(path.join(root, "demo", "state.json"), "utf8")).resolves.toContain(`"revision":${withRemovableFile.revision}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refreshes a live lease so a transaction longer than thirty seconds is not stolen", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-lock-heartbeat-"));
    try {
      const first = new FileProjectRepository(root, "demo", { lock: { lease_ms: 80, heartbeat_ms: 20, timeout_ms: 500 } });
      const initial = await first.read();
      const second = new FileProjectRepository(root, "demo", { lock: { lease_ms: 80, heartbeat_ms: 20, timeout_ms: 100 } });
      const longCommit = first.transaction(initial.revision, async (state) => {
        await wait(220);
        return { state: { ...state, project_name: "first" }, value: undefined };
      });
      await wait(110);
      await expect(second.commit(initial.revision, (state) => ({ ...state, project_name: "second" }))).rejects.toMatchObject({ code: "REPOSITORY_LOCK_TIMEOUT" });
      await longCommit;
      expect((await first.read()).project_name).toBe("first");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("audits an expired lock takeover without auditing ordinary lock acquisition", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-lock-audit-"));
    try {
      const initialRepository = new FileProjectRepository(root, "demo", { layout: "project" });
      const initial = await initialRepository.read();
      expect(await initialRepository.readRecoveryLedger()).toEqual([]);

      const lockKey = contentHash(`${path.resolve(root)}\0demo`);
      const lockFile = path.join(os.tmpdir(), "st-workspace-v3-locks", `${lockKey}.lock`);
      const staleOwner = "4321:expired-owner-secret";
      const expiredAt = new Date(Date.now() - 60_000).toISOString();
      await mkdir(path.dirname(lockFile), { recursive: true });
      await writeFile(lockFile, `${JSON.stringify({
        schema_version: 1,
        owner: staleOwner,
        pid: 4321,
        created_at: expiredAt,
        heartbeat_at: expiredAt,
        lease_expires_at: expiredAt,
      })}\n`, "utf8");

      const takeoverRepository = new FileProjectRepository(root, "demo", { layout: "project" });
      const afterTakeover = await takeoverRepository.read();
      expect(afterTakeover.revision).toBe(initial.revision);
      const recoveryAudit = await takeoverRepository.readRecoveryLedger();
      expect(recoveryAudit).toContainEqual(expect.objectContaining({
        kind: "stale_lock_takeover",
        lock_key: lockKey,
        previous_owner_hash: `sha256:${contentHash(staleOwner)}`,
        outcome: "completed",
      }));
      expect(JSON.stringify(recoveryAudit)).not.toContain(staleOwner);

      const restartedRepository = new FileProjectRepository(root, "demo", { layout: "project" });
      expect((await restartedRepository.read()).revision).toBe(initial.revision);
      expect(await restartedRepository.readRecoveryLedger()).toEqual(recoveryAudit);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the cross-instance lock when relocating a project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-relocate-lock-"));
    try {
      const first = new FileProjectRepository(root, "demo", { lock: { lease_ms: 80, heartbeat_ms: 20, timeout_ms: 500 } });
      const initial = await first.read();
      const second = new FileProjectRepository(root, "demo", { lock: { lease_ms: 80, heartbeat_ms: 20, timeout_ms: 100 } });
      const longCommit = first.transaction(initial.revision, async (state) => {
        await wait(180);
        return { state: { ...state, project_name: "held" }, value: undefined };
      });
      await wait(30);
      await expect(second.relocate("renamed")).rejects.toMatchObject({ code: "REPOSITORY_LOCK_TIMEOUT" });
      await longCommit;
      await second.relocate("renamed");
      expect(second.projectId).toBe("renamed");
      await expect(readFile(path.join(root, "renamed", "state.json"), "utf8")).resolves.toContain('"project_name":"held"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
