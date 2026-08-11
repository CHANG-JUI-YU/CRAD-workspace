import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createInterviewState, type InterviewFlow, type InterviewState } from "./interview.js";
import type { AdaptationDecision } from "./authoring-context.js";
import { FileBlobStore, MemoryBlobStore, type BlobStore } from "./blob-store.js";

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
  | "draft_note"
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

/** Audited, issue-scoped downgrade. Global policy overrides live on QualityProfile. */
export interface IssueOverride {
  by: string;
  reason: string;
  timestamp: string;
  against_effective_severity: IssueSeverity;
  /** Explicit target; optional only for backward-compatible legacy records. */
  severity?: IssueSeverity;
  policy_snapshot?: QualityPolicySnapshot;
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
  /** Intake values key this check asks the user to confirm or supplement (BUG-12 per-item confirmation). */
  intake_key?: string;
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
  /** Optional per-issue downgrade; never a global quality policy mutation. */
  override?: IssueOverride;
  evidence?: string[];
  overridable?: boolean;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
}

export interface ContentBlobReference {
  hash: string;
  size: number;
}

export interface BuildRecord {
  id: string;
  operation_id: string;
  status: "previewed" | "built" | "failed";
  artifact_ids: string[];
  /** Deprecated: the compiled card JSON is stored as an immutable blob since V3.11. */
  canonical_ir?: string;
  canonical_ir_ref?: ContentBlobReference;
  content_hash: string;
  diagnostics: string[];
  created_at: string;
  quality_policy_snapshot?: QualityPolicySnapshot;
}

export interface PublishRecord {
  id: string;
  operation_id: string;
  artifact_ids: string[];
  /** Deprecated: the compiled card JSON is stored as an immutable blob since V3.11. */
  content?: string;
  content_ref?: ContentBlobReference;
  content_hash: string;
  /** Deprecated: PNG bytes are stored as an immutable blob since V3.11. */
  png_base64?: string;
  png_ref?: ContentBlobReference;
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
  original_binary?: string;
  attachments?: Array<{ name: string; media_type: string; original_hash: string }>;
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

/** Reference to an attachment persisted outside the project state. */
export interface OperationAttachmentRef {
  id: string;
  name: string;
  media_type?: string;
}

/** Versioned typed command persisted with the operation so crash recovery can replay the original payload. */
export interface OperationCommand {
  version: 1;
  type: "template_proposal" | "zhuji_proposal" | "import" | "source_resume" | "source_search" | "source_select" | "issue_update" | "request";
  payload?: unknown;
  attachment_refs?: OperationAttachmentRef[];
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
  attempt?: number;
  last_error?: string;
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
  content: z.string().min(1).optional(),
  content_ref: blobReferenceSchema.optional(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  png_base64: z.string().min(1).optional(),
  png_ref: blobReferenceSchema.optional(),
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
  original_binary: z.string().min(1).optional(),
  attachments: z.array(z.object({
    name: z.string().min(1),
    media_type: z.string().min(1),
    original_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  })).optional(),
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
  command: z.object({
    version: z.literal(1),
    type: z.enum(["template_proposal", "zhuji_proposal", "import", "source_resume", "source_search", "source_select", "issue_update", "request"]),
    payload: z.unknown().optional(),
    attachment_refs: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      media_type: z.string().optional(),
    }).strict()).optional(),
  }).strict().optional(),
  idempotency_key: z.string().optional(),
  lease_owner: z.string().min(1).optional(),
  lease_token: z.string().min(1).optional(),
  lease_expires_at: z.string().datetime({ offset: true }).optional(),
  attempt: z.number().int().nonnegative().optional(),
  last_error: z.string().optional(),
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
  /** The interview flow that produced this result (BUG-13 flow dispatch). */
  flow?: InterviewFlow;
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
  readonly projectId?: string;
  read(): Promise<ProjectState>;
  transaction<T>(expectedRevision: number, work: RepositoryTransactionWork<T>): Promise<RepositoryTransactionCommit<T>>;
  commit(expectedRevision: number, mutate: (state: ProjectState) => ProjectState, writeSet?: RepositoryWriteSet): Promise<ProjectState>;
  readBlob(hash: string): Promise<Uint8Array | undefined>;
  writeBlob(hash: string, content: Uint8Array): Promise<void>;
  inspectRepair(): Promise<RepairInspection>;
  runRepair(): Promise<RepairReport>;
}

export interface RepairInspection {
  legacy_files: string[];
  orphan_backups: string[];
}

