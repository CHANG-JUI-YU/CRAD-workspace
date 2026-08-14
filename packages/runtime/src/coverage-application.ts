import {
  CoreError,
  executionContextFromOperation,
  internalId,
  type AuditEvent,
  type CoverageResearchLineageLink,
  type CoverageResearchStartScope,
  type CoverageResearchTarget,
  type ExecutionContext,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type ResearchTaskRecord,
  type SourceCandidate,
  type SourceRecord,
} from "@st-workspace/core";
import {
  KnowledgeService,
  applyDerivedResearchBatchStatus,
  chunkSource,
  claimResearchTask,
  createResearchBatchFromAssessment,
  createResearchBatchWithScope,
  createUserSupplementSource,
  coverageAssessmentFreshness,
  deriveCoverageCenterMatrix,
  deriveCoverageReadiness,
  deriveDownstreamInvalidation,
  deriveResearchMonitor,
  emptyDownstreamInvalidationReport,
  exhaustResearchTask,
  isTaskInAssessmentLineage,
  previewResolutionConsequences,
  recordUserDecisionAndResolution,
  resolveResearchTargets,
  reviseResearchTask,
  submitResearchTaskCandidates,
  KNOWLEDGE_EXTRACTOR_REVISION,
  RESEARCH_IN_FLIGHT_STATUSES,
  type CoverageCenterMatrix,
  type CoverageResearchStartPreviewInput,
  type DownstreamInvalidationReport,
  type ExecutionActorInput,
  type ResearchCandidateInput,
  type ResearchMonitor,
  type ResolutionConsequencesPreview,
  type SourceFetcher,
} from "@st-workspace/domain";
import { now } from "./operation-runner.js";

export interface CoverageApplicationDeps {
  repository: ProjectRepository;
  knowledge: KnowledgeService;
  fetcher?: SourceFetcher;
}

export interface CoverageAuditEvent extends Omit<AuditEvent, "project_revision"> {}

export interface CoverageCommandOutcome {
  state: ProjectState;
  result: Record<string, unknown>;
  auditEvents: CoverageAuditEvent[];
}

export interface CoverageCommandResult {
  operation_id: string;
  status: string;
  summary: string;
  action: string;
  target?: { character_id?: string; requirement_id?: string };
  source_id?: string;
  source_revision?: string;
  chunk_count?: number;
  completed: string[];
  blocked: string[];
  downstream_invalidation: DownstreamInvalidationReport;
  next_step?: string;
  replayed?: boolean;
  batch_id?: string;
  task_ids?: string[];
  candidate_id?: string;
  [key: string]: unknown;
}

function assertAssessmentMatches(state: ProjectState, assessmentId: string, assessmentRevision: string): void {
  const latestAssessment = state.coverage_assessments.at(-1);
  if (latestAssessment === undefined || latestAssessment.id !== assessmentId || latestAssessment.revision !== assessmentRevision) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "[COVERAGE_ASSESSMENT_STALE] The coverage assessment changed or is not the current assessment; reload and retry.", true);
  }
  if (latestAssessment.pass !== "formal") {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "[COVERAGE_ASSESSMENT_STALE] The coverage assessment pass is not formal; run a formal assessment first.", true);
  }
  const currentReqSet = state.coverage_requirement_sets.at(-1);
  if (currentReqSet === undefined || currentReqSet.id !== latestAssessment.requirement_set_id || currentReqSet.revision !== latestAssessment.requirement_set_revision) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "[COVERAGE_ASSESSMENT_STALE] The requirement set changed since the coverage assessment was performed.", true);
  }
  if (!coverageAssessmentFreshness(state, latestAssessment)) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "[COVERAGE_ASSESSMENT_STALE] The coverage assessment is stale due to changed inputs (blueprint, sources, facts, or review run).", true);
  }
}

function executionInputFor(operation: OperationRecord, actor: string, agentId: string, role: string): ExecutionContext {
  return executionContextFromOperation(operation, { auditActor: actor, executionAgent: { id: agentId, role } });
}

function coverageOperation(
  actor: string | undefined,
  type: string,
  payload: Record<string, unknown>,
  agentId: string,
  role: string,
  existingOperationId?: string,
): OperationRecord {
  return {
    id: existingOperationId ?? internalId("operation"),
    kind: "knowledge",
    request: type,
    ...(actor === undefined ? {} : { actor }),
    status: "running",
    created_at: now(),
    updated_at: now(),
    progress: [],
    command: { version: 1, type, payload },
    execution_snapshot: {
      execution_agent_id: agentId,
      execution_agent_role: role,
      ...(actor === undefined ? {} : { initiated_by: actor }),
      route_kind: "coverage",
      created_at: now(),
    },
  } as unknown as OperationRecord;
}

