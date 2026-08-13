import {
  CoreError,
  executionContextFromOperation,
  internalId,
  type AuditEvent,
  type ExecutionContext,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
} from "@st-workspace/core";
import {
  KnowledgeService,
  claimResearchTask,
  createResearchBatchFromAssessment,
  createUserSupplementSource,
  deriveCoverageReadiness,
  exhaustResearchTask,
  previewResolutionConsequences,
  recordUserDecisionAndResolution,
  reviseResearchTask,
  submitResearchTaskCandidates,
  type ExecutionActorInput,
  type ResearchCandidateInput,
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

function assertAssessmentMatches(state: ProjectState, assessmentId: string, assessmentRevision: string): void {
  const assessment = state.coverage_assessments.find((item) => item.id === assessmentId);
  if (assessment === undefined || assessment.revision !== assessmentRevision) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", "The coverage assessment changed since the dashboard was loaded; reload and retry.", true);
  }
}

function executionInputFor(operation: OperationRecord, actor: string, agentId: string, role: string): ExecutionContext {
  return executionContextFromOperation(operation, { auditActor: actor, executionAgent: { id: agentId, role } });
}

/** Shared replay-safe command: checks the audit marker before re-applying the mutation. */
export async function replayCoverageCommand(
  deps: CoverageApplicationDeps,
  operation: OperationRecord,
  marker: string,
  apply: () => Promise<CoverageCommandOutcome>,
): Promise<{ operation_id: string; status: string; summary: string; completed: string[]; blocked: string[] }> {
  const state = await deps.repository.read();
  const alreadyApplied = state.audit.some((item) => item.operation_id === operation.id && item.event === marker);
  if (alreadyApplied) {
    return { operation_id: operation.id, status: "completed", summary: "Coverage command already applied.", completed: [], blocked: [] };
  }
  const outcome = await apply();
  await deps.repository.commit(outcome.state.revision, (current) => ({
    ...current,
    ...outcome.state,
    audit: [...current.audit, ...outcome.auditEvents.map((event) => ({ ...event, project_revision: current.revision + 1 }))],
  }));
  return { operation_id: operation.id, status: "completed", summary: "Coverage command applied.", completed: [operation.id], blocked: [] };
}

async function commitCommand(
  deps: CoverageApplicationDeps,
  state: ProjectState,
  operation: OperationRecord,
  outcome: CoverageCommandOutcome,
): Promise<{ operation_id: string; status: string; summary: string; completed: string[]; blocked: string[] }> {
  await deps.repository.commit(state.revision, (current) => ({
    ...current,
    ...outcome.state,
    operations: [...outcome.state.operations, operation],
    audit: [...outcome.state.audit, ...outcome.auditEvents.map((event) => ({ ...event, project_revision: current.revision + 1 }))],
  }));
  return { operation_id: operation.id, status: "completed", summary: "Coverage command applied.", completed: [operation.id], blocked: [] };
}

function coverageOperation(actor: string | undefined, type: string, payload: Record<string, unknown>, agentId: string, role: string): OperationRecord {
  return {
    id: internalId("operation"),
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

/** Start coverage research: create a batch and queued tasks for the current assessment. */
export async function executeCoverageResearchStart(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  const assessmentId = command !== undefined && command.type === "coverage_research_start" ? command.payload.assessment_id : state.coverage_assessments.at(-1)?.id;
  if (assessmentId === undefined) throw new CoreError("COVERAGE_ASSESSMENT_REQUIRED", "No coverage assessment exists; run an assessment first.", true);
  const assessment = state.coverage_assessments.find((item) => item.id === assessmentId);
  if (assessment === undefined) throw new CoreError("COVERAGE_ASSESSMENT_REQUIRED", `Coverage assessment ${assessmentId} does not exist.`, true);
  const { batch, tasks, state: mutated } = createResearchBatchFromAssessment(state, assessmentId, "director");
  return {
    state: mutated,
    result: { batch_id: batch.id, task_ids: tasks.map((task) => task.id) },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.started", actor,
      occurred_at: now(), details: { batch_id: batch.id, task_ids: tasks.map((task) => task.id), assessment_id: assessmentId, assessment_revision: assessment.revision },
    }],
  };
}

