import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreError, contentHash } from "../src/index.js";
import {
  appendDurableJournalSnapshot,
  appendDurableRecoveryAuditRecord,
  inspectTarget,
  isRepositoryRecoveryAuditRecord,
  isTargetSnapshot,
  isTransactionJournal,
  pathExists,
  readLatestJournalSnapshot,
  readLockRecordFromContent,
  readRecoveryLedgerFile,
  recoveryErrorCode,
  removePath,
  snapshotForContent,
  snapshotsEqual,
  type RepositoryRecoveryAuditRecord,
  type RepositoryTransactionJournal,
  type RepositoryTransactionJournalEntry,
} from "../src/repository/transaction-journal.js";

const now = "2026-08-15T00:00:00.000Z";

function journalEntry(overrides: Partial<RepositoryTransactionJournalEntry> = {}): RepositoryTransactionJournalEntry {
  return {
    action: "write",
    relative_path: "characters/yukino.md",
    target_path: "characters/yukino.md",
    backup_path: ".workspace/transactions/txn-1/backup/characters/yukino.md",
    original: { kind: "missing" },
    expected: { kind: "file", hash: contentHash("hello"), size: 5 },
    phase: "planned",
    backup_created: false,
    installed: false,
    ...overrides,
  };
}

function journal(overrides: Partial<RepositoryTransactionJournal> = {}): RepositoryTransactionJournal {
  return {
    schema_version: 1,
    id: "txn-1",
    project_id: "project-1",
    owner: "writer",
    expected_revision: 3,
    staging_directory: ".workspace/.staging-txn-1",
    transaction_directory: ".workspace/transactions/txn-1",
    entries: [journalEntry()],
    phase: "prepared",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function recoveryRecord(overrides: Partial<RepositoryRecoveryAuditRecord> = {}): RepositoryRecoveryAuditRecord {
  return {
    schema_version: 1,
    id: "audit-1",
    kind: "transaction_recovery",
    project_id: "project-1",
    transaction_id: "txn-1",
    direction: "rollback",
    outcome: "completed",
    occurred_at: now,
    ...overrides,
  } as RepositoryRecoveryAuditRecord;
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "batch11-journal-"));
}

function validLockLine(owner = "writer"): string {
  return JSON.stringify({ schema_version: 1, owner, pid: 1, created_at: now, heartbeat_at: now, lease_expires_at: now });
}

