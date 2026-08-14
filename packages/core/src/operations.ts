import { z } from "zod";
import { coverageRequirementIdSchema } from "./coverage.js";
import { factDecisionSchema, templateProposalValueSchema } from "./templates.js";
import { zhujiProposalValueSchema } from "./zhuji.js";
import type { IssueSeverity, OperationAttachmentRef, OperationProgress, OperationStatus } from "./project-state.js";

export const sourceSelectionCommandDecisionSchema = z.object({
  candidate_id: z.string().min(1),
  decision: z.enum(["approve", "reject", "approved", "rejected"]).transform((value) => value === "approved" ? "approve" as const : value === "rejected" ? "reject" as const : value),
}).strict();

export const sourceSelectCommandPayloadSchema = z.object({
  decisions: z.array(sourceSelectionCommandDecisionSchema).min(1),
}).strict();

export const issueUpdateCommandPayloadSchema = z.object({
  issue_id: z.string().min(1),
  action: z.enum(["resolve", "ignore", "override"]),
  reason: z.string().min(1),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
}).strict().transform((value): IssueUpdateCommandPayload => value.severity === undefined
  ? { issue_id: value.issue_id, action: value.action, reason: value.reason }
  : { issue_id: value.issue_id, action: value.action, reason: value.reason, severity: value.severity });

export const factReviewCommandPayloadSchema = z.object({
  decisions: z.array(factDecisionSchema).min(1).optional(),
}).strict();

export const coverageResearchCandidateCommandItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  canonical_url: z.string().url().optional(),
  snippet: z.string().optional(),
  domain: z.string().optional(),
  official: z.boolean().optional(),
  target_requirement_ids: z.array(z.string().min(1)).optional(),
}).strict();

export const coverageResearchStartCommandPayloadSchema = z.object({
  assessment_id: z.string().min(1),
  assessment_revision: z.string().min(1),
}).strict();

export const coverageResearchClaimCommandPayloadSchema = z.object({
  batch_id: z.string().min(1),
  lease_duration_ms: z.number().int().positive().optional(),
}).strict();

export const coverageResearchCandidatesCommandPayloadSchema = z.object({
  task_id: z.string().min(1),
  claim_generation: z.number().int().nonnegative(),
  lease_owner: z.string().min(1),
  candidates: z.array(coverageResearchCandidateCommandItemSchema).min(1),
}).strict();

export const coverageResearchExhaustCommandPayloadSchema = z.object({
  task_id: z.string().min(1),
  claim_generation: z.number().int().nonnegative(),
  lease_owner: z.string().min(1),
  searched_queries: z.array(z.string().min(1)),
  source_families: z.array(z.string().min(1)),
  exhausted_reason: z.string().min(1),
}).strict();

export const coverageResolutionConfirmCommandPayloadSchema = z.object({
  assessment_id: z.string().min(1),
  assessment_revision: z.string().min(1),
  requirement_id: coverageRequirementIdSchema,
  character_id: z.string().min(1).optional(),
  action: z.enum(["user_supplement", "creative_completion"]),
  choice: z.string().min(1),
  rationale: z.string().min(1),
}).strict();

export const coverageSupplementCommandPayloadSchema = z.object({
  assessment_id: z.string().min(1),
  assessment_revision: z.string().min(1),
  requirement_id: coverageRequirementIdSchema,
  character_id: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  url: z.string().url().optional(),
  attachment_refs: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    media_type: z.string().optional(),
  })).optional(),
}).strict().superRefine((value, context) => {
  const hasText = value.text !== undefined && value.text.trim() !== "";
  const hasUrl = value.url !== undefined && value.url.trim() !== "";
  const hasAttachment = value.attachment_refs !== undefined && value.attachment_refs.length > 0;
  if (!hasText && !hasUrl && !hasAttachment) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A user supplement requires text, a URL, or an attachment.", path: ["text"] });
  }
});


export const coverageResearchRecoverCommandPayloadSchema = z.object({
  task_id: z.string().min(1),
  action: z.enum(["revise_query", "revise_constraints", "manual_url", "supplement", "creative_completion"]),
  query_seeds: z.array(z.string().min(1)).optional(),
  source_constraints: z.array(z.string().min(1)).optional(),
  url: z.string().url().optional(),
}).strict();

const emptyOperationCommandPayloadSchema = z.object({}).strict();
const operationAttachmentRefsSchema = z.array(z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  media_type: z.string().optional(),
}).strict()).transform((refs): OperationAttachmentRef[] => refs.map((ref) => ref.media_type === undefined
  ? { id: ref.id, name: ref.name }
  : { id: ref.id, name: ref.name, media_type: ref.media_type }));

export interface OperationCommandInvalidPayload {
  code: "OPERATION_COMMAND_INVALID";
  message: string;
  recoverable: true;
  original_type?: string;
}

