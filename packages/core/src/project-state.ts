import { createInterviewState, type InterviewState } from "./interview.js";
import type { AdaptationDecision } from "./authoring-context.js";
import { canonicalJson, contentHash, internalId, CoreError } from "./core-utilities.js";
import {
  coverageRequirementIdForDimension,
  type AuthoringCoverageBinding,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type CoverageResearchLineageLink,
  type CoverageResolution,
  type CoverageSnapshot,
  type CoverageUserDecisionRecord,
  type ResearchBatchRecord,
  type ResearchTaskRecord,
} from "./coverage.js";
import type { OperationCommand, OperationRecord, AuditEvent } from "./operations.js";
import type { ProvenanceCompositionSummary } from "./provenance.js";
import type { PublishedOutputPlan } from "./output-plan.js";

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

export interface IssueOverride {
  by: string;
  reason: string;
  timestamp: string;
  against_effective_severity: IssueSeverity;
  severity?: IssueSeverity;
  policy_snapshot?: QualityPolicySnapshot;
}

export interface QualityProfile {
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
  canonical_url?: string;
  final_url?: string;
  domain?: string;
  official?: boolean;
  status: CandidateStatus;
  content?: string;
  media_type?: string;
  content_hash?: string;
  source_revision?: string;
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
  canonical_url?: string;
  final_url?: string;
  original_hash: string;
  revision: string;
  media_type: string;
  original_name?: string;
  provenance_kind?: "external_source" | "user_supplement";
  selection_snapshot?: SourceSelectionSnapshot;
  created_at: string;
}

export interface KnowledgeChunk {
  id: string;
  source_id: string;
  ordinal: number;
  text: string;
  hash: string;
  extractor_revision?: string;
  created_at: string;
}

