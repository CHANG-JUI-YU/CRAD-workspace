import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  contentHash,
  CoreError,
  type FileProjectRepository,
  type InterviewFlow,
  type OperationRecord,
  type ProjectState,
} from "@st-workspace/core";

export const INTERVIEW_MIGRATION_INTENT_PATH = ".workspace/interview-migration.json";

export type TargetedInterviewFlow = Extract<InterviewFlow, "continue" | "world" | "character_expansion">;

export interface InterviewMigrationIntent {
  readonly schema_version: 1;
  readonly migration_id: string;
  readonly source_project_id: string;
  readonly target_project_id: string;
  readonly flow: TargetedInterviewFlow;
  readonly source_revision: number;
  readonly target_revision: number;
  readonly source_operation_id?: string;
  readonly target_operation_id: string;
  readonly audit_id: string;
  readonly actor: string;
  readonly created_at: string;
}

export type InterviewMigrationRecoveryResult =
  | { readonly status: "completed"; readonly target: ProjectState; readonly source: ProjectState }
  | { readonly status: "cleanup_pending"; readonly target: ProjectState; readonly cleanup_error: unknown };

function stableId(prefix: string, value: string): string {
  return `${prefix}_${contentHash(value).slice(0, 32)}`;
}

function intentFile(root: string, sourceProjectId: string): string {
  return path.join(root, sourceProjectId, INTERVIEW_MIGRATION_INTENT_PATH);
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
    // itself is fsynced; directory syncing remains best-effort.
  }
}

async function writeIntent(filePath: string, intent: InterviewMigrationIntent): Promise<void> {
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

function parseIntent(raw: string, filePath: string): InterviewMigrationIntent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_UNCERTAIN", `Interview migration intent is not valid JSON: ${filePath}`, true, { cause: error });
  }
  if (typeof value !== "object" || value === null) {
    throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_UNCERTAIN", `Interview migration intent is not an object: ${filePath}`, true);
  }
  const record = value as Record<string, unknown>;
  const flow = record.flow;
  if (
    record.schema_version !== 1
    || typeof record.migration_id !== "string"
    || typeof record.source_project_id !== "string"
    || typeof record.target_project_id !== "string"
    || (flow !== "continue" && flow !== "world" && flow !== "character_expansion")
    || typeof record.source_revision !== "number"
    || !Number.isInteger(record.source_revision)
    || record.source_revision < 0
    || typeof record.target_revision !== "number"
    || !Number.isInteger(record.target_revision)
    || record.target_revision < 0
    || (record.source_operation_id !== undefined && typeof record.source_operation_id !== "string")
    || typeof record.target_operation_id !== "string"
    || typeof record.audit_id !== "string"
    || typeof record.actor !== "string"
    || typeof record.created_at !== "string"
  ) {
    throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_UNCERTAIN", `Interview migration intent is malformed: ${filePath}`, true);
  }
  return value as InterviewMigrationIntent;
}

