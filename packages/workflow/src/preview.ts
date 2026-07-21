import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildProject, stableArtifactHashes, type BuildProjectOptions } from "@card-workspace/compiler";
import {
  canonicalJson,
  computeRevision,
  loadAuthorProject,
  resolveExistingWithin,
} from "@card-workspace/project";
import { workflowStateSchema, type AuditReport } from "@card-workspace/schemas";
import { z } from "zod";

import { workflowFail } from "./errors.js";
import { deriveCurrentContentSnapshot, supersedeStalePluginEvidence } from "./gates.js";
import { commitWorkflowMutation } from "./repository.js";

const previewOptionsSchema = z.object({
  strict: z.boolean(),
  token_budget: z.number().int().positive().optional(),
  json: z.boolean(),
  png: z.boolean(),
  v2_backfill: z.boolean(),
}).strict();

const previewSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
  project_id: z.string().min(1),
  input_revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  workflow_revision: z.number().int().nonnegative(),
  build_workflow_revision: z.number().int().nonnegative(),
  output_kind: z.enum(["character_card", "worldbook"]).optional(),
  options: previewOptionsSchema,
  options_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  audit: z.unknown(),
  artifact_hashes: z.record(z.string(), z.string()),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export type CompilePreview = z.infer<typeof previewSchema> & { audit: AuditReport };

export interface PreviewBuildOptions {
  strict?: boolean;
  tokenBudget?: number;
  json?: boolean;
  png?: boolean;
  v2Backfill?: boolean;
}

function effectiveOptions(input: PreviewBuildOptions, loaded: Awaited<ReturnType<typeof loadAuthorProject>>) {
  if (!loaded.manifest) workflowFail("PREVIEW_PROJECT_INVALID", "專案 manifest 不可用");
  const worldbook = loaded.manifest.kind === "worldbook";
  return previewOptionsSchema.parse({
    strict: input.strict ?? loaded.manifest.policies.strict_publish,
    ...(input.tokenBudget !== undefined ? { token_budget: input.tokenBudget } : {}),
    json: worldbook || (input.json ?? loaded.manifest.output.json),
    png: worldbook ? false : (input.png ?? loaded.manifest.output.png),
    v2_backfill: worldbook ? false : (input.v2Backfill ?? loaded.manifest.output.v2_backfill),
  });
}

function buildOptions(workspaceRoot: string, projectId: string, options: z.infer<typeof previewOptionsSchema>): BuildProjectOptions {
  return {
    workspaceRoot,
    projectId,
    publish: false,
    strict: options.strict,
    ...(options.token_budget !== undefined ? { tokenBudget: options.token_budget } : {}),
    json: options.json,
    png: options.png,
    v2Backfill: options.v2_backfill,
  };
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function refreshPluginEvidence(
  loaded: Awaited<ReturnType<typeof loadAuthorProject>>,
  eventId: string,
  occurredAt: string,
): Promise<boolean> {
  if (!loaded.workflow) return false;
  const refreshed = supersedeStalePluginEvidence(loaded.workflow, loaded.pluginArtifacts ?? [], loaded.pluginSelectionRevision);
  if (refreshed === loaded.workflow) return false;
  await commitWorkflowMutation(loaded.projectRoot, {
    expectedRevision: loaded.workflow.revision,
    eventId,
    actor: "engine",
    occurredAt,
    update: (current) => supersedeStalePluginEvidence(current, loaded.pluginArtifacts ?? [], loaded.pluginSelectionRevision),
  });
  return true;
}

export async function createCompilePreview(options: {
  workspaceRoot: string;
  projectId: string;
  previewId: string;
  eventId: string;
  actor: string;
  occurredAt: string;
  build?: PreviewBuildOptions;
}): Promise<CompilePreview> {
  const projectsRoot = path.join(options.workspaceRoot, "projects");
  const loaded = await loadAuthorProject(projectsRoot, options.projectId);
  if (await refreshPluginEvidence(loaded, `plugin-evidence-${options.eventId}`, options.occurredAt)) {
    workflowFail("PREVIEW_PLUGIN_INPUT_STALE", "plugin input 已變更，既有 Content/Preview evidence 已失效");
  }
  if (!loaded.ok || !loaded.workflow) workflowFail("PREVIEW_PROJECT_INVALID", "preview 前專案必須完整有效");
  if (loaded.workflow.stage !== "compile_preview") workflowFail("PREVIEW_STAGE_INVALID", "preview 只能在 compile_preview stage 建立");
  const contentGate = loaded.workflow.gates.find((gate) => gate.id === "content");
  const currentContent = deriveCurrentContentSnapshot(loaded.workflow);
  if (currentContent.length === 0 || contentGate?.status !== "approved") {
    workflowFail("PREVIEW_CONTENT_NOT_APPROVED", "preview 需要 approved current Content snapshot");
  }
  const normalize = (items: typeof currentContent) => [...items].sort((left, right) => lexicalCompare(left.id, right.id));
  if (JSON.stringify(normalize(contentGate.input_revisions)) !== JSON.stringify(normalize(currentContent))) {
    workflowFail("PREVIEW_CONTENT_SNAPSHOT_STALE", "Content Gate 未批准 exact current Content snapshot");
  }
  const effective = effectiveOptions(options.build ?? {}, loaded);
  const built = await buildProject(buildOptions(options.workspaceRoot, options.projectId, effective));
  const core = {
    schema_version: 1 as const,
    id: options.previewId,
    project_id: options.projectId,
    input_revision: built.inputRevision,
    workflow_revision: loaded.workflow.revision + 1,
    build_workflow_revision: built.manifest.workflow_revision,
    output_kind: built.output.kind,
    options: effective,
    options_hash: computeRevision(effective),
    audit: built.audit,
    artifact_hashes: stableArtifactHashes(built.manifest.artifacts),
    created_at: options.occurredAt,
  };
  const preview = previewSchema.parse({ ...core, revision: computeRevision(core) }) as CompilePreview;
  await commitWorkflowMutation(loaded.projectRoot, {
    expectedRevision: loaded.workflow.revision,
    eventId: options.eventId,
    actor: options.actor,
    occurredAt: options.occurredAt,
    operations: [{
      relativePath: `.workflow/previews/${preview.id}.json`,
      content: canonicalJson(preview),
      expectedAbsent: true,
    }],
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      stage: "publish_review",
      artifacts: [
        ...state.artifacts.map((item) => item.id.startsWith("preview-") && item.status !== "stale" ? { ...item, status: "stale" as const } : item),
        { id: preview.id, status: "reviewed", revision: preview.revision, updated_at: options.occurredAt, extensions: {} },
      ],
      gates: state.gates.map((gate) => gate.id === "publish" && gate.status === "approved" ? { ...gate, status: "superseded" as const } : gate),
    }),
  });
  return preview;
}

