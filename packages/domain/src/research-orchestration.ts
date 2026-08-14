import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  isCoverageRequirementId,
  coverageRequirementById,
  type CoverageResearchLineageLink,
  type ProjectState,
  type ResearchBatchRecord,
  type ResearchTaskRecord,
  type SourceCandidate,
  type SourceRecord,
} from "@st-workspace/core";
import { resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";

function now(): string {
  return new Date().toISOString();
}

/**
 * Capability check for agent actions.
 * Researcher agent is strictly forbidden from approving source candidates,
 * fetching unapproved sources, accepting facts, or mutating requirement sets.
 */
export function isResearcherAgent(agentId: string): boolean {
  const normalized = agentId.toLowerCase();
  return normalized.includes("researcher") || normalized.includes("research-agent");
}

export function assertResearchCapability(
  agentInput: ExecutionActorInput,
  action: "approve_source" | "fetch_source" | "accept_fact" | "mutate_requirements" | "submit_candidates" | "exhaust_task" | "revise_task",
): void {
  const { executionAgent } = resolveExecutionActors(agentInput);
  if (isResearcherAgent(executionAgent)) {
    if (action === "approve_source" || action === "fetch_source" || action === "accept_fact" || action === "mutate_requirements") {
      throw new CoreError(
        "COVERAGE_RESEARCH_CAPABILITY_DENIED",
        `Execution agent "${executionAgent}" lacks capability for action "${action}". Researcher agents cannot approve sources, fetch unapproved candidates, accept facts, or mutate requirement sets.`,
        true,
      );
    }
  }
}

export interface ResearchCandidateInput {
  title: string;
  url?: string;
  canonical_url?: string;
  snippet?: string;
  content?: string;
  domain?: string;
  official?: boolean;
  media_type?: string;
  content_hash?: string;
  target_requirement_ids?: string[];
}

export function candidateRevision(candidate: Pick<SourceCandidate, "title" | "canonical_url" | "domain" | "official" | "media_type" | "content_hash">): string {
  return contentHash(
    canonicalJson({
      title: candidate.title,
      canonical_url: candidate.canonical_url,
      domain: candidate.domain,
      official: candidate.official,
      media_type: candidate.media_type,
      content_hash: candidate.content_hash,
    }),
  );
}

/**
 * Group missing assessment requirements into research bundles (max 3 active parallel tasks).
 */
export function groupMissingRequirementsIntoBundles(
  assessmentItems: Array<{ character_id?: string; requirement_id: string; status: string }>,
): Array<{ character_id?: string; requirement_ids: string[]; dimension_paths: string[]; query_seeds: string[] }> {
  const missingItems = assessmentItems.filter((item) => item.status === "missing");
  if (missingItems.length === 0) return [];

  const bundles: Array<{ character_id?: string; requirement_ids: string[]; dimension_paths: string[]; query_seeds: string[] }> = [];

  // Group by character_id
  const byCharacter = new Map<string | undefined, string[]>();
  for (const item of missingItems) {
    const key = item.character_id;
    const list = byCharacter.get(key) ?? [];
    list.push(item.requirement_id);
    byCharacter.set(key, list);
  }

  for (const [charId, reqIds] of byCharacter) {
    // Separate relationship & world_context if present
    const relReqs = reqIds.filter((id) => id === "req.relationships");
    const worldReqs = reqIds.filter((id) => id === "req.world_context");
    const mainReqs = reqIds.filter((id) => id !== "req.relationships" && id !== "req.world_context");

    if (mainReqs.length > 0) {
      const dimensionPaths: string[] = [];
      const querySeeds: string[] = [];
      for (const reqId of mainReqs) {
        const def = coverageRequirementById(reqId);
        if (def !== undefined) {
          dimensionPaths.push(def.path);
          querySeeds.push(...def.query_terms);
        }
      }
      bundles.push({
        ...(charId === undefined ? {} : { character_id: charId }),
        requirement_ids: mainReqs,
        dimension_paths: [...new Set(dimensionPaths)],
        query_seeds: [...new Set(querySeeds)],
      });
    }

    if (relReqs.length > 0) {
      const def = coverageRequirementById("req.relationships");
      bundles.push({
        ...(charId === undefined ? {} : { character_id: charId }),
        requirement_ids: relReqs,
        dimension_paths: def ? [def.path] : ["relationships"],
        query_seeds: def ? [...def.query_terms] : ["relationships"],
      });
    }

    if (worldReqs.length > 0) {
      const def = coverageRequirementById("req.world_context");
      bundles.push({
        ...(charId === undefined ? {} : { character_id: charId }),
        requirement_ids: worldReqs,
        dimension_paths: def ? [def.path] : ["world_context"],
        query_seeds: def ? [...def.query_terms] : ["world_context"],
      });
    }
  }

  return bundles;
}

const RESEARCH_TERMINAL_STATUSES: ReadonlySet<ResearchTaskRecord["status"]> = new Set(["completed", "exhausted", "failed", "stale", "cancelled"]);
const RESEARCH_ACTIVE_STATUSES: ReadonlySet<ResearchTaskRecord["status"]> = new Set(["claimed", "running"]);

export function isResearchTaskTerminal(status: ResearchTaskRecord["status"]): boolean {
  return RESEARCH_TERMINAL_STATUSES.has(status);
}

export function isResearchLeaseExpired(task: ResearchTaskRecord, referenceNowMs: number): boolean {
  if (!RESEARCH_ACTIVE_STATUSES.has(task.status)) return false;
  if (task.lease_owner === undefined || task.lease_expires_at === undefined) return true;
  const parsed = Date.parse(task.lease_expires_at);
  if (Number.isNaN(parsed)) return true;
  return parsed <= referenceNowMs;
}

export function reclaimExpiredResearchTasks(state: ProjectState, referenceNowMs: number): { tasks: ResearchTaskRecord[]; reclaimed: number } {
  let reclaimed = 0;
  const tasks = state.coverage_research_tasks.map((task) => {
    if (RESEARCH_ACTIVE_STATUSES.has(task.status) && isResearchLeaseExpired(task, referenceNowMs)) {
      reclaimed += 1;
      const { lease_owner: _leaseOwner, lease_expires_at: _leaseExpiresAt, ...rest } = task;
      const reclaimedTask: ResearchTaskRecord = { ...rest, status: "queued", updated_at: now() };
      return reclaimedTask;
    }
    return task;
  });
  return { tasks, reclaimed };
}

export function deriveResearchBatchStatus(batch: ResearchBatchRecord, tasks: readonly ResearchTaskRecord[]): ResearchBatchRecord["status"] {
  const children = tasks.filter((task) => batch.task_ids.includes(task.id));
  if (children.length === 0) return "completed";
  if (children.some((task) => !isResearchTaskTerminal(task.status))) return "open";
  if (children.some((task) => task.status === "failed")) return "failed";
  if (children.some((task) => task.status === "stale")) return "stale";
  if (children.every((task) => task.status === "cancelled")) return "cancelled";
  if (children.every((task) => task.status === "completed")) return "completed";
  return "exhausted";
}

export function applyDerivedResearchBatchStatus(state: ProjectState, batchId: string): ProjectState {
  const batch = state.coverage_research_batches.find((candidate) => candidate.id === batchId);
  if (batch === undefined) return state;
  const derived = deriveResearchBatchStatus(batch, state.coverage_research_tasks);
  if (derived === batch.status) return state;
  return {
    ...state,
    coverage_research_batches: state.coverage_research_batches.map((candidate) => (candidate.id === batchId ? { ...candidate, status: derived } : candidate)),
  };
}

export function createResearchBatchFromAssessment(
  state: ProjectState,
  assessmentId: string,
  executionInput: ExecutionActorInput,
): { batch: ResearchBatchRecord; tasks: ResearchTaskRecord[]; state: ProjectState } {
  const { executionAgent } = resolveExecutionActors(executionInput);
  const assessment = state.coverage_assessments.find((a) => a.id === assessmentId);
  if (assessment === undefined) {
    throw new CoreError("COVERAGE_ASSESSMENT_STALE", `Coverage assessment "${assessmentId}" not found.`, true);
  }

  const bundles = groupMissingRequirementsIntoBundles(assessment.items);
  const batchId = internalId("batch");
  const taskRecords: ResearchTaskRecord[] = [];

  for (let i = 0; i < bundles.length; i++) {
    const bundle = bundles[i]!;
    const taskId = internalId("task");
    const taskRecord: ResearchTaskRecord = {
      id: taskId,
      batch_id: batchId,
      ...(bundle.character_id === undefined ? {} : { character_id: bundle.character_id }),
      requirement_ids: bundle.requirement_ids,
      dimension_paths: bundle.dimension_paths,
      query_seeds: bundle.query_seeds,
      status: "queued",
      claim_generation: 0,
      attempt: 0,
      searched_queries: [],
      source_families: [],
      created_at: now(),
      updated_at: now(),
    };
    taskRecords.push(taskRecord);
  }

  const batchRecord: ResearchBatchRecord = {
    id: batchId,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_id: assessment.requirement_set_id,
    requirement_set_revision: assessment.requirement_set_revision,
    status: taskRecords.length === 0 ? "completed" : "open",
    task_ids: taskRecords.map((t) => t.id),
    created_by: executionAgent,
    created_at: now(),
  };

  const updatedState: ProjectState = {
    ...state,
    coverage_research_batches: [...state.coverage_research_batches, batchRecord],
    coverage_research_tasks: [...state.coverage_research_tasks, ...taskRecords],
  };

  return { batch: batchRecord, tasks: taskRecords, state: updatedState };
}

/**
 * Claim next available queued task in a batch (Max 3 active claims limit enforced).
 */
export function claimResearchTask(
  state: ProjectState,
  batchId: string,
  leaseOwner: string,
  leaseDurationMs = 300000,
  referenceNowMs = Date.now(),
): { task: ResearchTaskRecord; state: ProjectState } | undefined {
  const { tasks: reclaimedTasks } = reclaimExpiredResearchTasks(state, referenceNowMs);
  const activeTasks = reclaimedTasks.filter(
    (task) => RESEARCH_ACTIVE_STATUSES.has(task.status) && !isResearchLeaseExpired(task, referenceNowMs),
  );
  if (activeTasks.length >= 3) {
    throw new CoreError("COVERAGE_RESEARCH_REQUIRED", `Cannot claim task: maximum 3 active research claims reached.`, true);
  }

  const queuedTask = reclaimedTasks.find((t) => t.batch_id === batchId && t.status === "queued");
  if (queuedTask === undefined) return undefined;

  const expiresAt = new Date(referenceNowMs + leaseDurationMs).toISOString();
  const updatedTask: ResearchTaskRecord = {
    ...queuedTask,
    status: "claimed",
    claim_generation: queuedTask.claim_generation + 1,
    lease_owner: leaseOwner,
    lease_expires_at: expiresAt,
    attempt: queuedTask.attempt + 1,
    updated_at: now(),
  };

  const tasks = reclaimedTasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
  return { task: updatedTask, state: { ...state, coverage_research_tasks: tasks } };
}

/**
 * Submit candidates found by a research task.
 * Enforces claim generation, lease ownership, and candidate deduplication with lineage preservation.
 */
export function submitResearchTaskCandidates(
  state: ProjectState,
  taskId: string,
  claimGeneration: number,
  leaseOwner: string,
  candidateInputs: ResearchCandidateInput[],
  executionInput: ExecutionActorInput,
  referenceNowMs = Date.now(),
): { candidates: SourceCandidate[]; lineages: CoverageResearchLineageLink[]; state: ProjectState } {
  assertResearchCapability(executionInput, "submit_candidates");

  const task = state.coverage_research_tasks.find((t) => t.id === taskId);
  if (task === undefined) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" not found.`, true);
  }

  if (isResearchTaskTerminal(task.status)) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_TERMINAL", `Research task "${taskId}" is terminal (${task.status}) and cannot be modified.`, true);
  }

  if (task.status !== "claimed" && task.status !== "running") {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" is not in active state.`, true);
  }

  if (task.claim_generation !== claimGeneration || task.lease_owner !== leaseOwner) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_LEASE_LOST", `Research task "${taskId}" lease lost or generation mismatch.`, true);
  }

  if (task.lease_expires_at === undefined || Number.isNaN(Date.parse(task.lease_expires_at)) || Date.parse(task.lease_expires_at) <= referenceNowMs) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_LEASE_LOST", `Research task "${taskId}" lease expired.`, true);
  }

  const batch = state.coverage_research_batches.find((b) => b.id === task.batch_id);
  if (batch === undefined || batch.status !== "open") {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" parent batch no longer allows execution.`, true);
  }

  const newCandidates: SourceCandidate[] = [];
  const newLineages: CoverageResearchLineageLink[] = [];
  const updatedCandidatesList = [...state.candidates];
  const updatedLineagesList = [...state.coverage_research_lineages];

  for (const input of candidateInputs) {
    // Check deduplication by canonical_url or content_hash
    let existingCandidate = updatedCandidatesList.find((c) =>
      (input.canonical_url !== undefined && c.canonical_url === input.canonical_url) ||
      (input.content_hash !== undefined && c.content_hash === input.content_hash),
    );

    let candidateId: string;
    if (existingCandidate !== undefined) {
      candidateId = existingCandidate.id;
    } else {
      candidateId = internalId("candidate");
      const candidateObj: SourceCandidate = {
        id: candidateId,
        title: input.title,
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.canonical_url === undefined ? {} : { canonical_url: input.canonical_url }),
        ...(input.snippet === undefined ? {} : { snippet: input.snippet }),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.domain === undefined ? {} : { domain: input.domain }),
        official: input.official ?? false,
        media_type: input.media_type ?? "text/plain",
        ...(input.content_hash === undefined ? {} : { content_hash: input.content_hash }),
        status: "pending", // CRITICAL: NEVER auto-approve! Must be pending
      };
      const candidateRev = candidateRevision(candidateObj);
      const fullCandidate: SourceCandidate = { ...candidateObj, source_revision: candidateRev };
      updatedCandidatesList.push(fullCandidate);
      newCandidates.push(fullCandidate);
      existingCandidate = fullCandidate;
    }

    // Preserve lineage links for all targets, deduplicated by canonical identity
    const targets = input.target_requirement_ids ?? task.requirement_ids;
    for (const reqId of targets) {
      if (isCoverageRequirementId(reqId)) {
        const characterScope = task.character_id ?? "";
        const duplicateLineage = updatedLineagesList.some(
          (existing) =>
            existing.candidate_id === candidateId &&
            existing.task_id === task.id &&
            existing.requirement_id === reqId &&
            (existing.character_id ?? "") === characterScope,
        );
        if (duplicateLineage) continue;
        const lineageId = internalId("lineage");
        const lineageLink: CoverageResearchLineageLink = {
          id: lineageId,
          ...(candidateId === undefined ? {} : { candidate_id: candidateId }),
          task_id: task.id,
          batch_id: task.batch_id,
          assessment_id: batch.assessment_id,
          requirement_id: reqId,
          ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
          created_at: now(),
        };
        updatedLineagesList.push(lineageLink);
        newLineages.push(lineageLink);
      }
    }
  }

  const updatedTask: ResearchTaskRecord = {
    ...task,
    status: "completed",
    updated_at: now(),
  };

  const tasks = state.coverage_research_tasks.map((t) => (t.id === taskId ? updatedTask : t));

  const updatedState: ProjectState = {
    ...state,
    candidates: updatedCandidatesList,
    coverage_research_lineages: updatedLineagesList,
    coverage_research_tasks: tasks,
  };

  return {
    candidates: newCandidates,
    lineages: newLineages,
    state: applyDerivedResearchBatchStatus(updatedState, task.batch_id),
  };
}