export async function coverageResearchStart(deps: CoverageApplicationDeps, actor: string, assessmentId?: string, assessmentRevision?: string): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  if (assessmentId !== undefined) {
    if (assessmentRevision === undefined) throw new CoreError("COVERAGE_ASSESSMENT_STALE", "assessment_revision is required when assessment_id is provided.", true);
    assertAssessmentMatches(state, assessmentId, assessmentRevision);
  }
  const operation = coverageOperation(actor, "coverage_research_start", { ...(assessmentId === undefined ? {} : { assessment_id: assessmentId }), ...(assessmentRevision === undefined ? {} : { assessment_revision: assessmentRevision }) }, "source-researcher", "researcher");
  const outcome = await executeCoverageResearchStart(deps, state, operation, actor);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
}

/** Claim the next queued research task for a batch. */
export async function executeCoverageResearchClaim(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_claim") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing claim payload.", true);
  const claimed = claimResearchTask(state, command.payload.batch_id, actor, command.payload.lease_duration_ms ?? 300000);
  if (claimed === undefined) {
    return {
      state,
      result: { task: undefined },
      auditEvents: [{
        id: internalId("audit"), operation_id: operation.id, event: "coverage.research.claimed", actor,
        occurred_at: now(), details: { batch_id: command.payload.batch_id, task_id: undefined },
      }],
    };
  }
  return {
    state: claimed.state,
    result: { task: claimed.task },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.claimed", actor,
      occurred_at: now(), details: { batch_id: command.payload.batch_id, task_id: claimed.task.id, claim_generation: claimed.task.claim_generation },
    }],
  };
}

export async function coverageResearchClaim(deps: CoverageApplicationDeps, actor: string, batchId: string, leaseDurationMs?: number): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_claim", { batch_id: batchId, ...(leaseDurationMs === undefined ? {} : { lease_duration_ms: leaseDurationMs }) }, "source-researcher", "researcher");
  const outcome = await executeCoverageResearchClaim(deps, state, operation, actor);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
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
  return {
    state: submitted.state,
    result: { candidates: submitted.candidates, lineages: submitted.lineages },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.candidates.submitted", actor,
      occurred_at: now(), details: { task_id: command.payload.task_id, candidate_ids: submitted.candidates.map((item) => item.id) },
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
): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_candidates", { task_id: taskId, claim_generation: claimGeneration, lease_owner: leaseOwner, candidates }, "source-researcher", "researcher");
  const outcome = await executeCoverageResearchCandidates(deps, state, operation, actor);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
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
    result: { task: exhausted.task },
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
): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_exhaust", { task_id: taskId, claim_generation: claimGeneration, lease_owner: leaseOwner, searched_queries: searchedQueries, source_families: sourceFamilies, exhausted_reason: exhaustedReason }, "source-researcher", "researcher");
  const outcome = await executeCoverageResearchExhaust(deps, state, operation, actor);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
}

/** Read-only preview of resolution consequences (two-phase confirmation, phase 1). */
export async function coverageResolutionPreview(deps: CoverageApplicationDeps, input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; action: "user_supplement" | "creative_completion" }): Promise<ResolutionConsequencesPreview> {
  const state = await deps.repository.read();
  const assessment = state.coverage_assessments.find((item) => item.id === input.assessment_id);
  if (assessment === undefined || assessment.revision !== input.assessment_revision) throw new CoreError("COVERAGE_ASSESSMENT_STALE", "The coverage assessment changed since the dashboard was loaded; reload and retry.", true);
  return previewResolutionConsequences(state, assessment, input.requirement_id, input.character_id, input.action);
}

