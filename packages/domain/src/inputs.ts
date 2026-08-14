import { coverageRequirementIdSchema, coverageResearchStartScopeSchema, z, type CoverageResearchStartScope, type CoverageResearchTarget, type SourceAttachment } from "@st-workspace/core";

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/u;

export const attachmentsSchema = z.array(z.unknown()).optional();

export const requestSchema = z.object({
  request: z.string().trim().min(1),
  agent: z.string().min(1).optional(),
  attachments: attachmentsSchema,
  operation_id: z.string().min(1).optional(),
  target_operation_id: z.string().min(1).optional(),
}).strict();

export type RequestInput = z.infer<typeof requestSchema>;

export const agentSchema = z.object({
  agent: z.string().min(1),
}).strict();
export type AgentInput = z.infer<typeof agentSchema>;

export const operationIdSchema = z.object({
  operation_id: z.string().min(1),
}).strict();
export type OperationIdInput = z.infer<typeof operationIdSchema>;

export const qualityLevelSchema = z.object({
  level: z.enum(["none", "light", "normal", "strict"]),
}).strict();
export type QualityLevelInput = z.infer<typeof qualityLevelSchema>;

export const characterIdSchema = z.object({
  character_id: z.string().min(1).optional(),
}).strict();
export type CharacterIdInput = z.infer<typeof characterIdSchema>;

export const templateKindSchema = z.object({
  kind: z.enum([
    "character",
    "zhuji",
    "palette",
    "wardrobe",
    "greetings",
    "relationships",
    "world",
    "conversion",
    "import_analysis",
    "review",
    "source_research",
    "fact_curation",
    "fact_review",
    "plugin",
    "director_routing",
  ]),
}).strict();
export type TemplateKindInput = z.infer<typeof templateKindSchema>;

export const answerSchema = z.object({
  answer: z.string().trim().min(1),
}).strict();
export type AnswerInput = z.infer<typeof answerSchema>;

export const projectSchema = z.object({
  project: z.string().min(1),
}).strict();
export type ProjectInput = z.infer<typeof projectSchema>;

export const sourceSelectionInputSchema = z.object({
  decisions: z.array(z.object({
    candidate_id: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
  })).min(1),
}).strict();
export type SourceSelectionInput = z.infer<typeof sourceSelectionInputSchema>;

export const issueUpdateInputSchema = z.object({
  issue_id: z.string().min(1),
  action: z.enum(["resolve", "ignore", "override"]),
  reason: z.string().min(1),
  severity: z.enum(["critical", "error", "warning", "info"]).optional(),
  agent: z.string().min(1).optional(),
}).strict();
export type IssueUpdateInput = z.infer<typeof issueUpdateInputSchema>;

const characterRangeSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
}).optional();

export const factDecisionSchema = z.object({
  fact_id: z.string().min(1).optional(),
  candidate_occurrence_id: z.string().min(1).optional(),
  claim: z.string().min(1),
  decision: z.enum(["accept", "reject", "conflict", "needs_evidence"]),
  reason: z.string().min(1),
  evidence: z.array(z.object({
    source: z.string().min(1),
    quote: z.string().min(1).optional(),
    locator: z.string().optional(),
  })).default([]),
  evidence_refs: z.array(z.object({
    source_id: z.string().min(1),
    source_revision_id: z.string().min(1),
    quote: z.string().min(1),
    locator: z.string().optional(),
    character_range: characterRangeSchema,
  })).default([]),
  coverage: z.array(z.string()).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.fact_id === undefined && value.candidate_occurrence_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "fact_id or candidate_occurrence_id is required", path: ["fact_id"] });
  }
});
export type FactDecisionInput = z.infer<typeof factDecisionSchema>;

export const factDecisionsInputSchema = z.object({
  decisions: z.array(factDecisionSchema).min(1),
}).strict();
export type FactDecisionsInput = z.infer<typeof factDecisionsInputSchema>;