/**
 * Report bounded exhaustion for a research task.
 * Requires non-empty search query history and valid non-temporary reason.
 */
export function exhaustResearchTask(
  state: ProjectState,
  taskId: string,
  claimGeneration: number,
  leaseOwner: string,
  searchedQueries: string[],
  sourceFamilies: string[],
  exhaustedReason: string,
  executionInput: ExecutionActorInput,
  referenceNowMs = Date.now(),
): { task: ResearchTaskRecord; state: ProjectState } {
  assertResearchCapability(executionInput, "exhaust_task");

  const task = state.coverage_research_tasks.find((t) => t.id === taskId);
  if (task === undefined) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" not found.`, true);
  }

  if (isResearchTaskTerminal(task.status)) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_TERMINAL", `Research task "${taskId}" is terminal (${task.status}) and cannot be modified.`, true);
  }

  if (task.status !== "claimed" && task.status !== "running") {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" is not in active state.`, true);
  }

  if (task.claim_generation !== claimGeneration || task.lease_owner !== leaseOwner) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_LEASE_LOST", `Research task "${taskId}" lease lost or generation mismatch.`, true);
  }

  if (task.lease_expires_at === undefined || Number.isNaN(Date.parse(task.lease_expires_at)) || Date.parse(task.lease_expires_at) <= referenceNowMs) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_LEASE_LOST", `Research task "${taskId}" lease expired.`, true);
  }

  if (searchedQueries.length === 0) {
    throw new CoreError("COVERAGE_RESEARCH_EXHAUSTED", `Research task cannot be marked exhausted with an empty query history.`, true);
  }

  if (exhaustedReason.toLowerCase().includes("temporary")) {
    throw new CoreError("COVERAGE_RESEARCH_EXHAUSTED", `Temporary failure cannot be recorded as bounded exhaustion.`, true);
  }

  const updatedTask: ResearchTaskRecord = {
    ...task,
    status: "exhausted",
    searched_queries: [...new Set([...task.searched_queries, ...searchedQueries])],
    source_families: [...new Set([...task.source_families, ...sourceFamilies])],
    exhausted_reason: exhaustedReason,
    updated_at: now(),
  };

  const tasks = state.coverage_research_tasks.map((t) => (t.id === taskId ? updatedTask : t));
  return { task: updatedTask, state: applyDerivedResearchBatchStatus({ ...state, coverage_research_tasks: tasks }, task.batch_id) };
}

