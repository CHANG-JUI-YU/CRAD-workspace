import type { AttachmentStore, ProvenanceCompositionSummary, ProvenanceOverrideRef, RepairInspection } from "@st-workspace/core";
import type { SourceFetcher } from "@st-workspace/domain";

export interface DashboardProjectView {
  project_id: string;
  project_name?: string;
  project_status: string;
  revision: number;
  interview_status: string;
  interview_flow?: string;
  answers_count: number;
}

export interface DashboardBlueprint {
  revision: string;
  characters: Array<{ id: string; label: string; mode: string }>;
  world?: Record<string, unknown>;
}

export interface DashboardArtifactView {
  id: string;
  key: string;
  kind: string;
  name: string;
  revision: string;
  status: string;
  created_by?: string;
  based_on?: string;
  content_hash: string;
  blueprint_precheck_id?: string;
  blueprint_precheck_revision?: string;
  content: string;
  media_type?: string;
  created_at: string;
  updated_at?: string;
}

export interface DashboardArtifactGroupView {
  key: string;
  current: DashboardArtifactView;
  revisions: DashboardArtifactView[];
}

export interface DashboardFactView {
  id: string;
  statement: string;
  status: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: string;
  coverage?: string[];
  source_ids: string[];
  review_run_id?: string;
  decision_id?: string;
  evidence_quote?: string;
  fact_revision?: number;
  evidence_refs_count?: number;
  locator?: string;
  character_range?: { start: number; end: number };
  chunk_id?: string;
  last_reviewer?: string;
  last_decision?: string;
}

export interface DashboardOperationView {
  id: string;
  kind: string;
  status: string;
  request: string;
  actor?: string;
  question?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  attempt?: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
  progress_count: number;
  progress?: Array<{ status: string; message: string }>;
}

export interface DashboardPrecheckCheckView {
  subject_id: string;
  dimension: string;
  uncertainty: string;
  impact: string;
  basis: string;
  action: string;
  user_answer?: string;
  intake_key?: string;
}

export interface DashboardPrecheckView {
  id: string;
  status: string;
  candidate_blueprint_revision: string;
  checks_count: number;
  checks: DashboardPrecheckCheckView[];
}

export interface DashboardIssueView {
  id: string;
  artifact_id: string;
  code: string;
  message: string;
  severity: string;
  effective_severity: string;
  status: string;
  created_at: string;
  updated_at?: string;
  overridable: boolean;
  override?: { severity?: string; against_effective_severity: string; reason: string; by: string; timestamp: string };
}

export interface DashboardSnapshot {
  project: DashboardProjectView;
  blueprint?: DashboardBlueprint;
  prechecks: DashboardPrecheckView[];
  artifacts: DashboardArtifactView[];
  artifact_groups: DashboardArtifactGroupView[];
  images: Array<{ id: string; character_id?: string; width: number; height: number; aspect_ratio?: string; source?: string; license?: string; created_at: string; updated_at: string }>;
  roster?: Array<{ id: string; label: string; display_name?: string; mode?: string }>;
  primary_character_id?: string;
  images_stale: boolean;
  facts: DashboardFactView[];
  sources: Array<{ id: string; candidate_id: string; title: string; revision: string; media_type: string; original_name?: string; url?: string; official?: boolean; chunk_count: number; canonical_chars: number; selection_snapshot?: unknown }>;
  candidates: Array<{ id: string; title: string; snippet?: string; url?: string; domain?: string; status: string; official?: boolean; failure?: { code: string; message: string }; selection_snapshot?: unknown }>;
  operations: DashboardOperationView[];
  issues: DashboardIssueView[];
  reviews: Array<{ id: string; artifact_id: string; artifact_revision: string; reviewer: string; status: string }>;
  quality: { level?: string; blocking_severity: string; overrides: Record<string, string> };
  review_runs: Array<{
    id: string;
    status: string;
    candidate_occurrence_ids: string[];
    candidate_set_revision: string;
    policy_revision: string;
    created_by: string;
    created_at: string;
    completed_at?: string;
    curation_run_id?: string;
    source_revisions: Array<{ source_id: string; revision: string }>;
    decisions: Array<{ candidate_occurrence_id: string; decision: string; reviewer_identity: string; reason: string }>;
    candidates: Array<{ candidate_occurrence_id: string; statement: string; status: string }>;
  }>;
  publishes: Array<{ id: string; content_hash: string; created_at: string; export_json_path?: string; export_png_path?: string }>;
  builds: Array<{ id: string; status: string; content_hash: string; created_at: string }>;
  repair: RepairInspection;
}

export interface DashboardBuildReadiness {
  modes: { zhuji: boolean; palette: boolean };
  primary_character?: { id: string; label: string; mode: string };
  export_modes?: string;
  selected_mode?: string;
  card_name?: string;
  world_book_name?: string;
  first_greeting?: string;
  alternate_greeting_count: number;
  group_greeting_count: number;
  plugin_ids: string[];
  output_paths?: { json?: string; png?: string };
  entries: Array<{ kind: string; name: string; char_count: number; estimated_tokens: number; artifact_id?: string; revision?: string }>;
  greeting_entries: number;
  png_expected: boolean;
  missing: string[];
  diagnostics: Array<{ code: string; severity: string; message: string }>;
  provenance_summary?: ProvenanceCompositionSummary;
}

export interface TavernCheckResult {
  id: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface TavernCompatibilityReport {
  available: boolean;
  json_path?: string;
  png_path?: string;
  json_sha256?: string;
  png_sha256?: string;
  checks: TavernCheckResult[];
  summary: string;
}

export type SourceSearchMode = "agent_managed" | "runtime_provider" | "disabled";

export interface PublishProvenancePreviewResult {
  available: boolean;
  reason?: string;
  fingerprint?: string;
  build_snapshot_hash?: string;
  composition?: ProvenanceCompositionSummary;
  historical_decisions: ProvenanceOverrideRef[];
}

export interface PublishProvenanceConfirmInput {
  fingerprint: string;
  mode_selection?: "zhuji" | "palette";
  idempotency_key?: string;
  operation_id?: string;
}

export interface DashboardProvenanceView {
  build_id?: string;
  build_status?: string;
  provenance_summary?: ProvenanceCompositionSummary;
  historical_decisions: ProvenanceOverrideRef[];
  legacy_build_snapshot_hash: boolean;
  compiled_content_hash?: string;
  build_snapshot_hash?: string;
}

export interface WorkspaceRuntimeOptions {
  searcher?: (request: string) => Promise<Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>>;
  sourceSearchMode?: SourceSearchMode;
  fetcher?: SourceFetcher;
  interviewRequired?: boolean;
  attachmentStore?: AttachmentStore;
}