export interface RepairReport {
  archived: string[];
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

export type RepositoryFailureInjectionPoint =
  | "after_journal"
  | "before_backup"
  | "after_backup"
  | "before_install"
  | "after_install"
  | "before_cleanup"
  | "after_cleanup";

/** Test-only hooks for deterministic crash/rollback tests. */
export interface RepositoryFailureInjection {
  readonly point: RepositoryFailureInjectionPoint;
  readonly mode?: "error" | "crash";
  readonly once?: boolean;
  /** Restrict the injection to one transaction entry path. */
  readonly relative_path?: string;
}

export interface RepositoryLockOptions {
  readonly lease_ms?: number;
  readonly heartbeat_ms?: number;
  readonly timeout_ms?: number;
  readonly poll_ms?: number;
}

export interface FileProjectRepositoryOptions {
  readonly layout?: "legacy" | "project";
  readonly materialize?: boolean;
  readonly lock?: RepositoryLockOptions;
  readonly failure_injection?: RepositoryFailureInjection;
}

export interface RepositoryTransactionRecoveryAuditRecord {
  readonly schema_version: 1;
  readonly id: string;
  readonly kind: "transaction_recovery";
  readonly project_id: string;
  readonly transaction_id: string;
  readonly direction: "rollback" | "finalize";
  readonly outcome: "completed" | "failed";
  readonly occurred_at: string;
  readonly error_code?: string;
}

export interface RepositoryStaleLockTakeoverAuditRecord {
  readonly schema_version: 1;
  readonly id: string;
  readonly kind: "stale_lock_takeover";
  readonly project_id: string;
  /** The lock filename's existing SHA-256 key; never the temporary path. */
  readonly lock_key: string;
  /** SHA-256 of the displaced owner token; the raw token is never persisted. */
  readonly previous_owner_hash: string;
  readonly outcome: "completed";
  readonly occurred_at: string;
}

export type RepositoryRecoveryAuditRecord = RepositoryTransactionRecoveryAuditRecord | RepositoryStaleLockTakeoverAuditRecord;

type RepositoryTransactionPhase = "prepared" | "applying" | "committed";
type RepositoryTransactionEntryPhase = "planned" | "backing_up" | "backed_up" | "installing" | "installed" | "removed";
type RepositoryTargetKind = "missing" | "file" | "directory" | "other";

interface RepositoryTargetSnapshot {
  readonly kind: RepositoryTargetKind;
  readonly hash?: string;
  readonly size?: number;
}

interface RepositoryTransactionJournalEntry {
  readonly action: "write" | "remove";
  readonly relative_path: string;
  readonly target_path: string;
  readonly staged_path?: string;
  readonly backup_path: string;
  original: RepositoryTargetSnapshot;
  readonly expected: RepositoryTargetSnapshot;
  phase: RepositoryTransactionEntryPhase;
  backup_created: boolean;
  installed: boolean;
}

interface RepositoryTransactionJournal {
  readonly schema_version: 1;
  readonly id: string;
  readonly project_id: string;
  readonly owner: string;
  readonly expected_revision: number;
  readonly staging_directory: string;
  readonly transaction_directory: string;
  readonly entries: RepositoryTransactionJournalEntry[];
  phase: RepositoryTransactionPhase;
  created_at: string;
  updated_at: string;
}

interface LockRecord {
  readonly schema_version: 1;
  readonly owner: string;
  readonly pid: number;
  readonly created_at: string;
  readonly heartbeat_at: string;
  readonly lease_expires_at: string;
}

interface LockLeaseContext {
  readonly owner: string;
  readonly lock_files: readonly string[];
  readonly lease_ms: number;
  readonly heartbeat_ms: number;
  heartbeat_timer?: ReturnType<typeof setInterval>;
  heartbeat_tail: Promise<void>;
  lost?: CoreError;
}

const DEFAULT_LOCK_OPTIONS: Required<RepositoryLockOptions> = {
  lease_ms: 30_000,
  heartbeat_ms: 10_000,
  timeout_ms: 10_000,
  poll_ms: 25,
};

export class MemoryProjectRepository implements ProjectRepository {
  private state: ProjectState;
  private queue: Promise<void> = Promise.resolve();
  private readonly blobs = new MemoryBlobStore();

  constructor(projectId: string, initial?: ProjectState) {
    this.state = validateState(cloneState(initial ?? createProjectState(projectId)));
  }

  async readBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(hash);
  }

  async writeBlob(hash: string, content: Uint8Array): Promise<void> {
    await this.blobs.put(hash, content);
  }

  async inspectRepair(): Promise<RepairInspection> {
    return { legacy_files: [], orphan_backups: [] };
  }

