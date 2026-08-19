import { readCardFromPng, cropPngCover, readPngImageInfo, pngSignature, validatePngImage, CARD_IMAGE_MAX_DIMENSION, isBuiltInPlaceholderImage, PngFormatError } from "@st-workspace/adapters-png";
import { characterCardV3Schema, canonicalCardJson, type CharacterCardV3 } from "@st-workspace/adapters-ccv3";
import {
  buildZhujiTemplateContext,
  buildTemplateContext,
  beginInterview,
  buildPreparedPublishSnapshot,
  buildProvenanceCompositionSummary,
  canonicalJson,
  comparePreparedSnapshotDiff,
  computeBuildPlan,
  computeBuildSnapshotHash,
  computeProjectProjection,
  CoreError,
  contentHash,
  deriveHistoricalDecisionRefs,
  hasValidMultiCharacterRoster,
  createQualityPolicySnapshot,
  executionContextFromOperation,
  validateFactReferences,
  FORMAL_NAME_QUESTION_PREFIX,
  internalId,
  InMemoryAttachmentStore,
  InterviewError,
  normalizeInterviewStateForDisplay,
  parseRelationshipParticipants,
  parseWardrobeMarkdown,
  publishedCardExportPath,
  publishedCardPngExportPath,
  provenanceConfirmationFingerprint,
  resolveCoverImageIdentity,
  derivePublishedOutputPlan,
  templateJsonSchemaFor,
  templateProposalValueSchema,
  zhujiProposalJsonSchema,
  zhujiProposalValueSchema,
  sourceContextFromRecord,
  workflow_answer_interview,
  z,
  type BlueprintPrecheckDimension,
  type OperationRecord, type PublishIntentRecord,
  type OperationAttachmentRef,
  type ArtifactRecord,
  type AdaptationDecision,
  type AttachmentStore,
  type AuthoringKnowledgeContext,
  type FactReviewContext,
  type FactReviewRunRecord,
  type FactDecision,
  type InterviewFlow,
  type InterviewQuestion,
  type OperationCommand,
  type ProjectState,
  type ProjectRepository,
  type RequestResult,
  type SourceAttachment,
  type BlueprintPrecheckCheck,
  type BlueprintPrecheckRecord,
  type InterviewState,
  type InterviewCharacterSubject,
  type QualityLevel,
  type IssueSeverity,
  type TemplateKind,
  type TemplateInstance,
  type TemplateProposalValue,
  type WorkspaceContext,
  type SourceAdaptationIntent,
  type ZhujiModuleKind,
  type ZhujiProposalValue,
  type ArtifactKind,
  type RepairInspection,
  type RepairReport,
  type FactClassification,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type CoverageSnapshot,
  type ExecutionContext,
  type ExecutionLeaseContext,
  type PreparedPublishSnapshot,
  type ProvenancePublishCommandPayload,
  type ProvenanceStaleReport,
} from "@st-workspace/core";
import {
  AuthoringService,
  BuildService,
  ImportService,
  KnowledgeService,
  ReviewService,
  SourceService,
  buildCoverageSnapshot,
  fetchApprovedSource,
  inferAuthoringKind,
  PALETTE_REQUIRED_MODULES,
  ZHUJI_REQUIRED_MODULES,
  validateWorkflow,
  buildRequiredArtifactManifest,
  assertExecutionLeaseForOperation,
  extractSourceUrl,
  validateCurationClaims,
  reviewRunProjectionRevision,
  type IssueUpdateInput,
  type SourceSelectionDecision,
  type SourceFetcher,
  type WorkflowGateResult,
  type ReviewExecutionResult,
  type FactReviewExecutionResult,
  type KnowledgeExecutionResult,
  buildDefaultRequirementSet,
  coverageAssessmentFreshness,
  deriveArtifactCoverageLineage,
  deriveDownstreamInvalidation,
  deriveEvidenceContextViews,
  deriveEvidenceReferenceStale,
  deriveProjectInvalidations,
  deriveSourceAdaptationWorkflow,
  deriveStructuredPublishDiagnostics,
  emptyDownstreamInvalidationReport,
  resolveBuildModeSelection,
  runFormalCoverageAssessment,
  runInitialCoverageAssessment,
  type ArtifactCoverageLineage,
  type CoverageCenterMatrix,
  type CoverageResearchRecoverInput,
  type CoverageUrlIngestionRecoverInput,
  type CoverageResolutionConfirmInput,
  type CoverageResolutionPreviewInput,
  type CoverageSupplementInput,
  type DownstreamInvalidationReport,
  type EvidenceContextView,
  type ResearchMonitor,
  type SourceAdaptationWorkflowModel,
  type StructuredPublishDiagnostics,
} from "@st-workspace/domain";
import type { CardModeSelection } from "@st-workspace/compiler";
import { AgentRouter, type AgentResolution } from "./agent-router.js";
import type { DashboardProvenanceView, PublishCompletionView, PublishDownloadResult, PublishExecutionKind, PublishProvenanceConfirmInput, PublishProvenancePreviewResult } from "./runtime-views.js";
import { coverageResearchCandidates as coverageResearchCandidatesQuery, coverageResearchClaim as coverageResearchClaimQuery, coverageResearchExhaust as coverageResearchExhaustQuery, coverageResearchRecover as coverageResearchRecoverQuery, coverageUrlIngestionRecover as coverageUrlIngestionRecoverQuery, coverageResearchStart as coverageResearchStartQuery, coverageResearchStartPreview as coverageResearchStartPreviewQuery, coverageResolutionConfirm as coverageResolutionConfirmQuery, coverageResolutionPreview as coverageResolutionPreviewQuery, coverageSupplement as coverageSupplementQuery, dashboardCoverage as dashboardCoverageQuery, dashboardCoverageCenter as dashboardCoverageCenterQuery, executeCoverageResearchCandidates, executeCoverageResearchClaim, executeCoverageResearchExhaust, executeCoverageResearchRecover, executeCoverageResearchStart, executeCoverageResolutionConfirm, executeCoverageSupplement, type CoverageApplicationDeps, type CoverageCommandOutcome } from "./coverage-application.js";
import {
  artifactQueryFromDashboardQuery,
  auditQueryFromDashboardQuery,
  buildQueryFromDashboardQuery,
  dashboardArtifactDetail,
  dashboardCandidateDetail,
  dashboardOperationDetail,
  dashboardReviewRunDetail,
  dashboardSourceDetail,
  factQueryFromDashboardQuery,
  issueQueryFromDashboardQuery,
  operationQueryFromDashboardQuery,
  queryDashboardArtifactHistory,
  queryDashboardArtifacts,
  queryDashboardAudit,
  queryDashboardBuilds,
  queryDashboardCandidates,
  queryDashboardFacts,
  queryDashboardIssues,
  queryDashboardOperations,
  queryDashboardPublishes,
  queryDashboardReviews,
  queryDashboardReviewRuns,
  queryDashboardSources,
  readDashboardSummary,
  reviewQueryFromDashboardQuery,
  reviewRunQueryFromDashboardQuery,
  sourceQueryFromDashboardQuery,
  publishQueryFromDashboardQuery,
  type DashboardArtifactDetail,
  type DashboardArtifactListItem,
  type DashboardAuditView,
  type DashboardBuildView,
  type DashboardCandidateView,
  type DashboardFactView as DashboardReadFactView,
  type DashboardIssueView as DashboardReadIssueView,
  type DashboardOperationDetail,
  type DashboardOperationView as DashboardReadOperationView,
  type DashboardPage,
  type DashboardPublishView,
  type DashboardReviewRunDetail,
  type DashboardReviewRunView,
  type DashboardReviewView,
  type DashboardSourceView,
  type DashboardUrlIngestionView,
  type DashboardSummary,
  type DashboardQuery,
} from "./dashboard-read-model.js";

export {
  artifactQueryFromDashboardQuery,
  auditQueryFromDashboardQuery,
  buildDashboardSummary,
  buildQueryFromDashboardQuery,
  dashboardArtifactDetail,
  dashboardCandidateDetail,
  dashboardOperationDetail,
  dashboardReviewRunDetail,
  dashboardSourceDetail,
  dashboardQuerySchema,
  factQueryFromDashboardQuery,
  issueQueryFromDashboardQuery,
  operationQueryFromDashboardQuery,
  page,
  parseDashboardQuery,
  publishQueryFromDashboardQuery,
  queryDashboardArtifactHistory,
  queryDashboardArtifacts,
  queryDashboardAudit,
  queryDashboardBuilds,
  queryDashboardCandidates,
  queryDashboardFacts,
  queryDashboardIssues,
  queryDashboardOperations,
  queryDashboardPublishes,
  queryDashboardReviews,
  queryDashboardReviewRuns,
  queryDashboardSources,
  readDashboardSummary,
  reviewQueryFromDashboardQuery,
  reviewRunQueryFromDashboardQuery,
  sourceQueryFromDashboardQuery,
} from "./dashboard-read-model.js";
export type {
  DashboardArtifactDetail,
  DashboardArtifactListItem,
  DashboardAuditView,
  DashboardBuildView,
  DashboardCandidateView,
  DashboardOperationDetail,
  DashboardPage,
  DashboardPublishView,
  DashboardReviewRunDetail,
  DashboardReviewRunView,
  DashboardReviewView,
  DashboardSourceView,
  DashboardUrlIngestionView,
  DashboardSummary,
  DashboardQuery,
} from "./dashboard-read-model.js";

import { authoringKnowledgeContext as authoringKnowledgeContextQuery, templateContext as templateContextQuery, zhujiContext as zhujiContextQuery } from "./authoring-application.js";
import { dashboardSnapshot as dashboardSnapshotQuery, publishPreview as publishPreviewQuery, buildReadiness as buildReadinessQuery, tavernCompat as tavernCompatQuery, repairPreview as repairPreviewQuery, repairRun as repairRunQuery } from "./build-application.js";
import { dashboardArtifacts as dashboardArtifactsQuery, dashboardArtifact as dashboardArtifactQuery, dashboardArtifactHistory as dashboardArtifactHistoryQuery, dashboardAudit as dashboardAuditQuery, dashboardBuilds as dashboardBuildsQuery, dashboardCandidates as dashboardCandidatesQuery, dashboardFacts as dashboardFactsQuery, dashboardIssues as dashboardIssuesQuery, dashboardOperation as dashboardOperationQuery, dashboardOperations as dashboardOperationsQuery, dashboardPublishes as dashboardPublishesQuery, dashboardReviewRun as dashboardReviewRunQuery, dashboardReviewRuns as dashboardReviewRunsQuery, dashboardReviews as dashboardReviewsQuery, dashboardSource as dashboardSourceQuery, dashboardSources as dashboardSourcesQuery, dashboardUrlIngestions as dashboardUrlIngestionsQuery, dashboardSummary as dashboardSummaryQuery, dashboardCandidate as dashboardCandidateQuery } from "./dashboard-query.js";
import { applyFactReviewBatch as applyFactReviewBatchQuery, factReviewContext as factReviewContextQuery, reextract as reextractQuery, resolveFactConflict as resolveFactConflictQuery, startFactReviewRun as startFactReviewRunQuery } from "./fact-review-application.js";
import { buildBlueprintPrecheck, collaborationMode, createBlueprintArtifact, directionForSubject, intakeKeyForConfirmation, interviewCharacterSubjects, interviewContext as interviewContextQuery, interviewAmendmentImpactPreview as interviewAmendmentImpactPreviewQuery, amendInterviewAnswer as amendInterviewAnswerQuery, isBarePrecheckConfirmation, isBlueprintConfirmation, isBlueprintRevisionRequest, latestBlueprintSnapshot, mergeExpansionIntoBlueprint, mergePatchBlueprint, mergeWorldIntoBlueprint, nonEmptyInterviewValue, nonEmptyString, objectValue, PALETTE_MODULE_ORDER, parsePrecheckConfirmQuestionId, precheckConfirmQuestion, precheckSubjectLabel, sourceAdaptationIntentFromValues, sourceFactsReady, startInterview as startInterviewQuery, worldConfig, isSourceAdaptationProject, relationshipConfig, authoringModeForSubject, canonPolicyFromValues, ZHUJI_MODULE_ORDER } from "./interview-application.js";
import { availableCardModesRuntime, blueprintRosterIds, executionLeaseGuard, latestByKey, now, OPERATION_LEASE_MS, parsedModeModules, parseBuildModeSelection, reconstructPublishOutcome, responseFromOperation, stripLease } from "./operation-runner.js";
import { defaultAgentForTemplate, nextFactReviewer, pluginIdOf, proposalCapability, resolveNaturalReviewTarget, reviewCriticForArtifactKind } from "./operation-recovery.js";
import { createAdaptationDecision as createAdaptationDecisionQuery, executionContextFor as executionContextForQuery, resolveExecutionContext as resolveExecutionContextQuery, selectSourceCandidates as selectSourceCandidatesQuery, sourceCandidates as sourceCandidatesQuery } from "./source-application.js";
export * from "./runtime-views.js";
export * from "./authoring-application.js";
export * from "./build-application.js";
export * from "./dashboard-query.js";
export * from "./fact-review-application.js";
export * from "./interview-application.js";
export * from "./operation-runner.js";
export * from "./operation-recovery.js";
export * from "./source-application.js";
export * from "./coverage-application.js";
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
  both_available?: boolean;
  both_blockers?: Array<{ mode: "zhuji" | "palette"; reason: string; diagnostics: Array<{ code: string; message: string }> }>;
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
  provenance_summary?: import("@st-workspace/core").ProvenanceCompositionSummary;
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

export interface WorkspaceRuntimeOptions {
  searcher?: (request: string) => Promise<Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>>;
  sourceSearchMode?: SourceSearchMode;
  fetcher?: SourceFetcher;
  interviewRequired?: boolean;
  attachmentStore?: AttachmentStore;
}

type OperationCommandHandler = (
  operation: OperationRecord,
  command: OperationCommand,
  context: WorkspaceContext,
  execution: ExecutionContext,
) => Promise<RequestResult>;

