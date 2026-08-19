import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CoreError, FileProjectRepository, PROJECT_RELOCATION_INTENT_PATH, type ProjectState, type RequestResult, type WorkspaceContext } from "@st-workspace/core";
import type { WorkspaceRuntime } from "./index.js";
import {
  cleanupInterviewMigrationSource,
  commitInterviewMigrationTarget,
  listInterviewMigrationIntents,
  prepareInterviewMigrationIntent,
} from "./interview-migration.js";
import { RecoverableProjectRepository } from "./project-relocation.js";

export interface WorkspaceProjectSummary {
  readonly project_id: string;
  readonly project_name?: string;
  readonly status: ProjectState["project_status"];
  readonly path: string;
  readonly revision?: number;
}

export type InterviewMigrationFailurePoint = "after_target_selection" | "after_target_commit";

export interface InterviewMigrationFailureInjection {
  readonly point: InterviewMigrationFailurePoint;
  readonly mode: "error" | "crash";
  readonly once?: boolean;
}

export interface WorkspaceProjectManagerOptions {
  readonly root: string;
  readonly createRuntime: (repository: FileProjectRepository) => WorkspaceRuntime;
  readonly initialProjectId?: string;
  /**
   * Start an unselected manager in a new project instead of implicitly
   * reopening the conventional project-001 directory.
   */
  readonly freshByDefault?: boolean;
  /** Failure injection for the cross-repository targeted-interview protocol. */
  readonly interviewMigrationFailureInjection?: InterviewMigrationFailureInjection;
}

function safeSegment(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/gu, "-").replace(/\s+/gu, "-").replace(/^\.+|\.+$/gu, "");
  if (safe.length === 0) return "project";
  if (/^(?:con|prn|aux|nul|com\d|lpt\d)$/iu.test(safe)) return `project-${safe}`;
  return safe.slice(0, 100);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

class InterviewMigrationCrashInjection extends Error {
  constructor(point: InterviewMigrationFailurePoint) {
    super(`Injected interview migration crash at ${point}`);
    this.name = "InterviewMigrationCrashInjection";
  }
}

export type FindTargetProjectResult =
  | { status: "found"; target: WorkspaceProjectSummary }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: WorkspaceProjectSummary[] };

export function findTargetProject(requested: string, summaries: WorkspaceProjectSummary[]): FindTargetProjectResult {
  const trimmed = requested.trim();
  if (trimmed.length === 0) return { status: "not_found" };
  const resolvedRequested = path.resolve(trimmed);

  const exactIdMatches = summaries.filter((item) => item.project_id === trimmed);
  if (exactIdMatches.length === 1) return { status: "found", target: exactIdMatches[0]! };

  const exactPathMatches = summaries.filter((item) => path.resolve(item.path) === resolvedRequested);
  if (exactPathMatches.length === 1) return { status: "found", target: exactPathMatches[0]! };

  const matches = summaries.filter((item) =>
    item.project_id === trimmed ||
    item.project_name === trimmed ||
    path.basename(item.path) === trimmed ||
    path.resolve(item.path) === resolvedRequested
  );

  if (matches.length === 0) return { status: "not_found" };
  if (matches.length === 1) return { status: "found", target: matches[0]! };

  return { status: "ambiguous", candidates: matches };
}

export class WorkspaceProjectManager {
  private repositoryValue: RecoverableProjectRepository;
  private runtimeValue: WorkspaceRuntime;
  private placeholderReuseAllowed = true;
  private readonly freshByDefault: boolean;
  private sessionPrepared: boolean;
  private preparePromise: Promise<WorkspaceRuntime> | undefined;
  private interviewMigrationFailureInjection: InterviewMigrationFailureInjection | undefined;
  private recoveringInterviewMigration = false;

  constructor(private readonly options: WorkspaceProjectManagerOptions) {
    const initialProjectId = options.initialProjectId ?? "project-001";
    this.repositoryValue = new RecoverableProjectRepository(options.root, initialProjectId, { layout: "project", materialize: true });
    this.runtimeValue = options.createRuntime(this.repositoryValue);
    this.freshByDefault = options.freshByDefault ?? true;
    this.sessionPrepared = options.initialProjectId !== undefined;
    this.interviewMigrationFailureInjection = options.interviewMigrationFailureInjection;
  }

  get root(): string {
    return this.options.root;
  }

