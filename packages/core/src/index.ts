import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createInterviewState, type InterviewState } from "./interview.js";
import type { AdaptationDecision } from "./authoring-context.js";

export type OperationStatus =
  | "created"
  | "resolving"
  | "running"
  | "needs_input"
  | "partial"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type ProjectStatus = "uninitialized" | "interviewing" | "ready" | "published";

export type CandidateStatus = "pending" | "approved" | "rejected" | "ingested" | "blocked_external" | "failed";

export type ArtifactKind =
  | "character"
  | "relationship"
  | "world_lore"
  | "greeting"
  | "blueprint"
  | "zhuji"
  | "palette"
  | "wardrobe"
  | "plugin"
  | "review"
  | "source_research"
  | "fact_curation"
  | "fact_review"
  | "conversion"
  | "import_analysis"
  | "director_routing"
  | "unknown";

export type ArtifactStatus = "draft" | "reviewed" | "approved" | "published";

export type FactStatus = "candidate" | "accepted" | "rejected" | "conflict";

export type FactClassification = "identity" | "trait" | "event" | "relationship" | "world" | "other";

export type IssueSeverity = "info" | "warning" | "error" | "critical";

/** User-facing quality presets. The profile keeps the resolved blocking severity
 * for compatibility with older state files, while level is the compact control. */
export type QualityLevel = "none" | "light" | "normal" | "strict";
export type QualityBlockingSeverity = IssueSeverity | "none";

export type IssueStatus = "open" | "resolved" | "ignored";

export interface QualityPolicySnapshot {
  id: string;
  level: QualityLevel;
  blocking_severity: QualityBlockingSeverity;
  overrides: Record<string, IssueSeverity>;
  captured_at: string;
  captured_by: string;
}

export interface QualityOverrideAudit {
  code: string;
  configured_severity: IssueSeverity;
  against_effective_severity: IssueSeverity;
  actor: string;
  occurred_at: string;
}

export interface QualityProfile {
  /** Optional to allow v2/v3 state migration; new states always contain level. */
  level?: QualityLevel;
  blocking_severity: QualityBlockingSeverity;
  overrides: Record<string, IssueSeverity>;
  policy_snapshot?: QualityPolicySnapshot;
  override_audit?: QualityOverrideAudit[];
}

export const QUALITY_LEVEL_PRESETS: Record<QualityLevel, QualityBlockingSeverity> = {
  none: "none",
  light: "critical",
  normal: "error",
  strict: "warning",
};

export function qualityLevelForProfile(profile: Pick<QualityProfile, "level" | "blocking_severity">): QualityLevel {
  if (profile.level !== undefined) return profile.level;
  const entry = (Object.entries(QUALITY_LEVEL_PRESETS) as Array<[QualityLevel, QualityBlockingSeverity]>).find(([, severity]) => severity === profile.blocking_severity);
  return entry?.[0] ?? "normal";
}

export function qualityProfileForLevel(level: QualityLevel, overrides: Record<string, IssueSeverity> = {}): QualityProfile {
  return { level, blocking_severity: QUALITY_LEVEL_PRESETS[level], overrides: { ...overrides }, override_audit: [] };
}

export function createQualityPolicySnapshot(profile: QualityProfile, actor: string, capturedAt = new Date().toISOString()): QualityPolicySnapshot {
  return {
    id: internalId("quality_policy"),
    level: qualityLevelForProfile(profile),
    blocking_severity: profile.blocking_severity,
    overrides: { ...profile.overrides },
    captured_at: capturedAt,
    captured_by: actor,
  };
}

export type BlueprintPrecheckDimension =
  | "character_core"
  | "background"
  | "personality"
  | "relationships_boundaries"
  | "world_dependencies"
  | "cross_module_impact";

export type BlueprintPrecheckUncertainty = "low" | "high";
export type BlueprintPrecheckImpact = "low" | "high";
export type BlueprintPrecheckAction = "preserve_explicit" | "safe_extension" | "user_confirmed";

export interface BlueprintPrecheckCheck {
  subject_id: string;
  dimension: BlueprintPrecheckDimension;
  uncertainty: BlueprintPrecheckUncertainty;
  impact: BlueprintPrecheckImpact;
  basis: string;
  action: BlueprintPrecheckAction;
  user_answer?: string;
}

export interface BlueprintPrecheckRecord {
  id: string;
  schema_version: 1;
  project_id: string;
  operation_id: string;
  collaboration_mode: "free" | "assisted";
  candidate_blueprint: Record<string, unknown>;
  candidate_blueprint_revision: string;
  checks: BlueprintPrecheckCheck[];
  status: "recorded" | "needs_input" | "superseded";
  created_at: string;
  created_by: string;
}

export interface SourceCandidate {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  /** Search-result domain kept so source policies can be checked before fetch. */
  domain?: string;
  /** Optional classifier supplied by a researcher/search adapter. */
  official?: boolean;
  status: CandidateStatus;
  content?: string;
  media_type?: string;
  extension?: string;
  approved_at?: string;
  selection_snapshot?: SourceSelectionSnapshot;
  failure?: { code: string; message: string };
}

export interface SourceSelectionSnapshot {
  operation_id: string;
  candidate_ids: string[];
  approved_candidate_ids: string[];
  rejected_candidate_ids: string[];
  selected_at: string;
  selected_by: string;
}

export interface SourceRecord {
  id: string;
  candidate_id: string;
  title: string;
  canonical_text: string;
  original_hash: string;
  revision: string;
  media_type: string;
  original_name?: string;
  selection_snapshot?: SourceSelectionSnapshot;
  created_at: string;
}

export interface KnowledgeChunk {
  id: string;
  source_id: string;
  ordinal: number;
  text: string;
  hash: string;
  created_at: string;
}