async function checkReplayCoverageCommand(
  deps: CoverageApplicationDeps,
  operation: OperationRecord,
  marker: string,
): Promise<CoverageCommandResult | undefined> {
  const state = await deps.repository.read();
  const auditEvent = state.audit.find((item) => item.operation_id === operation.id && item.event === marker);
  const existingOp = state.operations.find((op) => op.id === operation.id);

  if (auditEvent === undefined && (existingOp === undefined || existingOp.status === "running")) {
    return undefined;
  }

  const source = state.sources.find(
    (s) => s.selection_snapshot?.operation_id === operation.id || (auditEvent?.details?.source_id !== undefined && s.id === auditEvent.details.source_id),
  );
  const chunks = source !== undefined
    ? state.knowledge_chunks.filter((c) => c.source_id === source.id)
    : [];

  const resolution = state.coverage_resolutions.find(
    (r) => auditEvent?.details?.resolution_id !== undefined && r.id === auditEvent.details.resolution_id,
  );

  const batch = state.coverage_research_batches.find(
    (b) => auditEvent?.details?.batch_id !== undefined && b.id === auditEvent.details.batch_id,
  );

  const target = auditEvent?.details?.requirement_id !== undefined
    ? {
        ...(auditEvent.details.character_id === undefined ? {} : { character_id: auditEvent.details.character_id as string }),
        requirement_id: auditEvent.details.requirement_id as string,
      }
    : undefined;

  return {
    operation_id: operation.id,
    status: existingOp?.status ?? "completed",
    summary: existingOp?.result_summary ?? "Coverage command already applied.",
    action: operation.command?.type ?? "coverage",
    ...(target === undefined ? {} : { target }),
    ...(source === undefined ? {} : { source_id: source.id, source_revision: source.revision }),
    chunk_count: chunks.length,
    completed: [operation.id],
    blocked: [],
    downstream_invalidation: emptyDownstreamInvalidationReport(),
    replayed: true,
    ...(batch === undefined ? {} : { batch_id: batch.id, task_ids: batch.task_ids }),
    ...(resolution === undefined ? {} : { resolution_id: resolution.id }),
  };
}

async function commitCommand(
  deps: CoverageApplicationDeps,
  state: ProjectState,
  operation: OperationRecord,
  outcome: CoverageCommandOutcome,
): Promise<CoverageCommandResult> {
  const summaryText = (outcome.result.summary as string | undefined) ?? "Coverage command applied.";
  const statusStr = (outcome.result.status as string | undefined) ?? "completed";

  const completedOp: OperationRecord = {
    ...operation,
    status: statusStr as any,
    result_summary: summaryText,
    updated_at: now(),
    progress: [
      ...operation.progress,
      { item_id: operation.id, status: statusStr as any, message: summaryText },
    ],
  };

  await deps.repository.commit(state.revision, (current) => {
    const existingIndex = current.operations.findIndex((op) => op.id === operation.id);
    const updatedOperations = existingIndex >= 0
      ? current.operations.map((op, idx) => (idx === existingIndex ? completedOp : op))
      : [...current.operations, completedOp];

    return {
      ...current,
      ...outcome.state,
      operations: updatedOperations,
      audit: [
        ...current.audit,
        ...outcome.auditEvents.map((event) => ({ ...event, project_revision: current.revision + 1 })),
      ],
    };
  });

  const after = await deps.repository.read();
  return {
    operation_id: operation.id,
    status: statusStr,
    summary: summaryText,
    action: operation.command?.type ?? "coverage",
    ...(outcome.result.target === undefined ? {} : { target: outcome.result.target as any }),
    ...(outcome.result.source_id === undefined ? {} : { source_id: outcome.result.source_id as string }),
    ...(outcome.result.source_revision === undefined ? {} : { source_revision: outcome.result.source_revision as string }),
    ...(outcome.result.chunk_count === undefined ? {} : { chunk_count: outcome.result.chunk_count as number }),
    completed: [operation.id],
    blocked: [],
    downstream_invalidation: deriveDownstreamInvalidation(state, after),
    ...(outcome.result.next_step === undefined ? {} : { next_step: outcome.result.next_step as string }),
    ...(outcome.result.batch_id === undefined ? {} : { batch_id: outcome.result.batch_id as string }),
    ...(outcome.result.task_ids === undefined ? {} : { task_ids: outcome.result.task_ids as string[] }),
    ...outcome.result,
  };
}

async function recordFailedOperation(
  deps: CoverageApplicationDeps,
  state: ProjectState,
  operation: OperationRecord,
  error: unknown,
): Promise<never> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const failedOp: OperationRecord = {
    ...operation,
    status: "failed",
    result_summary: errorMessage,
    updated_at: now(),
  };
  try {
    await deps.repository.commit(state.revision, (current) => {
      const existingIndex = current.operations.findIndex((op) => op.id === operation.id);
      const updatedOps = existingIndex >= 0
        ? current.operations.map((op, idx) => (idx === existingIndex ? failedOp : op))
        : [...current.operations, failedOp];
      return {
        ...current,
        operations: updatedOps,
      };
    });
  } catch {
    // Ignore secondary commit error so primary error is thrown
  }
  throw error;
}