export class WorkspaceRuntime {
  public readonly sourceSearchMode: SourceSearchMode;
  private readonly sources: SourceService;
  private readonly knowledge: KnowledgeService;
  private readonly authoring: AuthoringService;
  private readonly review: ReviewService;
  private readonly build: BuildService;
  private readonly importer: ImportService;
  private readonly searcher: ((request: string) => Promise<Array<{ title: string; url: string; snippet?: string; content?: string; media_type?: string; domain?: string; official?: boolean }>>) | undefined;
  private readonly fetcher: SourceFetcher | undefined;
  private readonly interviewRequired: boolean;
  private readonly attachmentStore: AttachmentStore;
  private readonly agents = new AgentRouter();
  /** One typed handler registry is shared by request, resume and recovery. */
  private readonly operationCommandHandlers: Record<OperationCommand["type"], OperationCommandHandler> = {
    invalid: (operation, command, _context, execution) => command.type === "invalid"
      ? this.markNeedsInput(operation, command.payload.original_type === "source_select"
        ? `source_select payload 格式無效或缺失（${command.payload.code}）`
        : `${command.payload.code}: ${command.payload.message}`, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    template_proposal: (operation, command, context, execution) => command.type === "template_proposal"
      ? this.replayTemplateProposal(operation, command.payload, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    zhuji_proposal: (operation, command, context, execution) => command.type === "zhuji_proposal"
      ? this.replayZhujiProposal(operation, command.payload, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    source_select: (operation, command, _context, execution) => command.type === "source_select"
      ? this.replaySourceSelection(operation, command, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    source_search: (operation, command, context, execution) => command.type === "source_search"
      ? this.replaySourceSearch(operation, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    issue_update: (operation, command, _context, execution) => command.type === "issue_update"
      ? this.replayIssueUpdate(operation, command, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    import: (operation, command, context, execution) => command.type === "import"
      ? this.replayImport(operation, command, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    source_resume: (operation, command, context, execution) => command.type === "source_resume"
      ? this.replaySource(operation, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    request: (operation, _command, context, execution) => this.replayRequest(operation, context, execution),
    fact_review: (operation, _command, context, execution) => this.replayRequest(operation, context, execution),
    coverage_research_start: (operation, command, _context, execution) => command.type === "coverage_research_start"
      ? this.replayCoverageCommand("coverage.research.started", operation, executeCoverageResearchStart)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_research_claim: (operation, command, _context, execution) => command.type === "coverage_research_claim"
      ? this.replayCoverageCommand("coverage.research.claimed", operation, executeCoverageResearchClaim)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_research_candidates: (operation, command, _context, execution) => command.type === "coverage_research_candidates"
      ? this.replayCoverageCommand("coverage.research.candidates.submitted", operation, executeCoverageResearchCandidates)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_research_exhaust: (operation, command, _context, execution) => command.type === "coverage_research_exhaust"
      ? this.replayCoverageCommand("coverage.research.exhausted", operation, executeCoverageResearchExhaust)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_resolution_confirm: (operation, command, _context, execution) => command.type === "coverage_resolution_confirm"
      ? this.replayCoverageCommand("coverage.resolution.confirmed", operation, executeCoverageResolutionConfirm)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_supplement: (operation, command, _context, execution) => command.type === "coverage_supplement"
      ? this.replayCoverageCommand("coverage.supplement.ingested", operation, executeCoverageSupplement)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    coverage_research_recover: (operation, command, _context, execution) => command.type === "coverage_research_recover"
      ? this.replayCoverageCommand("coverage.research.recovered", operation, executeCoverageResearchRecover)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
    provenance_publish: (operation, command, context, execution) => command.type === "provenance_publish"
      ? this.replayProvenancePublish(operation, command.payload, context, execution)
      : this.markNeedsInput(operation, "OPERATION_COMMAND_INVALID", execution),
  };

  constructor(private readonly repository: ProjectRepository, options: WorkspaceRuntimeOptions = {}) {
    this.sourceSearchMode = options.sourceSearchMode ?? (options.searcher !== undefined ? "runtime_provider" : "agent_managed");
    this.sources = new SourceService(repository);
    this.knowledge = new KnowledgeService(repository);
    this.authoring = new AuthoringService(repository);
    this.review = new ReviewService(repository);
    this.build = new BuildService(repository);
    this.importer = new ImportService(repository, { pngDecoder: async (input) => readCardFromPng(input) });
    this.searcher = options.searcher;
    this.fetcher = options.fetcher;
    this.interviewRequired = options.interviewRequired ?? false;
    this.attachmentStore = options.attachmentStore ?? new InMemoryAttachmentStore();
  }

  async interviewContext(): Promise<{
    project_id: string;
    status: InterviewState["status"];
    flow: InterviewState["flow"];
    question?: InterviewState["current"];
    answers: InterviewState["answers"];
    values: InterviewState["values"];
    characters?: InterviewState["characters"];
    active_character_id?: string;
    revision: number;
    history: import("./interview-application.js").InterviewHistoryEntry[];
  }> {
    return interviewContextQuery({ repository: this.repository });
  }

  async interviewAmendmentImpactPreview(input: { question_id: string; answer: string }): Promise<import("./interview-application.js").InterviewAmendmentPreviewResult> {
    return interviewAmendmentImpactPreviewQuery({ repository: this.repository }, input);
  }

  async amendInterviewAnswer(input: { question_id: string; answer: string }, context: WorkspaceContext): Promise<import("./interview-application.js").InterviewAmendmentResult> {
    return amendInterviewAnswerQuery({ repository: this.repository }, input, context);
  }

  private async startInterview(request: string, context: WorkspaceContext): Promise<RequestResult> {
    return startInterviewQuery({ repository: this.repository }, request, context);
  }
  async answerInterview(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    const before = await this.repository.read();
    const result = await this.answerInterviewImpl(answer, context);
    return this.attachDownstreamInvalidation(result, before);
  }

  private async answerInterviewImpl(answer: string, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    let state = initial;
    let operation = [...initial.operations].reverse().find((item) => item.kind === "interview" && !["completed", "cancelled", "failed"].includes(item.status));
    if (state.interview.status === "idle") {
      const interview = beginInterview(state.interview);
      const created: OperationRecord = {
        id: internalId("operation"),
        kind: "interview",
        request: "project interview",
        actor: context.actor,
        status: "needs_input",
        created_at: now(),
        updated_at: now(),
        progress: [],
        ...(interview.current?.text === undefined ? {} : { question: interview.current.text }),
      };
      state = await this.repository.commit(state.revision, (current) => ({
        ...current,
        project_status: "interviewing",
        interview,
        operations: [...current.operations, created],
      }));
      operation = created;
    }
    if (operation === undefined) throw new CoreError("INTERVIEW_OPERATION_NOT_FOUND", "找不到目前的訪談操作", true);
    if (state.interview.status === "complete" && !hasValidMultiCharacterRoster(state.interview)) {
      throw new CoreError("INTERVIEW_MULTI_ROSTER_INCOMPLETE", "Multi-character cards require at least two roster entries before a Blueprint can be created.", true);
    }
    const pendingPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (state.interview.status === "complete" && pendingPrecheck !== undefined) {
      const parsed = state.interview.current === undefined ? undefined : parsePrecheckConfirmQuestionId(state.interview.current.id);
      const pendingChecks = pendingPrecheck.checks.filter((check) => check.action === "user_confirmed");
      if (pendingChecks.length === 0) throw new CoreError("INTERVIEW_PRECHECK_INVALID", "Blueprint precheck 沒有需要確認的項目", true);
      if (parsed === undefined) {
        const first = pendingChecks[0]!;
        const question = precheckConfirmQuestion(first, precheckSubjectLabel(pendingPrecheck, first));
        const committed = await this.repository.commit(state.revision, (current) => ({
          ...current,
          interview: { ...current.interview, current: question },
        }));
        return {
          operation_id: operation.id,
          status: "needs_input",
          summary: "訪談已收集完成，請逐項確認 blueprint precheck。",
          completed: [],
          blocked: [],
          question: question.text,
          interview_question: question,
          project_id: committed.project_id,
          flow: state.interview.flow,
        };
      }
      const confirmation = answer.trim();
      if (confirmation.length === 0) throw new CoreError("INTERVIEW_ANSWER_EMPTY", "interview answer 不可為空", true);
      const checkIndex = pendingChecks.findIndex((check) => check.subject_id === parsed.subjectId && check.dimension === parsed.dimension);
      if (checkIndex === -1) throw new CoreError("INTERVIEW_PRECHECK_STALE", "確認問題已過期，請重新確認", true);
      const currentCheck = pendingChecks[checkIndex]!;
      let updatedPrecheck: BlueprintPrecheckRecord = {
        ...pendingPrecheck,
        checks: pendingPrecheck.checks.map((check) => check === currentCheck ? { ...check, user_answer: confirmation } : check),
      };
      if (!isBarePrecheckConfirmation(confirmation)) {
        const intakeKey = intakeKeyForConfirmation(pendingPrecheck, currentCheck);
        const intake = {
          ...(typeof pendingPrecheck.candidate_blueprint.intake_values === "object" && pendingPrecheck.candidate_blueprint.intake_values !== null
            ? pendingPrecheck.candidate_blueprint.intake_values as Record<string, unknown>
            : {}),
          [intakeKey]: confirmation,
        };
        updatedPrecheck = {
          ...updatedPrecheck,
          candidate_blueprint: { ...pendingPrecheck.candidate_blueprint, intake_values: intake },
          candidate_blueprint_revision: contentHash(canonicalJson({ ...pendingPrecheck.candidate_blueprint, intake_values: intake })),
        };
      }
      const nextCheck = pendingChecks[checkIndex + 1];
      const nextQuestion = nextCheck === undefined ? undefined : precheckConfirmQuestion(nextCheck, precheckSubjectLabel(updatedPrecheck, nextCheck));
      const allDone = nextCheck === undefined;
      const confirmedPrecheck: BlueprintPrecheckRecord = { ...updatedPrecheck, status: allDone ? "recorded" : "needs_input" };
      const mergedPatch = allDone
        ? mergePatchBlueprint(state, confirmedPrecheck, operation.id, context.actor)
        : undefined;
      const recordedPrecheck = mergedPatch?.precheck ?? confirmedPrecheck;
      const blueprintArtifact = allDone
        ? (mergedPatch?.artifact ?? createBlueprintArtifact(state, confirmedPrecheck, operation.id, context.actor))
        : undefined;
      const finalized = await this.repository.commit(state.revision, (current) => ({
        ...current,
        project_status: allDone ? "ready" : "interviewing",
        blueprint_prechecks: mergedPatch === undefined
          ? current.blueprint_prechecks.map((item) => item.id === pendingPrecheck.id ? confirmedPrecheck : item)
          : current.blueprint_prechecks.map((item) => item.id === pendingPrecheck.id ? recordedPrecheck : item),
        artifacts: blueprintArtifact === undefined ? current.artifacts : [...current.artifacts, blueprintArtifact],
        interview: nextQuestion === undefined
          ? (() => { const { current: _current, ...rest } = current.interview; return rest; })()
          : { ...current.interview, current: nextQuestion },
        operations: current.operations.map((item) => item.id === operation!.id
          ? {
            ...item,
            status: allDone ? "completed" as const : "needs_input" as const,
            result_summary: allDone ? "Blueprint precheck confirmed; Blueprint saved." : "請繼續確認 precheck 項目。",
            updated_at: now(),
            ...(nextQuestion === undefined ? {} : { question: nextQuestion.text }),
            progress: blueprintArtifact === undefined
              ? item.progress
              : [
                ...item.progress,
                { item_id: confirmedPrecheck.id, status: "completed" as const, message: "Blueprint precheck confirmed." },
                { item_id: blueprintArtifact.id, status: "completed" as const, message: "Blueprint revision saved." },
              ],
          }
          : item),
        audit: [
          ...current.audit,
          ...(blueprintArtifact === undefined ? [] : [{
            id: internalId("audit"),
            operation_id: operation!.id,
            event: "blueprint.created",
            actor: context.actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { artifact_id: blueprintArtifact.id, precheck_id: confirmedPrecheck.id, revision: blueprintArtifact.revision, based_on: blueprintArtifact.based_on },
          }]),
          {
            id: internalId("audit"),
            operation_id: operation!.id,
            event: "blueprint.precheck.confirmed",
            actor: context.actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: {
              precheck_id: pendingPrecheck.id,
              subject_id: parsed.subjectId,
              dimension: parsed.dimension,
              answer: confirmation,
              blueprint_artifact_id: blueprintArtifact?.id,
              confirmation_index: checkIndex + 1,
              confirmation_total: pendingChecks.length,
            },
          },
        ],
      }));
      return {
        operation_id: operation.id,
        status: allDone ? "completed" : "needs_input",
        summary: allDone ? (blueprintArtifact === undefined ? "Blueprint precheck confirmed." : "Blueprint precheck confirmed; Blueprint saved.") : "請繼續確認 precheck 項目。",
        completed: allDone ? [pendingPrecheck.id, ...(blueprintArtifact === undefined ? [] : [blueprintArtifact.id])] : [],
        blocked: [],
        ...(nextQuestion === undefined ? {} : { question: nextQuestion.text, interview_question: nextQuestion }),
        project_id: finalized.project_id,
        flow: state.interview.flow,
      };
    }
    let interview: InterviewState;
    try {
      interview = workflow_answer_interview(state.interview, { answer, actor: context.actor });
    } catch (error) {
      if (error instanceof InterviewError) throw new CoreError(error.code, error.message, error.recoverable);
      throw error;
    }
    const projectName = typeof interview.values.project_name === "string" ? interview.values.project_name : undefined;
    const interviewComplete = interview.status === "complete";
    const precheck = interviewComplete && interview.flow !== "continue" ? buildBlueprintPrecheck(state.project_id, operation.id, interview, context.actor) : undefined;
    const workflowComplete = interviewComplete && precheck?.status !== "needs_input";
    const complete = workflowComplete;
    const firstConfirmQuestion = precheck !== undefined && precheck.status === "needs_input"
      ? (() => {
        const pending = precheck.checks.find((check) => check.action === "user_confirmed");
        return pending === undefined ? undefined : precheckConfirmQuestion(pending, precheckSubjectLabel(precheck, pending));
      })()
      : undefined;
    const mergedPatch = workflowComplete && precheck !== undefined
      ? mergePatchBlueprint(state, precheck, operation.id, context.actor)
      : undefined;
    const recordedPrecheck = mergedPatch?.precheck ?? precheck;
    const blueprintArtifact = workflowComplete && precheck !== undefined
      ? (mergedPatch?.artifact ?? createBlueprintArtifact(state, precheck, operation.id, context.actor))
      : undefined;
    const precheckAudit = precheck === undefined ? [] : [{
      id: internalId("audit"),
      operation_id: operation.id,
      event: "blueprint.precheck.recorded" as const,
      actor: context.actor,
      occurred_at: now(),
      project_revision: state.revision + 1,
      details: { precheck_id: recordedPrecheck?.id, candidate_blueprint_revision: recordedPrecheck?.candidate_blueprint_revision, collaboration_mode: recordedPrecheck?.collaboration_mode, status: recordedPrecheck?.status },
    }];
    const updated = await this.repository.commit(state.revision, (current) => ({
      ...current,
      ...(projectName === undefined ? {} : { project_name: projectName }),
      project_status: workflowComplete ? "ready" : "interviewing",
      interview: firstConfirmQuestion === undefined ? interview : { ...interview, current: firstConfirmQuestion },
      ...(precheck === undefined ? {} : {
        blueprint_prechecks: mergedPatch === undefined
          ? [
            ...current.blueprint_prechecks.map((item) => item.status === "recorded" ? { ...item, status: "superseded" as const } : item),
            precheck,
          ]
          : [
            ...current.blueprint_prechecks.map((item) => item.id === precheck.id || item.status === "recorded" ? { ...item, status: item.id === precheck.id ? item.status : "superseded" as const } : item),
            mergedPatch.precheck,
          ],
      }),
      artifacts: blueprintArtifact === undefined ? current.artifacts : [...current.artifacts, blueprintArtifact],
      operations: current.operations.map((item) => {
        if (item.id !== operation!.id) return item;
        const updatedOperation = { ...item, status: complete ? "completed" as const : "needs_input" as const, result_summary: complete ? "專案訪談完成，已保存所有 intake_answers。" : "訪談回答已保存，請回答下一題。", updated_at: now() };
        const withProgress = blueprintArtifact === undefined
          ? updatedOperation
          : { ...updatedOperation, progress: [...updatedOperation.progress, { item_id: blueprintArtifact.id, status: "completed" as const, message: "Blueprint saved." }] };
        return interview.current === undefined ? withProgress : { ...withProgress, question: interview.current.text };
      }),
      audit: [
        ...current.audit,
        ...precheckAudit,
        ...(blueprintArtifact === undefined ? [] : [{
          id: internalId("audit"),
          operation_id: operation!.id,
          event: "blueprint.created",
          actor: context.actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { artifact_id: blueprintArtifact.id, precheck_id: recordedPrecheck?.id, revision: blueprintArtifact.revision, based_on: blueprintArtifact.based_on },
        }]),
        {
          id: internalId("audit"),
          operation_id: operation!.id,
          event: "interview.answer.recorded",
          actor: context.actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { question_id: state.interview.current?.id, answer, complete, blueprint_artifact_id: blueprintArtifact?.id },
        },
      ],
    }));
    const effectiveInterview: InterviewState = firstConfirmQuestion === undefined ? interview : { ...interview, current: firstConfirmQuestion };
    return {
      operation_id: operation.id,
      status: workflowComplete ? "completed" : "needs_input",
      summary: complete ? "專案訪談完成，已保存所有 intake_answers。" : "回答已保存，請繼續目前的訪談。",
      completed: workflowComplete ? ["interview", ...(precheck === undefined ? [] : [precheck.id]), ...(blueprintArtifact === undefined ? [] : [blueprintArtifact.id])] : [],
      blocked: [],
      ...(effectiveInterview.current === undefined ? {} : { question: effectiveInterview.current.text, interview_question: effectiveInterview.current }),
      project_id: updated.project_id,
      ...(projectName === undefined ? {} : { project_name: projectName }),
      flow: interview.flow,
    };
  }

  /** Return operations that can be safely resumed after a process restart. */
  async recoverableOperations(): Promise<readonly OperationRecord[]> {
    const state = await this.repository.read();
    return state.operations.filter((operation) => ["created", "resolving", "running"].includes(operation.status));
  }

  resolveExecutionContext(operation: OperationRecord, optionalAgent?: string): { agent_id: string; agent_role: string } {
    return resolveExecutionContextQuery(operation, optionalAgent);
  }

  private executionContextFor(
    operation: OperationRecord,
    workspace: WorkspaceContext,
    identity?: { id: string; role: string },
    options: { lease?: ExecutionLeaseContext; target?: { artifactId: string; artifactKind?: ArtifactKind }; capabilities?: readonly string[] } = {},
  ): ExecutionContext {
    return executionContextForQuery(operation, workspace, identity, options);
  }

  private async assertExecutionLease(execution: ExecutionContext): Promise<void> {
    if (execution.lease === undefined) return;
    const operation = (await this.repository.read()).operations.find((item) => item.id === execution.operationId);
    if (!this.leaseHeldBy(operation, execution.lease)) {
      throw new CoreError("OPERATION_LEASE_LOST", `Operation ${execution.operationId} lost its execution lease; another instance may have taken over.`, true);
    }
  }

  /**
   * Atomically claim a persisted operation with an ownership lease. Only one
   * caller (synchronous request or worker) may hold an unexpired lease at a
   * time; a stale lease can be reclaimed after expiry.
   */
  async claimOperation(operationId: string, owner: string, leaseMs: number = OPERATION_LEASE_MS): Promise<OperationRecord | undefined> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || !["created", "resolving", "running"].includes(operation.status)) return undefined;
    if (operation.lease_owner !== undefined && operation.lease_expires_at !== undefined && Date.parse(operation.lease_expires_at) > Date.now()) return undefined;
    const token = internalId("lease");
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    const claimed = await this.repository.commit(state.revision, (current) => {
      const latest = current.operations.find((item) => item.id === operationId);
      if (latest === undefined || !["created", "resolving", "running"].includes(latest.status)) return current;
      if (latest.lease_owner !== undefined && latest.lease_expires_at !== undefined && Date.parse(latest.lease_expires_at) > Date.now()) return current;
      const fencingGen = (latest.fencing_generation ?? 0) + 1;
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? { ...item, lease_owner: owner, lease_token: token, lease_expires_at: leaseExpires, fencing_generation: fencingGen, attempt: (item.attempt ?? 0) + 1, updated_at: now() }
          : item),
      };
    });
    const latest = claimed.operations.find((item) => item.id === operationId);
    return latest !== undefined && latest.lease_token === token ? latest : undefined;
  }

  /** Extend a lease held by the owner. Returns false when ownership was lost. */
  async renewOperationLease(operationId: string, owner: string, token: string, leaseMs: number = OPERATION_LEASE_MS): Promise<boolean> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || operation.lease_owner !== owner || operation.lease_token !== token) return false;
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    let renewed = false;
    await this.repository.commit(state.revision, (current) => {
      const latest = current.operations.find((item) => item.id === operationId);
      if (latest === undefined || latest.lease_owner !== owner || latest.lease_token !== token) return current;
      renewed = true;
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? { ...item, lease_expires_at: leaseExpires, updated_at: now() }
          : item),
      };
    });
    return renewed;
  }

