import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  blueprintSchema,
  projectManifestSchema,
  validateSchema,
  workflowStateV1Schema,
  workflowStateSchema,
  type Blueprint,
  type Diagnostic,
  type ProjectManifest,
  type WorkflowState,
} from "@card-workspace/schemas";

import { parseStructuredFile, scanStructuredFiles } from "./parser.js";
import { resolveProjectDirectory } from "./path-security.js";
import { blueprintFile, workflowJournalFile, workflowProjectionFile } from "./workflow-layout.js";

export interface ProjectValidationResult {
  ok: boolean;
  projectRoot: string;
  manifest?: ProjectManifest;
  workflow?: WorkflowState;
  blueprint?: Blueprint;
  diagnostics: Diagnostic[];
}

function diagnostic(code: string, message: string, file: string, fixability: Diagnostic["fixability"] = "manual"): Diagnostic {
  return { code, severity: "error", message, evidence: [], fixability, location: { file } };
}

async function requiredRegularFile(
  projectRoot: string,
  relativePath: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  let current = projectRoot;
  try {
    let metadata;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        diagnostics.push(diagnostic("PROJECT_PATH_LINK_DENIED", `必要路徑不得使用 symlink 或 junction：${relativePath}`, relativePath));
        return undefined;
      }
    }
    if (!metadata?.isFile()) {
      diagnostics.push(diagnostic("PROJECT_FILE_TYPE_INVALID", `必要路徑不是一般檔案：${relativePath}`, relativePath));
      return undefined;
    }
    return current;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function validateWorkflowJournal(projectRoot: string, diagnostics: Diagnostic[]): Promise<void> {
  const journalPath = await requiredRegularFile(projectRoot, workflowJournalFile, diagnostics);
  if (!journalPath) {
    if (!diagnostics.some((item) => item.location?.file === workflowJournalFile)) {
      diagnostics.push(diagnostic("WORKFLOW_JOURNAL_MISSING", `缺少 ${workflowJournalFile}`, workflowJournalFile, "automatic"));
    }
    return;
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(journalPath));
  } catch {
    diagnostics.push(diagnostic("WORKFLOW_JOURNAL_ENCODING_INVALID", "Workflow journal 必須是有效 UTF-8", workflowJournalFile));
    return;
  }
  raw.split(/\r?\n/u).forEach((line, index) => {
    if (line.length === 0) return;
    try {
      JSON.parse(line);
    } catch {
      diagnostics.push({
        ...diagnostic("WORKFLOW_JOURNAL_JSONL_INVALID", "Workflow journal 每個非空行必須是有效 JSON", workflowJournalFile),
        location: { file: workflowJournalFile, path: [index + 1] },
      });
    }
  });
}

