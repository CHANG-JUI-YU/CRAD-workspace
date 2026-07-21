import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  computeRevision,
  legacyZhujiModuleFiles,
  loadAuthorProject,
  paletteModuleFiles,
  zhujiModuleFiles,
  type LoadedAuthorProject,
} from "@card-workspace/project";
import { verifyFactProjection } from "@card-workspace/ingestion";
import { reviewReportSchema, type WorkflowState } from "@card-workspace/schemas";
import { readCompilePreview } from "@card-workspace/workflow";

import { mcpFail } from "../errors.js";
import { stringArg, type ToolCallContext } from "./types.js";

type ArtifactKind =
  | "blueprint"
  | "character"
  | "character_module"
  | "relationship_module"
  | "world_entry"
  | "greetings"
  | "fact_register"
  | "conflict_register"
  | "review_report"
  | "compile_preview";

interface ArtifactDescriptor {
  artifact_id: string;
  kind: ArtifactKind;
  revision: string;
  status: "missing" | "draft" | "reviewed" | "approved" | "stale";
  contract?: string;
}

interface IndexedArtifact {
  descriptor: ArtifactDescriptor;
  read: () => Promise<unknown>;
}

function authorArtifactId(relativePath: string): string {
  return relativePath === "blueprint.yaml" ? "blueprint" : `author-${relativePath.replace(/[^a-z0-9._-]+/gu, "-")}`;
}

function artifactStatus(workflow: WorkflowState, artifactId: string, revision: string): ArtifactDescriptor["status"] {
  const artifact = workflow.artifacts.find((candidate) => candidate.id === artifactId && candidate.revision === revision);
  return artifact?.status ?? "draft";
}

function contentError(code: "ARTIFACT_CONTENT_UNAVAILABLE" | "ARTIFACT_CONTENT_INVALID", artifactId: string, error: unknown): never {
  mcpFail(code, `Artifact content cannot be read: ${artifactId}`, {
    cause: error instanceof Error ? error.message : String(error),
  });
}

async function hasPreview(projectRoot: string, artifactId: string): Promise<boolean> {
  try {
    await access(path.join(projectRoot, ".workflow", "previews", `${artifactId}.json`));
    return true;
  } catch {
    return false;
  }
}