/** Start coverage research: create a batch and queued tasks for the current assessment or specific scope. */
export async function executeCoverageResearchStart(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  const latestAssessment = state.coverage_assessments.at(-1);
  const assessmentId = command !== undefined && command.type === "coverage_research_start" ? command.payload.assessment_id : latestAssessment?.id;
  const assessmentRevision = command !== undefined && command.type === "coverage_research_start" ? command.payload.assessment_revision : latestAssessment?.revision;
  const scope = command !== undefined && command.type === "coverage_research_start" ? command.payload.scope : undefined;
  if (assessmentId === undefined || assessmentRevision === undefined) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "No coverage assessment exists; run a formal assessment first.", true);
  }
  assertAssessmentMatches(state, assessmentId, assessmentRevision);
  const outcome = createResearchBatchWithScope(state, assessmentId, scope, "director");
  const summaryText = outcome.reused
    ? "所請求的研究項目已有進行中的任務，直接重用既有工作。"
    : `已建立研究批次，包含 ${outcome.new_task_ids.length} 個新任務。`;

  return {
    state: outcome.state,
    result: {
      status: "completed",
      summary: summaryText,
      reused: outcome.reused,
      requested_targets: outcome.requested_targets,
      existing_task_ids: outcome.existing_task_ids,
      new_task_ids: outcome.new_task_ids,
      task_ids: outcome.reused ? outcome.existing_task_ids : outcome.new_task_ids,
      ...(outcome.batch === undefined ? {} : { batch_id: outcome.batch.id }),
      exact_affected_count: outcome.exact_affected_count,
      next_step: outcome.reused
        ? "研究任務已在進行中，請由 Monitor 追蹤進度"
        : "請 Source Researcher 或驅動程式 Claim 任務執行來源搜尋",
    },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.started", actor,
      occurred_at: now(), details: {
        batch_id: outcome.batch?.id,
        task_ids: outcome.new_task_ids,
        existing_task_ids: outcome.existing_task_ids,
        reused: outcome.reused,
        assessment_id: assessmentId,
        assessment_revision: assessmentRevision,
        ...(scope === undefined ? {} : { scope }),
      },
    }],
  };
}

export async function coverageResearchStart(
  deps: CoverageApplicationDeps,
  actor: string,
  assessmentId?: string,
  assessmentRevision?: string,
  scope?: CoverageResearchStartScope,
  operationId?: string,
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  const latestAssessment = state.coverage_assessments.at(-1);
  const targetId = assessmentId ?? latestAssessment?.id;
  const targetRevision = assessmentRevision ?? latestAssessment?.revision;
  if (targetId === undefined || targetRevision === undefined) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "No coverage assessment exists; run a formal assessment first.", true);
  }
  assertAssessmentMatches(state, targetId, targetRevision);
  const operation = coverageOperation(actor, "coverage_research_start", { assessment_id: targetId, assessment_revision: targetRevision, ...(scope === undefined ? {} : { scope }) }, "source-researcher", "researcher", operationId);

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.research.started");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResearchStart(deps, state, operation, actor);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

export async function coverageResearchStartPreview(
  deps: CoverageApplicationDeps,
  input: CoverageResearchStartPreviewInput,
): Promise<{
  scope?: CoverageResearchStartScope;
  requested_targets: CoverageResearchTarget[];
  existing_targets: CoverageResearchTarget[];
  existing_task_ids: string[];
  new_targets: CoverageResearchTarget[];
  new_task_count: number;
  already_covered: boolean;
}> {
  const state = await deps.repository.read();
  const latestAssessment = state.coverage_assessments.at(-1);
  const targetId = input.assessment_id ?? latestAssessment?.id;
  const targetRevision = input.assessment_revision ?? latestAssessment?.revision;
  if (targetId === undefined || targetRevision === undefined) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "No coverage assessment exists; run a formal assessment first.", true);
  }
  assertAssessmentMatches(state, targetId, targetRevision);
  const assessment = state.coverage_assessments.find((a) => a.id === targetId)!;
  const requestedTargets = resolveResearchTargets(assessment, input.scope);

  const existingTargets: CoverageResearchTarget[] = [];
  const existingTaskIds: string[] = [];
  const newTargets: CoverageResearchTarget[] = [];

  for (const target of requestedTargets) {
    const activeTask = state.coverage_research_tasks.find((task) => {
      if (!RESEARCH_IN_FLIGHT_STATUSES.has(task.status)) return false;
      if ((task.character_id ?? "") !== (target.character_id ?? "")) return false;
      if (!task.requirement_ids.includes(target.requirement_id)) return false;
      const batch = state.coverage_research_batches.find((b) => b.id === task.batch_id);
      return isTaskInAssessmentLineage(task, batch, assessment);
    });

    if (activeTask !== undefined) {
      existingTargets.push(target);
      if (!existingTaskIds.includes(activeTask.id)) {
        existingTaskIds.push(activeTask.id);
      }
    } else {
      newTargets.push(target);
    }
  }

  return {
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    requested_targets: requestedTargets,
    existing_targets: existingTargets,
    existing_task_ids: existingTaskIds,
    new_targets: newTargets,
    new_task_count: newTargets.length,
    already_covered: newTargets.length === 0 && requestedTargets.length > 0,
  };
}

/** Claim the next queued research task for a batch. */
export async function executeCoverageResearchClaim(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_claim") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing claim payload.", true);
  const claimed = claimResearchTask(state, command.payload.batch_id, actor, command.payload.lease_duration_ms ?? 300000);
  if (claimed === undefined) {
    return {
      state,
      result: { task: undefined, summary: "No queued tasks available to claim." },
      auditEvents: [{
        id: internalId("audit"), operation_id: operation.id, event: "coverage.research.claimed", actor,
        occurred_at: now(), details: { batch_id: command.payload.batch_id, task_id: undefined },
      }],
    };
  }
  return {
    state: claimed.state,
    result: { task: claimed.task, summary: `Claimed task ${claimed.task.id}.` },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.claimed", actor,
      occurred_at: now(), details: { batch_id: command.payload.batch_id, task_id: claimed.task.id, claim_generation: claimed.task.claim_generation },
    }],
  };
}