describe("Audit 8 batch 11: transaction journal branches (#112 coverage)", () => {
  describe("readLockRecordFromContent", () => {
    it("returns the last complete valid lock snapshot", () => {
      const record = readLockRecordFromContent(`${validLockLine("a")}\n${validLockLine("b")}\n`, "lock.jsonl");
      expect(record.owner).toBe("b");
    });

    it("skips garbage lines and incomplete snapshots in favour of valid ones", () => {
      const raw = `junk\n{}\n${validLockLine("writer")}\n`;
      expect(readLockRecordFromContent(raw, "lock.jsonl").owner).toBe("writer");
    });

    it("throws REPOSITORY_LOCK_CORRUPT when no valid snapshot exists", () => {
      expect(() => readLockRecordFromContent("garbage\n{}\n", "lock.jsonl")).toThrowError(
        expect.objectContaining({ code: "REPOSITORY_LOCK_CORRUPT" }),
      );
    });
  });

  describe("appendDurableJournalSnapshot", () => {
    it("creates nested directories and appends snapshots", async () => {
      const dir = await tempDir();
      const path = join(dir, "deep", "journal.jsonl");
      await appendDurableJournalSnapshot(path, journal());
      await appendDurableJournalSnapshot(path, journal({ phase: "committed" }));
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).phase).toBe("prepared");
      expect(JSON.parse(lines[1]).phase).toBe("committed");
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("appendDurableRecoveryAuditRecord", () => {
    it("appends records and preserves both kinds", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      await appendDurableRecoveryAuditRecord(path, recoveryRecord());
      await appendDurableRecoveryAuditRecord(path, recoveryRecord({ kind: "stale_lock_takeover", lock_key: "k", previous_owner_hash: "sha256:abc", outcome: "completed" }) as RepositoryRecoveryAuditRecord);
      const raw = await readFile(path, "utf8");
      const records = raw.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as { kind: string });
      expect(records.map((record) => record.kind)).toEqual(["transaction_recovery", "stale_lock_takeover"]);
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("readRecoveryLedgerFile", () => {
    it("returns an empty list when the ledger is missing", async () => {
      const dir = await tempDir();
      await expect(readRecoveryLedgerFile(join(dir, "missing.jsonl"))).resolves.toEqual([]);
      await rm(dir, { recursive: true, force: true });
    });

    it("returns all records and deduplicates by id", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      const first = recoveryRecord();
      const second = recoveryRecord({ id: "audit-2", transaction_id: "txn-2" });
      await writeFile(path, `${JSON.stringify(first)}\n${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, "utf8");
      const records = await readRecoveryLedgerFile(path);
      expect(records.map((record) => record.id)).toEqual(["audit-1", "audit-2"]);
      await rm(dir, { recursive: true, force: true });
    });

    it("tolerates a partially appended final line without a newline", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      await writeFile(path, `${JSON.stringify(recoveryRecord())}\n{"schema_version":1,"id":"un",`, "utf8");
      const records = await readRecoveryLedgerFile(path);
      expect(records).toHaveLength(1);
      await rm(dir, { recursive: true, force: true });
    });

    it("throws RECOVERY_LEDGER_CORRUPT for a corrupt middle line", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      await writeFile(path, `${JSON.stringify(recoveryRecord())}\nbroken\n${JSON.stringify(recoveryRecord({ id: "audit-2" }))}\n`, "utf8");
      await expect(readRecoveryLedgerFile(path)).rejects.toMatchObject({ code: "RECOVERY_LEDGER_CORRUPT" });
      await rm(dir, { recursive: true, force: true });
    });

    it("throws RECOVERY_LEDGER_CORRUPT when the final line is corrupt but newline-terminated", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      await writeFile(path, `${JSON.stringify(recoveryRecord())}\nbroken\n`, "utf8");
      await expect(readRecoveryLedgerFile(path)).rejects.toMatchObject({ code: "RECOVERY_LEDGER_CORRUPT" });
      await rm(dir, { recursive: true, force: true });
    });

    it("throws RECOVERY_LEDGER_CORRUPT for a valid JSON line that is not a recovery record", async () => {
      const dir = await tempDir();
      const path = join(dir, "ledger.jsonl");
      await writeFile(path, `${JSON.stringify({ kind: "unknown", id: "x" })}\n`, "utf8");
      await expect(readRecoveryLedgerFile(path)).rejects.toMatchObject({ code: "RECOVERY_LEDGER_CORRUPT" });
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("isRepositoryRecoveryAuditRecord", () => {
    it("rejects non-object values and missing common fields", () => {
      expect(isRepositoryRecoveryAuditRecord(null)).toBe(false);
      expect(isRepositoryRecoveryAuditRecord("x")).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({})).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ schema_version: 2, id: "a", kind: "transaction_recovery", project_id: "p", occurred_at: now })).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ schema_version: 1, id: "", kind: "transaction_recovery", project_id: "p", occurred_at: now })).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ schema_version: 1, id: "a", kind: "transaction_recovery", project_id: 1, occurred_at: now })).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ schema_version: 1, id: "a", kind: "transaction_recovery", project_id: "p", occurred_at: 1 })).toBe(false);
    });

    it("validates transaction_recovery fields", () => {
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord())).toBe(true);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ transaction_id: 1 }))).toBe(false);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ direction: "sideways" }))).toBe(false);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ outcome: "pending" }))).toBe(false);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ error_code: 3 }))).toBe(false);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ error_code: "EIO" }))).toBe(true);
      expect(isRepositoryRecoveryAuditRecord(recoveryRecord({ direction: "finalize", outcome: "failed" }))).toBe(true);
    });

    it("validates stale_lock_takeover fields", () => {
      const base = { schema_version: 1, id: "a", kind: "stale_lock_takeover", project_id: "p", lock_key: "key", previous_owner_hash: "sha256:abc", outcome: "completed", occurred_at: now };
      expect(isRepositoryRecoveryAuditRecord(base as RepositoryRecoveryAuditRecord)).toBe(true);
      expect(isRepositoryRecoveryAuditRecord({ ...base, lock_key: "" } as RepositoryRecoveryAuditRecord)).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ ...base, previous_owner_hash: "abc" } as RepositoryRecoveryAuditRecord)).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ ...base, previous_owner_hash: 1 } as RepositoryRecoveryAuditRecord)).toBe(false);
      expect(isRepositoryRecoveryAuditRecord({ ...base, outcome: "failed" } as RepositoryRecoveryAuditRecord)).toBe(false);
    });

    it("rejects unknown kinds", () => {
      expect(isRepositoryRecoveryAuditRecord({ schema_version: 1, id: "a", kind: "mystery", project_id: "p", occurred_at: now })).toBe(false);
    });
  });

  describe("recoveryErrorCode", () => {
    it("maps error shapes to stable codes", () => {
      expect(recoveryErrorCode(undefined)).toBeUndefined();
      expect(recoveryErrorCode(new CoreError("REVISION_CONFLICT", "boom", true))).toBe("REVISION_CONFLICT");
      expect(recoveryErrorCode(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe("ENOENT");
      expect(recoveryErrorCode(Object.assign(new Error("x"), { code: "" }))).toBe("UNKNOWN");
      expect(recoveryErrorCode(new Error("x"))).toBe("UNKNOWN");
    });
  });

  describe("readLatestJournalSnapshot", () => {
    it("returns the latest valid snapshot", async () => {
      const dir = await tempDir();
      const path = join(dir, "journal.jsonl");
      await writeFile(path, `${JSON.stringify(journal({ id: "txn-1" }))}\n${JSON.stringify(journal({ id: "txn-2", phase: "committed" }))}\n`, "utf8");
      const latest = await readLatestJournalSnapshot(path);
      expect(latest.id).toBe("txn-2");
      await rm(dir, { recursive: true, force: true });
    });

    it("tolerates a partially appended final line", async () => {
      const dir = await tempDir();
      const path = join(dir, "journal.jsonl");
      await writeFile(path, `${JSON.stringify(journal({ id: "txn-1" }))}\n{"schema_version":1,"id":"t`, "utf8");
      const latest = await readLatestJournalSnapshot(path);
      expect(latest.id).toBe("txn-1");
      await rm(dir, { recursive: true, force: true });
    });

    it("throws TRANSACTION_JOURNAL_CORRUPT for a corrupt middle line", async () => {
      const dir = await tempDir();
      const path = join(dir, "journal.jsonl");
      await writeFile(path, `${JSON.stringify(journal({ id: "txn-1" }))}\nbroken\n${JSON.stringify(journal({ id: "txn-2" }))}\n`, "utf8");
      await expect(readLatestJournalSnapshot(path)).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_CORRUPT" });
      await rm(dir, { recursive: true, force: true });
    });

    it("throws TRANSACTION_JOURNAL_CORRUPT when no complete snapshot exists", async () => {
      const dir = await tempDir();
      const path = join(dir, "journal.jsonl");
      await writeFile(path, "garbage\n", "utf8");
      await expect(readLatestJournalSnapshot(path)).rejects.toMatchObject({ code: "TRANSACTION_JOURNAL_CORRUPT" });
      await rm(dir, { recursive: true, force: true });
    });

    it("propagates missing-file errors", async () => {
      const dir = await tempDir();
      await expect(readLatestJournalSnapshot(join(dir, "missing.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("isTransactionJournal", () => {
    it("accepts a valid journal", () => {
      expect(isTransactionJournal(journal())).toBe(true);
      expect(isTransactionJournal(journal({ entries: [journalEntry({ action: "remove", staged_path: undefined, original: { kind: "file", hash: "h", size: 1 } })] }))).toBe(true);
      expect(isTransactionJournal(journal({ entries: [journalEntry({ staged_path: ".workspace/.staging-txn-1/x" })] }))).toBe(true);
    });

    it("rejects invalid top-level fields", () => {
      expect(isTransactionJournal(null)).toBe(false);
      expect(isTransactionJournal("x")).toBe(false);
      expect(isTransactionJournal({ ...journal(), schema_version: 2 })).toBe(false);
      expect(isTransactionJournal({ ...journal(), id: 1 })).toBe(false);
      expect(isTransactionJournal({ ...journal(), project_id: undefined })).toBe(false);
      expect(isTransactionJournal({ ...journal(), owner: 1 })).toBe(false);
      expect(isTransactionJournal({ ...journal(), expected_revision: "3" })).toBe(false);
      expect(isTransactionJournal({ ...journal(), entries: "nope" })).toBe(false);
      expect(isTransactionJournal({ ...journal(), phase: "bogus" })).toBe(false);
    });

    it("rejects directories that cannot be normalized", () => {
      expect(isTransactionJournal({ ...journal(), staging_directory: "C:\\outside" })).toBe(false);
      expect(isTransactionJournal({ ...journal(), transaction_directory: "/absolute" })).toBe(false);
    });

    it("rejects invalid entries", () => {
      expect(isTransactionJournal(journal({ entries: [null as never] }))).toBe(false);
      expect(isTransactionJournal(journal({ entries: [{ ...journalEntry(), relative_path: "a/../b" }] }))).toBe(false);
      expect(isTransactionJournal(journal({ entries: [{ ...journalEntry(), action: "delete" }] }))).toBe(false);
      expect(isTransactionJournal(journal({ entries: [{ ...journalEntry(), original: undefined }] }))).toBe(false);
      expect(isTransactionJournal(journal({ entries: [{ ...journalEntry(), expected: { kind: "file" } }] }))).toBe(false);
      expect(isTransactionJournal(journal({ entries: [{ ...journalEntry(), staged_path: "C:\\x" }] }))).toBe(false);
    });
  });

  describe("isTargetSnapshot", () => {
    it("accepts every valid kind", () => {
      expect(isTargetSnapshot({ kind: "missing" })).toBe(true);
      expect(isTargetSnapshot({ kind: "file", hash: "h", size: 1 })).toBe(true);
      expect(isTargetSnapshot({ kind: "directory", size: 0 })).toBe(true);
      expect(isTargetSnapshot({ kind: "other" })).toBe(true);
    });

    it("rejects invalid shapes", () => {
      expect(isTargetSnapshot(null)).toBe(false);
      expect(isTargetSnapshot({ kind: "file" })).toBe(false);
      expect(isTargetSnapshot({ kind: "file", hash: "h" })).toBe(false);
      expect(isTargetSnapshot({ kind: "missing", hash: "h" })).toBe(false);
      expect(isTargetSnapshot({ kind: "directory", size: "0" })).toBe(false);
      expect(isTargetSnapshot({ kind: "bogus" })).toBe(false);
    });
  });

  describe("inspectTarget", () => {
    it("inspects files, directories and missing targets", async () => {
      const dir = await tempDir();
      const filePath = join(dir, "file.txt");
      await writeFile(filePath, "hello", "utf8");
      const file = await inspectTarget(filePath);
      expect(file.kind).toBe("file");
      expect(file.size).toBe(5);
      expect(file.hash).toBe(contentHash(Buffer.from("hello", "utf8")));
      const directory = await inspectTarget(dir);
      expect(directory.kind).toBe("directory");
      const missing = await inspectTarget(join(dir, "nope.txt"));
      expect(missing).toEqual({ kind: "missing" });
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("snapshotForContent and snapshotsEqual", () => {
    it("hashes strings and byte arrays identically", () => {
      const fromString = snapshotForContent("hello");
      const fromBytes = snapshotForContent(new TextEncoder().encode("hello"));
      expect(fromString).toEqual(fromBytes);
      expect(fromString.kind).toBe("file");
      expect(fromString.size).toBe(5);
    });

    it("compares snapshots across kinds and content", () => {
      const file = { kind: "file" as const, hash: "h", size: 1 };
      expect(snapshotsEqual(file, { kind: "file", hash: "h", size: 1 })).toBe(true);
      expect(snapshotsEqual(file, { kind: "file", hash: "h", size: 2 })).toBe(false);
      expect(snapshotsEqual(file, { kind: "file", hash: "g", size: 1 })).toBe(false);
      expect(snapshotsEqual(file, { kind: "missing" })).toBe(false);
      expect(snapshotsEqual({ kind: "missing" }, { kind: "missing" })).toBe(true);
      expect(snapshotsEqual({ kind: "directory", size: 0 }, { kind: "directory", size: 0 })).toBe(true);
    });
  });

  describe("pathExists and removePath", () => {
    it("detects existence and removes files", async () => {
      const dir = await tempDir();
      const path = join(dir, "target.txt");
      await writeFile(path, "x", "utf8");
      expect(await pathExists(path)).toBe(true);
      expect(await pathExists(join(dir, "nope.txt"))).toBe(false);
      await removePath(path);
      expect(await pathExists(path)).toBe(false);
      await rm(dir, { recursive: true, force: true });
    });
  });
});