export async function readInterviewMigrationIntent(root: string, sourceProjectId: string): Promise<InterviewMigrationIntent | undefined> {
  const filePath = intentFile(root, sourceProjectId);
  try {
    return parseIntent(await readFile(filePath, "utf8"), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listInterviewMigrationIntents(root: string): Promise<InterviewMigrationIntent[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const intents: InterviewMigrationIntent[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const intent = await readInterviewMigrationIntent(root, entry.name);
    if (intent !== undefined) intents.push(intent);
  }
  return intents;
}

function sameIntent(left: InterviewMigrationIntent, right: InterviewMigrationIntent): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export async function prepareInterviewMigrationIntent(input: {
  readonly root: string;
  readonly source: ProjectState;
  readonly target: ProjectState;
  readonly flow: TargetedInterviewFlow;
  readonly sourceOperation?: OperationRecord;
  readonly actor: string;
}): Promise<InterviewMigrationIntent> {
  const existing = await readInterviewMigrationIntent(input.root, input.source.project_id);
  if (existing !== undefined) {
    if (
      existing.source_project_id !== input.source.project_id
      || existing.target_project_id !== input.target.project_id
      || existing.flow !== input.flow
      || existing.source_revision !== input.source.revision
    ) {
      throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_CONFLICT", "A different interview migration is already pending for the source project", true, {
        existing_migration_id: existing.migration_id,
        source_project_id: input.source.project_id,
        target_project_id: input.target.project_id,
      });
    }
    return existing;
  }

  const seed = canonicalJson({
    source_project_id: input.source.project_id,
    target_project_id: input.target.project_id,
    flow: input.flow,
    source_revision: input.source.revision,
    target_revision: input.target.revision,
    source_operation_id: input.sourceOperation?.id ?? null,
  });
  const migrationId = stableId("interview_migration", seed);
  const remappedOperationId = stableId("operation", migrationId);
  const sourceOperationId = input.sourceOperation?.id;
  const sourceIdCollides = sourceOperationId !== undefined && input.target.operations.some((item) => item.id === sourceOperationId);
  const targetOperationId = sourceOperationId === undefined
    ? remappedOperationId
    : sourceIdCollides
      ? remappedOperationId
      : sourceOperationId;
  if (input.target.operations.some((item) => item.id === targetOperationId) && targetOperationId !== sourceOperationId) {
    throw new CoreError("INTERVIEW_MIGRATION_ID_COLLISION", `Stable migrated operation id ${targetOperationId} already exists on the target project`, true);
  }

  const intent: InterviewMigrationIntent = {
    schema_version: 1,
    migration_id: migrationId,
    source_project_id: input.source.project_id,
    target_project_id: input.target.project_id,
    flow: input.flow,
    source_revision: input.source.revision,
    target_revision: input.target.revision,
    ...(sourceOperationId === undefined ? {} : { source_operation_id: sourceOperationId }),
    target_operation_id: targetOperationId,
    audit_id: stableId("audit", migrationId),
    actor: input.actor,
    created_at: new Date().toISOString(),
  };
  await writeIntent(intentFile(input.root, input.source.project_id), intent);

  const persisted = await readInterviewMigrationIntent(input.root, input.source.project_id);
  if (persisted === undefined || !sameIntent(persisted, intent)) {
    throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_UNCERTAIN", "Interview migration intent could not be verified after persistence", true);
  }
  return intent;
}

function migrationAudit(state: ProjectState, intent: InterviewMigrationIntent) {
  return state.audit.find((item) => item.event === "interview.target.migrated" && item.details.migration_id === intent.migration_id);
}

export function targetHasInterviewMigration(state: ProjectState, intent: InterviewMigrationIntent): boolean {
  const audit = migrationAudit(state, intent);
  if (audit === undefined) return false;
  if (intent.source_operation_id !== undefined && !state.operations.some((item) => item.id === intent.target_operation_id)) {
    throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_CONFLICT", "Target migration audit exists but the migrated interview operation is missing", true, {
      migration_id: intent.migration_id,
      target_operation_id: intent.target_operation_id,
    });
  }
  return true;
}

function assertSourceAuthoritative(state: ProjectState, intent: InterviewMigrationIntent): OperationRecord | undefined {
  if (state.project_id !== intent.source_project_id || state.revision !== intent.source_revision || state.interview.flow !== intent.flow) {
    throw new CoreError("INTERVIEW_MIGRATION_NOT_COMMITTED", "Source project changed before the target interview migration committed", true, {
      migration_id: intent.migration_id,
      expected_source_revision: intent.source_revision,
      actual_source_revision: state.revision,
    });
  }
  if (intent.source_operation_id === undefined) return undefined;
  const operation = state.operations.find((item) => item.id === intent.source_operation_id);
  if (operation === undefined) {
    throw new CoreError("INTERVIEW_MIGRATION_NOT_COMMITTED", "Source interview operation disappeared before migration committed", true, {
      migration_id: intent.migration_id,
      source_operation_id: intent.source_operation_id,
    });
  }
  return operation;
}

