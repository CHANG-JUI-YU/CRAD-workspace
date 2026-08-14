import {
  contentHash,
  CoreError,
  internalId,
  type OperationRecord,
  type ProjectRepository,
  type SourceAttachment,
  type SourceCandidate,
  type SourceSelectionSnapshot,
  type SourceRecord,
  type ExecutionContext,
} from "@st-workspace/core";
import { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";
import { canonicalizeSource, canonicalizeSourceUrl, extractSourceUrl } from "./source-canonicalizer.js";
import { assertResearchCapability } from "./research-orchestration.js";

export { canonicalizeSource, canonicalizeSourceUrl, extractSourceUrl } from "./source-canonicalizer.js";

export { AuthoringService, createCoverageBindingForArtifact, type AuthoringExecutionResult, inferAuthoringKind } from "./authoring.js";
export { BuildService, type BuildExecutionResult } from "./build.js";
export { ConversionService, type ConversionExecutionResult } from "./conversion.js";
export { ImportService, type ImportExecutionResult } from "./import.js";
export { KnowledgeService, deriveReviewRunStatusAndResponse, getTaskBoundChunksAndHints, reviewRunProjectionRevision, type FactReviewExecutionResult, type FactReviewRunExecutionResult, type KnowledgeExecutionResult, type TaskBoundChunksAndHintsResult } from "./knowledge.js";
export { validateCurationClaims } from "./fact-curation-service.js";
export {
  buildCoverageSnapshot,
  buildDefaultRequirementSet,
  coverageAssessmentFreshness,
  currentResolutions,
  deriveArtifactCoverageScope,
  deriveArtifactScopeResolutionIds,
  deriveCoverageReadiness,
  deriveCoverageRequirementExplanations,
  fulfillUserSupplementResolution,
  isCoverageSensitiveArtifactKind,
  isCurrentResolution,
  previewResolutionConsequences,
  projectActiveCoverageBindings,
  recordUserDecisionAndResolution,
  requirementsResolved,
  runFormalCoverageAssessment,
  runInitialCoverageAssessment,
  sourceFactsReady,
  type ActiveCoverageBindingProjection,
  type ArtifactCoverageScope,
  type CoverageBlocker,
  type ResolutionConsequencesPreview,
} from "./coverage-assessment.js";

export * from "./research-orchestration.js";
export { ReviewService, type IssueUpdateAction, type IssueUpdateInput, type IssueUpdateResult, type ReviewExecutionResult } from "./review.js";
export { validateWorkflow, type WorkflowDiagnostic, type WorkflowGatePhase, type WorkflowGateResult } from "./workflow-gate.js";
export {
  deriveDownstreamInvalidation,
  deriveProjectInvalidations,
  emptyDownstreamInvalidationReport,
  type DownstreamInvalidationItem,
  type DownstreamInvalidationReport,
  type DownstreamInvalidationSource,
  type DownstreamInvalidationSourceKind,
  type DownstreamInvalidationTargetKind,
} from "./downstream-invalidation.js";
export {
  SOURCE_ADAPTATION_WORKFLOW_STAGES,
  deriveSourceAdaptationWorkflow,
  type SourceAdaptationWorkflowModel,
  type SourceAdaptationWorkflowStage,
  type SourceAdaptationWorkflowStageId,
  type SourceAdaptationWorkflowStageStatus,
  type WorkflowStageBlocker,
} from "./source-adaptation-workflow.js";
export { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput, type ResolvedExecutionActors } from "./execution-context.js";
export {
  deriveStructuredPublishDiagnostics,
  type PublishDiagnosticAffected,
  type PublishDiagnosticAffectedKind,
  type PublishDiagnosticRow,
  type PublishDiagnosticTarget,
  type StructuredPublishDiagnostics,
} from "./publish-diagnostics.js";
export {
  coverageAssessmentIsFresh,
  deriveCoverageCenterMatrix,
  deriveResearchMonitor,
  type CoverageCenterCell,
  type CoverageCenterCellStatus,
  type CoverageCenterMatrix,
  type CoverageCenterResolutionRef,
  type CoverageCenterTaskRef,
  type ResearchMonitor,
  type ResearchMonitorBatchView,
  type ResearchMonitorTaskView,
} from "./coverage-center.js";
export {
  deriveArtifactCoverageLineage,
  type ArtifactBindingState,
  type ArtifactCoverageLineage,
} from "./artifact-lineage.js";
export {
  deriveEvidenceContextViews,
  deriveEvidenceReferenceStale,
  type EvidenceContextView,
} from "./evidence-context.js";
export { deriveSummaryKPIs, type SummaryKPIs } from "./summary-kpis.js";
export {
  PALETTE_REQUIRED_MODULES,
  ZHUJI_REQUIRED_MODULES,
  buildRequiredArtifactManifest,
  manifestBindingHash,
  type CardMode,
  type ManifestCardModeSelection,
  type ManifestCharacterRequirement,
  type ManifestDiagnostic,
  type ManifestFeatureRequirement,
  type RequiredArtifactManifest,
} from "./required-artifacts.js";

export * from "./inputs.js";
export { chunkSource, KNOWLEDGE_EXTRACTOR_REVISION } from "./source-chunking.js";

export interface FetchResult {
  content: Uint8Array;
  media_type?: string;
  final_url?: string;
  name?: string;
}

export type SourceFetcher = (url: string) => Promise<FetchResult>;

export interface SourceExecutionContext {
  attachments: SourceAttachment[];
  actor: string;
  fetcher?: SourceFetcher;
  execution?: ExecutionContext;
}

export interface SourceExecutionResult {
  completed: string[];
  blocked: string[];
  summary: string;
  status: "completed" | "partial" | "needs_input";
}

export interface SourceSelectionDecision {
  candidate_id: string;
  decision: "approve" | "reject";
}

export interface SourceSelectionResult {
  approved: string[];
  rejected: string[];
  summary: string;
  status: "completed" | "needs_input";
}

export interface CandidateSearchResult {
  title: string;
  url?: string;
  snippet?: string;
  content?: string;
  media_type?: string;
  domain?: string;
  official?: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function attachmentFor(candidate: SourceCandidate, attachments: SourceAttachment[]): SourceAttachment | undefined {
  const title = candidate.title.toLocaleLowerCase();
  return attachments.find((attachment) => attachment.name.toLocaleLowerCase().includes(title))
    ?? (attachments.length === 1 ? attachments[0] : undefined);
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function sourceResearchPolicy(state: Awaited<ReturnType<ProjectRepository["read"]>>): string[] {
  const latest = [...state.artifacts].reverse().find((artifact) => artifact.kind === "source_research");
  if (latest === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(latest.content);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const domains = (parsed as { allowed_domains?: unknown }).allowed_domains;
    return Array.isArray(domains)
      ? domains.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().toLocaleLowerCase())
      : [];
  } catch {
    return [];
  }
}

function candidateDomain(candidate: Pick<SourceCandidate, "url" | "domain">): string | undefined {
  if (candidate.domain !== undefined && candidate.domain.trim().length > 0) return candidate.domain.trim().toLocaleLowerCase();
  if (candidate.url === undefined) return undefined;
  try { return new URL(candidate.url).hostname.toLocaleLowerCase(); } catch { return undefined; }
}

function candidateCanonicalUrl(candidate: { url?: string | undefined; canonical_url?: string | undefined }): string | undefined {
  return candidate.canonical_url ?? canonicalizeSourceUrl(candidate.url);
}

function reusableCandidateForOperation(candidates: readonly SourceCandidate[], candidate: { url?: string | undefined; canonical_url?: string | undefined }, operationId: string): SourceCandidate | undefined {
  const canonical = candidateCanonicalUrl(candidate);
  if (canonical === undefined) return undefined;
  return [...candidates].reverse().find((existing) => {
    if (candidateCanonicalUrl(existing) !== canonical) return false;
    return existing.selection_snapshot?.operation_id === operationId || existing.status !== "ingested";
  });
}

function sourceMatchesIdentity(source: SourceRecord, originalHash: string, revision: string): boolean {
  // URL fields are retained for provenance; URL alone must not collapse a
  // newer revision of the same page. Content hash or canonical revision is
  // the dedupe identity, including across different URLs for the same body.
  return source.original_hash === originalHash || source.revision === revision;
}

function domainAllowed(domain: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (domain === undefined) return false;
  return allowed.some((item) => {
    const normalized = item.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "").toLocaleLowerCase();
    return domain === normalized || domain.endsWith(`.${normalized}`);
  });
}

function isOfficialCandidate(candidate: SourceCandidate): boolean {
  return candidate.official === true || /official|公式|官方/iu.test([candidate.title, candidate.snippet, candidate.domain, candidate.url].filter((item): item is string => item !== undefined).join(" "));
}

function isSourceError(error: unknown): error is CoreError {
  return error instanceof CoreError && error.code.startsWith("SOURCE_");
}

export class SourceService {
  constructor(private readonly repository: ProjectRepository) {}

  async resume(operationId: string, request: string, context: SourceExecutionContext): Promise<SourceExecutionResult> {
    const { executionAgent, context: execution } = resolveExecutionActors(context.execution ?? context.actor);
    await assertExecutionLease(this.repository, execution);
    const state = await this.repository.read();
    const operation = state.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const requestedUrl = extractSourceUrl(request);
    const hasUrl = requestedUrl !== undefined;
    if (context.attachments.length > 0 || hasUrl) {
      const additions: SourceCandidate[] = context.attachments.length > 0
        ? context.attachments.map((attachment) => ({ id: internalId("candidate"), title: attachment.name, status: "pending" as const }))
        : [{ id: internalId("candidate"), title: requestedUrl ?? "來源", url: requestedUrl!, canonical_url: requestedUrl!, status: "pending" as const }];
      await this.repository.commit(state.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        const selected: SourceCandidate[] = [];
        const reused: SourceCandidate[] = [];
        for (const addition of additions) {
          const existing = reusableCandidateForOperation([...current.candidates, ...selected], addition, operationId);
          if (existing !== undefined) {
            reused.push(existing);
            continue;
          }
          selected.push(addition);
        }
        const selectedCandidates = [...reused, ...selected];
        const selectedById = new Map(selectedCandidates.map((candidate) => [candidate.id, candidate]));
        return {
        ...current,
        candidates: [
          ...current.candidates.map((candidate) => {
            if (!selectedById.has(candidate.id)) return candidate;
            return candidate;
          }),
          ...selected,
        ],
        };
      });
    }
    return this.execute(operationId, context);
  }

  async registerCandidates(operationId: string, results: CandidateSearchResult[], actorInput: ExecutionActorInput): Promise<SourceExecutionResult> {
    const { auditActor, context: execution } = resolveExecutionActors(actorInput);
    await assertExecutionLease(this.repository, execution);
    if (results.length === 0) {
      const state = await this.repository.read();
      await this.setOperation(operationId, "needs_input", "沒有找到候選來源；請提供 URL、檔案或更明確的搜尋描述。", state.revision, execution);
      return { completed: [], blocked: [], summary: "沒有找到候選來源。", status: "needs_input" };
    }
    const state = await this.repository.read();
    const candidateInputs: SourceCandidate[] = results.map((result) => {
      const canonicalUrl = canonicalizeSourceUrl(result.url);
      return {
        id: internalId("candidate"),
        title: result.title,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(canonicalUrl === undefined ? {} : { canonical_url: canonicalUrl }),
        ...(result.domain === undefined ? {} : { domain: result.domain }),
        ...(result.official === undefined ? {} : { official: result.official }),
        ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
        ...(result.content === undefined ? {} : { content: result.content }),
        ...(result.media_type === undefined ? {} : { media_type: result.media_type }),
        ...(result.content === undefined ? {} : { content_hash: contentHash(new TextEncoder().encode(result.content)) }),
        status: "pending" as const,
      };
    });
    let registeredCandidates: SourceCandidate[] = [];
    await this.repository.commit(state.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      const working = [...current.candidates];
      const registered: SourceCandidate[] = [];
      for (const candidate of candidateInputs) {
        const existing = reusableCandidateForOperation(working, candidate, operationId);
        if (existing !== undefined) {
          registered.push(existing);
          continue;
        }
        working.push(candidate);
        registered.push(candidate);
      }
      registeredCandidates = registered;
      return {
      ...current,
      ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
      candidates: working,
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, {
          status: "completed",
          progress: registered.map((candidate) => ({ item_id: candidate.id, status: "completed" as const, message: `候選來源已登錄：${candidate.title}` })),
          result_summary: `已登錄 ${registered.length} 個候選來源，等待加入或批准。`,
        })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "source.candidates_registered",
        actor: auditActor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { count: registered.length, candidate_ids: registered.map((candidate) => candidate.id) },
      }],
      };
    });
    return {
      completed: registeredCandidates.map((candidate) => candidate.id),
      blocked: [],
      summary: `已登錄 ${registeredCandidates.length} 個候選來源，等待加入或批准。`,
      status: "completed",
    };
  }

  async selectCandidates(operationId: string, decisions: SourceSelectionDecision[], actorInput: ExecutionActorInput): Promise<SourceSelectionResult> {
    const actors = resolveExecutionActors(actorInput);
    const actor = actors.executionAgent;
    const auditActor = actors.auditActor;
    const execution = actors.context;
    await assertExecutionLease(this.repository, execution);
    if (decisions.length === 0) throw new CoreError("SOURCE_SELECTION_EMPTY", "至少要選擇一個候選來源。", true);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const seen = new Set<string>();
    for (const decision of decisions) {
      if (seen.has(decision.candidate_id)) throw new CoreError("SOURCE_SELECTION_DUPLICATE", `Candidate ${decision.candidate_id} appears more than once.`, true);
      seen.add(decision.candidate_id);
      const candidate = initial.candidates.find((item) => item.id === decision.candidate_id);
      if (candidate === undefined) throw new CoreError("SOURCE_CANDIDATE_NOT_FOUND", `Candidate ${decision.candidate_id} does not exist.`, true);
      if (candidate.status === "ingested") throw new CoreError("SOURCE_CANDIDATE_ALREADY_INGESTED", `Candidate ${decision.candidate_id} is already ingested.`, true);
    }
    const approved = decisions.filter((item) => item.decision === "approve").map((item) => item.candidate_id);
    const rejected = decisions.filter((item) => item.decision === "reject").map((item) => item.candidate_id);
    const selectedAt = now();
    const selectionSnapshot: SourceSelectionSnapshot = {
      operation_id: operationId,
      candidate_ids: decisions.map((decision) => decision.candidate_id),
      approved_candidate_ids: approved,
      rejected_candidate_ids: rejected,
      selected_at: selectedAt,
      selected_by: actor,
    };
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      candidates: current.candidates.map((candidate) => {
        const decision = decisions.find((item) => item.candidate_id === candidate.id);
        if (decision === undefined) return candidate;
        if (decision.decision === "approve") {
          const { failure: _failure, ...withoutFailure } = candidate;
          return { ...withoutFailure, status: "approved" as const, approved_at: selectedAt, selection_snapshot: selectionSnapshot };
        }
        const { approved_at: _approvedAt, failure: _failure, ...withoutApproval } = candidate;
        return { ...withoutApproval, status: "rejected" as const, selection_snapshot: selectionSnapshot };
      }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, {
          status: "completed",
          progress: decisions.map((decision) => ({ item_id: decision.candidate_id, status: "completed" as const, message: decision.decision === "approve" ? "候選來源已批准。" : "候選來源已拒絕。" })),
          result_summary: `已批准 ${approved.length} 個候選來源，拒絕 ${rejected.length} 個候選來源。`,
        })
        : item),
      audit: [
        ...current.audit,
        ...decisions.map((decision) => ({
          id: internalId("audit"),
          operation_id: operationId,
          event: decision.decision === "approve" ? "source.approved" : "source.rejected",
          actor: auditActor,
          occurred_at: selectedAt,
          project_revision: current.revision + 1,
          details: { candidate_id: decision.candidate_id },
        })),
        {
          id: internalId("audit"),
          operation_id: operationId,
          event: "source.selection.updated",
          actor: auditActor,
          occurred_at: selectedAt,
          project_revision: current.revision + 1,
          details: { decisions },
        },
      ],
      };
    });
    return {
      approved,
      rejected,
      summary: `已批准 ${approved.length} 個候選來源，拒絕 ${rejected.length} 個候選來源。`,
      status: "completed",
    };
  }

  async execute(operationId: string, context: SourceExecutionContext): Promise<SourceExecutionResult> {
    const { auditActor, context: execution } = resolveExecutionActors(context.execution ?? context.actor);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((candidate) => candidate.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);

    const candidates = initial.candidates.filter((candidate) => candidate.status === "approved"
      && (candidate.selection_snapshot === undefined || candidate.selection_snapshot.operation_id === operationId));
    if (candidates.length === 0) {
      const concurrent = initial.candidates.filter((candidate) => candidate.status === "ingested"
        && (candidate.selection_snapshot === undefined || candidate.selection_snapshot.operation_id === operationId));
      if (concurrent.length > 0) {
        const summary = `${concurrent.length} 個候選來源已被並行處理入庫。`;
        await this.setOperation(operationId, "completed", summary, initial.revision, execution);
        return { completed: concurrent.map((candidate) => candidate.id), blocked: [], summary, status: "completed" };
      }
      const hasPending = initial.candidates.some((candidate) => candidate.status === "pending");
      const question = hasPending ? "請先明確批准要使用的候選來源，再執行來源入庫。" : "沒有已批准且尚未入庫的候選來源。";
      await this.setOperation(operationId, "needs_input", question, initial.revision, execution);
      return { completed: [], blocked: [], summary: question, status: "needs_input" };
    }

    const completed: string[] = [];
    const blocked: string[] = [];
    const casConflictCandidates: string[] = [];
    const allowedDomains = sourceResearchPolicy(initial);
    const officialCandidates = candidates.filter(isOfficialCandidate);
    const officialCompleted = new Set<string>();
    for (const candidate of candidates) {
      const preState = await this.repository.read();
      const preCandidate = preState.candidates.find((item) => item.id === candidate.id);
      if (preCandidate !== undefined && preCandidate.status === "ingested") {
        completed.push(candidate.id);
        if (isOfficialCandidate(candidate)) officialCompleted.add(candidate.id);
        continue;
      }
      if (preCandidate !== undefined && preCandidate.status !== "approved") {
        continue;
      }

      if ((candidate.url !== undefined || candidate.domain !== undefined) && !domainAllowed(candidateDomain(candidate), allowedDomains)) {
        const failure = new CoreError("SOURCE_DOMAIN_NOT_ALLOWED", `Source domain ${candidateDomain(candidate) ?? "unknown"} is outside the approved domain policy.`, true);
        await this.markCandidateBlockedOrFailed(operationId, candidate.id, failure, context);
        blocked.push(candidate.id);
        continue;
      }

      let acquired: FetchResult;
      try {
        acquired = await this.acquire(candidate, context);
      } catch (error) {
        if (isSourceError(error)) {
          await this.markCandidateBlockedOrFailed(operationId, candidate.id, error, context);
          blocked.push(candidate.id);
          continue;
        }
        throw error;
      }

      let canonical: ReturnType<typeof canonicalizeSource>;
      try {
        canonical = canonicalizeSource(acquired.content, acquired.media_type ?? candidate.media_type);
      } catch (error) {
        const failure = error instanceof CoreError && isSourceError(error)
          ? error
          : new CoreError("SOURCE_DECODE_FAILED", error instanceof Error ? error.message : String(error), true);
        await this.markCandidateBlockedOrFailed(operationId, candidate.id, failure, context);
        blocked.push(candidate.id);
        continue;
      }

      const sourceCanonicalUrl = candidateCanonicalUrl(candidate);
      const sourceFinalUrl = canonicalizeSourceUrl(acquired.final_url ?? candidate.final_url) ?? sourceCanonicalUrl;
      const source: SourceRecord = {
        id: internalId("source"),
        candidate_id: candidate.id,
        title: candidate.title,
        canonical_text: canonical.text,
        ...(sourceCanonicalUrl === undefined ? {} : { canonical_url: sourceCanonicalUrl }),
        ...(sourceFinalUrl === undefined ? {} : { final_url: sourceFinalUrl }),
        original_hash: contentHash(acquired.content),
        revision: contentHash(canonical.text),
        media_type: canonical.mediaType,
        ...(acquired.name === undefined ? {} : { original_name: acquired.name }),
        ...(candidate.selection_snapshot === undefined ? {} : { selection_snapshot: candidate.selection_snapshot }),
        created_at: now(),
      };

      const maxRetries = 3;
      let commitSuccess = false;
      let isConflict = false;

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const state = await this.repository.read();
        const currentCandidate = state.candidates.find((item) => item.id === candidate.id);

        if (currentCandidate?.status === "ingested") {
          completed.push(candidate.id);
          if (isOfficialCandidate(candidate)) officialCompleted.add(candidate.id);
          commitSuccess = true;
          break;
        }

        if (currentCandidate?.status !== "approved") {
          break;
        }

        let ingestedInCommit = false;
        try {
          await this.repository.commit(state.revision, (current) => {
            const currentOperation = current.operations.find((item) => item.id === operationId);
            if (currentOperation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
            assertExecutionLeaseForOperation(currentOperation, execution);
            const targetCandidate = current.candidates.find((item) => item.id === candidate.id);
            if (targetCandidate === undefined || targetCandidate.status !== "approved") {
              if (targetCandidate?.status === "ingested") {
                return {
                  ...current,
                  operations: current.operations.map((item) => item.id === operationId
                    ? updateOperation(item, {
                      progress: [...item.progress, { item_id: candidate.id, status: "completed", message: "來源已被並行處理入庫。" }],
                    })
                    : item),
                };
              }
              return current;
            }
            const currentDomains = sourceResearchPolicy(current);
            if ((targetCandidate.url !== undefined || targetCandidate.domain !== undefined) && !domainAllowed(candidateDomain(targetCandidate), currentDomains)) {
              throw new CoreError("SOURCE_DOMAIN_NOT_ALLOWED", `Source domain ${candidateDomain(targetCandidate) ?? "unknown"} is outside the approved domain policy.`, true);
            }
            const sourceDuplicate = current.sources.find((existing) => sourceMatchesIdentity(existing, source.original_hash, source.revision));
            const committedSourceId = sourceDuplicate?.id ?? source.id;
            ingestedInCommit = true;
            return {
              ...current,
              ...(sourceDuplicate === undefined ? { sources: [...current.sources, source] } : {}),
              candidates: current.candidates.map((item) => {
                if (item.id !== candidate.id) return item;
                const { failure: _failure, ...withoutFailure } = item;
                return {
                  ...withoutFailure,
                  status: "ingested" as const,
                  ...(source.canonical_url === undefined ? {} : { canonical_url: source.canonical_url }),
                  ...(source.final_url === undefined ? {} : { final_url: source.final_url }),
                  content_hash: source.original_hash,
                  source_revision: source.revision,
                };
              }),
              operations: current.operations.map((item) => item.id === operationId
                ? updateOperation(item, {
                  progress: [...item.progress, { item_id: candidate.id, status: "completed", message: sourceDuplicate === undefined ? "來源已正規化並入庫。" : "來源版本已存在，已安全收斂至既有來源。", source_id: committedSourceId }],
                })
                : item),
              audit: [...current.audit, {
                id: internalId("audit"),
                operation_id: operationId,
                event: "source.ingested",
                actor: auditActor,
                occurred_at: now(),
                project_revision: current.revision + 1,
                details: { candidate_id: candidate.id, source_id: committedSourceId, revision: source.revision, deduplicated: sourceDuplicate !== undefined },
              }],
            };
          });

          if (ingestedInCommit || (await this.repository.read()).candidates.find((item) => item.id === candidate.id)?.status === "ingested") {
            completed.push(candidate.id);
            if (isOfficialCandidate(candidate)) officialCompleted.add(candidate.id);
            commitSuccess = true;
            break;
          }
        } catch (commitErr) {
          if (commitErr instanceof CoreError && commitErr.code === "REVISION_CONFLICT") {
            isConflict = true;
            continue;
          }
          if (isSourceError(commitErr)) {
            await this.markCandidateBlockedOrFailed(operationId, candidate.id, commitErr, context);
            blocked.push(candidate.id);
            break;
          }
          throw commitErr;
        }
      }

      if (!commitSuccess && isConflict && !completed.includes(candidate.id) && !blocked.includes(candidate.id)) {
        casConflictCandidates.push(candidate.id);
        blocked.push(candidate.id);
      }
    }

    if (officialCandidates.length > 0 && officialCompleted.size === 0) {
      for (const candidate of officialCandidates) if (!blocked.includes(candidate.id)) blocked.push(candidate.id);
    }
    const finalState = await this.repository.read();
    const status = completed.length > 0 && blocked.length === 0 ? "completed" : completed.length > 0 ? "partial" : "needs_input";
    const officialRequired = officialCandidates.length > 0 && officialCompleted.size === 0;

    let summary: string;
    if (officialRequired) {
      summary = `SOURCE_RESEARCH_OFFICIAL_REQUIRED: at least one official candidate must be ingested. ${completed.length} candidate(s) ingested, ${blocked.length} blocked.`;
    } else if (casConflictCandidates.length > 0) {
      summary = `CAS_RETRY_EXHAUSTED: 由於 REVISION_CONFLICT 並行衝突，${casConflictCandidates.length} 個候選來源暫時無法入庫，保留 approved 狀態可稍後重試。`;
    } else if (completed.length > 0) {
      summary = `${completed.length} 個來源已加入${blocked.length > 0 ? `，${blocked.length} 個來源需要後續處理` : "。"}`;
    } else {
      summary = "目前沒有來源可以安全入庫，請提供內容或稍後重試。";
    }

    const operationPatch: Partial<OperationRecord> = {
      status,
      result_summary: summary,
      ...(status === "needs_input" ? { question: "要上傳本地檔案、貼上內容，還是稍後重試？" } : {}),
    };

    try {
      await this.repository.commit(finalState.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
        ...current,
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            ...operationPatch,
            progress: [
              ...item.progress,
              ...casConflictCandidates.map((id) => ({
                item_id: id,
                status: "blocked" as const,
                message: "CAS_RETRY_EXHAUSTED: REVISION_CONFLICT 導致候選來源暫時無法入庫，保持 approved 狀態可重新嘗試。",
              })),
            ],
          })
          : item),
        };
      });
    } catch (err) {
      if (!(err instanceof CoreError && err.code === "REVISION_CONFLICT")) throw err;
    }
    return { completed, blocked, summary, status };
  }

  private async acquire(candidate: SourceCandidate, context: SourceExecutionContext): Promise<FetchResult> {
    if (candidate.content !== undefined) return {
      content: new TextEncoder().encode(candidate.content),
      ...(candidate.media_type === undefined ? {} : { media_type: candidate.media_type }),
      name: candidate.title,
    };
    const attachment = attachmentFor(candidate, context.attachments);
    if (attachment !== undefined) return {
      content: attachment.content,
      ...(attachment.media_type === undefined ? {} : { media_type: attachment.media_type }),
      name: attachment.name,
    };
    if (candidate.url !== undefined && context.fetcher !== undefined) {
      try {
        return await context.fetcher(candidate.url);
      } catch (error) {
        throw error instanceof CoreError && isSourceError(error)
          ? error
          : new CoreError("SOURCE_FETCH_BLOCKED", error instanceof Error ? error.message : String(error), true);
      }
    }
    throw new CoreError("SOURCE_CONTENT_REQUIRED", `來源「${candidate.title}」沒有可用內容；請提供檔案、文字或稍後重試。`, true);
  }

  private async setOperation(operationId: string, status: OperationRecord["status"], question: string, expectedRevision: number, execution?: ExecutionContext): Promise<void> {
    await assertExecutionLease(this.repository, execution);
    await this.repository.commit(expectedRevision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      operations: current.operations.map((item) => item.id === operationId ? updateOperation(item, { status, question }) : item),
      };
    });
  }

  private async markCandidateBlockedOrFailed(operationId: string, candidateId: string, failure: CoreError, context: SourceExecutionContext): Promise<void> {
    const { auditActor, context: execution } = resolveExecutionActors(context.execution ?? context.actor);
    await assertExecutionLease(this.repository, execution);
    const maxRetries = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const state = await this.repository.read();
      const currentCandidate = state.candidates.find((item) => item.id === candidateId);
      if (currentCandidate?.status === "ingested") return;
      if (currentCandidate?.status !== "approved") return;
      try {
        await this.repository.commit(state.revision, (current) => {
          assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
          return {
          ...current,
          candidates: current.candidates.map((item) => item.id === candidateId
            ? { ...item, status: failure.code === "SOURCE_FETCH_BLOCKED" ? "blocked_external" : "failed", failure: { code: failure.code, message: failure.message } }
            : item),
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { progress: [...item.progress, { item_id: candidateId, status: "blocked", message: failure.message }] })
            : item),
          audit: [...current.audit, {
            id: internalId("audit"),
            operation_id: operationId,
            event: "source.blocked",
            actor: auditActor,
            occurred_at: now(),
            project_revision: current.revision + 1,
            details: { candidate_id: candidateId, code: failure.code },
          }],
          };
        });
        return;
      } catch (err) {
        if (err instanceof CoreError && err.code === "REVISION_CONFLICT") {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new CoreError("CAS_RETRY_EXHAUSTED", `無法寫入來源失敗狀態：REVISION_CONFLICT (candidate ${candidateId})`, true);
  }
}