export async function readCompilePreview(projectRoot: string, previewId: string): Promise<CompilePreview> {
  const file = await resolveExistingWithin(projectRoot, `.workflow/previews/${previewId}.json`);
  const preview = previewSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const { revision, ...core } = preview;
  if (revision !== computeRevision(core)) workflowFail("PREVIEW_REVISION_INVALID", `preview ${previewId} 內容 hash 無效`);
  return preview as CompilePreview;
}

export async function publishApprovedPreview(options: {
  workspaceRoot: string;
  projectId: string;
  previewId: string;
  eventId: string;
  actor: string;
  occurredAt: string;
  beforePublish?: (index: number, operation: { relativePath: string }) => void | Promise<void>;
}) {
  const loaded = await loadAuthorProject(path.join(options.workspaceRoot, "projects"), options.projectId);
  if (await refreshPluginEvidence(loaded, `plugin-evidence-${options.eventId}`, options.occurredAt)) {
    workflowFail("PUBLISH_PLUGIN_INPUT_STALE", "plugin input 已變更，既有 Publish evidence 已失效");
  }
  if (!loaded.ok || !loaded.workflow) workflowFail("PUBLISH_PROJECT_INVALID", "publish 前專案必須完整有效");
  if (!["publish_review", "published"].includes(loaded.workflow.stage)) {
    workflowFail("PUBLISH_STAGE_INVALID", "project_publish 只能在 publish_review 執行；published 僅供修復舊版已標發布但缺少 export 的專案");
  }
  const preview = await readCompilePreview(loaded.projectRoot, options.previewId);
  const artifact = loaded.workflow.artifacts.find((item) => item.id === preview.id);
  const gate = loaded.workflow.gates.find((item) => item.id === "publish");
  const approvedRef = gate?.input_revisions.find((item) => item.id === preview.id && item.revision === preview.revision);
  if (artifact?.status === "stale" || gate?.status !== "approved" || !approvedRef) {
    workflowFail("PUBLISH_PREVIEW_NOT_APPROVED", "Publish Gate 未批准此 exact preview revision");
  }
  let result;
  try {
    result = await buildProject({
      ...buildOptions(options.workspaceRoot, options.projectId, preview.options),
      buildWorkflowRevision: preview.build_workflow_revision,
      expectedInputRevision: preview.input_revision,
      expectedArtifactHashes: preview.artifact_hashes,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "BUILD_PREVIEW_INPUT_STALE" || code === "BUILD_PREVIEW_HASH_STALE") {
      await commitWorkflowMutation(loaded.projectRoot, {
        expectedRevision: loaded.workflow.revision,
        eventId: `supersede-${preview.id}-${loaded.workflow.revision}`,
        actor: "engine",
        occurredAt: new Date().toISOString(),
        update: (state) => workflowStateSchema.parse({
          ...state,
          revision: state.revision + 1,
          artifacts: state.artifacts.map((item) => item.id === preview.id ? { ...item, status: "stale" as const } : item),
          gates: state.gates.map((item) => item.id === "publish" && item.status === "approved" ? { ...item, status: "superseded" as const } : item),
        }),
      });
    }
    throw error;
  }
  const receipt = {
    schema_version: 1 as const,
    id: options.eventId,
    project_id: options.projectId,
    preview_id: preview.id,
    preview_revision: preview.revision,
    input_revision: result.inputRevision,
    artifact_hashes: preview.artifact_hashes,
    published_at: options.occurredAt,
    actor: options.actor,
  };
  const workflow = await commitWorkflowMutation(loaded.projectRoot, {
    expectedRevision: loaded.workflow.revision,
    eventId: options.eventId,
    actor: options.actor,
    occurredAt: options.occurredAt,
    operations: [{
      relativePath: `.workflow/publish-receipts/${receipt.id}.json`,
      content: canonicalJson(receipt),
      expectedAbsent: true,
    }],
    workspaceTransaction: {
      root: options.workspaceRoot,
      projectPrefix: `projects/${options.projectId}`,
      operations: result.publishPlan.operations,
      expectations: result.publishPlan.expectations,
    },
    ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      stage: "published",
      artifacts: state.artifacts.map((item) => item.id === preview.id
        ? { ...item, status: "approved" as const, updated_at: options.occurredAt }
        : item),
    }),
  });
  return { preview, result: { ...result, published: true }, workflow, receipt };
}