export async function commitInterviewMigrationTarget(
  intent: InterviewMigrationIntent,
  sourceRepository: FileProjectRepository,
  targetRepository: FileProjectRepository,
): Promise<ProjectState> {
  const target = await targetRepository.read();
  if (targetHasInterviewMigration(target, intent)) return target;
  if (target.revision !== intent.target_revision) {
    throw new CoreError("INTERVIEW_MIGRATION_NOT_COMMITTED", "Target project changed before interview migration committed; source remains authoritative", true, {
      migration_id: intent.migration_id,
      expected_target_revision: intent.target_revision,
      actual_target_revision: target.revision,
    });
  }

  const source = await sourceRepository.read();
  const sourceOperation = assertSourceAuthoritative(source, intent);
  if (sourceOperation !== undefined && target.operations.some((item) => item.id === intent.target_operation_id)) {
    throw new CoreError("INTERVIEW_MIGRATION_ID_COLLISION", `Target operation id ${intent.target_operation_id} was occupied before migration commit`, true, {
      migration_id: intent.migration_id,
    });
  }

  return targetRepository.commit(target.revision, (current) => ({
    ...current,
    project_status: intent.flow === "continue"
      ? current.project_status === "uninitialized" ? "ready" : current.project_status
      : "interviewing",
    interview: source.interview,
    operations: sourceOperation === undefined
      ? current.operations
      : [...current.operations, { ...sourceOperation, id: intent.target_operation_id }],
    audit: [
      ...current.audit,
      {
        id: intent.audit_id,
        operation_id: intent.target_operation_id,
        event: "interview.target.migrated",
        actor: intent.actor,
        occurred_at: intent.created_at,
        project_revision: current.revision + 1,
        details: {
          migration_id: intent.migration_id,
          source_project: intent.source_project_id,
          target_project: intent.target_project_id,
          flow: intent.flow,
          source_revision: intent.source_revision,
          target_revision: intent.target_revision,
        },
      },
    ],
  }));
}

function sourceCleanupMatches(state: ProjectState, intent: InterviewMigrationIntent): boolean {
  return state.project_status === "uninitialized"
    && state.interview.status === "idle"
    && state.interview.flow === "new_project"
    && (intent.source_operation_id === undefined || !state.operations.some((item) => item.id === intent.source_operation_id));
}

export async function cleanupInterviewMigrationSource(
  root: string,
  intent: InterviewMigrationIntent,
  sourceRepository: FileProjectRepository,
): Promise<ProjectState> {
  const current = await sourceRepository.read();
  if (current.revision === intent.source_revision + 1 && sourceCleanupMatches(current, intent)) {
    await removeIntent(intentFile(root, intent.source_project_id));
    return current;
  }
  if (current.revision !== intent.source_revision) {
    throw new CoreError("INTERVIEW_MIGRATION_CLEANUP_PENDING", "Target migration committed but source cleanup cannot be applied at the expected revision", true, {
      migration_id: intent.migration_id,
      expected_source_revision: intent.source_revision,
      actual_source_revision: current.revision,
    });
  }
  assertSourceAuthoritative(current, intent);
  const cleaned = await sourceRepository.commit(current.revision, (state) => ({
    ...state,
    project_status: "uninitialized",
    interview: {
      schema_version: 1,
      status: "idle",
      flow: "new_project",
      answers: [],
      values: {},
    },
    operations: intent.source_operation_id === undefined
      ? state.operations
      : state.operations.filter((item) => item.id !== intent.source_operation_id),
  }));
  await removeIntent(intentFile(root, intent.source_project_id));
  return cleaned;
}

export async function recoverInterviewMigration(input: {
  readonly root: string;
  readonly intent: InterviewMigrationIntent;
  readonly sourceRepository: FileProjectRepository;
  readonly targetRepository: FileProjectRepository;
}): Promise<InterviewMigrationRecoveryResult> {
  const target = await commitInterviewMigrationTarget(input.intent, input.sourceRepository, input.targetRepository);
  try {
    const source = await cleanupInterviewMigrationSource(input.root, input.intent, input.sourceRepository);
    return { status: "completed", target, source };
  } catch (cleanupError) {
    return { status: "cleanup_pending", target, cleanup_error: cleanupError };
  }
}