/**
 * Approve a source candidate (Director / User capability ONLY).
 * Binds exact candidate revision.
 */
export function approveSourceCandidate(
  state: ProjectState,
  candidateId: string,
  expectedRevision: string | undefined,
  executionInput: ExecutionActorInput,
  operationId: string,
): { candidate: SourceCandidate; state: ProjectState } {
  assertResearchCapability(executionInput, "approve_source");
  const { auditActor } = resolveExecutionActors(executionInput);

  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (candidate === undefined) {
    throw new CoreError("SOURCE_CANDIDATE_NOT_FOUND", `Source candidate "${candidateId}" not found.`, true);
  }

  const currentRev = candidate.source_revision ?? candidateRevision(candidate);
  if (expectedRevision !== undefined && currentRev !== expectedRevision) {
    throw new CoreError("SOURCE_CANDIDATE_STALE", `Candidate revision mismatch: expected "${expectedRevision}", got "${currentRev}".`, true);
  }

  const updatedCandidate: SourceCandidate = {
    ...candidate,
    status: "approved",
    approved_at: now(),
    selection_snapshot: {
      operation_id: operationId,
      candidate_ids: [candidateId],
      approved_candidate_ids: [candidateId],
      rejected_candidate_ids: [],
      selected_at: now(),
      selected_by: auditActor,
    },
  };

  const candidates = state.candidates.map((c) => (c.id === candidateId ? updatedCandidate : c));
  return { candidate: updatedCandidate, state: { ...state, candidates } };
}

