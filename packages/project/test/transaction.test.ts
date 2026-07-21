import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
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
  it("拒絕空交易、重複路徑與內部路徑", async () => {
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

  it("多檔案全部成功才提交", async () => {
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

  it("中途故障會還原所有既有檔案", async () => {
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

  it("原始 revision 不符時不落地", async () => {
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
    ).rejects.toThrow(/檔案已變更/u);
    await expect(readFile(path.join(workspace.root, "a.txt"), "utf8")).resolves.toBe("current");
  });

  it("只讀來源 revision 不符時不發布其他檔案", async () => {
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

  it("預期 revision 的新檔不存在時拒絕", async () => {
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

  it("expectedAbsent 防止覆寫既有 immutable artifact", async () => {
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

  it("拒絕根目錄內的 symlink 交易路徑", async () => {
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

  it("同一 workspace transaction 以來源 CAS 發布受控 export 且不覆寫", async () => {
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

  it("expectedAbsent 在預檢後遇到外部 writer 競爭仍不覆寫", async () => {
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

  it("並行 writer 只能有一個持有 advisory lock", async () => {
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

  it("stale lock 的並行 contender 只有一個能取得 ownership", async () => {
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

  it("release 發現 owner token 已變更時不刪除 successor lock", async () => {
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

  it("malformed lock 與 journal 一律 fail closed 且不改 target", async () => {
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

  it("可從 prepared journal 還原程序中止前狀態", async () => {
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

  it("復原時移除交易前不存在的新檔", async () => {
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
});