  /** Clear the lease when the holder still owns it; silently ignores others. */
  async releaseOperationLease(operationId: string, owner: string, token: string): Promise<void> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined || operation.lease_owner !== owner || operation.lease_token !== token) return;
    await this.repository.commit(state.revision, (current) => {
      const latest = current.operations.find((item) => item.id === operationId);
      if (latest === undefined || latest.lease_owner !== owner || latest.lease_token !== token) return current;
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? { ...stripLease(item), updated_at: now() }
          : item),
      };
    });
  }

  /**
   * Continue one persisted operation without creating a duplicate operation.
   * Operations that asked a user a question are intentionally excluded from this path.
   */
  async recoverOperation(operationId: string, context: WorkspaceContext = { actor: "worker", attachments: [] }, options: { agent?: string; lease?: ExecutionLeaseContext } = {}): Promise<RequestResult> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    if (!["created", "resolving", "running"].includes(operation.status)) return responseFromOperation(operation);
    if (options.lease !== undefined && !this.leaseHeldBy(operation, options.lease)) {
      throw new CoreError("OPERATION_LEASE_LOST", `Operation ${operationId} is no longer held by this lease; another instance may have taken over.`, true);
    }
    const actor = context.actor.trim().length > 0 ? context.actor : operation.actor ?? "worker";
    const effectiveContext = { ...context, actor };
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => {
      if (options.lease !== undefined && !this.leaseHeldBy(current.operations.find((item) => item.id === operationId), options.lease)) {
        throw new CoreError("OPERATION_LEASE_LOST", `Operation ${operationId} is no longer held by this lease; another instance may have taken over.`, true);
      }
      return {
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...item, actor, status: "running", updated_at: now() }
        : item),
      };
    });
    const identityRequired = this.operationRequiresIdentity(operation);
    let agentId: string | undefined = operation.execution_snapshot?.execution_agent_id;
    if (agentId !== undefined) {
      if (options.agent !== undefined && options.agent !== agentId) {
        const snapshotExecution = this.executionContextFor(operation, effectiveContext, {
          id: agentId,
          role: operation.execution_snapshot?.execution_agent_role ?? "specialist",
        }, options.lease === undefined ? {} : { lease: options.lease });
        await this.recordAudit(operationId, "recovery.identity.snapshot_authoritative", {
          snapshot_agent: agentId,
          requested_agent: options.agent,
        }, snapshotExecution);
      }
    } else if (options.agent !== undefined) {
      agentId = options.agent;
    }
    if (agentId === undefined) {
      const createdAudit = state.audit.find((item) => item.operation_id === operationId && item.event === "operation.created");
      const auditAgent = (createdAudit?.details.agent_id as string | undefined) ?? (createdAudit?.details.proposal_agent as string | undefined);
      if (auditAgent !== undefined && this.auditAgentSuitable(auditAgent, operation)) {
        agentId = auditAgent;
      }
    }
    if (identityRequired && agentId === undefined) {
      return this.markNeedsInput(operation, "EXECUTION_IDENTITY_RECOVERY_REQUIRED: 無法還原此操作的原執行代理（缺少 execution snapshot 與可信 audit 記錄）。請重新指定執行代理後重試。");
    }
    const resolvedIdentity = this.resolveExecutionContext(operation, agentId);
    const identity = { id: resolvedIdentity.agent_id, role: resolvedIdentity.agent_role };
    const execution = this.executionContextFor(operation, effectiveContext, identity, options.lease === undefined ? {} : { lease: options.lease });
    await this.assertExecutionLease(execution);
    const result = await this.replayOperation(operation, effectiveContext, execution);
    if (options.lease !== undefined) {
      const after = (await this.repository.read()).operations.find((item) => item.id === operationId);
      if (after === undefined) {
        throw new CoreError("OPERATION_LEASE_LOST", `Operation ${operationId} lost its lease during recovery; another instance may have taken over.`, true);
      }
      if (after.lease_owner !== undefined && !this.leaseHeldBy(after, options.lease)) {
        throw new CoreError("OPERATION_LEASE_LOST", `Operation ${operationId} lost its lease during recovery; another instance may have taken over.`, true);
      }
    }
    return result;
  }

  /**
   * Re-upload missing or replacement attachments for an operation requiring re-upload,
   * updating canonical attachment refs while preserving the same operation id and lineage.
   */
  async reuploadOperationAttachments(
    operationId: string,
    replacements: Array<{ missing_ref_id?: string; original_ref_id?: string; name: string; content: Uint8Array; media_type?: string }>,
    context: WorkspaceContext = { actor: "user", attachments: [] },
  ): Promise<RequestResult> {
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined) {
      throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist.`, true);
    }
    if (operation.status !== "needs_input" && operation.status !== "failed") {
      throw new CoreError("OPERATION_NOT_RECOVERABLE", `Operation ${operationId} is ${operation.status} and does not require attachment re-upload.`, true);
    }
    if (replacements.length === 0) {
      throw new CoreError("ATTACHMENT_REQUIRED", "請至少提供一個要重新上傳的附件。", true);
    }

    const savedRefs = await this.attachmentStore.save(
      operationId,
      replacements.map((r) => ({ name: r.name, content: r.content, ...(r.media_type === undefined ? {} : { media_type: r.media_type }) })),
    );

    const existingRefs = operation.command?.attachment_refs ?? [];
    let updatedRefs: OperationAttachmentRef[];

    if (existingRefs.length === 0) {
      updatedRefs = savedRefs;
    } else {
      updatedRefs = [...existingRefs];
      for (let i = 0; i < replacements.length; i += 1) {
        const replacement = replacements[i]!;
        const targetId = replacement.missing_ref_id ?? replacement.original_ref_id;
        const newRef = savedRefs[i]!;
        if (targetId !== undefined) {
          const index = updatedRefs.findIndex((r) => r.id === targetId);
          if (index >= 0) {
            updatedRefs[index] = newRef;
          } else {
            updatedRefs.push(newRef);
          }
        } else if (i < updatedRefs.length) {
          updatedRefs[i] = newRef;
        } else {
          updatedRefs.push(newRef);
        }
      }
    }

    const actor = context.actor.trim().length > 0 ? context.actor : operation.actor ?? "user";
    const auditDetails = {
      operation_id: operationId,
      replaced_count: replacements.length,
      original_refs: existingRefs.map((r) => ({ id: r.id, name: r.name })),
      replacement_refs: savedRefs.map((r) => ({ id: r.id, name: r.name, ...(r.media_type === undefined ? {} : { media_type: r.media_type }) })),
    };

    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => {
        if (item.id !== operationId) return item;
        const { question: _q, last_error: _err, ...rest } = item;
        return {
          ...rest,
          status: "running" as const,
          updated_at: now(),
          ...(item.command === undefined ? {} : { command: { ...item.command, attachment_refs: updatedRefs } }),
        };
      }),
      audit: [
        ...current.audit,
        {
          id: internalId("audit"),
          operation_id: operationId,
          event: "operation.attachments.reuploaded",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: auditDetails,
        },
      ],
    }));

    return this.recoverOperation(operationId, { ...context, actor });
  }

  private leaseHeldBy(operation: OperationRecord | undefined, lease: Readonly<{ owner: string; token: string; generation?: number }>): boolean {
    if (operation === undefined) return false;
    if (operation.lease_owner !== lease.owner || operation.lease_token !== lease.token) return false;
    if (lease.generation !== undefined && operation.fencing_generation !== lease.generation) return false;
    if (operation.lease_expires_at === undefined) return true;
    return new Date(operation.lease_expires_at).getTime() > Date.now();
  }

  /** Mark an operation failed after the worker exhausted its retry budget. */
  async failOperation(operationId: string, error: unknown, actor = "worker", lease?: Readonly<{ owner: string; token: string }>): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const state = await this.repository.read();
    const latest = state.operations.find((item) => item.id === operationId);
    if (latest === undefined) return;
    if (lease !== undefined && !this.leaseHeldBy(latest, lease)) return;
    const code = error instanceof CoreError ? error.code : undefined;
    const recoverable = !(error instanceof CoreError && error.recoverable === false);
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: current.operations.map((item) => item.id === operationId
        ? { ...(lease !== undefined ? stripLease(item) : item), status: "failed", result_summary: message, updated_at: now() }
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "operation.failed",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { message, recoverable, ...(code === undefined ? {} : { code }) },
      }],
    }));
  }

  /** Cancel an operation from the console with a compare-and-set guard against terminal or already-owned operations. */
  async cancelOperation(operationId: string, actor = "worker"): Promise<{ operation_id: string; status: "cancelled"; summary: string }> {
    const state = await this.repository.read();
    const latest = state.operations.find((item) => item.id === operationId);
    if (latest === undefined) {
      throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist.`, true);
    }
    const cancellable: ReadonlySet<string> = new Set(["created", "resolving", "running", "partial", "needs_input"]);
    if (!cancellable.has(latest.status)) {
      throw new CoreError("OPERATION_NOT_CANCELLABLE", `Operation ${operationId} is ${latest.status} and cannot be cancelled from the console.`, true);
    }
    await this.repository.commit(state.revision, (current) => {
      const item = current.operations.find((entry) => entry.id === operationId);
      if (item === undefined || !cancellable.has(item.status)) {
        throw new CoreError("OPERATION_NOT_CANCELLABLE", `Operation ${operationId} changed state while cancelling; it is now ${item?.status ?? "gone"} and cannot be cancelled from the console.`, true);
      }
      return {
        ...current,
        operations: current.operations.map((entry) => entry.id === operationId
          ? { ...stripLease(entry), status: "cancelled" as const, result_summary: "The operation was cancelled from the workspace console", updated_at: now() }
          : entry),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "operation.cancelled",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: {
            message: "The operation was cancelled from the workspace console",
            cancellation_actor: actor,
            cancellation_reason: "user_requested",
            previous_status: item.status,
            code: "OPERATION_CANCELLED",
          },
        }],
      };
    });
    return { operation_id: operationId, status: "cancelled", summary: "Operation cancelled." };
  }

  async fetchApprovedSource(candidateId: string, content: string, actorInput = "director") {
    const initial = await this.repository.read();
    return fetchApprovedSource(initial, candidateId, content, actorInput);
  }

  /* c8 ignore start -- recovery delegates to the same domain services covered by the runtime and worker tests. */
  private hasAuditMarker(operationId: string, event: string, state: ProjectState): boolean {
    return state.audit.some((item) => item.operation_id === operationId && item.event === event);
  }

  private async markedStep<T>(operationId: string, event: string, run: () => Promise<T>, execution?: ExecutionContext): Promise<T | undefined> {
    if (execution !== undefined) await this.assertExecutionLease(execution);
    const state = await this.repository.read();
    if (this.hasAuditMarker(operationId, event, state)) return undefined;
    const result = await run();
    if (execution !== undefined) await this.assertExecutionLease(execution);
    return result;
  }

  private coverageDeps(): CoverageApplicationDeps {
    return {
      repository: this.repository,
      knowledge: this.knowledge,
      attachmentStore: this.attachmentStore,
      ...(this.fetcher === undefined ? {} : { fetcher: this.fetcher }),
    };
  }

  private async replayCoverageCommand(marker: string, operation: OperationRecord, apply: (deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string, attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>) => Promise<CoverageCommandOutcome>): Promise<RequestResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    const deps = this.coverageDeps();
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, marker, state)) return { ...responseFromOperation(await this.completeReplayedOperation(operation)), downstream_invalidation: emptyDownstreamInvalidationReport() };
    const storedAttachments = await this.loadOperationAttachments(operation, operation.command);
    if (storedAttachments === undefined) {
      const question = "ATTACHMENT_REUPLOAD_REQUIRED: 此操作缺少所需附件內容，請重新上傳附件。";
      await this.markNeedsInput(operation, question);
      return {
        operation_id: operation.id,
        status: "needs_input",
        summary: question,
        completed: [],
        blocked: [operation.id],
        downstream_invalidation: emptyDownstreamInvalidationReport(),
        question,
      };
    }
    const outcome = await apply(deps, state, operation, operation.actor ?? "worker", storedAttachments);
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      ...outcome.state,
      audit: [...outcome.state.audit, ...outcome.auditEvents.map((event) => ({ ...event, project_revision: current.revision + 1 }))],
    }));
    const after = await this.repository.read();
    return { operation_id: operation.id, status: "completed", summary: `${marker} applied.`, completed: [], blocked: [], ...outcome.result, downstream_invalidation: deriveDownstreamInvalidation(state, after) };
  }

  private async markNeedsInput(operation: OperationRecord, question: string, execution?: ExecutionContext): Promise<RequestResult> {
    if (execution !== undefined) await this.assertExecutionLease(execution);
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => {
      if (execution !== undefined) assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operation.id), execution);
      return {
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...stripLease(item), status: "needs_input" as const, question, updated_at: now() }
      : item),
      };
    });
    return { operation_id: operation.id, status: "needs_input", summary: question, completed: [], blocked: [], question };
  }

  private operationRequiresIdentity(operation: OperationRecord): boolean {
    const command = operation.command;
    if (command?.type === "template_proposal" || command?.type === "zhuji_proposal" || command?.type === "issue_update") return true;
    if (command?.type === "coverage_research_claim" || command?.type === "coverage_research_candidates" || command?.type === "coverage_research_exhaust" || command?.type === "coverage_research_recover") return true;
    return operation.kind === "authoring" || operation.kind === "review";
  }

  private auditAgentSuitable(agent: string, operation: OperationRecord): boolean {
    const definition = this.agents.registryView().get(agent);
    if (definition === undefined) return false;
    const command = operation.command;
    if (command?.type === "template_proposal") {
      const payload = command.payload;
      return this.agents.registryView().canSubmitProposal(agent, payload.kind, proposalCapability(payload));
    }
    if (command?.type === "zhuji_proposal") return this.agents.registryView().canSubmitProposal(agent, "zhuji");
    if (command?.type === "issue_update") return this.agents.registryView().canUpdateIssue(agent);
    if (command?.type === "coverage_research_start" || command?.type === "coverage_research_claim" || command?.type === "coverage_research_candidates" || command?.type === "coverage_research_exhaust" || command?.type === "coverage_research_recover") return definition.role === "researcher";
    if (command?.type === "coverage_resolution_confirm" || command?.type === "coverage_supplement") return definition.role === "orchestrator";
    if (operation.kind === "review") return definition.role === "critic" || definition.role === "reviewer";
    if (operation.kind === "authoring") return definition.role === "creator" || definition.role === "converter" || definition.role === "orchestrator";
    return true;
  }

  private async recordAudit(operationId: string, event: string, details: Record<string, unknown>, actorOrExecution: string | ExecutionContext = "worker"): Promise<void> {
    const execution = typeof actorOrExecution === "string" ? undefined : actorOrExecution;
    if (execution !== undefined) await this.assertExecutionLease(execution);
    const actor = typeof actorOrExecution === "string" ? actorOrExecution : actorOrExecution.auditActor;
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => {
      if (execution !== undefined) assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event,
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: {
          ...details,
          ...(execution === undefined ? {} : {
            execution_agent_id: execution.executionAgent.id,
            ...(execution.lease?.generation === undefined ? {} : { fencing_generation: execution.lease.generation }),
          }),
        },
      }],
      };
    });
    if (execution !== undefined) await this.assertExecutionLease(execution);
  }

  private async updateExecutionSnapshot(operationId: string, patch: { execution_agent_id: string; execution_agent_role: string; capabilities: string[]; target_artifact_id: string; target_artifact_kind: string }, execution?: ExecutionContext): Promise<void> {
    if (execution !== undefined) await this.assertExecutionLease(execution);
    const state = await this.repository.read();
    await this.repository.commit(state.revision, (current) => {
      if (execution !== undefined) assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? { ...item, execution_snapshot: { ...(item.execution_snapshot ?? { created_at: now() }), ...patch } }
          : item),
      };
    });
    if (execution !== undefined) await this.assertExecutionLease(execution);
  }

  private async replayReview(operation: OperationRecord, _context: WorkspaceContext, execution: ExecutionContext): Promise<ReviewExecutionResult> {
    const snapshotTargetId = execution.target?.artifactId ?? operation.execution_snapshot?.target_artifact_id;
    if (snapshotTargetId !== undefined) {
      const state = await this.repository.read();
      const snapshotTarget = state.artifacts.find((artifact) => artifact.id === snapshotTargetId);
      const snapshotKind = execution.target?.artifactKind ?? operation.execution_snapshot?.target_artifact_kind;
      if (snapshotTarget === undefined || (snapshotKind !== undefined && snapshotTarget.kind !== snapshotKind)) {
        const question = "EXECUTION_IDENTITY_RECOVERY_REQUIRED: 無法還原審查目標（snapshot 記錄的 target artifact 不存在或類型不符）。";
         await this.assertExecutionLease(execution);
         await this.repository.commit(state.revision, (current) => {
           assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operation.id), execution);
           return {
             ...current,
             operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "needs_input" as const, question, updated_at: now() } : item),
           };
         });
        return { issue_ids: [], status: "needs_input" as const, summary: question };
      }
    }
    await this.assertExecutionLease(execution);
    return this.review.review(operation.id, operation.request, execution);
  }

  private async runNaturalReview(operation: OperationRecord, request: string, resolution: AgentResolution, artifacts: readonly ArtifactRecord[], workspace: WorkspaceContext, baseExecution?: ExecutionContext): Promise<{ result: RequestResult; reviewer: string; reviewer_role: string }> {
    const targetResolution = resolveNaturalReviewTarget(request, artifacts);
    if (targetResolution === "ambiguous") {
      return { result: await this.markNeedsInput(operation, "審查目標不明確：存在多個可審查的產物，請指名要審查的角色、世界觀或開場白。"), reviewer: resolution.agent_id, reviewer_role: resolution.agent_role };
    }
    if (targetResolution === undefined) {
      const execution = baseExecution ?? this.executionContextFor(operation, workspace, { id: resolution.agent_id, role: resolution.agent_role });
      return { result: await this.reviewResult(operation, request, execution), reviewer: execution.executionAgent.id, reviewer_role: execution.executionAgent.role };
    }
    const target = targetResolution.target;
    const expected = reviewCriticForArtifactKind(target.kind, target.content);
    let reviewer = resolution.agent_id;
    let reviewerRole = resolution.agent_role;
    if (reviewer !== expected) {
      if (resolution.explicit) {
        throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${reviewer} cannot review ${target.kind} artifacts; expected ${expected}.`, true, { agent_id: reviewer, expected_agent: expected, artifact_kind: target.kind, artifact_id: target.id });
      }
      const corrected = this.agents.resolve(request, expected);
      reviewer = corrected.agent_id;
      reviewerRole = corrected.agent_role;
    }
    // This is a new natural request, so the router may correct the initial
    // generic reviewer before the corrected identity is persisted. Recovery
    // still uses the persisted snapshot as its sole authority.
    const targetSnapshot: OperationRecord = {
      ...operation,
      execution_snapshot: {
        ...(operation.execution_snapshot ?? { created_at: now() }),
        execution_agent_id: reviewer,
        execution_agent_role: reviewerRole,
        target_artifact_id: target.id,
        target_artifact_kind: target.kind,
        capabilities: [target.kind],
      },
    };
    const execution = this.executionContextFor(targetSnapshot, workspace, { id: reviewer, role: reviewerRole }, { target: { artifactId: target.id, artifactKind: target.kind }, capabilities: [target.kind] });
    await this.recordAudit(operation.id, "review.target.resolved", { target_artifact_id: target.id, target_artifact_kind: target.kind, reviewer }, execution);
    await this.updateExecutionSnapshot(operation.id, { execution_agent_id: reviewer, execution_agent_role: reviewerRole, capabilities: [target.kind], target_artifact_id: target.id, target_artifact_kind: target.kind }, execution);
    return { result: await this.reviewResult(operation, request, execution), reviewer, reviewer_role: reviewerRole };
  }

  private async reviewResult(operation: OperationRecord, request: string, execution: ExecutionContext): Promise<RequestResult> {
    await this.assertExecutionLease(execution);
    const reviewed = await this.review.review(operation.id, request, execution);
    return {
      operation_id: operation.id,
      status: reviewed.status,
      summary: reviewed.summary,
      completed: reviewed.review_id === undefined ? [] : [reviewed.review_id],
      blocked: reviewed.status === "blocked" ? [operation.id] : [],
    };
  }

  private async loadOperationAttachments(operation: OperationRecord, command: OperationCommand | undefined): Promise<SourceAttachment[] | undefined> {
    const refs = command?.attachment_refs ?? [];
    if (refs.length === 0) return [];
    try {
      return await this.attachmentStore.load(operation.id, refs);
    } catch (error) {
      if (error instanceof CoreError && error.code === "ATTACHMENT_NOT_FOUND") return undefined;
      throw error;
    }
  }

  private async completeReplayedOperation(operation: OperationRecord, execution?: ExecutionContext): Promise<OperationRecord> {
    if (execution !== undefined) await this.assertExecutionLease(execution);
    const state = await this.repository.read();
    const latest = state.operations.find((item) => item.id === operation.id);
    if (latest !== undefined && latest.status === "running") {
      await this.repository.commit(state.revision, (current) => {
        if (execution !== undefined) assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operation.id), execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "completed" as const, updated_at: now() } : item),
        };
      });
      if (execution !== undefined) await this.assertExecutionLease(execution);
      return { ...latest, status: "completed", updated_at: now() };
    }
    return latest ?? operation;
  }

  private async replayOperation(operation: OperationRecord, context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const command = operation.command;
    if (command !== undefined) return this.operationCommandHandlers[command.type](operation, command, context, execution);
    if (operation.kind === "import") return this.replayImport(operation, undefined, context, execution);
    if (operation.kind === "source") return this.replaySource(operation, context, execution);
    return this.replayRequest(operation, context, execution);
  }

  private async replayTemplateProposal(operation: OperationRecord, proposal: TemplateProposalValue, _context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const proposalAgent = execution.executionAgent.id;
    const auditActor = execution.auditActor;
    await this.assertExecutionLease(execution);
    const candidateResult = proposal.kind === "source_research" && proposal.candidates.length > 0
      ? await this.markedStep(operation.id, "source.candidates_registered", () => this.sources.registerCandidates(operation.id, proposal.candidates.map((candidate) => ({
        title: candidate.title,
        ...(candidate.url === undefined ? {} : { url: candidate.url }),
        ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
        ...(candidate.official === undefined ? {} : { official: candidate.official }),
        ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
        ...(candidate.content === undefined ? {} : { content: candidate.content }),
      })), auditActor), execution)
      : undefined;
    let domainSummary: string | undefined;
    let domainCompleted: string[] = [];
    if (proposal.kind === "fact_curation") {
      const applied = await this.markedStep(operation.id, "fact.curation.applied", () => this.knowledge.applyCuration(operation.id, proposal.claims, execution), execution);
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = applied.facts;
      }
    } else if (proposal.kind === "fact_review") {
      const run = await this.markedStep(operation.id, "fact.review.run.created", () => this.knowledge.beginFactReviewRun(operation.id, execution), execution);
      const runId = run?.id ?? (await this.repository.read()).fact_review_runs.filter((item) => item.status !== "superseded").at(-1)?.id;
      let applied;
      if (runId !== undefined) {
        try {
          applied = await this.markedStep(operation.id, "fact.review.batch.applied", async () => {
            const reviewProjection = (await this.knowledge.factReviewContext({ reviewer_identity: proposalAgent })).projection_revision;
            return this.knowledge.applyReviewBatch(operation.id, proposal.decisions, execution, proposalAgent, runId, reviewProjection);
          }, execution);
        } catch (error) {
          if (!(error instanceof CoreError && error.code === "FACT_CANDIDATE_NOT_ACTIVE")) throw error;
        }
      }
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = applied.fact_ids;
      }
      const result = await this.markedStep(operation.id, "template.created", () => this.authoring.createTemplate(operation.id, proposal, execution), execution);
      if (result === undefined) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
      const finalOperation = (await this.repository.read()).operations.find((item) => item.id === operation.id);
      const needsInput = finalOperation?.status === "needs_input";
      return {
        operation_id: operation.id,
        status: needsInput ? "needs_input" : result.status,
        summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
        completed: [...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
        blocked: needsInput ? domainCompleted : [],
        agent_id: proposalAgent,
        agent_role: execution.executionAgent.role,
      };
    } else if (proposal.kind === "review") {
      const applied = await this.markedStep(operation.id, "review.proposal.applied", () => this.review.applyProposal(operation.id, proposal, execution), execution);
      if (applied !== undefined) {
        domainSummary = applied.summary;
        domainCompleted = [...(applied.review_id === undefined ? [] : [applied.review_id]), ...applied.issue_ids];
      }
    }
    const created = await this.markedStep(operation.id, "template.created", () => this.authoring.createTemplate(operation.id, proposal, execution), execution);
    if (created === undefined) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    return {
      operation_id: operation.id,
      status: created.status,
      summary: [domainSummary, created.summary].filter((item): item is string => item !== undefined).join(" "),
      completed: [...(candidateResult?.completed ?? []), ...domainCompleted, ...(created.artifact_ids ?? (created.artifact_id === undefined ? [] : [created.artifact_id]))],
      blocked: [],
      agent_id: proposalAgent,
      agent_role: execution.executionAgent.role,
    };
  }

  private async replayZhujiProposal(operation: OperationRecord, proposal: ZhujiProposalValue, _context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const created = await this.markedStep(operation.id, "zhuji.created", () => this.authoring.createZhuji(operation.id, proposal, execution), execution);
    if (created === undefined) {
      const state = await this.repository.read();
      const artifact = state.artifacts.find((item) => item.operation_id === operation.id && item.kind === "zhuji");
      await this.completeReplayedOperation(operation, execution);
      return {
        operation_id: operation.id,
        status: "completed",
        summary: "珠璣已還原（先前已套用）。",
        completed: artifact === undefined ? [] : [artifact.id],
        blocked: [],
        agent_id: execution.executionAgent.id,
        agent_role: execution.executionAgent.role,
      };
    }
    return {
      operation_id: operation.id,
      status: created.status,
      summary: created.summary,
      completed: created.artifact_id === undefined ? [] : [created.artifact_id],
      blocked: [],
      agent_id: execution.executionAgent.id,
      agent_role: execution.executionAgent.role,
    };
  }

  private async replaySourceSearch(operation: OperationRecord, context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.candidates_registered", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    return this.executeSourceSearch(operation, context, operation.request, execution);
  }

  private async executeSourceSearch(operation: OperationRecord, context: WorkspaceContext, query: string, execution: ExecutionContext): Promise<RequestResult> {
    const mode = operation.execution_snapshot?.source_search_mode ?? this.sourceSearchMode;

    if (mode === "disabled") {
      const latest = await this.repository.read();
      const question = "來源搜尋功能已停用。請直接提供來源 URL 或上傳附件材料。";
      const summary = "來源搜尋功能已停用（SOURCE_SEARCH_DISABLED）。";
      await this.assertExecutionLease(execution);
      await this.repository.commit(latest.revision, (current) => ({
        ...executionLeaseGuard(current, operation.id, execution),
        ...current,
        operations: current.operations.map((item) => item.id === operation.id
          ? { ...item, status: "needs_input", question, result_summary: summary, updated_at: now() }
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operation.id,
          event: "source.search.disabled",
          actor: execution.auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { query, code: "SOURCE_SEARCH_DISABLED" },
        }],
      }));
      return { operation_id: operation.id, status: "needs_input", summary, question, completed: [], blocked: [operation.id], agent_id: execution.executionAgent.id };
    }

    if (mode === "runtime_provider") {
      if (this.searcher === undefined) {
        const latest = await this.repository.read();
        const question = "Runtime 尚未注入 SourceSearchProvider。請在 Runtime 配置注入搜尋 Provider，或將搜尋模式切換為 agent_managed。";
        const summary = "尚未注入 Runtime 搜尋 Provider（SOURCE_SEARCH_PROVIDER_UNAVAILABLE）。";
        await this.assertExecutionLease(execution);
        await this.repository.commit(latest.revision, (current) => ({
          ...executionLeaseGuard(current, operation.id, execution),
          ...current,
          operations: current.operations.map((item) => item.id === operation.id
            ? { ...item, status: "needs_input", question, result_summary: summary, updated_at: now() }
            : item),
          audit: [...current.audit, {
            id: internalId("audit"),
            operation_id: operation.id,
            event: "source.search.provider_unavailable",
            actor: execution.auditActor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { query, code: "SOURCE_SEARCH_PROVIDER_UNAVAILABLE" },
          }],
        }));
        return { operation_id: operation.id, status: "needs_input", summary, question, completed: [], blocked: [operation.id], agent_id: execution.executionAgent.id };
      }
      const results = context.research_results ?? await this.searcher(query);
      const searched = await this.sources.registerCandidates(operation.id, results, execution);
      return { operation_id: operation.id, status: searched.status, summary: searched.summary, completed: searched.completed, blocked: searched.blocked, agent_id: execution.executionAgent.id };
    }

    // agent_managed mode (default)
    if (context.research_results !== undefined && context.research_results.length > 0) {
      const searched = await this.sources.registerCandidates(operation.id, context.research_results, execution);
      return { operation_id: operation.id, status: searched.status, summary: searched.summary, completed: searched.completed, blocked: searched.blocked, agent_id: execution.executionAgent.id };
    }

    const latest = await this.repository.read();
    const question = "目前為 Agent 託管搜尋模式。請由具備聯網能力的 Source Researcher Agent 搜尋並提交 source_research 提案，或由使用者直接提供來源 URL/附件。";
    const summary = "目前為 Agent 託管搜尋模式（agent_managed）。需要聯網 Source Researcher Agent 執行搜尋並提交 typed source_research proposal，或直接提供 URL。";
    await this.assertExecutionLease(execution);
    await this.repository.commit(latest.revision, (current) => ({
      ...executionLeaseGuard(current, operation.id, execution),
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...item, status: "needs_input", question, result_summary: summary, updated_at: now() }
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "source.search.agent_managed_required",
        actor: execution.auditActor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { query, code: "SOURCE_SEARCH_AGENT_MANAGED" },
      }],
    }));
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary,
      question,
      completed: [],
      blocked: [],
      agent_id: execution.executionAgent.id,
    };
  }

  private async replaySource(operation: OperationRecord, context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const refs = operation.command?.attachment_refs ?? [];
    let attachments: SourceAttachment[];
    if (refs.length === 0) {
      attachments = context.attachments;
    } else {
      const stored = await this.loadOperationAttachments(operation, operation.command);
      if (stored === undefined) return this.markNeedsInput(operation, "無法還原來源操作所需的附件，請重新上傳來源檔案。");
      attachments = stored;
    }
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.ingested", state) || this.hasAuditMarker(operation.id, "source.blocked", state)) {
      return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    }
    const executionContext = this.fetcher === undefined
      ? { ...context, actor: execution.auditActor, execution }
      : { ...context, actor: execution.auditActor, fetcher: this.fetcher, execution };
    const resume = attachments.length > 0 || /https?:\/\//iu.test(operation.request);
    const result = resume
      ? await this.sources.resume(operation.id, operation.request, { ...executionContext, attachments })
      : await this.sources.execute(operation.id, executionContext);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.completed, blocked: result.blocked, agent_id: execution.executionAgent.id };
  }

  private async replaySourceSelection(operation: OperationRecord, command: Extract<OperationCommand, { type: "source_select" }>, execution: ExecutionContext): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "source.selection.updated", state) || this.hasAuditMarker(operation.id, "source.ingested", state)) {
      return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    }
    const parsed = { success: true as const, data: { decisions: command.payload.decisions } };
    if (!parsed.success) {
      return this.markNeedsInput(operation, "無法還原來源選擇操作，payload 格式無效或缺失，請重新提交候選來源選擇。");
    }
    const directorExecution = executionContextFromOperation(operation, { auditActor: "director", executionAgent: { id: "director", role: "orchestrator" } });
    const result = await this.sources.selectCandidates(operation.id, parsed.data.decisions, directorExecution);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.approved, ...result.rejected], blocked: [], agent_id: execution.executionAgent.id };
  }

  private async replayIssueUpdate(operation: OperationRecord, command: Extract<OperationCommand, { type: "issue_update" }>, execution: ExecutionContext): Promise<RequestResult> {
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "review.issue.updated", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    const input = command.payload;
    if (input.action.length === 0 || input.issue_id.length === 0) {
      return this.markNeedsInput(operation, "無法還原 issue 更新操作，請重新提交。");
    }
    const result = await this.review.updateIssue(operation.id, input, execution);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [result.issue_id], blocked: [], agent_id: execution.executionAgent.id };
  }

  private async replayImport(operation: OperationRecord, command: OperationCommand | undefined, context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const refs = command?.attachment_refs ?? [];
    let attachments: SourceAttachment[];
    if (refs.length === 0) {
      attachments = context.attachments;
    } else {
      const stored = await this.loadOperationAttachments(operation, command);
      if (stored === undefined) return this.markNeedsInput(operation, "無法還原匯入操作所需的附件，請重新上傳要匯入的檔案。");
      attachments = stored;
    }
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "import.committed", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
    const result = await this.importer.run(operation.id, operation.request, execution, attachments);
    const latest = await this.repository.read();
    const finalOperation = latest.operations.find((item) => item.id === operation.id);
    return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.artifact_id === undefined ? (result.import_id === undefined ? [] : [result.import_id]) : [result.artifact_id], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), agent_id: execution.executionAgent.id };
  }

  private async replayRequest(operation: OperationRecord, context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const agent = execution.executionAgent.id;
    const actor = execution.auditActor;
    await this.assertExecutionLease(execution);
    const kind = operation.kind;
    if (kind === "knowledge") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "knowledge.refreshed", state) || this.hasAuditMarker(operation.id, "knowledge.chunks.prepared", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
      const result = await this.executeKnowledgeRequest(operation, execution);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    if (kind === "authoring") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "artifact.created", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
      const creator = agent;
      const result = await this.authoring.create(operation.id, operation.request, execution);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.artifact_id === undefined ? [] : [result.artifact_id], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(creator === undefined ? {} : { agent_id: creator }) };
    }
    if (kind === "review") {
      if (/^issue /iu.test(operation.request)) {
        const state = await this.repository.read();
        if (this.hasAuditMarker(operation.id, "review.issue.updated", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
        return this.markNeedsInput(operation, "issue 更新無法自動還原，請重新提交。");
      }
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "artifact.reviewed", state) || this.hasAuditMarker(operation.id, "review.reevaluated", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
      const result = /re-?evaluate|quality profile/iu.test(operation.request)
        ? await this.review.reevaluate(operation.id, execution)
        : await this.replayReview(operation, context, execution);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.review_id === undefined ? [] : [result.review_id], blocked: result.status === "blocked" ? [operation.id] : [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    if (kind === "build") {
      const state = await this.repository.read();
      if (this.hasAuditMarker(operation.id, "publish.committed", state) || this.hasAuditMarker(operation.id, "build.previewed", state)) return responseFromOperation(await this.completeReplayedOperation(operation, execution));
      const command = operation.command;
      const provenancePayload = command?.type === "provenance_publish" ? command.payload : undefined;
      const buildOptions = provenancePayload === undefined
        ? {}
        : {
            ...(provenancePayload.mode_selection === undefined ? {} : { mode_selection: provenancePayload.mode_selection }),
            expected_provenance_fingerprint: provenancePayload.fingerprint,
          };
      const result = await this.build.run(operation.id, operation.request, execution, buildOptions);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return { operation_id: operation.id, status: result.status, summary: result.summary, completed: result.build_id === undefined ? [] : [result.build_id], blocked: result.status === "blocked" ? [operation.id] : [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }), ...(agent === undefined ? {} : { agent_id: agent }) };
    }
    await this.assertExecutionLease(execution);
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => ({
      ...executionLeaseGuard(current, operation.id, execution),
      ...current,
      operations: current.operations.map((item) => item.id === operation.id
        ? { ...item, status: "needs_input", question: "請描述要執行的來源、知識、創作、審查或建置操作。", updated_at: now() }
        : item),
    }));
    return { operation_id: operation.id, status: "needs_input", summary: "需要更多工作描述才能繼續。", completed: [], blocked: [], question: "請描述要執行的來源、知識、創作、審查或建置操作。", ...(agent === undefined ? {} : { agent_id: agent }) };
  }

  private async replayProvenancePublish(operation: OperationRecord, payload: ProvenancePublishCommandPayload, _context: WorkspaceContext, execution: ExecutionContext): Promise<RequestResult> {
    const agent = execution.executionAgent.id;
    const state = await this.repository.read();
    if (this.hasAuditMarker(operation.id, "publish.committed", state) || this.hasAuditMarker(operation.id, "build.previewed", state)) {
      const completedOp = await this.completeReplayedOperation(operation, execution);
      const replayedState = await this.repository.read();
      return reconstructPublishOutcome(replayedState, completedOp, true);
    }
    const buildOptions = {
      ...(payload.mode_selection === undefined ? {} : { mode_selection: payload.mode_selection }),
      expected_provenance_fingerprint: payload.fingerprint,
    };
    const result = await this.build.run(operation.id, operation.request, execution, buildOptions);
    const latest = await this.repository.read();
    const finalOperation = latest.operations.find((item) => item.id === operation.id);
    const publishRecord = latest.publishes.find((p) => p.operation_id === operation.id);
    const completedIds = Array.from(new Set([
      ...(result.build_id === undefined ? [] : [result.build_id]),
      ...(publishRecord?.id === undefined ? [] : [publishRecord.id]),
    ]));
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: completedIds,
      blocked: result.status === "blocked" ? [operation.id] : [],
      ...(result.build_id === undefined ? {} : { build_id: result.build_id }),
      ...(publishRecord?.id === undefined ? {} : { publish_id: publishRecord.id }),
      ...(publishRecord?.created_at === undefined ? {} : { published_at: publishRecord.created_at }),
      ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
      ...(agent === undefined ? {} : { agent_id: agent }),
      idempotent_replay: false,
    };
  }

  /* c8 ignore stop */
  async zhujiContext(characterId?: string): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildZhujiTemplateContext> }> {
    return zhujiContextQuery({ repository: this.repository, knowledge: this.knowledge }, characterId);
  }

  private async executeKnowledgeRequest(operation: OperationRecord, execution: ExecutionContext): Promise<KnowledgeExecutionResult> {
    const state = await this.repository.read();
    return isSourceAdaptationProject(state)
      ? this.knowledge.prepareSourceAdaptationChunks(operation.id, operation.request, execution)
      : this.knowledge.refresh(operation.id, operation.request, execution);
  }

  async templateContext(kind: TemplateKind, executionAgent?: ExecutionContext["executionAgent"]): Promise<{ schema: Record<string, unknown>; context: ReturnType<typeof buildTemplateContext> }> {
    return templateContextQuery({ repository: this.repository, knowledge: this.knowledge }, kind, executionAgent);
  }

  async authoringKnowledgeContext(): Promise<AuthoringKnowledgeContext> {
    return authoringKnowledgeContextQuery({ repository: this.repository, knowledge: this.knowledge });
  }

  async sourceCandidates(): Promise<ReadonlyArray<ProjectState["candidates"][number]>> {
    return sourceCandidatesQuery({ repository: this.repository, sources: this.sources });
  }

  async selectSourceCandidates(decisions: SourceSelectionDecision[], context: WorkspaceContext): Promise<RequestResult> {
    const before = await this.repository.read();
    const result = await selectSourceCandidatesQuery({ repository: this.repository, sources: this.sources }, decisions, context);
    return this.attachDownstreamInvalidation(result, before);
  }

  async createAdaptationDecision(input: Omit<AdaptationDecision, "id" | "created_at" | "created_by">, context: WorkspaceContext): Promise<RequestResult> {
    const before = await this.repository.read();
    const result = await createAdaptationDecisionQuery({ repository: this.repository, sources: this.sources }, input, context);
    return this.attachDownstreamInvalidation(result, before);
  }
  async submitTemplateProposal(proposal: unknown, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const before = await this.repository.read();
    const result = await this.submitTemplateProposalImpl(proposal, context, options);
    return this.attachDownstreamInvalidation(result, before);
  }

  private async submitTemplateProposalImpl(proposal: unknown, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const parsed = templateProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("TEMPLATE_SCHEMA_INVALID", parsed.error.message, true);
    await this.ensureInterviewComplete();
    const knowledgeState = await this.repository.read();
    if (parsed.data.kind !== "source_research" && parsed.data.kind !== "fact_curation" && parsed.data.kind !== "fact_review" && parsed.data.kind !== "review") {
      this.ensureSourceAdaptationFactsReady(knowledgeState);
    }
    const factFindings = validateFactReferences(parsed.data, knowledgeState.facts, knowledgeState.sources);
    if (factFindings.length > 0) {
      throw new CoreError("FACT_REFERENCE_INVALID", "Fact provenance validation failed.", true, factFindings);
    }
    if (parsed.data.kind === "fact_curation") validateCurationClaims(knowledgeState, parsed.data.claims);
    if (parsed.data.kind === "palette") {
      await this.ensureBlueprintAuthoringReady("palette", parsed.data.character_id, parsed.data.module.module);
    }
    if (parsed.data.kind === "wardrobe") {
      await this.ensureWardrobeAuthoringReady(parsed.data.character_id);
    }
    const worldOrderKind: ArtifactKind | undefined = parsed.data.kind === "world"
      ? "world_lore"
      : parsed.data.kind === "character"
        ? "character"
        : parsed.data.kind === "zhuji"
          ? "zhuji"
          : parsed.data.kind === "palette"
            ? "palette"
            : parsed.data.kind === "wardrobe"
              ? "wardrobe"
              : undefined;
    if (worldOrderKind !== undefined) await this.ensureWorldAuthoringOrder(worldOrderKind);
    const request = `create ${parsed.data.kind}`;
    const fallbackAgent = parsed.data.kind === "fact_review"
      ? nextFactReviewer(knowledgeState)
      : defaultAgentForTemplate(parsed.data);
    const resolution = this.agents.resolve(request, options.agent ?? fallbackAgent);
    if (!this.agents.registryView().canSubmitProposal(resolution.agent_id, parsed.data.kind, proposalCapability(parsed.data))) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to submit ${parsed.data.kind} proposals.`, true, { agent_id: resolution.agent_id, proposal_kind: parsed.data.kind });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: parsed.data.kind === "review" || parsed.data.kind === "fact_review" ? "review" : "authoring",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "template_proposal", payload: parsed.data },
      execution_snapshot: {
        execution_agent_id: resolution.agent_id,
        execution_agent_role: resolution.agent_role,
        initiated_by: context.actor,
        capabilities: [proposalCapability(parsed.data)].filter((c): c is string => c !== undefined),
        route_kind: resolution.kind,
        created_at: now(),
      },
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { template_kind: parsed.data.kind, agent_id: resolution.agent_id },
      }],
    }));
    const execution = this.executionContextFor(operation, context, { id: resolution.agent_id, role: resolution.agent_role });
    const candidateResult = parsed.data.kind === "source_research" && parsed.data.candidates.length > 0
      ? await this.sources.registerCandidates(operation.id, parsed.data.candidates.map((candidate) => ({
        title: candidate.title,
        ...(candidate.url === undefined ? {} : { url: candidate.url }),
        ...(candidate.domain === undefined ? {} : { domain: candidate.domain }),
        ...(candidate.official === undefined ? {} : { official: candidate.official }),
        ...(candidate.snippet === undefined ? {} : { snippet: candidate.snippet }),
        ...(candidate.content === undefined ? {} : { content: candidate.content }),
      })), execution)
      : undefined;
    let domainSummary: string | undefined;
    let domainCompleted: string[] = [];
    if (parsed.data.kind === "fact_curation") {
      const applied = await this.knowledge.applyCuration(operation.id, parsed.data.claims, execution);
      domainSummary = applied.summary;
      domainCompleted = applied.facts;
    } else if (parsed.data.kind === "fact_review") {
      const run = await this.knowledge.beginFactReviewRun(operation.id, execution);
      const reviewProjection = (await this.knowledge.factReviewContext({ reviewer_identity: resolution.agent_id })).projection_revision;
      const applied = await this.knowledge.applyReviewBatch(operation.id, parsed.data.decisions, execution, resolution.agent_id, run.id, reviewProjection);
      domainSummary = applied.summary;
      domainCompleted = applied.fact_ids;
      const result = await this.authoring.createTemplate(operation.id, parsed.data as TemplateProposalValue, execution);
      if (applied.status === "needs_input") {
        const latest = await this.repository.read();
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === operation.id
            ? { ...item, status: "needs_input" as const, question: "Fact review needs additional evidence or Director conflict resolution.", updated_at: now() }
            : item),
        }));
      }
      return {
        operation_id: operation.id,
        status: applied.status === "needs_input" ? "needs_input" : result.status,
        summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
        completed: [...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
        blocked: applied.status === "needs_input" ? domainCompleted : [],
        agent_id: resolution.agent_id,
        agent_role: resolution.agent_role,
      };
    } else if (parsed.data.kind === "review") {
      const applied = await this.review.applyProposal(operation.id, parsed.data, execution);
      domainSummary = applied.summary;
      domainCompleted = [...(applied.review_id === undefined ? [] : [applied.review_id]), ...applied.issue_ids];
    }
    const result = await this.authoring.createTemplate(operation.id, parsed.data as TemplateProposalValue, execution);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: [domainSummary, result.summary].filter((item): item is string => item !== undefined).join(" "),
      completed: [...(candidateResult?.completed ?? []), ...domainCompleted, ...(result.artifact_ids ?? (result.artifact_id === undefined ? [] : [result.artifact_id]))],
      blocked: [],
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  /** Director-only fact review submission; bypasses reviewer rotation so conflicts can be resolved. */
  async submitConflictResolution(proposal: unknown, context: WorkspaceContext): Promise<RequestResult> {
    return this.submitTemplateProposal(proposal, context, { agent: "director" });
  }

  async submitZhujiProposal(proposal: unknown, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const parsed = zhujiProposalValueSchema.safeParse(proposal);
    if (!parsed.success) throw new CoreError("ZHUJI_SCHEMA_INVALID", parsed.error.message, true);
    await this.ensureInterviewComplete();
    const knowledgeState = await this.repository.read();
    this.ensureSourceAdaptationFactsReady(knowledgeState);
    const factFindings = validateFactReferences(parsed.data, knowledgeState.facts, knowledgeState.sources);
    if (factFindings.length > 0) throw new CoreError("FACT_REFERENCE_INVALID", "Fact provenance validation failed.", true, factFindings);
    await this.ensureBlueprintAuthoringReady("zhuji", parsed.data.character_id, parsed.data.module.module);
    const request = `建立珠璣 ${parsed.data.character_id} ${parsed.data.module.module}`;
    const resolution = this.agents.resolve(request, options.agent ?? "zhuji-creator");
    if (!this.agents.registryView().canSubmitProposal(resolution.agent_id, parsed.data.kind)) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to submit ${parsed.data.kind} proposals.`, true, { agent_id: resolution.agent_id, proposal_kind: parsed.data.kind });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "authoring",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "zhuji_proposal", payload: parsed.data },
      execution_snapshot: {
        execution_agent_id: resolution.agent_id,
        execution_agent_role: resolution.agent_role,
        initiated_by: context.actor,
        capabilities: ["zhuji"],
        route_kind: resolution.kind,
        created_at: now(),
      },
    };
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "authoring", request, agent_id: resolution.agent_id, module: parsed.data.module.module },
      }],
    }));
    const execution = this.executionContextFor(operation, context, { id: resolution.agent_id, role: resolution.agent_role });
    const result = await this.authoring.createZhuji(operation.id, parsed.data as ZhujiProposalValue, execution);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: result.artifact_id === undefined ? [] : [result.artifact_id],
      blocked: [],
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  /** Configure quality with a compact preset instead of exposing blocking internals. */
  async configureQualityProfile(level: QualityLevel, context: WorkspaceContext, overrides: Record<string, IssueSeverity> = {}): Promise<RequestResult> {
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "status",
      request: `quality profile ${level}`,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      execution_snapshot: {
        execution_agent_id: "director",
        execution_agent_role: "orchestrator",
        initiated_by: context.actor,
        route_kind: "status",
        created_at: now(),
      },
    };
    const created = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "quality_profile", level },
      }],
    }));
    const execution = this.executionContextFor(operation, context, { id: "director", role: "orchestrator" });
    const result = await this.review.configureQualityProfile(operation.id, level, execution, overrides);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: [operation.id],
      blocked: [],
      project_id: created.project_id,
    };
  }

  async updateIssue(input: IssueUpdateInput, context: WorkspaceContext, options: { agent?: string } = {}): Promise<RequestResult> {
    const request = `issue ${input.action} ${input.issue_id}`;
    const resolution = this.agents.resolve(request, options.agent ?? "director");
    if (!this.agents.registryView().canUpdateIssue(resolution.agent_id)) {
      throw new CoreError("AGENT_CAPABILITY_DENIED", `Agent ${resolution.agent_id} is not allowed to update review issues.`, true, { agent_id: resolution.agent_id, capability: "issue_update" });
    }
    const initial = await this.repository.read();
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "review",
      request,
      actor: context.actor,
      status: "running",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: { version: 1, type: "issue_update", payload: input },
      execution_snapshot: {
        execution_agent_id: resolution.agent_id,
        execution_agent_role: resolution.agent_role,
        initiated_by: context.actor,
        route_kind: "review",
        created_at: now(),
      },
    };
    const created = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind: "issue_update", issue_id: input.issue_id, action: input.action, agent_id: resolution.agent_id },
      }],
    }));
    const execution = this.executionContextFor(operation, context, { id: resolution.agent_id, role: resolution.agent_role });
    const result = await this.review.updateIssue(operation.id, input, execution);
    return {
      operation_id: operation.id,
      status: result.status,
      summary: result.summary,
      completed: [result.issue_id],
      blocked: [],
      project_id: created.project_id,
      agent_id: resolution.agent_id,
      agent_role: resolution.agent_role,
    };
  }

  private async proposeBlueprintRevision(request: string, context: WorkspaceContext): Promise<RequestResult> {
    const initial = await this.repository.read();
    const previousPrecheck = [...initial.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    if (previousPrecheck === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，再提出方向修改。", true);
    }
    const candidateBeforeRevision = previousPrecheck.candidate_blueprint;
    const rawCharacters = Array.isArray(candidateBeforeRevision.characters)
      ? candidateBeforeRevision.characters.map(objectValue).filter((value): value is Record<string, unknown> => value !== undefined)
      : [];
    const revisionCharacters = rawCharacters.length > 0
      ? rawCharacters
      : [{ id: "character-1", label: "角色", ordinal: 1 }];
    const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const namedMatches = revisionCharacters.filter((character) => {
      const label = nonEmptyString(character.label);
      return label !== undefined && new RegExp(escapeRegex(label), "iu").test(request);
    });
    const ordinalMatch = request.match(/(?:character[- _]?(\d+)|第\s*(\d+)\s*名|角色\s*(\d+))/iu);
    const ordinal = ordinalMatch === null ? undefined : Number(ordinalMatch[1] ?? ordinalMatch[2] ?? ordinalMatch[3]);
    const ordinalMatchCharacter = ordinal === undefined ? undefined : revisionCharacters.find((character) => Number(character.ordinal) === ordinal || character.id === `character-${ordinal}`);
    const targetCharacter = namedMatches.length === 1
      ? namedMatches[0]
      : ordinalMatchCharacter ?? (revisionCharacters.length === 1 ? revisionCharacters[0] : undefined);
    if (targetCharacter === undefined) {
      const labels = revisionCharacters.map((character) => nonEmptyString(character.label) ?? String(character.id ?? "角色")).join("、");
      throw new CoreError("BLUEPRINT_CHARACTER_REQUIRED", `請指出要修改哪名角色的方向（${labels}）。`, true);
    }
    const targetCharacterId = nonEmptyString(targetCharacter.id) ?? "character-1";
    const targetCharacterLabel = nonEmptyString(targetCharacter.label) ?? targetCharacterId;
    const operation: OperationRecord = {
      id: internalId("operation"),
      kind: "interview",
      request,
      actor: context.actor,
      status: "needs_input",
      created_at: now(),
      updated_at: now(),
      progress: [],
       question: `已更新「${targetCharacterLabel}」的 Blueprint 方向草案；請回答「確認」保存，或繼續提供短句修改。`,
    };
    const candidate = JSON.parse(JSON.stringify(previousPrecheck.candidate_blueprint)) as Record<string, unknown>;
    const existingIntake = candidate.intake_values !== null && typeof candidate.intake_values === "object" && !Array.isArray(candidate.intake_values)
      ? candidate.intake_values as Record<string, unknown>
      : {};
    const requestWithoutCommand = request.replace(/^\s*(?:修改|更新|調整|change|revise|update)\s*/iu, "").trim();
    const genericStripped = request.replace(/^\s*(?:修改|更新|調整|change|revise|update)\s*(?:blueprint\s*)?(?:方向|direction)?\s*[:：-]?\s*/iu, "").trim();
    const directionPrefixes = [
      `${targetCharacterLabel}的 Blueprint 方向`,
      `${targetCharacterLabel}的角色設定方向`,
      `${targetCharacterId} Blueprint direction`,
      `${targetCharacterId} direction`,
    ];
    const normalizedRequest = requestWithoutCommand.toLocaleLowerCase();
    const matchedPrefix = directionPrefixes.find((prefix) => normalizedRequest.startsWith(prefix.toLocaleLowerCase()));
    const selected = (matchedPrefix === undefined
      ? (revisionCharacters.length === 1 ? genericStripped || request.trim() : request.trim())
      : requestWithoutCommand.slice(matchedPrefix.length).replace(/^[\s:：-]+/u, "").trim()) || request.trim();
    const revisedIntake = { ...existingIntake, [`blueprint_direction:${targetCharacterId}`]: selected };
    if (revisionCharacters.length === 1) revisedIntake.blueprint_direction = selected;
    const candidateCharacters = revisionCharacters.map((character) => {
      if (String(character.id) !== targetCharacterId) return character;
      const previousDirection = objectValue(character.direction) ?? {};
      const history = Array.isArray(previousDirection.history) ? previousDirection.history : [];
      return {
        ...character,
        direction: {
          ...previousDirection,
          scope: "character_setting",
          selected,
          character_setting_direction: selected,
          candidate_summary: selected,
          source_question_id: `blueprint_direction:${targetCharacterId}`,
          selected_at: now(),
          intake_revision: contentHash(canonicalJson(revisedIntake)),
          history: [...history, { answer: selected, actor: context.actor, occurred_at: now() }],
        },
      };
    });
    candidate.intake_values = revisedIntake;
    candidate.characters = candidateCharacters;
    if (candidateCharacters.length === 1) candidate.blueprint_direction = objectValue(candidateCharacters[0]?.direction);
    const confirmationCheck: BlueprintPrecheckCheck = {
      subject_id: targetCharacterId,
      dimension: "cross_module_impact",
      uncertainty: "high",
      impact: "high",
      basis: "A direction revision can affect downstream mode modules.",
      action: "user_confirmed",
      user_answer: "pending confirmation",
    };
    const checks = previousPrecheck.checks.some((check) => check.dimension === "cross_module_impact" && check.subject_id === targetCharacterId)
      ? previousPrecheck.checks.map((check) => check.dimension === "cross_module_impact" && check.subject_id === targetCharacterId ? confirmationCheck : check)
      : [...previousPrecheck.checks, confirmationCheck];
    const precheck: BlueprintPrecheckRecord = {
      id: internalId("blueprint_precheck"),
      schema_version: 1,
      project_id: initial.project_id,
      operation_id: operation.id,
      collaboration_mode: previousPrecheck.collaboration_mode,
      candidate_blueprint: candidate,
      candidate_blueprint_revision: contentHash(canonicalJson(candidate)),
      checks,
      status: "needs_input",
      created_at: now(),
      created_by: context.actor,
    };
    const updated = await this.repository.commit(initial.revision, (current) => ({
      ...current,
      project_status: current.project_status === "published" ? "ready" : current.project_status,
      blueprint_prechecks: [
        ...current.blueprint_prechecks.map((item) => item.status === "recorded" ? { ...item, status: "superseded" as const } : item),
        precheck,
      ],
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "blueprint.revision.proposed",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { precheck_id: precheck.id, previous_precheck_id: previousPrecheck.id, candidate_blueprint_revision: precheck.candidate_blueprint_revision },
      }],
    }));
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary: "已建立 Blueprint 方向修訂草案；請確認後才會保存新版本。",
      completed: [],
      blocked: [precheck.id],
      ...(operation.question === undefined ? {} : { question: operation.question }),
      project_id: updated.project_id,
      agent_id: "director",
      agent_role: "orchestrator",
    };
  }

  async resumeOperation(operationId: string, requestText: string, context: WorkspaceContext = { actor: "worker", attachments: [] }): Promise<RequestResult> {
    return this.request(requestText, context, { target_operation_id: operationId });
  }

  async request(request: string, context: WorkspaceContext, options: { agent?: string; idempotency_key?: string; target_operation_id?: string; operation_id?: string } = {}): Promise<RequestResult> {
    const before = await this.repository.read();
    const result = await this.requestImpl(request, context, options);
    return this.attachDownstreamInvalidation(result, before);
  }

  private async attachDownstreamInvalidation<T extends object>(result: T, before: ProjectState): Promise<T & { downstream_invalidation: DownstreamInvalidationReport }> {
    const after = await this.repository.read();
    return { ...result, downstream_invalidation: deriveDownstreamInvalidation(before, after) };
  }

  async dashboardWorkflow(): Promise<SourceAdaptationWorkflowModel> {
    const state = await this.repository.read();
    return deriveSourceAdaptationWorkflow(state);
  }

  async dashboardInvalidations(): Promise<DownstreamInvalidationReport> {
    const state = await this.repository.read();
    return deriveProjectInvalidations(state);
  }

  private async requestImpl(request: string, context: WorkspaceContext, options: { agent?: string; idempotency_key?: string; target_operation_id?: string; operation_id?: string } = {}): Promise<RequestResult> {
    const trimmed = request.trim();
    if (trimmed.length === 0) {
      throw new CoreError("REQUEST_EMPTY", "請描述想完成的事情", true);
    }
    const qualityRequest = trimmed.match(/(?:quality|品質|審查)\s*(?:profile|模式|設定)?\s*[:：\s]*(none|light|normal|strict|無|輕量|正常|嚴格)/iu);
    if (qualityRequest?.[1] !== undefined) {
      const labels: Record<string, QualityLevel> = { none: "none", light: "light", normal: "normal", strict: "strict", "無": "none", "輕量": "light", "正常": "normal", "嚴格": "strict" };
      const level = labels[qualityRequest[1].toLocaleLowerCase()];
      if (level !== undefined) return this.configureQualityProfile(level, context);
    }
    const resolution = this.agents.resolve(trimmed, options.agent);
    const kind = resolution.kind;
    if (kind === "status") return this.status();
    if (kind === "authoring" || kind === "knowledge" || kind === "build" || kind === "import" || kind === "source") {
      const definition = this.agents.registryView().get(resolution.agent_id);
      if (definition?.read_only === true) {
        throw new CoreError("AGENT_READ_ONLY", `Agent ${resolution.agent_id} is read-only and cannot execute ${kind} requests.`, true, { agent_id: resolution.agent_id, kind });
      }
    }
    const existing = await this.repository.read();
    const pendingBlueprintPrecheck = [...existing.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (this.interviewRequired && pendingBlueprintPrecheck !== undefined) {
      const midConfirmation = existing.interview.current !== undefined && parsePrecheckConfirmQuestionId(existing.interview.current.id) !== undefined;
      if (existing.interview.status === "complete" && (isBlueprintConfirmation(trimmed) || midConfirmation)) {
        return this.answerInterview(trimmed, context);
      }
      throw new CoreError("BLUEPRINT_PRECHECK_REQUIRED", "Blueprint precheck needs a short confirmation before the next workflow step.", true);
    }
    if (this.interviewRequired && existing.interview.status === "complete" && isBlueprintRevisionRequest(trimmed)) {
      return this.proposeBlueprintRevision(trimmed, context);
    }
    const projectNeedsInterview = (existing.project_status === "uninitialized" || existing.project_status === "interviewing") && existing.interview.status !== "complete";
    if (this.interviewRequired && projectNeedsInterview) {
      return existing.interview.status === "active"
        ? this.answerInterview(trimmed, context)
        : this.startInterview(trimmed, context);
    }
    const targetOpId = options.target_operation_id ?? options.operation_id;
    if (targetOpId !== undefined) {
      const targetOp = existing.operations.find((op) => op.id === targetOpId);
      if (targetOp === undefined) {
        throw new CoreError("OPERATION_NOT_FOUND", `Operation ${targetOpId} does not exist`, true);
      }
      if (targetOp.status !== "needs_input") {
        throw new CoreError("OPERATION_NOT_RESUMABLE", `Operation ${targetOpId} is in status '${targetOp.status}' and cannot be resumed.`, true);
      }
      const resumed = await this.resumePendingIfAnswered(targetOp, trimmed, context, "unknown");
      if (resumed !== undefined) return resumed;
    } else {
      const pendingList = existing.operations.filter((operation) => operation.status === "needs_input");
      if (pendingList.length === 1) {
        const resumed = await this.resumePendingIfAnswered(pendingList[0]!, trimmed, context, kind);
        if (resumed !== undefined) return resumed;
      } else if (pendingList.length > 1) {
        const pendingOptions = pendingList.map((op) => ({
          operation_id: op.id,
          kind: op.kind,
          question: op.question ?? "需要使用者回應以繼續執行。",
          request: op.request,
        }));
        return {
          status: "needs_input",
          summary: `目前有多筆待答覆的操作 (${pendingList.length} 筆)，請明確選擇要處理的 operation_id。`,
          question: "目前存在多筆等待回應的操作，請選擇其一繼續執行。",
          completed: [],
          blocked: pendingList.map((op) => op.id),
          pending_operations: pendingOptions,
        };
      }
    }
    if (options.idempotency_key !== undefined) {
      const existingByKey = existing.operations.find((item) => item.idempotency_key === options.idempotency_key);
      if (existingByKey !== undefined) {
        await this.recordAudit(existingByKey.id, "request.idempotent_replay", { idempotency_key: options.idempotency_key }, context.actor);
        return responseFromOperation(existingByKey);
      }
    }
    const state = existing;
    if (kind === "authoring") this.ensureSourceAdaptationFactsReady(state);
    if (kind === "authoring") {
      const inferred = inferAuthoringKind(trimmed);
      if (inferred === "character" || inferred === "world_lore" || inferred === "zhuji" || inferred === "palette" || inferred === "wardrobe") {
        await this.ensureWorldAuthoringOrder(inferred);
      }
    }
    const isSourceSearch = kind === "source" && /搜尋|找來源|research|search/iu.test(trimmed) && !/加入|匯入|保存|批准/iu.test(trimmed);
    const operationId = internalId("operation");
    const syncLease: ExecutionLeaseContext = { owner: internalId("sync"), token: internalId("lease"), generation: 1 };
    const syncLeaseExpiresAt = new Date(Date.now() + OPERATION_LEASE_MS).toISOString();
    const attachmentRefs = context.attachments.length > 0 ? await this.attachmentStore.save(operationId, context.attachments) : [];
    const operation: OperationRecord = {
      id: operationId,
      kind,
      request: trimmed,
      actor: context.actor,
      status: "resolving",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: {
        version: 1,
        type: kind === "import" ? "import" : kind === "source" ? (isSourceSearch ? "source_search" : "source_resume") : "request",
        ...(attachmentRefs.length === 0 ? {} : { attachment_refs: attachmentRefs }),
      },
      ...(options.idempotency_key === undefined ? {} : { idempotency_key: options.idempotency_key }),
      lease_owner: syncLease.owner,
      lease_token: syncLease.token,
      lease_expires_at: syncLeaseExpiresAt,
      ...(syncLease.generation === undefined ? {} : { fencing_generation: syncLease.generation }),
      attempt: 1,
      execution_snapshot: {
        execution_agent_id: resolution.agent_id,
        execution_agent_role: resolution.agent_role,
        initiated_by: context.actor,
        route_kind: resolution.kind,
        source_search_mode: this.sourceSearchMode,
        created_at: now(),
      },
    };
    const created = await this.repository.commit(state.revision, (current) => ({
      ...current,
      operations: [...current.operations, operation],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "operation.created",
        actor: context.actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { kind, request: trimmed, agent_id: resolution.agent_id },
      }],
    }));
    const execution = this.executionContextFor(operation, context, { id: resolution.agent_id, role: resolution.agent_role }, { lease: syncLease });
    try {
    if (kind === "source") {
      await this.repository.commit(created.revision, (current) => {
        executionLeaseGuard(current, operation.id, execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
        };
      });
      if (isSourceSearch) {
        return await this.executeSourceSearch(operation, context, trimmed, execution);
      }
      if (context.attachments.length > 0 || extractSourceUrl(trimmed) !== undefined) {
        const resumeContext = this.fetcher === undefined
          ? { ...context, actor: execution.auditActor, execution }
          : { ...context, actor: execution.auditActor, fetcher: this.fetcher, execution };
        const resumed = await this.sources.resume(operation.id, trimmed, resumeContext);
        const latestResume = await this.repository.read();
        const finalResume = latestResume.operations.find((item) => item.id === operation.id);
        if (finalResume === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operation.id} does not exist`);
        return { ...responseFromOperation(finalResume), status: resumed.status, summary: resumed.summary, completed: resumed.completed, blocked: resumed.blocked };
      }
      const beforeExecute = await this.repository.read();
      const snapshotCandidate = beforeExecute.candidates.find((candidate) => candidate.status === "approved" && candidate.selection_snapshot !== undefined);
      const executeOperationId = snapshotCandidate?.selection_snapshot?.operation_id ?? operation.id;
      const sourceExecution = executeOperationId === operation.id
        ? execution
        : (() => {
          const { lease: _lease, ...withoutLease } = execution;
          return { ...withoutLease, operationId: executeOperationId };
        })();
      const executionContext = this.fetcher === undefined
        ? { ...context, actor: sourceExecution.auditActor, execution: sourceExecution }
        : { ...context, actor: sourceExecution.auditActor, fetcher: this.fetcher, execution: sourceExecution };
      const result = await this.sources.execute(executeOperationId, executionContext);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === executeOperationId);
      if (finalOperation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${executeOperationId} does not exist`);
      if (executeOperationId !== operation.id) {
        await this.repository.commit(latest.revision, (current) => {
          executionLeaseGuard(current, operation.id, execution);
          return {
            ...current,
            operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "completed", updated_at: now() } : item),
          };
        });
      }
      return { ...responseFromOperation(finalOperation), status: result.status, summary: result.summary, completed: result.completed, blocked: result.blocked };
    }
    if (kind === "knowledge" || kind === "authoring" || kind === "review") {
      await this.repository.commit(created.revision, (current) => {
        executionLeaseGuard(current, operation.id, execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
        };
      });
      if (kind === "knowledge") {
        const result = await this.executeKnowledgeRequest(operation, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return { operation_id: operation.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }) };
      }
      if (kind === "authoring") {
        const result = await this.authoring.create(operation.id, trimmed, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return {
          operation_id: operation.id,
          status: result.status,
          summary: result.summary,
          completed: result.artifact_id === undefined ? [] : [result.artifact_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: execution.executionAgent.id,
          agent_role: execution.executionAgent.role,
        };
      }
      if (kind === "review") {
        const natural = /重新評估|re-?evaluate|quality profile/iu.test(trimmed)
          ? { result: await this.review.reevaluate(operation.id, execution), reviewer: execution.executionAgent.id, reviewer_role: execution.executionAgent.role }
          : await this.runNaturalReview(operation, trimmed, resolution, state.artifacts, context, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        const reviewId = "review_id" in natural.result ? natural.result.review_id : undefined;
        return {
          operation_id: operation.id,
          status: natural.result.status,
          summary: natural.result.summary,
          completed: reviewId === undefined ? [] : [reviewId],
          blocked: natural.result.status === "blocked" ? [operation.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: natural.reviewer,
          agent_role: natural.reviewer_role,
        };
      }
    }
    if (kind === "build" || kind === "import") {
      await this.repository.commit(created.revision, (current) => {
        executionLeaseGuard(current, operation.id, execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
        };
      });
      if (kind === "build") {
        const result = await this.build.run(operation.id, trimmed, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === operation.id);
        return {
          operation_id: operation.id,
          status: result.status,
          summary: result.summary,
          completed: result.build_id === undefined ? [] : [result.build_id],
          blocked: result.status === "blocked" ? [operation.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        };
      }
      const result = await this.importer.run(operation.id, trimmed, execution, context.attachments);
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      return {
        operation_id: operation.id,
        status: result.status,
        summary: result.summary,
        completed: result.artifact_id === undefined ? (result.import_id === undefined ? [] : [result.import_id]) : [result.artifact_id],
        blocked: [],
        ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
      };
    }
    const latest = await this.repository.read();
    await this.repository.commit(latest.revision, (current) => {
      executionLeaseGuard(current, operation.id, execution);
      return {
        ...current,
        operations: current.operations.map((item) => item.id === operation.id
          ? { ...item, status: "needs_input", question: "請描述要執行的來源、知識、創作、審查或建置操作。", updated_at: now() }
          : item),
      };
    });
    return {
      operation_id: operation.id,
      status: "needs_input",
      summary: "我需要更明確的操作目標。",
      completed: [],
      blocked: [],
      question: "請描述要執行的來源、知識、創作、審查或建置操作。",
    };
    } finally {
      await this.releaseOperationLease(operation.id, syncLease.owner, syncLease.token);
    }
  }

  async status(): Promise<RequestResult> {
    const state = await this.repository.read();
    const active = [...state.operations].reverse().find((operation) => !["completed", "cancelled", "failed"].includes(operation.status));
    if (active !== undefined) return responseFromOperation(active);
    return {
      status: "completed",
      summary: `目前有 ${state.sources.length} 個已入庫來源、${state.candidates.length} 個候選來源。`,
      completed: state.sources.map((source) => source.id),
      blocked: state.candidates.filter((candidate) => candidate.status === "blocked_external" || candidate.status === "failed").map((candidate) => candidate.id),
    };
  }

  /**
   * Compact dashboard home read model. Large collections are intentionally
   * excluded; callers should use the resource-specific query methods below.
   */
  async dashboardSummary(): Promise<DashboardSummary> {
    return dashboardSummaryQuery({ repository: this.repository });
  }

  async dashboardArtifacts(query?: DashboardQuery): Promise<DashboardPage<DashboardArtifactListItem>> {
    return dashboardArtifactsQuery({ repository: this.repository }, query);
  }

  async dashboardArtifact(id: string, revision?: string): Promise<DashboardArtifactDetail | undefined> {
    return dashboardArtifactQuery({ repository: this.repository }, id, revision);
  }

  async dashboardArtifactHistory(keyOrId: string, query?: DashboardQuery): Promise<DashboardPage<DashboardArtifactListItem>> {
    return dashboardArtifactHistoryQuery({ repository: this.repository }, keyOrId, query);
  }

  async dashboardFacts(query?: DashboardQuery): Promise<DashboardPage<DashboardReadFactView>> {
    return dashboardFactsQuery({ repository: this.repository }, query);
  }

  async dashboardSources(query?: DashboardQuery): Promise<DashboardPage<DashboardSourceView>> {
    return dashboardSourcesQuery({ repository: this.repository }, query);
  }

  async dashboardUrlIngestions(query?: DashboardQuery): Promise<DashboardPage<DashboardUrlIngestionView>> {
    return dashboardUrlIngestionsQuery({ repository: this.repository }, query);
  }

  async dashboardCandidates(query?: DashboardQuery): Promise<DashboardPage<DashboardCandidateView>> {
    return dashboardCandidatesQuery({ repository: this.repository }, query);
  }

  async dashboardSource(id: string): Promise<DashboardSourceView | undefined> {
    return dashboardSourceQuery({ repository: this.repository }, id);
  }

  async dashboardCandidate(id: string): Promise<DashboardCandidateView | undefined> {
    return dashboardCandidateQuery({ repository: this.repository }, id);
  }

  async dashboardOperations(query?: DashboardQuery): Promise<DashboardPage<DashboardReadOperationView>> {
    return dashboardOperationsQuery({ repository: this.repository }, query);
  }

  async dashboardOperation(id: string): Promise<DashboardOperationDetail | undefined> {
    return dashboardOperationQuery({ repository: this.repository }, id);
  }

  async dashboardAudit(query?: DashboardQuery): Promise<DashboardPage<DashboardAuditView>> {
    return dashboardAuditQuery({ repository: this.repository }, query);
  }

  async dashboardIssues(query?: DashboardQuery): Promise<DashboardPage<DashboardReadIssueView>> {
    return dashboardIssuesQuery({ repository: this.repository }, query);
  }

  async dashboardReviews(query?: DashboardQuery): Promise<DashboardPage<DashboardReviewView>> {
    return dashboardReviewsQuery({ repository: this.repository }, query);
  }

  async dashboardReviewRuns(query?: DashboardQuery): Promise<DashboardPage<DashboardReviewRunView>> {
    return dashboardReviewRunsQuery({ repository: this.repository }, query);
  }

  async dashboardReviewRun(id: string): Promise<DashboardReviewRunDetail | undefined> {
    return dashboardReviewRunQuery({ repository: this.repository }, id);
  }

  async dashboardPublishes(query?: DashboardQuery): Promise<DashboardPage<DashboardPublishView>> {
    return dashboardPublishesQuery({ repository: this.repository }, query);
  }

  async dashboardBuilds(query?: DashboardQuery): Promise<DashboardPage<DashboardBuildView>> {
    return dashboardBuildsQuery({ repository: this.repository }, query);
  }

  /** @deprecated Use dashboardSummary and the resource query methods. */
  async dashboardSnapshot(): Promise<DashboardSnapshot> {
    return dashboardSnapshotQuery({ repository: this.repository });
  }

  async publishPreview(mode?: CardModeSelection): Promise<WorkflowGateResult> {
    return publishPreviewQuery({ repository: this.repository }, mode);
  }

  async publishProvenancePreview(mode?: CardModeSelection): Promise<PublishProvenancePreviewResult> {
    const state = await this.repository.read();
    const projection = computeProjectProjection(state);
    const manifest = buildRequiredArtifactManifest(state);
    const readiness = await this.buildReadiness();
    const bothReadiness = {
      both_available: readiness.both_available ?? false,
      both_blockers: readiness.both_blockers ?? [],
    };

    const modeResolution = resolveBuildModeSelection(state, mode);
    if (modeResolution.status !== "ok") {
      return {
        available: false,
        reason: modeResolution.reason ?? "MODE_SELECTION_REQUIRED",
        historical_decisions: deriveHistoricalDecisionRefs(state, undefined),
        both_readiness: bothReadiness,
      };
    }
    const effectiveMode = modeResolution.mode_selection;
    const plan = computeBuildPlan(state, effectiveMode);
    const latestAssessment = state.coverage_assessments.at(-1);
    let coverageSnapshot: CoverageSnapshot | undefined;
    if (projection.intent.is_source_adaptation) {
      if (latestAssessment === undefined || latestAssessment.pass !== "formal") {
        return {
          available: false,
          reason: "COVERAGE_ASSESSMENT_REQUIRED",
          historical_decisions: deriveHistoricalDecisionRefs(state, undefined),
          both_readiness: bothReadiness,
        };
      }
      if (!coverageAssessmentFreshness(state, latestAssessment)) {
        return {
          available: false,
          reason: "COVERAGE_ASSESSMENT_STALE",
          historical_decisions: deriveHistoricalDecisionRefs(state, undefined),
          both_readiness: bothReadiness,
        };
      }
      coverageSnapshot = buildCoverageSnapshot(state, latestAssessment, plan);
    }
    const imageIdentity = resolveCoverImageIdentity(state, manifest?.primary_character_id).identity;
    const outputPlan = derivePublishedOutputPlan(state, effectiveMode);
    const buildSnapshotHash = computeBuildSnapshotHash(state, plan, effectiveMode, coverageSnapshot, imageIdentity, outputPlan);
    const composition = buildProvenanceCompositionSummary(state, coverageSnapshot, buildSnapshotHash, undefined, imageIdentity, outputPlan);
    const fingerprint = provenanceConfirmationFingerprint(composition);
    const preparedSnapshot = buildPreparedPublishSnapshot(
      state,
      plan,
      effectiveMode,
      coverageSnapshot,
      composition,
      fingerprint,
      imageIdentity,
    );

    return {
      available: true,
      fingerprint,
      build_snapshot_hash: buildSnapshotHash,
      ...(effectiveMode === undefined ? {} : { mode_selection: effectiveMode }),
      output_plan: outputPlan,
      composition,
      historical_decisions: deriveHistoricalDecisionRefs(state, coverageSnapshot),
      prepared_snapshot: preparedSnapshot,
      both_readiness: bothReadiness,
    };
  }

  private async handleExistingProvenancePublish(
    state: ProjectState,
    existing: OperationRecord,
    input: PublishProvenanceConfirmInput,
    context: WorkspaceContext,
  ): Promise<RequestResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    if (existing.command?.type !== "provenance_publish") {
      throw new CoreError("IDEMPOTENCY_CONFLICT", `操作 "${existing.id}" 不是 provenance_publish 操作。`, true);
    }
    const payload = existing.command.payload as { fingerprint?: string; mode_selection?: string } | undefined;
    if (payload?.fingerprint !== input.fingerprint) {
      throw new CoreError("IDEMPOTENCY_CONFLICT", `此確認識別（${input.idempotency_key ?? input.operation_id ?? existing.id}）已被用於不同的發布 fingerprint。`, true);
    }
    if (input.mode_selection !== undefined && payload?.mode_selection !== input.mode_selection) {
      throw new CoreError("IDEMPOTENCY_CONFLICT", `此確認識別（${input.idempotency_key ?? input.operation_id ?? existing.id}）已被用於不同的發布模式（原模式：${payload?.mode_selection ?? "預設"}，本次請求：${input.mode_selection}）。`, true);
    }

    if (existing.status === "completed") {
      try {
        await this.recordAudit(
          existing.id,
          "request.idempotent_replay",
          { idempotency_key: input.idempotency_key ?? null, replayed: true },
          context.actor,
        );
      } catch {}
      const latestState = await this.repository.read();
      const outcome = reconstructPublishOutcome(latestState, existing, true);
      return {
        ...outcome,
        downstream_invalidation: emptyDownstreamInvalidationReport(),
      };
    }

    if (existing.status === "running" || existing.status === "resolving" || existing.status === "created" || existing.status === "partial") {
      const outcome = reconstructPublishOutcome(state, existing, true);
      return {
        ...outcome,
        summary: existing.result_summary ?? "發布操作正在處理中。",
        downstream_invalidation: emptyDownstreamInvalidationReport(),
      };
    }

    // Terminal: blocked / failed / cancelled
    const outcome = reconstructPublishOutcome(state, existing, true);
    return {
      ...outcome,
      downstream_invalidation: emptyDownstreamInvalidationReport(),
    };
  }

  async publishProvenanceConfirm(input: PublishProvenanceConfirmInput, context: WorkspaceContext): Promise<RequestResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    const before = await this.repository.read();

    const opById = input.operation_id !== undefined ? before.operations.find((item) => item.id === input.operation_id) : undefined;
    const opByKey = input.idempotency_key !== undefined ? before.operations.find((item) => item.idempotency_key === input.idempotency_key) : undefined;

    if (opById !== undefined && opByKey !== undefined && opById.id !== opByKey.id) {
      throw new CoreError("IDEMPOTENCY_CONFLICT", `operation_id "${input.operation_id}" 與 idempotency_key "${input.idempotency_key}" 指向不同的既有操作。`, true);
    }

    const existing = opById ?? opByKey;
    if (existing !== undefined) {
      return await this.handleExistingProvenancePublish(before, existing, input, context);
    }

    const modeResolution = resolveBuildModeSelection(before, input.mode_selection);
    if (modeResolution.status === "invalid") {
      throw new CoreError("BUILD_MODE_INVALID", modeResolution.question ?? "Invalid build mode selection.", true);
    }
    if (modeResolution.status === "needs_input") {
      throw new CoreError("MODE_SELECTION_REQUIRED", modeResolution.question ?? "A build mode selection is required.", true);
    }
    const effectiveMode = modeResolution.mode_selection;
    const preview = await this.publishProvenancePreview(effectiveMode);
    if (!preview.available || preview.fingerprint === undefined) {
      throw new CoreError("PROVENANCE_CONFIRMATION_STALE", `Provenance composition is not ready for confirmation: ${preview.reason ?? "unavailable"}`, true);
    }
    if (preview.fingerprint !== input.fingerprint) {
      let staleReport: ProvenanceStaleReport | undefined;
      if (input.prepared_snapshot !== undefined && preview.prepared_snapshot !== undefined) {
        staleReport = comparePreparedSnapshotDiff(input.prepared_snapshot as PreparedPublishSnapshot, preview.prepared_snapshot);
      }
      const message = staleReport?.reason ?? "Provenance composition changed after preview; please re-preview before confirming.";
      const error = new CoreError("PROVENANCE_CONFIRMATION_STALE", message, true);
      if (staleReport !== undefined) {
        (error as any).details = { changed_inputs: staleReport.changed_inputs };
      }
      throw error;
    }

    if (input.republish !== true) {
      const intentMatches = (intent: PublishIntentRecord): boolean =>
        intent.fingerprint === input.fingerprint &&
        (effectiveMode === undefined ? intent.mode_selection === undefined : intent.mode_selection === effectiveMode) &&
        (preview.output_plan === undefined
          ? intent.output_plan === undefined
          : intent.output_plan !== undefined && canonicalJson(intent.output_plan) === canonicalJson(preview.output_plan));
      const completedIntent = [...before.publish_intents].reverse().find((intent) => intentMatches(intent) && intent.status === "completed" && intent.publish_id !== undefined);
      if (completedIntent !== undefined) {
        return {
          operation_id: completedIntent.operation_id,
          intent_id: completedIntent.id,
          publish_id: completedIntent.publish_id,
          status: "completed",
          summary: "此發布已於先前完成；重複請求已回傳既有結果（idempotent replay），未建立新輸出。",
          completed: [],
          blocked: [],
          execution_kind: "replayed",
          downstream_invalidation: emptyDownstreamInvalidationReport(),
        } as RequestResult & { downstream_invalidation: DownstreamInvalidationReport; execution_kind: PublishExecutionKind; intent_id: string; publish_id: string };
      }
      const pendingIntent = [...before.publish_intents].reverse().find((intent) => intentMatches(intent) && intent.status === "pending" && intent.operation_id !== undefined);
      if (pendingIntent !== undefined) {
        const pendingOp = before.operations.find((item) => item.id === pendingIntent.operation_id);
        if (pendingOp !== undefined && pendingOp.status !== "completed" && pendingOp.status !== "failed" && pendingOp.status !== "cancelled") {
          return {
            operation_id: pendingOp.id,
            intent_id: pendingIntent.id,
            status: pendingOp.status,
            summary: "此發布正在進行中；已恢復既有操作。",
            completed: [],
            blocked: [pendingOp.id],
            execution_kind: "resumed",
            downstream_invalidation: emptyDownstreamInvalidationReport(),
          } as RequestResult & { downstream_invalidation: DownstreamInvalidationReport; execution_kind: PublishExecutionKind; intent_id: string };
        }
      }
    }

    const operationId = input.operation_id ?? internalId("operation");
    const intentId = internalId("intent");
    const syncLease: ExecutionLeaseContext = { owner: internalId("sync"), token: internalId("lease"), generation: 1 };
    const operation: OperationRecord = {
      id: operationId,
      kind: "build",
      request: "發布（provenance 已確認）",
      actor: context.actor,
      status: "resolving",
      created_at: now(),
      updated_at: now(),
      progress: [],
      command: {
        version: 1,
        type: "provenance_publish",
        payload: {
          fingerprint: input.fingerprint,
          ...(effectiveMode === undefined ? {} : { mode_selection: effectiveMode }),
        },
      },
      ...(input.idempotency_key === undefined ? { idempotency_key: intentId } : { idempotency_key: input.idempotency_key }),
      lease_owner: syncLease.owner,
      lease_token: syncLease.token,
      lease_expires_at: new Date(Date.now() + OPERATION_LEASE_MS).toISOString(),
      ...(syncLease.generation === undefined ? {} : { fencing_generation: syncLease.generation }),
      attempt: 1,
      execution_snapshot: {
        execution_agent_id: "build-provenance",
        execution_agent_role: "builder",
        initiated_by: context.actor,
        route_kind: "build",
        source_search_mode: this.sourceSearchMode,
        created_at: now(),
      },
    };

    let created: ProjectState;
    let currentState = before;
    while (true) {
      const raceById = input.operation_id !== undefined ? currentState.operations.find((item) => item.id === input.operation_id) : undefined;
      const raceByKey = input.idempotency_key !== undefined ? currentState.operations.find((item) => item.idempotency_key === input.idempotency_key) : undefined;
      if (raceById !== undefined && raceByKey !== undefined && raceById.id !== raceByKey.id) {
        throw new CoreError("IDEMPOTENCY_CONFLICT", `operation_id "${input.operation_id}" 與 idempotency_key "${input.idempotency_key}" 指向不同的既有操作。`, true);
      }
      const raceOp = raceById ?? raceByKey;
      if (raceOp !== undefined) {
        return await this.handleExistingProvenancePublish(currentState, raceOp, input, context);
      }

      try {
        created = await this.repository.commit(currentState.revision, (current) => ({
          ...current,
          operations: [...current.operations, operation],
          publish_intents: [...current.publish_intents, {
            id: intentId,
            fingerprint: input.fingerprint,
            ...(effectiveMode === undefined ? {} : { mode_selection: effectiveMode }),
            ...(preview.output_plan === undefined ? {} : { output_plan: preview.output_plan }),
            operation_id: operation.id,
            status: "pending",
            ...(input.republish === true ? { republished: true } : {}),
            created_at: now(),
            updated_at: now(),
          }],
          audit: [...current.audit, {
            id: internalId("audit"),
            operation_id: operation.id,
            event: "operation.created",
            actor: context.actor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { kind: "build", provenance_confirmation: true, mode_selection: effectiveMode ?? null },
          }],
        }));
        break;
      } catch (error) {
        if (error instanceof CoreError && error.code === "REVISION_CONFLICT") {
          currentState = await this.repository.read();
          continue;
        }
        throw error;
      }
    }

    const execution = this.executionContextFor(operation, context, { id: "build-provenance", role: "builder" }, { lease: syncLease });
    try {
      await this.repository.commit(created.revision, (current) => {
        executionLeaseGuard(current, operation.id, execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operation.id ? { ...item, status: "running", updated_at: now() } : item),
        };
      });
      const result = await this.build.run(operation.id, "發布（provenance 已確認）", execution, {
        ...(effectiveMode === undefined ? {} : { mode_selection: effectiveMode }),
        expected_provenance_fingerprint: input.fingerprint,
        ...(preview.output_plan === undefined ? {} : { expected_output_plan: preview.output_plan }),
      });
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === operation.id);
      const publishRecord = latest.publishes.find((p) => p.operation_id === operation.id);
      const buildRecord = latest.builds.find((b) => b.operation_id === operation.id);
      const completedIds = Array.from(new Set([
        ...(result.build_id === undefined ? [] : [result.build_id]),
        ...(publishRecord?.id === undefined ? [] : [publishRecord.id]),
      ]));
      const base: RequestResult = {
        operation_id: operation.id,
        status: result.status,
        summary: result.summary,
        completed: completedIds,
        blocked: result.status === "blocked" ? [operation.id] : [],
        ...(result.build_id === undefined ? {} : { build_id: result.build_id }),
        ...(publishRecord?.id === undefined ? {} : { publish_id: publishRecord.id }),
        ...(publishRecord?.created_at === undefined ? {} : { published_at: publishRecord.created_at }),
        ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        idempotent_replay: false,
      };
      if (publishRecord !== undefined) {
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          publish_intents: current.publish_intents.map((intent) =>
            intent.id === intentId ? { ...intent, status: "completed", publish_id: publishRecord.id, updated_at: now() } : intent,
          ),
        }));
      }
      const intentBase = {
        ...base,
        execution_kind: (input.republish === true ? "republished" : "new") as PublishExecutionKind,
        intent_id: intentId,
      };
      return this.attachDownstreamInvalidation(intentBase, before);
    } finally {
      await this.releaseOperationLease(operation.id, syncLease.owner, syncLease.token);
    }
  }

  async dashboardProvenance(): Promise<DashboardProvenanceView> {
    const state = await this.repository.read();
    const latestBuild = [...state.builds].reverse().find((build) => build.status === "previewed" || build.status === "built");
    if (latestBuild === undefined || latestBuild.provenance_summary === undefined) {
      return { historical_decisions: deriveHistoricalDecisionRefs(state, undefined), legacy_build_snapshot_hash: false };
    }
    return {
      build_id: latestBuild.id,
      build_status: latestBuild.status,
      provenance_summary: latestBuild.provenance_summary,
      historical_decisions: deriveHistoricalDecisionRefs(state, latestBuild.coverage_snapshot),
      legacy_build_snapshot_hash: latestBuild.provenance_summary.compiled_content_hash === undefined,
      ...(latestBuild.provenance_summary.compiled_content_hash === undefined ? {} : { compiled_content_hash: latestBuild.provenance_summary.compiled_content_hash }),
      ...(latestBuild.provenance_summary.build_snapshot_hash === undefined ? {} : { build_snapshot_hash: latestBuild.provenance_summary.build_snapshot_hash }),
    };
  }

  async buildReadiness(): Promise<DashboardBuildReadiness> {
    return buildReadinessQuery({ repository: this.repository });
  }

  async publishCompletion(publishId: string): Promise<PublishCompletionView | undefined> {
    const state = await this.repository.read();
    const publish = state.publishes.find((record) => record.id === publishId);
    if (publish === undefined) return undefined;
    const intent = state.publish_intents.find((record) => record.publish_id === publishId);
    const outputPlan = publish.output_plan;
    const entries: Array<{ kind: "json" | "png"; ref: { hash: string; size: number } | undefined; path: string | undefined }> = [
      { kind: "json", ref: publish.content_ref, path: outputPlan?.json_path ?? publish.export_json_path },
      { kind: "png", ref: publish.png_ref, path: outputPlan?.png_path ?? publish.export_png_path },
    ];
    const files: PublishCompletionView["files"] = [];
    for (const entry of entries) {
      let status: "verified" | "missing" | "hash_mismatch" = "missing";
      let size = 0;
      let contentHashValue = "";
      if (entry.ref !== undefined) {
        size = entry.ref.size;
        contentHashValue = entry.ref.hash;
        const blob = await this.repository.readBlob(entry.ref.hash);
        if (blob !== undefined) {
          status = blob.length === entry.ref.size && contentHash(blob) === entry.ref.hash ? "verified" : "hash_mismatch";
        }
      }
      files.push({
        kind: entry.kind,
        ...(entry.path === undefined ? {} : { path: entry.path }),
        ...(entry.path === undefined ? {} : { name: entry.path.split("/").pop() ?? "card" }),
        size,
        content_hash: contentHashValue,
        status,
      });
    }
    return {
      publish_id: publish.id,
      operation_id: publish.operation_id,
      published_at: publish.created_at,
      mode: outputPlan?.mode ?? "default",
      ...(publish.provenance_summary?.image_identity === undefined ? {} : { cover: publish.provenance_summary.image_identity }),
      files,
      result_kind: intent === undefined ? "legacy" : intent.republished === true ? "republished" : "new",
    };
  }

  async publishDownload(publishId: string, kind: "json" | "png"): Promise<PublishDownloadResult> {
    const state = await this.repository.read();
    const publish = state.publishes.find((record) => record.id === publishId);
    if (publish === undefined) throw new CoreError("PUBLISH_NOT_FOUND", `Publish record ${publishId} was not found.`, true);
    const ref = kind === "json" ? publish.content_ref : publish.png_ref;
    const path = kind === "json" ? publish.output_plan?.json_path ?? publish.export_json_path : publish.output_plan?.png_path ?? publish.export_png_path;
    if (ref === undefined || path === undefined) {
      throw new CoreError("PUBLISH_DOWNLOAD_LEGACY", "此發布為舊版記錄，缺少可下載的檔案參照。", true);
    }
    if (!path.startsWith("exports/") || path.includes("../") || path.includes("..\\") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/u.test(path)) {
      throw new CoreError("PUBLISH_DOWNLOAD_PATH_INVALID", "發布輸出路徑無效；已拒絕下載。", true);
    }
    const blob = await this.repository.readBlob(ref.hash);
    if (blob === undefined) {
      throw new CoreError("PUBLISH_DOWNLOAD_MISSING", `發布輸出檔案（${path}）目前不存在。`, true);
    }
    if (blob.length !== ref.size || contentHash(blob) !== ref.hash) {
      throw new CoreError("PUBLISH_DOWNLOAD_HASH_MISMATCH", `發布輸出檔案（${path}）內容與發布記錄不符；已拒絕下載。`, true);
    }
    return {
      media_type: kind === "json" ? "application/json" : "image/png",
      filename: path.split("/").pop() ?? "card",
      content: blob,
    };
  }

  async tavernCompat(): Promise<TavernCompatibilityReport> {
    return tavernCompatQuery({ repository: this.repository });
  }

  async repairPreview(): Promise<RepairInspection> {
    return repairPreviewQuery({ repository: this.repository });
  }

  async repairRun(planHash?: string): Promise<RepairReport> {
    return repairRunQuery({ repository: this.repository }, planHash);
  }

  async factReviewContext(options?: { cursor?: string; limit?: number; source_id?: string; classification?: FactClassification; reviewer_identity?: string }): Promise<FactReviewContext> {
    return factReviewContextQuery({ repository: this.repository, knowledge: this.knowledge }, options);
  }

  private async requirementSetFor(state: Awaited<ReturnType<ProjectRepository["read"]>>): Promise<CoverageRequirementSet> {
    const latest = state.coverage_requirement_sets.at(-1);
    if (latest !== undefined) return latest;
    return buildDefaultRequirementSet(state, "system");
  }

  async coverageRequirementSet(): Promise<CoverageRequirementSet> {
        const state = await this.repository.read();
    return this.requirementSetFor(state);
  }

  async coverageAssessment(pass: "initial" | "formal"): Promise<{ assessment: CoverageAssessment; requirement_set: CoverageRequirementSet; current: boolean; downstream_invalidation: DownstreamInvalidationReport }> {
    const before = await this.repository.read();
    const result = await this.coverageAssessmentImpl(pass);
    return this.attachDownstreamInvalidation(result, before);
  }

  private async coverageAssessmentImpl(pass: "initial" | "formal"): Promise<{ assessment: CoverageAssessment; requirement_set: CoverageRequirementSet; current: boolean }> {
    const state = await this.repository.read();
    const requirementSet = await this.requirementSetFor(state);
    const operationId = internalId("operation");
    const assessment = pass === "initial"
      ? runInitialCoverageAssessment(state, requirementSet, operationId, "system")
      : runFormalCoverageAssessment(state, requirementSet, operationId, "system");
    const current = coverageAssessmentFreshness(state, assessment);
    await this.repository.commit(state.revision, (currentState) => ({
      ...currentState,
      coverage_requirement_sets: currentState.coverage_requirement_sets.some((set) => set.id === requirementSet.id)
        ? currentState.coverage_requirement_sets
        : [...currentState.coverage_requirement_sets, requirementSet],
      coverage_assessments: [...currentState.coverage_assessments, assessment],
      audit: [...currentState.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "coverage.assessment.recorded",
        actor: "system",
        occurred_at: now(),
        project_revision: currentState.revision + 1,
        details: { pass, assessment_id: assessment.id, assessment_revision: assessment.revision, requirement_set_revision: requirementSet.revision },
      }],
    }));
    return { assessment, requirement_set: requirementSet, current };
  }

  async coverageResearchStart(actor: string, assessmentId?: string, assessmentRevision?: string, scope?: import("@st-workspace/core").CoverageResearchStartScope, operationId?: string): Promise<Record<string, unknown>> {
    return coverageResearchStartQuery(this.coverageDeps(), actor, assessmentId, assessmentRevision, scope, operationId);
  }

  async coverageResearchStartPreview(input: import("@st-workspace/domain").CoverageResearchStartPreviewInput): Promise<Record<string, unknown>> {
    return coverageResearchStartPreviewQuery(this.coverageDeps(), input);
  }

  async coverageResearchClaim(actor: string, batchId: string, leaseDurationMs?: number): Promise<Record<string, unknown>> {
    return coverageResearchClaimQuery(this.coverageDeps(), actor, batchId, leaseDurationMs);
  }

  async coverageResearchCandidates(actor: string, taskId: string, claimGeneration: number, leaseOwner: string, candidates: Array<{ title: string; url?: string | undefined; canonical_url?: string | undefined; snippet?: string | undefined; domain?: string | undefined; official?: boolean | undefined; target_requirement_ids?: string[] | undefined }>): Promise<Record<string, unknown>> {
    return coverageResearchCandidatesQuery(this.coverageDeps(), actor, taskId, claimGeneration, leaseOwner, candidates);
  }

  async coverageResearchExhaust(actor: string, taskId: string, claimGeneration: number, leaseOwner: string, searchedQueries: string[], sourceFamilies: string[], exhaustedReason: string): Promise<Record<string, unknown>> {
    return coverageResearchExhaustQuery(this.coverageDeps(), actor, taskId, claimGeneration, leaseOwner, searchedQueries, sourceFamilies, exhaustedReason);
  }

  async coverageResolutionPreview(input: CoverageResolutionPreviewInput): Promise<import("@st-workspace/domain").ResolutionConsequencesPreview> {
    return coverageResolutionPreviewQuery(this.coverageDeps(), input);
  }

  async coverageResolutionConfirm(actor: string, input: CoverageResolutionConfirmInput): Promise<Record<string, unknown>> {
    return coverageResolutionConfirmQuery(this.coverageDeps(), actor, input);
  }

  async coverageSupplement(actor: string, input: Omit<CoverageSupplementInput, "attachments">, attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>): Promise<Record<string, unknown>> {
    return coverageSupplementQuery(this.coverageDeps(), actor, input, attachments);
  }

  async coverageResearchRecover(actor: string, input: Omit<CoverageResearchRecoverInput, "attachments">, attachments: Array<{ name: string; content: Uint8Array; media_type?: string }> = []): Promise<Record<string, unknown>> {
    return coverageResearchRecoverQuery(this.coverageDeps(), actor, input, attachments);
  }

  async coverageUrlIngestionRecover(actor: string, input: CoverageUrlIngestionRecoverInput): Promise<Record<string, unknown>> {
    return coverageUrlIngestionRecoverQuery(this.coverageDeps(), actor, input);
  }

  async dashboardCoverage(): Promise<Record<string, unknown>> {
    return dashboardCoverageQuery(this.coverageDeps());
  }

  async dashboardCoverageCenter(): Promise<{ matrix: CoverageCenterMatrix; monitor: ResearchMonitor; url_ingestions: DashboardPage<DashboardUrlIngestionView> }> {
    return dashboardCoverageCenterQuery(this.coverageDeps());
  }

  async dashboardArtifactLineage(artifactId: string): Promise<ArtifactCoverageLineage | undefined> {
    const state = await this.repository.read();
    return deriveArtifactCoverageLineage(state, artifactId);
  }

  async dashboardPublishDiagnostics(): Promise<StructuredPublishDiagnostics> {
    const state = await this.repository.read();
    return deriveStructuredPublishDiagnostics(validateWorkflow(state, "publish").diagnostics);
  }

  async dashboardFactReviewEvidence(options?: { cursor?: string; limit?: number; source_id?: string; classification?: FactClassification; reviewer_identity?: string }): Promise<FactReviewContext> {
    const context = await factReviewContextQuery({ repository: this.repository, knowledge: this.knowledge }, options);
    const state = await this.repository.read();
    return {
      ...context,
      candidates: context.candidates.map((candidate) => ({
        ...candidate,
        evidence_ref_stale: (candidate.evidence_refs ?? []).map((reference) => ({
          ref: reference,
          ...deriveEvidenceReferenceStale(state, reference),
        })),
        ...(candidate.evidence_context === undefined ? {} : { evidence_context: deriveEvidenceContextViews(state, candidate.evidence_context) }),
      })),
    };
  }

  async reextract(operationId: string, sourceIds: readonly string[], actor: string, extractorRevision?: string): Promise<KnowledgeExecutionResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    const before = await this.repository.read();
    const result = await reextractQuery({ repository: this.repository, knowledge: this.knowledge }, operationId, sourceIds, actor, extractorRevision);
    return this.attachDownstreamInvalidation(result, before);
  }

  async startFactReviewRun(actor: string): Promise<FactReviewRunRecord> {
    const before = await this.repository.read();
    const result = await startFactReviewRunQuery({ repository: this.repository, knowledge: this.knowledge }, actor);
    return this.attachDownstreamInvalidation(result, before);
  }

  async applyFactReviewBatch(
    decisions: FactDecision[],
    actor: string,
    reviewerIdentity?: string,
    reviewRunId?: string,
    expectedProjectionRevision?: string,
  ): Promise<FactReviewExecutionResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    const before = await this.repository.read();
    const result = await applyFactReviewBatchQuery({ repository: this.repository, knowledge: this.knowledge }, decisions, actor, reviewerIdentity, reviewRunId, expectedProjectionRevision);
    return this.attachDownstreamInvalidation(result, before);
  }

  async resolveFactConflict(
    decisions: FactDecision[],
    actor: string,
    reviewRunId?: string,
    expectedProjectionRevision?: string,
  ): Promise<FactReviewExecutionResult & { downstream_invalidation: DownstreamInvalidationReport }> {
    const before = await this.repository.read();
    const result = await resolveFactConflictQuery({ repository: this.repository, knowledge: this.knowledge }, decisions, actor, reviewRunId, expectedProjectionRevision);
    return this.attachDownstreamInvalidation(result, before);
  }

  async setProjectImage(context: WorkspaceContext, options: { character_id?: string; aspect_ratio?: string; source?: string; license?: string } = {}): Promise<{ image_id: string; width: number; height: number }> {
    if (context.attachments.length !== 1) throw new CoreError("CARD_IMAGE_REQUIRED", "角色圖需要剛好一張 PNG 附件", true, { received: context.attachments.length });
    const attachment = context.attachments[0]!;
    const content = Buffer.from(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength);

    let processed = content;
    let aspectRatio: string | undefined;
    let crop: { width: number; height: number; offset_x: number; offset_y: number } | undefined;
    let info;
    try {
      info = validatePngImage(processed, { maxDimension: CARD_IMAGE_MAX_DIMENSION });
      if (options.aspect_ratio !== undefined) {
        aspectRatio = options.aspect_ratio;
        const cropped = cropPngCover(processed, aspectRatio);
        const croppedInfo = readPngImageInfo(cropped);
        if (croppedInfo === undefined) throw new CoreError("CARD_IMAGE_DECODE_FAILED", "角色圖裁切後無法讀取", true);
        crop = {
          width: croppedInfo.width,
          height: croppedInfo.height,
          offset_x: info.width === croppedInfo.width ? 0 : Math.max(0, Math.floor((info.width - croppedInfo.width) / 2)),
          offset_y: info.height === croppedInfo.height ? 0 : Math.max(0, Math.floor((info.height - croppedInfo.height) / 2)),
        };
        processed = cropped;
        info = croppedInfo;
      }
    } catch (error) {
      if (error instanceof PngFormatError) {
        const code = error.code === "PNG_SIGNATURE_INVALID" ? "CARD_IMAGE_REQUIRED" : error.code;
        throw new CoreError(code, error.message, true);
      }
      throw error;
    }

    const blobHash = contentHash(processed);
    await this.repository.writeBlob(blobHash, processed);
    const now = new Date().toISOString();
    const id = internalId("image");
    const state = await this.repository.read();
    if (options.character_id !== undefined && options.character_id.trim().length > 0) {
      const roster = blueprintRosterIds(state);
      if (roster !== undefined && !roster.has(options.character_id.trim())) {
        throw new CoreError("IMAGE_CHARACTER_NOT_IN_ROSTER", `角色 ${options.character_id} 不在目前 Blueprint 的角色名單中；請確認角色 ID 或先更新 Blueprint。`, true);
      }
    }
    await this.repository.commit(state.revision, (current) => {
      return {
        ...current,
        images: [...current.images, {
          id,
          ...(options.character_id === undefined ? {} : { character_id: options.character_id }),
          blob_hash: blobHash,
          media_type: "image/png",
          width: info.width,
          height: info.height,
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(crop === undefined ? {} : { crop }),
          ...(options.source === undefined ? {} : { source: options.source }),
          ...(options.license === undefined ? {} : { license: options.license }),
          created_at: now,
          updated_at: now,
          ...(context.actor === undefined ? {} : { created_by: context.actor }),
        }],
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: "console",
          event: "image.updated",
          actor: context.actor ?? "worker",
          occurred_at: now,
          project_revision: current.revision + 1,
          details: { action: "added", image_id: id, ...(options.character_id === undefined ? {} : { character_id: options.character_id }), width: info.width, height: info.height },
        }],
      };
    });
    return { image_id: id, width: info.width, height: info.height };
  }

  async getProjectImage(imageId: string): Promise<{ media_type: string; content: Uint8Array } | undefined> {
    const state = await this.repository.read();
    const image = state.images.find((item) => item.id === imageId);
    if (image === undefined) return undefined;
    const content = await this.repository.readBlob(image.blob_hash);
    if (content === undefined) return undefined;
    return { media_type: image.media_type, content };
  }

  async removeProjectImage(imageId: string, actor: string = "worker"): Promise<boolean> {
    const state = await this.repository.read();
    const image = state.images.find((item) => item.id === imageId);
    if (image === undefined) return false;
    const activeSelection = state.cover_selections.find((item) => item.supersedes === undefined);
    const supersedeSelection = activeSelection !== undefined && activeSelection.image_id === imageId;
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      images: current.images.filter((item) => item.id !== imageId),
      ...(supersedeSelection
        ? {
            cover_selections: [...current.cover_selections, {
              id: internalId("cover"),
              image_id: imageId,
              placeholder: false,
              created_by: actor,
              created_at: now(),
              supersedes: activeSelection!.id,
            }],
          }
        : {}),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: "console",
        event: "image.updated",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { action: "removed", image_id: imageId, ...(image.character_id === undefined ? {} : { character_id: image.character_id }) },
      }],
    }));
    return true;
  }

  async setProjectCover(actor: string = "worker", input: { image_id?: string; placeholder?: boolean } = {}): Promise<{ cover_selection_id: string }> {
    const state = await this.repository.read();
    const wantsPlaceholder = input.placeholder === true || input.image_id === undefined;
    let imageId: string | undefined = wantsPlaceholder ? undefined : input.image_id;
    if (!wantsPlaceholder && imageId !== undefined) {
      const image = state.images.find((item) => item.id === imageId);
      if (image === undefined) throw new CoreError("IMAGE_NOT_FOUND", `Image ${imageId} does not exist.`, true);
    }
    const activeSelection = state.cover_selections.find((item) => item.supersedes === undefined);
    const selectionId = internalId("cover");
    const selection = {
      id: selectionId,
      ...(imageId === undefined ? {} : { image_id: imageId }),
      placeholder: imageId === undefined,
      created_by: actor,
      created_at: now(),
      ...(activeSelection === undefined ? {} : { supersedes: activeSelection.id }),
    };
    await this.repository.commit(state.revision, (current) => ({
      ...current,
      cover_selections: [...current.cover_selections, selection],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: "console",
        event: "cover.selection.updated",
        actor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { selection_id: selectionId, ...(imageId === undefined ? { placeholder: true } : { image_id: imageId }) },
      }],
    }));
    return { cover_selection_id: selectionId };
  }

  private async resumePendingIfAnswered(pending: OperationRecord, trimmed: string, context: WorkspaceContext, kind: string): Promise<RequestResult | undefined> {
    const pendingIdentity = this.resolveExecutionContext(pending);
    const execution = this.executionContextFor(pending, context, { id: pendingIdentity.agent_id, role: pendingIdentity.agent_role });
    await this.assertExecutionLease(execution);
    if (pending.kind === "source" && (context.attachments.length > 0 || /重試|retry|上傳|貼上|https?:\/\//iu.test(trimmed))) {
      const sourceContext = this.fetcher === undefined
        ? { ...context, actor: execution.auditActor, execution }
        : { ...context, actor: execution.auditActor, fetcher: this.fetcher, execution };
      const resumed = await this.sources.resume(pending.id, trimmed, sourceContext);
      return { operation_id: pending.id, status: resumed.status, summary: resumed.summary, completed: resumed.completed, blocked: resumed.blocked };
    }
    if (pending.kind === "build" && pending.command?.type === "provenance_publish") {
      const payload = pending.command.payload as { fingerprint: string; mode_selection?: CardModeSelection };
      const resumed = await this.build.run(pending.id, pending.request, execution, {
        ...(payload.mode_selection === undefined ? {} : { mode_selection: payload.mode_selection }),
        expected_provenance_fingerprint: payload.fingerprint,
      });
      const latest = await this.repository.read();
      const finalOperation = latest.operations.find((item) => item.id === pending.id);
      return {
        operation_id: pending.id,
        status: resumed.status,
        summary: resumed.summary,
        completed: resumed.build_id === undefined ? [] : [resumed.build_id],
        blocked: resumed.status === "blocked" ? [pending.id] : [],
        ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
      };
    }
    if (pending.kind === "build" && /模式|珠璣|調色盤|zhuji|palette/iu.test(pending.question ?? "")) {
      const pendingBuildMode = parseBuildModeSelection(trimmed);
      if (pendingBuildMode !== undefined) {
        const resumed = await this.build.run(pending.id, pending.request, execution, { mode_selection: pendingBuildMode });
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: resumed.status,
          summary: resumed.summary,
          completed: resumed.build_id === undefined ? [] : [resumed.build_id],
          blocked: resumed.status === "blocked" ? [pending.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
        };
      }
      if (/不需要|先不要|不用了|skip|defer|之後再|後續/iu.test(trimmed)) {
        const latest = await this.repository.read();
        await this.repository.commit(latest.revision, (current) => ({
          ...current,
          operations: current.operations.map((item) => item.id === pending.id ? { ...item, status: "completed", result_summary: "使用者略過本次打包。", updated_at: now() } : item),
        }));
        return { operation_id: pending.id, status: "completed", summary: "已略過本次打包。", completed: [], blocked: [] };
      }
      if (kind === "unknown") {
        return {
          operation_id: pending.id,
          status: "needs_input",
          summary: pending.question ?? "請選擇本次打包要使用的模式：珠璣、調色盤，或兩者。",
          completed: [],
          blocked: [],
          ...(pending.question === undefined ? {} : { question: pending.question }),
        };
      }
      return undefined;
    }
    if (kind === "unknown") {
      if (pending.kind === "knowledge") {
        const pendingOperation = (await this.repository.read()).operations.find((item) => item.id === pending.id) ?? pending;
        const result = await this.executeKnowledgeRequest({ ...pendingOperation, request: trimmed }, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return { operation_id: pending.id, status: result.status, summary: result.summary, completed: [...result.chunks, ...result.facts], blocked: [], ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }) };
      }
      if (pending.kind === "authoring") {
        const result = await this.authoring.create(pending.id, trimmed, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.artifact_id === undefined ? [] : [result.artifact_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: execution.executionAgent.id,
          agent_role: execution.executionAgent.role,
        };
      }
      if (pending.kind === "review") {
        const result = /重新評估|re-?evaluate|quality profile/iu.test(trimmed)
          ? await this.review.reevaluate(pending.id, execution)
          : await this.review.review(pending.id, trimmed, execution);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.review_id === undefined ? [] : [result.review_id],
          blocked: result.status === "blocked" ? [pending.id] : [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          agent_id: execution.executionAgent.id,
          agent_role: execution.executionAgent.role,
        };
      }
      if (pending.kind === "import" && context.attachments.length > 0) {
        const result = await this.importer.run(pending.id, trimmed, execution, context.attachments);
        const latest = await this.repository.read();
        const finalOperation = latest.operations.find((item) => item.id === pending.id);
        return {
          operation_id: pending.id,
          status: result.status,
          summary: result.summary,
          completed: result.import_id === undefined ? [] : [result.import_id],
          blocked: [],
          ...(finalOperation?.question === undefined ? {} : { question: finalOperation.question }),
          ...(result.artifact_id === undefined ? {} : { artifact_id: result.artifact_id }),
        };
      }
    }
    return undefined;
  }

  private async ensureBlueprintAuthoringReady(kind: "zhuji" | "palette", characterId: string, module: string): Promise<void> {
    // The low-level template endpoints remain usable for isolated authoring and
    // migration fixtures. The Blueprint-first contract is enforced for the
    // interview-backed workspace runtime only.
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    if (blueprint === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，確認後才能開始珠璣或調色盤模組創作。", true);
    }
    const blueprintValue = (() => {
      try {
        return objectValue(JSON.parse(blueprint.content));
      } catch {
        return undefined;
      }
    })();
    const roster = Array.isArray(blueprintValue?.characters) ? blueprintValue.characters : [];
    const rosterEntry = roster.find((entry) => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === characterId);
    if (rosterEntry === undefined) {
      throw new CoreError(
        "BLUEPRINT_CHARACTER_NOT_IN_ROSTER",
        `角色 ${characterId} 不在目前 Blueprint 的角色名單中；請確認角色 ID 或先更新 Blueprint。`,
        true,
      );
    }
    const rosterMode = (rosterEntry as { mode?: unknown }).mode;
    const blueprintMode: "zhuji" | "palette" | undefined = rosterMode === "zhuji" ? "zhuji" : rosterMode === "palette" ? "palette" : undefined;
    if (blueprintMode === undefined) {
      throw new CoreError(
        "BLUEPRINT_CHARACTER_MODE_INVALID",
        `角色 ${characterId} 在 Blueprint 中沒有宣告模式（zhuji/palette）。`,
        true,
      );
    }
    if (kind !== blueprintMode) {
      throw new CoreError(
        "BLUEPRINT_MODE_MISMATCH",
        `角色 ${characterId} 在 Blueprint 中的模式是 ${blueprintMode === "zhuji" ? "珠璣" : "調色盤"}，無法提交 ${kind === "zhuji" ? "珠璣" : "調色盤"} 模組。`,
        true,
      );
    }
    const order: readonly string[] = kind === "zhuji" ? ZHUJI_MODULE_ORDER : PALETTE_MODULE_ORDER;
    const index = order.indexOf(module);
    if (index < 0) return;
    const existing = parsedModeModules(state, kind, characterId);
    const missing = order.slice(0, index).filter((required) => !existing.has(required));
    if (missing.length > 0) {
      throw new CoreError(
        "AUTHORING_PREVIOUS_MODULE_REQUIRED",
        `請先完成前置模組：${missing.join("、")}，再建立 ${module}。`,
        true,
      );
    }
  }

  private ensureSourceAdaptationFactsReady(state: ProjectState): void {
    if (!this.interviewRequired || !isSourceAdaptationProject(state) || sourceFactsReady(state)) return;
    throw new CoreError(
      "SOURCE_FACTS_REQUIRED",
      "原作改編必須先完成來源搜尋、來源擷取、事實提取與固定 Review Run 的嚴格裁決，才能開始世界設定或角色創作。",
      true,
    );
  }

  private async ensureWardrobeAuthoringReady(characterId: string): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    if (blueprint === undefined) {
      throw new CoreError("BLUEPRINT_REQUIRED", "請先完成並保存 Blueprint，確認後才能建立衣櫃。", true);
    }
    const hasCharacterSettings = latestByKey(state).some((artifact) => {
      if (artifact.kind !== "zhuji" && artifact.kind !== "palette") return false;
      try {
        const value = JSON.parse(artifact.content) as { character_id?: unknown };
        return value.character_id === characterId;
      } catch {
        return false;
      }
    });
    if (!hasCharacterSettings) {
      throw new CoreError("CHARACTER_SETTINGS_REQUIRED", "請先完成至少一個珠璣或調色盤角色設定模組，再建立衣櫃。", true);
    }
  }

  private async ensureWorldAuthoringOrder(kind: ArtifactKind): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    const workflowBacked = state.interview.status === "complete" || ["ready", "published"].includes(state.project_status);
    if (!workflowBacked) return;
    const latestRecordedPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
    const blueprint = [...state.artifacts].reverse().find((artifact) => artifact.kind === "blueprint"
      && (latestRecordedPrecheck === undefined || artifact.blueprint_precheck_id === latestRecordedPrecheck.id));
    const world = blueprint === undefined ? undefined : (() => {
      try {
        return objectValue(JSON.parse(blueprint.content)?.world);
      } catch {
        return undefined;
      }
    })();
    if (world?.enabled !== true) return;
    const timing = typeof world.authoring_timing === "string" && world.authoring_timing.length > 0 ? world.authoring_timing : "before_characters";
    const characterKinds: readonly ArtifactKind[] = ["character", "zhuji", "palette", "wardrobe"];
    const hasWorldLore = latestByKey(state).some((artifact) => artifact.kind === "world_lore");
    const hasCharacterSide = latestByKey(state).some((artifact) => characterKinds.includes(artifact.kind));
    if (timing === "before_characters") {
      if (characterKinds.includes(kind) && !hasWorldLore) {
        throw new CoreError("WORLD_AUTHORING_ORDER", "世界設定需在角色創作之前完成；請先建立世界設定。", true);
      }
      return;
    }
    if (timing === "after_characters" && kind === "world_lore" && !hasCharacterSide) {
      throw new CoreError("CHARACTER_AUTHORING_ORDER", "角色創作需在世界設定之前完成；請先建立角色設定。", true);
    }
  }

  private async ensureInterviewComplete(): Promise<void> {
    if (!this.interviewRequired) return;
    const state = await this.repository.read();
    if ((state.project_status === "uninitialized" || state.project_status === "interviewing") && state.interview.status !== "complete") {
      throw new CoreError("INTERVIEW_REQUIRED", state.interview.current?.text ?? "請先完成專案訪談。", true);
    }
    const pendingPrecheck = [...state.blueprint_prechecks].reverse().find((item) => item.status === "needs_input");
    if (pendingPrecheck !== undefined) {
      throw new CoreError("BLUEPRINT_PRECHECK_REQUIRED", "Blueprint precheck needs a short confirmation before authoring can continue.", true);
    }
  }
}

export { AgentAdapter, type AgentRequest } from "./agent-adapter.js";
export { AgentRegistry, AGENT_ALIASES, AGENT_DEFINITIONS, type AgentDefinition, type AgentRole } from "./agent-registry.js";
export { AgentRouter, classifyIntent, type AgentResolution } from "./agent-router.js";
export { WorkspaceWorker, type WorkspaceRuntimeProvider, type WorkspaceWorkerEvent, type WorkspaceWorkerOptions, type WorkspaceWorkerStatus } from "./worker.js";
export { WorkspaceProjectManager, type WorkspaceProjectManagerOptions, type WorkspaceProjectSummary } from "./project-manager.js";