  get runtime(): WorkspaceRuntime {
    return this.runtimeValue;
  }

  get repository(): FileProjectRepository {
    return this.repositoryValue;
  }

  async ensureRuntime(): Promise<WorkspaceRuntime> {
    await this.recoverPendingInterviewMigrationForSession();
    if (this.sessionPrepared || !this.freshByDefault) {
      await this.repositoryValue.read();
      return this.runtimeValue;
    }
    this.preparePromise ??= this.prepareFreshSession();
    try {
      return await this.preparePromise;
    } finally {
      this.preparePromise = undefined;
    }
  }

  /**
   * Whether a concrete project has been selected or created for this session.
   * A fresh manager that has only been constructed (no ensureRuntime call yet)
   * stays unselected so the server can render a home screen without creating
   * any project directory on disk.
   */
  sessionSelected(): boolean {
    return this.sessionPrepared;
  }

  private activateProject(projectId: string, placeholderReuseAllowed: boolean): void {
    this.repositoryValue = new RecoverableProjectRepository(this.options.root, projectId, { layout: "project", materialize: true });
    this.runtimeValue = this.options.createRuntime(this.repositoryValue);
    this.placeholderReuseAllowed = placeholderReuseAllowed;
    this.sessionPrepared = true;
  }

  private async recoverPendingInterviewMigrationForSession(): Promise<void> {
    if (this.recoveringInterviewMigration) return;
    this.recoveringInterviewMigration = true;
    try {
      const intents = await listInterviewMigrationIntents(this.options.root);
      if (intents.length === 0) return;
      const currentProjectId = this.repositoryValue.projectId;
      const candidates = this.sessionPrepared
        ? intents.filter((intent) => intent.source_project_id === currentProjectId || intent.target_project_id === currentProjectId)
        : intents;
      if (candidates.length === 0) return;
      if (candidates.length > 1) {
        throw new CoreError("INTERVIEW_MIGRATION_RECOVERY_AMBIGUOUS", "Multiple pending interview migrations match this session", true, {
          migration_ids: candidates.map((intent) => intent.migration_id),
        });
      }

      const intent = candidates[0]!;
      const sourceRepository = new RecoverableProjectRepository(this.options.root, intent.source_project_id, { layout: "project", materialize: true });
      const targetRepository = new RecoverableProjectRepository(this.options.root, intent.target_project_id, { layout: "project", materialize: true });
      let migrated: ProjectState;
      try {
        migrated = await commitInterviewMigrationTarget(intent, sourceRepository, targetRepository);
      } catch (error) {
        this.activateProject(intent.source_project_id, true);
        throw error;
      }

      try {
        await cleanupInterviewMigrationSource(this.options.root, intent, sourceRepository);
      } catch {
        // Target ownership is durable once its migration audit exists. Leaving
        // the source intent in place keeps cleanup retryable on the next call.
      }
      this.activateProject(migrated.project_id, false);
    } finally {
      this.recoveringInterviewMigration = false;
    }
  }

