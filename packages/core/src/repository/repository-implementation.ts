import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { FileBlobStore, MemoryBlobStore, type BlobStore } from "../blob-store.js";
import { CoreError, canonicalJson, contentHash } from "../core-utilities.js";
import { cloneState, createProjectState, validateState, type ArtifactRecord, type ProjectState } from "../project-state.js";
import { publishedCardExportPath, publishedCardPngExportPath } from "../export-paths.js";
import { parseArtifactValue } from "../project-projection.js";
import type {
  FileProjectRepositoryOptions,
  ProjectRepository,
  RepairAction,
  RepairPlanItem,
  RepairInspection,
  RepairReport,
  RepositoryFailureInjection,
  RepositoryFailureInjectionPoint,
  RepositoryFile,
  RepositoryLockOptions,
  RepositoryRecoveryAuditRecord,
  RepositoryStaleLockTakeoverAuditRecord,
  RepositoryTransactionCommit,
  RepositoryTransactionRecoveryAuditRecord,
  RepositoryWriteSet,
  RepositoryTransactionWork,
} from "./project-repository.js";
import {
  appendDurableJournalSnapshot,
  appendDurableRecoveryAuditRecord,
  inspectTarget,
  pathExists,
  readLatestJournalSnapshot,
  readLockRecordFromContent,
  readRecoveryLedgerFile,
  recoveryErrorCode,
  removePath,
  snapshotForContent,
  snapshotsEqual,
  type LockRecord,
  type RepositoryTargetSnapshot,
  type RepositoryTransactionJournal,
  type RepositoryTransactionJournalEntry,
} from "./transaction-journal.js";
import {
  artifactFilePath,
  assertTransactionTargetPath,
  characterFolderById,
  characterFolderName,
  humanReadableJsonFile,
  incrementalMaterializationWriteSet,
  isPublicArtifactKind,
  latestStateTimestamp,
  materializedArtifactContent,
  moveToBackup,
  nonEmptyString,
  normalizeRepositoryPath,
  renameWithRetry,
  safeSegment,
  syncDirectory,
  writeStagedFile,
} from "./materialization.js";

interface LockLeaseContext {
  readonly owner: string;
  readonly lock_files: readonly string[];
  readonly lease_ms: number;
  readonly heartbeat_ms: number;
  heartbeat_timer?: ReturnType<typeof setInterval>;
  heartbeat_tail: Promise<void>;
  lost?: CoreError;
}

const DEFAULT_LOCK_OPTIONS: Required<RepositoryLockOptions> = {
  lease_ms: 30_000,
  heartbeat_ms: 10_000,
  timeout_ms: 10_000,
  poll_ms: 25,
};

export class MemoryProjectRepository implements ProjectRepository {
  private state: ProjectState;
  private queue: Promise<void> = Promise.resolve();
  private readonly blobs = new MemoryBlobStore();

  constructor(projectId: string, initial?: ProjectState) {
    this.state = validateState(cloneState(initial ?? createProjectState(projectId)));
  }

