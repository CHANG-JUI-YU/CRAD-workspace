import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  CoreError,
  FileProjectRepository,
  PROJECT_RELOCATION_INTENT_PATH,
  type FileProjectRepositoryOptions,
  type ProjectRelocationIdentity,
  type ProjectState,
  type RepositoryFailureInjection,
  type RepositoryTransactionCommit,
  type RepositoryTransactionWork,
} from "@st-workspace/core";

interface ProjectRelocationIntent {
  readonly schema_version: 1;
  readonly source_project_id: string;
  readonly target_project_id: string;
  readonly expected_revision: number;
  readonly identity: ProjectRelocationIdentity;
  readonly created_at: string;
}

function normalizedProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (normalized.length === 0 || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
    throw new CoreError("PROJECT_ID_INVALID", "project id must be a single safe path segment", true);
  }
  return normalized;
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not portable (notably on Windows). The intent file
    // itself is fsynced; directory syncing remains a best-effort durability aid.
  }
}

async function writeIntent(filePath: string, intent: ProjectRelocationIntent): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${canonicalJson(intent)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    await syncDirectoryBestEffort(path.dirname(filePath));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeIntent(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
  await syncDirectoryBestEffort(path.dirname(filePath));
}

async function readIntent(filePath: string): Promise<ProjectRelocationIntent | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CoreError("PROJECT_RELOCATION_RECOVERY_UNCERTAIN", "Project relocation intent is not valid JSON", true, { cause: error });
  }
  if (typeof value !== "object" || value === null) {
    throw new CoreError("PROJECT_RELOCATION_RECOVERY_UNCERTAIN", "Project relocation intent is not an object", true);
  }
  const record = value as Record<string, unknown>;
  const identity = record.identity;
  if (
    record.schema_version !== 1
    || typeof record.source_project_id !== "string"
    || typeof record.target_project_id !== "string"
    || typeof record.expected_revision !== "number"
    || !Number.isInteger(record.expected_revision)
    || record.expected_revision < 0
    || typeof record.created_at !== "string"
    || typeof identity !== "object"
    || identity === null
    || typeof (identity as Record<string, unknown>).project_status !== "string"
    || ((identity as Record<string, unknown>).project_name !== undefined && typeof (identity as Record<string, unknown>).project_name !== "string")
  ) {
    throw new CoreError("PROJECT_RELOCATION_RECOVERY_UNCERTAIN", "Project relocation intent is malformed", true);
  }
  return value as ProjectRelocationIntent;
}

class ProjectRelocationCrashInjection extends Error {
  constructor() {
    super("Injected repository crash at after_relocate");
    this.name = "ProjectRelocationCrashInjection";
  }
}

/**
 * Manager-facing repository wrapper for project finalization.
 *
 * Finalized identity invariant:
 *   directory basename === project_id === project_slug
 * while project_name remains the user-facing display name.
 *
 * A durable relocation intent is written before the directory move. If the
 * process stops after the move but before the metadata transaction commits,
 * the intent moves with the project and the next read deterministically
 * finishes that transaction. If the process stops before the move, the source
 * directory/state are still consistent and the next read discards the intent.
 */
export class RecoverableProjectRepository extends FileProjectRepository {
  private relocationFailureInjection: RepositoryFailureInjection | undefined;
  private readonly relocationRoot: string;

  constructor(
    projectRoot: string,
    projectId: string,
    options: FileProjectRepositoryOptions = {},
  ) {
    super(projectRoot, projectId, options);
    this.relocationRoot = projectRoot;
    this.relocationFailureInjection = options.failure_injection?.point === "after_relocate"
      ? options.failure_injection
      : undefined;
  }

  override async read(): Promise<ProjectState> {
    const state = await super.read();
    return this.recoverRelocationIntent(state);
  }

  /** Any managed transaction first resolves a relocation intent, if present. */
  override async transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>> {
    await this.read();
    return super.transaction(expectedRevision, work);
  }