  async runRepair(): Promise<RepairReport> {
    return { archived: [] };
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
  private readonly lockOptions: Required<RepositoryLockOptions>;
  private failureInjection: RepositoryFailureInjection | undefined;
  private activeLock: LockLeaseContext | undefined;
  private blobs: BlobStore;

  constructor(projectRoot: string, projectId: string, options: FileProjectRepositoryOptions = {}) {
    this.projectRoot = projectRoot;
    this.projectIdValue = projectId;
    this.layout = options.layout ?? "legacy";
    this.materializeEnabled = options.materialize ?? false;
    this.lockOptions = { ...DEFAULT_LOCK_OPTIONS, ...options.lock };
    this.failureInjection = options.failure_injection;
    this.stateFile = this.stateFileFor(projectId);
    this.lockFile = this.lockFileFor(projectId);
    this.blobs = new FileBlobStore(path.join(this.projectRoot, projectId, ".workspace", "blobs"));
  }

  get projectId(): string {
    return this.projectIdValue;
  }

  get projectDirectory(): string {
    return path.join(this.projectRoot, this.projectIdValue);
  }

  /** Read the append-only repository recovery ledger without taking a project lock. */
  async readRecoveryLedger(): Promise<readonly RepositoryRecoveryAuditRecord[]> {
    return readRecoveryLedgerFile(this.recoveryLedgerFile());
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
      const sourceLockFile = this.lockFile;
      const targetLockFile = this.lockFileFor(normalized);
      await this.withLockFiles([sourceLockFile, targetLockFile], async () => {
        await this.recoverIncompleteTransactions();
        await mkdir(this.projectRoot, { recursive: true });
        await this.assertLockOwner();
        await renameWithRetry(this.projectDirectory, targetDirectory);
      });
      this.projectIdValue = normalized;
      this.stateFile = this.stateFileFor(normalized);
      this.lockFile = this.lockFileFor(normalized);
      this.blobs = new FileBlobStore(path.join(this.projectRoot, normalized, ".workspace", "blobs"));
    });
    this.queue = run.then(() => undefined, () => undefined);
    await run;
  }

  async readBlob(hash: string): Promise<Uint8Array | undefined> {
    return this.blobs.get(hash);
  }

  async writeBlob(hash: string, content: Uint8Array): Promise<void> {
    await this.blobs.put(hash, content);
  }

  async inspectRepair(): Promise<RepairInspection> {
    if (this.layout !== "project") return { legacy_files: [], orphan_backups: [] };
    const legacy_files: string[] = [];
    const legacyStatePath = path.join(this.projectDirectory, "state.json");
    const proposalsPath = path.join(this.projectDirectory, "proposals");
    const exportsPath = path.join(this.projectDirectory, "exports");
    for (const entry of [legacyStatePath, proposalsPath, exportsPath]) {
      try {
        await stat(entry);
        legacy_files.push(path.basename(entry));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const orphan_backups: string[] = [];
    const backupsPath = path.join(this.projectDirectory, ".workspace", "legacy-layout");
    try {
      const entries = await readdir(backupsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) orphan_backups.push(entry.name);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return { legacy_files, orphan_backups };
  }

  async runRepair(): Promise<RepairReport> {
    const inspection = await this.inspectRepair();
    const archived: string[] = [];
    if (inspection.legacy_files.length > 0) {
      const state = await this.read();
      await this.archiveExistingLegacyLayout(state);
      for (const entry of inspection.legacy_files) archived.push(entry);
    }
    return { archived };
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

  private recoveryLedgerFile(): string {
    return path.join(this.projectDirectory, ".workspace", "recovery-ledger.jsonl");
  }

  async read(): Promise<ProjectState> {
    await this.queue;
    return this.withProjectLock(async () => {
      await this.recoverIncompleteTransactions();
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
        await this.recoverIncompleteTransactions();
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
    const exportsDirectory = path.join(this.projectDirectory, "exports");
    const latest = migratedState.publishes.at(-1);
    const keep = new Set<string>();
    if (latest !== undefined) {
      keep.add(path.basename(latest.export_json_path ?? publishedCardExportPath(migratedState.project_name, migratedState.project_id, migratedState.artifacts)));
      if (latest.png_base64 !== undefined) keep.add(path.basename(latest.export_png_path ?? publishedCardPngExportPath(migratedState.project_name, migratedState.project_id, migratedState.artifacts)));
    }
    for (const entry of present) {
      if (entry === exportsDirectory) {
        const files = await readdir(entry, { withFileTypes: true });
        for (const file of files) {
          if (keep.has(file.name)) continue;
          const target = path.join(backupDirectory, "exports", file.name);
          await mkdir(path.dirname(target), { recursive: true });
          await renameWithRetry(path.join(entry, file.name), target);
        }
        continue;
      }
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
    const transactionId = `transaction-${randomUUID()}`;
    const staging = path.join(this.projectDirectory, ".workspace", `.staging-${transactionId}`);
    const transactionDirectory = path.join(this.projectDirectory, ".workspace", "transactions", transactionId);
    const journalPath = path.join(transactionDirectory, "journal.jsonl");
    const files = new Map<string, Uint8Array | string>();
    files.set(normalizeRepositoryPath(path.relative(this.projectDirectory, this.stateFile)), `${canonicalJson(state)}\n`);
    if (this.materializeEnabled) {
      for (const file of this.materializedFiles(state)) files.set(normalizeRepositoryPath(file.path), file.content);
    }
    for (const file of writeSet.files ?? []) files.set(normalizeRepositoryPath(file.path), file.content);

    const entries: RepositoryTransactionJournalEntry[] = [];
    let entryIndex = 0;
    for (const [relativePath, content] of files) {
      const normalized = normalizeRepositoryPath(relativePath);
      assertTransactionTargetPath(normalized);
      const stagedPath = path.join(staging, normalized);
      const targetPath = path.join(this.projectDirectory, normalized);
      const backupPath = path.join(transactionDirectory, "backups", `${entryIndex}-${safeSegment(path.basename(normalized))}`);
      entries.push({
        action: "write",
        relative_path: normalized,
        target_path: normalized,
        staged_path: normalizeRepositoryPath(path.relative(this.projectDirectory, stagedPath)),
        backup_path: normalizeRepositoryPath(path.relative(this.projectDirectory, backupPath)),
        original: await inspectTarget(targetPath),
        expected: snapshotForContent(content),
        phase: "planned",
        backup_created: false,
        installed: false,
      });
      entryIndex += 1;
    }
    for (const relativePath of [...(writeSet.remove ?? [])].map(normalizeRepositoryPath)) {
      assertTransactionTargetPath(relativePath);
      const targetPath = path.join(this.projectDirectory, relativePath);
      const backupPath = path.join(transactionDirectory, "backups", `${entryIndex}-${safeSegment(path.basename(relativePath))}`);
      entries.push({
        action: "remove",
        relative_path: relativePath,
        target_path: relativePath,
        backup_path: normalizeRepositoryPath(path.relative(this.projectDirectory, backupPath)),
        original: await inspectTarget(targetPath),
        expected: { kind: "missing" },
        phase: "planned",
        backup_created: false,
        installed: false,
      });
      entryIndex += 1;
    }

    const now = new Date().toISOString();
    const journal: RepositoryTransactionJournal = {
      schema_version: 1,
      id: transactionId,
      project_id: this.projectIdValue,
      owner: this.activeLock?.owner ?? "internal",
      expected_revision: state.revision,
      staging_directory: normalizeRepositoryPath(path.relative(this.projectDirectory, staging)),
      transaction_directory: normalizeRepositoryPath(path.relative(this.projectDirectory, transactionDirectory)),
      entries,
      phase: "prepared",
      created_at: now,
      updated_at: now,
    };
    let journalPersisted = false;
    let committed = false;
    let preserveArtifacts = false;
    try {
      await mkdir(staging, { recursive: true });
      await mkdir(path.join(transactionDirectory, "backups"), { recursive: true });
      await this.persistJournal(journalPath, journal);
      journalPersisted = true;
      this.injectFailure("after_journal");

      for (const entry of journal.entries) {
        if (entry.action !== "write" || entry.staged_path === undefined) continue;
        await this.assertLockOwner();
        const stagedPath = path.join(this.projectDirectory, entry.staged_path);
        const content = files.get(entry.relative_path);
        if (content === undefined) throw new CoreError("TRANSACTION_PLAN_INVALID", `Missing staged content for ${entry.relative_path}`);
        await mkdir(path.dirname(stagedPath), { recursive: true });
        await writeStagedFile(stagedPath, content);
      }
      journal.phase = "applying";
      await this.persistJournal(journalPath, journal);

      for (const entry of journal.entries) {
        await this.assertLockOwner();
        const targetPath = path.join(this.projectDirectory, entry.target_path);
        const backupPath = path.join(this.projectDirectory, entry.backup_path);
        await mkdir(path.dirname(targetPath), { recursive: true });
        entry.phase = "backing_up";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("before_backup");
        const backupCreated = await moveToBackup(targetPath, backupPath);
        entry.backup_created = backupCreated;
        if (backupCreated && entry.original.kind === "missing") entry.original = await inspectTarget(backupPath);
        entry.phase = "backed_up";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("after_backup", entry.relative_path);

        if (entry.action === "remove") {
          entry.installed = true;
          entry.phase = "removed";
          await this.persistJournal(journalPath, journal);
          continue;
        }

        if (entry.staged_path === undefined) throw new CoreError("TRANSACTION_PLAN_INVALID", `Missing staged path for ${entry.relative_path}`);
        const stagedPath = path.join(this.projectDirectory, entry.staged_path);
        entry.phase = "installing";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("before_install", entry.relative_path);
        await renameWithRetry(stagedPath, targetPath);
        await syncDirectory(path.dirname(targetPath));
        entry.installed = true;
        entry.phase = "installed";
        await this.persistJournal(journalPath, journal);
        this.injectFailure("after_install", entry.relative_path);
      }

      journal.phase = "committed";
      await this.persistJournal(journalPath, journal);
      committed = true;
      await this.cleanupCommittedJournal(journal, journalPath);
    } catch (error) {
      if (error instanceof RepositoryCrashInjection) {
        preserveArtifacts = true;
        throw error;
      }
      if (committed || error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") {
        preserveArtifacts = true;
        throw error;
      }
      if (journalPersisted) {
        try {
          await this.rollbackJournal(journal, journalPath);
        } catch (recoveryError) {
          preserveArtifacts = true;
          throw new CoreError("TRANSACTION_RECOVERY_REQUIRED", `Transaction ${transactionId} could not be rolled back safely`, true, { cause: recoveryError, transaction_id: transactionId });
        }
      }
      throw error;
    } finally {
      if (!preserveArtifacts) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async persistJournal(journalPath: string, journal: RepositoryTransactionJournal): Promise<void> {
    await this.assertLockOwner();
    journal.updated_at = new Date().toISOString();
    await appendDurableJournalSnapshot(journalPath, journal);
  }

  private async recoverIncompleteTransactions(): Promise<void> {
    const transactionsRoot = path.join(this.projectDirectory, ".workspace", "transactions");
    let entries;
    try {
      entries = await readdir(transactionsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const transactionDirectory = path.join(transactionsRoot, entry.name);
      const journalPath = path.join(transactionDirectory, "journal.jsonl");
      let journal: RepositoryTransactionJournal | undefined;
      try {
        journal = await readLatestJournalSnapshot(journalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const leftovers = await readdir(transactionDirectory);
          if (leftovers.length === 0) {
            await rm(transactionDirectory, { recursive: true, force: true });
            continue;
          }
        }
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Cannot determine the state of transaction ${entry.name}`, true, { cause: error, transaction_id: entry.name });
      }
      if (journal === undefined) throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Transaction ${entry.name} has no durable journal`, true, { transaction_id: entry.name });
      if (journal.project_id !== this.projectIdValue || journal.id !== entry.name) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Transaction ${entry.name} does not belong to this project`, true, { transaction_id: entry.name });
      }
      const direction: RepositoryTransactionRecoveryAuditRecord["direction"] = journal.phase === "committed" ? "finalize" : "rollback";
      let completedAuditRecorded = false;
      try {
        if (direction === "finalize") await this.finalizeCommittedJournal(journal, journalPath, false);
        else await this.rollbackJournal(journal, journalPath, false);
        await this.appendTransactionRecoveryAudit(journal, direction, "completed");
        completedAuditRecorded = true;
        if (direction === "finalize") await this.cleanupCommittedJournal(journal, journalPath);
        else await this.cleanupRecoveredRollback(journal, journalPath);
      } catch (error) {
        if (!completedAuditRecorded) {
          try {
            await this.appendTransactionRecoveryAudit(journal, direction, "failed", error);
          } catch (auditError) {
            throw new CoreError("RECOVERY_AUDIT_WRITE_FAILED", `Could not audit recovery of transaction ${journal.id}`, true, {
              audit_error: auditError,
              recovery_error: error,
              transaction_id: journal.id,
            });
          }
        }
        throw error;
      }
    }
  }

  private async rollbackJournal(journal: RepositoryTransactionJournal, journalPath: string, cleanup = true): Promise<void> {
    for (const entry of [...journal.entries].reverse()) {
      await this.assertLockOwner();
      const targetPath = path.join(this.projectDirectory, entry.target_path);
      const backupPath = path.join(this.projectDirectory, entry.backup_path);
      if (await pathExists(backupPath)) {
        await removePath(targetPath);
        await renameWithRetry(backupPath, targetPath);
        await syncDirectory(path.dirname(targetPath));
        entry.backup_created = false;
        entry.installed = false;
        entry.phase = "planned";
        await this.persistJournal(journalPath, journal);
      } else {
        const actual = await inspectTarget(targetPath);
        if (snapshotsEqual(actual, entry.original)) {
          entry.installed = false;
          entry.phase = "planned";
          await this.persistJournal(journalPath, journal);
        } else if (entry.original.kind === "missing" && snapshotsEqual(actual, entry.expected)) {
          await removePath(targetPath);
          entry.installed = false;
          entry.phase = "planned";
          await this.persistJournal(journalPath, journal);
        } else {
          throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Cannot restore ${entry.relative_path} without its original backup`, true, { path: entry.relative_path, transaction_id: journal.id });
        }
      }
    }
    for (const entry of journal.entries) {
      const actual = await inspectTarget(path.join(this.projectDirectory, entry.target_path));
      if (!snapshotsEqual(actual, entry.original)) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Rollback verification failed for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
      }
    }
    if (cleanup) {
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    }
  }

  private async finalizeCommittedJournal(journal: RepositoryTransactionJournal, journalPath: string, cleanup = true): Promise<void> {
    for (const entry of journal.entries) {
      await this.assertLockOwner();
      const targetPath = path.join(this.projectDirectory, entry.target_path);
      if (entry.action === "remove") {
        await removePath(targetPath);
        continue;
      }
      const expected = await inspectTarget(targetPath);
      if (!snapshotsEqual(expected, entry.expected)) {
        if (entry.staged_path === undefined || !(await pathExists(path.join(this.projectDirectory, entry.staged_path)))) {
          throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Committed transaction is missing the new content for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
        }
        await removePath(targetPath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await renameWithRetry(path.join(this.projectDirectory, entry.staged_path), targetPath);
        await syncDirectory(path.dirname(targetPath));
      }
      const verified = await inspectTarget(targetPath);
      if (!snapshotsEqual(verified, entry.expected)) {
        throw new CoreError("TRANSACTION_RECOVERY_UNCERTAIN", `Commit verification failed for ${entry.relative_path}`, true, { path: entry.relative_path, transaction_id: journal.id });
      }
    }
    if (cleanup) await this.cleanupCommittedJournal(journal, journalPath);
  }

  private async cleanupRecoveredRollback(journal: RepositoryTransactionJournal, journalPath: string): Promise<void> {
    try {
      await this.assertLockOwner();
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    } catch (error) {
      if (error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") throw error;
      // The old version has already been verified and its audit record is
      // durable. Leftovers are safe to retry on the next repository read.
    }
  }

  private async appendTransactionRecoveryAudit(
    journal: RepositoryTransactionJournal,
    direction: RepositoryTransactionRecoveryAuditRecord["direction"],
    outcome: RepositoryTransactionRecoveryAuditRecord["outcome"],
    error?: unknown,
  ): Promise<void> {
    const errorCode = recoveryErrorCode(error);
    await this.appendRecoveryAudit({
      schema_version: 1,
      id: `transaction-recovery-${contentHash(`${this.projectIdValue}\0${journal.id}\0${direction}\0${outcome}`)}`,
      kind: "transaction_recovery",
      project_id: this.projectIdValue,
      transaction_id: journal.id,
      direction,
      outcome,
      occurred_at: new Date().toISOString(),
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
    });
  }

  private async appendStaleLockTakeoverAudit(event: ExpiredLockTakeover): Promise<void> {
    const lockKey = path.basename(event.lock_file, ".lock");
    const previousOwnerHash = `sha256:${contentHash(event.previous_owner)}`;
    await this.appendRecoveryAudit({
      schema_version: 1,
      id: `stale-lock-takeover-${contentHash(`${this.projectIdValue}\0${lockKey}\0${previousOwnerHash}`)}`,
      kind: "stale_lock_takeover",
      project_id: this.projectIdValue,
      lock_key: lockKey,
      previous_owner_hash: previousOwnerHash,
      outcome: "completed",
      occurred_at: event.occurred_at,
    });
  }

  private async appendRecoveryAudit(record: RepositoryRecoveryAuditRecord): Promise<void> {
    const ledgerFile = this.recoveryLedgerFile();
    const existing = await readRecoveryLedgerFile(ledgerFile);
    if (existing.some((candidate) => candidate.id === record.id)) return;
    await appendDurableRecoveryAuditRecord(ledgerFile, record);
  }

  private async cleanupCommittedJournal(journal: RepositoryTransactionJournal, journalPath: string): Promise<void> {
    try {
      await this.assertLockOwner();
      this.injectFailure("before_cleanup");
      for (const entry of journal.entries) {
        await removePath(path.join(this.projectDirectory, entry.backup_path));
      }
      await rm(path.join(this.projectDirectory, journal.staging_directory), { recursive: true, force: true });
      this.injectFailure("after_cleanup");
      await rm(journalPath, { force: true });
      await rm(path.dirname(journalPath), { recursive: true, force: true });
    } catch (error) {
      if (error instanceof RepositoryCrashInjection || error instanceof CoreError && error.code === "REPOSITORY_LOCK_LOST") throw error;
      // The commit marker is already durable. A failed cleanup is safe to retry
      // on the next read, so never roll a committed transaction back.
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
      if (latestPublish.content !== undefined) {
        const publishedContent = latestPublish.content.endsWith("\n") ? latestPublish.content : `${latestPublish.content}\n`;
        files.push({
          path: latestPublish.export_json_path ?? publishedCardExportPath(state.project_name, state.project_id, state.artifacts),
          content: publishedContent,
        });
      }
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
    return this.withLockFiles([this.lockFile], work);
  }

  private async withLockFiles<T>(lockFiles: readonly string[], work: () => Promise<T>): Promise<T> {
    const orderedLockFiles = [...new Set(lockFiles)].sort();
    const owner = `${process.pid}:${randomUUID()}`;
    const context: LockLeaseContext = {
      owner,
      lock_files: orderedLockFiles,
      lease_ms: this.lockOptions.lease_ms,
      heartbeat_ms: Math.max(1, Math.min(this.lockOptions.heartbeat_ms, Math.max(1, this.lockOptions.lease_ms - 1))),
      heartbeat_tail: Promise.resolve(),
    };
    const acquired: string[] = [];
    try {
      for (const lockFile of orderedLockFiles) {
        await acquireLockFile(lockFile, owner, this.lockOptions, (event) => this.appendStaleLockTakeoverAudit(event));
        acquired.push(lockFile);
      }
      this.activeLock = context;
      context.heartbeat_timer = setInterval(() => {
        context.heartbeat_tail = context.heartbeat_tail.then(async () => {
          if (context.lost !== undefined) return;
          try {
            for (const lockFile of context.lock_files) await refreshLockFile(lockFile, context.owner, context.lease_ms);
          } catch (error) {
            context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock ownership was lost for ${this.projectIdValue}`, true, { cause: error });
          }
        });
      }, context.heartbeat_ms);
      context.heartbeat_timer.unref?.();
      const result = await work();
      await context.heartbeat_tail;
      if (context.lost !== undefined) throw context.lost;
      return result;
    } finally {
      if (context.heartbeat_timer !== undefined) clearInterval(context.heartbeat_timer);
      await context.heartbeat_tail;
      if (this.activeLock === context) this.activeLock = undefined;
      for (const lockFile of [...acquired].reverse()) await releaseLockFile(lockFile, owner);
    }
  }

  private async assertLockOwner(): Promise<void> {
    const context = this.activeLock;
    if (context === undefined) return;
    if (context.lost !== undefined) throw context.lost;
    for (const lockFile of context.lock_files) {
      let record: LockRecord;
      try {
        record = await readLockRecord(lockFile);
      } catch (error) {
        context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock is no longer readable for ${this.projectIdValue}`, true, { cause: error });
        throw context.lost;
      }
      if (record.owner !== context.owner || Date.parse(record.lease_expires_at) <= Date.now()) {
        context.lost = new CoreError("REPOSITORY_LOCK_LOST", `Project lock ownership changed for ${this.projectIdValue}`, true, { owner: context.owner, current_owner: record.owner });
        throw context.lost;
      }
    }
  }

  private injectFailure(point: RepositoryFailureInjectionPoint, relativePath?: string): void {
    if (this.failureInjection?.point !== point) return;
    if (this.failureInjection.relative_path !== undefined && this.failureInjection.relative_path !== relativePath) return;
    const injection = this.failureInjection;
    if (injection.once !== false) this.failureInjection = undefined;
    if (injection.mode === "crash") throw new RepositoryCrashInjection(point);
    throw new CoreError("INJECTED_FAILURE", `Injected repository failure at ${point}`, true, { point });
  }
}

class RepositoryCrashInjection extends Error {
  constructor(point: RepositoryFailureInjectionPoint) {
    super(`Injected repository crash at ${point}`);
    this.name = "RepositoryCrashInjection";
  }
}

async function appendDurableJournalSnapshot(journalPath: string, journal: RepositoryTransactionJournal): Promise<void> {
  await mkdir(path.dirname(journalPath), { recursive: true });
  const handle = await open(journalPath, "a");
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(journalPath));
}

async function appendDurableRecoveryAuditRecord(ledgerFile: string, record: RepositoryRecoveryAuditRecord): Promise<void> {
  await mkdir(path.dirname(ledgerFile), { recursive: true });
  const handle = await open(ledgerFile, "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(ledgerFile));
}

async function readRecoveryLedgerFile(ledgerFile: string): Promise<readonly RepositoryRecoveryAuditRecord[]> {
  let raw: string;
  try {
    raw = await readFile(ledgerFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split(/\r?\n/u);
  const records = new Map<string, RepositoryRecoveryAuditRecord>();
  let lastNonEmpty = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim().length !== 0) lastNonEmpty = index;
  }
  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      if (index === lastNonEmpty && !raw.endsWith("\n")) break;
      throw new CoreError("RECOVERY_LEDGER_CORRUPT", `Repository recovery ledger ${ledgerFile} is corrupt`, true, { cause: error });
    }
    if (!isRepositoryRecoveryAuditRecord(parsed)) {
      throw new CoreError("RECOVERY_LEDGER_CORRUPT", `Repository recovery ledger ${ledgerFile} contains an invalid record`, true);
    }
    if (!records.has(parsed.id)) records.set(parsed.id, parsed);
  }
  return [...records.values()];
}

function isRepositoryRecoveryAuditRecord(value: unknown): value is RepositoryRecoveryAuditRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RepositoryRecoveryAuditRecord>;
  if (record.schema_version !== 1 || typeof record.id !== "string" || record.id.length === 0 || typeof record.project_id !== "string" || typeof record.occurred_at !== "string") return false;
  if (record.kind === "transaction_recovery") {
    const transactionRecord = record as Partial<RepositoryTransactionRecoveryAuditRecord>;
    return typeof transactionRecord.transaction_id === "string"
      && ["rollback", "finalize"].includes(transactionRecord.direction ?? "")
      && ["completed", "failed"].includes(transactionRecord.outcome ?? "")
      && (transactionRecord.error_code === undefined || typeof transactionRecord.error_code === "string");
  }
  if (record.kind === "stale_lock_takeover") {
    const takeoverRecord = record as Partial<RepositoryStaleLockTakeoverAuditRecord>;
    return typeof takeoverRecord.lock_key === "string"
      && takeoverRecord.lock_key.length > 0
      && typeof takeoverRecord.previous_owner_hash === "string"
      && takeoverRecord.previous_owner_hash.startsWith("sha256:")
      && takeoverRecord.outcome === "completed";
  }
  return false;
}

function recoveryErrorCode(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (error instanceof CoreError) return error.code;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN";
}

async function readLatestJournalSnapshot(journalPath: string): Promise<RepositoryTransactionJournal | undefined> {
  const raw = await readFile(journalPath, "utf8");
  const lines = raw.split(/\r?\n/u);
  let latest: RepositoryTransactionJournal | undefined;
  let lastNonEmpty = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim().length !== 0) lastNonEmpty = index;
  }
  for (let index = 0; index <= lastNonEmpty; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isTransactionJournal(parsed)) throw new Error("invalid transaction journal snapshot");
      latest = parsed;
    } catch (error) {
      // A process can die in the middle of the final append. A complete
      // earlier snapshot is safe to use; corruption in any earlier line is
      // not safe to guess through.
      if (index === lastNonEmpty) break;
      throw new CoreError("TRANSACTION_JOURNAL_CORRUPT", `Transaction journal ${journalPath} is corrupt`, true, { cause: error });
    }
  }
  if (latest === undefined) throw new CoreError("TRANSACTION_JOURNAL_CORRUPT", `Transaction journal ${journalPath} has no complete snapshot`, true);
  return latest;
}

function isTransactionJournal(value: unknown): value is RepositoryTransactionJournal {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<RepositoryTransactionJournal>;
  if (record.schema_version !== 1 || typeof record.id !== "string" || typeof record.project_id !== "string" || typeof record.owner !== "string") return false;
  if (typeof record.expected_revision !== "number" || typeof record.staging_directory !== "string" || typeof record.transaction_directory !== "string" || !Array.isArray(record.entries) || !["prepared", "applying", "committed"].includes(record.phase ?? "")) return false;
  try {
    normalizeRepositoryPath(record.staging_directory);
    normalizeRepositoryPath(record.transaction_directory);
  } catch {
    return false;
  }
  return record.entries.every((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const item = entry as Partial<RepositoryTransactionJournalEntry>;
    try {
      normalizeRepositoryPath(item.relative_path ?? "");
      normalizeRepositoryPath(item.target_path ?? "");
      normalizeRepositoryPath(item.backup_path ?? "");
      if (item.staged_path !== undefined) normalizeRepositoryPath(item.staged_path);
    } catch {
      return false;
    }
    return (item.action === "write" || item.action === "remove")
      && typeof item.relative_path === "string"
      && typeof item.target_path === "string"
      && typeof item.backup_path === "string"
      && item.original !== undefined
      && item.expected !== undefined
      && typeof item.phase === "string"
      && typeof item.backup_created === "boolean"
      && typeof item.installed === "boolean"
      && isTargetSnapshot(item.original)
      && isTargetSnapshot(item.expected);
  });
}

function isTargetSnapshot(value: unknown): value is RepositoryTargetSnapshot {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as Partial<RepositoryTargetSnapshot>;
  if (!["missing", "file", "directory", "other"].includes(snapshot.kind ?? "")) return false;
  if (snapshot.kind === "file") return typeof snapshot.hash === "string" && typeof snapshot.size === "number";
  return snapshot.hash === undefined && (snapshot.size === undefined || typeof snapshot.size === "number");
}

async function inspectTarget(targetPath: string): Promise<RepositoryTargetSnapshot> {
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  if (targetStat.isFile()) {
    const content = await readFile(targetPath);
    return { kind: "file", hash: contentHash(content), size: content.byteLength };
  }
  if (targetStat.isDirectory()) return { kind: "directory", size: targetStat.size };
  return { kind: "other", size: targetStat.size };
}

function snapshotForContent(content: Uint8Array | string): RepositoryTargetSnapshot {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return { kind: "file", hash: contentHash(bytes), size: bytes.byteLength };
}

function snapshotsEqual(left: RepositoryTargetSnapshot, right: RepositoryTargetSnapshot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "file") return true;
  return left.hash === right.hash && left.size === right.size;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removePath(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!( ["EISDIR", "EINVAL", "ENOTSUP", "EPERM", "EBUSY"] as string[]).includes(code ?? "")) throw error;
  }
}

function lockRecord(owner: string, leaseMs: number, createdAt = new Date().toISOString()): LockRecord {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    owner,
    pid: process.pid,
    created_at: createdAt,
    heartbeat_at: now,
    lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
  };
}

async function readLockRecord(lockFile: string): Promise<LockRecord> {
  const raw = await readFile(lockFile, "utf8");
  return readLockRecordFromContent(raw, lockFile);
}

function readLockRecordFromContent(raw: string, lockFile: string): LockRecord {
  const lines = raw.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<LockRecord>;
      if (parsed.schema_version === 1 && typeof parsed.owner === "string" && parsed.owner.length > 0 && typeof parsed.lease_expires_at === "string") {
        return parsed as LockRecord;
      }
    } catch {
      // A partially appended final line is ignored in favour of the last
      // complete heartbeat snapshot.
    }
  }
  throw new CoreError("REPOSITORY_LOCK_CORRUPT", `Lock file ${lockFile} is corrupt`, true);
}

