import { access, readdir } from "node:fs/promises";
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

  constructor(private readonly options: WorkspaceProjectManagerOptions) {
    const initialProjectId = options.initialProjectId ?? "project-001";
    this.repositoryValue = new FileProjectRepository(options.root, initialProjectId, { layout: "project", materialize: true });
    this.runtimeValue = options.createRuntime(this.repositoryValue);
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
    await this.repositoryValue.read();
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
      if (!(await exists(stateFile)) && !(await exists(legacyStateFile))) continue;
      try {
        const repository = new FileProjectRepository(this.options.root, entry.name, { layout: "project", materialize: true });
        const state = await repository.read();
        summaries.push({ project_id: state.project_id, ...(state.project_name === undefined ? {} : { project_name: state.project_name }), status: state.project_status, path: repository.projectDirectory });
      } catch {
        // An incomplete directory is not presented as a selectable project.
      }
    }
    return summaries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async select(project: string): Promise<WorkspaceProjectSummary> {
    const requested = project.trim();
    if (requested.length === 0 || requested.includes("/") || requested.includes("\\") || requested === "." || requested === "..") throw new CoreError("PROJECT_SELECTION_INVALID", "請提供可見的專案名稱或資料夾名稱 (project selection must be a project name or id)", true);
    const summaries = await this.listProjects();
    const selected = summaries.find((item) => item.project_id === requested || item.project_name === requested || path.basename(item.path) === requested);
    if (selected === undefined) throw new CoreError("PROJECT_NOT_FOUND", `找不到專案「${requested}」 (project was not found)`, true);
    this.repositoryValue = new FileProjectRepository(this.options.root, selected.project_id, { layout: "project", materialize: true });
    this.runtimeValue = this.options.createRuntime(this.repositoryValue);
    this.placeholderReuseAllowed = false;
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
    const updated = await this.repositoryValue.commit(state.revision, (current) => ({
      ...current,
      project_id: target,
      project_name: projectName,
      project_slug: target,
      project_status: "ready",
    }));
    if (target !== this.repositoryValue.projectId) await this.repositoryValue.relocate(target);
    return {
      ...result,
      project_id: updated.project_id,
      project_path: this.repositoryValue.projectDirectory,
      ...(updated.project_name === undefined ? {} : { project_name: updated.project_name }),
    };
  }

  async request(request: string, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    if (/^(?:建立|新增|開始|start|new)\s*(?:新)?專案|^new project/iu.test(request.trim())) {
      const current = await this.repositoryValue.read();
      const canReusePlaceholder = this.placeholderReuseAllowed && current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0;
      if (!canReusePlaceholder) await this.startNewProject();
      this.placeholderReuseAllowed = false;
    }
    return this.finalizeIfNamed(await this.runtimeValue.request(request, context, options));
  }

  async answerInterview(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    return this.finalizeIfNamed(await this.runtimeValue.answerInterview(answer, context));
  }

  async interviewContext(): Promise<ReturnType<WorkspaceRuntime["interviewContext"]>> {
    return this.runtimeValue.interviewContext();
  }

  async status(): Promise<RequestResult> {
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