  async relocateAndCommitIdentity(
    newProjectId: string,
    expectedRevision: number,
    identity: ProjectRelocationIdentity,
  ): Promise<ProjectState> {
    const targetProjectId = normalizedProjectId(newProjectId);
    const current = await this.read();
    if (current.revision !== expectedRevision) {
      throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${current.revision}`, true);
    }

    if (targetProjectId === this.projectId) {
      return this.commitIdentity(expectedRevision, targetProjectId, identity);
    }

    const intent: ProjectRelocationIntent = {
      schema_version: 1,
      source_project_id: this.projectId,
      target_project_id: targetProjectId,
      expected_revision: expectedRevision,
      identity,
      created_at: new Date().toISOString(),
    };
    const sourceIntentFile = this.intentFile();
    await writeIntent(sourceIntentFile, intent);

    try {
      await super.relocate(targetProjectId);
    } catch (error) {
      await removeIntent(sourceIntentFile).catch(() => undefined);
      throw error;
    }

    this.injectAfterRelocate();

    const updated = await this.commitIdentity(expectedRevision, targetProjectId, identity);
    await removeIntent(this.intentFile());
    return updated;
  }

  private intentFile(): string {
    return path.join(this.relocationRoot, this.projectId, PROJECT_RELOCATION_INTENT_PATH);
  }

  private applyIdentity(state: ProjectState, targetProjectId: string, identity: ProjectRelocationIdentity): ProjectState {
    return {
      ...state,
      project_id: targetProjectId,
      ...(identity.project_name === undefined ? {} : { project_name: identity.project_name }),
      project_slug: targetProjectId,
      project_status: identity.project_status,
    };
  }

  private async commitIdentity(
    expectedRevision: number,
    targetProjectId: string,
    identity: ProjectRelocationIdentity,
  ): Promise<ProjectState> {
    const committed = await super.transaction(expectedRevision, (state) => ({
      state: this.applyIdentity(state, targetProjectId, identity),
      value: undefined,
    }));
    return committed.state;
  }

  private identityMatches(state: ProjectState, intent: ProjectRelocationIntent): boolean {
    return state.project_id === intent.target_project_id
      && state.project_slug === intent.target_project_id
      && state.project_status === intent.identity.project_status
      && (intent.identity.project_name === undefined || state.project_name === intent.identity.project_name);
  }

  private async recoverRelocationIntent(state: ProjectState): Promise<ProjectState> {
    const filePath = this.intentFile();
    const intent = await readIntent(filePath);
    if (intent === undefined) return state;

    if (intent.target_project_id !== this.projectId) {
      if (intent.source_project_id !== this.projectId) {
        throw new CoreError(
          "PROJECT_RELOCATION_RECOVERY_UNCERTAIN",
          `Relocation intent does not belong to project directory ${this.projectId}`,
          true,
          { source_project_id: intent.source_project_id, target_project_id: intent.target_project_id },
        );
      }
      await removeIntent(filePath);
      return state;
    }

    if (state.revision === intent.expected_revision) {
      const recovered = await this.commitIdentity(
        intent.expected_revision,
        intent.target_project_id,
        intent.identity,
      );
      await removeIntent(filePath);
      return recovered;
    }

    if (state.revision === intent.expected_revision + 1 && this.identityMatches(state, intent)) {
      await removeIntent(filePath);
      return state;
    }

    throw new CoreError(
      "PROJECT_RELOCATION_RECOVERY_CONFLICT",
      `Cannot recover project relocation at revision ${state.revision}; expected ${intent.expected_revision} or ${intent.expected_revision + 1}`,
      true,
      {
        project_id: this.projectId,
        source_project_id: intent.source_project_id,
        target_project_id: intent.target_project_id,
        expected_revision: intent.expected_revision,
        actual_revision: state.revision,
      },
    );
  }

  private injectAfterRelocate(): void {
    const injection = this.relocationFailureInjection;
    if (injection === undefined) return;
    if (injection.relative_path !== undefined && injection.relative_path !== PROJECT_RELOCATION_INTENT_PATH) return;
    if (injection.once !== false) this.relocationFailureInjection = undefined;
    if (injection.mode === "crash") throw new ProjectRelocationCrashInjection();
    throw new CoreError("INJECTED_FAILURE", "Injected repository failure at after_relocate", true, { point: "after_relocate" });
  }
}