/** Confirm a coverage resolution (phase 2: immutable decision + resolution). */
export async function executeCoverageResolutionConfirm(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_resolution_confirm") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing resolution payload.", true);
  assertAssessmentMatches(state, command.payload.assessment_id, command.payload.assessment_revision);
  const recorded = recordUserDecisionAndResolution(
    state,
    command.payload.action,
    [command.payload.requirement_id],
    command.payload.choice,
    command.payload.rationale,
    command.payload.choice,
    executionInputFor(operation, actor, "director", "orchestrator"),
    operation.id,
    command.payload.character_id,
  );
  return {
    state: recorded.state,
    result: { decision: recorded.decision, resolutions: recorded.resolutions },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.resolution.confirmed", actor,
      occurred_at: now(), details: { action: command.payload.action, requirement_id: command.payload.requirement_id, character_id: command.payload.character_id, decision_id: recorded.decision.id, resolution_ids: recorded.resolutions.map((item) => item.id) },
    }],
  };
}

export async function coverageResolutionConfirm(
  deps: CoverageApplicationDeps,
  actor: string,
  input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; action: "user_supplement" | "creative_completion"; choice: string; rationale: string },
): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  assertAssessmentMatches(state, input.assessment_id, input.assessment_revision);
  const operation = coverageOperation(actor, "coverage_resolution_confirm", { assessment_id: input.assessment_id, assessment_revision: input.assessment_revision, requirement_id: input.requirement_id, ...(input.character_id === undefined ? {} : { character_id: input.character_id }), action: input.action, choice: input.choice, rationale: input.rationale }, "director", "orchestrator");
  const outcome = await executeCoverageResolutionConfirm(deps, state, operation, actor);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
}

/** Guided user supplement ingestion: text, URL or attachment becomes a user-supplied source. */
export async function executeCoverageSupplement(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string, attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_supplement") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing supplement payload.", true);
  assertAssessmentMatches(state, command.payload.assessment_id, command.payload.assessment_revision);
  let text: string | undefined = command.payload.text;
  if (text === undefined && command.payload.url !== undefined && deps.fetcher !== undefined) {
    const fetched = await deps.fetcher(command.payload.url);
    const decoder = new TextDecoder("utf-8");
    text = decoder.decode(fetched.content).slice(0, 200_000);
  }
  if (text === undefined && attachments.length > 0) {
    text = new TextDecoder("utf-8").decode(attachments[0]!.content).slice(0, 200_000);
  }
  if (text === undefined) throw new CoreError("COVERAGE_SUPPLEMENT_REQUIRED", "Provide supplement text, a URL or an attachment.", true);
  const { source, state: withSource } = createUserSupplementSource(state, text, actor, operation.id);
  return {
    state: withSource,
    result: { source_id: source.id, source_revision: source.revision, chunk_count: 0 },
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.supplement.ingested", actor,
      occurred_at: now(), details: { source_id: source.id, source_revision: source.revision, requirement_id: command.payload.requirement_id, character_id: command.payload.character_id, chunk_count: 0, provenance_kind: "user_supplement" },
    }],
  };
}

export async function coverageSupplement(
  deps: CoverageApplicationDeps,
  actor: string,
  input: { assessment_id: string; assessment_revision: string; requirement_id: string; character_id?: string; text?: string; url?: string },
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>,
): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  assertAssessmentMatches(state, input.assessment_id, input.assessment_revision);
  const operation = coverageOperation(actor, "coverage_supplement", { assessment_id: input.assessment_id, assessment_revision: input.assessment_revision, requirement_id: input.requirement_id, ...(input.character_id === undefined ? {} : { character_id: input.character_id }), ...(input.text === undefined ? {} : { text: input.text }), ...(input.url === undefined ? {} : { url: input.url }) }, "director", "orchestrator");
  const outcome = await executeCoverageSupplement(deps, state, operation, actor, attachments);
  const result = await commitCommand(deps, state, operation, outcome);
  const sourceId = outcome.result.source_id as string;
  const chunks = await deps.knowledge.prepareSourceAdaptationChunks(operation.id, sourceId, executionInputFor(operation, actor, "director", "orchestrator"));
  return { ...result, ...outcome.result, chunk_count: chunks.chunks.length };
}