export async function coverageResearchClaim(
  deps: CoverageApplicationDeps,
  actor: string,
  batchId: string,
  leaseDurationMs?: number,
  operationId?: string,
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_claim", { batch_id: batchId, ...(leaseDurationMs === undefined ? {} : { lease_duration_ms: leaseDurationMs }) }, "source-researcher", "researcher", operationId);

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.research.claimed");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResearchClaim(deps, state, operation, actor);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/** Submit research candidates for a claimed task. */
export async function executeCoverageResearchCandidates(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_candidates") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing candidates payload.", true);
  const submitted = submitResearchTaskCandidates(
    state,
    command.payload.task_id,
    command.payload.claim_generation,
    command.payload.lease_owner,
    command.payload.candidates as unknown as ResearchCandidateInput[],
    executionInputFor(operation, actor, "source-researcher", "researcher"),
    Date.now(),
  );

  const task = state.coverage_research_tasks.find((t) => t.id === command.payload.task_id);
  const batchId = task?.batch_id;
  const derivedBatch = batchId !== undefined ? submitted.state.coverage_research_batches.find((b) => b.id === batchId) : undefined;
  const batchStatus = derivedBatch?.status ?? "open";
  const batchTasks = batchId !== undefined ? submitted.state.coverage_research_tasks.filter((t) => t.batch_id === batchId) : [];
  const batchHasBlocker = batchTasks.some((t) => t.status === "exhausted" || t.status === "failed");

  const opStatus = batchStatus === "completed" ? "completed" : (batchHasBlocker ? "needs_input" : "completed");
  const summaryText = batchStatus === "completed"
    ? "研究批次全數任務已完成。"
    : (batchHasBlocker ? "研究批次部分任務陷入瓶頸，需要手動介入。" : "研究任務候選已提交，批次尚有任務執行中。");

  return {
    state: submitted.state,
    result: {
      status: opStatus,
      summary: summaryText,
      batch_id: batchId,
      batch_status: batchStatus,
      batch_completed: batchStatus === "completed",
      batch_has_blockers: batchHasBlocker,
      candidates: submitted.candidates,
      lineages: submitted.lineages,
    },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.candidates.submitted", actor,
      occurred_at: now(), details: { task_id: command.payload.task_id, candidate_ids: submitted.candidates.map((item) => item.id), batch_id: batchId, batch_status: batchStatus },
    }],
  };
}

export async function coverageResearchCandidates(
  deps: CoverageApplicationDeps,
  actor: string,
  taskId: string,
  claimGeneration: number,
  leaseOwner: string,
  candidates: Array<{ title: string; url?: string | undefined; canonical_url?: string | undefined; snippet?: string | undefined; domain?: string | undefined; official?: boolean | undefined; target_requirement_ids?: string[] | undefined }>,
  operationId?: string,
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_candidates", { task_id: taskId, claim_generation: claimGeneration, lease_owner: leaseOwner, candidates }, "source-researcher", "researcher", operationId);

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.research.candidates.submitted");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResearchCandidates(deps, state, operation, actor);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/** Mark a research task exhausted. */
export async function executeCoverageResearchExhaust(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_exhaust") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing exhaust payload.", true);
  const exhausted = exhaustResearchTask(
    state,
    command.payload.task_id,
    command.payload.claim_generation,
    command.payload.lease_owner,
    command.payload.searched_queries,
    command.payload.source_families,
    command.payload.exhausted_reason,
    executionInputFor(operation, actor, "source-researcher", "researcher"),
    Date.now(),
  );
  return {
    state: exhausted.state,
    result: { task: exhausted.task, summary: `Exhausted task ${command.payload.task_id}.` },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.exhausted", actor,
      occurred_at: now(), details: { task_id: command.payload.task_id, exhausted_reason: command.payload.exhausted_reason },
    }],
  };
}

export async function coverageResearchExhaust(
  deps: CoverageApplicationDeps,
  actor: string,
  taskId: string,
  claimGeneration: number,
  leaseOwner: string,
  searchedQueries: string[],
  sourceFamilies: string[],
  exhaustedReason: string,
  operationId?: string,
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_exhaust", { task_id: taskId, claim_generation: claimGeneration, lease_owner: leaseOwner, searched_queries: searchedQueries, source_families: sourceFamilies, exhausted_reason: exhaustedReason }, "source-researcher", "researcher", operationId);

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.research.exhausted");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResearchExhaust(deps, state, operation, actor);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/** Read-only preview of resolution consequences (two-phase confirmation, phase 1). */
export async function coverageResolutionPreview(deps: CoverageApplicationDeps, input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; action: "user_supplement" | "creative_completion" }): Promise<ResolutionConsequencesPreview> {
  const state = await deps.repository.read();
  const assessment = state.coverage_assessments.find((item) => item.id === input.assessment_id);
  if (assessment === undefined || assessment.revision !== input.assessment_revision) throw new CoreError("COVERAGE_ASSESSMENT_STALE", "The coverage assessment changed since the dashboard was loaded; reload and retry.", true);
  return previewResolutionConsequences(state, assessment, input.requirement_id, input.character_id, input.action);
}