interface ExpiredLockTakeover {
  readonly lock_file: string;
  readonly displaced_file: string;
  readonly previous_owner: string;
  readonly occurred_at: string;
}

async function acquireLockFile(
  lockFile: string,
  owner: string,
  options: Required<RepositoryLockOptions>,
  onStaleTakeover?: (event: ExpiredLockTakeover) => Promise<void>,
): Promise<void> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + Math.max(1, options.timeout_ms);
  while (true) {
    try {
      const handle = await open(lockFile, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(lockRecord(owner, options.lease_ms))}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(path.dirname(lockFile));
      return;
    } catch (error) {
      const lockError = error as NodeJS.ErrnoException;
      // Windows can transiently raise EPERM when a lock file is being
      // released or scanned; treat it like an existing file and retry.
      if (lockError.code !== "EEXIST" && lockError.code !== "EPERM") throw error;
      let current: LockRecord | undefined;
      try {
        current = await readLockRecord(lockFile);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") continue;
      }
      if (current !== undefined && Date.parse(current.lease_expires_at) <= Date.now()) {
        const takeover = await takeOverExpiredLock(lockFile, current);
        if (takeover !== undefined) {
          try {
            await onStaleTakeover?.(takeover);
          } catch (takeoverError) {
            // Restore the displaced lease when no contender has claimed the
            // lock. Otherwise retain it as evidence instead of deleting a
            // lock whose takeover could not be audited.
            if (!(await pathExists(lockFile))) {
              await rename(takeover.displaced_file, lockFile).catch(() => undefined);
            }
            throw takeoverError;
          }
          // Once the audit record is durable, stale-file cleanup is best
          // effort. A cleanup failure must not turn a recorded takeover back
          // into an ordinary acquisition or delete its remaining evidence.
          await rm(takeover.displaced_file, { force: true }).catch(() => undefined);
          continue;
        }
      }
      if (Date.now() >= deadline) throw new CoreError("REPOSITORY_LOCK_TIMEOUT", `Could not acquire lock ${lockFile}`, true);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, options.poll_ms)));
    }
  }
}