export const adaptationDecisionInputSchema = z.object({
  topic: z.string().min(1),
  choice: z.enum(["keep_blueprint", "adopt_fact", "blend", "defer"]),
  blueprint_refs: z.array(z.string()).optional(),
  fact_refs: z.array(z.string()).optional(),
  rationale: z.string().min(1),
}).strict();
export type AdaptationDecisionInput = z.infer<typeof adaptationDecisionInputSchema>;

export const reextractInputSchema = z.object({
  source_ids: z.array(z.string().min(1)).min(1),
  extractor_revision: z.string().min(1).optional(),
}).strict();
export type ReextractInput = z.infer<typeof reextractInputSchema>;

export const factReviewBatchInputSchema = z.object({
  decisions: z.array(factDecisionSchema).min(1),
  reviewer_identity: z.string().min(1).optional(),
  run_id: z.string().min(1).optional(),
  expected_projection_revision: z.string().min(1).optional(),
}).strict();
export type FactReviewBatchInput = z.infer<typeof factReviewBatchInputSchema>;

export const imageInputSchema = z.object({
  character_id: z.string().min(1).optional(),
  aspect_ratio: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  attachments: attachmentsSchema,
}).strict();
export type ImageInput = z.infer<typeof imageInputSchema>;

export const imageRemoveInputSchema = z.object({
  image_id: z.string().min(1),
}).strict();
export type ImageRemoveInput = z.infer<typeof imageRemoveInputSchema>;

export const qualityProfileInputSchema = z.object({
  level: z.enum(["none", "light", "normal", "strict"]),
  overrides: z.record(z.string(), z.enum(["critical", "error", "warning", "info"])).optional(),
}).strict();
export type QualityProfileInput = z.infer<typeof qualityProfileInputSchema>;

export function decodeAttachments(attachments: unknown): SourceAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const result: SourceAttachment[] = [];
  for (const item of attachments) {
    if (item === null || typeof item !== "object") continue;
    const value = item as { name?: unknown; content_base64?: unknown; media_type?: unknown };
    if (typeof value.name !== "string" || value.name.trim().length === 0) continue;
    if (typeof value.content_base64 !== "string" || !base64Pattern.test(value.content_base64)) continue;
    const decoded = Buffer.from(value.content_base64, "base64");
    if (decoded.byteLength === 0) continue;
    result.push({ name: value.name.trim(), content: new Uint8Array(decoded), ...(typeof value.media_type === "string" ? { media_type: value.media_type } : {}) });
  }
  return result;
}

export const coverageResearchCandidateItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  canonical_url: z.string().url().optional(),
  snippet: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  official: z.boolean().optional(),
  target_requirement_ids: z.array(z.string().min(1)).optional(),
}).strict();
export type CoverageResearchCandidateItemInput = z.infer<typeof coverageResearchCandidateItemSchema>;

export const coverageResearchStartInputSchema = z.object({
  assessment_id: z.string().min(1).optional(),
  assessment_revision: z.string().min(1).optional(),
  scope: coverageResearchStartScopeSchema.optional(),
  operation_id: z.string().min(1).optional(),
}).strict();
export type CoverageResearchStartInput = z.infer<typeof coverageResearchStartInputSchema>;

export const coverageResearchStartPreviewInputSchema = z.object({
  assessment_id: z.string().min(1).optional(),
  assessment_revision: z.string().min(1).optional(),
  scope: coverageResearchStartScopeSchema.optional(),
}).strict();
export type CoverageResearchStartPreviewInput = z.infer<typeof coverageResearchStartPreviewInputSchema>;

export const coverageResearchClaimInputSchema = z.object({
  batch_id: z.string().min(1),
  lease_duration_ms: z.number().int().positive().optional(),
}).strict();
export type CoverageResearchClaimInput = z.infer<typeof coverageResearchClaimInputSchema>;