export interface FactRecord {
  id: string;
  statement: string;
  /** Structured claim fields. Optional for backwards-compatible state migration. */
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: FactClassification;
  coverage?: string[];
  status: FactStatus;
  confidence: number;
  source_ids: string[];
  evidence: string[];
  /** Structured provenance retained alongside the legacy display evidence. */
  evidence_refs?: FactEvidenceReference[];
  fact_revision?: number;
  candidate_occurrence_id?: string;
  review_run_id?: string;
  decision_id?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface FactEvidenceReference {
  id?: string;
  source_id: string;
  source_revision_id: string;
  chunk_set_id?: string;
  chunk_id?: string;
  chunk_hash?: string;
  quote: string;
  character_range?: { start: number; end: number };
  line_range?: { start: number; end: number };
  locator?: string;
}

export interface FactReviewPassRecord {
  id: string;
  operation_id: string;
  reviewer: string;
  pass: 1 | 2 | 3;
  fact_ids: string[];
  decisions_hash: string;
  created_at: string;
}

export type FactReviewRunStatus = "open" | "blocked" | "completed" | "superseded";

export interface FactReviewSourceRevision {
  source_id: string;
  revision: string;
}

export interface FactReviewRunRecord {
  schema_version: 1;
  id: string;
  curation_run_id?: string;
  candidate_set_revision: string;
  candidate_occurrence_ids: string[];
  source_revisions: FactReviewSourceRevision[];
  policy_revision: string;
  status: FactReviewRunStatus;
  created_by: string;
  created_at: string;
  completed_at?: string;
}

export type FactReviewDecisionStatus = "accepted" | "rejected" | "needs_evidence" | "conflict";

export interface FactReviewDecisionRecord {
  schema_version: 1;
  id: string;
  operation_id: string;
  review_run_id: string;
  candidate_occurrence_id: string;
  fact_id?: string;
  reviewer_identity: string;
  decision: FactReviewDecisionStatus;
  reason: string;
  evidence: FactEvidenceReference[];
  candidate_revision: string;
  expected_projection_revision: string;
  resulting_fact_revision?: number;
  created_at: string;
}

export interface ArtifactRecord {
  id: string;
  key: string;
  kind: ArtifactKind;
  name: string;
  content: string;
  media_type: string;
  content_hash: string;
  revision: string;
  status: ArtifactStatus;
  created_at: string;
  updated_at: string;
  created_by: string;
  operation_id: string;
  based_on?: string;
  blueprint_precheck_id?: string;
  blueprint_precheck_revision?: string;
}

export interface ReviewRecord {
  id: string;
  artifact_id: string;
  artifact_revision: string;
  reviewer: string;
  status: "passed" | "failed" | "partial";
  issue_ids: string[];
  created_at: string;
  quality_policy_snapshot?: QualityPolicySnapshot;
}

export interface IssueRecord {
  id: string;
  artifact_id: string;
  review_id: string;
  code: string;
  message: string;
  severity: IssueSeverity;
  effective_severity: IssueSeverity;
  /** Raw policy severity used as the comparison baseline for overrides. */
  against_effective_severity?: IssueSeverity;
  evidence?: string[];
  overridable?: boolean;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
}

export interface BuildRecord {
  id: string;
  operation_id: string;
  status: "previewed" | "built" | "failed";
  artifact_ids: string[];
  canonical_ir: string;
  content_hash: string;
  diagnostics: string[];
  created_at: string;
  quality_policy_snapshot?: QualityPolicySnapshot;
}

export interface PublishRecord {
  id: string;
  operation_id: string;
  artifact_ids: string[];
  content: string;
  content_hash: string;
  /** PNG bytes are kept with the ledger so materialization can recover them atomically. */
  png_base64?: string;
  export_json_path?: string;
  export_png_path?: string;
  created_at: string;
}

export interface ImportRecord {
  id: string;
  operation_id: string;
  original_name: string;
  original_hash: string;
  original_content: string;
  converted_hash?: string;
  report: string[];
  status: "dry_run" | "imported" | "failed";
  created_at: string;
}

export interface OperationProgress {
  item_id: string;
  status: "completed" | "blocked" | "failed";
  message: string;
  source_id?: string;
  artifact_id?: string;
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

export interface ProjectState {
  schema_version: 1;
  project_id: string;
  project_name?: string;
  project_slug?: string;
  project_status: ProjectStatus;
  revision: number;
  candidates: SourceCandidate[];
  sources: SourceRecord[];
  knowledge_chunks: KnowledgeChunk[];
  facts: FactRecord[];
  fact_review_passes: FactReviewPassRecord[];
  fact_review_runs: FactReviewRunRecord[];
  fact_review_decisions: FactReviewDecisionRecord[];
  artifacts: ArtifactRecord[];
  reviews: ReviewRecord[];
  issues: IssueRecord[];
  quality_profile: QualityProfile;
  blueprint_prechecks: BlueprintPrecheckRecord[];
  adaptation_decisions: AdaptationDecision[];
  builds: BuildRecord[];
  publishes: PublishRecord[];
  imports: ImportRecord[];
  operations: OperationRecord[];
  audit: AuditEvent[];
  interview: InterviewState;
}

const sourceCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string().optional(),
  url: z.string().optional(),
  domain: z.string().min(1).optional(),
  official: z.boolean().optional(),
  status: z.enum(["pending", "approved", "rejected", "ingested", "blocked_external", "failed"]),
  content: z.string().optional(),
  media_type: z.string().optional(),
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
  original_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  media_type: z.string().min(1),
  original_name: z.string().optional(),
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
  created_at: z.string().datetime({ offset: true }),
}).strict();

const factSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  subject: z.string().min(1).optional(),
  predicate: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  classification: z.enum(["identity", "trait", "event", "relationship", "world", "other"]).optional(),
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
  candidate_occurrence_id: z.string().min(1).optional(),
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
  status: z.enum(["open", "blocked", "completed", "superseded"]),
  created_by: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).optional(),
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
  kind: z.enum(["character", "relationship", "world_lore", "greeting", "blueprint", "zhuji", "palette", "wardrobe", "plugin", "review", "source_research", "fact_curation", "fact_review", "conversion", "import_analysis", "director_routing", "unknown"]),
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

const buildSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  status: z.enum(["previewed", "built", "failed"]),
  artifact_ids: z.array(z.string().min(1)),
  canonical_ir: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  diagnostics: z.array(z.string()),
  created_at: z.string().datetime({ offset: true }),
  quality_policy_snapshot: qualityPolicySnapshotSchema.optional(),
}).strict();

const blueprintPrecheckCheckSchema = z.object({
  subject_id: z.string().min(1),
  dimension: z.enum(["character_core", "background", "personality", "relationships_boundaries", "world_dependencies", "cross_module_impact"]),
  uncertainty: z.enum(["low", "high"]),
  impact: z.enum(["low", "high"]),
  basis: z.string().min(1),
  action: z.enum(["preserve_explicit", "safe_extension", "user_confirmed"]),
  user_answer: z.string().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "user_confirmed" && value.user_answer === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "user_confirmed checks require user_answer" });
  }
  if (value.action !== "user_confirmed" && value.user_answer !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only user_confirmed checks may include user_answer" });
  }
  if (value.uncertainty === "high" && value.impact === "high" && value.action === "safe_extension") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "High uncertainty/high impact checks require explicit confirmation" });
  }
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
  content: z.string().min(1),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  png_base64: z.string().min(1).optional(),
  export_json_path: z.string().min(1).optional(),
  export_png_path: z.string().min(1).optional(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

const importSchema = z.object({
  id: z.string().min(1),
  operation_id: z.string().min(1),
  original_name: z.string().min(1),
  original_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  original_content: z.string().min(1),
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
  schema_version: z.literal(1),
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
  interview: interviewStateSchema.default(() => {
    return { schema_version: 1 as const, status: "idle" as const, flow: "new_project" as const, answers: [], values: {} };
  }),
}).strict();

export interface SourceAttachment {
  name: string;
  content: Uint8Array;
  media_type?: string;
}

export interface WorkspaceContext {
  actor: string;
  attachments: SourceAttachment[];
  research_results?: Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>;
}

export interface RequestResult {
  operation_id?: string;
  status: OperationStatus | "completed";
  summary: string;
  completed: string[];
  blocked: string[];
  question?: string;
  agent_id?: string;
  agent_role?: string;
  project_id?: string;
  project_name?: string;
  project_path?: string;
  interview_question?: InterviewState["current"];
}

export class CoreError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly details?: unknown;

  constructor(code: string, message: string, recoverable = false, details?: unknown) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export function internalId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createProjectState(projectId: string): ProjectState {
  return {
    schema_version: 1,
    project_id: projectId,
    project_status: "uninitialized",
    revision: 0,
    candidates: [],
    sources: [],
    knowledge_chunks: [],
    facts: [],
    fact_review_passes: [],
    fact_review_runs: [],
    fact_review_decisions: [],
    artifacts: [],
    reviews: [],
    issues: [],
    quality_profile: { level: "normal", blocking_severity: "error", overrides: {}, override_audit: [] },
    blueprint_prechecks: [],
    adaptation_decisions: [],
    builds: [],
    publishes: [],
    imports: [],
    operations: [],
    audit: [],
    interview: createInterviewState(),
  };
}

function cloneState(state: ProjectState): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState;
}

function backfillLegacyFactReviewHistory(state: ProjectState): ProjectState {
  if (state.fact_review_passes.length === 0 || state.fact_review_decisions.length > 0) return state;
  const factsById = new Map(state.facts.map((fact) => [fact.id, fact]));
  const decisions: FactReviewDecisionRecord[] = state.fact_review_passes.flatMap((pass) => pass.fact_ids.flatMap((factId) => {
    const fact = factsById.get(factId);
    if (fact === undefined) return [];
    const decision: FactReviewDecisionRecord["decision"] = fact.status === "accepted"
      ? "accepted"
      : fact.status === "rejected"
        ? "rejected"
        : fact.status === "conflict"
          ? "conflict"
          : "needs_evidence";
    return [{
      schema_version: 1 as const,
      id: `legacy-fact-review-${contentHash(`${pass.id}:${fact.id}`).slice(0, 24)}`,
      operation_id: pass.operation_id,
      review_run_id: "legacy",
      candidate_occurrence_id: fact.candidate_occurrence_id ?? fact.id,
      fact_id: fact.id,
      reviewer_identity: pass.reviewer,
      decision,
      reason: "Backfilled from legacy fact_review_passes; not eligible for the new Facts Gate.",
      evidence: fact.evidence_refs ?? [],
      candidate_revision: contentHash(canonicalJson({ id: fact.id, statement: fact.statement, revision: fact.fact_revision ?? 0 })),
      expected_projection_revision: contentHash(canonicalJson({ legacy_pass: pass.id, fact_id: fact.id })),
      created_at: pass.created_at,
    }];
  }));
  return { ...state, fact_review_decisions: decisions };
}

function validateState(state: ProjectState): ProjectState {
  const parsed = projectStateSchema.safeParse(state);
  if (!parsed.success) throw new CoreError("STATE_INVALID", parsed.error.message);
  return backfillLegacyFactReviewHistory(parsed.data as unknown as ProjectState);
}

export interface ProjectRepository {
  read(): Promise<ProjectState>;
  transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>>;
  commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState>;
}

