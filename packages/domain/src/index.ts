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

export { AuthoringService, type AuthoringExecutionResult, inferAuthoringKind } from "./authoring.js";
export { BuildService, type BuildExecutionResult } from "./build.js";
export { ConversionService, type ConversionExecutionResult } from "./conversion.js";
export { ImportService, type ImportExecutionResult } from "./import.js";
export { KnowledgeService, reviewRunProjectionRevision, type FactReviewExecutionResult, type FactReviewRunExecutionResult, type KnowledgeExecutionResult } from "./knowledge.js";
export { ReviewService, type IssueUpdateAction, type IssueUpdateInput, type IssueUpdateResult, type ReviewExecutionResult } from "./review.js";
export { validateWorkflow, type WorkflowDiagnostic, type WorkflowGatePhase, type WorkflowGateResult } from "./workflow-gate.js";
export { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput, type ResolvedExecutionActors } from "./execution-context.js";
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

export interface FetchResult {
  content: Uint8Array;
  media_type?: string;
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

function decodeText(content: Uint8Array): string {
  // A small number of NUL bytes can occur in otherwise recoverable web/text
  // payloads. Treat the payload as binary only when NULs exceed one percent.
  let nulCount = 0;
  for (const byte of content) if (byte === 0) nulCount += 1;
  if (content.length > 0 && nulCount * 100 > content.length) {
    throw new CoreError("SOURCE_BINARY_UNSUPPORTED", "The source content contains binary bytes", true);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new CoreError("SOURCE_DECODE_FAILED", "The source content is not valid UTF-8", true);
  }
  text = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trim();
  if (text.length === 0) throw new CoreError("SOURCE_EMPTY", "The source content is empty", true);
  return text;
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
    const hasUrl = /https?:\/\/\S+/iu.test(request);
    if (context.attachments.length > 0 || hasUrl) {
      const additions = context.attachments.length > 0
        ? context.attachments.map((attachment) => ({ id: internalId("candidate"), title: attachment.name, status: "approved" as const }))
        : [{ id: internalId("candidate"), title: request.match(/https?:\/\/\S+/iu)?.[0] ?? "來源", url: request.match(/https?:\/\/\S+/iu)?.[0], status: "approved" as const }];
      const selectionSnapshot: SourceSelectionSnapshot = {
        operation_id: operationId,
        candidate_ids: additions.map((candidate) => candidate.id),
        approved_candidate_ids: additions.map((candidate) => candidate.id),
        rejected_candidate_ids: [],
        selected_at: now(),
        selected_by: executionAgent,
      };
      await this.repository.commit(state.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
        ...current,
        candidates: [...current.candidates, ...additions.map((candidate) => ({ ...candidate, selection_snapshot: selectionSnapshot }))],
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
    const candidates = results.map((result) => ({
      id: internalId("candidate"),
      title: result.title,
      ...(result.url === undefined ? {} : { url: result.url }),
      ...(result.domain === undefined ? {} : { domain: result.domain }),
      ...(result.official === undefined ? {} : { official: result.official }),
      ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
      ...(result.content === undefined ? {} : { content: result.content }),
      ...(result.media_type === undefined ? {} : { media_type: result.media_type }),
      status: "pending" as const,
    }));
    await this.repository.commit(state.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
      candidates: [...current.candidates, ...candidates],
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, {
          status: "completed",
          progress: candidates.map((candidate) => ({ item_id: candidate.id, status: "completed" as const, message: `候選來源已登錄：${candidate.title}` })),
          result_summary: `已登錄 ${candidates.length} 個候選來源，等待加入或批准。`,
        })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "source.candidates_registered",
        actor: auditActor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { count: candidates.length, candidate_ids: candidates.map((candidate) => candidate.id) },
      }],
      };
    });
    return {
      completed: candidates.map((candidate) => candidate.id),
      blocked: [],
      summary: `已登錄 ${candidates.length} 個候選來源，等待加入或批准。`,
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

      let text: string;
      try {
        text = decodeText(acquired.content);
      } catch (error) {
        const failure = error instanceof CoreError && isSourceError(error)
          ? error
          : new CoreError("SOURCE_DECODE_FAILED", error instanceof Error ? error.message : String(error), true);
        await this.markCandidateBlockedOrFailed(operationId, candidate.id, failure, context);
        blocked.push(candidate.id);
        continue;
      }

      const source: SourceRecord = {
        id: internalId("source"),
        candidate_id: candidate.id,
        title: candidate.title,
        canonical_text: text,
        original_hash: contentHash(acquired.content),
        revision: contentHash(text),
        media_type: acquired.media_type ?? candidate.media_type ?? "text/plain",
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
            ingestedInCommit = true;
            return {
              ...current,
              sources: [...current.sources, source],
              candidates: current.candidates.map((item) => {
                if (item.id !== candidate.id) return item;
                const { failure: _failure, ...withoutFailure } = item;
                return { ...withoutFailure, status: "ingested" as const };
              }),
              operations: current.operations.map((item) => item.id === operationId
                ? updateOperation(item, {
                  progress: [...item.progress, { item_id: candidate.id, status: "completed", message: "來源已正規化並入庫。", source_id: source.id }],
                })
                : item),
              audit: [...current.audit, {
                id: internalId("audit"),
                operation_id: operationId,
                event: "source.ingested",
                actor: auditActor,
                occurred_at: now(),
                project_revision: current.revision + 1,
                details: { candidate_id: candidate.id, source_id: source.id, revision: source.revision },
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
