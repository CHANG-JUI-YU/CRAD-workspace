import { z } from "zod";

import {
  officialPluginIdSchema,
  pluginCapabilitySchema,
  pluginImplementationPinSchema,
  pluginSelectionSchema,
  pluginSourceSchema,
  jsonPointerPathSchema,
  type PluginSource,
} from "./plugins.js";
import type { blueprintPluginSelectionSchema } from "./plugins.js";
import { jsonValueSchema } from "./json.js";
import { revisionSchema, stableIdSchema } from "./ids.js";

const hexRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const rawRevisionSchema = z.union([revisionSchema, z.literal("absent")]);
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const scalarArraySchema = z.array(scalarSchema);

export const pluginTemplateParameterTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "null",
  "scalar_array",
]);

export const pluginTemplateParameterSchema = z
  .object({
    pointer: jsonPointerPathSchema,
    type: pluginTemplateParameterTypeSchema,
    required: z.boolean().default(false),
    default: z.union([scalarSchema, scalarArraySchema]).optional(),
  })
  .strict()
  .superRefine((parameter, context) => {
    if (parameter.required && parameter.default !== undefined) {
      context.addIssue({ code: "custom", path: ["default"], message: "required template parameter 不可設定 default" });
    }
    if (parameter.type === "scalar_array" && parameter.default !== undefined && !Array.isArray(parameter.default)) {
      context.addIssue({ code: "custom", path: ["default"], message: "scalar_array parameter 的 default 必須是陣列" });
    }
    if (parameter.type !== "scalar_array" && Array.isArray(parameter.default)) {
      context.addIssue({ code: "custom", path: ["default"], message: "scalar parameter 不可使用陣列 default" });
    }
    if (parameter.default !== undefined && parameter.type !== "scalar_array") {
      const expectedType = parameter.type === "number" ? "number" : parameter.type === "boolean" ? "boolean" : "string";
      if (typeof parameter.default !== expectedType) {
        context.addIssue({ code: "custom", path: ["default"], message: `${parameter.type} parameter 的 default 型別不符` });
      }
    }
  });

export const pluginTemplateProvenanceSchema = z
  .object({
    kind: z.enum(["imported", "approved_source"]),
    artifact_id: stableIdSchema.optional(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (provenance.kind === "approved_source" && provenance.artifact_id === undefined) {
      context.addIssue({ code: "custom", path: ["artifact_id"], message: "approved_source template 必須綁定 artifact_id" });
    }
    if (provenance.kind === "imported" && provenance.artifact_id !== undefined) {
      context.addIssue({ code: "custom", path: ["artifact_id"], message: "imported template 不可宣稱 approved artifact provenance" });
    }
  });

export const pluginTemplateManifestSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    plugin_id: officialPluginIdSchema,
    implementation: pluginImplementationPinSchema,
    description: z.string().min(1),
    parameters: z.array(pluginTemplateParameterSchema),
    payload_revision: revisionSchema,
    source_revision: revisionSchema,
    resolved_source_hash: revisionSchema,
    provenance: pluginTemplateProvenanceSchema,
    created_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const pluginTemplatePayloadSchema = z
  .object({
    schema_version: z.literal(1),
    template_id: stableIdSchema,
    plugin_id: officialPluginIdSchema,
    parameters: z.record(z.string(), z.union([scalarSchema, scalarArraySchema])),
    payload: jsonValueSchema,
  })
  .strict();

export const pluginProposalValueSchema = z
  .object({
    kind: z.literal("plugin"),
    project_kind: z.literal("character_card"),
    plugin_id: officialPluginIdSchema,
    capabilities: z.array(pluginCapabilitySchema).min(1),
    source: pluginSourceSchema,
    expected_source_revision: rawRevisionSchema,
    expected_manifest_revision: rawRevisionSchema,
    template_id: stableIdSchema.optional(),
    template_payload_hash: revisionSchema.optional(),
    resolved_source_hash: revisionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source.plugin_id !== value.plugin_id) {
      context.addIssue({ code: "custom", path: ["source", "plugin_id"], message: "proposal plugin_id 與 source 不一致" });
    }
    if (value.template_id !== value.source.template_id) {
      context.addIssue({ code: "custom", path: ["template_id"], message: "proposal template_id 必須與 source template_id 一致" });
    }
    if (value.expected_manifest_revision === "absent") {
      context.addIssue({ code: "custom", path: ["expected_manifest_revision"], message: "project manifest 必須以現存 raw revision 做 CAS" });
    }
    const capabilitySet = new Set(value.capabilities);
    if (value.plugin_id === "official.mvu-zod" && !capabilitySet.has("mvu")) {
      context.addIssue({ code: "custom", path: ["capabilities"], message: "MVU proposal 必須宣告 mvu" });
    }
    if (value.plugin_id === "official.ejs" && !capabilitySet.has("ejs")) {
      context.addIssue({ code: "custom", path: ["capabilities"], message: "EJS proposal 必須宣告 ejs" });
    }
    const expectedCapabilities = value.plugin_id === "official.mvu-zod"
      ? ["mvu"]
      : value.plugin_id === "official.ejs"
        ? ["ejs"]
        : value.source.plugin_id === "official.html"
          ? value.source.features.map((feature) => `html.${feature}`)
          : [];
    if (JSON.stringify([...new Set(value.capabilities)].sort()) !== JSON.stringify([...new Set(expectedCapabilities)].sort())) {
      context.addIssue({ code: "custom", path: ["capabilities"], message: "proposal capabilities 必須與 typed source 完全一致" });
    }
  });

