import { mkdir, open, readFile, stat } from "node:fs/promises";
import type { RepositoryRecoveryAuditRecord, RepositoryStaleLockTakeoverAuditRecord, RepositoryTransactionRecoveryAuditRecord } from "./project-repository.js";
import { CoreError, contentHash } from "../core-utilities.js";
import { normalizeRepositoryPath, syncDirectory } from "./materialization.js";

export type RepositoryTransactionPhase = "prepared" | "applying" | "committed";
export type RepositoryTransactionEntryPhase = "planned" | "backing_up" | "backed_up" | "installing" | "installed" | "removed";
export type RepositoryTargetKind = "missing" | "file" | "directory" | "other";

export interface RepositoryTargetSnapshot {
  readonly kind: RepositoryTargetKind;
  readonly hash?: string;
  readonly size?: number;
}

export interface RepositoryTransactionJournalEntry {
  readonly action: "write" | "remove";
  readonly relative_path: string;
  readonly target_path: string;
  readonly staged_path?: string;
  readonly backup_path: string;
  original: RepositoryTargetSnapshot;
  readonly expected: RepositoryTargetSnapshot;
  phase: RepositoryTransactionEntryPhase;
  backup_created: boolean;
  installed: boolean;
}

export interface RepositoryTransactionJournal {
  readonly schema_version: 1;
  readonly id: string;
  readonly project_id: string;
  readonly owner: string;
  readonly expected_revision: number;
  readonly staging_directory: string;
  readonly transaction_directory: string;
  readonly entries: RepositoryTransactionJournalEntry[];
  phase: RepositoryTransactionPhase;
  created_at: string;
  updated_at: string;
}

export interface LockRecord {
  readonly schema_version: 1;
  readonly owner: string;
  readonly pid: number;
  readonly created_at: string;
  readonly heartbeat_at: string;
  readonly lease_expires_at: string;
}

export function readLockRecordFromContent(raw: string, lockFile: string): LockRecord {
  const lines = raw.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<LockRecord>;
      if (parsed.schema_version === 1 && typeof parsed.owner === "string" && parsed.owner.length > 0 && typeof parsed.lease_expires_at === "string") return parsed as LockRecord;
    } catch {
      // Ignore a partially appended final heartbeat in favour of the last complete snapshot.
    }
  }
  throw new CoreError("REPOSITORY_LOCK_CORRUPT", `Lock file ${lockFile} is corrupt`, true);
}

export async function appendDurableJournalSnapshot(journalPath: string, journal: RepositoryTransactionJournal): Promise<void> {
  await mkdir(pathDirectory(journalPath), { recursive: true });
  const handle = await open(journalPath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(pathDirectory(journalPath));
}

export async function appendDurableRecoveryAuditRecord(ledgerFile: string, record: RepositoryRecoveryAuditRecord): Promise<void> {
  await mkdir(pathDirectory(ledgerFile), { recursive: true });
  const handle = await open(ledgerFile, "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(pathDirectory(ledgerFile));
}

export async function readRecoveryLedgerFile(ledgerFile: string): Promise<readonly RepositoryRecoveryAuditRecord[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split(/\r?\n/u);
  const records = new Map<string, RepositoryRecoveryAuditRecord>();
  let lastNonEmpty = -1;
  for (let index = 0; index < lines.length; index += 1) if (lines[index]?.trim().length !== 0) lastNonEmpty = index;
  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      if (index === lastNonEmpty && !raw.endsWith("\n")) break;
      throw new CoreError("RECOVERY_LEDGER_CORRUPT", `Repository recovery ledger ${ledgerFile} is corrupt`, true, { cause: error });
    }
    if (!isRepositoryRecoveryAuditRecord(parsed)) throw new CoreError("RECOVERY_LEDGER_CORRUPT", `Repository recovery ledger ${ledgerFile} contains an invalid record`, true);
    if (!records.has(parsed.id)) records.set(parsed.id, parsed);
  }
  return [...records.values()];
}