/** A file path relative to the project directory, committed with the state. */
export interface RepositoryFile {
  path: string;
  content: Uint8Array | string;
}

/** Optional materialized files that must be committed atomically with state. */
export interface RepositoryWriteSet {
  files?: readonly RepositoryFile[];
  remove?: readonly string[];
}

export interface RepositoryTransactionResult<T> {
  state: ProjectState;
  value: T;
  writeSet?: RepositoryWriteSet;
}

export interface RepositoryTransactionCommit<T> {
  revision: number;
  state: ProjectState;
  value: T;
}

export type RepositoryTransactionWork<T> = (state: ProjectState) => Promise<RepositoryTransactionResult<T>> | RepositoryTransactionResult<T>;

export interface FileProjectRepositoryOptions {
  readonly layout?: "legacy" | "project";
  readonly materialize?: boolean;
}

export class MemoryProjectRepository implements ProjectRepository {
  private state: ProjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(projectId: string, initial?: ProjectState) {
    this.state = validateState(cloneState(initial ?? createProjectState(projectId)));
  }

  async read(): Promise<ProjectState> {
    await this.queue;
    return cloneState(this.state);
  }

  async transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>> {
    let result!: RepositoryTransactionCommit<T>;
    const previous = this.queue;
    const run = previous.then(async () => {
      if (this.state.revision !== expectedRevision) {
        throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${this.state.revision}`, true);
      }
      const resolved = await work(cloneState(this.state));
      const next = validateState(resolved.state);
      next.revision = this.state.revision + 1;
      this.state = cloneState(next);
      result = { revision: next.revision, state: cloneState(next), value: resolved.value };
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  async commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState> {
    const result = await this.transaction(expectedRevision, (state) => ({ state: mutate(state), value: undefined, ...(writeSet === undefined ? {} : { writeSet }) }));
    return result.state;
  }
}

export class FileProjectRepository implements ProjectRepository {
  private stateFile: string;
  private lockFile: string;
  private projectIdValue: string;
  private queue: Promise<void> = Promise.resolve();
  private readonly projectRoot: string;
  private readonly layout: "legacy" | "project";
  private readonly materializeEnabled: boolean;

  constructor(projectRoot: string, projectId: string, options: FileProjectRepositoryOptions = {}) {
    this.projectRoot = projectRoot;
    this.projectIdValue = projectId;
    this.layout = options.layout ?? "legacy";
    this.materializeEnabled = options.materialize ?? false;
    this.stateFile = this.stateFileFor(projectId);
    this.lockFile = this.lockFileFor(projectId);
  }

  get projectId(): string {
    return this.projectIdValue;
  }

  get projectDirectory(): string {
    return path.join(this.projectRoot, this.projectIdValue);
  }

  /** Move a temporary project directory without changing the repository instance. */
  async relocate(newProjectId: string): Promise<void> {
    const normalized = newProjectId.trim();
    if (normalized.length === 0 || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
      throw new CoreError("PROJECT_ID_INVALID", "project id must be a single safe path segment", true);
    }
    const previous = this.queue;
    const run = previous.then(async () => {
      if (normalized === this.projectIdValue) return;
      const targetDirectory = path.join(this.projectRoot, normalized);
      await mkdir(this.projectRoot, { recursive: true });
      await renameWithRetry(this.projectDirectory, targetDirectory);
      this.projectIdValue = normalized;
      this.stateFile = this.stateFileFor(normalized);
      this.lockFile = this.lockFileFor(normalized);
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
  }

  private stateFileFor(projectId: string): string {
    return this.layout === "project"
      ? path.join(this.projectRoot, projectId, ".workspace", "state.json")
      : path.join(this.projectRoot, projectId, "state.json");
  }

  private lockFileFor(projectId: string): string {
    const lockKey = contentHash(`${path.resolve(this.projectRoot)}\0${projectId}`);
    return path.join(tmpdir(), "st-workspace-v3-locks", `${lockKey}.lock`);
  }

  async read(): Promise<ProjectState> {
    await this.queue;
    return this.withProjectLock(async () => {
      let state: ProjectState;
      try {
        const raw = await readFile(this.stateFile, "utf8");
        state = validateState(JSON.parse(raw) as ProjectState);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const migrated = await this.migrateLegacyLayoutIfNeeded();
        if (migrated !== undefined) return migrated;
        const initial = createProjectState(this.projectIdValue);
        await this.writeTransactional(initial);
        return initial;
      }
      if (this.layout === "project") await this.archiveExistingLegacyLayout(state);
      if (this.materializeEnabled) await this.reconcileMaterializedFiles(state);
      return state;
    });
  }

  async transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>> {
    let result!: RepositoryTransactionCommit<T>;
    const previous = this.queue;
    const run = previous.then(async () => {
      await this.withProjectLock(async () => {
        const current = await this.readUnlocked();
        if (current.revision !== expectedRevision) {
          throw new CoreError("REVISION_CONFLICT", `Expected project revision ${expectedRevision}, found ${current.revision}`, true);
        }
        const resolved = await work(cloneState(current));
        const next = validateState(resolved.state);
        next.revision = current.revision + 1;
        await this.writeTransactional(next, resolved.writeSet);
        result = { revision: next.revision, state: cloneState(next), value: resolved.value };
      });
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
    return result;
  }

  async commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState> {
    const result = await this.transaction(expectedRevision, (state) => ({ state: mutate(state), value: undefined, ...(writeSet === undefined ? {} : { writeSet }) }));
    return result.state;
  }

  private async readUnlocked(): Promise<ProjectState> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      return validateState(JSON.parse(raw) as ProjectState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const migrated = await this.migrateLegacyLayoutIfNeeded();
      if (migrated !== undefined) return migrated;
      return createProjectState(this.projectIdValue);
    }
  }

  /**
   * Import the old root-state/proposals/exports layout without deleting user data.
   * The new state and semantic files are written first; legacy entries are then
   * moved into a timestamped, read-only-by-convention recovery folder.
   */
  private async migrateLegacyLayoutIfNeeded(): Promise<ProjectState | undefined> {
    if (this.layout !== "project") return undefined;
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const legacyEntries = [legacyStatePath, path.join(this.projectDirectory, "proposals"), path.join(this.projectDirectory, "exports")];
    const present: string[] = [];
    for (const entry of legacyEntries) {
      try {
        await stat(entry);
        present.push(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (present.length === 0) return undefined;

    let migratedState: ProjectState;
    if (present.includes(legacyStatePath)) {
      const raw = await readFile(legacyStatePath, "utf8");
      migratedState = validateState(JSON.parse(raw) as ProjectState);
    } else {
      migratedState = createProjectState(this.projectIdValue);
    }
    const migrationId = `migration-${contentHash(present.join("\n") + canonicalJson(migratedState)).slice(0, 16)}`;
    const backupDirectory = path.join(this.projectDirectory, ".workspace", "legacy-layout", migrationId);

    // This write is the staging/verification boundary. If it fails, legacy
    // files are untouched and the caller receives the original error.
    await this.writeTransactional(migratedState);
    await mkdir(backupDirectory, { recursive: true });
    for (const entry of present) {
      const target = path.join(backupDirectory, path.basename(entry));
      await renameWithRetry(entry, target);
    }
    await writeFile(path.join(backupDirectory, "migration.json"), `${canonicalJson({
      schema_version: 1,
      migration_id: migrationId,
      project_id: migratedState.project_id,
      archived_entries: present.map((entry) => path.basename(entry)),
      completed_at: new Date().toISOString(),
    })}\n`, "utf8");
    return migratedState;
  }

  /** Archive legacy public entries even when the new `.workspace/state.json` already exists. */
  private async archiveExistingLegacyLayout(state: ProjectState): Promise<void> {
    const candidates: string[] = [];
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const proposalsPath = path.join(this.projectDirectory, "proposals");
    for (const entry of [legacyStatePath, proposalsPath]) {
      try {
        await stat(entry);
        candidates.push(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    const exportsDirectory = path.join(this.projectDirectory, "exports");
    try {
      const entries = await readdir(exportsDirectory, { withFileTypes: true });
      const latest = state.publishes.at(-1);
      const keep = new Set<string>();
      if (latest !== undefined) {
        keep.add(path.basename(latest.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts)));
        if (latest.png_base64 !== undefined) keep.add(path.basename(latest.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts)));
      }
      for (const entry of entries) {
        if (!keep.has(entry.name)) candidates.push(path.join(exportsDirectory, entry.name));
      }
    } catch (error) {
      if (!( ["ENOENT", "ENOTDIR"] as string[]).includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    if (candidates.length === 0) return;

    const migrationId = `migration-${contentHash(`existing:${state.project_id}:${state.revision}:${candidates.join("\n")}`).slice(0, 16)}`;
    const backupDirectory = path.join(this.projectDirectory, ".workspace", "legacy-layout", migrationId);
    await mkdir(backupDirectory, { recursive: true });
    for (const entry of candidates) {
      await renameWithRetry(entry, path.join(backupDirectory, path.basename(entry)));
    }
    await writeFile(path.join(backupDirectory, "migration.json"), `${canonicalJson({
      schema_version: 1,
      migration_id: migrationId,
      project_id: state.project_id,
      archived_entries: candidates.map((entry) => path.basename(entry)),
      completed_at: new Date().toISOString(),
    })}\n`, "utf8");
  }

  private async reconcileMaterializedFiles(state: ProjectState): Promise<void> {
    const expected = new Map<string, RepositoryFile>();
    for (const file of this.materializedFiles(state)) expected.set(normalizeRepositoryPath(file.path), file);
    for (const [relativePath, file] of expected) {
      const targetPath = path.join(this.projectDirectory, relativePath);
      const expectedContent = typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content);
      try {
        const actualContent = await readFile(targetPath);
        if (actualContent.equals(expectedContent)) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.writeTransactional(state);
      return;
    }
  }

  private async writeTransactional(state: ProjectState, writeSet: RepositoryWriteSet = {}): Promise<void> {
    await mkdir(this.projectDirectory, { recursive: true });
    const staging = path.join(this.projectDirectory, ".workspace", `.staging-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    const files = new Map<string, Uint8Array | string>();
    files.set(path.relative(this.projectDirectory, this.stateFile), `${canonicalJson(state)}\n`);
    if (this.materializeEnabled) {
      for (const file of this.materializedFiles(state)) files.set(file.path, file.content);
    }
    for (const file of writeSet.files ?? []) files.set(normalizeRepositoryPath(file.path), file.content);

    const stagedPaths: Array<{ relativePath: string; stagedPath: string; targetPath: string }> = [];
    for (const [relativePath, content] of files) {
      const normalized = normalizeRepositoryPath(relativePath);
      const stagedPath = path.join(staging, normalized);
      const targetPath = path.join(this.projectDirectory, normalized);
      await mkdir(path.dirname(stagedPath), { recursive: true });
      await writeStagedFile(stagedPath, content);
      stagedPaths.push({ relativePath: normalized, stagedPath, targetPath });
    }

    const removals = [...(writeSet.remove ?? [])].map(normalizeRepositoryPath);
    const applied: Array<{ targetPath: string; backupPath?: string; created: boolean }> = [];
    try {
      for (const item of stagedPaths) {
        await mkdir(path.dirname(item.targetPath), { recursive: true });
        const backupPath = await moveToBackup(item.targetPath);
        await renameWithRetry(item.stagedPath, item.targetPath);
        applied.push({ targetPath: item.targetPath, ...(backupPath === undefined ? {} : { backupPath }), created: backupPath === undefined });
      }
      for (const relativePath of removals) {
        const targetPath = path.join(this.projectDirectory, relativePath);
        const backupPath = await moveToBackup(targetPath);
        if (backupPath !== undefined) applied.push({ targetPath, backupPath, created: false });
      }
      for (const item of applied) {
        if (item.backupPath !== undefined) await rm(item.backupPath, { force: true });
      }
    } catch (error) {
      for (const item of [...applied].reverse()) {
        await rm(item.targetPath, { force: true }).catch(() => undefined);
        if (item.backupPath !== undefined) await renameWithRetry(item.backupPath, item.targetPath).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private materializedFiles(state: ProjectState): RepositoryFile[] {
    const files: RepositoryFile[] = [];
    const characterFolders = characterFolderById(state.artifacts);
    const worldArtifactCounts = new Map<string, number>();
    for (const artifact of state.artifacts) {
      if (artifact.kind !== "world_lore") continue;
      worldArtifactCounts.set(artifact.name, (worldArtifactCounts.get(artifact.name) ?? 0) + 1);
    }
    files.push({ path: "project.json", content: canonicalJson({
      project_id: state.project_id,
      project_name: state.project_name,
      project_slug: state.project_slug,
      status: state.project_status,
      revision: state.revision,
      updated_at: latestStateTimestamp(state),
    }) + "\n" });
    files.push({ path: ".workspace/interview.json", content: canonicalJson(state.interview) + "\n" });
    files.push({ path: ".workspace/blueprint-prechecks.json", content: canonicalJson(state.blueprint_prechecks) + "\n" });
    files.push({ path: ".workspace/adaptation-decisions.json", content: canonicalJson(state.adaptation_decisions) + "\n" });
    files.push({ path: ".workspace/quality-profile.json", content: canonicalJson(state.quality_profile) + "\n" });
    files.push({ path: ".workspace/workflow.json", content: canonicalJson({
      project_id: state.project_id,
      project_name: state.project_name,
      status: state.project_status,
      revision: state.revision,
      operations: state.operations,
      audit: state.audit,
      builds: state.builds,
      publishes: state.publishes,
      imports: state.imports,
      blueprint_prechecks: state.blueprint_prechecks,
       adaptation_decisions: state.adaptation_decisions,
       fact_review_passes: state.fact_review_passes,
       fact_review_runs: state.fact_review_runs,
       fact_review_decisions: state.fact_review_decisions,
    }) + "\n" });
    files.push({ path: "sources/manifest.json", content: canonicalJson({ candidates: state.candidates, sources: state.sources }) + "\n" });
    files.push({ path: "knowledge/chunks.json", content: canonicalJson(state.knowledge_chunks) + "\n" });
    files.push({ path: "facts/register.json", content: canonicalJson({ facts: state.facts, issues: state.issues, review_passes: state.fact_review_passes, review_runs: state.fact_review_runs, review_decisions: state.fact_review_decisions }) + "\n" });
    const latestArtifacts = new Map<string, ArtifactRecord>();
    for (const artifact of state.artifacts) latestArtifacts.set(artifact.key, artifact);
    for (const artifact of state.artifacts) {
      if (!isPublicArtifactKind(artifact.kind)) continue;
      if (artifact.kind === "wardrobe" && latestArtifacts.get(artifact.key)?.id !== artifact.id) {
        const value = parseArtifactValue(artifact);
        const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
        const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
        files.push({
          path: path.join("characters", characterFolder, "wardrobe", "revisions", `${safeSegment(artifact.revision)}.md`),
          content: artifact.content.endsWith("\n") ? artifact.content : `${artifact.content}\n`,
        });
        continue;
      }
      const target = path.relative(this.projectDirectory, artifactFilePath(this.projectDirectory, artifact, characterFolders, worldArtifactCounts));
      files.push({ path: target, content: artifact.content.endsWith("\n") ? artifact.content : `${artifact.content}\n` });
    }
    const latestPublish = state.publishes.at(-1);
    if (latestPublish !== undefined) {
      const publishedContent = latestPublish.content.endsWith("\n") ? latestPublish.content : `${latestPublish.content}\n`;
      files.push({
        path: latestPublish.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts),
        content: publishedContent,
      });
      if (latestPublish.png_base64 !== undefined) {
        files.push({
          path: latestPublish.export_png_path ?? publishedCardPngExportPath(state.project_name, state.project_id, state.artifacts),
          content: Buffer.from(latestPublish.png_base64, "base64"),
        });
      }
    }
    return files;
  }

  private async withProjectLock<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.lockFile), { recursive: true });
    const owner = `${process.pid}:${randomUUID()}`;
    const deadline = Date.now() + 10_000;
    let acquired = false;
    while (!acquired) {
      try {
        const handle = await open(this.lockFile, "wx");
        await handle.writeFile(JSON.stringify({ owner, pid: process.pid, created_at: new Date().toISOString() }), "utf8");
        await handle.close();
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        let stale = false;
        try {
          const lockStat = await stat(this.lockFile);
          stale = Date.now() - lockStat.mtimeMs > 30_000;
        } catch (statError) {
          // Windows scanners can briefly deny stat() on a lock file that is
          // already being released. Treat that like a live lock and retry;
          // only unrelated filesystem failures should escape immediately.
          const code = (statError as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "EPERM" && code !== "EACCES") throw statError;
        }
        if (stale) {
          await unlink(this.lockFile).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) throw new CoreError("REPOSITORY_LOCK_TIMEOUT", `Could not acquire project lock for ${this.projectIdValue}`, true);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await work();
    } finally {
      try {
        const raw = await readFile(this.lockFile, "utf8");
        if ((JSON.parse(raw) as { owner?: unknown }).owner === owner) await unlink(this.lockFile);
      } catch {
        // A failed cleanup is recoverable through stale-lock detection.
      }
    }
  }
}

function latestStateTimestamp(state: ProjectState): string {
  const timestamps = [
    ...state.artifacts.map((item) => item.updated_at),
    ...state.operations.map((item) => item.updated_at),
    ...state.audit.map((item) => item.occurred_at),
    ...state.builds.map((item) => item.created_at),
    ...state.publishes.map((item) => item.created_at),
    ...state.imports.map((item) => item.created_at),
  ].filter((value) => value.length > 0).sort();
  return timestamps.at(-1) ?? "1970-01-01T00:00:00.000Z";
}

function safeSegment(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/gu, "-").replace(/\s+/gu, "-").replace(/^\.+|\.+$/gu, "");
  return safe.length === 0 ? "item" : safe.slice(0, 100);
}

type MaterializedArtifactValue = {
  character_id?: unknown;
  document?: {
    id?: unknown;
    display_name?: unknown;
  };
  module?: { module?: unknown };
  plugin_id?: unknown;
};

function parseArtifactValue(artifact: ArtifactRecord): MaterializedArtifactValue {
  try {
    const parsed = JSON.parse(artifact.content) as unknown;
    if (parsed !== null && typeof parsed === "object") return parsed as MaterializedArtifactValue;
  } catch {
    // Free-text artifacts do not have structured routing metadata.
  }
  return {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function characterFolderName(characterId: string, displayName?: string): string {
  const safeId = safeSegment(characterId);
  return displayName === undefined ? safeId : `${safeId}-${safeSegment(displayName)}`;
}

function characterFolderById(artifacts: readonly ArtifactRecord[]): Map<string, string> {
  const displayNames = new Map<string, string | undefined>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "character") continue;
    const value = parseArtifactValue(artifact);
    const characterId = nonEmptyString(value.document?.id);
    if (characterId === undefined) continue;
    displayNames.set(characterId, nonEmptyString(value.document?.display_name));
  }

  const folders = new Map<string, string>();
  for (const artifact of artifacts) {
    const value = parseArtifactValue(artifact);
    if (artifact.kind === "character") {
      const characterId = nonEmptyString(value.document?.id);
      if (characterId !== undefined) folders.set(characterId, characterFolderName(characterId, displayNames.get(characterId)));
      continue;
    }
    if (artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
      const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
      folders.set(characterId, characterFolderName(characterId, displayNames.get(characterId)));
    }
  }
  return folders;
}

function normalizeRepositoryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (path.isAbsolute(value) || normalized.length === 0 || normalized.includes(":") || normalized.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new CoreError("REPOSITORY_PATH_INVALID", `Repository path must stay inside the project: ${value}`, true);
  }
  return normalized;
}

async function writeStagedFile(filePath: string, content: Uint8Array | string): Promise<void> {
  const handle = await open(filePath, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function moveToBackup(targetPath: string): Promise<string | undefined> {
  try {
    await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const backupPath = `${targetPath}.${randomUUID()}.bak`;
  await renameWithRetry(targetPath, backupPath);
  return backupPath;
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!(["EPERM", "EACCES", "EBUSY"] as string[]).includes(code ?? "") || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function artifactFilePath(root: string, artifact: ArtifactRecord, characterFolders: ReadonlyMap<string, string> = new Map(), worldArtifactCounts: ReadonlyMap<string, number> = new Map()): string {
  const value = parseArtifactValue(artifact);
  const extension = artifact.media_type === "application/json" ? "json" : "md";
  if (artifact.kind === "zhuji" || artifact.kind === "palette") {
    const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
    const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
    const mode = artifact.kind;
    return path.join(root, "characters", characterFolder, mode, `${safeSegment(String(value.module?.module ?? artifact.name))}.json`);
  }
  if (artifact.kind === "wardrobe") {
    const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
    const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
    return path.join(root, "characters", characterFolder, "wardrobe", "wardrobe.md");
  }
  if (artifact.kind === "character") {
    const characterId = nonEmptyString(value.document?.id);
    const characterFolder = characterId === undefined
      ? safeSegment(artifact.name)
      : characterFolders.get(characterId) ?? characterFolderName(characterId, nonEmptyString(value.document?.display_name));
    return path.join(root, "characters", characterFolder, `character.${extension}`);
  }
  if (artifact.kind === "blueprint") return path.join(root, "blueprint", "blueprint.json");
  if (artifact.kind === "relationship") return path.join(root, "relationships", "relationships.json");
  if (artifact.kind === "world_lore") {
    const base = safeSegment(artifact.name);
    const fileName = (worldArtifactCounts.get(artifact.name) ?? 0) > 1 ? `${base}-${safeSegment(artifact.id)}` : base;
    return path.join(root, "world", `${fileName}.json`);
  }
  if (artifact.kind === "greeting") return path.join(root, "greetings", "greetings.json");
  if (artifact.kind === "plugin") return path.join(root, "plugins", `${safeSegment(String(value.plugin_id ?? artifact.name))}.${extension}`);
  return path.join(root, ".workspace", "artifacts", safeSegment(artifact.kind), `${safeSegment(artifact.name)}.${extension}`);
}

function isPublicArtifactKind(kind: ArtifactKind): boolean {
  return kind === "character"
    || kind === "relationship"
    || kind === "world_lore"
    || kind === "greeting"
    || kind === "blueprint"
    || kind === "zhuji"
    || kind === "palette"
    || kind === "wardrobe"
    || kind === "plugin"
    || kind === "unknown";
}

export function publishedCardExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[]): string {
  const stem = safeSegment(projectName ?? projectId);
  const suffix = artifacts.some((artifact) => artifact.kind === "zhuji") ? "珠璣角色卡" : "角色卡";
  return `exports/${stem}-${suffix}.json`;
}

export function publishedCardPngExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[]): string {
  const stem = safeSegment(projectName ?? projectId);
  const suffix = artifacts.some((artifact) => artifact.kind === "zhuji") ? "珠璣角色卡" : "角色卡";
  return `exports/${stem}-${suffix}.png`;
}

export {
  requiredZhujiModules,
  structuredZhujiModuleSchema,
  zhujiAppearanceDataSchema,
  zhujiExtensionDataSchema,
  zhujiInnerNatureDataSchema,
  zhujiModuleKindSchema,
  zhujiProposalJsonSchema,
  zhujiProposalValueSchema,
  zhujiSceneDialogueDataSchema,
  zhujiSelfIntroductionDataSchema,
  zhujiTraitDialogueDataSchema,
  zhujiTraitRefinementDataSchema,
  type StructuredZhujiModule,
  type ZhujiModuleKind,
  type ZhujiProposalValue,
} from "./zhuji.js";

export {
  beginInterview,
  createInterviewState,
  InterviewError,
  recordInterviewAnswer,
  workflow_answer_interview,
  workflowAnswerInterview,
  normalizeInterviewStateForDisplay,
  BLUEPRINT_DIRECTION_QUESTION_ID,
  CHARACTER_ROSTER_QUESTION_ID,
  parseCharacterRoster,
  parseRelationshipParticipants,
  ZHUJI_SELF_INTRODUCTION_FIELDS,
  type InterviewAnswer,
  type InterviewAnswerInput,
  type InterviewCharacterSubject,
  type InterviewFlow,
  type InterviewQuestion,
  type InterviewQuestionKind,
  type InterviewState,
  type InterviewStatus,
} from "./interview.js";
export { buildZhujiTemplateContext, ZHUJI_MODULE_GUIDES, zhujiCreatorContract, type ZhujiTemplateInstance } from "./zhuji-template.js";
export {
  TEMPLATE_BINDINGS,
  TEMPLATE_GUIDES,
  buildTemplateContext,
  characterDocumentTemplateSchema,
  characterProposalValueSchema,
  characterRelationshipTemplateSchema,
  conversionMappingSchema,
  conversionProposalValueSchema,
  directorRoutingProposalValueSchema,
  directionalPerspectiveSchema,
  ejsConditionSchema,
  ejsDynamicTextSchema,
  ejsEntrySchema,
  ejsSectionSchema,
  ejsSourceSchema,
  factClaimSchema,
  factCurationProposalValueSchema,
  factDecisionSchema,
  factEvidenceSchema,
  factEvidenceReferenceSchema,
  factReviewProposalValueSchema,
  greetingKindSchema,
  greetingSchema,
  greetingsDocumentSchema,
  greetingsProposalValueSchema,
  htmlComponentSchema,
  htmlFeatureSchema,
  htmlSourceSchema,
  importAnalysisProposalValueSchema,
  importFieldMappingSchema,
  jsonPointerPathSchema,
  mvuSourceSchema,
  mvuUpdateRuleSchema,
  mvuVariableSchema,
  officialPluginIdSchema,
  paletteModuleKindSchema,
  paletteModuleSchema,
  paletteProposalValueSchema,
  pluginCapabilitySchema,
  pluginProposalValueSchema,
  pluginSourceSchema,
  relationshipsDocumentSchema,
  relationshipsProposalValueSchema,
  relationshipCharacterSummarySchema,
  relationshipConflictTriggerSchema,
  relationshipGroupSchema,
  relationshipNetworkSummarySchema,
  relationshipTeamCodeSchema,
  reviewEvidenceSchema,
  reviewFindingSchema,
  reviewProposalValueSchema,
  reviewReportSchema,
  reviewSeveritySchema,
  sourceCandidateDraftSchema,
  sourceResearchProposalValueSchema,
  templateIdSchema,
  templateJsonSchemaFor,
  templateProvenanceSchema,
  templateProposalJsonSchema,
  templateProposalValueSchema,
  templateSchemaFor,
  templateSectionSchema,
  worldCategorySchema,
  worldEntrySchema,
  worldProposalValueSchema,
  type CharacterDocumentTemplate,
  type FactClaim,
  type FactDecision,
  type GreetingsDocument,
  type PaletteModule,
  type PaletteModuleKind,
  type PluginSource,
  type RelationshipsDocument,
  type ReviewFinding,
  type TemplateInstance,
  type TemplateKind,
  type TemplateProposalValue,
  type WardrobeProposalValue,
  type WorldEntry,
} from "./templates.js";
export {
  parseWardrobeMarkdown,
  wardrobeProposalValueSchema,
  wardrobeCategoryNames,
  wardrobeCharacterIdSchema,
  type ParsedWardrobeMarkdown,
  type WardrobeCategory,
  type WardrobeDiagnostic,
  type WardrobeDiagnosticSeverity,
  type WardrobeItem,
  type WardrobeOutfit,
  type WardrobeParseResult,
  type WardrobeProposal,
} from "./wardrobe.js";
export { collectFactReferences, validateFactReferences, type FactReferenceFinding } from "./fact-provenance.js";
export {
  AUTHORING_KNOWLEDGE_RULES,
  sourceContextFromRecord,
  type AdaptationDecision,
  type AuthoringKnowledgeContext,
  type AuthoringKnowledgeSource,
  type AuthoringSourceContext,
  type FactReviewCandidateContext,
  type FactReviewContext,
  type FactProvenanceRef,
  type SourceAdaptationIntent,
} from "./authoring-context.js";