  async readBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(hash);
  }

  async writeBlob(hash: string, content: Uint8Array): Promise<void> {
    await this.blobs.put(hash, content);
  }

  async inspectRepair(): Promise<RepairInspection> {
    const emptyPlan: RepairInspection = { plan_hash: contentHash("[]"), items: [] };
    return emptyPlan;
  }

  async runRepair(planHash?: string): Promise<RepairReport> {
    const inspection = await this.inspectRepair();
    if (planHash !== undefined && planHash !== inspection.plan_hash) {
      throw new CoreError("REPAIR_PLAN_STALE", "The repair plan changed since preview; run the preview again before repairing.", true);
    }
    return { plan_hash: inspection.plan_hash, actions: [] };
  }

  async read(): Promise<ProjectState> {
    await this.queue;
    return cloneState(this.state);
  }

  async transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>> {
    let result!: RepositoryTransactionCommit<T>;
    const previous = this.queue;
    const run = previous.then(async () => {
      if (this.state.revision !== expectedRevision) {
        throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${this.state.revision}`, true);
      }
      const resolved = await work(cloneState(this.state));
      const next = validateState(resolved.state);
      const blobWrites = normalizeBlobWrites(resolved.writeSet);
      next.revision = this.state.revision + 1;
      for (const [hash, content] of blobWrites) await this.blobs.put(hash, content);
      this.state = cloneState(next);
      result = { revision: next.revision, state: cloneState(next), value: resolved.value };
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  async commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState> {
    const result = await this.transaction(expectedRevision, (state) => ({ state: mutate(state), value: undefined, ...(writeSet === undefined ? {} : { writeSet }) }));
    return result.state;
  }
}

export class FileProjectRepository implements ProjectRepository {
  private stateFile: string;
  private lockFile: string;
  private projectIdValue: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly projectRoot: string;
  private readonly layout: "legacy" | "project";
  private readonly materializeEnabled: boolean;
  private readonly lockOptions: Required<RepositoryLockOptions>;
  private failureInjection: RepositoryFailureInjection | undefined;
  private activeLock: LockLeaseContext | undefined;
  private blobs: BlobStore;

  constructor(projectRoot: string, projectId: string, options: FileProjectRepositoryOptions = {}) {
    this.projectRoot = projectRoot;
    this.projectIdValue = projectId;
    this.layout = options.layout ?? "legacy";
    this.materializeEnabled = options.materialize ?? false;
    this.lockOptions = { ...DEFAULT_LOCK_OPTIONS, ...options.lock };
    this.failureInjection = options.failure_injection;
    this.stateFile = this.stateFileFor(projectId);
    this.lockFile = this.lockFileFor(projectId);
    this.blobs = new FileBlobStore(path.join(this.projectRoot, projectId, ".workspace", "blobs"));
  }

  get projectId(): string {
    return this.projectIdValue;
  }

  get projectDirectory(): string {
    return path.join(this.projectRoot, this.projectIdValue);
  }

  /** Read the append-only repository recovery ledger without taking a project lock. */
  async readRecoveryLedger(): Promise<readonly RepositoryRecoveryAuditRecord[]> {
    return readRecoveryLedgerFile(this.recoveryLedgerFile());
  }

  /** Move a temporary project directory without changing the repository instance. */
  async relocate(newProjectId: string): Promise<void> {
    const normalized = newProjectId.trim();
    if (normalized.length === 0 || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
      throw new CoreError("PROJECT_ID_INVALID", "project id must be a single safe path segment", true);
    }
    const previous = this.queue;
    const run = previous.then(async () => {
      if (normalized === this.projectIdValue) return;
      const targetDirectory = path.join(this.projectRoot, normalized);
      const sourceLockFile = this.lockFile;
      const targetLockFile = this.lockFileFor(normalized);
      await this.withLockFiles([sourceLockFile, targetLockFile], async () => {
        await this.recoverIncompleteTransactions();
        await mkdir(this.projectRoot, { recursive: true });
        await this.assertLockOwner();
        await renameWithRetry(this.projectDirectory, targetDirectory);
      });
      this.projectIdValue = normalized;
      this.stateFile = this.stateFileFor(normalized);
      this.lockFile = this.lockFileFor(normalized);
      this.blobs = new FileBlobStore(path.join(this.projectRoot, normalized, ".workspace", "blobs"));
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
  }

  async readBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(hash);
  }

  async writeBlob(hash: string, content: Uint8Array): Promise<void> {
    await this.blobs.put(hash, content);
  }

  async inspectRepair(): Promise<RepairInspection> {
    if (this.layout !== "project") return { plan_hash: contentHash("[]"), items: [] };
    const items: RepairPlanItem[] = [];
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const proposalsPath = path.join(this.projectDirectory, "proposals");
    for (const entry of [legacyStatePath, proposalsPath]) {
      try {
        await stat(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        continue;
      }
      items.push({
        id: contentHash(entry).slice(0, 12),
        source: path.basename(entry),
        target: "",
        kind: "legacy_file",
        reason: entry === legacyStatePath
          ? "專案根目錄的舊版 state.json 已由 .workspace/state.json 取代。"
          : "專案根目錄的舊版 proposals/ 目錄已由 .workspace 資料結構取代。",
        recoverable: true,
      });
    }
    const backupsPath = path.join(this.projectDirectory, ".workspace", "legacy-layout");
    try {
      const entries = await readdir(backupsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        let hasMarker = true;
        try {
          await stat(path.join(backupsPath, entry.name, "migration.json"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          hasMarker = false;
        }
        if (hasMarker) continue;
        items.push({
          id: contentHash(entry.name).slice(0, 12),
          source: path.join(".workspace", "legacy-layout", entry.name),
          target: "",
          kind: "orphan_backup",
          reason: "備份目錄缺少 migration.json 標記，無法確認來源與完成狀態。",
          recoverable: true,
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const sources = items.map((item) => item.source);
    const plan_hash = contentHash(sources.length === 0 ? "[]" : sources.join("\n"));
    const migrationId = `repair-${contentHash(`repair:${this.projectIdValue}:${sources.join("\n")}`).slice(0, 12)}`;
    return {
      plan_hash,
      items: items.map((item) => ({ ...item, target: path.join(".workspace", "legacy-layout", migrationId, path.basename(item.source)) })),
    };
  }

  async runRepair(planHash?: string): Promise<RepairReport> {
    const inspection = await this.inspectRepair();
    if (planHash !== undefined && planHash !== inspection.plan_hash) {
      throw new CoreError("REPAIR_PLAN_STALE", "The repair plan changed since preview; run the preview again before repairing.", true);
    }
    const actions: RepairAction[] = [];
    for (const item of inspection.items) {
      const source = path.join(this.projectDirectory, item.source);
      const target = path.join(this.projectDirectory, item.target);
      let exists = true;
      try {
        await stat(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        exists = false;
      }
      if (!exists) {
        actions.push({ id: item.id, source: item.source, target: item.target, kind: item.kind, reason: item.reason, recoverable: item.recoverable, outcome: "missing" });
        continue;
      }
      let alreadyArchived = true;
      try {
        await stat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        alreadyArchived = false;
      }
      if (alreadyArchived) {
        actions.push({ id: item.id, source: item.source, target: item.target, kind: item.kind, reason: item.reason, recoverable: item.recoverable, outcome: "skipped" });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await renameWithRetry(source, target);
      actions.push({ id: item.id, source: item.source, target: item.target, kind: item.kind, reason: item.reason, recoverable: item.recoverable, outcome: "archived" });
    }
    const archivedActions = actions.filter((action) => action.outcome === "archived");
    const migrationDirectory = archivedActions.length === 0 ? undefined : path.dirname(path.join(this.projectDirectory, archivedActions[0]!.target));
    if (migrationDirectory !== undefined) {
      const migrationId = path.basename(migrationDirectory);
      const markerPath = path.join(migrationDirectory, "migration.json");
      try {
        await stat(markerPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeFile(markerPath, `${canonicalJson({
          schema_version: 1,
          migration_id: migrationId,
          project_id: this.projectIdValue,
          archived_entries: archivedActions.map((action) => action.source),
          completed_at: new Date().toISOString(),
        })}\n`, "utf8");
      }
    }
    return { plan_hash: inspection.plan_hash, actions };
  }

  private stateFileFor(projectId: string): string {
    return this.layout === "project"
      ? path.join(this.projectRoot, projectId, ".workspace", "state.json")
      : path.join(this.projectRoot, projectId, "state.json");
  }

  private lockFileFor(projectId: string): string {
    const lockKey = contentHash(`${path.resolve(this.projectRoot)}\0${projectId}`);
    return path.join(tmpdir(), "st-workspace-v3-locks", `${lockKey}.lock`);
  }

  private recoveryLedgerFile(): string {
    return path.join(this.projectDirectory, ".workspace", "recovery-ledger.jsonl");
  }

  async read(): Promise<ProjectState> {
    await this.queue;
    return this.withProjectLock(async () => {
      await this.recoverIncompleteTransactions();
      let state: ProjectState;
      try {
        const raw = await readFile(this.stateFile, "utf8");
        state = validateState(JSON.parse(raw) as ProjectState);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const migrated = await this.migrateLegacyLayoutIfNeeded();
        if (migrated !== undefined) return migrated;
        const initial = createProjectState(this.projectIdValue);
        await this.writeTransactional(initial);
        return initial;
      }
      if (this.layout === "project") await this.archiveExistingLegacyLayout(state);
      if (this.materializeEnabled) await this.reconcileMaterializedFiles(state);
      return state;
    });
  }

  async transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>> {
    let result!: RepositoryTransactionCommit<T>;
    const previous = this.queue;
    const run = previous.then(async () => {
      await this.withProjectLock(async () => {
        await this.recoverIncompleteTransactions();
        const current = await this.readUnlocked();
        if (current.revision !== expectedRevision) {
          throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${current.revision}`, true);
        }
        const resolved = await work(cloneState(current));
        const next = validateState(resolved.state);
        next.revision = current.revision + 1;
        await this.writeTransactional(next, resolved.writeSet, current);
        result = { revision: next.revision, state: cloneState(next), value: resolved.value };
      });
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  async commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState> {
    const result = await this.transaction(expectedRevision, (state) => ({ state: mutate(state), value: undefined, ...(writeSet === undefined ? {} : { writeSet }) }));
    return result.state;
  }

  private async readUnlocked(): Promise<ProjectState> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      return validateState(JSON.parse(raw) as ProjectState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const migrated = await this.migrateLegacyLayoutIfNeeded();
      if (migrated !== undefined) return migrated;
      return createProjectState(this.projectIdValue);
    }
  }

  /**
   * Import the old root-state/proposals/exports layout without deleting user data.
   * The new state and semantic files are written first; legacy entries are then
   * moved into a timestamped, read-only-by-convention recovery folder.
   */
  private async migrateLegacyLayoutIfNeeded(): Promise<ProjectState | undefined> {
    if (this.layout !== "project") return undefined;
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const legacyEntries = [legacyStatePath, path.join(this.projectDirectory, "proposals"), path.join(this.projectDirectory, "exports")];
    const present: string[] = [];
    for (const entry of legacyEntries) {
      try {
        await stat(entry);
        present.push(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (present.length === 0) return undefined;

    let migratedState: ProjectState;
    if (present.includes(legacyStatePath)) {
      const raw = await readFile(legacyStatePath, "utf8");
      migratedState = validateState(JSON.parse(raw) as ProjectState);
    } else {
      migratedState = createProjectState(this.projectIdValue);
    }
    const migrationId = `migration-${contentHash(present.join("\n") + canonicalJson(migratedState)).slice(0, 16)}`;
    const backupDirectory = path.join(this.projectDirectory, ".workspace", "legacy-layout", migrationId);

    // This write is the staging/verification boundary. If it fails, legacy
    // files are untouched and the caller receives the original error.
    await this.writeTransactional(migratedState);
    await mkdir(backupDirectory, { recursive: true });
    const exportsDirectory = path.join(this.projectDirectory, "exports");
    const latest = migratedState.publishes.at(-1);
    const keep = new Set<string>();
    if (latest !== undefined) {
      keep.add(path.basename(latest.export_json_path ?? publishedCardExportPath(migratedState.project_name, migratedState.project_id, migratedState.artifacts)));
      if (latest.png_base64 !== undefined || latest.png_ref !== undefined) keep.add(path.basename(latest.export_png_path ?? publishedCardPngExportPath(migratedState.project_name, migratedState.project_id, migratedState.artifacts)));
    }
    for (const entry of present) {
      if (entry === exportsDirectory) {
        const files = await readdir(entry, { withFileTypes: true });
        for (const file of files) {
          if (keep.has(file.name)) continue;
          const target = path.join(backupDirectory, "exports", file.name);
          await mkdir(path.dirname(target), { recursive: true });
          await renameWithRetry(path.join(entry, file.name), target);
        }
        continue;
      }
      const target = path.join(backupDirectory, path.basename(entry));
      await renameWithRetry(entry, target);
    }
    await writeFile(path.join(backupDirectory, "migration.json"), `${canonicalJson({
      schema_version: 1,
      migration_id: migrationId,
      project_id: migratedState.project_id,
      archived_entries: present.map((entry) => path.basename(entry)),
      completed_at: new Date().toISOString(),
    })}\n`, "utf8");
    return migratedState;
  }

  /** Archive legacy public entries even when the new `.workspace/state.json` already exists. */
  private async archiveExistingLegacyLayout(state: ProjectState): Promise<void> {
    const candidates: string[] = [];
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const proposalsPath = path.join(this.projectDirectory, "proposals");
    for (const entry of [legacyStatePath, proposalsPath]) {
      try {
        await stat(entry);
        candidates.push(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    const exportsDirectory = path.join(this.projectDirectory, "exports");
    try {
      const entries = await readdir(exportsDirectory, { withFileTypes: true });
      const latest = state.publishes.at(-1);
      const keep = new Set<string>();
      if (latest !== undefined) {
        keep.add(path.basename(latest.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts)));
        if (latest.png_base64 !== undefined || latest.png_ref !== undefined) keep.add(path.basename(latest.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts)));
      }
      for (const entry of entries) {
        if (!keep.has(entry.name)) candidates.push(path.join(exportsDirectory, entry.name));
      }
    } catch (error) {
      if (!( ["ENOENT", "ENOTDIR"] as string[]).includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    if (candidates.length === 0) return;

    const migrationId = `migration-${contentHash(`existing:${state.project_id}:${state.revision}:${candidates.join("\n")}`).slice(0, 16)}`;
    const backupDirectory = path.join(this.projectDirectory, ".workspace", "legacy-layout", migrationId);
    await mkdir(backupDirectory, { recursive: true });
    for (const entry of candidates) {
      await renameWithRetry(entry, path.join(backupDirectory, path.basename(entry)));
    }
    await writeFile(path.join(backupDirectory, "migration.json"), `${canonicalJson({
      schema_version: 1,
      migration_id: migrationId,
      project_id: state.project_id,
      archived_entries: candidates.map((entry) => path.basename(entry)),
      completed_at: new Date().toISOString(),
    })}\n`, "utf8");
  }

  private async reconcileMaterializedFiles(state: ProjectState): Promise<void> {
    const expected = new Map<string, RepositoryFile>();
    for (const file of await this.materializedFiles(state)) expected.set(normalizeRepositoryPath(file.path), file);
    for (const [relativePath, file] of expected) {
      const targetPath = path.join(this.projectDirectory, relativePath);
      const expectedContent = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content);
      try {
        const actualContent = await readFile(targetPath);
        if (actualContent.equals(expectedContent)) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.writeTransactional(state);
      return;
    }
  }

  private async writeTransactional(state: ProjectState, writeSet: RepositoryWriteSet = {}, previousState?: ProjectState): Promise<void> {
    await mkdir(this.projectDirectory, { recursive: true });
    const transactionId = `transaction-${randomUUID()}`;
    const staging = path.join(this.projectDirectory, ".workspace", `.staging-${transactionId}`);
    const transactionDirectory = path.join(this.projectDirectory, ".workspace", "transactions", transactionId);
    const journalPath = path.join(transactionDirectory, "journal.jsonl");
    const blobWrites = normalizeBlobWrites(writeSet);
    const files = new Map<string, Uint8Array | string>();
    files.set(normalizeRepositoryPath(path.relative(this.projectDirectory, this.stateFile)), `${canonicalJson(state)}\n`);
    const needsInitialMaterialization = previousState === undefined || !(await pathExists(this.stateFile));
    const previousPublishPaths = previousState === undefined ? undefined : publishMaterializationPaths(previousState);
    const currentPublishPaths = publishMaterializationPaths(state);
    const materializedWriteSet = this.materializeEnabled
      ? needsInitialMaterialization
        ? { files: await this.materializedFiles(state), remove: [] as readonly string[] }
        : await incrementalMaterializationWriteSet(previousState!, state, this.projectDirectory, {
          readBlob: async (hash) => blobWrites.get(hash) ?? this.blobs.get(hash),
          publish_paths: {
            ...(previousPublishPaths === undefined ? {} : { previous: previousPublishPaths }),
            ...(currentPublishPaths === undefined ? {} : { current: currentPublishPaths }),
          },
        })
      : { files: [], remove: [] as readonly string[] };
    for (const file of materializedWriteSet.files ?? []) files.set(normalizeRepositoryPath(file.path), file.content);
    for (const file of writeSet.files ?? []) files.set(normalizeRepositoryPath(file.path), file.content);
    for (const [hash, content] of blobWrites) files.set(blobTargetPath(hash), content);

    const entries: RepositoryTransactionJournalEntry[] = [];
    let entryIndex = 0;
    for (const [relativePath, content] of files) {
      const normalized = normalizeRepositoryPath(relativePath);
      assertTransactionTargetPath(normalized);
      const stagedPath = path.join(staging, normalized);
      const targetPath = path.join(this.projectDirectory, normalized);
      const backupPath = path.join(transactionDirectory, "backups", `${entryIndex}-${safeSegment(path.basename(normalized))}`);
      entries.push({
        action: "write",
        relative_path: normalized,
        target_path: normalized,
        staged_path: normalizeRepositoryPath(path.relative(this.projectDirectory, stagedPath)),
        backup_path: normalizeRepositoryPath(path.relative(this.projectDirectory, backupPath)),
        original: await inspectTarget(targetPath),
        expected: snapshotForContent(content),
        phase: "planned",
        backup_created: false,
        installed: false,
      });
      entryIndex += 1;
    }
    for (const relativePath of [...new Set([...(materializedWriteSet.remove ?? []), ...(writeSet.remove ?? [])])].map(normalizeRepositoryPath)) {
      assertTransactionTargetPath(relativePath);
      const targetPath = path.join(this.projectDirectory, relativePath);
      const backupPath = path.join(transactionDirectory, "backups", `${entryIndex}-${safeSegment(path.basename(relativePath))}`);
      entries.push({
        action: "remove",
        relative_path: relativePath,
        target_path: relativePath,
        backup_path: normalizeRepositoryPath(path.relative(this.projectDirectory, backupPath)),
        original: await inspectTarget(targetPath),
        expected: { kind: "missing" },
        phase: "planned",
        backup_created: false,
        installed: false,
      });
      entryIndex += 1;
    }

    const now = new Date().toISOString();
    const journal: RepositoryTransactionJournal = {
      schema_version: 1,
      id: transactionId,
      project_id: this.projectIdValue,
      owner: this.activeLock?.owner ?? "internal",
      expected_revision: state.revision,
      staging_directory: normalizeRepositoryPath(path.relative(this.projectDirectory, staging)),
      transaction_directory: normalizeRepositoryPath(path.relative(this.projectDirectory, transactionDirectory)),
      entries,
      phase: "prepared",
      created_at: now,
      updated_at: now,
    };
    let journalPersisted = false;
    let committed = false;
    let preserveArtifacts = false;
    try {
      await mkdir(staging, { recursive: true });
      await mkdir(path.join(transactionDirectory, "backups"), { recursive: true });
      await this.persistJournal(journalPath, journal);
      journalPersisted = true;
      this.injectFailure("after_journal");

      for (const entry of journal.entries) {
        if (entry.action !== "write" || entry.staged_path === undefined) continue;
        await this.assertLockOwner();
        const stagedPath = path.join(this.projectDirectory, entry.staged_path);
        const content = files.get(entry.relative_path);
        if (content === undefined) throw new CoreError("TRANSACTION_PLAN_INVALID", `Missing staged content for ${entry.relative_path}`);
        await mkdir(path.dirname(stagedPath), { recursive: true });
        await writeStagedFile(stagedPath, content);
      }
      journal.phase = "applying";
      await this.persistJournal(journalPath, journal);

      for (const entry of journal.entries) {
        await this.assertLockOwner();
        const targetPath = path.join(this.projectDirectory, entry.target_path);
        const backupPath = path.join(this.projectDirectory, entry.backup_path);
        await mkdir(path.dirname(targetPath), { recursive: true });
        entry.phase = "backing_up";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("before_backup");
        const backupCreated = await moveToBackup(targetPath, backupPath);
        entry.backup_created = backupCreated;
        if (backupCreated && entry.original.kind === "missing") entry.original = await inspectTarget(backupPath);
        entry.phase = "backed_up";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("after_backup", entry.relative_path);

        if (entry.action === "remove") {
          entry.installed = true;
          entry.phase = "removed";
          await this.persistJournal(journalPath, journal);
          continue;
        }

        if (entry.staged_path === undefined) throw new CoreError("TRANSACTION_PLAN_INVALID", `Missing staged path for ${entry.relative_path}`);
        const stagedPath = path.join(this.projectDirectory, entry.staged_path);
        entry.phase = "installing";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("before_install", entry.relative_path);
        await renameWithRetry(stagedPath, targetPath);
        await syncDirectory(path.dirname(targetPath));
        entry.installed = true;
        entry.phase = "installed";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("after_install", entry.relative_path);
      }

      journal.phase = "committed";
      await this.persistJournal(journalPath, journal);
      committed = true;
      await this.cleanupCommittedJournal(journal, journalPath);
    } catch (error) {
      if (error instanceof RepositoryCrashInjection) {
        preserveArtifacts = true;
        throw error;
      }
      if (committed || error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") {
        preserveArtifacts = true;
        throw error;
      }
      if (journalPersisted) {
        try {
          await this.rollbackJournal(journal, journalPath);
        } catch (recoveryError) {
          preserveArtifacts = true;
          throw new CoreError("TRANSACTION_RECOVERY_REQUIRED", `Transaction ${transactionId} could not be rolled back safely`, true, { cause: recoveryError, transaction_id: transactionId });
        }
      }
      throw error;
    } finally {
      if (!preserveArtifacts) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async persistJournal(journalPath: string, journal: RepositoryTransactionJournal): Promise<void> {
    await this.assertLockOwner();
    journal.updated_at = new Date().toISOString();
    await appendDurableJournalSnapshot(journalPath, journal);
  }

  private async recoverIncompleteTransactions(): Promise<void> {
    const transactionsRoot = path.join(this.projectDirectory, ".workspace", "transactions");
    let entries;
    try {
      entries = await readdir(transactionsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transactionDirectory = path.join(transactionsRoot, entry.name);
      const journalPath = path.join(transactionDirectory, "journal.jsonl");
      let journal: RepositoryTransactionJournal | undefined;
      try {
        journal = await readLatestJournalSnapshot(journalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const leftovers = await readdir(transactionDirectory);
          if (leftovers.length === 0) {
            await rm(transactionDirectory, { recursive: true, force: true });
            continue;
          }
        }
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Cannot determine the state of transaction ${entry.name}`, true, { cause: error, transaction_id: entry.name });
      }
      if (journal === undefined) throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Transaction ${entry.name} has no durable journal`, true, { transaction_id: entry.name });
      if (journal.project_id !== this.projectIdValue || journal.id !== entry.name) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Transaction ${entry.name} does not belong to this project`, true, { transaction_id: entry.name });
      }
      const direction: RepositoryTransactionRecoveryAuditRecord["direction"] = journal.phase === "committed" ? "finalize" : "rollback";
      let completedAuditRecorded = false;
      try {
        if (direction === "finalize") await this.finalizeCommittedJournal(journal, journalPath, false);
        else await this.rollbackJournal(journal, journalPath, false);
        await this.appendTransactionRecoveryAudit(journal, direction, "completed");
        completedAuditRecorded = true;
        if (direction === "finalize") await this.cleanupCommittedJournal(journal, journalPath);
        else await this.cleanupRecoveredRollback(journal, journalPath);
      } catch (error) {
        if (!completedAuditRecorded) {
          try {
            await this.appendTransactionRecoveryAudit(journal, direction, "failed", error);
          } catch (auditError) {
            throw new CoreError("RECOVERY_AUDIT_WRITE_FAILED", `Could not audit recovery of transaction ${journal.id}`, true, {
              audit_error: auditError,
              recovery_error: error,
              transaction_id: journal.id,
            });
          }
        }
        throw error;
      }
    }
  }

  private async rollbackJournal(journal: RepositoryTransactionJournal, journalPath: string, cleanup = true): Promise<void> {
    for (const entry of [...journal.entries].reverse()) {
      await this.assertLockOwner();
      const targetPath = path.join(this.projectDirectory, entry.target_path);
      const backupPath = path.join(this.projectDirectory, entry.backup_path);
      if (await pathExists(backupPath)) {
        await removePath(targetPath);
        await renameWithRetry(backupPath, targetPath);
        await syncDirectory(path.dirname(targetPath));
        entry.backup_created = false;
        entry.installed = false;
        entry.phase = "planned";
        await this.persistJournal(journalPath, journal);
      } else {
        const actual = await inspectTarget(targetPath);
        if (snapshotsEqual(actual, entry.original)) {
          entry.installed = false;
          entry.phase = "planned";
          await this.persistJournal(journalPath, journal);
        } else if (entry.original.kind === "missing" && snapshotsEqual(actual, entry.expected)) {
          await removePath(targetPath);
          entry.installed = false;
          entry.phase = "planned";
          await this.persistJournal(journalPath, journal);
        } else {
          throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Cannot restore ${entry.relative_path} without its original backup`, true, { path: entry.relative_path, transaction_id: journal.id });
        }
      }
    }
    for (const entry of journal.entries) {
      const actual = await inspectTarget(path.join(this.projectDirectory, entry.target_path));
      if (!snapshotsEqual(actual, entry.original)) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Rollback verification failed for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
      }
    }
    if (cleanup) {
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    }
  }

  private async finalizeCommittedJournal(journal: RepositoryTransactionJournal, journalPath: string, cleanup = true): Promise<void> {
    for (const entry of journal.entries) {
      await this.assertLockOwner();
      const targetPath = path.join(this.projectDirectory, entry.target_path);
      if (entry.action === "remove") {
        await removePath(targetPath);
        continue;
      }
      const expected = await inspectTarget(targetPath);
      if (!snapshotsEqual(expected, entry.expected)) {
        if (entry.staged_path === undefined || !(await pathExists(path.join(this.projectDirectory, entry.staged_path)))) {
          throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Committed transaction is missing the new content for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
        }
        await removePath(targetPath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await renameWithRetry(path.join(this.projectDirectory, entry.staged_path), targetPath);
        await syncDirectory(path.dirname(targetPath));
      }
      const verified = await inspectTarget(targetPath);
      if (!snapshotsEqual(verified, entry.expected)) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Commit verification failed for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
      }
    }
    if (cleanup) await this.cleanupCommittedJournal(journal, journalPath);
  }

  private async cleanupRecoveredRollback(journal: RepositoryTransactionJournal, journalPath: string): Promise<void> {
    try {
      await this.assertLockOwner();
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    } catch (error) {
      if (error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") throw error;
      // The old version has already been verified and its audit record is
      // durable. Leftovers are safe to retry on the next repository read.
    }
  }

  private async appendTransactionRecoveryAudit(
    journal: RepositoryTransactionJournal,
    direction: RepositoryTransactionRecoveryAuditRecord["direction"],
    outcome: RepositoryTransactionRecoveryAuditRecord["outcome"],
    error?: unknown,
  ): Promise<void> {
    const errorCode = recoveryErrorCode(error);
    await this.appendRecoveryAudit({
      schema_version: 1,
      id: `transaction-recovery-${contentHash(`${this.projectIdValue}\0${journal.id}\0${direction}\0${outcome}`)}`,
      kind: "transaction_recovery",
      project_id: this.projectIdValue,
      transaction_id: journal.id,
      direction,
      outcome,
      occurred_at: new Date().toISOString(),
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
    });
  }

  private async appendStaleLockTakeoverAudit(event: ExpiredLockTakeover): Promise<void> {
    const lockKey = path.basename(event.lock_file, ".lock");
    const previousOwnerHash = `sha256:${contentHash(event.previous_owner)}`;
    await this.appendRecoveryAudit({
      schema_version: 1,
      id: `stale-lock-takeover-${contentHash(`${this.projectIdValue}\0${lockKey}\0${previousOwnerHash}`)}`,
      kind: "stale_lock_takeover",
      project_id: this.projectIdValue,
      lock_key: lockKey,
      previous_owner_hash: previousOwnerHash,
      outcome: "completed",
      occurred_at: event.occurred_at,
    });
  }

  private async appendRecoveryAudit(record: RepositoryRecoveryAuditRecord): Promise<void> {
    const ledgerFile = this.recoveryLedgerFile();
    const existing = await readRecoveryLedgerFile(ledgerFile);
    if (existing.some((candidate) => candidate.id === record.id)) return;
    await appendDurableRecoveryAuditRecord(ledgerFile, record);
  }

  private async cleanupCommittedJournal(journal: RepositoryTransactionJournal, journalPath: string): Promise<void> {
    try {
      await this.assertLockOwner();
      this.injectFailure("before_cleanup");
      for (const entry of journal.entries) {
        await removePath(path.join(this.projectDirectory, entry.backup_path));
      }
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      this.injectFailure("after_cleanup");
      await rm(journalPath, { force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    } catch (error) {
      if (error instanceof RepositoryCrashInjection || error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") throw error;
      // The commit marker is already durable. A failed cleanup is safe to retry
      // on the next read, so never roll a committed transaction back.
    }
  }

  private async materializedFiles(state: ProjectState): Promise<RepositoryFile[]> {
    const files: RepositoryFile[] = [];
    const characterFolders = characterFolderById(state.artifacts);
    const worldArtifactCounts = new Map<string, number>();
    for (const artifact of state.artifacts) {
      if (artifact.kind !== "world_lore") continue;
      worldArtifactCounts.set(artifact.name, (worldArtifactCounts.get(artifact.name) ?? 0) + 1);
    }
    files.push({ path: "project.json", content: canonicalJson({
      project_id: state.project_id,
      project_name: state.project_name,
      project_slug: state.project_slug,
      status: state.project_status,
      revision: state.revision,
      updated_at: latestStateTimestamp(state),
    }) + "\n" });
    files.push({ path: ".workspace/interview.json", content: canonicalJson(state.interview) + "\n" });
    files.push({ path: ".workspace/blueprint-prechecks.json", content: canonicalJson(state.blueprint_prechecks) + "\n" });
    files.push({ path: ".workspace/adaptation-decisions.json", content: canonicalJson(state.adaptation_decisions) + "\n" });
    files.push({ path: ".workspace/quality-profile.json", content: canonicalJson(state.quality_profile) + "\n" });
    files.push({ path: ".workspace/workflow.json", content: canonicalJson({
      project_id: state.project_id,
      project_name: state.project_name,
      status: state.project_status,
      revision: state.revision,
      operations: state.operations,
      audit: state.audit,
      builds: state.builds,
      publishes: state.publishes,
      imports: state.imports,
      blueprint_prechecks: state.blueprint_prechecks,
       adaptation_decisions: state.adaptation_decisions,
       fact_review_passes: state.fact_review_passes,
       fact_review_runs: state.fact_review_runs,
       fact_review_decisions: state.fact_review_decisions,
    }) + "\n" });
    files.push({ path: "sources/manifest.json", content: canonicalJson({ candidates: state.candidates, sources: state.sources }) + "\n" });
    files.push({ path: "knowledge/chunks.json", content: canonicalJson(state.knowledge_chunks) + "\n" });
    files.push({ path: "facts/register.json", content: canonicalJson({ facts: state.facts, issues: state.issues, review_passes: state.fact_review_passes, review_runs: state.fact_review_runs, review_decisions: state.fact_review_decisions }) + "\n" });
    files.push({ path: ".workspace/coverage-requirements.json", content: canonicalJson({ requirement_sets: state.coverage_requirement_sets }) + "\n" });
    files.push({ path: ".workspace/coverage-assessments.json", content: canonicalJson({ assessments: state.coverage_assessments }) + "\n" });
    files.push({ path: ".workspace/coverage-user-decisions.json", content: canonicalJson({ user_decisions: state.coverage_user_decisions }) + "\n" });
    const latestArtifacts = new Map<string, ArtifactRecord>();
    for (const artifact of state.artifacts) latestArtifacts.set(artifact.key, artifact);
    for (const artifact of state.artifacts) {
      if (!isPublicArtifactKind(artifact.kind)) continue;
      if (artifact.kind === "wardrobe" && latestArtifacts.get(artifact.key)?.id !== artifact.id) {
        const value = parseArtifactValue(artifact);
        const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
        const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
        files.push({
          path: path.join("characters", characterFolder, "wardrobe", "revisions", `${safeSegment(artifact.revision)}.md`),
          content: artifact.content.endsWith("\n") ? artifact.content : `${artifact.content}\n`,
        });
        continue;
      }
      const target = path.relative(this.projectDirectory, artifactFilePath(this.projectDirectory, artifact, characterFolders, worldArtifactCounts));
      files.push({ path: target, content: materializedArtifactContent(artifact) });
    }
    const latestPublish = state.publishes.at(-1);
    if (latestPublish !== undefined) {
      if (latestPublish.content !== undefined) {
        files.push({
          path: latestPublish.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts),
          content: humanReadableJsonFile(latestPublish.content),
        });
      } else if (latestPublish.content_ref !== undefined) {
        const blob = await this.blobs.get(latestPublish.content_ref.hash);
        if (blob !== undefined) {
          const decoded = new TextDecoder("utf-8", { fatal: false }).decode(blob);
          files.push({
            path: latestPublish.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts),
            content: humanReadableJsonFile(decoded),
          });
        }
      }
      if (latestPublish.png_base64 !== undefined) {
        files.push({
          path: latestPublish.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts),
          content: Buffer.from(latestPublish.png_base64, "base64"),
        });
      } else if (latestPublish.png_ref !== undefined) {
        const blob = await this.blobs.get(latestPublish.png_ref.hash);
        if (blob !== undefined) {
          files.push({
            path: latestPublish.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts),
            content: blob,
          });
        }
      }
    }
    return files;
  }

  private async withProjectLock<T>(work: () => Promise<T>): Promise<T> {
    return this.withLockFiles([this.lockFile], work);
  }

  private async withLockFiles<T>(lockFiles: readonly string[], work: () => Promise<T>): Promise<T> {
    const orderedLockFiles = [...new Set(lockFiles)].sort();
    const owner = `${process.pid}:${randomUUID()}`;
    const context: LockLeaseContext = {
      owner,
      lock_files: orderedLockFiles,
      lease_ms: this.lockOptions.lease_ms,
      heartbeat_ms: Math.max(1, Math.min(this.lockOptions.heartbeat_ms, Math.max(1, this.lockOptions.lease_ms - 1))),
      heartbeat_tail: Promise.resolve(),
    };
    const acquired: string[] = [];
    try {
      for (const lockFile of orderedLockFiles) {
        await acquireLockFile(lockFile, owner, this.lockOptions, (event) => this.appendStaleLockTakeoverAudit(event));
        acquired.push(lockFile);
      }
      this.activeLock = context;
      context.heartbeat_timer = setInterval(() => {
        context.heartbeat_tail = context.heartbeat_tail.then(async () => {
          if (context.lost !== undefined) return;
          try {
            for (const lockFile of context.lock_files) await refreshLockFile(lockFile, context.owner, context.lease_ms);
          } catch (error) {
            context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock ownership was lost for ${this.projectIdValue}`, true, { cause: error });
          }
        });
      }, context.heartbeat_ms);
      context.heartbeat_timer.unref?.();
      const result = await work();
      await context.heartbeat_tail;
      if (context.lost !== undefined) throw context.lost;
      return result;
    } finally {
      if (context.heartbeat_timer !== undefined) clearInterval(context.heartbeat_timer);
      await context.heartbeat_tail;
      if (this.activeLock === context) this.activeLock = undefined;
      for (const lockFile of [...acquired].reverse()) await releaseLockFile(lockFile, owner);
    }
  }

  private async assertLockOwner(): Promise<void> {
    const context = this.activeLock;
    if (context === undefined) return;
    if (context.lost !== undefined) throw context.lost;
    context.heartbeat_tail = context.heartbeat_tail.then(async () => {
      if (context.lost !== undefined) return;
      for (const lockFile of context.lock_files) {
        let record: LockRecord;
        try {
          record = await readLockRecord(lockFile);
        } catch (error) {
          context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock is no longer readable for ${this.projectIdValue}`, true, { cause: error });
          return;
        }
        if (record.owner !== context.owner || Date.parse(record.lease_expires_at) <= Date.now()) {
          context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock ownership changed for ${this.projectIdValue}`, true, {
            owner: context.owner,
            current_owner: record.owner,
            lease_expires_at: record.lease_expires_at,
          });
          return;
        }
      }
    });
    await context.heartbeat_tail;
    if (context.lost !== undefined) throw context.lost;
  }

  private injectFailure(point: RepositoryFailureInjectionPoint, relativePath?: string): void {
    if (this.failureInjection?.point !== point) return;
    if (this.failureInjection.relative_path !== undefined && this.failureInjection.relative_path !== relativePath) return;
    const injection = this.failureInjection;
    if (injection.once !== false) this.failureInjection = undefined;
    if (injection.mode === "crash") throw new RepositoryCrashInjection(point);
    throw new CoreError("INJECTED_FAILURE", `Injected repository failure at ${point}`, true, { point });
  }
}

function publishMaterializationPaths(state: ProjectState): { json?: string; png?: string } | undefined {
  const latest = state.publishes.at(-1);
  if (latest === undefined) return undefined;
  return {
    ...(latest.content !== undefined || latest.content_ref !== undefined
      ? { json: latest.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts) }
      : {}),
    ...(latest.png_base64 !== undefined || latest.png_ref !== undefined
      ? { png: latest.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts) }
      : {}),
  };
}

function blobTargetPath(hash: string): string {
  return normalizeRepositoryPath(`.workspace/blobs/${hash}`);
}

function normalizeBlobWrites(writeSet?: RepositoryWriteSet): Map<string, Uint8Array> {
  const writes = new Map<string, Uint8Array>();
  for (const blob of writeSet?.blobs ?? []) {
    const content = Buffer.from(blob.content);
    if (contentHash(content) !== blob.hash) {
      throw new CoreError("BLOB_HASH_MISMATCH", `Blob content does not match content hash ${blob.hash}`, true, { hash: blob.hash });
    }
    const previous = writes.get(blob.hash);
    if (previous !== undefined && !Buffer.from(previous).equals(content)) {
      throw new CoreError("BLOB_WRITE_CONFLICT", `Transaction contains conflicting writes for blob ${blob.hash}`, true, { hash: blob.hash });
    }
    writes.set(blob.hash, content);
  }
  return writes;
}

class RepositoryCrashInjection extends Error {
  constructor(point: RepositoryFailureInjectionPoint) {
    super(`Injected repository crash at ${point}`);
    this.name = "RepositoryCrashInjection";
  }
}

function lockRecord(owner: string, leaseMs: number, createdAt = new Date().toISOString()): LockRecord {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    owner,
    pid: process.pid,
    created_at: createdAt,
    heartbeat_at: now,
    lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
  };
}

async function readLockRecord(lockFile: string): Promise<LockRecord> {
  const raw = await readFile(lockFile, "utf8");
  return readLockRecordFromContent(raw, lockFile);
}

interface ExpiredLockTakeover {
  readonly lock_file: string;
  readonly displaced_file: string;
  readonly previous_owner: string;
  readonly occurred_at: string;
}

async function acquireLockFile(
  lockFile: string,
  owner: string,
  options: Required<RepositoryLockOptions>,
  onStaleTakeover?: (event: ExpiredLockTakeover) => Promise<void>,
): Promise<void> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + Math.max(1, options.timeout_ms);
  while (true) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(lockRecord(owner, options.lease_ms))}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(path.dirname(lockFile));
      return;
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;
      // Windows can transiently raise EPERM when a lock file is being
      // released or scanned; treat it like an existing file and retry.
      if (lockError.code !== "EEXIST" && lockError.code !== "EPERM") throw error;
      let current: LockRecord | undefined;
      try {
        current = await readLockRecord(lockFile);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      if (current !== undefined && Date.parse(current.lease_expires_at) <= Date.now()) {
        const takeover = await takeOverExpiredLock(lockFile, current);
        if (takeover !== undefined) {
          try {
            await onStaleTakeover?.(takeover);
          } catch (takeoverError) {
            // Restore the displaced lease when no contender has claimed the
            // lock. Otherwise retain it as evidence instead of deleting a
            // lock whose takeover could not be audited.
            if (!(await pathExists(lockFile))) {
              await rename(takeover.displaced_file, lockFile).catch(() => undefined);
            }
            throw takeoverError;
          }
          // Once the audit record is durable, stale-file cleanup is best
          // effort. A cleanup failure must not turn a recorded takeover back
          // into an ordinary acquisition or delete its remaining evidence.
          await rm(takeover.displaced_file, { force: true }).catch(() => undefined);
          continue;
        }
      }
      if (Date.now() >= deadline) throw new CoreError("REPOSITORY_LOCK_TIMEOUT", `Could not acquire lock ${lockFile}`, true);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, options.poll_ms)));
    }
  }
}

async function takeOverExpiredLock(lockFile: string, expected: LockRecord): Promise<ExpiredLockTakeover | undefined> {
  let latest: LockRecord;
  try {
    latest = await readLockRecord(lockFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
  if (latest.owner !== expected.owner || Date.parse(latest.lease_expires_at) > Date.now()) return undefined;
  const displaced = `${lockFile}.${randomUUID()}.stale`;
  try {
    await rename(lockFile, displaced);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") return undefined;
    throw error;
  }
  try {
    const moved = await readLockRecord(displaced);
    if (moved.owner !== expected.owner || Date.parse(moved.lease_expires_at) > Date.now()) {
      if (!(await pathExists(lockFile))) await rename(displaced, lockFile);
      return undefined;
    }
    return {
      lock_file: lockFile,
      displaced_file: displaced,
      previous_owner: moved.owner,
      occurred_at: new Date().toISOString(),
    };
  } catch (error) {
    // Never delete a displaced lock whose owner token we cannot verify.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function refreshLockFile(lockFile: string, owner: string, leaseMs: number): Promise<void> {
  const handle = await open(lockFile, "r+");
  try {
    const raw = await handle.readFile("utf8");
    const current = await readLockRecordFromContent(raw, lockFile);
    if (current.owner !== owner) throw new CoreError("REPOSITORY_LOCK_LOST", `Lock owner changed for ${lockFile}`, true);
    const position = (await handle.stat()).size;
    await handle.write(`${JSON.stringify(lockRecord(owner, leaseMs, current.created_at))}\n`, position, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function releaseLockFile(lockFile: string, owner: string): Promise<void> {
  try {
    const current = await readLockRecord(lockFile);
    if (current.owner !== owner) return;
    await rm(lockFile, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // A corrupt/replaced lock is intentionally left for the next owner to
    // inspect; cleanup must never delete another owner's lock.
  }
}
