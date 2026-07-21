import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const workflowEntryKindSchema = z.enum([
  "original",
  "source_adaptation",
  "card_import",
  "mode_conversion",
]);

export const workflowStageSchema = z.enum([
  "intake",
  "source_processing",
  "facts_review",
  "blueprint",
  "pre_world_authoring",
  "pre_world_review",
  "authoring",
  "semantic_review",
  "post_world_authoring",
  "post_world_review",
  "greetings_authoring",
  "plugin_mvu_authoring",
  "plugin_mvu_review",
  "plugin_ejs_authoring",
  "plugin_ejs_review",
  "plugin_html_authoring",
  "plugin_html_review",
  "content_review",
  "compile_preview",
  "publish_review",
  "published",
]);

export const workflowGateIdSchema = z.enum(["facts", "blueprint", "content", "publish"]);
export const gateRejectionRouteSchema = z.enum(["facts_recuration", "blueprint_successor", "content_revision", "repreview", "cancel"]);
export const contentRevisionScopeSchema = z.enum(["character", "relationship", "world", "greetings"]);
export const gateStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "superseded",
  "not_required",
]);

export const taskStatusSchema = z.enum([
  "pending",
  "claimed",
  "completed",
  "failed",
  "retryable",
  "needs_user_decision",
  "superseded",
]);

export const taskFailureCategorySchema = z.enum([
  "provider_timeout",
  "tool_failure",
  "context_limit",
  "session_interruption",
  "temporary_unavailable",
  "invalid_output",
  "revision_conflict",
  "semantic_failure",
  "policy_violation",
  "artifact_integrity",
  "unknown",
]);

export const taskFailureSchema = z.object({
  category: taskFailureCategorySchema,
  summary: z.string().min(1),
  failed_at: z.string().datetime({ offset: true }),
  failed_by: stableIdSchema,
  attempt: z.number().int().nonnegative(),
}).strict();

export const taskClarificationOptionSchema = z.object({
  id: stableIdSchema,
  label: z.string().min(1),
  consequence: z.string().min(1),
}).strict();

export const taskClarificationSchema = z.object({
  id: stableIdSchema,
  status: z.enum(["pending", "resolved"]),
  question: z.string().min(1),
  reason: z.string().min(1),
  uncertainty: z.literal("high"),
  impact: z.literal("high"),
  affected_modules: z.array(stableIdSchema).min(1),
  options: z.array(taskClarificationOptionSchema).min(2).max(5),
  requested_at: z.string().datetime({ offset: true }),
  resolved_at: z.string().datetime({ offset: true }).optional(),
  answer: z.string().min(1).optional(),
  selected_option: stableIdSchema.optional(),
}).strict().superRefine((clarification, context) => {
  if (clarification.status === "resolved" && (clarification.resolved_at === undefined || clarification.answer === undefined)) {
    context.addIssue({ code: "custom", message: "resolved clarification 必須包含 resolved_at 與 answer" });
  }
  if (clarification.status === "pending" && (clarification.resolved_at !== undefined || clarification.answer !== undefined || clarification.selected_option !== undefined)) {
    context.addIssue({ code: "custom", message: "pending clarification 不可包含解答欄位" });
  }
  if (clarification.selected_option !== undefined && !clarification.options.some((option) => option.id === clarification.selected_option)) {
    context.addIssue({ code: "custom", path: ["selected_option"], message: "selected_option 必須引用既有選項" });
  }
});

export const blueprintPrecheckDimensionSchema = z.enum([
  "character_core",
  "background",
  "personality",
  "relationships_boundaries",
  "world_dependencies",
  "cross_module_impact",
]);

