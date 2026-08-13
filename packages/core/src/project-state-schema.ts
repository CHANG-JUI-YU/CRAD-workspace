import { z } from "zod";
import { decodeOperationCommand } from "./operations.js";
import {
  authoringCoverageBindingSchema,
  coverageAssessmentSchema,
  coverageRequirementIdSchema,
  coverageRequirementSetSchema,
  coverageResearchLineageLinkSchema,
  coverageResolutionSchema,
  coverageSnapshotSchema,
  coverageUserDecisionSchema,
  researchBatchSchema,
  researchTaskSchema,
} from "./coverage.js";

const sourceCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string().optional(),
  url: z.string().optional(),
  canonical_url: z.string().url().optional(),
  final_url: z.string().url().optional(),
  domain: z.string().min(1).optional(),
  official: z.boolean().optional(),
  status: z.enum(["pending", "approved", "rejected", "ingested", "blocked_external", "failed"]),
  content: z.string().optional(),
  media_type: z.string().optional(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  source_revision: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  extension: z.string().optional(),
  approved_at: z.string().optional(),
  selection_snapshot: z.object({
    operation_id: z.string().min(1),
    candidate_ids: z.array(z.string().min(1)),
    approved_candidate_ids: z.array(z.string().min(1)),
    rejected_candidate_ids: z.array(z.string().min(1)),
    selected_at: z.string().datetime({ offset: true }),
    selected_by: z.string().min(1),
  }).strict().optional(),
  failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().optional(),
}).strict();
const sourceRecordSchema = z.object({
  id: z.string().min(1),
  candidate_id: z.string().min(1),
  title: z.string().min(1),
  canonical_text: z.string().min(1),
  canonical_url: z.string().url().optional(),
  final_url: z.string().url().optional(),
  original_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  media_type: z.string().min(1),
  original_name: z.string().optional(),
  provenance_kind: z.enum(["external_source", "user_supplement"]).optional(),
  selection_snapshot: z.object({
    operation_id: z.string().min(1),
    candidate_ids: z.array(z.string().min(1)),
    approved_candidate_ids: z.array(z.string().min(1)),
    rejected_candidate_ids: z.array(z.string().min(1)),
    selected_at: z.string().datetime({ offset: true }),
    selected_by: z.string().min(1),
  }).strict().optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const knowledgeChunkSchema = z.object({
  id: z.string().min(1),
  source_id: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  text: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  extractor_revision: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const factSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  subject: z.string().min(1).optional(),
  predicate: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  classification: z.enum(["identity", "trait", "event", "relationship", "world", "other"]).optional(),
  entity_refs: z.array(z.string().min(1)).default([]),
  suggested_entity_refs: z.array(z.string().min(1)).optional(),
  suggested_coverage_targets: z.array(coverageRequirementIdSchema).optional(),
  coverage_targets: z.array(coverageRequirementIdSchema).optional(),
  coverage: z.array(z.string().min(1)).optional(),
  status: z.enum(["candidate", "accepted", "rejected", "conflict"]),
  confidence: z.number().min(0).max(1),
  source_ids: z.array(z.string().min(1)),
  evidence: z.array(z.string().min(1)),
  evidence_refs: z.array(z.object({
    id: z.string().min(1).optional(),
    source_id: z.string().min(1),
    source_revision_id: z.string().min(1),
    chunk_set_id: z.string().min(1).optional(),
    chunk_id: z.string().min(1).optional(),
    chunk_hash: z.string().min(1).optional(),
    quote: z.string().min(1),
    character_range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    line_range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    locator: z.string().min(1).optional(),
  }).strict()).default([]),
  fact_revision: z.number().int().positive().optional(),
  evidence_revision: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  accepted_fact_revision: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  candidate_occurrence_id: z.string().min(1).optional(),
  curation_run_id: z.string().min(1).optional(),
  review_run_id: z.string().min(1).optional(),
  decision_id: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  created_by: z.string().min(1),
}).strict();

const factReviewPassSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  reviewer: z.string().min(1),
  pass: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  fact_ids: z.array(z.string().min(1)),
  decisions_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const factReviewRunSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  curation_run_id: z.string().min(1).optional(),
  candidate_set_revision: z.string().min(1),
  candidate_occurrence_ids: z.array(z.string().min(1)),
  source_revisions: z.array(z.object({ source_id: z.string().min(1), revision: z.string().min(1) }).strict()),
  policy_revision: z.string().min(1),
  candidate_revisions: z.record(z.string(), z.string().min(1)).optional(),
  status: z.enum(["open", "blocked", "completed", "superseded"]),
  created_by: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).optional(),
  successor_run_id: z.string().min(1).optional(),
}).strict();

const factReviewDecisionRecordSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  operation_id: z.string().min(1),
  review_run_id: z.string().min(1),
  candidate_occurrence_id: z.string().min(1),
  fact_id: z.string().min(1).optional(),
  reviewer_identity: z.string().min(1),
  decision: z.enum(["accepted", "rejected", "needs_evidence", "conflict"]),
  entity_refs: z.array(z.string().min(1)).default([]),
  reason: z.string().min(1),
  evidence: z.array(z.object({
    id: z.string().min(1).optional(),
    source_id: z.string().min(1),
    source_revision_id: z.string().min(1),
    chunk_set_id: z.string().min(1).optional(),
    chunk_id: z.string().min(1).optional(),
    chunk_hash: z.string().min(1).optional(),
    quote: z.string().min(1),
    character_range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    line_range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional(),
    locator: z.string().min(1).optional(),
  }).strict()),
  candidate_revision: z.string().min(1),
  expected_projection_revision: z.string().min(1),
  resulting_fact_revision: z.number().int().positive().optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const artifactSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  kind: z.enum(["character", "relationship", "world_lore", "greeting", "blueprint", "zhuji", "palette", "wardrobe", "plugin", "review", "source_research", "fact_curation", "fact_review", "conversion", "import_analysis", "director_routing", "draft_note", "unknown"]),
  name: z.string().min(1),
  content: z.string().min(1),
  media_type: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(["draft", "reviewed", "approved", "published"]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  created_by: z.string().min(1),
  operation_id: z.string().min(1),
  based_on: z.string().optional(),
  blueprint_precheck_id: z.string().min(1).optional(),
  blueprint_precheck_revision: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  dependency_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict();

const imageSchema = z.object({
  id: z.string().min(1),
  character_id: z.string().min(1).optional(),
  blob_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  media_type: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspect_ratio: z.string().regex(/^\d+:\d+$/u).optional(),
  crop: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    offset_x: z.number().int().nonnegative(),
    offset_y: z.number().int().nonnegative(),
  }).optional(),
  source: z.string().min(1).optional(),
  license: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  created_by: z.string().min(1).optional(),
}).strict();

const qualityPolicySnapshotSchema = z.object({
  id: z.string().min(1),
  level: z.enum(["none", "light", "normal", "strict"]),
  blocking_severity: z.enum(["none", "info", "warning", "error", "critical"]),
  overrides: z.record(z.string(), z.enum(["info", "warning", "error", "critical"])),
  captured_at: z.string().datetime({ offset: true }),
  captured_by: z.string().min(1),
}).strict();

const qualityOverrideAuditSchema = z.object({
  code: z.string().min(1),
  configured_severity: z.enum(["info", "warning", "error", "critical"]),
  against_effective_severity: z.enum(["info", "warning", "error", "critical"]),
  actor: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

const issueOverrideSchema = z.object({
  by: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  against_effective_severity: z.enum(["info", "warning", "error", "critical"]),
  severity: z.enum(["info", "warning", "error", "critical"]).optional(),
  policy_snapshot: qualityPolicySnapshotSchema.optional(),
}).strict();

const reviewSchema = z.object({
  id: z.string().min(1),
  artifact_id: z.string().min(1),
  artifact_revision: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewer: z.string().min(1),
  status: z.enum(["passed", "failed", "partial"]),
  issue_ids: z.array(z.string().min(1)),
  created_at: z.string().datetime({ offset: true }),
  quality_policy_snapshot: qualityPolicySnapshotSchema.optional(),
}).strict();

const issueSchema = z.object({
  id: z.string().min(1),
  artifact_id: z.string().min(1),
  review_id: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error", "critical"]),
  effective_severity: z.enum(["info", "warning", "error", "critical"]),
  against_effective_severity: z.enum(["info", "warning", "error", "critical"]).optional(),
  override: issueOverrideSchema.optional(),
  evidence: z.array(z.string().min(1)).optional(),
  overridable: z.boolean().optional(),
  status: z.enum(["open", "resolved", "ignored"]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

const qualityProfileSchema = z.object({
  level: z.enum(["none", "light", "normal", "strict"]).optional().default("normal"),
  blocking_severity: z.enum(["none", "info", "warning", "error", "critical"]).default("error"),
  overrides: z.record(z.string(), z.enum(["info", "warning", "error", "critical"])),
  policy_snapshot: qualityPolicySnapshotSchema.optional(),
  override_audit: z.array(qualityOverrideAuditSchema).default([]),
}).strict();

const blobReferenceSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  size: z.number().int().nonnegative(),
}).strict();

const buildSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  status: z.enum(["previewed", "built", "failed"]),
  artifact_ids: z.array(z.string().min(1)),
  canonical_ir: z.string().min(1).optional(),
  canonical_ir_ref: blobReferenceSchema.optional(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  diagnostics: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }),
  quality_policy_snapshot: qualityPolicySnapshotSchema.optional(),
  coverage_snapshot: coverageSnapshotSchema.optional(),
}).strict();

