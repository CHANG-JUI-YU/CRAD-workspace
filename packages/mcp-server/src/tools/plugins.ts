import {
  blueprintPluginSelectionSchema,
  officialPluginIdSchema,
  pluginImplementationPinSchema,
  pluginProposalEnvelopeSchema,
  pluginSourceSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  revisionSchema,
  type Revision,
} from "@card-workspace/schemas";
import {
  canonicalJson,
  computeTextRevision,
  listPluginArtifacts,
  listPluginTemplates,
  loadAuthorProject,
  parsePluginDataText,
  readPluginTemplate,
  savePluginTemplateIdempotent,
} from "@card-workspace/project";
import {
  beginPluginRevision,
  commitWorkflowMutation,
  decidePluginProposal,
  previewPluginRevision,
  submitPluginProposal,
} from "@card-workspace/workflow";
import {
  compileMvuSource,
  generatePluginContributions,
  materializePluginTemplate,
  officialPluginImplementationRegistry,
  revisionFor,
  type TemplateParameterValue,
} from "@card-workspace/plugins";
import { z } from "zod";

import { mcpFail } from "../errors.js";
import { stringArg, numberArg, type ToolCallContext } from "./types.js";

const officialPluginIdRecordSchema = z.partialRecord(officialPluginIdSchema, pluginImplementationPinSchema);
const templateParameterValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
]);
const templateParametersSchema = z.record(z.string(), templateParameterValueSchema);

async function loaded(context: ToolCallContext) {
  const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, stringArg(context.args, "project_id"));
  if (!project.ok) mcpFail("PROJECT_INVALID", "Plugin project is invalid", project.diagnostics);
  return project;
}

function desiredSelections(context: ToolCallContext) {
  return context.args.desired_selections === undefined
    ? undefined
    : z.array(blueprintPluginSelectionSchema).parse(context.args.desired_selections);
}

function implementationPins(context: ToolCallContext) {
  return context.args.implementation_pins === undefined
    ? undefined
    : officialPluginIdRecordSchema.parse(context.args.implementation_pins);
}

function revisionInputs(context: ToolCallContext): {
  desiredSelections?: ReturnType<typeof desiredSelections> extends infer T ? Exclude<T, undefined> : never;
  implementationPins?: ReturnType<typeof implementationPins> extends infer T ? Exclude<T, undefined> : never;
} {
  const result: {
    desiredSelections?: Exclude<ReturnType<typeof desiredSelections>, undefined>;
    implementationPins?: Exclude<ReturnType<typeof implementationPins>, undefined>;
  } = {};
  if (context.args.desired_selections !== undefined) result.desiredSelections = desiredSelections(context)!;
  if (context.args.implementation_pins !== undefined) result.implementationPins = implementationPins(context)!;
  return result;
}

function requireDirector(context: ToolCallContext, code: string): void {
  const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
  if (agent?.kind !== "director") mcpFail(code, "Only the Director may perform this plugin operation");
}

function event(context: ToolCallContext): { eventId: string; occurredAt: string; expectedRevision: number } {
  return {
    eventId: stringArg(context.args, "event_id"),
    occurredAt: stringArg(context.args, "occurred_at"),
    expectedRevision: numberArg(context.args, "expected_workflow_revision"),
  };
}

function generationContext(project: Awaited<ReturnType<typeof loaded>>) {
  const mvu = project.pluginSources?.find((item) => item.plugin_id === "official.mvu-zod");
  return {
    ...(mvu ? { mvuPathRegistry: compileMvuSource(mvu).path_registry } : {}),
    ...(project.greetings ? { greetingIds: project.greetings.greetings.map((greeting) => greeting.id) } : {}),
    implementationRegistry: officialPluginImplementationRegistry,
  };
}

function templateExpectedRevisions(context: ToolCallContext): { manifest: Revision; payload: Revision } | undefined {
  const manifest = context.args.expected_manifest_revision;
  const payload = context.args.expected_payload_revision;
  if (manifest === undefined && payload === undefined) return undefined;
  if (typeof manifest !== "string" || typeof payload !== "string") {
    mcpFail(
      "PLUGIN_TEMPLATE_CAS_INVALID",
      "template 覆寫必須同時提供 expected_manifest_revision 與 expected_payload_revision",
    );
  }
  return { manifest: revisionSchema.parse(manifest), payload: revisionSchema.parse(payload) };
}

function templateOverrides(context: ToolCallContext): Readonly<Record<string, TemplateParameterValue>> {
  return templateParametersSchema.parse(context.args.template_parameters ?? {}) as Record<string, TemplateParameterValue>;
}