export async function validateProject(
  projectsRoot: string,
  projectId: string,
): Promise<ProjectValidationResult> {
  const projectRoot = await resolveProjectDirectory(projectsRoot, projectId);
  const scan = await scanStructuredFiles(projectRoot);
  const diagnostics = [...scan.diagnostics];
  let manifest: ProjectManifest | undefined;
  let workflow: WorkflowState | undefined;
  let blueprint: Blueprint | undefined;
  let migrationRequired = false;

  const projectPath = await requiredRegularFile(projectRoot, "project.yaml", diagnostics);
  const projectFile = projectPath
    ? scan.files.find((file) => file.filePath === projectPath)
    : undefined;
  if (!projectFile) {
    if (!diagnostics.some((item) => item.location?.file === "project.yaml")) {
      diagnostics.push(diagnostic("PROJECT_MANIFEST_MISSING", "缺少 project.yaml", "project.yaml"));
    }
  } else if (projectFile.data !== undefined) {
    const result = validateSchema(projectManifestSchema, projectFile.data, {
      file: path.relative(projectRoot, projectFile.filePath),
      code: "PROJECT_MANIFEST_INVALID",
    });
    diagnostics.push(...result.diagnostics);
    if (result.ok) manifest = result.data;
  }

  const workflowPath = await requiredRegularFile(projectRoot, workflowProjectionFile, diagnostics);
  const workflowFile = workflowPath
    ? scan.files.find((file) => file.filePath === workflowPath)
    : undefined;
  if (!workflowFile) {
    if (!diagnostics.some((item) => item.location?.file === workflowProjectionFile)) {
      diagnostics.push(diagnostic("WORKFLOW_STATE_MISSING", "缺少 workflow.json", workflowProjectionFile, "automatic"));
    }
  } else if (workflowFile.data !== undefined) {
    const legacy = workflowStateV1Schema.safeParse(workflowFile.data);
    if (legacy.success) {
      migrationRequired = true;
      diagnostics.push(diagnostic(
        "WORKFLOW_MIGRATION_REQUIRED",
        "workflow.json 使用 schema_version 1；請顯式執行 migrateWorkflowProjectV1ToV2",
        workflowProjectionFile,
        "automatic",
      ));
    } else {
      const result = validateSchema(workflowStateSchema, workflowFile.data, {
        file: path.relative(projectRoot, workflowFile.filePath),
        code: "WORKFLOW_STATE_INVALID",
      });
      diagnostics.push(...result.diagnostics);
      if (result.ok) workflow = result.data;
    }
  }

  if (!migrationRequired) {
    const blueprintPath = await requiredRegularFile(projectRoot, blueprintFile, diagnostics);
    const blueprintParsed = blueprintPath
      ? await parseStructuredFile(blueprintPath, { displayPath: blueprintFile })
      : undefined;
    if (!blueprintParsed) {
      if (!diagnostics.some((item) => item.location?.file === blueprintFile)) {
        diagnostics.push(diagnostic("BLUEPRINT_MISSING", `缺少 ${blueprintFile}`, blueprintFile, "automatic"));
      }
    } else {
      diagnostics.push(...blueprintParsed.diagnostics);
      if (blueprintParsed.data !== undefined) {
        const result = validateSchema(blueprintSchema, blueprintParsed.data, {
          file: blueprintFile,
          code: "BLUEPRINT_INVALID",
        });
        diagnostics.push(...result.diagnostics);
        if (result.ok) blueprint = result.data;
      }
    }
    await validateWorkflowJournal(projectRoot, diagnostics);
  }

  if (manifest && workflow && manifest.id !== workflow.project_id) {
    diagnostics.push({
      code: "PROJECT_ID_MISMATCH",
      severity: "error",
      message: `project.yaml 的 ${manifest.id} 與 workflow.json 的 ${workflow.project_id} 不一致`,
      evidence: [],
      fixability: "manual",
      location: {
        file: workflowFile ? path.relative(projectRoot, workflowFile.filePath) : "workflow.json",
      },
    });
  }
  if (manifest && blueprint && manifest.id !== blueprint.project_id) {
    diagnostics.push(diagnostic(
      "BLUEPRINT_PROJECT_ID_MISMATCH",
      `project.yaml 的 ${manifest.id} 與 blueprint.yaml 的 ${blueprint.project_id} 不一致`,
      blueprintFile,
    ));
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    projectRoot,
    ...(manifest ? { manifest } : {}),
    ...(workflow ? { workflow } : {}),
    ...(blueprint ? { blueprint } : {}),
    diagnostics,
  };
}

export async function loadProject(
  projectsRoot: string,
  projectId: string,
): Promise<{ manifest: ProjectManifest; workflow: WorkflowState; blueprint: Blueprint; projectRoot: string }> {
  const result = await validateProject(projectsRoot, projectId);
  if (!result.ok || !result.manifest || !result.workflow || !result.blueprint) {
    const detail = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n");
    throw new Error(`專案驗證失敗\n${detail}`);
  }
  return {
    manifest: result.manifest,
    workflow: result.workflow,
    blueprint: result.blueprint,
    projectRoot: result.projectRoot,
  };
}

export async function readStructuredData(filePath: string): Promise<unknown> {
  const result = await parseStructuredFile(filePath);
  if (result.data === undefined) {
    throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
  }
  return result.data;
}
