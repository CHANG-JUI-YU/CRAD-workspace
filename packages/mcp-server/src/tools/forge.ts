import {
  buildProject,
  importCardSource,
  normalizeAuthorProject,
  planCanonicalProject,
  roundTripImportedCard,
} from "@card-workspace/compiler";
import { auditCharacterCard } from "@card-workspace/diagnostics";
import { loadAuthorProject, validateProject } from "@card-workspace/project";
import { createCompilePreview, publishApprovedPreview } from "@card-workspace/workflow";

import { mcpFail } from "../errors.js";
import { numberArg, stringArg, type ToolCallContext } from "./types.js";

async function loaded(context: ToolCallContext) {
  const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, stringArg(context.args, "project_id"));
  if (!project.ok) mcpFail("PROJECT_INVALID", "Project is not valid", project.diagnostics);
  return project;
}

export const forgeTools = {
  project_validate: (context: ToolCallContext) => validateProject(
    `${context.trusted.workspaceRoot}/projects`,
    stringArg(context.args, "project_id"),
  ),
  project_plan: async (context: ToolCallContext) => {
    const normalized = normalizeAuthorProject(await loaded(context));
    if (!normalized.ok || !normalized.ir) return normalized;
    return { normalized, plan: planCanonicalProject(normalized.ir) };
  },
  project_simulate: (context: ToolCallContext) => buildProject({
    workspaceRoot: context.trusted.workspaceRoot,
    projectId: stringArg(context.args, "project_id"),
    publish: false,
    strict: context.args.strict !== false,
    ...(typeof context.args.token_budget === "number" ? { tokenBudget: context.args.token_budget } : {}),
  }),
  project_compile_preview: (context: ToolCallContext) => createCompilePreview({
    workspaceRoot: context.trusted.workspaceRoot,
    projectId: stringArg(context.args, "project_id"),
    previewId: stringArg(context.args, "preview_id"),
    eventId: stringArg(context.args, "event_id"),
    actor: context.trusted.agentId,
    occurredAt: stringArg(context.args, "occurred_at"),
    build: {
      strict: context.args.strict !== false,
      ...(typeof context.args.token_budget === "number" ? { tokenBudget: numberArg(context.args, "token_budget") } : {}),
    },
  }),
  project_publish: (context: ToolCallContext) => publishApprovedPreview({
    workspaceRoot: context.trusted.workspaceRoot,
    projectId: stringArg(context.args, "project_id"),
    previewId: stringArg(context.args, "preview_id"),
    eventId: stringArg(context.args, "event_id"),
    actor: context.trusted.agentId,
    occurredAt: stringArg(context.args, "occurred_at"),
  }),
  card_import: (context: ToolCallContext) => ({
    envelope: importCardSource(Buffer.from(stringArg(context.args, "bytes_base64"), "base64")),
  }),
  card_audit: (context: ToolCallContext) => auditCharacterCard(context.args.card, {
    strict: context.args.strict !== false,
  }),
  roundtrip_verify: (context: ToolCallContext) => {
    const envelope = importCardSource(Buffer.from(stringArg(context.args, "bytes_base64"), "base64"));
    return { envelope, report: roundTripImportedCard(envelope) };
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