const blueprintPrecheckCheckSchema = z.object({
  subject_id: z.string().min(1),
  dimension: z.enum(["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"]),
  uncertainty: z.enum(["low", "high"]),
  impact: z.enum(["low", "high"]),
  basis: z.string().min(1),
  action: z.enum(["preserve_explicit", "safe_extension", "user_confirmed"]),
  user_answer: z.string().min(1).optional(),
  intake_key: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "user_confirmed" && value.user_answer === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "user_confirmed checks require user_answer" });
  if (value.action !== "user_confirmed" && value.user_answer !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only user_confirmed checks may include user_answer" });
  if (value.uncertainty === "high" && value.impact === "high" && value.action === "safe_extension") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "High uncertainty/high impact checks require explicit confirmation" });
});

const blueprintPrecheckSchema = z.object({
  id: z.string().min(1),
  schema_version: z.literal(1),
  project_id: z.string().min(1),
  operation_id: z.string().min(1),
  collaboration_mode: z.enum(["free", "assisted"]),
  candidate_blueprint: z.record(z.string(), z.unknown()),
  candidate_blueprint_revision: z.string().regex(/^[a-f0-9]{64}$/u),
  checks: z.array(blueprintPrecheckCheckSchema).min(1),
  status: z.enum(["recorded", "needs_input", "superseded"]),
  created_at: z.string().datetime({ offset: true }),
  created_by: z.string().min(1),
}).strict();

const publishSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  artifact_ids: z.array(z.string().min(1)),
  content: z.string().min(1).optional(),
  content_ref: blobReferenceSchema.optional(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  png_base64: z.string().min(1).optional(),
  png_ref: blobReferenceSchema.optional(),
  export_json_path: z.string().min(1).optional(),
  export_png_path: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
  coverage_snapshot: coverageSnapshotSchema.optional(),
}).strict();

const importSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  original_name: z.string().min(1),
  original_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  original_content: z.string().min(1),
  original_binary: z.string().min(1).optional(),
  attachments: z.array(z.object({ name: z.string().min(1), media_type: z.string().min(1), original_hash: z.string().regex(/^[a-f0-9]{64}$/u) })).optional(),
  converted_hash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  report: z.array(z.string()),
  status: z.enum(["dry_run", "imported", "failed"]),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const operationProgressSchema = z.object({
  item_id: z.string().min(1),
  status: z.enum(["completed", "blocked", "failed"]),
  message: z.string().min(1),
  source_id: z.string().optional(),
  artifact_id: z.string().optional(),
}).strict();

const internalExecutionSnapshotSchema = z.object({
  execution_agent_id: z.string().min(1),
  execution_agent_role: z.string().optional(),
  initiated_by: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  route_kind: z.string().optional(),
  target_artifact_id: z.string().optional(),
  target_artifact_kind: z.string().optional(),
  source_search_mode: z.enum(["agent_managed", "runtime_provider", "disabled"]).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const operationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["source", "knowledge", "authoring", "review", "build", "import", "interview", "status", "unknown"]),
  request: z.string().min(1),
  actor: z.string().min(1).optional(),
  status: z.enum(["created", "resolving", "running", "needs_input", "partial", "completed", "blocked", "failed", "cancelled"]),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  progress: z.array(operationProgressSchema),
  question: z.string().optional(),
  result_summary: z.string().optional(),
  command: z.unknown().optional().transform((value) => value === undefined ? undefined : decodeOperationCommand(value)),
  idempotency_key: z.string().optional(),
  lease_owner: z.string().min(1).optional(),
  lease_token: z.string().min(1).optional(),
  lease_expires_at: z.string().datetime({ offset: true }).optional(),
  fencing_generation: z.number().int().nonnegative().optional(),
  attempt: z.number().int().nonnegative().optional(),
  last_error: z.string().optional(),
  execution_snapshot: internalExecutionSnapshotSchema.optional(),
}).strict();

const auditEventSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  event: z.string().min(1),
  actor: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  project_revision: z.number().int().nonnegative(),
  details: z.record(z.string(), z.unknown()),
}).strict();

const adaptationDecisionSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  choice: z.enum(["keep_blueprint", "adopt_fact", "blend", "defer"]),
  blueprint_refs: z.array(z.string().min(1)).optional(),
  fact_refs: z.array(z.string().min(1)).optional(),
  rationale: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  created_by: z.string().min(1),
}).strict();

const interviewQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(["choice", "free_text", "name", "confirmation", "blueprint_direction", "self_introduction"]),
  min_length: z.number().int().positive().optional(),
  options: z.array(z.string().min(1)).optional(),
  subject_id: z.string().min(1).optional(),
  subject_label: z.string().min(1).optional(),
}).strict();

const interviewCharacterSubjectSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  ordinal: z.number().int().positive(),
}).strict();

const interviewAnswerSchema = z.object({
  question_id: z.string().min(1),
  answer: z.string().min(1),
  actor: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

export const interviewStateSchema = z.object({
  schema_version: z.literal(1),
  status: z.enum(["idle", "active", "complete"]),
  flow: z.enum(["new_project", "character", "source_adaptation", "world", "continue", "legacy_review", "character_expansion"]),
  current: interviewQuestionSchema.optional(),
  answers: z.array(interviewAnswerSchema),
  values: z.record(z.string(), z.unknown()),
  characters: z.array(interviewCharacterSubjectSchema).min(1).optional(),
  active_character_id: z.string().min(1).optional(),
  confirmed_no_additional_settings: z.boolean().optional(),
}).strict();

export const projectStateSchema = z.object({
  schema_version: z.literal(2),
  project_id: z.string().min(1),
  project_name: z.string().min(1).optional(),
  project_slug: z.string().min(1).optional(),
  project_status: z.enum(["uninitialized", "interviewing", "ready", "published"]).default("uninitialized"),
  revision: z.number().int().nonnegative(),
  candidates: z.array(sourceCandidateSchema),
  sources: z.array(sourceRecordSchema),
  knowledge_chunks: z.array(knowledgeChunkSchema).default([]),
  facts: z.array(factSchema).default([]),
  fact_review_passes: z.array(factReviewPassSchema).default([]),
  fact_review_runs: z.array(factReviewRunSchema).default([]),
  fact_review_decisions: z.array(factReviewDecisionRecordSchema).default([]),
  artifacts: z.array(artifactSchema).default([]),
  images: z.array(imageSchema).default([]),
  reviews: z.array(reviewSchema).default([]),
  issues: z.array(issueSchema).default([]),
  quality_profile: qualityProfileSchema.default({ level: "normal", blocking_severity: "error", overrides: {}, override_audit: [] }),
  blueprint_prechecks: z.array(blueprintPrecheckSchema).default([]),
  adaptation_decisions: z.array(adaptationDecisionSchema).default([]),
  builds: z.array(buildSchema).default([]),
  publishes: z.array(publishSchema).default([]),
  imports: z.array(importSchema).default([]),
  operations: z.array(operationSchema),
  audit: z.array(auditEventSchema),
  interview: interviewStateSchema.default(() => ({ schema_version: 1 as const, status: "idle" as const, flow: "new_project" as const, answers: [], values: {} })),
  coverage_requirement_sets: z.array(coverageRequirementSetSchema).default([]),
  coverage_assessments: z.array(coverageAssessmentSchema).default([]),
  coverage_user_decisions: z.array(coverageUserDecisionSchema).default([]),
  coverage_research_batches: z.array(researchBatchSchema).default([]),
  coverage_research_tasks: z.array(researchTaskSchema).default([]),
  coverage_research_lineages: z.array(coverageResearchLineageLinkSchema).default([]),
  coverage_resolutions: z.array(coverageResolutionSchema).default([]),
  coverage_authoring_bindings: z.array(authoringCoverageBindingSchema).default([]),
}).strict();
