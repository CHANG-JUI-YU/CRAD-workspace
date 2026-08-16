import {
  CoreError,
  computeProjectProjection,
  deriveCoverImageFreshness,
resolveCoverImageIdentity,
  qualityLevelForProfile,
  z,
  type ArtifactKind,
  type ArtifactRecord,
  type ArtifactStatus,
  type AuditEvent,
  type CoverImageFreshnessResult,
type ProvenanceImageIdentity,
  type FactClassification,
  type FactRecord,
  type IssueSeverity,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type ProvenanceCompositionSummary,
  type RepairInspection,
  type ReviewRecord,
  type SourceCandidate,
  type SourceRecord,
} from "@st-workspace/core";
import {
  buildRequiredArtifactManifest,
  deriveSummaryKPIs,
  type RequiredArtifactManifest,
  type SummaryKPIs,
} from "@st-workspace/domain";

export const DASHBOARD_PAGE_LIMIT = 50;
export const DASHBOARD_MAX_PAGE_LIMIT = 200;

const dashboardFilterValueSchema = z.union([z.string(), z.boolean(), z.number()]);
const dashboardFilterSchema = z.record(z.string(), dashboardFilterValueSchema);

export const dashboardQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(DASHBOARD_MAX_PAGE_LIMIT).default(DASHBOARD_PAGE_LIMIT),
  filter: z.string().trim().min(1).optional(),
}).strict();

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
export type DashboardQuery = Omit<z.infer<typeof dashboardQuerySchema>, "filter"> & { filter?: DashboardFilter };

export interface DashboardRawQuery {
  cursor?: string;
  limit?: string;
  filter?: string;
}