export interface FactRecord {
  id: string;
  statement: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: FactClassification;
  /** Stable Blueprint roster ids; legacy states may omit this field. */
  entity_refs?: string[];
  /** Curator-suggested Blueprint roster ids, not yet confirmed by a Reviewer. */
  suggested_entity_refs?: string[];
  /** Curator-suggested coverage requirement ids, not yet confirmed by a Reviewer. */
  suggested_coverage_targets?: string[];
  /** Reviewer-confirmed canonical coverage requirement ids (replacement of suggestions). */
  coverage_targets?: string[];
  coverage?: string[];
  status: FactStatus;
  confidence: number;
  source_ids: string[];
  evidence: string[];
  evidence_refs?: FactEvidenceReference[];
  fact_revision?: number;
  /** Stable hash of the source/chunk evidence currently attached to this fact. */
  evidence_revision?: string;
  /** Stable hash of the last accepted fact projection, if this fact was accepted. */
  accepted_fact_revision?: string;
  candidate_occurrence_id?: string;
  curation_run_id?: string;
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
export interface FactReviewSourceRevision { source_id: string; revision: string; }

export interface FactReviewRunRecord {
  schema_version: 1;
  id: string;
  curation_run_id?: string;
  candidate_set_revision: string;
  candidate_occurrence_ids: string[];
  source_revisions: FactReviewSourceRevision[];
  policy_revision: string;
  /** Per-occurrence candidate revision snapshot captured when the run was created. */
  candidate_revisions?: Record<string, string>;
  status: FactReviewRunStatus;
  created_by: string;
  created_at: string;
  completed_at?: string;
  successor_run_id?: string;
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
  /** Stable Blueprint roster ids used by the accepted projection. */
  entity_refs?: string[];
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
  /** Hash of the external inputs this revision was authored against. */
  dependency_fingerprint?: string;
}

export interface ImageRecord {
  id: string;
  character_id?: string;
  blob_hash: string;
  media_type: string;
  width: number;
  height: number;
  aspect_ratio?: string;
  crop?: { width: number; height: number; offset_x: number; offset_y: number };
  source?: string;
  license?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
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
  against_effective_severity?: IssueSeverity;
  override?: IssueOverride;
  evidence?: string[];
  overridable?: boolean;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
}

export interface ContentBlobReference { hash: string; size: number; }

export interface BuildRecord {
  id: string;
  operation_id: string;
  status: "previewed" | "built" | "failed";
  artifact_ids: string[];
  canonical_ir?: string;
  canonical_ir_ref?: ContentBlobReference;
  content_hash: string;
  diagnostics: string[];
  created_at: string;
  quality_policy_snapshot?: QualityPolicySnapshot;
  coverage_snapshot?: CoverageSnapshot;
  provenance_summary?: ProvenanceCompositionSummary;
}

export interface PublishRecord {
  id: string;
  operation_id: string;
  artifact_ids: string[];
  content?: string;
  content_ref?: ContentBlobReference;
  content_hash: string;
  png_base64?: string;
  png_ref?: ContentBlobReference;
  export_json_path?: string;
  export_png_path?: string;
  created_at: string;
  coverage_snapshot?: CoverageSnapshot;
  provenance_summary?: ProvenanceCompositionSummary;
  output_plan?: PublishedOutputPlan;
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


export interface OperationAttachmentRef {
  id: string;
  name: string;
  media_type?: string;
  content_hash?: string;
}

export interface ProjectState {
  schema_version: 2;
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
  images: ImageRecord[];
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
  coverage_requirement_sets: CoverageRequirementSet[];
  coverage_assessments: CoverageAssessment[];
  coverage_user_decisions: CoverageUserDecisionRecord[];
  coverage_research_batches: ResearchBatchRecord[];
  coverage_research_tasks: ResearchTaskRecord[];
  coverage_research_lineages: CoverageResearchLineageLink[];
  coverage_resolutions: CoverageResolution[];
  coverage_authoring_bindings: AuthoringCoverageBinding[];
  url_ingestions: UrlIngestionRecord[];
}

export interface UrlIngestionRecord {
  id: string;
  operation_id: string;
  url: string;
  status: "url_received" | "fetching" | "fetch_failed" | "content_validated" | "ingested";
  final_url?: string;
  canonical_url?: string;
  title?: string;
  media_type?: string;
  content_size?: number;
  error_code?: string;
  error_message?: string;
  retry_of?: string;
  successor_of?: string;
  source_id?: string;
  created_at: string;
  updated_at: string;
}

export function createProjectState(projectId: string): ProjectState {
  return {
    schema_version: 2,
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
    images: [],
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
    coverage_requirement_sets: [],
    coverage_assessments: [],
    coverage_user_decisions: [],
    coverage_research_batches: [],
    coverage_research_tasks: [],
    coverage_research_lineages: [],
    coverage_resolutions: [],
    coverage_authoring_bindings: [],
    url_ingestions: [],
  };
}

export function cloneState(state: ProjectState): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState;
}

export function backfillLegacyFactReviewHistory(state: ProjectState): ProjectState {
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

/**
 * Deterministic, re-entrant v1 -> v2 migration. v1 states lack the coverage
 * ledger arrays and the target-separated fact fields; this migration only
 * adds empty ledgers and maps recognizable flat coverage dimensions to
 * suggested coverage requirement ids. It never promotes subject names to
 * canonical entity refs and never claims formal coverage readiness.
 */
export function migrateProjectStateV1ToV2(state: Record<string, unknown>): Record<string, unknown> {
  const facts = Array.isArray(state.facts) ? state.facts.map((rawFact) => {
    const fact = rawFact as Record<string, unknown>;
    if (typeof fact !== "object" || fact === null) return fact;
    const coverage = Array.isArray(fact.coverage) ? fact.coverage.filter((value): value is string => typeof value === "string") : [];
    const suggested = coverage.flatMap((dimension) => {
      const id = coverageRequirementIdForDimension(dimension);
      return id === undefined ? [] : [id];
    });
    return {
      ...fact,
      ...(suggested.length > 0 ? { suggested_coverage_targets: [...new Set(suggested)] } : {}),
    };
  }) : [];
  return {
    ...state,
    schema_version: 2,
    facts,
    coverage_requirement_sets: Array.isArray(state.coverage_requirement_sets) ? state.coverage_requirement_sets : [],
    coverage_assessments: Array.isArray(state.coverage_assessments) ? state.coverage_assessments : [],
    coverage_user_decisions: Array.isArray(state.coverage_user_decisions) ? state.coverage_user_decisions : [],
    coverage_research_batches: Array.isArray(state.coverage_research_batches) ? state.coverage_research_batches : [],
    coverage_research_tasks: Array.isArray(state.coverage_research_tasks) ? state.coverage_research_tasks : [],
    coverage_research_lineages: Array.isArray(state.coverage_research_lineages) ? state.coverage_research_lineages : [],
    coverage_resolutions: Array.isArray(state.coverage_resolutions) ? state.coverage_resolutions : [],
    coverage_authoring_bindings: Array.isArray(state.coverage_authoring_bindings) ? state.coverage_authoring_bindings : [],
    url_ingestions: Array.isArray(state.url_ingestions) ? state.url_ingestions : [],
  };
}

export function validateState(state: ProjectState): ProjectState {
  const raw = state as unknown as Record<string, unknown>;
  const candidate = raw.schema_version === 1 ? migrateProjectStateV1ToV2(raw) : raw;
  const parsed = projectStateSchema.safeParse(candidate);
  if (!parsed.success) throw new CoreError("STATE_INVALID", parsed.error.message);
  return backfillArtifactDependencyFingerprints(backfillLegacyFactReviewHistory(parsed.data as unknown as ProjectState));
}

// Imported at the bottom to keep the state model independent from schema construction.
import { projectStateSchema } from "./project-state-schema.js";
import { backfillArtifactDependencyFingerprints } from "./artifact-fingerprint.js";
