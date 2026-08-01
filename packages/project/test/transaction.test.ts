import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeTextRevision,
  recoverIncompleteTransactions,
  runFileTransaction,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("runFileTransaction", () => {
  it("??蝛箔漱??銴楝敺??折頝臬?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await expect(runFileTransaction({ root: workspace.root, operations: [] })).rejects.toMatchObject({
      code: "TRANSACTION_EMPTY",
    });
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [
          { relativePath: "same.txt", content: "a" },
          { relativePath: "same.txt", content: "b" },
        ],
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_DUPLICATE_PATH" });
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [{ relativePath: ".transactions/owned", content: "bad" }],
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_PATH_DENIED" });
  });

  it("憭?獢?冽????漱", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await runFileTransaction({
      root: workspace.root,
      operations: [
        { relativePath: "a.txt", content: "A" },
        { relativePath: "nested/b.txt", content: "B" },
      ],
    });
    await expect(readFile(path.join(workspace.root, "a.txt"), "utf8")).resolves.toBe("A");
    await expect(readFile(path.join(workspace.root, "nested/b.txt"), "utf8")).resolves.toBe("B");
  });

  it("銝剝?????????獢?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "a.txt"), "old-a", "utf8");
    await writeFile(path.join(workspace.root, "b.txt"), "old-b", "utf8");
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [
          { relativePath: "a.txt", content: "new-a" },
          { relativePath: "b.txt", content: "new-b" },
        ],
        beforePublish: (index) => {
          if (index === 1) throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow("injected failure");
    await expect(readFile(path.join(workspace.root, "a.txt"), "utf8")).resolves.toBe("old-a");
    await expect(readFile(path.join(workspace.root, "b.txt"), "utf8")).resolves.toBe("old-b");
  });

  it("?? revision 銝泵???賢", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "a.txt"), "current", "utf8");
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [
          {
            relativePath: "a.txt",
            content: "next",
            expectedRawRevision: computeTextRevision("stale"),
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(readFile(path.join(workspace.root, "a.txt"), "utf8")).resolves.toBe("current");
  });

  it("?芾?靘? revision 銝泵???澆??嗡?瑼?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "source.txt"), "current", "utf8");
    await expect(
      runFileTransaction({
        root: workspace.root,
        expectations: [{ relativePath: "source.txt", expectedRawRevision: computeTextRevision("stale") }],
        operations: [{ relativePath: "output.txt", content: "new" }],
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(readFile(path.join(workspace.root, "output.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("?? revision ?瑼?摮??蝯?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [
          {
            relativePath: "missing.txt",
            content: "next",
            expectedRawRevision: computeTextRevision("expected"),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("expectedAbsent ?脫迫閬神?Ｘ? immutable artifact", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "immutable.bin"), Buffer.from([1, 2, 3]));
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [{ relativePath: "immutable.bin", content: Buffer.from([4]), expectedAbsent: true }],
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_TARGET_EXISTS" });
    await expect(readFile(path.join(workspace.root, "immutable.bin"))).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("???寧???symlink 鈭斗?頝臬?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await mkdir(path.join(workspace.root, "real"), { recursive: true });
    await symlink(
      path.join(workspace.root, "real"),
      path.join(workspace.root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: "linked/new.txt", content: "blocked" }],
    })).rejects.toMatchObject({ code: "TRANSACTION_PATH_LINK_DENIED" });
  });

  it("?? workspace transaction 隞乩?皞?CAS ?澆?? export 銝?閬神", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await mkdir(path.join(workspace.root, "projects", "demo", "sources"), { recursive: true });
    await writeFile(path.join(workspace.root, "projects", "demo", "sources", "card.json"), "source", "utf8");
    const operation = { relativePath: "exports/demo/corrected-card.v3.json", content: "export", expectedAbsent: true } as const;
    await runFileTransaction({
      root: workspace.root,
      expectations: [{ relativePath: "projects/demo/sources/card.json", expectedRawRevision: computeTextRevision("source") }],
      operations: [operation],
    });
    await expect(readFile(path.join(workspace.root, operation.relativePath), "utf8")).resolves.toBe("export");
    await expect(runFileTransaction({
      root: workspace.root,
      expectations: [{ relativePath: "projects/demo/sources/card.json", expectedRawRevision: computeTextRevision("source") }],
      operations: [operation],
    })).rejects.toMatchObject({ code: "TRANSACTION_TARGET_EXISTS" });
  });

  it("expectedAbsent ?券?瑼Ｗ??憭 writer 蝡嗥隞?閬神", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const target = path.join(workspace.root, "export.json");
    await expect(runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: "export.json", content: "transaction", expectedAbsent: true }],
      beforePublish: async () => writeFile(target, "external", "utf8"),
    })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(target, "utf8")).resolves.toBe("external");
  });

  it("銝西? writer ?芾??????advisory lock", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    let releaseGate: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const first = runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: "a.txt", content: "first" }],
      beforePublish: async () => {
        signalStarted?.();
        await gate;
      },
    });
    await started;
    await expect(
      runFileTransaction({
        root: workspace.root,
        operations: [{ relativePath: "b.txt", content: "second" }],
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_LOCKED" });
    releaseGate?.();
    await first;
  });

  it("stale lock ?蒂銵?contender ?芣?銝??? ownership", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const lockPath = path.join(workspace.root, ".transactions", "project.lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 2147483647, created_at: "2026-07-01T00:00:00.000Z" })}\n`, "utf8");
    let releaseGate: (() => void) | undefined;
    let signalOwned: (() => void) | undefined;
    const owned = new Promise<void>((resolve) => { signalOwned = resolve; });
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const contender = (name: string) => runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: `${name}.txt`, content: name }],
      beforePublish: async () => {
        signalOwned?.();
        await gate;
      },
    });
    const first = contender("first");
    await owned;
    await expect(contender("second")).rejects.toMatchObject({ code: "TRANSACTION_LOCKED" });
    releaseGate?.();
    await first;
  });

  it("release ?潛 owner token 撌脰??湔?銝??successor lock", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const lockPath = path.join(workspace.root, ".transactions", "project.lock");
    await runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: "owned.txt", content: "written" }],
      beforePublish: async () => {
        await writeFile(lockPath, `${JSON.stringify({
          schema_version: 1,
          pid: process.pid,
          created_at: new Date().toISOString(),
          owner_token: "successor-owner-token",
        })}\n`, "utf8");
      },
    });
    await expect(readFile(lockPath, "utf8")).resolves.toContain("successor-owner-token");
  });

  it("malformed lock ??journal 銝敺?fail closed 銝???target", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const transactionsRoot = path.join(workspace.root, ".transactions");
    await mkdir(transactionsRoot, { recursive: true });
    await writeFile(path.join(transactionsRoot, "project.lock"), "not-json", "utf8");
    await expect(runFileTransaction({
      root: workspace.root,
      operations: [{ relativePath: "blocked.txt", content: "bad" }],
    })).rejects.toMatchObject({ code: "TRANSACTION_LOCK_MALFORMED" });
    await expect(stat(path.join(workspace.root, "blocked.txt"))).rejects.toMatchObject({ code: "ENOENT" });

    const second = await makeTemporaryWorkspace();
    cleanups.push(second.cleanup);
    const tornRoot = path.join(second.root, ".transactions", "torn");
    await mkdir(tornRoot, { recursive: true });
    await writeFile(path.join(tornRoot, "journal.json"), "{\"state\":\"prepared\"", "utf8");
    await expect(runFileTransaction({
      root: second.root,
      operations: [{ relativePath: "blocked.txt", content: "bad" }],
    })).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_MALFORMED" });
    await expect(stat(path.join(second.root, "blocked.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("?臬? prepared journal ??蝔?銝剜迫???", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const transactionRoot = path.join(workspace.root, ".transactions", "crashed");
    await mkdir(path.join(transactionRoot, "backup"), { recursive: true });
    await writeFile(path.join(workspace.root, "a.txt"), "new", "utf8");
    await writeFile(path.join(transactionRoot, "backup", "0"), "old", "utf8");
    await writeFile(
      path.join(transactionRoot, "journal.json"),
      JSON.stringify({
        state: "prepared",
        operations: [{ relativePath: "a.txt", existed: true }],
      }),
      "utf8",
    );
    await expect(recoverIncompleteTransactions(workspace.root)).resolves.toEqual(["crashed"]);
    await expect(readFile(path.join(workspace.root, "a.txt"), "utf8")).resolves.toBe("old");
  });

  it("敺拙??宏?支漱??銝??函??唳?", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const transactionRoot = path.join(workspace.root, ".transactions", "new-file-crash");
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(workspace.root, "new.txt"), "partial", "utf8");
    await writeFile(
      path.join(transactionRoot, "journal.json"),
      JSON.stringify({
        state: "prepared",
        operations: [{ relativePath: "new.txt", existed: false }],
      }),
      "utf8",
    );
    await expect(recoverIncompleteTransactions(workspace.root)).resolves.toEqual(["new-file-crash"]);
    await expect(readFile(path.join(workspace.root, "new.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("covers legacy lock parsing, alternate lock roots, and committed journal skip", async () => {
    const workspace = await makeTemporaryWorkspace();
    const secondary = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup, secondary.cleanup);
    const lockPath = path.join(workspace.root, ".transactions", "project.lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 2147483647, created_at: "2026-07-01T00:00:00.000Z" })}\n`, "utf8");
    await runFileTransaction({ root: workspace.root, lockRoots: [workspace.root, secondary.root], operations: [{ relativePath: "legacy.txt", content: "ok" }] });
    await expect(readFile(path.join(workspace.root, "legacy.txt"), "utf8")).resolves.toBe("ok");
    const committed = path.join(workspace.root, ".transactions", "committed");
    await mkdir(committed, { recursive: true });
    await writeFile(path.join(committed, "journal.json"), JSON.stringify({ state: "committed" }), "utf8");
    await expect(recoverIncompleteTransactions(workspace.root)).resolves.toEqual([]);
    await writeFile(lockPath, JSON.stringify({ pid: 1, created_at: "bad", owner_token: "short" }), "utf8");
    await expect(runFileTransaction({ root: workspace.root, operations: [{ relativePath: "blocked.txt", content: "bad" }] })).rejects.toMatchObject({ code: "TRANSACTION_LOCK_MALFORMED" });
  });

  it("covers transaction lock and journal schema variants", async () => {
    const malformedCases = [
      "[]",
      JSON.stringify({ pid: 0, created_at: "bad" }),
      JSON.stringify({ pid: process.pid, created_at: new Date().toISOString(), schema_version: 2 }),
    ];
    for (const [index, raw] of malformedCases.entries()) {
      const workspace = await makeTemporaryWorkspace();
      cleanups.push(workspace.cleanup);
      const lockPath = path.join(workspace.root, ".transactions", "project.lock");
      await mkdir(path.dirname(lockPath), { recursive: true });
      await writeFile(lockPath, raw, "utf8");
      await expect(runFileTransaction({ root: workspace.root, operations: [{ relativePath: "blocked-" + index + ".txt", content: "bad" }] }))
        .rejects.toMatchObject({ code: "TRANSACTION_LOCK_MALFORMED" });
    }

    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const transactionsRoot = path.join(workspace.root, ".transactions");
    await mkdir(transactionsRoot, { recursive: true });
    const now = new Date().toISOString();
    const variants: Array<[string, unknown]> = [
      ["committed-v1", { schema_version: 1, id: "committed-v1", state: "committed", owner_token: "owner-token-123456", committed_at: now }],
      ["rolled-v1", { schema_version: 1, id: "rolled-v1", state: "rolled_back", owner_token: "owner-token-123456", rolled_back_at: now, error: "failed" }],
      ["recovered-v1", { schema_version: 1, id: "recovered-v1", state: "recovered", owner_token: "owner-token-123456", recovered_at: now }],
      ["committed-legacy", { id: "committed-legacy", state: "committed", committed_at: now }],
      ["rolled-legacy", { id: "rolled-legacy", state: "rolled_back", rolled_back_at: now, error: "failed" }],
      ["recovered-legacy", { state: "recovered", recovered_at: now }],
    ];
    for (const [id, journal] of variants) {
      const root = path.join(transactionsRoot, id);
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "journal.json"), JSON.stringify(journal), "utf8");
    }
    await expect(recoverIncompleteTransactions(workspace.root)).resolves.toEqual([]);
  });

  it("rejects malformed prepared and journal object variants during recovery", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = path.join(workspace.root, ".transactions");
    await mkdir(root, { recursive: true });
    const cases: Array<[string, unknown]> = [
      ["array-journal", []],
      ["prepared-missing-operations", { state: "prepared" }],
      ["prepared-bad-operation", { state: "prepared", operations: [{ relativePath: "", existed: true }] }],
      ["unknown-state", { state: "unknown" }],
    ];
    for (const [id, journal] of cases) {
      const dir = path.join(root, id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "journal.json"), JSON.stringify(journal), "utf8");
      await expect(recoverIncompleteTransactions(workspace.root)).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_MALFORMED" });
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("covers transaction missing expectations, journal edges, and non-Error rollback", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  await expect(runFileTransaction({
    root: workspace.root,
    expectations: [{ relativePath: "missing.txt", expectedRawRevision: computeTextRevision("missing") }],
    operations: [{ relativePath: "output.txt", content: "output" }],
  })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

  const missingJournal = await makeTemporaryWorkspace();
  cleanups.push(missingJournal.cleanup);
  await mkdir(path.join(missingJournal.root, ".transactions", "missing-journal"), { recursive: true });
  await expect(recoverIncompleteTransactions(missingJournal.root)).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_MALFORMED" });

  const malformedOperation = await makeTemporaryWorkspace();
  cleanups.push(malformedOperation.cleanup);
  await mkdir(path.join(malformedOperation.root, ".transactions", "null-operation"), { recursive: true });
  await writeFile(path.join(malformedOperation.root, ".transactions", "null-operation", "journal.json"), JSON.stringify({ state: "prepared", operations: [null] }), "utf8");
  await expect(recoverIncompleteTransactions(malformedOperation.root)).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_MALFORMED" });

  const nonError = await makeTemporaryWorkspace();
  cleanups.push(nonError.cleanup);
  await expect(runFileTransaction({
    root: nonError.root,
    operations: [{ relativePath: "rollback.txt", content: "rollback" }],
    beforePublish: () => { throw new Error("non-error rollback"); },
  })).rejects.toThrow("non-error rollback");
});