export const pluginProposalEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    task_id: stableIdSchema,
    project_id: stableIdSchema,
    owner: stableIdSchema,
    proposal_revision: revisionSchema,
    base_workflow_revision: z.number().int().nonnegative(),
    value: pluginProposalValueSchema,
    pending_result_revision: revisionSchema,
    submitted_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const pluginSelectionProjectionSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    intent_revision: revisionSchema,
    selections: z.array(pluginSelectionSchema),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((projection, context) => {
    const ids = new Set<string>();
    projection.selections.forEach((selection, index) => {
      if (ids.has(selection.plugin_id)) {
        context.addIssue({ code: "custom", path: ["selections", index, "plugin_id"], message: `selection plugin ID 重複: ${selection.plugin_id}` });
      }
      ids.add(selection.plugin_id);
    });
  });

export const pluginArtifactIdSchema = z.enum([
  "plugin-official.mvu-zod",
  "plugin-official.ejs",
  "plugin-official.html",
]);

export const pluginArtifactSchema = z
  .object({
    id: pluginArtifactIdSchema,
    plugin_id: officialPluginIdSchema,
    revision: revisionSchema,
    source_revision: revisionSchema,
    resolved_source_hash: revisionSchema,
    template_payload_hash: revisionSchema.optional(),
    implementation: pluginImplementationPinSchema,
    generated_at: z.string().datetime({ offset: true }),
    status: z.enum(["draft", "reviewed", "approved", "stale"]),
  })
  .strict()
  .superRefine((artifact, context) => {
    const expected = `plugin-${artifact.plugin_id}`;
    if (artifact.id !== expected) {
      context.addIssue({ code: "custom", path: ["id"], message: "plugin artifact ID 必須與 plugin_id 對應" });
    }
  });

export const pluginBuildTraceSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    input_revision: revisionSchema,
  plugins: z.array(pluginArtifactSchema),
  compatibility_profile: z.string().min(1),
  compatibility_profile_revision: revisionSchema,
  selection_revision: z.union([revisionSchema, z.literal("absent")]),
  contribution_hashes: z.record(z.string(), revisionSchema),
    diagnostics_summary: z.object({
      errors: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative(),
      info: z.number().int().nonnegative(),
    }).strict(),
    timings_ms: z.record(z.string(), z.number().finite().nonnegative()),
    generated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const pluginUserAuthorizationEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    token_hash: hexRevisionSchema,
    project_id: stableIdSchema,
    proposal_id: stableIdSchema,
    proposal_revision: revisionSchema,
    decision: z.enum(["approve", "reject"]),
    workflow_revision: z.number().int().nonnegative(),
    session_id: z.string().regex(/^[A-Za-z0-9_-]{32,}$/u),
    nonce: hexRevisionSchema,
    expires_at: z.string().datetime({ offset: true }),
    consumed_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const pluginRuntimeAssetSchema = z
  .object({
    id: stableIdSchema,
    url: z.string().url(),
    content_hash: revisionSchema,
    allowed_use: z.enum(["mvu_runtime", "html_runtime"]),
    redirect_policy: z.literal("same_url_only"),
  })
  .strict();

export type PluginTemplateManifest = z.infer<typeof pluginTemplateManifestSchema>;
export type PluginTemplatePayload = z.infer<typeof pluginTemplatePayloadSchema>;
export type PluginTemplateProvenance = z.infer<typeof pluginTemplateProvenanceSchema>;
export type PluginProposalValue = z.infer<typeof pluginProposalValueSchema>;
export type PluginProposalEnvelope = z.infer<typeof pluginProposalEnvelopeSchema>;
export type PluginSelectionProjection = z.infer<typeof pluginSelectionProjectionSchema>;
export type PluginArtifact = z.infer<typeof pluginArtifactSchema>;
export type PluginBuildTrace = z.infer<typeof pluginBuildTraceSchema>;
export type PluginUserAuthorizationEnvelope = z.infer<typeof pluginUserAuthorizationEnvelopeSchema>;
export type PluginRuntimeAsset = z.infer<typeof pluginRuntimeAssetSchema>;
export type PluginSourceContract = PluginSource;
export type BlueprintPluginSelectionContract = z.infer<typeof blueprintPluginSelectionSchema>;