export function isRepositoryRecoveryAuditRecord(value: unknown): value is RepositoryRecoveryAuditRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RepositoryRecoveryAuditRecord>;
  if (record.schema_version !== 1 || typeof record.id !== "string" || record.id.length === 0 || typeof record.project_id !== "string" || typeof record.occurred_at !== "string") return false;
  if (record.kind === "transaction_recovery") {
    const transactionRecord = record as Partial<RepositoryTransactionRecoveryAuditRecord>;
    return typeof transactionRecord.transaction_id === "string"
      && ["rollback", "finalize"].includes(transactionRecord.direction ?? "")
      && ["completed", "failed"].includes(transactionRecord.outcome ?? "")
      && (transactionRecord.error_code === undefined || typeof transactionRecord.error_code === "string");
  }
  if (record.kind === "stale_lock_takeover") {
    const takeoverRecord = record as Partial<RepositoryStaleLockTakeoverAuditRecord>;
    return typeof takeoverRecord.lock_key === "string"
      && takeoverRecord.lock_key.length > 0
      && typeof takeoverRecord.previous_owner_hash === "string"
      && takeoverRecord.previous_owner_hash.startsWith("sha256:")
      && takeoverRecord.outcome === "completed";
  }
  return false;
}

export function recoveryErrorCode(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof CoreError) return error.code;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN";
}

export async function readLatestJournalSnapshot(journalPath: string): Promise<RepositoryTransactionJournal | undefined> {
  const raw = await readFile(journalPath, "utf8");
  const lines = raw.split(/\r?\n/u);
  let latest: RepositoryTransactionJournal | undefined;
  let lastNonEmpty = -1;
  for (let index = 0; index < lines.length; index += 1) if (lines[index]?.trim().length !== 0) lastNonEmpty = index;
  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isTransactionJournal(parsed)) throw new Error("invalid transaction journal snapshot");
      latest = parsed;
    } catch (error) {
      if (index === lastNonEmpty) break;
      throw new CoreError("TRANSACTION_JOURNAL_CORRUPT", `Transaction journal ${journalPath} is corrupt`, true, { cause: error });
    }
  }
  if (latest === undefined) throw new CoreError("TRANSACTION_JOURNAL_CORRUPT", `Transaction journal ${journalPath} has no complete snapshot`, true);
  return latest;
}

export function isTransactionJournal(value: unknown): value is RepositoryTransactionJournal {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RepositoryTransactionJournal>;
  if (record.schema_version !== 1 || typeof record.id !== "string" || typeof record.project_id !== "string" || typeof record.owner !== "string") return false;
  if (typeof record.expected_revision !== "number" || typeof record.staging_directory !== "string" || typeof record.transaction_directory !== "string" || !Array.isArray(record.entries) || !["prepared", "applying", "committed"].includes(record.phase ?? "")) return false;
  try {
    normalizeRepositoryPath(record.staging_directory);
    normalizeRepositoryPath(record.transaction_directory);
  } catch {
    return false;
  }
  return record.entries.every((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const item = entry as Partial<RepositoryTransactionJournalEntry>;
    try {
      normalizeRepositoryPath(item.relative_path ?? "");
      normalizeRepositoryPath(item.target_path ?? "");
      normalizeRepositoryPath(item.backup_path ?? "");
      if (item.staged_path !== undefined) normalizeRepositoryPath(item.staged_path);
    } catch {
      return false;
    }
    return (item.action === "write" || item.action === "remove")
      && typeof item.relative_path === "string"
      && typeof item.target_path === "string"
      && typeof item.backup_path === "string"
      && item.original !== undefined
      && item.expected !== undefined
      && typeof item.phase === "string"
      && typeof item.backup_created === "boolean"
      && typeof item.installed === "boolean"
      && isTargetSnapshot(item.original)
      && isTargetSnapshot(item.expected);
  });
}

export function isTargetSnapshot(value: unknown): value is RepositoryTargetSnapshot {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as Partial<RepositoryTargetSnapshot>;
  if (!["missing", "file", "directory", "other"].includes(snapshot.kind ?? "")) return false;
  if (snapshot.kind === "file") return typeof snapshot.hash === "string" && typeof snapshot.size === "number";
  return snapshot.hash === undefined && (snapshot.size === undefined || typeof snapshot.size === "number");
}

export async function inspectTarget(targetPath: string): Promise<RepositoryTargetSnapshot> {
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (targetStat.isFile()) {
    const content = await readFile(targetPath);
    return { kind: "file", hash: contentHash(content), size: content.byteLength };
  }
  if (targetStat.isDirectory()) return { kind: "directory", size: targetStat.size };
  return { kind: "other", size: targetStat.size };
}

export function snapshotForContent(content: Uint8Array | string): RepositoryTargetSnapshot {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return { kind: "file", hash: contentHash(bytes), size: bytes.byteLength };
}

export function snapshotsEqual(left: RepositoryTargetSnapshot, right: RepositoryTargetSnapshot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "file") return true;
  return left.hash === right.hash && left.size === right.size;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function removePath(targetPath: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(targetPath, { recursive: true, force: true });
}

function pathDirectory(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return index < 0 ? "." : filePath.slice(0, index);
}