/**
 * Fetch approved candidate to create SourceRecord.
 * Throws COVERAGE_RESEARCH_APPROVAL_REQUIRED if candidate is not in approved status.
 */
export function fetchApprovedSource(
  state: ProjectState,
  candidateId: string,
  canonicalText: string,
  executionInput: ExecutionActorInput,
): { source: SourceRecord; state: ProjectState } {
  assertResearchCapability(executionInput, "fetch_source");

  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (candidate === undefined) {
    throw new CoreError("SOURCE_CANDIDATE_NOT_FOUND", `Source candidate "${candidateId}" not found.`, true);
  }

  if (candidate.status !== "approved") {
    throw new CoreError(
      "COVERAGE_RESEARCH_APPROVAL_REQUIRED",
      `Source candidate "${candidateId}" is not approved for fetch. Current status is "${candidate.status}".`,
      true,
    );
  }

  const sourceId = internalId("source");
  const origHash = contentHash(canonicalText);
  const rev = contentHash(canonicalJson({ id: sourceId, candidate_id: candidateId, hash: origHash, text: canonicalText }));

  const sourceRecord: SourceRecord = {
    id: sourceId,
    candidate_id: candidateId,
    title: candidate.title,
    canonical_text: canonicalText,
    ...(candidate.canonical_url === undefined ? {} : { canonical_url: candidate.canonical_url }),
    ...(candidate.final_url === undefined ? {} : { final_url: candidate.final_url }),
    original_hash: origHash,
    revision: rev,
    media_type: candidate.media_type ?? "text/plain",
    ...(candidate.selection_snapshot === undefined ? {} : { selection_snapshot: candidate.selection_snapshot }),
    created_at: now(),
  };

  const updatedCandidate: SourceCandidate = {
    ...candidate,
    status: "ingested",
  };

  const candidates = state.candidates.map((c) => (c.id === candidateId ? updatedCandidate : c));
  const sources = [...state.sources, sourceRecord];

  return { source: sourceRecord, state: { ...state, candidates, sources } };
}