async function takeOverExpiredLock(lockFile: string, expected: LockRecord): Promise<ExpiredLockTakeover | undefined> {
  let latest: LockRecord;
  try {
    latest = await readLockRecord(lockFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
  if (latest.owner !== expected.owner || Date.parse(latest.lease_expires_at) > Date.now()) return undefined;
  const displaced = `${lockFile}.${randomUUID()}.stale`;
  try {
    await rename(lockFile, displaced);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if ((error as NodeJS.ErrnoException).code === "EPERM" || (error as NodeJS.ErrnoException).code === "EACCES") return undefined;
    throw error;
  }
  try {
    const moved = await readLockRecord(displaced);
    if (moved.owner !== expected.owner || Date.parse(moved.lease_expires_at) > Date.now()) {
      if (!(await pathExists(lockFile))) await rename(displaced, lockFile);
      return undefined;
    }
    return {
      lock_file: lockFile,
      displaced_file: displaced,
      previous_owner: moved.owner,
      occurred_at: new Date().toISOString(),
    };
  } catch (error) {
    // Never delete a displaced lock whose owner token we cannot verify.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function refreshLockFile(lockFile: string, owner: string, leaseMs: number): Promise<void> {
  const handle = await open(lockFile, "r+");
  try {
    const raw = await handle.readFile("utf8");
    const current = await readLockRecordFromContent(raw, lockFile);
    if (current.owner !== owner) throw new CoreError("REPOSITORY_LOCK_LOST", `Lock owner changed for ${lockFile}`, true);
    const position = (await handle.stat()).size;
    await handle.write(`${JSON.stringify(lockRecord(owner, leaseMs, current.created_at))}\n`, position, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function releaseLockFile(lockFile: string, owner: string): Promise<void> {
  try {
    const current = await readLockRecord(lockFile);
    if (current.owner !== owner) return;
    await rm(lockFile, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    // A corrupt/replaced lock is intentionally left for the next owner to
    // inspect; cleanup must never delete another owner's lock.
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

function assertTransactionTargetPath(relativePath: string): void {
  if (relativePath === ".workspace"
    || relativePath === ".workspace/recovery-ledger.jsonl"
    || relativePath.startsWith(".workspace/recovery-ledger.jsonl/")
    || relativePath === ".workspace/transactions"
    || relativePath.startsWith(".workspace/transactions/")
    || relativePath.startsWith(".workspace/.staging-")) {
    throw new CoreError("REPOSITORY_PATH_INVALID", `Repository path is reserved for transaction recovery: ${relativePath}`, true);
  }
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

async function moveToBackup(targetPath: string, backupPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await mkdir(path.dirname(backupPath), { recursive: true });
  await renameWithRetry(targetPath, backupPath);
  await syncDirectory(path.dirname(targetPath));
  await syncDirectory(path.dirname(backupPath));
  return true;
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

/** Durable storage for operation attachments referenced by OperationCommand.attachment_refs. */
export interface AttachmentStore {
  save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]>;
  load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]>;
}

export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly store = new Map<string, Array<{ ref: OperationAttachmentRef; content: Uint8Array }>>();

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const refs = attachments.map((attachment) => ({
      id: internalId("attachment"),
      name: attachment.name,
      ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
    }));
    this.store.set(operationId, attachments.map((attachment, index) => ({ ref: refs[index]!, content: attachment.content })));
    return refs;
  }

  async load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]> {
    const entries = this.store.get(operationId) ?? [];
    return refs.map((ref) => {
      const entry = entries.find((candidate) => candidate.ref.id === ref.id);
      if (entry === undefined) throw new CoreError("ATTACHMENT_NOT_FOUND", `Attachment ${ref.id} of operation ${operationId} is not available in this runtime.`, false);
      return { name: entry.ref.name, content: entry.content, ...(entry.ref.media_type === undefined ? {} : { media_type: entry.ref.media_type }) };
    });
  }
}

/** File-backed attachment store under `<projectRoot>/<projectId>/.workspace/attachments/<operationId>`. */
export class FileAttachmentStore implements AttachmentStore {
  constructor(
    private readonly projectRoot: string,
    private readonly projectId: string,
  ) {}

  private directoryFor(operationId: string): string {
    return path.join(this.projectRoot, this.projectId, ".workspace", "attachments", operationId);
  }

  async save(operationId: string, attachments: readonly SourceAttachment[]): Promise<OperationAttachmentRef[]> {
    const directory = this.directoryFor(operationId);
    const refs: OperationAttachmentRef[] = [];
    await mkdir(directory, { recursive: true });
    for (const attachment of attachments) {
      const id = internalId("attachment");
      await writeFile(path.join(directory, id), attachment.content);
      refs.push({ id, name: attachment.name, ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }) });
    }
    return refs;
  }

  async load(operationId: string, refs: readonly OperationAttachmentRef[]): Promise<SourceAttachment[]> {
    const directory = this.directoryFor(operationId);
    return Promise.all(refs.map(async (ref) => {
      try {
        const content = await readFile(path.join(directory, ref.id));
        return { name: ref.name, content, ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CoreError("ATTACHMENT_NOT_FOUND", `Attachment ${ref.id} of operation ${operationId} is missing from the attachment store.`, false);
        }
        throw error;
      }
    }));
  }
}

export type CardExportMode = "zhuji" | "palette" | "both";

function exportNameSuffix(artifacts: readonly Pick<ArtifactRecord, "kind">[], mode: CardExportMode | undefined): string {
  if (mode !== undefined) {
    if (mode === "zhuji") return "珠璣角色卡";
    if (mode === "palette") return "調色盤角色卡";
    return "雙模式角色卡";
  }
  return artifacts.some((artifact) => artifact.kind === "zhuji") ? "珠璣角色卡" : "角色卡";
}

export function publishedCardExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[], mode?: CardExportMode): string {
  const stem = safeSegment(projectName ?? projectId);
  return `exports/${stem}-${exportNameSuffix(artifacts, mode)}.json`;
}

export function publishedCardPngExportPath(projectName: string | undefined, projectId: string, artifacts: readonly Pick<ArtifactRecord, "kind">[], mode?: CardExportMode): string {
  const stem = safeSegment(projectName ?? projectId);
  return `exports/${stem}-${exportNameSuffix(artifacts, mode)}.png`;
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
  FORMAL_NAME_QUESTION_PREFIX,
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