export const blueprintPrecheckCheckSchema = z.object({
  subject_id: stableIdSchema,
  dimension: blueprintPrecheckDimensionSchema,
  uncertainty: z.enum(["low", "high"]),
  impact: z.enum(["low", "high"]),
  basis: z.string().min(1),
  action: z.enum(["preserve_explicit", "safe_extension", "user_confirmed"]),
  user_answer: z.string().min(1).optional(),
}).strict().superRefine((check, context) => {
  if (check.action === "user_confirmed" && check.user_answer === undefined) {
    context.addIssue({ code: "custom", path: ["user_answer"], message: "user_confirmed 必須保存使用者答案" });
  }
  if (check.action !== "user_confirmed" && check.user_answer !== undefined) {
    context.addIssue({ code: "custom", path: ["user_answer"], message: "只有 user_confirmed 可保存 user_answer" });
  }
  if (check.uncertainty === "high" && check.impact === "high" && check.action === "safe_extension") {
    context.addIssue({ code: "custom", path: ["action"], message: "高不確定且高影響項目不可由模型自行補完" });
  }
});

export const blueprintPrecheckReportSchema = z.object({
  schema_version: z.literal(1),
  candidate_blueprint_revision: revisionSchema,
  recorded_at: z.string().datetime({ offset: true }),
  checks: z.array(blueprintPrecheckCheckSchema).min(1),
}).strict();

export const contractReferenceSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*@[1-9][0-9]*$/, "必須是 schema-id@version");

export const artifactReferenceSchema = z
  .object({
    id: stableIdSchema,
    revision: revisionSchema,
    contract: contractReferenceSchema.optional(),
  })
  .strict();

export const workflowArtifactSchema = z
  .object({
    id: stableIdSchema,
    status: z.enum(["missing", "draft", "reviewed", "approved", "stale"]),
    revision: revisionSchema.optional(),
    updated_at: z.string().datetime({ offset: true }),
    contract: contractReferenceSchema.optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const workflowGateSchema = z
  .object({
    id: workflowGateIdSchema,
    status: gateStatusSchema,
    decision_id: stableIdSchema.optional(),
    input_revisions: z.array(artifactReferenceSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const taskLeaseSchema = z
  .object({
    id: stableIdSchema,
    owner: stableIdSchema,
    claimed_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const workflowTaskSchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    status: taskStatusSchema,
    assigned_agent: stableIdSchema,
    capabilities: z.array(stableIdSchema).default([]),
    input_artifacts: z.array(artifactReferenceSchema).default([]),
    output_contract: contractReferenceSchema,
    dependencies: z.array(stableIdSchema).default([]),
    lease: taskLeaseSchema.optional(),
    attempt: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
    result: artifactReferenceSchema.optional(),
    failure_summary: z.string().min(1).optional(),
    failure: taskFailureSchema.optional(),
    clarifications: z.array(taskClarificationSchema).optional(),
    blueprint_precheck: blueprintPrecheckReportSchema.optional(),
    resume_without_attempt: z.boolean().optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const workflowDecisionSchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    actor: stableIdSchema,
    decided_at: z.string().datetime({ offset: true }),
    input_revisions: z.array(artifactReferenceSchema).default([]),
    summary: z.string().min(1),
    option: stableIdSchema.optional(),
    impact: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type WorkflowEntryKind = z.infer<typeof workflowEntryKindSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;
export type WorkflowTask = z.infer<typeof workflowTaskSchema>;
export type TaskFailureCategory = z.infer<typeof taskFailureCategorySchema>;
export type TaskFailure = z.infer<typeof taskFailureSchema>;
export type WorkflowGate = z.infer<typeof workflowGateSchema>;
export type GateRejectionRoute = z.infer<typeof gateRejectionRouteSchema>;
export type ContentRevisionScope = z.infer<typeof contentRevisionScopeSchema>;
export type WorkflowArtifact = z.infer<typeof workflowArtifactSchema>;
export type WorkflowDecision = z.infer<typeof workflowDecisionSchema>;
export type TaskClarification = z.infer<typeof taskClarificationSchema>;
export type TaskClarificationOption = z.infer<typeof taskClarificationOptionSchema>;
export type BlueprintPrecheckDimension = z.infer<typeof blueprintPrecheckDimensionSchema>;
export type BlueprintPrecheckCheck = z.infer<typeof blueprintPrecheckCheckSchema>;
export type BlueprintPrecheckReport = z.infer<typeof blueprintPrecheckReportSchema>;
export type ArtifactReference = z.infer<typeof artifactReferenceSchema>;
export type ContractReference = z.infer<typeof contractReferenceSchema>;