async function resolvedProposalSource(
  context: ToolCallContext,
  proposal: ReturnType<typeof pluginProposalEnvelopeSchema.parse>,
): Promise<{
  source: ReturnType<typeof pluginSourceSchema.parse>;
  templatePayloadHash?: Revision;
}> {
  if (proposal.value.template_id === undefined) return { source: proposal.value.source };
  const template = await readPluginTemplate(context.projectRoot, proposal.value.plugin_id, proposal.value.template_id);
  if (!template) mcpFail("PLUGIN_TEMPLATE_NOT_FOUND", "proposal 指定的 plugin template 不存在");
  const materialized = materializePluginTemplate(template.manifest, template.payload, templateOverrides(context));
  if (canonicalJson(materialized.source) !== canonicalJson(proposal.value.source)) {
    mcpFail("PLUGIN_TEMPLATE_SOURCE_MISMATCH", "proposal source 必須等於 template 套用後的 resolved source");
  }
  return { source: materialized.source, templatePayloadHash: materialized.template_payload_hash };
}

export const pluginTools = {
  plugin_selection_resolve: async (context: ToolCallContext) => {
    const project = await loaded(context);
    return {
      project_id: project.manifest?.id,
      project_kind: project.manifest?.kind,
      blueprint_selections: project.blueprint?.plugins ?? [],
      selection: project.pluginSelection,
      selection_revision: project.pluginSelectionRevision,
       sources: project.pluginSources?.map((source) => ({
         plugin_id: source.plugin_id,
         revision: project.sourceRevisions[`extensions/${source.plugin_id}/source.yaml`],
         source,
       })) ?? [],
      artifacts: project.pluginArtifacts ?? [],
      diagnostics: project.diagnostics,
    };
  },

  plugin_revision_preview: async (context: ToolCallContext) => {
    const project = await loaded(context);
    const intent = previewPluginRevision({
      project,
      ...revisionInputs(context),
    });
    return { intent };
  },

  plugin_revision_begin: async (context: ToolCallContext) => {
    requireDirector(context, "PLUGIN_REVISION_DENIED");
    const project = await loaded(context);
    const input = event(context);
    const next = beginPluginRevision({
      state: context.workflow,
      project,
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
      ...revisionInputs(context),
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },

  plugin_proposal_preview: async (context: ToolCallContext) => {
    const project = await loaded(context);
    const proposal = pluginProposalEnvelopeSchema.parse(context.args.proposal);
    const resolved = await resolvedProposalSource(context, proposal);
    const generated = generatePluginContributions(resolved.source, generationContext(project));
    if (generated.metadata.resolved_source_hash !== proposal.value.resolved_source_hash) {
      mcpFail("PLUGIN_RESOLVED_SOURCE_MISMATCH", "proposal resolved_source_hash 與 template/source 生成結果不一致");
    }
    return {
      plugin_id: proposal.value.plugin_id,
      proposal_revision: proposal.proposal_revision,
      artifact_revision: generated.artifact_revision,
      resolved_source_hash: generated.metadata.resolved_source_hash,
      resolved_source: resolved.source,
      ...(resolved.templatePayloadHash ? { template_payload_hash: resolved.templatePayloadHash } : {}),
      metadata: generated.metadata,
      contribution_counts: {
        lore_entries: generated.lore_entries.length,
        regex_scripts: generated.regex_scripts.length,
        helper_scripts: generated.helper_scripts.length,
        greeting_operations: generated.greeting_operations.length,
      },
    };
  },

  plugin_proposal_submit: async (context: ToolCallContext) => {
    const proposal = pluginProposalEnvelopeSchema.parse(context.args.proposal);
    const input = event(context);
    if (input.expectedRevision !== context.workflow.revision) {
      mcpFail("PLUGIN_PROPOSAL_WORKFLOW_STALE", "plugin proposal workflow revision 已過期");
    }
    const next = await submitPluginProposal({
      projectRoot: context.projectRoot,
      state: context.workflow,
      taskId: stringArg(context.args, "task_id"),
      owner: context.trusted.agentId,
      proposal,
      occurredAt: input.occurredAt,
    });
    return next;
  },

  plugin_review_decide: async (context: ToolCallContext) => {
    requireDirector(context, "PLUGIN_REVIEW_DENIED");
    const project = await loaded(context);
    const proposal = pluginProposalEnvelopeSchema.parse(context.args.proposal);
    const action = z.enum(["approve", "reject"]).parse(context.args.action);
    const input = event(context);
    if (input.expectedRevision !== context.workflow.revision) {
      mcpFail("PLUGIN_REVIEW_WORKFLOW_STALE", "plugin review workflow revision 已過期");
    }
    return decidePluginProposal({
      projectRoot: context.projectRoot,
      project,
      state: context.workflow,
      proposal,
      action,
      occurredAt: input.occurredAt,
      authorizationToken: stringArg(context.args, "authorization_token"),
      ...(typeof context.args.authenticated_session_id === "string"
        ? { authenticatedSessionId: context.args.authenticated_session_id }
        : {}),
    });
  },

  template_list: async (context: ToolCallContext) => {
    const pluginId = context.args.plugin_id === undefined ? undefined : officialPluginIdSchema.parse(context.args.plugin_id);
    return listPluginTemplates(context.projectRoot, pluginId);
  },

  template_read: async (context: ToolCallContext) => {
    const pluginId = officialPluginIdSchema.parse(context.args.plugin_id);
    const template = await readPluginTemplate(context.projectRoot, pluginId, stringArg(context.args, "template_id"));
    if (!template) mcpFail("PLUGIN_TEMPLATE_NOT_FOUND", "找不到指定 plugin template");
    return template;
  },

  template_import: async (context: ToolCallContext) => {
    requireDirector(context, "PLUGIN_TEMPLATE_IMPORT_DENIED");
    const pluginId = officialPluginIdSchema.parse(context.args.plugin_id);
    const templateId = stringArg(context.args, "template_id");
    const manifest = pluginTemplateManifestSchema.parse(context.args.manifest);
    const payload = pluginTemplatePayloadSchema.parse(context.args.payload);
    materializePluginTemplate(manifest, payload);
    const result = await savePluginTemplateIdempotent(
      context.projectRoot,
      pluginId,
      templateId,
      manifest,
      payload,
      templateExpectedRevisions(context),
    );
    return { plugin_id: pluginId, template_id: templateId, saved: result.status !== "unchanged", status: result.status };
  },

  template_save_from_artifact: async (context: ToolCallContext) => {
    requireDirector(context, "PLUGIN_TEMPLATE_IMPORT_DENIED");
    const pluginId = officialPluginIdSchema.parse(context.args.plugin_id);
    const templateId = stringArg(context.args, "template_id");
    const artifactId = stringArg(context.args, "artifact_id");
    const artifactEnvelope = (await listPluginArtifacts(context.projectRoot)).find((candidate) => candidate.artifact.id === artifactId);
    if (artifactEnvelope === undefined) {
      mcpFail("PLUGIN_ARTIFACT_NOT_APPROVED", "只能從 approved plugin artifact 儲存 template");
    }
    if (artifactEnvelope.artifact.plugin_id !== pluginId || artifactEnvelope.artifact.status !== "approved") {
      mcpFail("PLUGIN_ARTIFACT_NOT_APPROVED", "只能從 approved plugin artifact 儲存 template");
    }
    const rawValue = parsePluginDataText(artifactEnvelope.raw, "json");
    if (rawValue === null || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      mcpFail("PLUGIN_ARTIFACT_INVALID", "plugin artifact envelope 必須是 object");
    }
    const source = pluginSourceSchema.parse((rawValue as Record<string, unknown>).source);
    if (source.plugin_id !== pluginId) {
      mcpFail("PLUGIN_ARTIFACT_INVALID", "approved plugin artifact source 與 plugin_id 不一致");
    }
    const templateSource = pluginSourceSchema.parse({ ...source, template_id: templateId });
    const existingTemplate = await readPluginTemplate(context.projectRoot, pluginId, templateId);
    const payload = pluginTemplatePayloadSchema.parse({
      schema_version: 1,
      template_id: templateId,
      plugin_id: pluginId,
      parameters: {},
      payload: templateSource,
    });
    const manifest = pluginTemplateManifestSchema.parse({
      schema_version: 1,
      id: templateId,
      plugin_id: pluginId,
      implementation: artifactEnvelope.artifact.implementation,
      description: typeof context.args.description === "string" && context.args.description.length > 0
        ? context.args.description
        : `Saved from ${artifactId}`,
      parameters: [],
      payload_revision: computeTextRevision(canonicalJson(payload)),
      source_revision: revisionFor(templateSource),
      resolved_source_hash: revisionFor(templateSource),
      provenance: { kind: "approved_source", artifact_id: artifactId },
      created_at: existingTemplate?.manifest.created_at ?? new Date().toISOString(),
    });
    materializePluginTemplate(manifest, payload);
    const result = await savePluginTemplateIdempotent(
      context.projectRoot,
      pluginId,
      templateId,
      manifest,
      payload,
      templateExpectedRevisions(context),
    );
    return {
      plugin_id: pluginId,
      template_id: templateId,
      artifact_id: artifactId,
      saved: result.status !== "unchanged",
      status: result.status,
    };
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