/** Parse the common cursor/limit/filter contract at the REST boundary. */
export function parseDashboardQuery(raw: DashboardRawQuery): DashboardQuery {
  const parsed = dashboardQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw new CoreError("DASHBOARD_QUERY_INVALID", `Invalid dashboard query: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, true);
  }
  if (parsed.data.filter === undefined) return { cursor: parsed.data.cursor, limit: parsed.data.limit };
  let json: unknown;
  try {
    json = JSON.parse(parsed.data.filter) as unknown;
  } catch {
    throw new CoreError("DASHBOARD_FILTER_INVALID", "Dashboard filter must be valid JSON", true);
  }
  const filter = dashboardFilterSchema.safeParse(json);
  if (!filter.success) {
    throw new CoreError("DASHBOARD_FILTER_INVALID", "Dashboard filter must be a JSON object of scalar values", true);
  }
  return { cursor: parsed.data.cursor, limit: parsed.data.limit, filter: filter.data };
}

export interface DashboardPage<T> {
  items: T[];
  total: number;
  limit: number;
  cursor?: string;
  next_cursor?: string;
}

export interface DashboardProjectSummary {
  project_id: string;
  project_name?: string;
  project_status: string;
  revision: number;
  interview_status: string;
  interview_flow?: string;
  answers_count: number;
}

export interface DashboardCounts {
  artifacts: number;
  current_artifacts: number;
  artifact_keys: number;
  facts: number;
  sources: number;
  candidates: number;
  knowledge_chunks: number;
  operations: number;
  issues: number;
  reviews: number;
  fact_review_runs: number;
  publishes: number;
  builds: number;
  images: number;
  audit_events: number;
}

export interface DashboardStatusCounts {
  operations: Record<string, number>;
  candidates: Record<string, number>;
  facts: Record<string, number>;
  issues: Record<string, number>;
  builds: Record<string, number>;
}

export interface DashboardSummary {
  project: DashboardProjectSummary;
  counts: DashboardCounts;
  status_counts: DashboardStatusCounts;
  blueprint?: {
    revision: string;
    character_count: number;
    character_ids: string[];
    primary_character_id?: string;
    world_enabled: boolean;
    relationships_enabled: boolean;
    source_adaptation: boolean;
  };
  prechecks: Array<{
    id: string;
    status: string;
    candidate_blueprint_revision: string;
    checks_count: number;
    checks?: Array<{
      subject_id: string;
      dimension: string;
      uncertainty: string;
      impact: string;
      basis: string;
      action: string;
      user_answer?: string;
      intake_key?: string;
    }>;
  }>;
  roster?: Array<{ id: string; label: string; display_name?: string; mode?: string }>;
  primary_character_id?: string;
  images: DashboardImageView[];
  images_stale: boolean;
  images_stale_reason?: string;
  images_freshness: CoverImageFreshnessResult;
  active_cover: { identity: ProvenanceImageIdentity; reason?: string; fallback_order: string[] };
  quality: {
    level: string;
    blocking_severity: string;
    overrides: Record<string, string>;
  };
  latest_publish?: DashboardPublishView;
  latest_build?: DashboardBuildView;
  latest_review_run?: DashboardReviewRunView;
  kpis?: SummaryKPIs;
  repair: { plan_hash: string; item_count: number; recoverable_count: number };
}

export interface DashboardImageView {
  id: string;
  character_id?: string;
  width: number;
  height: number;
  aspect_ratio?: string;
  source?: string;
  license?: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardArtifactListItem {
  id: string;
  key: string;
  kind: ArtifactKind;
  name: string;
  revision: string;
  status: ArtifactStatus;
  created_by: string;
  based_on?: string;
  content_hash: string;
  blueprint_precheck_id?: string;
  blueprint_precheck_revision?: string;
  media_type: string;
  created_at: string;
  updated_at: string;
  is_current: boolean;
}

export interface DashboardArtifactDetail extends DashboardArtifactListItem {
  content: string;
}

export interface DashboardFactView {
  id: string;
  statement: string;
  status: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: string;
  entity_refs?: string[];
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

export interface DashboardSourceView {
  id: string;
  candidate_id: string;
  title: string;
  revision: string;
  media_type: string;
  original_name?: string;
  url?: string;
  official?: boolean;
  chunk_count: number;
  canonical_chars: number;
  selection_snapshot?: SourceRecord["selection_snapshot"];
}

export interface DashboardCandidateView {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  domain?: string;
  status: SourceCandidate["status"];
  official?: boolean;
  failure?: { code: string; message: string };
  selection_snapshot?: SourceCandidate["selection_snapshot"];
}

export interface OperationAttachmentStatusView {
  id: string;
  name: string;
  media_type?: string;
  available?: boolean;
}

export interface OperationReplayability {
  state: "replayable" | "requires_reupload" | "non_replayable";
  reason_code?: string;
  reason?: string;
  attachment_count: number;
  attachments: OperationAttachmentStatusView[];
}

export interface DashboardOperationView {
  id: string;
  kind: OperationRecord["kind"];
  status: string;
  request: string;
  actor?: string;
  question?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  attempt?: number;
  last_error?: string;
  error_class?: "recoverable" | "fatal";
  replayability?: OperationReplayability;
  created_at: string;
  updated_at: string;
  progress_count: number;
  progress?: Array<{ status: string; message: string }>;
}

export interface DashboardOperationDetail extends DashboardOperationView {
  result_summary?: string;
  command?: OperationRecord["command"];
  execution_snapshot?: OperationRecord["execution_snapshot"];
  fencing_generation?: number;
}

export interface DashboardIssueView {
  id: string;
  artifact_id: string;
  review_id: string;
  code: string;
  message: string;
  severity: IssueSeverity;
  effective_severity: IssueSeverity;
  status: string;
  created_at: string;
  updated_at: string;
  overridable: boolean;
  override?: {
    severity?: IssueSeverity;
    against_effective_severity: IssueSeverity;
    reason: string;
    by: string;
    timestamp: string;
  };
}

export interface DashboardReviewView {
  id: string;
  artifact_id: string;
  artifact_revision: string;
  reviewer: string;
  status: ReviewRecord["status"];
  issue_ids: string[];
  created_at: string;
}

export interface DashboardAuditView {
  id: string;
  operation_id: string;
  event: string;
  actor: string;
  occurred_at: string;
  project_revision: number;
  details: Record<string, unknown>;
}

export interface DashboardReviewRunView {
  id: string;
  status: string;
  candidate_occurrence_ids: string[];
  candidate_set_revision: string;
  projection_revision?: string;
  policy_revision: string;
  created_by: string;
  created_at: string;
  completed_at?: string;
  curation_run_id?: string;
  source_revisions: Array<{ source_id: string; revision: string }>;
}

export interface DashboardReviewRunDetail extends DashboardReviewRunView {
  decisions: Array<{ candidate_occurrence_id: string; decision: string; reviewer_identity: string; reason: string }>;
  candidates: Array<{ candidate_occurrence_id: string; statement: string; status: string }>;
}

export interface DashboardPublishView {
  id: string;
  operation_id: string;
  artifact_ids: string[];
  content_hash: string;
  created_at: string;
  export_json_path?: string;
  export_png_path?: string;
  provenance_summary?: ProvenanceCompositionSummary;
}

export interface DashboardBuildView {
  id: string;
  operation_id: string;
  status: string;
  artifact_ids: string[];
  content_hash: string;
  diagnostics_count: number;
  created_at: string;
  provenance_summary?: ProvenanceCompositionSummary;
}

export interface DashboardArtifactQuery {
  query?: DashboardQuery;
  filter?: {
    kind?: ArtifactKind;
    status?: ArtifactStatus;
    key?: string;
    character_id?: string;
    search?: string;
    current_only?: boolean;
  };
}

export interface DashboardFactQuery {
  query?: DashboardQuery;
  filter?: {
    status?: FactRecord["status"];
    classification?: FactClassification;
    source_id?: string;
    review_run_id?: string;
    subject?: string;
    search?: string;
  };
}

export interface DashboardSourceQuery {
  query?: DashboardQuery;
  filter?: { status?: SourceCandidate["status"]; domain?: string; official?: boolean; search?: string };
}

export interface DashboardOperationQuery {
  query?: DashboardQuery;
  filter?: { status?: string; kind?: OperationRecord["kind"]; search?: string };
}

export interface DashboardAuditQuery {
  query?: DashboardQuery;
  filter?: { operation_id?: string; event?: string; actor?: string; search?: string };
}

export interface DashboardIssueQuery {
  query?: DashboardQuery;
  filter?: { artifact_id?: string; status?: string; severity?: IssueSeverity; search?: string };
}

export interface DashboardReviewQuery {
  query?: DashboardQuery;
  filter?: { artifact_id?: string; reviewer?: string; status?: ReviewRecord["status"] };
}

export interface DashboardPublishQuery {
  query?: DashboardQuery;
  filter?: { operation_id?: string; search?: string };
}

export interface DashboardBuildQuery {
  query?: DashboardQuery;
  filter?: { operation_id?: string; status?: DashboardBuildView["status"] };
}

export interface DashboardReviewRunQuery {
  query?: DashboardQuery;
  filter?: { status?: string; created_by?: string; curation_run_id?: string };
}

function filterString(filter: DashboardFilter | undefined, key: string): string | undefined {
  const value = filter?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function filterBoolean(filter: DashboardFilter | undefined, key: string): boolean | undefined {
  const value = filter?.[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function includesText(value: string, search: string | undefined): boolean {
  return search === undefined || value.toLocaleLowerCase().includes(search.toLocaleLowerCase());
}

function cursorFor(offset: number, context: DashboardPageContext, filter: string | undefined): string {
  return `cursor:${Buffer.from(JSON.stringify({ v: 2, offset, collection: context.collection, sort: "newest", filter: filter ?? null, revision: context.revision }), "utf8").toString("base64url")}`;
}

interface DashboardPageContext {
  collection: string;
  revision: number;
}

function cursorStateFor(cursor: string | undefined): { offset: number; collection: string; sort: string; filter: string | null; revision: number } | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor.startsWith("cursor:")) throw new CoreError("DASHBOARD_CURSOR_INVALID", "Dashboard cursor is invalid", true);
  let value: { v?: unknown; offset?: unknown; collection?: unknown; sort?: unknown; filter?: unknown; revision?: unknown };
  try {
    value = JSON.parse(Buffer.from(cursor.slice("cursor:".length), "base64url").toString("utf8")) as typeof value;
  } catch {
    throw new CoreError("DASHBOARD_CURSOR_INVALID", "Dashboard cursor is invalid", true);
  }
  if (value.v !== 2 || typeof value.offset !== "number" || !Number.isInteger(value.offset) || value.offset < 0 || typeof value.collection !== "string" || typeof value.sort !== "string" || (value.filter !== null && typeof value.filter !== "string") || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) {
    throw new CoreError("DASHBOARD_CURSOR_INVALID", "Dashboard cursor is no longer supported; restart pagination from the first page", true);
  }
  return { offset: value.offset, collection: value.collection, sort: value.sort, filter: value.filter, revision: value.revision };
}

function checkCursorContext(cursor: string | undefined, context: DashboardPageContext, filter: string | null | undefined): number {
  const state = cursorStateFor(cursor);
  if (state === undefined) return 0;
  if (state.collection !== context.collection || state.sort !== "newest" || state.filter !== (filter ?? null)) {
    throw new CoreError("DASHBOARD_CURSOR_INVALID", "Dashboard cursor does not match the requested query; restart pagination", true);
  }
  if (state.revision !== context.revision) {
    throw new CoreError("DASHBOARD_CURSOR_STALE", "The project state changed since this cursor was issued; restart pagination from the first page", true);
  }
  return state.offset;
}

function filterToken(filter: DashboardFilter | undefined): string | null {
  return filter === undefined ? null : JSON.stringify(filter);
}

export function page<T>(items: readonly T[], query: DashboardQuery | undefined, context: DashboardPageContext): DashboardPage<T> {
  const filter = filterToken(query?.filter);
  const offset = checkCursorContext(query?.cursor, context, filter);
  const limit = Math.min(Math.max(query?.limit ?? DASHBOARD_PAGE_LIMIT, 1), DASHBOARD_MAX_PAGE_LIMIT);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  return {
    items: [...selected],
    total: items.length,
    limit,
    ...(query?.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(nextOffset < items.length ? { next_cursor: cursorFor(nextOffset, context, filter ?? undefined) } : {}),
  };
}

export function sortByNewest<T extends { id: string }>(items: readonly T[], timeKey: (item: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const ta = timeKey(a) ?? "";
    const tb = timeKey(b) ?? "";
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function errorClasses(state: ProjectState): Map<string, "recoverable" | "fatal"> {
  const result = new Map<string, "recoverable" | "fatal">();
  for (const event of state.audit) {
    if (event.operation_id !== undefined && event.event === "operation.failed" && typeof event.details.recoverable === "boolean") {
      result.set(event.operation_id, event.details.recoverable ? "recoverable" : "fatal");
    }
  }
  return result;
}

function mapArtifact(artifact: ArtifactRecord, currentIds: ReadonlySet<string>, includeContent = false): DashboardArtifactListItem | DashboardArtifactDetail {
  const base: DashboardArtifactListItem = {
    id: artifact.id,
    key: artifact.key,
    kind: artifact.kind,
    name: artifact.name,
    revision: artifact.revision,
    status: artifact.status,
    created_by: artifact.created_by,
    ...(artifact.based_on === undefined ? {} : { based_on: artifact.based_on }),
    content_hash: artifact.content_hash,
    ...(artifact.blueprint_precheck_id === undefined ? {} : { blueprint_precheck_id: artifact.blueprint_precheck_id }),
    ...(artifact.blueprint_precheck_revision === undefined ? {} : { blueprint_precheck_revision: artifact.blueprint_precheck_revision }),
    media_type: artifact.media_type,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    is_current: currentIds.has(artifact.id),
  };
  return includeContent ? { ...base, content: artifact.content } : base;
}

function mapFact(state: ProjectState, fact: FactRecord): DashboardFactView {
  const evidenceQuote = fact.evidence[0] ?? fact.evidence_refs?.[0]?.quote;
  const firstEvidenceRef = fact.evidence_refs?.[0];
  const decision = fact.decision_id === undefined ? undefined : state.fact_review_decisions.find((item) => item.id === fact.decision_id);
  return {
    id: fact.id,
    statement: fact.statement,
    status: fact.status,
    ...(fact.subject === undefined ? {} : { subject: fact.subject }),
    ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
    ...(fact.value === undefined ? {} : { value: fact.value }),
    ...(fact.classification === undefined ? {} : { classification: fact.classification }),
    ...(fact.entity_refs === undefined ? {} : { entity_refs: fact.entity_refs }),
    ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
    source_ids: fact.source_ids,
    ...(fact.review_run_id === undefined ? {} : { review_run_id: fact.review_run_id }),
    ...(fact.decision_id === undefined ? {} : { decision_id: fact.decision_id }),
    ...(evidenceQuote === undefined ? {} : { evidence_quote: String(evidenceQuote) }),
    ...(fact.fact_revision === undefined ? {} : { fact_revision: fact.fact_revision }),
    ...(fact.evidence_refs === undefined ? {} : { evidence_refs_count: fact.evidence_refs.length }),
    ...(firstEvidenceRef === undefined ? {} : {
      ...(firstEvidenceRef.locator === undefined ? {} : { locator: firstEvidenceRef.locator }),
      ...(firstEvidenceRef.character_range === undefined ? {} : { character_range: firstEvidenceRef.character_range }),
      ...(firstEvidenceRef.chunk_id === undefined ? {} : { chunk_id: firstEvidenceRef.chunk_id }),
    }),
    ...(decision === undefined ? {} : { last_reviewer: decision.reviewer_identity, last_decision: decision.decision }),
  };
}

function mapSource(state: ProjectState, source: SourceRecord): DashboardSourceView {
  const candidate = state.candidates.find((item) => item.id === source.candidate_id);
  return {
    id: source.id,
    candidate_id: source.candidate_id,
    title: source.title,
    revision: source.revision,
    media_type: source.media_type,
    ...(source.original_name === undefined ? {} : { original_name: source.original_name }),
    ...(candidate?.url === undefined ? {} : { url: candidate.url }),
    ...(candidate?.official === undefined ? {} : { official: candidate.official }),
    chunk_count: state.knowledge_chunks.filter((chunk) => chunk.source_id === source.id).length,
    canonical_chars: source.canonical_text.length,
    ...(source.selection_snapshot === undefined ? {} : { selection_snapshot: source.selection_snapshot }),
  };
}

function mapCandidate(candidate: SourceCandidate): DashboardCandidateView {
  return {
    id: candidate.id,
    title: candidate.title,
    ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
    ...(candidate.url === undefined ? {} : { url: candidate.url }),
    ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
    status: candidate.status,
    ...(candidate.official === undefined ? {} : { official: candidate.official }),
    ...(candidate.failure === undefined ? {} : { failure: candidate.failure }),
    ...(candidate.selection_snapshot === undefined ? {} : { selection_snapshot: candidate.selection_snapshot }),
  };
}

function deriveOperationReplayability(
  operation: OperationRecord,
  errorClass: "recoverable" | "fatal" | undefined,
): OperationReplayability {
  const refs = operation.command?.attachment_refs ?? [];
  const attachments: OperationAttachmentStatusView[] = refs.map((ref) => ({
    id: ref.id,
    name: ref.name,
    ...(ref.media_type === undefined ? {} : { media_type: ref.media_type }),
    available: true,
  }));

  const hasMissingAttachments = operation.status === "needs_input" && (operation.question?.includes("ATTACHMENT_REUPLOAD_REQUIRED") === true);

  if (operation.status === "completed" || operation.status === "cancelled") {
    return {
      state: "non_replayable",
      reason_code: "OPERATION_TERMINAL",
      reason: "操作已結束，不可再次執行。",
      attachment_count: attachments.length,
      attachments,
    };
  }

  if (hasMissingAttachments) {
    return {
      state: "requires_reupload",
      reason_code: "ATTACHMENTS_MISSING",
      reason: "缺少附件檔案，需重新上傳後才能繼續。",
      attachment_count: attachments.length,
      attachments: attachments.map((att) => ({ ...att, available: false })),
    };
  }

  if (operation.status === "needs_input") {
    return {
      state: "non_replayable",
      reason_code: "USER_INPUT_REQUIRED",
      reason: "需要使用者回答問題或確認決策。",
      attachment_count: attachments.length,
      attachments,
    };
  }

  if (operation.status === "failed") {
    if (errorClass === "fatal") {
      return {
        state: "non_replayable",
        reason_code: "OPERATION_FAILED_FATAL",
        reason: "操作發生不可恢復之錯誤，需人工重新發起。",
        attachment_count: attachments.length,
        attachments,
      };
    }
    return {
      state: "replayable",
      reason_code: "RETRY_AVAILABLE",
      reason: "操作可安全重試。",
      attachment_count: attachments.length,
      attachments,
    };
  }

  return {
    state: "replayable",
    reason_code: "IN_FLIGHT_RESUMABLE",
    reason: "操作可繼續執行。",
    attachment_count: attachments.length,
    attachments,
  };
}

function mapOperation(operation: OperationRecord, classes: ReadonlyMap<string, "recoverable" | "fatal">, includeDetail = false): DashboardOperationView | DashboardOperationDetail {
  const errorClass = classes.get(operation.id);
  const replayability = deriveOperationReplayability(operation, errorClass);
  const base: DashboardOperationView = {
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    request: operation.request,
    ...(operation.actor === undefined ? {} : { actor: operation.actor }),
    ...(operation.question === undefined ? {} : { question: operation.question }),
    ...(operation.lease_owner === undefined ? {} : { lease_owner: operation.lease_owner }),
    ...(operation.lease_expires_at === undefined ? {} : { lease_expires_at: operation.lease_expires_at }),
    ...(operation.attempt === undefined ? {} : { attempt: operation.attempt }),
    ...(operation.last_error === undefined ? {} : { last_error: operation.last_error }),
    ...(errorClass === undefined ? {} : { error_class: errorClass }),
    replayability,
    created_at: operation.created_at,
    updated_at: operation.updated_at,
    progress_count: operation.progress.length,
    ...(operation.progress.length === 0 ? {} : { progress: operation.progress.slice(-3).map((item) => ({ status: item.status, message: item.message })) }),
  };
  if (!includeDetail) return base;
  return {
    ...base,
    ...(operation.result_summary === undefined ? {} : { result_summary: operation.result_summary }),
    ...(operation.command === undefined ? {} : { command: operation.command }),
    ...(operation.execution_snapshot === undefined ? {} : { execution_snapshot: operation.execution_snapshot }),
    ...(operation.fencing_generation === undefined ? {} : { fencing_generation: operation.fencing_generation }),
  };
}

function mapIssue(issue: ProjectState["issues"][number]): DashboardIssueView {
  const override = issue.override;
  return {
    id: issue.id,
    artifact_id: issue.artifact_id,
    review_id: issue.review_id,
    code: issue.code,
    message: issue.message,
    severity: issue.severity,
    effective_severity: issue.effective_severity,
    status: issue.status,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    overridable: issue.overridable === true,
    ...(override === undefined ? {} : {
      override: {
        ...(override.severity === undefined ? {} : { severity: override.severity }),
        against_effective_severity: override.against_effective_severity,
        reason: override.reason,
        by: override.by,
        timestamp: override.timestamp,
      },
    }),
  };
}

function mapReview(review: ReviewRecord): DashboardReviewView {
  return {
    id: review.id,
    artifact_id: review.artifact_id,
    artifact_revision: review.artifact_revision,
    reviewer: review.reviewer,
    status: review.status,
    issue_ids: review.issue_ids,
    created_at: review.created_at,
  };
}

function mapReviewRun(state: ProjectState, run: ProjectState["fact_review_runs"][number], includeDetail = false): DashboardReviewRunView | DashboardReviewRunDetail {
  const base: DashboardReviewRunView = {
    id: run.id,
    status: run.status,
    candidate_occurrence_ids: run.candidate_occurrence_ids,
    candidate_set_revision: run.candidate_set_revision,
    policy_revision: run.policy_revision,
    created_by: run.created_by,
    created_at: run.created_at,
    ...(run.completed_at === undefined ? {} : { completed_at: run.completed_at }),
    ...(run.curation_run_id === undefined ? {} : { curation_run_id: run.curation_run_id }),
    source_revisions: run.source_revisions,
  };
  if (!includeDetail) return base;
  return {
    ...base,
    decisions: state.fact_review_decisions.filter((item) => item.review_run_id === run.id).map((item) => ({
      candidate_occurrence_id: item.candidate_occurrence_id,
      decision: item.decision,
      reviewer_identity: item.reviewer_identity,
      reason: item.reason,
    })),
    candidates: run.candidate_occurrence_ids.map((occurrenceId) => {
      const fact = state.facts.find((item) => item.candidate_occurrence_id === occurrenceId);
      return { candidate_occurrence_id: occurrenceId, statement: fact?.statement ?? "", status: fact?.status ?? "candidate" };
    }),
  };
}

function mapPublish(publish: ProjectState["publishes"][number]): DashboardPublishView {
  return {
    id: publish.id,
    operation_id: publish.operation_id,
    artifact_ids: publish.artifact_ids,
    content_hash: publish.content_hash,
    created_at: publish.created_at,
    ...(publish.export_json_path === undefined ? {} : { export_json_path: publish.export_json_path }),
    ...(publish.export_png_path === undefined ? {} : { export_png_path: publish.export_png_path }),
    ...(publish.provenance_summary === undefined ? {} : { provenance_summary: publish.provenance_summary }),
  };
}

function mapBuild(build: ProjectState["builds"][number]): DashboardBuildView {
  return {
    id: build.id,
    operation_id: build.operation_id,
    status: build.status,
    artifact_ids: build.artifact_ids,
    content_hash: build.content_hash,
    diagnostics_count: build.diagnostics.length,
    created_at: build.created_at,
    ...(build.provenance_summary === undefined ? {} : { provenance_summary: build.provenance_summary }),
  };
}

function statusCounts(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function currentArtifactIds(state: ProjectState): ReadonlySet<string> {
  return new Set(computeProjectProjection(state).currentArtifacts.map((artifact) => artifact.id));
}

function manifestRoster(manifest: RequiredArtifactManifest | undefined, state: ProjectState): DashboardSummary["roster"] {
  if (manifest !== undefined) {
    return manifest.characters.map((character) => ({
      id: character.character_id,
      label: character.display_name || character.character_id,
      ...(character.mode === undefined ? {} : { mode: character.mode }),
    }));
  }
  const projection = computeProjectProjection(state);
  return projection.roster.map((character) => ({ id: character.id, label: character.label }));
}

export function buildDashboardSummary(state: ProjectState, repair: RepairInspection): DashboardSummary {
  const projection = computeProjectProjection(state);
  const manifest = buildRequiredArtifactManifest(state);
  const latestPublish = state.publishes.at(-1);
  const latestBuild = state.builds.at(-1);
  const latestRun = latestReviewRun(state);
  const coverResolution = resolveCoverImageIdentity(state, manifest?.primary_character_id);
  const recordedImageIdentity = latestBuild?.provenance_summary?.image_identity ?? latestPublish?.provenance_summary?.image_identity;
  const imageFreshness = latestPublish === undefined
    ? { status: "unknown" as const, reason: "尚未發布。" }
    : deriveCoverImageFreshness(state, recordedImageIdentity, manifest?.primary_character_id);
  const roster = manifestRoster(manifest, state);
  const primaryCharacterId = manifest?.primary_character_id ?? projection.intent.primary_character_id;
  const blueprint = projection.blueprint === undefined ? undefined : {
    revision: projection.blueprint.artifact_revision ?? "",
    character_count: projection.blueprint.characters.length,
    character_ids: projection.blueprint.characters.map((character) => character.id),
    ...(projection.blueprint.primary_character_id === undefined ? {} : { primary_character_id: projection.blueprint.primary_character_id }),
    world_enabled: projection.blueprint.world_enabled,
    relationships_enabled: projection.blueprint.relationships_enabled,
    source_adaptation: projection.blueprint.source_adaptation,
  };
  const currentIds = currentArtifactIds(state);
  const artifactKeys = new Set(state.artifacts.map((artifact) => artifact.key));
  const images = state.images.map((image): DashboardImageView => ({
    id: image.id,
    ...(image.character_id === undefined ? {} : { character_id: image.character_id }),
    width: image.width,
    height: image.height,
    ...(image.aspect_ratio === undefined ? {} : { aspect_ratio: image.aspect_ratio }),
    ...(image.source === undefined ? {} : { source: image.source }),
    ...(image.license === undefined ? {} : { license: image.license }),
    created_at: image.created_at,
    updated_at: image.updated_at,
  }));
  return {
    project: {
      project_id: state.project_id,
      ...(state.project_name === undefined ? {} : { project_name: state.project_name }),
      project_status: state.project_status,
      revision: state.revision,
      interview_status: state.interview.status,
      ...(state.interview.flow === undefined ? {} : { interview_flow: state.interview.flow }),
      answers_count: state.interview.answers.length,
    },
    counts: {
      artifacts: state.artifacts.length,
      current_artifacts: currentIds.size,
      artifact_keys: artifactKeys.size,
      facts: state.facts.length,
      sources: state.sources.length,
      candidates: state.candidates.length,
      knowledge_chunks: state.knowledge_chunks.length,
      operations: state.operations.length,
      issues: state.issues.length,
      reviews: state.reviews.length,
      fact_review_runs: state.fact_review_runs.length,
      publishes: state.publishes.length,
      builds: state.builds.length,
      images: state.images.length,
      audit_events: state.audit.length,
    },
    status_counts: {
      operations: statusCounts(state.operations.map((operation) => operation.status)),
      candidates: statusCounts(state.candidates.map((candidate) => candidate.status)),
      facts: statusCounts(state.facts.map((fact) => fact.status)),
      issues: statusCounts(state.issues.map((issue) => issue.status)),
      builds: statusCounts(state.builds.map((build) => build.status)),
    },
    ...(blueprint === undefined ? {} : { blueprint }),
    prechecks: state.blueprint_prechecks.map((precheck) => ({
      id: precheck.id,
      status: precheck.status,
      candidate_blueprint_revision: precheck.candidate_blueprint_revision,
      checks_count: precheck.checks.length,
      ...(precheck.status !== "needs_input" ? {} : {
        checks: precheck.checks.map((check) => ({
          subject_id: check.subject_id,
          dimension: check.dimension,
          uncertainty: check.uncertainty,
          impact: check.impact,
          basis: check.basis,
          action: check.action,
          ...(check.user_answer === undefined ? {} : { user_answer: check.user_answer }),
          ...(check.intake_key === undefined ? {} : { intake_key: check.intake_key }),
        })),
      }),
    })),
    ...(roster === undefined ? {} : { roster }),
    ...(primaryCharacterId === undefined ? {} : { primary_character_id: primaryCharacterId }),
    images,
    images_stale: imageFreshness.status === "stale",
    ...(imageFreshness.reason === undefined ? {} : { images_stale_reason: imageFreshness.reason }),
    images_freshness: imageFreshness,
    quality: {
      level: qualityLevelForProfile(state.quality_profile),
      blocking_severity: state.quality_profile.blocking_severity,
      overrides: { ...state.quality_profile.overrides },
    },
    ...(latestPublish === undefined ? {} : { latest_publish: mapPublish(latestPublish) }),
    ...(latestBuild === undefined ? {} : { latest_build: mapBuild(latestBuild) }),
    ...(latestRun === undefined ? {} : { latest_review_run: latestRun }),
    active_cover: {
      identity: coverResolution.identity,
      ...(coverResolution.identity.selection_reason === undefined ? {} : { reason: coverResolution.identity.selection_reason }),
      fallback_order: ["primary", "global", "placeholder"],
    },
    kpis: deriveSummaryKPIs(state),
    repair: {
      plan_hash: repair.plan_hash,
      item_count: repair.items.length,
      recoverable_count: repair.items.filter((item) => item.recoverable).length,
    },
  };
}

export async function readDashboardSummary(repository: ProjectRepository): Promise<DashboardSummary> {
  const [state, repair] = await Promise.all([repository.read(), repository.inspectRepair()]);
  return buildDashboardSummary(state, repair);
}

export function queryDashboardArtifacts(state: ProjectState, options: DashboardArtifactQuery = {}): DashboardPage<DashboardArtifactListItem> {
  const projection = computeProjectProjection(state);
  const currentIds = new Set(projection.currentArtifacts.map((artifact) => artifact.id));
  const filter = options.filter;
  const currentOnly = filter?.current_only ?? true;
  const artifacts = state.artifacts.filter((artifact) => {
    if (currentOnly && !currentIds.has(artifact.id)) return false;
    if (filter?.kind !== undefined && artifact.kind !== filter.kind) return false;
    if (filter?.status !== undefined && artifact.status !== filter.status) return false;
    if (filter?.key !== undefined && artifact.key !== filter.key) return false;
    if (filter?.character_id !== undefined && !artifact.key.includes(filter.character_id)) return false;
    return includesText(`${artifact.key} ${artifact.name} ${artifact.kind}`, filter?.search);
  });
  return page(sortByNewest(artifacts, (artifact) => artifact.created_at).map((artifact) => mapArtifact(artifact, currentIds)), options.query, { collection: "artifacts", revision: state.revision });
}

export function dashboardArtifactDetail(state: ProjectState, id: string, revision?: string): DashboardArtifactDetail | undefined {
  const artifact = revision === undefined
    ? state.artifacts.find((candidate) => candidate.id === id)
    : state.artifacts.find((candidate) => candidate.id === id && candidate.revision === revision);
  if (artifact === undefined) return undefined;
  return mapArtifact(artifact, currentArtifactIds(state), true) as DashboardArtifactDetail;
}

export function queryDashboardArtifactHistory(state: ProjectState, keyOrId: string, query?: DashboardQuery): DashboardPage<DashboardArtifactListItem> {
  const artifact = state.artifacts.find((candidate) => candidate.id === keyOrId);
  const key = artifact?.key ?? keyOrId;
  const currentIds = currentArtifactIds(state);
  const history = state.artifacts.filter((candidate) => candidate.key === key).map((candidate) => mapArtifact(candidate, currentIds));
  return page(sortByNewest(history, (candidate) => candidate.created_at), query, { collection: "artifact-history", revision: state.revision });
}

export function queryDashboardFacts(state: ProjectState, options: DashboardFactQuery = {}): DashboardPage<DashboardFactView> {
  const filter = options.filter;
  const facts = state.facts.filter((fact) => {
    if (filter?.status !== undefined && fact.status !== filter.status) return false;
    if (filter?.classification !== undefined && fact.classification !== filter.classification) return false;
    if (filter?.source_id !== undefined && !fact.source_ids.includes(filter.source_id)) return false;
    if (filter?.review_run_id !== undefined && fact.review_run_id !== filter.review_run_id) return false;
    if (filter?.subject !== undefined && fact.subject !== filter.subject) return false;
    return includesText(`${fact.statement} ${fact.subject ?? ""} ${fact.predicate ?? ""} ${fact.value ?? ""}`, filter?.search);
  });
  return page(sortByNewest(facts, (fact) => fact.updated_at ?? fact.created_at).map((fact) => mapFact(state, fact)), options.query, { collection: "facts", revision: state.revision });
}

export function queryDashboardSources(state: ProjectState, options: DashboardSourceQuery = {}): DashboardPage<DashboardSourceView> {
  const filter = options.filter;
  const sources = state.sources.filter((source) => {
    const candidate = state.candidates.find((item) => item.id === source.candidate_id);
    if (filter?.domain !== undefined && candidate?.domain !== filter.domain) return false;
    if (filter?.official !== undefined && candidate?.official !== filter.official) return false;
    return includesText(`${source.title} ${source.original_name ?? ""}`, filter?.search);
  });
  return page(sortByNewest(sources, (source) => source.created_at).map((source) => mapSource(state, source)), options.query, { collection: "sources", revision: state.revision });
}

export function queryDashboardCandidates(state: ProjectState, options: DashboardSourceQuery = {}): DashboardPage<DashboardCandidateView> {
  const filter = options.filter;
  const candidates = state.candidates.filter((candidate) => {
    if (filter?.status !== undefined && candidate.status !== filter.status) return false;
    if (filter?.domain !== undefined && candidate.domain !== filter.domain) return false;
    if (filter?.official !== undefined && candidate.official !== filter.official) return false;
    return includesText(`${candidate.title} ${candidate.url ?? ""} ${candidate.domain ?? ""}`, filter?.search);
  });
  return page(sortByNewest(candidates, (candidate) => candidate.approved_at ?? candidate.source_revision ?? "").map(mapCandidate), options.query, { collection: "candidates", revision: state.revision });
}

export function dashboardSourceDetail(state: ProjectState, id: string): DashboardSourceView | undefined {
  const source = state.sources.find((candidate) => candidate.id === id);
  return source === undefined ? undefined : mapSource(state, source);
}

export function dashboardCandidateDetail(state: ProjectState, id: string): DashboardCandidateView | undefined {
  const candidate = state.candidates.find((item) => item.id === id);
  return candidate === undefined ? undefined : mapCandidate(candidate);
}

export function queryDashboardOperations(state: ProjectState, options: DashboardOperationQuery = {}): DashboardPage<DashboardOperationView> {
  const classes = errorClasses(state);
  const filter = options.filter;
  const operations = state.operations.filter((operation) => {
    if (filter?.status !== undefined && operation.status !== filter.status) return false;
    if (filter?.kind !== undefined && operation.kind !== filter.kind) return false;
    return includesText(`${operation.kind} ${operation.request} ${operation.actor ?? ""}`, filter?.search);
  });
  return page(sortByNewest(operations, (operation) => operation.created_at).map((operation) => mapOperation(operation, classes)), options.query, { collection: "operations", revision: state.revision });
}

export function dashboardOperationDetail(state: ProjectState, id: string): DashboardOperationDetail | undefined {
  const operation = state.operations.find((candidate) => candidate.id === id);
  return operation === undefined ? undefined : mapOperation(operation, errorClasses(state), true) as DashboardOperationDetail;
}

export function queryDashboardAudit(state: ProjectState, options: DashboardAuditQuery = {}): DashboardPage<DashboardAuditView> {
  const filter = options.filter;
  const events = state.audit.filter((event) => {
    if (filter?.operation_id !== undefined && event.operation_id !== filter.operation_id) return false;
    if (filter?.event !== undefined && event.event !== filter.event) return false;
    if (filter?.actor !== undefined && event.actor !== filter.actor) return false;
    return includesText(`${event.event} ${event.actor} ${event.operation_id}`, filter?.search);
  });
  return page(sortByNewest(events, (event) => event.occurred_at).map((event: AuditEvent) => ({
    id: event.id,
    operation_id: event.operation_id,
    event: event.event,
    actor: event.actor,
    occurred_at: event.occurred_at,
    project_revision: event.project_revision,
    details: event.details,
  })), options.query, { collection: "audit", revision: state.revision });
}

export function queryDashboardIssues(state: ProjectState, options: DashboardIssueQuery = {}): DashboardPage<DashboardIssueView> {
  const filter = options.filter;
  const issues = state.issues.filter((issue) => {
    if (filter?.artifact_id !== undefined && issue.artifact_id !== filter.artifact_id) return false;
    if (filter?.status !== undefined && issue.status !== filter.status) return false;
    if (filter?.severity !== undefined && issue.effective_severity !== filter.severity) return false;
    return includesText(`${issue.code} ${issue.message}`, filter?.search);
  });
  return page(sortByNewest(issues, (issue) => issue.created_at).map(mapIssue), options.query, { collection: "issues", revision: state.revision });
}

export function queryDashboardReviews(state: ProjectState, options: DashboardReviewQuery = {}): DashboardPage<DashboardReviewView> {
  const filter = options.filter;
  const reviews = state.reviews.filter((review) => {
    if (filter?.artifact_id !== undefined && review.artifact_id !== filter.artifact_id) return false;
    if (filter?.reviewer !== undefined && review.reviewer !== filter.reviewer) return false;
    if (filter?.status !== undefined && review.status !== filter.status) return false;
    return true;
  });
  return page(sortByNewest(reviews, (review) => review.created_at).map(mapReview), options.query, { collection: "reviews", revision: state.revision });
}

export function queryDashboardPublishes(state: ProjectState, options: DashboardPublishQuery = {}): DashboardPage<DashboardPublishView> {
  const filter = options.filter;
  const publishes = state.publishes.filter((publish) => {
    if (filter?.operation_id !== undefined && publish.operation_id !== filter.operation_id) return false;
    return includesText(`${publish.id} ${publish.content_hash}`, filter?.search);
  });
  return page(sortByNewest(publishes, (publish) => publish.created_at).map(mapPublish), options.query, { collection: "publishes", revision: state.revision });
}

export function queryDashboardBuilds(state: ProjectState, options: DashboardBuildQuery = {}): DashboardPage<DashboardBuildView> {
  const filter = options.filter;
  const builds = state.builds.filter((build) => {
    if (filter?.operation_id !== undefined && build.operation_id !== filter.operation_id) return false;
    if (filter?.status !== undefined && build.status !== filter.status) return false;
    return true;
  });
  return page(sortByNewest(builds, (build) => build.created_at).map(mapBuild), options.query, { collection: "builds", revision: state.revision });
}

export function queryDashboardReviewRuns(state: ProjectState, options: DashboardReviewRunQuery = {}): DashboardPage<DashboardReviewRunView> {
  const filter = options.filter;
  const runs = state.fact_review_runs.filter((run) => {
    if (filter?.status !== undefined && run.status !== filter.status) return false;
    if (filter?.created_by !== undefined && run.created_by !== filter.created_by) return false;
    if (filter?.curation_run_id !== undefined && run.curation_run_id !== filter.curation_run_id) return false;
    return true;
  });
  return page(sortByNewest(runs, (run) => run.created_at).map((run) => mapReviewRun(state, run)), options.query, { collection: "review-runs", revision: state.revision });
}

export function latestReviewRun(state: ProjectState): DashboardReviewRunView | undefined {
  const sorted = sortByNewest(state.fact_review_runs, (run) => run.created_at);
  return sorted.length === 0 ? undefined : mapReviewRun(state, sorted[0]!);
}

export function dashboardReviewRunDetail(state: ProjectState, id: string): DashboardReviewRunDetail | undefined {
  const run = state.fact_review_runs.find((candidate) => candidate.id === id);
  return run === undefined ? undefined : mapReviewRun(state, run, true) as DashboardReviewRunDetail;
}

export function queryFilterFromDashboardQuery(query: DashboardQuery | undefined, key: string): string | undefined {
  return filterString(query?.filter, key);
}

export function booleanFilterFromDashboardQuery(query: DashboardQuery | undefined, key: string): boolean | undefined {
  return filterBoolean(query?.filter, key);
}

function enumFilter<T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  return value !== undefined && values.includes(value as T) ? value as T : undefined;
}

const artifactKinds: readonly ArtifactKind[] = ["character", "relationship", "world_lore", "greeting", "blueprint", "zhuji", "palette", "wardrobe", "plugin", "review", "source_research", "fact_curation", "fact_review", "conversion", "import_analysis", "director_routing", "draft_note", "unknown"];
const artifactStatuses: readonly ArtifactStatus[] = ["draft", "reviewed", "approved", "published"];
const factStatuses: readonly FactRecord["status"][] = ["candidate", "accepted", "rejected", "conflict"];
const factClassifications: readonly FactClassification[] = ["identity", "trait", "event", "relationship", "world", "other"];
const issueSeverities: readonly IssueSeverity[] = ["info", "warning", "error", "critical"];
const reviewStatuses: readonly ReviewRecord["status"][] = ["passed", "failed", "partial"];

export function artifactQueryFromDashboardQuery(query: DashboardQuery): DashboardArtifactQuery {
  const filter: NonNullable<DashboardArtifactQuery["filter"]> = {};
  const kind = enumFilter(filterString(query.filter, "kind"), artifactKinds);
  const status = enumFilter(filterString(query.filter, "status"), artifactStatuses);
  const key = filterString(query.filter, "key");
  const characterId = filterString(query.filter, "character_id");
  const search = filterString(query.filter, "search");
  const currentOnly = filterBoolean(query.filter, "current_only");
  if (kind !== undefined) filter.kind = kind;
  if (status !== undefined) filter.status = status;
  if (key !== undefined) filter.key = key;
  if (characterId !== undefined) filter.character_id = characterId;
  if (search !== undefined) filter.search = search;
  if (currentOnly !== undefined) filter.current_only = currentOnly;
  return { query, filter };
}

export function factQueryFromDashboardQuery(query: DashboardQuery): DashboardFactQuery {
  const filter: NonNullable<DashboardFactQuery["filter"]> = {};
  const status = enumFilter(filterString(query.filter, "status"), factStatuses);
  const classification = enumFilter(filterString(query.filter, "classification"), factClassifications);
  const sourceId = filterString(query.filter, "source_id");
  const reviewRunId = filterString(query.filter, "review_run_id");
  const subject = filterString(query.filter, "subject");
  const search = filterString(query.filter, "search");
  if (status !== undefined) filter.status = status;
  if (classification !== undefined) filter.classification = classification;
  if (sourceId !== undefined) filter.source_id = sourceId;
  if (reviewRunId !== undefined) filter.review_run_id = reviewRunId;
  if (subject !== undefined) filter.subject = subject;
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function sourceQueryFromDashboardQuery(query: DashboardQuery): DashboardSourceQuery {
  const filter: NonNullable<DashboardSourceQuery["filter"]> = {};
  const statuses = ["pending", "approved", "rejected", "ingested", "blocked_external", "failed"] as const;
  const status = enumFilter(filterString(query.filter, "status"), statuses);
  const domain = filterString(query.filter, "domain");
  const official = filterBoolean(query.filter, "official");
  const search = filterString(query.filter, "search");
  if (status !== undefined) filter.status = status;
  if (domain !== undefined) filter.domain = domain;
  if (official !== undefined) filter.official = official;
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function operationQueryFromDashboardQuery(query: DashboardQuery): DashboardOperationQuery {
  const filter: NonNullable<DashboardOperationQuery["filter"]> = {};
  const status = filterString(query.filter, "status");
  const kind = filterString(query.filter, "kind");
  const search = filterString(query.filter, "search");
  if (status !== undefined) filter.status = status;
  if (kind !== undefined) filter.kind = kind as OperationRecord["kind"];
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function auditQueryFromDashboardQuery(query: DashboardQuery): DashboardAuditQuery {
  const filter: NonNullable<DashboardAuditQuery["filter"]> = {};
  const operationId = filterString(query.filter, "operation_id");
  const event = filterString(query.filter, "event");
  const actor = filterString(query.filter, "actor");
  const search = filterString(query.filter, "search");
  if (operationId !== undefined) filter.operation_id = operationId;
  if (event !== undefined) filter.event = event;
  if (actor !== undefined) filter.actor = actor;
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function issueQueryFromDashboardQuery(query: DashboardQuery): DashboardIssueQuery {
  const filter: NonNullable<DashboardIssueQuery["filter"]> = {};
  const artifactId = filterString(query.filter, "artifact_id");
  const status = filterString(query.filter, "status");
  const severity = enumFilter(filterString(query.filter, "severity"), issueSeverities);
  const search = filterString(query.filter, "search");
  if (artifactId !== undefined) filter.artifact_id = artifactId;
  if (status !== undefined) filter.status = status;
  if (severity !== undefined) filter.severity = severity;
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function reviewQueryFromDashboardQuery(query: DashboardQuery): DashboardReviewQuery {
  const filter: NonNullable<DashboardReviewQuery["filter"]> = {};
  const artifactId = filterString(query.filter, "artifact_id");
  const reviewer = filterString(query.filter, "reviewer");
  const status = enumFilter(filterString(query.filter, "status"), reviewStatuses);
  if (artifactId !== undefined) filter.artifact_id = artifactId;
  if (reviewer !== undefined) filter.reviewer = reviewer;
  if (status !== undefined) filter.status = status;
  return { query, filter };
}

export function publishQueryFromDashboardQuery(query: DashboardQuery): DashboardPublishQuery {
  const filter: NonNullable<DashboardPublishQuery["filter"]> = {};
  const operationId = filterString(query.filter, "operation_id");
  const search = filterString(query.filter, "search");
  if (operationId !== undefined) filter.operation_id = operationId;
  if (search !== undefined) filter.search = search;
  return { query, filter };
}

export function buildQueryFromDashboardQuery(query: DashboardQuery): DashboardBuildQuery {
  const filter: NonNullable<DashboardBuildQuery["filter"]> = {};
  const operationId = filterString(query.filter, "operation_id");
  const status = filterString(query.filter, "status");
  if (operationId !== undefined) filter.operation_id = operationId;
  if (status !== undefined) filter.status = status;
  return { query, filter };
}

export function reviewRunQueryFromDashboardQuery(query: DashboardQuery): DashboardReviewRunQuery {
  const filter: NonNullable<DashboardReviewRunQuery["filter"]> = {};
  const status = filterString(query.filter, "status");
  const createdBy = filterString(query.filter, "created_by");
  const curationRunId = filterString(query.filter, "curation_run_id");
  if (status !== undefined) filter.status = status;
  if (createdBy !== undefined) filter.created_by = createdBy;
  if (curationRunId !== undefined) filter.curation_run_id = curationRunId;
  return { query, filter };
}