async function buildArtifactIndex(projectRoot: string, project: LoadedAuthorProject): Promise<Map<string, IndexedArtifact>> {
  if (!project.workflow) mcpFail("PROJECT_INVALID", "Artifact query requires a project workflow");
  const workflow = project.workflow;
  const index = new Map<string, IndexedArtifact>();
  const authorPaths = new Set<string>();
  const add = (entry: IndexedArtifact) => {
    if (index.has(entry.descriptor.artifact_id)) {
      mcpFail("ARTIFACT_CONTENT_INVALID", `Artifact ID is ambiguous: ${entry.descriptor.artifact_id}`);
    }
    index.set(entry.descriptor.artifact_id, entry);
  };
  const addAuthor = (relativePath: string, kind: ArtifactKind, content: unknown, contract?: string) => {
    if (authorPaths.has(relativePath)) return;
    authorPaths.add(relativePath);
    const revision = project.sourceRevisions[relativePath];
    if (!revision) return;
    const artifactId = authorArtifactId(relativePath);
    add({
      descriptor: {
        artifact_id: artifactId,
        kind,
        revision,
        status: artifactStatus(workflow, artifactId, revision),
        ...(contract ? { contract } : {}),
      },
      read: () => Promise.resolve(content),
    });
  };

  if (project.blueprint) addAuthor("blueprint.yaml", "blueprint", project.blueprint);
  if (project.greetings) addAuthor("greetings.yaml", "greetings", project.greetings);
  if (project.relationships) addAuthor("relationships.yaml", "relationship_module", project.relationships, "relationships@1");
  for (const character of project.characters) {
    addAuthor(`characters/${character.manifest.id}/character.yaml`, "character", character.document);
    const layouts = character.manifest.mode === "palette"
      ? [paletteModuleFiles]
      : [zhujiModuleFiles, legacyZhujiModuleFiles];
    for (const layout of layouts) {
      for (const file of layout) {
        const module = character.modules.find((candidate) => candidate.module === file.kind);
        if (module) addAuthor(`characters/${character.manifest.id}/${character.manifest.mode}/${file.file}`, "character_module", module);
      }
    }
  }
  for (const entry of project.world) {
    addAuthor(`world/${entry.category}/${entry.id}.yaml`, "world_entry", entry);
  }

  let factProjection: Awaited<ReturnType<typeof verifyFactProjection>>;
  try {
    factProjection = await verifyFactProjection(projectRoot);
  } catch (error) {
    return contentError("ARTIFACT_CONTENT_INVALID", "fact-register/conflict-register", error);
  }
  const addFactProjection = (
    artifactId: "fact-register" | "conflict-register",
    kind: "fact_register" | "conflict_register",
    contract: "fact-register@1" | "conflict-register@1",
    projection: unknown,
    select: (verified: Awaited<ReturnType<typeof verifyFactProjection>>) => unknown,
  ) => {
    const revision = computeRevision(projection);
    add({
      descriptor: { artifact_id: artifactId, kind, revision, status: "reviewed", contract },
      read: async () => {
        try {
          const current = select(await verifyFactProjection(projectRoot));
          if (computeRevision(current) !== revision) {
            mcpFail("ARTIFACT_REVISION_CONFLICT", `Artifact revision changed while reading: ${artifactId}`);
          }
          return current;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "ARTIFACT_REVISION_CONFLICT") throw error;
          return contentError("ARTIFACT_CONTENT_INVALID", artifactId, error);
        }
      },
    });
  };
  addFactProjection("fact-register", "fact_register", "fact-register@1", factProjection.register, (verified) => verified.register);
  addFactProjection("conflict-register", "conflict_register", "conflict-register@1", factProjection.conflicts, (verified) => verified.conflicts);

  for (const task of workflow.tasks) {
    if (task.status !== "completed" || task.result?.contract !== "review-report@1") continue;
    const result = task.result;
    add({
      descriptor: {
        artifact_id: result.id,
        kind: "review_report",
        revision: result.revision,
        status: "reviewed",
        ...(result.contract ? { contract: result.contract } : {}),
      },
      read: async () => {
        let raw: string;
        try {
          raw = await readFile(path.join(projectRoot, ".workflow", "results", task.id, `${result.id}.json`), "utf8");
        } catch (error) {
          return contentError("ARTIFACT_CONTENT_UNAVAILABLE", result.id, error);
        }
        try {
          const report = reviewReportSchema.parse(JSON.parse(raw));
          if (report.id !== result.id || computeRevision(report) !== result.revision) {
            mcpFail("ARTIFACT_CONTENT_INVALID", `Review report does not match its exact artifact reference: ${result.id}`);
          }
          return report;
        } catch (error) {
          if ((error as { code?: string }).code === "ARTIFACT_CONTENT_INVALID") throw error;
          return contentError("ARTIFACT_CONTENT_INVALID", result.id, error);
        }
      },
    });
  }

  for (const artifact of workflow.artifacts) {
    if (!artifact.revision || index.has(artifact.id) || !(await hasPreview(projectRoot, artifact.id))) continue;
    add({
      descriptor: {
        artifact_id: artifact.id,
        kind: "compile_preview",
        revision: artifact.revision,
        status: artifact.status,
        ...(artifact.contract ? { contract: artifact.contract } : {}),
      },
      read: async () => {
        try {
          const preview = await readCompilePreview(projectRoot, artifact.id);
          if (preview.revision !== artifact.revision) {
            mcpFail("ARTIFACT_CONTENT_INVALID", `Compile preview does not match its exact artifact reference: ${artifact.id}`);
          }
          return preview;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "ARTIFACT_CONTENT_INVALID") throw error;
          if (code === "ENOENT") return contentError("ARTIFACT_CONTENT_UNAVAILABLE", artifact.id, error);
          return contentError("ARTIFACT_CONTENT_INVALID", artifact.id, error);
        }
      },
    });
  }
  return index;
}

async function loadIndex(context: ToolCallContext) {
  const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
  if (agent?.kind !== "director") mcpFail("TOOL_CAPABILITY_DENIED", "Artifact query is Director-only");
  const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
  if (!project.ok || !project.workflow) mcpFail("PROJECT_INVALID", "Artifact query requires a valid author project", project.diagnostics);
  return { project, index: await buildArtifactIndex(context.projectRoot, project) };
}

export const artifactTools = {
  project_artifact_list: async (context: ToolCallContext) => {
    const { project, index } = await loadIndex(context);
    return {
      project_id: project.workflow!.project_id,
      workflow_revision: project.workflow!.revision,
      artifacts: [...index.values()].map((entry) => entry.descriptor)
        .sort((left, right) => left.artifact_id.localeCompare(right.artifact_id)),
    };
  },
  project_artifact_read: async (context: ToolCallContext) => {
    const artifactId = stringArg(context.args, "artifact_id");
    const requestedRevision = stringArg(context.args, "revision");
    const { index } = await loadIndex(context);
    const entry = index.get(artifactId);
    if (!entry) mcpFail("ARTIFACT_NOT_FOUND", `Artifact is not in the controlled project index: ${artifactId}`);
    if (entry.descriptor.revision !== requestedRevision) {
      mcpFail("ARTIFACT_REVISION_CONFLICT", `Artifact revision is stale: ${artifactId}`, {
        expected: entry.descriptor.revision,
        received: requestedRevision,
      });
    }
    return { artifact: entry.descriptor, content: await entry.read() };
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