export interface ResearchTaskRevision {
  query_seeds?: string[];
  source_constraints?: string[];
}

export function reviseResearchTask(
  state: ProjectState,
  taskId: string,
  patch: ResearchTaskRevision,
  executionInput: ExecutionActorInput,
): { task: ResearchTaskRecord; state: ProjectState } {
  assertResearchCapability(executionInput, "revise_task");
  const task = state.coverage_research_tasks.find((item) => item.id === taskId);
  if (task === undefined) throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task ${taskId} does not exist.`, true);
  if (task.status !== "exhausted") {
    throw new CoreError("COVERAGE_RESEARCH_TASK_TERMINAL", `Research task "${taskId}" is ${task.status} and cannot be revised; only exhausted tasks can spawn a successor.`, true);
  }
  const { lease_owner: _leaseOwner, lease_expires_at: _leaseExpiresAt, ...taskBase } = task;
  const successor: ResearchTaskRecord = {
    ...taskBase,
    id: internalId("task"),
    status: "queued",
    claim_generation: 0,
    attempt: 0,
    predecessor_id: task.id,
    ...(patch.query_seeds === undefined ? {} : { query_seeds: [...patch.query_seeds] }),
    ...(patch.source_constraints === undefined ? {} : { source_constraints: [...patch.source_constraints] }),
    searched_queries: [],
    source_families: [],
    created_at: now(),
    updated_at: now(),
  };
  const batches = state.coverage_research_batches.map((batch) =>
    batch.id === task.batch_id ? { ...batch, task_ids: [...batch.task_ids, successor.id] } : batch,
  );
  return {
    task: successor,
    state: applyDerivedResearchBatchStatus(
      { ...state, coverage_research_tasks: [...state.coverage_research_tasks, successor], coverage_research_batches: batches },
      task.batch_id,
    ),
  };
}

export function createUserSupplementSource(
  state: ProjectState,
  text: string,
  actor: string,
  operationId: string,
  mediaType = "text/plain",
  title = "User supplement",
): { candidate: SourceCandidate; source: SourceRecord; state: ProjectState } {
  const candidateId = internalId("candidate");
  const sourceId = internalId("source");
  const origHash = contentHash(text);
  const rev = contentHash(canonicalJson({ id: sourceId, text, kind: "user_supplement" }));
  const timeNow = now();

  const candidateRecord: SourceCandidate = {
    id: candidateId,
    title,
    content: text,
    media_type: mediaType,
    content_hash: origHash,
    source_revision: rev,
    status: "approved",
    approved_at: timeNow,
    selection_snapshot: {
      operation_id: operationId,
      candidate_ids: [candidateId],
      approved_candidate_ids: [candidateId],
      rejected_candidate_ids: [],
      selected_at: timeNow,
      selected_by: actor,
    },
  };

  const sourceRecord: SourceRecord = {
    id: sourceId,
    candidate_id: candidateId,
    title,
    canonical_text: text,
    original_hash: origHash,
    revision: rev,
    media_type: mediaType,
    provenance_kind: "user_supplement",
    selection_snapshot: {
      operation_id: operationId,
      candidate_ids: [candidateId],
      approved_candidate_ids: [candidateId],
      rejected_candidate_ids: [],
      selected_at: timeNow,
      selected_by: actor,
    },
    created_at: timeNow,
  };

  return {
    candidate: candidateRecord,
    source: sourceRecord,
    state: {
      ...state,
      candidates: [...state.candidates, candidateRecord],
      sources: [...state.sources, sourceRecord],
    },
  };
}
