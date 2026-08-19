import type { ProjectState } from "../project-state.js";

export const PROJECT_RELOCATION_INTENT_PATH = ".workspace/project-relocation.json";

export interface ProjectRelocationIdentity {
  readonly project_name?: string;
  readonly project_status: ProjectState["project_status"];
}

export interface ProjectRepository {
  readonly projectId?: string;
  read(): Promise<ProjectState>;
  transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>>;
  commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState>;
  readBlob(hash: string): Promise<Uint8Array | undefined>;
  writeBlob(hash: string, content: Uint8Array): Promise<void>;
  inspectRepair(): Promise<RepairInspection>;
  runRepair(planHash?: string): Promise<RepairReport>;
}

export interface RepairPlanItem {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: "legacy_file" | "orphan_backup";
  readonly reason: string;
  readonly recoverable: boolean;
}

export interface RepairInspection {
  readonly plan_hash: string;
  readonly items: RepairPlanItem[];
}

export interface RepairAction {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly reason: string;
  readonly recoverable: boolean;
  readonly outcome: "archived" | "skipped" | "missing";
}

export interface RepairReport {
  readonly plan_hash: string;
  readonly actions: RepairAction[];
}

export interface RepositoryFile {
  path: string;
  content: Uint8Array | string;
}

/** A content-addressed blob that is installed with the surrounding repository transaction. */
export interface RepositoryBlobWrite {
  hash: string;
  content: Uint8Array;
}

export interface RepositoryWriteSet {
  files?: readonly RepositoryFile[];
  blobs?: readonly RepositoryBlobWrite[];
  remove?: readonly string[];
}

export interface RepositoryTransactionResult<T> {
  state: ProjectState;
  value: T;
  writeSet?: RepositoryWriteSet;
}

export interface RepositoryTransactionCommit<T> {
  revision: number;
  state: ProjectState;
  value: T;
}

export type RepositoryTransactionWork<T> = (state: ProjectState) => Promise<RepositoryTransactionResult<T>> | RepositoryTransactionResult<T>;

export type RepositoryFailureInjectionPoint =
  | "after_journal"
  | "before_backup"
  | "after_backup"
  | "before_install"
  | "after_install"
  | "before_cleanup"
  | "after_cleanup"
  | "after_relocate";

export interface RepositoryFailureInjection {
  readonly point: RepositoryFailureInjectionPoint;
  readonly mode?: "error" | "crash";
  readonly once?: boolean;
  readonly relative_path?: string;
}

export interface RepositoryLockOptions {
  readonly lease_ms?: number;
  readonly heartbeat_ms?: number;
  readonly timeout_ms?: number;
  readonly poll_ms?: number;
}

export interface FileProjectRepositoryOptions {
  readonly layout?: "legacy" | "project";
  readonly materialize?: boolean;
  readonly lock?: RepositoryLockOptions;
  readonly failure_injection?: RepositoryFailureInjection;
}

export interface RepositoryTransactionRecoveryAuditRecord {
  readonly schema_version: 1;
  readonly id: string;
  readonly kind: "transaction_recovery";
  readonly project_id: string;
  readonly transaction_id: string;
  readonly direction: "rollback" | "finalize";
  readonly outcome: "completed" | "failed";
  readonly occurred_at: string;
  readonly error_code?: string;
}

export interface RepositoryStaleLockTakeoverAuditRecord {
  readonly schema_version: 1;
  readonly id: string;
  readonly kind: "stale_lock_takeover";
  readonly project_id: string;
  readonly lock_key: string;
  readonly previous_owner_hash: string;
  readonly outcome: "completed";
  readonly occurred_at: string;
}

export type RepositoryRecoveryAuditRecord = RepositoryTransactionRecoveryAuditRecord | RepositoryStaleLockTakeoverAuditRecord;
