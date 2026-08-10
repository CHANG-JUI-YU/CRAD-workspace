import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CoreError, FileProjectRepository, type ProjectState, type RequestResult, type WorkspaceContext } from "@st-workspace/core";
import type { WorkspaceRuntime } from "./index.js";

export interface WorkspaceProjectSummary {
  readonly project_id: string;
  readonly project_name?: string;
  readonly status: ProjectState["project_status"];
  readonly path: string;
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

export class WorkspaceProjectManager {
  private repositoryValue: FileProjectRepository;
  private runtimeValue: WorkspaceRuntime;
  private placeholderReuseAllowed = true;
  private readonly freshByDefault: boolean;
  private sessionPrepared: boolean;
  private preparePromise: Promise<WorkspaceRuntime> | undefined;

  constructor(private readonly options: WorkspaceProjectManagerOptions) {
    const initialProjectId = options.initialProjectId ?? "project-001";
    this.repositoryValue = new FileProjectRepository(options.root, initialProjectId, { layout: "project", materialize: true });
    this.runtimeValue = options.createRuntime(this.repositoryValue);
    this.freshByDefault = options.freshByDefault ?? true;
    this.sessionPrepared = options.initialProjectId !== undefined;
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

  private async prepareFreshSession(): Promise<WorkspaceRuntime> {
    // The constructor intentionally does not read the conventional placeholder.
    // If its directory already exists, it belongs to a previous session and must
    // never become the implicit active project for this manager.
    if (await exists(this.repositoryValue.projectDirectory)) await this.startNewProject();
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
        const raw = await readFile(primary, "utf8");
        const state = JSON.parse(raw) as ProjectState;
        summaries.push({ project_id: state.project_id, ...(state.project_name === undefined ? {} : { project_name: state.project_name }), status: state.project_status, path: path.join(this.options.root, entry.name) });
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
    if (requested.length === 0 || requested.includes("/") || requested.includes("\\") || requested === "." || requested === "..") throw new CoreError("PROJECT_SELECTION_INVALID", "請提供可見的專案名稱或資料夾名稱 (project selection must be a project name or id)", true);
    const summaries = await this.listProjects();
    const selected = summaries.find((item) => item.project_id === requested || item.project_name === requested || path.basename(item.path) === requested);
    if (selected === undefined) throw new CoreError("PROJECT_NOT_FOUND", `找不到專案「${requested}」 (project was not found)`, true);
    this.repositoryValue = new FileProjectRepository(this.options.root, path.basename(selected.path), { layout: "project", materialize: true });
    this.runtimeValue = this.options.createRuntime(this.repositoryValue);
    this.placeholderReuseAllowed = false;
    this.sessionPrepared = true;
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
    this.repositoryValue = new FileProjectRepository(this.options.root, id, { layout: "project", materialize: true });
    this.runtimeValue = this.options.createRuntime(this.repositoryValue);
    this.placeholderReuseAllowed = false;
    this.sessionPrepared = true;
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
    if (target !== this.repositoryValue.projectId) await this.repositoryValue.relocate(target);
    const updated = await this.repositoryValue.commit(state.revision, (current) => ({
      ...current,
      project_id: target,
      project_name: projectName,
      project_slug: target,
      project_status: "ready",
    }));
    return {
      ...result,
      project_id: updated.project_id,
      project_path: this.repositoryValue.projectDirectory,
      ...(updated.project_name === undefined ? {} : { project_name: updated.project_name }),
    };
  }

  async request(request: string, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
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
    if (result.status !== "completed" || result.flow === undefined) return this.finalizeIfNamed(result);
    const placeholderState = await this.repositoryValue.read();
    const values = placeholderState.interview.values;
    if (result.flow === "continue") {
      const target = values.continue_project;
      if (typeof target === "string" && target.trim().length > 0) return this.relocateResultToProject(result, target.trim());
    }
    if (result.flow === "legacy_review") {
      const importPath = values.import_path;
      if (typeof importPath === "string" && importPath.trim().length > 0) return this.importLegacyCard(importPath.trim(), result, context);
    }
    if (result.flow === "world") {
      const worldKind = values.world_kind;
      if (typeof worldKind === "string" && worldKind.replace(/\s+/gu, "").includes("既有專案")) {
        const target = values.world_project;
        if (typeof target === "string" && target.trim().length > 0) return this.relocateResultToProject(result, target.trim());
      }
    }
    return this.finalizeIfNamed(result);
  }

  private async relocateResultToProject(result: RequestResult, target: string): Promise<RequestResult> {
    const selected = await this.select(target);
    return {
      ...result,
      project_id: selected.project_id,
      ...(selected.project_name === undefined ? {} : { project_name: selected.project_name }),
      project_path: selected.path,
    };
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
