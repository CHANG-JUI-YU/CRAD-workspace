import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Revision } from "@card-workspace/schemas";

import { computeTextRevision } from "./canonical.js";
import { ProjectError } from "./errors.js";
import { resolveWithin } from "./path-security.js";

export interface TransactionOperation {
  relativePath: string;
  content: string | Buffer;
  expectedRawRevision?: Revision;
  expectedAbsent?: boolean;
}

export interface TransactionExpectation {
  relativePath: string;
  expectedRawRevision: Revision;
}

export interface TransactionOptions {
  root: string;
  lockRoots?: string[];
  operations: TransactionOperation[];
  expectations?: TransactionExpectation[];
  beforePublish?: (index: number, operation: TransactionOperation) => void | Promise<void>;
}

export interface TransactionResult {
  id: string;
  journalPath: string;
  written: string[];
}

interface PreparedOperation {
  operation: TransactionOperation;
  relativePath: string;
  target: string;
  staged: string;
  backup: string;
  existed: boolean;
  expectedAbsent: boolean;
}

interface LockOwner {
  schema_version: 1;
  pid: number;
  created_at: string;
  owner_token: string;
}

interface LegacyLockOwner {
  pid: number;
  created_at: string;
}

interface TransactionJournalRecord {
  state: "prepared" | "committed" | "rolled_back" | "recovered";
  operations?: Array<{ relativePath: string; existed: boolean }>;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function resolveTransactionTarget(root: string, relativePath: string): Promise<string> {
  const resolved = await resolveWithin(root, relativePath);
  const absoluteRoot = path.resolve(root);
  let current = absoluteRoot;
  const relative = path.relative(absoluteRoot, resolved);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new ProjectError("TRANSACTION_PATH_LINK_DENIED", `交易路徑不得使用 symlink：${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return resolved;
}

async function durableWrite(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncParentDirectory(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path.dirname(filePath), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLock(raw: string): LockOwner | LegacyLockOwner {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProjectError("TRANSACTION_LOCK_MALFORMED", "交易鎖不是有效 JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectError("TRANSACTION_LOCK_MALFORMED", "交易鎖格式無效");
  }
  const record = value as Record<string, unknown>;
  const validBase = Number.isInteger(record.pid) && (record.pid as number) > 0
    && typeof record.created_at === "string" && !Number.isNaN(Date.parse(record.created_at));
  if (!validBase) throw new ProjectError("TRANSACTION_LOCK_MALFORMED", "交易鎖 owner 資料無效");
  if (record.schema_version === undefined && record.owner_token === undefined
    && Object.keys(record).every((key) => key === "pid" || key === "created_at")) {
    return { pid: record.pid as number, created_at: record.created_at as string };
  }
  if (record.schema_version === 1 && typeof record.owner_token === "string" && record.owner_token.length >= 16
    && Object.keys(record).every((key) => ["schema_version", "pid", "created_at", "owner_token"].includes(key))) {
    return record as unknown as LockOwner;
  }
  throw new ProjectError("TRANSACTION_LOCK_MALFORMED", "交易鎖 schema 無效");
}

function parseJournal(raw: string, transactionId: string): TransactionJournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${transactionId} journal 不是有效 JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${transactionId} journal 格式無效`);
  }
  const record = value as Record<string, unknown>;
  if (!["prepared", "committed", "rolled_back", "recovered"].includes(String(record.state))) {
    throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${transactionId} journal state 無效`);
  }
  if (record.state === "prepared") {
    if (!Array.isArray(record.operations) || !record.operations.every((operation) => {
      if (typeof operation !== "object" || operation === null || Array.isArray(operation)) return false;
      const item = operation as Record<string, unknown>;
      return typeof item.relativePath === "string" && item.relativePath.length > 0 && typeof item.existed === "boolean";
    })) {
      throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${transactionId} prepared journal 無效`);
    }
  }
  const state = record.state as TransactionJournalRecord["state"];
  const commonV1 = record.schema_version === 1 && typeof record.id === "string"
    && typeof record.owner_token === "string" && record.owner_token.length >= 16;
  const validV1 = commonV1 && (
    (state === "prepared" && typeof record.created_at === "string")
    || (state === "committed" && typeof record.committed_at === "string")
    || (state === "rolled_back" && typeof record.rolled_back_at === "string" && typeof record.error === "string")
    || (state === "recovered" && typeof record.recovered_at === "string")
  );
  const v1Keys: Record<TransactionJournalRecord["state"], string[]> = {
    prepared: ["schema_version", "id", "state", "owner_token", "created_at", "operations"],
    committed: ["schema_version", "id", "state", "owner_token", "committed_at"],
    rolled_back: ["schema_version", "id", "state", "owner_token", "rolled_back_at", "error"],
    recovered: ["schema_version", "id", "state", "owner_token", "recovered_at"],
  };
  const legacyKeys: Record<TransactionJournalRecord["state"], string[]> = {
    prepared: ["id", "state", "created_at", "operations"],
    committed: ["id", "state", "committed_at"],
    rolled_back: ["id", "state", "rolled_back_at", "error"],
    recovered: ["state", "recovered_at"],
  };
  const validLegacy = record.schema_version === undefined
    && Object.keys(record).every((key) => legacyKeys[state].includes(key));
  if (!(validV1 && Object.keys(record).every((key) => v1Keys[state].includes(key))) && !validLegacy) {
    throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${transactionId} journal schema 無效`);
  }
  return record as unknown as TransactionJournalRecord;
}

async function installLock(lockPath: string, owner: LockOwner): Promise<boolean> {
  const candidate = `${lockPath}.${owner.owner_token}.candidate`;
  await durableWrite(candidate, `${JSON.stringify(owner)}\n`);
  try {
    await link(candidate, lockPath);
    await syncParentDirectory(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await rm(candidate, { force: true });
  }
}

async function assertLockOwned(lockPath: string, ownerToken: string): Promise<void> {
  const owner = parseLock(await readFile(lockPath, "utf8"));
  if (!("owner_token" in owner) || owner.owner_token !== ownerToken) {
    throw new ProjectError("TRANSACTION_LOCK_OWNERSHIP_LOST", "交易鎖 ownership 已變更");
  }
}

async function recoverWhileLocked(root: string, lockPath: string, ownerToken: string): Promise<string[]> {
  await assertLockOwned(lockPath, ownerToken);
  const transactionsRoot = path.join(root, ".transactions");
  let entries;
  try {
    entries = await readdir(transactionsRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const recovered: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await assertLockOwned(lockPath, ownerToken);
    const transactionRoot = path.join(transactionsRoot, entry.name);
    const journalPath = path.join(transactionRoot, "journal.json");
    let raw: string;
    try {
      raw = await readFile(journalPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProjectError("TRANSACTION_JOURNAL_MALFORMED", `交易 ${entry.name} 缺少 journal`);
      }
      throw error;
    }
    const journal = parseJournal(raw, entry.name);
    if (journal.state !== "prepared" || !journal.operations) continue;
    for (let index = journal.operations.length - 1; index >= 0; index -= 1) {
      const operation = journal.operations[index]!;
      const target = await resolveTransactionTarget(root, operation.relativePath);
      const backup = path.join(transactionRoot, "backup", String(index));
      if (await exists(backup)) {
        await rm(target, { force: true });
        await mkdir(path.dirname(target), { recursive: true });
        await rename(backup, target);
      } else if (!operation.existed) {
        await rm(target, { force: true });
      }
    }
    await durableWrite(journalPath, `${JSON.stringify({
      schema_version: 1,
      id: entry.name,
      state: "recovered",
      owner_token: ownerToken,
      recovered_at: new Date().toISOString(),
    }, null, 2)}\n`);
    recovered.push(entry.name);
  }
  return recovered;
}

async function acquireProjectLock(root: string): Promise<{
  ownerToken: string;
  recovered: string[];
  release: () => Promise<void>;
}> {
  const transactionsRoot = path.join(root, ".transactions");
  const lockPath = path.join(transactionsRoot, "project.lock");
  await mkdir(transactionsRoot, { recursive: true });
  const owner: LockOwner = {
    schema_version: 1,
    pid: process.pid,
    created_at: new Date().toISOString(),
    owner_token: randomUUID(),
  };
  if (!(await installLock(lockPath, owner))) {
    const current = parseLock(await readFile(lockPath, "utf8"));
    if (processIsAlive(current.pid)) throw new ProjectError("TRANSACTION_LOCKED", `專案正由 PID ${current.pid} 修改`);
    const stalePath = `${lockPath}.${owner.owner_token}.stale`;
    try {
      await rename(lockPath, stalePath);
    } catch (error) {
      if (["ENOENT", "EEXIST", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        throw new ProjectError("TRANSACTION_LOCKED", "stale 交易鎖已由其他 contender claim");
      }
      throw error;
    }
    try {
      if (!(await installLock(lockPath, owner))) {
        throw new ProjectError("TRANSACTION_LOCKED", "stale 交易鎖已由其他 contender claim");
      }
    } finally {
      await rm(stalePath, { force: true });
    }
  }
  let recovered: string[];
  try {
    recovered = await recoverWhileLocked(root, lockPath, owner.owner_token);
  } catch (error) {
    await assertLockOwned(lockPath, owner.owner_token).then(() => rm(lockPath, { force: true }), () => undefined);
    throw error;
  }
  return {
    ownerToken: owner.owner_token,
    recovered,
    release: async () => {
      try {
        await assertLockOwned(lockPath, owner.owner_token);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        if (error instanceof ProjectError && error.code === "TRANSACTION_LOCK_OWNERSHIP_LOST") return;
        throw error;
      }
      await rm(lockPath, { force: true });
    },
  };
}

export async function recoverIncompleteTransactions(root: string): Promise<string[]> {
  const lock = await acquireProjectLock(root);
  try {
    return lock.recovered;
  } finally {
    await lock.release();
  }
}

export async function runFileTransaction(options: TransactionOptions): Promise<TransactionResult> {
  if (options.operations.length === 0) {
    throw new ProjectError("TRANSACTION_EMPTY", "交易至少需要一項寫入");
  }
  const id = randomUUID();
  const transactionRoot = path.join(options.root, ".transactions", id);
  const journalPath = path.join(transactionRoot, "journal.json");
  const prepared: PreparedOperation[] = [];
  const published: PreparedOperation[] = [];
  const seenPaths = new Set<string>();
  const locks: Array<Awaited<ReturnType<typeof acquireProjectLock>>> = [];
  const lockRoots = [...new Set([options.root, ...(options.lockRoots ?? [])].map((root) => path.resolve(root)))]
    .sort((left, right) => left.localeCompare(right));
  try {
    for (const root of lockRoots) locks.push(await acquireProjectLock(root));
  } catch (error) {
    for (const lock of locks.reverse()) await lock.release();
    throw error;
  }
  const ownerToken = locks[lockRoots.indexOf(path.resolve(options.root))]!.ownerToken;

  try {
    for (const expectation of options.expectations ?? []) {
      const target = await resolveTransactionTarget(options.root, expectation.relativePath);
      if (!(await exists(target))) {
        throw new ProjectError("REVISION_CONFLICT", `預期檔案存在：${expectation.relativePath}`);
      }
      const actual = computeTextRevision(await readFile(target));
      if (actual !== expectation.expectedRawRevision) {
        throw new ProjectError(
          "REVISION_CONFLICT",
          `來源已變更：${expectation.relativePath}；預期 ${expectation.expectedRawRevision}，實際 ${actual}`,
        );
      }
    }
    for (const [index, operation] of options.operations.entries()) {
      const normalized = operation.relativePath.replaceAll("\\", "/");
      if (normalized === ".transactions" || normalized.startsWith(".transactions/")) {
        throw new ProjectError("TRANSACTION_PATH_DENIED", "交易不可修改內部 .transactions 目錄");
      }
      if (seenPaths.has(normalized)) {
        throw new ProjectError("TRANSACTION_DUPLICATE_PATH", `交易路徑重複：${normalized}`);
      }
      seenPaths.add(normalized);
      const target = await resolveTransactionTarget(options.root, operation.relativePath);
      const existed = await exists(target);
      if (operation.expectedAbsent && existed) {
        throw new ProjectError("TRANSACTION_TARGET_EXISTS", `預期檔案不存在：${operation.relativePath}`);
      }
      if (operation.expectedRawRevision) {
        if (!existed) {
          throw new ProjectError("REVISION_CONFLICT", `預期檔案存在：${operation.relativePath}`);
        }
        const actual = computeTextRevision(await readFile(target));
        if (actual !== operation.expectedRawRevision) {
          throw new ProjectError(
            "REVISION_CONFLICT",
            `檔案已變更：${operation.relativePath}；預期 ${operation.expectedRawRevision}，實際 ${actual}`,
          );
        }
      }
      const staged = path.join(transactionRoot, "staged", String(index));
      const backup = path.join(transactionRoot, "backup", String(index));
      await durableWrite(staged, operation.content);
      prepared.push({
        operation,
        relativePath: normalized,
        target,
        staged,
        backup,
        existed,
        expectedAbsent: operation.expectedAbsent === true,
      });
    }

    await durableWrite(
      journalPath,
      `${JSON.stringify(
        {
          id,
          schema_version: 1,
          state: "prepared",
          owner_token: ownerToken,
          created_at: new Date().toISOString(),
          operations: prepared.map((item) => ({
            relativePath: item.relativePath,
            existed: item.existed,
          })),
        },
        null,
        2,
      )}\n`,
    );

    for (const [index, operation] of prepared.entries()) {
      await options.beforePublish?.(index, operation.operation);
      await mkdir(path.dirname(operation.target), { recursive: true });
      if (operation.existed) {
        await mkdir(path.dirname(operation.backup), { recursive: true });
        await rename(operation.target, operation.backup);
      }
      try {
        if (operation.expectedAbsent) {
          await link(operation.staged, operation.target);
          await rm(operation.staged);
        } else {
          await rename(operation.staged, operation.target);
        }
        await syncParentDirectory(operation.target);
        published.push(operation);
      } catch (error) {
        if (operation.existed && (await exists(operation.backup))) {
          await rename(operation.backup, operation.target);
          await syncParentDirectory(operation.target);
        }
        throw error;
      }
    }

    await durableWrite(
      journalPath,
      `${JSON.stringify({
        schema_version: 1,
        id,
        state: "committed",
        owner_token: ownerToken,
        committed_at: new Date().toISOString(),
      }, null, 2)}\n`,
    );
    return { id, journalPath, written: prepared.map((item) => item.target) };
  } catch (error) {
    for (const operation of published.reverse()) {
      await rm(operation.target, { force: true });
      if (operation.existed && (await exists(operation.backup))) {
        await rename(operation.backup, operation.target);
        await syncParentDirectory(operation.target);
      }
    }
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(
      journalPath,
      `${JSON.stringify(
        {
          id,
          schema_version: 1,
          state: "rolled_back",
          owner_token: ownerToken,
          rolled_back_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    throw error;
  } finally {
    for (const lock of locks.reverse()) await lock.release();
  }
}