/** Recover an exhausted research task: revise query/constraints (successor) or route to supplement/creative. */
export async function executeCoverageResearchRecover(deps: CoverageApplicationDeps, state: ProjectState, operation: OperationRecord, actor: string, attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>): Promise<CoverageCommandOutcome> {
  const command = operation.command;
  if (command === undefined || command.type !== "coverage_research_recover") throw new CoreError("OPERATION_COMMAND_INVALID", "Missing recover payload.", true);
  const executionInput = executionInputFor(operation, actor, "source-researcher", "researcher");
  let mutated = state;
  let result: Record<string, unknown> = {};
  if (command.payload.action === "revise_query" || command.payload.action === "revise_constraints") {
    const revised = reviseResearchTask(mutated, command.payload.task_id, { ...(command.payload.query_seeds === undefined ? {} : { query_seeds: command.payload.query_seeds }), ...(command.payload.source_constraints === undefined ? {} : { source_constraints: command.payload.source_constraints }) }, executionInput);
    mutated = revised.state;
    result = { task: revised.task, predecessor_id: command.payload.task_id };
  } else {
    throw new CoreError("COVERAGE_RESOLUTION_REQUIRED", "Use the resolution confirm flow for supplement and creative completion recovery.", true);
  }
  return {
    state: mutated,
    result,
    auditEvents: [{
      id: internalId("audit"), operation_id: operation.id, event: "coverage.research.recovered", actor,
      occurred_at: now(), details: { task_id: command.payload.task_id, action: command.payload.action, successor_task_id: (result.task as { id: string }).id },
    }],
  };
}

export async function coverageResearchRecover(
  deps: CoverageApplicationDeps,
  actor: string,
  input: { task_id: string; action: "revise_query" | "revise_constraints" | "manual_url" | "supplement" | "creative_completion"; query_seeds?: string[]; source_constraints?: string[]; url?: string },
  attachments: Array<{ name: string; content: Uint8Array; media_type?: string }>,
): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const operation = coverageOperation(actor, "coverage_research_recover", { task_id: input.task_id, action: input.action, ...(input.query_seeds === undefined ? {} : { query_seeds: input.query_seeds }), ...(input.source_constraints === undefined ? {} : { source_constraints: input.source_constraints }), ...(input.url === undefined ? {} : { url: input.url }) }, "source-researcher", "researcher");
  const outcome = await executeCoverageResearchRecover(deps, state, operation, actor, attachments);
  const result = await commitCommand(deps, state, operation, outcome);
  return { ...result, ...outcome.result };
}

/** Dashboard read model: requirement set, assessment, cells with actions and recovery choices. */
export async function dashboardCoverage(deps: CoverageApplicationDeps): Promise<Record<string, unknown>> {
  const state = await deps.repository.read();
  const requirementSet = state.coverage_requirement_sets.at(-1);
  const assessment = state.coverage_assessments.at(-1);
  const readiness = deriveCoverageReadiness(state);
  const cells = (assessment?.items ?? []).map((item) => {
    const characterId = item.character_id;
    const researchTasks = state.coverage_research_tasks
      .filter((task) => task.character_id === characterId && task.requirement_ids.includes(item.requirement_id))
      .map((task) => ({ id: task.id, status: task.status, predecessor_id: task.predecessor_id, exhausted_reason: task.exhausted_reason }));
    const resolutions = state.coverage_resolutions
      .filter((resolution) => resolution.requirement_id === item.requirement_id && (characterId === undefined ? resolution.character_id === undefined : resolution.character_id === characterId))
      .map((resolution) => ({ id: resolution.id, mode: resolution.mode, status: resolution.status, supersedes: resolution.supersedes }));
    const exhausted = researchTasks.some((task) => task.status === "exhausted");
    return {
      character_id: characterId,
      requirement_id: item.requirement_id,
      status: item.status,
      research_tasks: researchTasks,
      resolutions: resolutions,
      actions: exhausted
        ? ["revise_query", "revise_constraints", "manual_url", "supplement", "creative_completion"]
        : ["research", "supplement", "creative_completion"],
    };
  });
  return {
    requirement_set: requirementSet === undefined ? undefined : { id: requirementSet.id, revision: requirementSet.revision, characters: requirementSet.characters, world_requirement_ids: requirementSet.world_requirement_ids },
    assessment: assessment === undefined ? undefined : { id: assessment.id, revision: assessment.revision, pass: assessment.pass, current: true },
    cells,
    blockers: readiness.blockers,
    ready: readiness.ready,
  };
}