export const coverageResearchCandidatesInputSchema = z.object({
  task_id: z.string().min(1),
  claim_generation: z.number().int().nonnegative(),
  lease_owner: z.string().min(1),
  candidates: z.array(coverageResearchCandidateItemSchema).min(1),
}).strict();
export type CoverageResearchCandidatesInput = z.infer<typeof coverageResearchCandidatesInputSchema>;

export const coverageResearchExhaustInputSchema = z.object({
  task_id: z.string().min(1),
  claim_generation: z.number().int().nonnegative(),
  lease_owner: z.string().min(1),
  searched_queries: z.array(z.string().min(1)),
  source_families: z.array(z.string().min(1)),
  exhausted_reason: z.string().min(1),
}).strict();
export type CoverageResearchExhaustInput = z.infer<typeof coverageResearchExhaustInputSchema>;

const coverageResolutionScopeSchema = z.object({
  assessment_id: z.string().min(1),
  assessment_revision: z.string().min(1),
  requirement_id: coverageRequirementIdSchema,
  character_id: z.string().min(1).optional(),
  operation_id: z.string().min(1).optional(),
});

export const coverageResolutionPreviewInputSchema = coverageResolutionScopeSchema.extend({
  action: z.enum(["user_supplement", "creative_completion"]),
}).strict();
export type CoverageResolutionPreviewInput = z.infer<typeof coverageResolutionPreviewInputSchema>;

export const coverageResolutionConfirmInputSchema = coverageResolutionScopeSchema.extend({
  action: z.enum(["user_supplement", "creative_completion"]),
  choice: z.string().min(1),
  rationale: z.string().min(1),
}).strict();
export type CoverageResolutionConfirmInput = z.infer<typeof coverageResolutionConfirmInputSchema>;

export const coverageSupplementInputSchema = coverageResolutionScopeSchema.extend({
  text: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
  attachments: attachmentsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.text === undefined && value.url === undefined && (value.attachments ?? []).length === 0) {
    ctx.addIssue({ code: "custom", path: ["text"], message: "至少提供補充文字、URL 或附件其中一項。" });
  }
});
export type CoverageSupplementInput = z.infer<typeof coverageSupplementInputSchema>;

export const coverageResearchRecoverInputSchema = z.object({
  task_id: z.string().min(1),
  action: z.enum(["revise_query", "revise_constraints", "manual_url", "supplement", "creative_completion"]),
  query_seeds: z.array(z.string().min(1)).optional(),
  source_constraints: z.array(z.string().min(1)).optional(),
  url: z.string().url().optional(),
  text: z.string().min(1).optional(),
  choice: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  attachments: attachmentsSchema,
  operation_id: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "revise_query") {
    if ((value.query_seeds ?? []).length === 0) {
      ctx.addIssue({ code: "custom", path: ["query_seeds"], message: "修改查詢必須提供至少一個 query_seed。" });
    }
  } else if (value.action === "revise_constraints") {
    if ((value.source_constraints ?? []).length === 0) {
      ctx.addIssue({ code: "custom", path: ["source_constraints"], message: "修改來源限制必須提供至少一個 source_constraint。" });
    }
  } else if (value.action === "manual_url") {
    if (value.url === undefined || value.url.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["url"], message: "手動提供 URL 必須包含有效的 url。" });
    }
  } else if (value.action === "supplement") {
    const hasText = value.text !== undefined && value.text.trim() !== "";
    const hasUrl = value.url !== undefined && value.url.trim() !== "";
    const hasAtt = (value.attachments ?? []).length > 0;
    if (!hasText && !hasUrl && !hasAtt) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "補充資料必須提供文字、URL 或附件其中一項。" });
    }
  } else if (value.action === "creative_completion") {
    if (value.choice === undefined || value.choice.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["choice"], message: "創作補全必須提供 choice。" });
    }
    if (value.rationale === undefined || value.rationale.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["rationale"], message: "創作補全必須提供 rationale。" });
    }
  }
});
export type CoverageResearchRecoverInput = z.infer<typeof coverageResearchRecoverInputSchema>;