/** Confirm resolution for a coverage item: user_supplement or creative_completion. */
export async function executeCoverageResolutionConfirm(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_resolution_confirm") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing resolution confirm payload.", true);
  const payload = command.payload;
  assertAssessmentMatches(state, payload.assessment_id, payload.assessment_revision);
  const res = recordUserDecisionAndResolution(
    state,
    payload.action,
    [payload.requirement_id],
    payload.choice,
    payload.rationale,
    payload.choice,
    actor,
    operation.id,
    payload.character_id,
  );

  const resolution = res.resolutions[0];
  const targetScope = {
    ...(payload.character_id === undefined ? {} : { character_id: payload.character_id }),
    requirement_id: payload.requirement_id,
  };
  const summary = `Confirmed ${payload.action} resolution for ${payload.requirement_id}.`;

  return {
    state: res.state,
    result: {
      status: "completed",
      summary,
      resolution_id: resolution?.id,
      resolutions: res.resolutions,
      decision: res.decision,
      target: targetScope,
      next_step: payload.action === "user_supplement"
        ? "下一步：請上傳補充資料證據以進行來源分片與事實提煉"
        : "下一步：重新執行 Formal Coverage Assessment 以推導創作補全狀態",
    },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.resolution.confirmed", actor,
      occurred_at: now(), details: { resolution_id: resolution?.id, action: payload.action, requirement_id: payload.requirement_id, character_id: payload.character_id },
    }],
  };
}