export type SourceSelectionCommandDecision = z.infer<typeof sourceSelectionCommandDecisionSchema>;
export type SourceSelectCommandPayload = z.infer<typeof sourceSelectCommandPayloadSchema>;
export interface IssueUpdateCommandPayload {
  issue_id: string;
  action: "resolve" | "ignore" | "override";
  reason: string;
  severity?: IssueSeverity;
}
export type FactReviewCommandPayload = z.infer<typeof factReviewCommandPayloadSchema>;
export type CoverageResearchCandidateCommandItem = z.infer<typeof coverageResearchCandidateCommandItemSchema>;
export type CoverageResearchStartCommandPayload = z.infer<typeof coverageResearchStartCommandPayloadSchema>;
export type CoverageResearchClaimCommandPayload = z.infer<typeof coverageResearchClaimCommandPayloadSchema>;
export type CoverageResearchCandidatesCommandPayload = z.infer<typeof coverageResearchCandidatesCommandPayloadSchema>;
export type CoverageResearchExhaustCommandPayload = z.infer<typeof coverageResearchExhaustCommandPayloadSchema>;
export type CoverageResolutionConfirmCommandPayload = z.infer<typeof coverageResolutionConfirmCommandPayloadSchema>;
export type CoverageSupplementCommandPayload = z.infer<typeof coverageSupplementCommandPayloadSchema>;
export type CoverageResearchRecoverCommandPayload = z.infer<typeof coverageResearchRecoverCommandPayloadSchema>;

export const operationCommandSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("template_proposal"), payload: templateProposalValueSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("zhuji_proposal"), payload: zhujiProposalValueSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("import"), payload: emptyOperationCommandPayloadSchema.optional(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("source_resume"), payload: emptyOperationCommandPayloadSchema.optional(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("source_search"), payload: emptyOperationCommandPayloadSchema.optional(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("source_select"), payload: sourceSelectCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("issue_update"), payload: issueUpdateCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("request"), payload: emptyOperationCommandPayloadSchema.optional(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("fact_review"), payload: factReviewCommandPayloadSchema.optional(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_research_start"), payload: coverageResearchStartCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_research_claim"), payload: coverageResearchClaimCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_research_candidates"), payload: coverageResearchCandidatesCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_research_exhaust"), payload: coverageResearchExhaustCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_resolution_confirm"), payload: coverageResolutionConfirmCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_supplement"), payload: coverageSupplementCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coverage_research_recover"), payload: coverageResearchRecoverCommandPayloadSchema, attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("invalid"), payload: z.object({ code: z.literal("OPERATION_COMMAND_INVALID"), message: z.string().min(1), recoverable: z.literal(true), original_type: z.string().min(1).optional() }).strict(), attachment_refs: operationAttachmentRefsSchema.optional() }).strict(),
]);

export type OperationCommand = z.infer<typeof operationCommandSchema>;

function operationCommandRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function migrateLegacyOperationCommand(value: unknown): Record<string, unknown> | undefined {
  const record = operationCommandRecord(value);
  if (record === undefined) return undefined;
  const type = record.type === "source_selection" ? "source_select" : record.type;
  const normalized: Record<string, unknown> = { ...record, version: 1, ...(type === undefined ? {} : { type }) };
  if (type === "source_select" && Array.isArray(record.payload)) normalized.payload = { decisions: record.payload };
  return normalized;
}

export function decodeOperationCommand(value: unknown): OperationCommand {
  const migrated = migrateLegacyOperationCommand(value);
  const parsed = operationCommandSchema.safeParse(migrated);
  if (parsed.success) return parsed.data;
  const original = operationCommandRecord(value)?.type;
  return {
    version: 1,
    type: "invalid",
    payload: {
      code: "OPERATION_COMMAND_INVALID",
      message: parsed.error.message,
      recoverable: true,
      ...(typeof original === "string" && original.length > 0 ? { original_type: original } : {}),
    },
  };
}

export interface InternalExecutionSnapshot {
  execution_agent_id: string;
  execution_agent_role?: string;
  initiated_by?: string;
  capabilities?: string[];
  route_kind?: string;
  target_artifact_id?: string;
  target_artifact_kind?: string;
  source_search_mode?: "agent_managed" | "runtime_provider" | "disabled";
  created_at: string;
}

export interface OperationRecord {
  id: string;
  kind: "source" | "knowledge" | "authoring" | "review" | "build" | "import" | "interview" | "status" | "unknown";
  request: string;
  actor?: string;
  status: OperationStatus;
  created_at: string;
  updated_at: string;
  progress: OperationProgress[];
  question?: string;
  result_summary?: string;
  command?: OperationCommand;
  idempotency_key?: string;
  lease_owner?: string;
  lease_token?: string;
  lease_expires_at?: string;
  fencing_generation?: number;
  attempt?: number;
  last_error?: string;
  execution_snapshot?: InternalExecutionSnapshot;
}

export interface AuditEvent {
  id: string;
  operation_id: string;
  event: string;
  actor: string;
  occurred_at: string;
  project_revision: number;
  details: Record<string, unknown>;
}