  private async prepareFreshSession(): Promise<WorkspaceRuntime> {
    // The constructor intentionally does not read the conventional placeholder.
    // If its directory already exists, it belongs to a previous session and must
    // never become the implicit active project for this manager. The allocated
    // placeholder stays re-usable by targeted interview flows (continue,
    // existing-world, character expansion) that migrate onto a selected target.
    if (await exists(this.repositoryValue.projectDirectory)) {
      const existingDirectories = (await readdir(this.options.root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
      const used = new Set([...(await this.listProjects()).map((item) => item.project_id), ...existingDirectories]);
      let sequence = 1;
      while (used.has(`project-${String(sequence).padStart(3, "0")}`)) sequence += 1;
      const id = `project-${String(sequence).padStart(3, "0")}`;
      this.repositoryValue = new RecoverableProjectRepository(this.options.root, id, { layout: "project", materialize: true });
      this.runtimeValue = this.options.createRuntime(this.repositoryValue);
    }
    await this.repositoryValue.read();
    this.sessionPrepared = true;
    return this.runtimeValue;
  }

  async listProjects(): Promise<WorkspaceProjectSummary[]> {
    if (!(await exists(this.options.root))) return [];
    const entries = await readdir(this.options.root, { withFileTypes: true });
    const summaries: WorkspaceProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const stateFile = path.join(this.options.root, entry.name, ".workspace", "state.json");
      const legacyStateFile = path.join(this.options.root, entry.name, "state.json");
      const primary = (await exists(stateFile)) ? stateFile : (await exists(legacyStateFile)) ? legacyStateFile : undefined;
      if (primary === undefined) continue;
      try {
        const relocationIntent = path.join(this.options.root, entry.name, PROJECT_RELOCATION_INTENT_PATH);
        const state = await exists(relocationIntent)
          ? await new RecoverableProjectRepository(this.options.root, entry.name, { layout: "project", materialize: true }).read()
          : JSON.parse(await readFile(primary, "utf8")) as ProjectState;
        summaries.push({
          project_id: state.project_id,
          ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
          status: state.project_status,
          path: path.join(this.options.root, entry.name),
          revision: state.revision,
        });
      } catch {
        // A damaged state file is still surfaced so the folder is not silently hidden.
        summaries.push({ project_id: entry.name, status: "uninitialized", path: path.join(this.options.root, entry.name) });
      }
    }
    return summaries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async select(project: string): Promise<WorkspaceProjectSummary> {
    if (this.preparePromise !== undefined) await this.preparePromise;
    const requested = project.trim();
    if (requested.length === 0 || requested.startsWith("..") || requested === "." || requested === "..") throw new CoreError("PROJECT_SELECTION_INVALID", "請提供可見的專案名稱或資料夾名稱 (project selection must be a project name or id)", true);
    const summaries = await this.listProjects();
    const result = findTargetProject(requested, summaries);
    if (result.status === "not_found") throw new CoreError("PROJECT_NOT_FOUND", `找不到專案「${requested}」 (project was not found)`, true);
    if (result.status === "ambiguous") throw new CoreError("PROJECT_SELECTION_AMBIGUOUS", `發現多個符合「${requested}」的專案，請提供專案 ID 或完整路徑 (ambiguous project selection)`, true);
    const selected = result.target;
    this.activateProject(path.basename(selected.path), false);
    return selected;
  }

  async startNewProject(): Promise<WorkspaceRuntime> {
    const summaries = await this.listProjects();
    const existingDirectories = await exists(this.options.root)
      ? (await readdir(this.options.root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name)
      : [];
    const used = new Set([...summaries.map((item) => item.project_id), ...existingDirectories]);
    let sequence = 1;
    while (used.has(`project-${String(sequence).padStart(3, "0")}`)) sequence += 1;
    const id = `project-${String(sequence).padStart(3, "0")}`;
    this.activateProject(id, false);
    await this.repositoryValue.read();
    return this.runtimeValue;
  }

  async finalizeIfNamed(result: RequestResult): Promise<RequestResult> {
    const projectName = result.project_name;
    if (projectName === undefined || result.status !== "completed") return this.enrich(result);
    const state = await this.repositoryValue.read();
    const base = safeSegment(projectName);
    let target = base;
    let suffix = 2;
    while (target !== this.repositoryValue.projectId && (await exists(path.join(this.options.root, target)))) {
      target = `${base}-${suffix}`;
      suffix += 1;
    }
    const updated = await this.repositoryValue.relocateAndCommitIdentity(target, state.revision, {
      project_name: projectName,
      project_status: "ready",
    });
    return {
      ...result,
      project_id: updated.project_id,
      project_path: this.repositoryValue.projectDirectory,
      ...(updated.project_name === undefined ? {} : { project_name: updated.project_name }),
    };
  }

  async request(request: string, context: WorkspaceContext, options: { agent?: string; idempotency_key?: string; target_operation_id?: string; operation_id?: string } = {}): Promise<RequestResult> {
    await this.ensureRuntime();
    if (/^(?:建立|新增|開始|start|new)\s*(?:新)?專案|^new project/iu.test(request.trim())) {
      const current = await this.repositoryValue.read();
      const canReusePlaceholder = this.placeholderReuseAllowed && current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0;
      if (!canReusePlaceholder) await this.startNewProject();
      this.placeholderReuseAllowed = false;
    }
    return this.finalizeIfNamed(await this.runtimeValue.request(request, context, options));
  }

  async answerInterview(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    await this.ensureRuntime();
    const result = await this.runtimeValue.answerInterview(answer, context);
    const switched = await this.switchToTargetedProject(result, context);
    if (switched !== undefined) return switched;
    if (result.status !== "completed" || result.flow === undefined) return this.finalizeIfNamed(result);
    const placeholderState = await this.repositoryValue.read();
    const values = placeholderState.interview.values;
    if (result.flow === "legacy_review") {
      const importPath = values.import_path;
      if (typeof importPath === "string" && importPath.trim().length > 0) return this.importLegacyCard(importPath.trim(), result, context);
    }
    return this.finalizeIfNamed(result);
  }

  /**
   * Targeted interview flows (continue, existing-world, character expansion)
   * ask for the target project up front. Source ownership is persisted in a
   * durable migration intent before the manager switches active repositories.
   * The target commit is idempotent by migration id; source cleanup is a second,
   * retryable phase rather than being represented as physically atomic.
   */
  private async switchToTargetedProject(result: RequestResult, context: WorkspaceContext): Promise<RequestResult | undefined> {
    if (!this.placeholderReuseAllowed) return undefined;
    const placeholderRepository = this.repositoryValue;
    const placeholderState = await placeholderRepository.read();
    const flow = placeholderState.interview.flow;
    if (flow !== "continue" && flow !== "world" && flow !== "character_expansion") return undefined;
    const values = placeholderState.interview.values;
    const targetQuestionId = flow === "continue"
      ? "continue_project"
      : flow === "world" && typeof values.world_kind === "string" && values.world_kind.replace(/\s+/gu, "").includes("既有專案")
        ? "world_project"
        : flow === "character_expansion"
          ? "expansion_project"
          : undefined;

    if (targetQuestionId === undefined) return undefined;
    const targetValue = values[targetQuestionId];
    if (typeof targetValue !== "string" || targetValue.trim().length === 0) return undefined;
    const targetName = targetValue.trim();

    const summaries = await this.listProjects();
    const targetResult = findTargetProject(targetName, summaries);
    const interviewOperation = [...placeholderState.operations].reverse().find((item) => item.kind === "interview");

    if (targetResult.status !== "found") {
      const restoredValues = { ...placeholderState.interview.values };
      delete restoredValues[targetQuestionId];
      const restoredAnswers = placeholderState.interview.answers.filter((item) => item.question_id !== targetQuestionId);

      const targetQuestionText = targetQuestionId === "continue_project"
        ? "請提供要繼續的專案名稱或路徑。"
        : targetQuestionId === "world_project"
          ? "請提供既有專案名稱或路徑。"
          : "請提供要擴充角色的既有專案名稱或路徑。";

      const restoredQuestion = {
        id: targetQuestionId,
        text: targetQuestionText,
        kind: "free_text" as const,
      };

      const errorSummary = targetResult.status === "ambiguous"
        ? `發現多個符合「${targetName}」的專案，請提供專案 ID 或完整路徑。`
        : `找不到專案「${targetName}」，請重新輸入專案 ID、名稱或完整路徑。`;

      await placeholderRepository.commit(placeholderState.revision, (current) => ({
        ...current,
        interview: {
          ...current.interview,
          status: "active" as const,
          current: restoredQuestion,
          answers: restoredAnswers,
          values: restoredValues,
        },
        operations: interviewOperation === undefined
          ? current.operations
          : current.operations.map((op) => op.id === interviewOperation.id ? { ...op, status: "needs_input" as const, question: targetQuestionText, result_summary: errorSummary } : op),
      }));

      return {
        ...result,
        status: "needs_input" as const,
        summary: errorSummary,
        question: targetQuestionText,
        interview_question: restoredQuestion,
        completed: [],
        blocked: [...(result.operation_id === undefined ? [] : [result.operation_id])],
      };
    }

    const target = targetResult.target;
    if (target.project_id === placeholderState.project_id) return undefined;

    const targetRepository = new RecoverableProjectRepository(this.options.root, path.basename(target.path), { layout: "project", materialize: true });
    const targetState = await targetRepository.read();
    const intent = await prepareInterviewMigrationIntent({
      root: this.options.root,
      source: placeholderState,
      target: targetState,
      flow,
      ...(interviewOperation === undefined ? {} : { sourceOperation: interviewOperation }),
      actor: context.actor,
    });

    let migrated: ProjectState;
    try {
      await this.select(target.project_id);
      this.injectInterviewMigrationFailure("after_target_selection");
      migrated = await commitInterviewMigrationTarget(intent, placeholderRepository, this.repositoryValue);
    } catch (error) {
      if (error instanceof InterviewMigrationCrashInjection) throw error;
      this.activateProject(placeholderState.project_id, true);
      if (error instanceof CoreError && error.code === "INTERVIEW_MIGRATION_NOT_COMMITTED") throw error;
      throw new CoreError(
        "INTERVIEW_MIGRATION_NOT_COMMITTED",
        "Target interview migration did not commit; the source project remains authoritative and the migration can be retried",
        true,
        { migration_id: intent.migration_id, cause: error },
      );
    }

    let cleanupError: unknown;
    try {
      this.injectInterviewMigrationFailure("after_target_commit");
      await cleanupInterviewMigrationSource(this.options.root, intent, placeholderRepository);
    } catch (error) {
      if (error instanceof InterviewMigrationCrashInjection) throw error;
      cleanupError = error;
    }

    const continued = placeholderState.interview.status !== "complete";
    const projectName = target.project_name ?? target.project_id;
    if (cleanupError !== undefined) {
      return {
        ...result,
        status: result.status === "completed" ? "partial" as const : result.status,
        project_id: migrated.project_id,
        ...(migrated.project_name === undefined ? {} : { project_name: migrated.project_name }),
        project_path: this.repositoryValue.projectDirectory,
        summary: `已切換至專案「${projectName}」，目標遷移已提交；來源暫存專案清理尚未完成，會在下次操作或重啟時自動恢復。${result.summary}`.trim(),
      };
    }

    if (flow === "continue") {
      return {
        ...result,
        status: "completed" as const,
        project_id: migrated.project_id,
        ...(migrated.project_name === undefined ? {} : { project_name: migrated.project_name }),
        project_path: this.repositoryValue.projectDirectory,
        summary: `已切換至專案「${projectName}」。`,
      };
    }

    return {
      ...result,
      project_id: migrated.project_id,
      ...(migrated.project_name === undefined ? {} : { project_name: migrated.project_name }),
      project_path: this.repositoryValue.projectDirectory,
      summary: `已切換至專案「${projectName}」（revision ${migrated.revision}）${continued ? "，訪談將於目標專案上繼續" : ""}。${result.summary}`.trim(),
    };
  }

  private injectInterviewMigrationFailure(point: InterviewMigrationFailurePoint): void {
    const injection = this.interviewMigrationFailureInjection;
    if (injection === undefined || injection.point !== point) return;
    if (injection.once !== false) this.interviewMigrationFailureInjection = undefined;
    if (injection.mode === "crash") throw new InterviewMigrationCrashInjection(point);
    throw new CoreError("INJECTED_FAILURE", `Injected interview migration failure at ${point}`, true, { point });
  }

  private async importLegacyCard(filePath: string, result: RequestResult, context: WorkspaceContext): Promise<RequestResult> {
    let content: Uint8Array;
    try {
      content = await readFile(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") throw new CoreError("LEGACY_CARD_NOT_FOUND", `找不到舊卡檔案「${filePath}」，請確認路徑後重新開始「舊卡審核」。`, true);
      throw new CoreError("LEGACY_CARD_UNREADABLE", `無法讀取舊卡檔案「${filePath}」：${(error as Error).message}`, true);
    }
    const lower = filePath.toLowerCase();
    const mediaType = lower.endsWith(".png") ? "image/png" : lower.endsWith(".yaml") || lower.endsWith(".yml") ? "text/yaml" : "application/json";
    const importResult = await this.runtimeValue.request(`匯入舊卡 ${path.basename(filePath)}`, {
      ...context,
      attachments: [{ name: path.basename(filePath), content, media_type: mediaType }],
    });
    return this.finalizeIfNamed({
      ...result,
      ...importResult,
      summary: `${result.summary} ${importResult.summary}`.trim(),
      completed: [...(result.completed ?? []), ...(importResult.completed ?? [])],
    });
  }

  async interviewContext(): Promise<ReturnType<WorkspaceRuntime["interviewContext"]>> {
    await this.ensureRuntime();
    return this.runtimeValue.interviewContext();
  }

  async status(): Promise<RequestResult> {
    await this.ensureRuntime();
    return this.enrich(await this.runtimeValue.status());
  }

  private async enrich(result: RequestResult): Promise<RequestResult> {
    const state = await this.repositoryValue.read();
    return {
      ...result,
      project_id: state.project_id,
      ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
      project_path: this.repositoryValue.projectDirectory,
      ...(state.interview.current === undefined ? {} : { interview_question: state.interview.current }),
    };
  }
}