export async function coverageResolutionConfirm(
  deps: CoverageApplicationDeps,
  actor: string,
  input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; action: "user_supplement" | "creative_completion"; choice: string; rationale: string; operation_id?: string },
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  assertAssessmentMatches(state, input.assessment_id, input.assessment_revision);
  const operation = coverageOperation(
    actor,
    "coverage_resolution_confirm",
    { assessment_id: input.assessment_id, assessment_revision: input.assessment_revision, requirement_id: input.requirement_id, ...(input.character_id === undefined ? {} : { character_id: input.character_id }), action: input.action, choice: input.choice, rationale: input.rationale },
    "director",
    "orchestrator",
    input.operation_id,
  );

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.resolution.confirmed");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResolutionConfirm(deps, state, operation, actor);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/** Ingest user supplement: create Candidate, Source, Knowledge Chunks atomically in one commit. */
export async function executeCoverageSupplement(
  deps: CoverageApplicationDeps,
  state: ProjectState,
  operation: OperationRecord,
  actor: string,
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }> = [],
): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_supplement") {
    throw new CoreError("OPERATION_COMMAND_INVALID", "Missing supplement payload.", true);
  }

  const payload = command.payload;
  assertAssessmentMatches(state, payload.assessment_id, payload.assessment_revision);

  const textSegments: string[] = [];
  if (payload.text !== undefined && payload.text.trim() !== "") {
    textSegments.push(payload.text.trim());
  }

  if (payload.url !== undefined && payload.url.trim() !== "") {
    let urlText = `Source URL: ${payload.url.trim()}`;
    if (deps.fetcher !== undefined) {
      try {
        const fetched = await deps.fetcher(payload.url.trim());
        if (fetched !== undefined && fetched.content !== undefined) {
          const decoded = new TextDecoder("utf-8").decode(fetched.content);
          if (decoded.trim() !== "") {
            urlText = decoded.trim();
          }
        }
      } catch (err) {
        throw new CoreError("OPERATION_COMMAND_INVALID", `Failed to fetch URL ${payload.url}: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
    textSegments.push(urlText);
  }

  if (attachments.length > 0) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const att of attachments) {
      const mediaType = att.media_type ?? "text/plain";
      if (!mediaType.startsWith("text/") && mediaType !== "application/json" && mediaType !== "application/xml" && mediaType !== "") {
        throw new CoreError("OPERATION_COMMAND_INVALID", `Unsupported attachment media_type "${mediaType}" for file "${att.name}".`, true);
      }
      try {
        const decoded = decoder.decode(att.content);
        if (decoded.trim() !== "") {
          textSegments.push(`Attachment (${att.name}):\n${decoded.trim()}`);
        }
      } catch {
        throw new CoreError("OPERATION_COMMAND_INVALID", `Attachment "${att.name}" is not valid UTF-8 text.`, true);
      }
    }
  }

  const combinedText = textSegments.join("\n\n");
  if (combinedText.trim() === "") {
    throw new CoreError("OPERATION_COMMAND_INVALID", "User supplement must contain text, a valid URL, or valid text attachment.", true);
  }

  // Atomically create Candidate and Source
  const { candidate, source, state: stateWithSource } = createUserSupplementSource(
    state,
    combinedText,
    actor,
    operation.id,
    attachments[0]?.media_type ?? "text/plain",
    attachments[0]?.name ?? "User supplement",
  );

  // Synchronously chunk source in memory
  const chunks = chunkSource(source, KNOWLEDGE_EXTRACTOR_REVISION);

  // Update state with chunks atomically
  const stateWithChunks: ProjectState = {
    ...stateWithSource,
    knowledge_chunks: [...stateWithSource.knowledge_chunks, ...chunks],
  };

  const targetScope = {
    ...(payload.character_id === undefined ? {} : { character_id: payload.character_id }),
    requirement_id: payload.requirement_id,
  };

  const summary = `Created user supplement source ${source.id} with ${chunks.length} chunk(s).`;

  return {
    state: stateWithChunks,
    result: {
      status: "completed",
      summary,
      source_id: source.id,
      source_revision: source.revision,
      candidate_id: candidate.id,
      chunk_count: chunks.length,
      target: targetScope,
      next_step: "至 Fact Curation / Fact Review 觀看分片並進行事實提煉",
    },
    auditEvents: [
      {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "coverage.supplement.provided",
        actor,
        occurred_at: now(),
        details: {
          source_id: source.id,
          source_revision: source.revision,
          candidate_id: candidate.id,
          requirement_id: payload.requirement_id,
          character_id: payload.character_id,
          chunk_count: chunks.length,
          provenance_kind: "user_supplement",
        },
      },
      {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "coverage.supplement.ingested",
        actor,
        occurred_at: now(),
        details: {
          source_id: source.id,
          source_revision: source.revision,
          requirement_id: payload.requirement_id,
          character_id: payload.character_id,
          chunk_count: chunks.length,
          provenance_kind: "user_supplement",
        },
      },
      {
        id: internalId("audit"),
        operation_id: operation.id,
        event: "knowledge.chunks.prepared",
        actor,
        occurred_at: now(),
        details: {
          request: source.id,
          source_ids: [source.id],
          chunk_count: chunks.length,
          fact_count: 0,
        },
      },
    ],
  };
}

export async function coverageSupplement(
  deps: CoverageApplicationDeps,
  actor: string,
  input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; text?: string; url?: string; operation_id?: string },
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }> = [],
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  if (input.operation_id !== undefined) {
    const existingOp = state.operations.find((o) => o.id === input.operation_id);
    if (existingOp !== undefined && existingOp.status === "completed") {
      const dummyOp = coverageOperation(actor, "coverage_supplement", {}, "director", "orchestrator", input.operation_id);
      const replayed = await checkReplayCoverageCommand(deps, dummyOp, "coverage.supplement.provided");
      if (replayed !== undefined) return replayed;
    }
  }

  assertAssessmentMatches(state, input.assessment_id, input.assessment_revision);

  const attachmentRefs = attachments.map((a) => ({
    id: internalId("attachment"),
    name: a.name,
    ...(a.media_type === undefined ? {} : { media_type: a.media_type }),
  }));

  const operation = coverageOperation(
    actor,
    "coverage_supplement",
    {
      assessment_id: input.assessment_id,
      assessment_revision: input.assessment_revision,
      requirement_id: input.requirement_id,
      ...(input.character_id === undefined ? {} : { character_id: input.character_id }),
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(attachmentRefs.length === 0 ? {} : { attachment_refs: attachmentRefs }),
    },
    "director",
    "orchestrator",
    input.operation_id,
  );

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.supplement.provided");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageSupplement(deps, state, operation, actor, attachments);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/** Recover an exhausted research task: revise query/constraints (successor), manual url, supplement, or creative completion. */
export async function executeCoverageResearchRecover(
  deps: CoverageApplicationDeps,
  state: ProjectState,
  operation: OperationRecord,
  actor: string,
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>,
): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_recover") {
    throw new CoreError("OPERATION_COMMAND_INVALID", "Missing recover payload.", true);
  }
  const { task_id, action } = command.payload;
  const task = state.coverage_research_tasks.find((t) => t.id === task_id);
  if (task === undefined) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${task_id}" not found.`, true);
  }
  if (task.status !== "exhausted") {
    throw new CoreError("COVERAGE_RESEARCH_TASK_TERMINAL", `Research task "${task_id}" is ${task.status} and cannot be recovered; only exhausted tasks can be recovered.`, true);
  }

  const latestAssessment = state.coverage_assessments.at(-1);
  const latestReqSet = state.coverage_requirement_sets.at(-1);
  const batch = state.coverage_research_batches.find((b) => b.id === task.batch_id);
  if (
    latestAssessment === undefined ||
    latestReqSet === undefined ||
    !isTaskInAssessmentLineage(task, batch, latestAssessment)
  ) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${task_id}" does not belong to the current assessment lineage.`, true);
  }

  const existingSuccessor = state.coverage_research_tasks.find(
    (t) => t.predecessor_id === task.id && !["failed", "cancelled", "stale"].includes(t.status),
  );
  if (existingSuccessor !== undefined) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_ALREADY_RECOVERED", `Research task "${task_id}" has already been recovered by successor task "${existingSuccessor.id}".`, true);
  }

  const executionInput = executionInputFor(operation, actor, "source-researcher", "researcher");
  let mutated = state;
  let result: Record<string, unknown> = {};
  let successorTaskId: string | undefined;
  let sourceId: string | undefined;
  let resolutionId: string | undefined;

  if (action === "revise_query" || action === "revise_constraints") {
    const revised = reviseResearchTask(
      mutated,
      task.id,
      {
        ...(command.payload.query_seeds === undefined ? {} : { query_seeds: command.payload.query_seeds }),
        ...(command.payload.source_constraints === undefined ? {} : { source_constraints: command.payload.source_constraints }),
      },
      executionInput,
    );
    mutated = revised.state;
    successorTaskId = revised.task.id;
    result = {
      task: revised.task,
      predecessor_id: task.id,
      action,
      summary: `已建立 successor 研究任務 ${revised.task.id}。`,
    };
  } else if (action === "manual_url") {
    const targetUrl = command.payload.url?.trim();
    if (!targetUrl) {
      throw new CoreError("OPERATION_COMMAND_INVALID", "手動提供 URL 必須包含有效的 url。", true);
    }
    let canonicalText = `Manual URL Source: ${targetUrl}`;
    if (deps.fetcher !== undefined) {
      try {
        const fetched = await deps.fetcher(targetUrl);
        if (fetched !== undefined && fetched.content !== undefined) {
          const decoded = new TextDecoder("utf-8").decode(fetched.content);
          if (decoded.trim() !== "") canonicalText = decoded.trim();
        }
      } catch (err) {
        throw new CoreError("OPERATION_COMMAND_INVALID", `Failed to fetch URL ${targetUrl}: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }

    const { candidate, source, state: s1 } = createUserSupplementSource(
      mutated,
      canonicalText,
      actor,
      operation.id,
      "text/html",
      `Manual URL: ${targetUrl}`,
    );
    const sourceWithUrl: SourceRecord = {
      ...source,
      canonical_url: targetUrl,
      final_url: targetUrl,
      provenance_kind: "external_source",
    };
    const s1Updated: ProjectState = {
      ...s1,
      sources: s1.sources.map((s) => (s.id === source.id ? sourceWithUrl : s)),
    };

    const chunks = chunkSource(sourceWithUrl, KNOWLEDGE_EXTRACTOR_REVISION);
    const s2: ProjectState = { ...s1Updated, knowledge_chunks: [...s1Updated.knowledge_chunks, ...chunks] };

    // Create Lineage Links for the task's requirements
    const newLineages: CoverageResearchLineageLink[] = [];
    for (const reqId of task.requirement_ids) {
      newLineages.push({
        id: internalId("lineage"),
        candidate_id: candidate.id,
        source_id: sourceWithUrl.id,
        task_id: task.id,
        batch_id: task.batch_id,
        assessment_id: batch?.assessment_id ?? latestAssessment.id,
        requirement_id: reqId,
        ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
        created_at: now(),
      });
    }

    const updatedTask: ResearchTaskRecord = {
      ...task,
      status: "completed",
      updated_at: now(),
    };

    const s3: ProjectState = {
      ...s2,
      coverage_research_lineages: [...s2.coverage_research_lineages, ...newLineages],
      coverage_research_tasks: s2.coverage_research_tasks.map((t) => (t.id === task.id ? updatedTask : t)),
    };

    mutated = applyDerivedResearchBatchStatus(s3, task.batch_id);
    sourceId = sourceWithUrl.id;
    result = {
      source_id: sourceWithUrl.id,
      candidate_id: candidate.id,
      chunk_count: chunks.length,
      task_id: task.id,
      action,
      summary: `已成功攝入手動 URL 來源並提煉 ${chunks.length} 個知識分片。`,
    };
  } else if (action === "supplement") {
    const textSegments: string[] = [];
    if (command.payload.text !== undefined && command.payload.text.trim() !== "") {
      textSegments.push(command.payload.text.trim());
    }
    if (command.payload.url !== undefined && command.payload.url.trim() !== "") {
      textSegments.push(`參考網址: ${command.payload.url.trim()}`);
    }
    for (const attachment of attachments) {
      const decoded = new TextDecoder("utf-8").decode(attachment.content);
      textSegments.push(`附件 [${attachment.name}]:\n${decoded}`);
    }
    if (textSegments.length === 0) {
      throw new CoreError("COVERAGE_SUPPLEMENT_REQUIRED", "補充資料必須提供文字、URL 或附件其中一項。", true);
    }
    const combinedText = textSegments.join("\n\n---\n\n");
    const { candidate, source, state: s1 } = createUserSupplementSource(
      mutated,
      combinedText,
      actor,
      operation.id,
      "text/plain",
      `補充資料 (Task ${task.id})`,
    );
    const chunks = chunkSource(source, KNOWLEDGE_EXTRACTOR_REVISION);
    const s2: ProjectState = { ...s1, knowledge_chunks: [...s1.knowledge_chunks, ...chunks] };

    const newLineages: CoverageResearchLineageLink[] = [];
    for (const reqId of task.requirement_ids) {
      newLineages.push({
        id: internalId("lineage"),
        candidate_id: candidate.id,
        source_id: source.id,
        task_id: task.id,
        batch_id: task.batch_id,
        assessment_id: batch?.assessment_id ?? latestAssessment.id,
        requirement_id: reqId,
        ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
        created_at: now(),
      });
    }

    const updatedTask: ResearchTaskRecord = {
      ...task,
      status: "completed",
      updated_at: now(),
    };

    const s3: ProjectState = {
      ...s2,
      coverage_research_lineages: [...s2.coverage_research_lineages, ...newLineages],
      coverage_research_tasks: s2.coverage_research_tasks.map((t) => (t.id === task.id ? updatedTask : t)),
    };

    mutated = applyDerivedResearchBatchStatus(s3, task.batch_id);
    sourceId = source.id;
    result = {
      source_id: source.id,
      candidate_id: candidate.id,
      chunk_count: chunks.length,
      task_id: task.id,
      action,
      summary: `已成功提供補充資料並提煉 ${chunks.length} 個知識分片。`,
    };
  } else if (action === "creative_completion") {
    const choice = command.payload.choice ?? "創作補全";
    const rationale = command.payload.rationale ?? "授權創作補全";
    const recorded = recordUserDecisionAndResolution(
      mutated,
      "creative_completion",
      task.requirement_ids,
      choice,
      rationale,
      choice,
      executionInput,
      operation.id,
      task.character_id,
    );

    const updatedTask: ResearchTaskRecord = {
      ...task,
      status: "completed",
      updated_at: now(),
    };

    const s1: ProjectState = {
      ...recorded.state,
      coverage_research_tasks: recorded.state.coverage_research_tasks.map((t) => (t.id === task.id ? updatedTask : t)),
    };

    mutated = applyDerivedResearchBatchStatus(s1, task.batch_id);
    resolutionId = recorded.resolutions[0]?.id;
    result = {
      resolution_ids: recorded.resolutions.map((r) => r.id),
      decision_id: recorded.decision.id,
      task_id: task.id,
      action,
      summary: "已完成創作補全授權決策。",
    };
  }

  return {
    state: mutated,
    result,
    auditEvents: [{
      id: internalId("audit"),
      operation_id: operation.id,
      event: "coverage.research.recovered",
      actor,
      occurred_at: now(),
      details: {
        task_id: task.id,
        action,
        ...(successorTaskId === undefined ? {} : { successor_task_id: successorTaskId }),
        ...(sourceId === undefined ? {} : { source_id: sourceId }),
        ...(resolutionId === undefined ? {} : { resolution_id: resolutionId }),
      },
    }],
  };
}

export async function coverageResearchRecover(
  deps: CoverageApplicationDeps,
  actor: string,
  input: {
    task_id: string;
    action: "revise_query" | "revise_constraints" | "manual_url" | "supplement" | "creative_completion";
    query_seeds?: string[];
    source_constraints?: string[];
    url?: string;
    text?: string;
    choice?: string;
    rationale?: string;
    operation_id?: string;
  },
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }> = [],
): Promise<CoverageCommandResult> {
  const state = await deps.repository.read();
  const attachmentRefs = attachments.map((a) => ({
    id: internalId("attachment"),
    name: a.name,
    ...(a.media_type === undefined ? {} : { media_type: a.media_type }),
  }));

  const operation = coverageOperation(
    actor,
    "coverage_research_recover",
    {
      task_id: input.task_id,
      action: input.action,
      ...(input.query_seeds === undefined ? {} : { query_seeds: input.query_seeds }),
      ...(input.source_constraints === undefined ? {} : { source_constraints: input.source_constraints }),
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.choice === undefined ? {} : { choice: input.choice }),
      ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      ...(attachmentRefs.length === 0 ? {} : { attachment_refs: attachmentRefs }),
    },
    "source-researcher",
    "researcher",
    input.operation_id,
  );

  const replayed = await checkReplayCoverageCommand(deps, operation, "coverage.research.recovered");
  if (replayed !== undefined) return replayed;

  try {
    const outcome = await executeCoverageResearchRecover(deps, state, operation, actor, attachments);
    return await commitCommand(deps, state, operation, outcome);
  } catch (error) {
    return await recordFailedOperation(deps, state, operation, error);
  }
}

/**
 * Compatibility read model: projects the authoritative Coverage Center matrix
 * into the legacy dashboardCoverage schema for backward compatibility.
 * @deprecated Use dashboardCoverageCenter instead.
 */
export async function dashboardCoverage(deps: CoverageApplicationDeps): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const matrix = deriveCoverageCenterMatrix(state);
  const readiness = deriveCoverageReadiness(state);

  const cells = matrix.cells.map((cell) => ({
    ...(cell.character_id === undefined ? {} : { character_id: cell.character_id }),
    requirement_id: cell.requirement_id,
    status: cell.status,
    research_tasks: (cell.current_research_tasks ?? []).map((task) => ({
      id: task.id,
      status: task.status,
      ...(task.predecessor_id === undefined ? {} : { predecessor_id: task.predecessor_id }),
      ...(task.exhausted_reason === undefined ? {} : { exhausted_reason: task.exhausted_reason }),
    })),
    resolutions: (cell.current_resolutions ?? []).map((resolution) => ({
      id: resolution.id,
      mode: resolution.mode,
      status: resolution.status,
      ...(resolution.supersedes === undefined ? {} : { supersedes: resolution.supersedes }),
    })),
    actions: cell.actions,
  }));

  return {
    requirement_set: matrix.requirement_set,
    assessment: matrix.assessment === undefined ? undefined : {
      id: matrix.assessment.id,
      revision: matrix.assessment.revision,
      pass: matrix.assessment.pass,
      current: matrix.assessment.fresh,
    },
    ready: readiness.ready,
    cells,
  };
}

export async function dashboardCoverageCenter(deps: CoverageApplicationDeps): Promise<{ matrix: CoverageCenterMatrix; monitor: ResearchMonitor }> {
  const state = await deps.repository.read();
  return {
    matrix: deriveCoverageCenterMatrix(state),
    monitor: deriveResearchMonitor(state, new Date().toISOString()),
  };
}
