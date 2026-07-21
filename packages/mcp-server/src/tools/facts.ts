import {
  getJobStatus,
  getTextProjection,
  materializeCandidateBatch,
  migrateCandidateIdentity,
  queryFacts,
  readJobChunkPayload,
  resolveEvidenceLocator,
  resolveConflict,
  reviewCandidate,
  submitAndCompleteChunkCandidates,
  traceProvenance,
  validateCompletedJobResults,
  verifyProvenance,
} from "@card-workspace/ingestion";
import { canonicalJson, computeRevision, loadAuthorProject } from "@card-workspace/project";
import {
  candidateBatchSubmissionDraftSchema,
  factsCurationSummarySchema,
  type FactCandidate,
  type WorkflowTask,
} from "@card-workspace/schemas";
import { commitWorkflowMutation, completeSourceProcessingTask } from "@card-workspace/workflow";

import { mcpFail } from "../errors.js";
import { readFactsReadiness } from "./fact-readiness.js";
import { sourceJobBindings, summarizeSourceJob } from "./sources.js";
import { numberArg, objectArg, stringArg, type ToolCallContext } from "./types.js";

const CANDIDATE_OCCURRENCE_PATTERN = /^candidate-occurrence-[a-f0-9]{64}$/u;
type ReviewState = "all" | "reviewed" | "unreviewed";

interface FactsReviewCursor {
  version: 1;
  active_curation_revision: string;
  review_state: ReviewState;
  last_candidate_id: string;
}

function encodeCursor(value: FactsReviewCursor): string {
  const payload = canonicalJson(value);
  return Buffer.from(canonicalJson({ payload, checksum: computeRevision(value) }), "utf8").toString("base64url");
}

function decodeCursor(value: string): FactsReviewCursor {
  try {
    const envelope = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { payload?: unknown; checksum?: unknown };
    if (typeof envelope.payload !== "string" || typeof envelope.checksum !== "string") throw new Error("invalid envelope");
    const cursor = JSON.parse(envelope.payload) as FactsReviewCursor;
    if (cursor.version !== 1
      || typeof cursor.active_curation_revision !== "string"
      || !["all", "reviewed", "unreviewed"].includes(cursor.review_state)
      || !CANDIDATE_OCCURRENCE_PATTERN.test(cursor.last_candidate_id)
      || computeRevision(cursor) !== envelope.checksum) {
      throw new Error("invalid payload");
    }
    return cursor;
  } catch (error) {
    mcpFail("FACTS_REVIEW_CURSOR_INVALID", "Facts review cursor is invalid", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function paginateCandidateIds(options: {
  candidateIds: readonly string[];
  reviewed: ReadonlySet<string>;
  activeCurationRevision: string;
  reviewState: ReviewState;
  limit: number;
  cursor?: string;
}) {
  const cursorValue = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  if (cursorValue !== undefined
    && (cursorValue.active_curation_revision !== options.activeCurationRevision
      || cursorValue.review_state !== options.reviewState)) {
    mcpFail("FACTS_REVIEW_CURSOR_STALE", "Facts review cursor does not match the active curation or filter");
  }
  if (cursorValue !== undefined && !options.candidateIds.includes(cursorValue.last_candidate_id)) {
    mcpFail("FACTS_REVIEW_CURSOR_INVALID", "Facts review cursor does not identify an active candidate");
  }
  const filteredIds = options.candidateIds.filter((id) => options.reviewState === "all"
    || (options.reviewState === "reviewed" ? options.reviewed.has(id) : !options.reviewed.has(id)));
  const remainingIds = cursorValue === undefined
    ? filteredIds
    : filteredIds.filter((id) => id.localeCompare(cursorValue.last_candidate_id) > 0);
  const pageIds = remainingIds.slice(0, options.limit);
  const lastCandidateId = pageIds.at(-1);
  const nextCursor = remainingIds.length > pageIds.length && lastCandidateId !== undefined
    ? encodeCursor({
      version: 1,
      active_curation_revision: options.activeCurationRevision,
      review_state: options.reviewState,
      last_candidate_id: lastCandidateId,
    })
    : undefined;
  return { filteredCount: filteredIds.length, pageIds, nextCursor };
}

export function reviewPageItem(
  candidate: FactCandidate,
  reviewed: boolean,
  qualityDiagnostics: Awaited<ReturnType<typeof readFactsReadiness>>["qualityDiagnostics"],
) {
  return {
    candidate_id: candidate.id,
    review_state: reviewed ? "reviewed" as const : "unreviewed" as const,
    subject: candidate.subject,
    predicate: candidate.predicate,
    value: candidate.value,
    classification: candidate.classification,
    confidence: candidate.confidence,
    ...(candidate.coverage_dimensions === undefined ? {} : { coverage_dimensions: candidate.coverage_dimensions }),
    scope: {
      ...(candidate.scope.world === undefined ? {} : { world: candidate.scope.world }),
      ...(candidate.scope.timeline === undefined ? {} : { timeline: candidate.scope.timeline }),
      ...(candidate.scope.location === undefined ? {} : { location: candidate.scope.location }),
      character_ids: candidate.scope.character_ids,
    },
    valid_time: {
      ...(candidate.valid_time.start === undefined ? {} : { start: candidate.valid_time.start }),
      ...(candidate.valid_time.end === undefined ? {} : { end: candidate.valid_time.end }),
      ...(candidate.valid_time.label === undefined ? {} : { label: candidate.valid_time.label }),
    },
    ...(candidate.rationale === undefined ? {} : { rationale: candidate.rationale }),
    evidence: candidate.evidence.map((evidence) => ({
      source_id: evidence.source_id,
      source_revision_id: evidence.source_revision_id,
      chunk_set_id: evidence.chunk_set_id,
      chunk_id: evidence.chunk_id,
      chunk_hash: evidence.chunk_hash,
      quote: evidence.quote,
      normalized_character_range: evidence.normalized_character_range,
      normalized_line_range: evidence.normalized_line_range,
      ...(evidence.raw_byte_range === undefined ? {} : { raw_byte_range: evidence.raw_byte_range }),
      ...(evidence.chapter === undefined ? {} : { chapter: evidence.chapter }),
    })),
    quality_diagnostics: qualityDiagnostics
      .filter((diagnostic) => diagnostic.candidate_id === candidate.id)
      .map((diagnostic) => ({ code: diagnostic.code, path: diagnostic.path, value: diagnostic.value })),
  };
}

function curateTask(context: ToolCallContext): WorkflowTask {
  const taskId = stringArg(context.args, "task_id");
  const task = context.workflow.tasks.find((item) => item.id === taskId);
  if (!task || task.kind !== "curate-facts" || task.status !== "claimed") {
    mcpFail("CURATE_FACTS_TASK_INVALID", "Fact submission requires the claimed curate-facts task");
  }
  return task;
}

function assertBoundJob(task: WorkflowTask, jobId: string) {
  const match = Object.entries(sourceJobBindings(task)).find(([, binding]) => binding.job_id === jobId);
  if (!match) mcpFail("SOURCE_JOB_NOT_BOUND", `Job is not bound to task ${task.id}: ${jobId}`);
  return { sourceId: match[0], binding: match[1] };
}

export const factTools = {
  fact_submit_candidates: async (context: ToolCallContext) => {
    const task = curateTask(context);
    const batchDraft = candidateBatchSubmissionDraftSchema.parse(context.args.batch);
    const jobId = batchDraft.job_id;
    assertBoundJob(task, jobId);
    const payload = await readJobChunkPayload(context.projectRoot, jobId, batchDraft.chunk_id);
    const projection = await getTextProjection(
      context.projectRoot,
      payload.job.source_id,
      payload.job.source_revision_id,
    );
    const batch = materializeCandidateBatch({
      ...batchDraft,
      candidates: batchDraft.candidates.map((candidate) => ({
        ...candidate,
        evidence: candidate.evidence.map((locator) => resolveEvidenceLocator(locator, projection, payload.chunk)),
      })),
    }, context.trusted.agentId);
    const result = await submitAndCompleteChunkCandidates({
      projectRoot: context.projectRoot,
      jobId,
      chunkId: stringArg(batch, "chunk_id"),
      expectedRevision: numberArg(context.args, "expected_job_revision"),
      leaseId: stringArg(context.args, "chunk_lease_id"),
      owner: context.trusted.agentId,
      sourceRevisionId: stringArg(batch, "source_revision_id") as `sha256:${string}`,
      chunkSetId: stringArg(batch, "chunk_set_id"),
      chunkHash: stringArg(batch, "chunk_hash") as `sha256:${string}`,
      actor: context.trusted.agentId,
      batch,
    });
    return {
      batch: {
        id: result.submission.batchId,
        content_hash: result.submission.batchHash,
        chunk_id: batch.chunk_id,
        candidate_count: batch.candidates.length,
      },
      chunk_task: result.completion.job.tasks.find((item) => item.chunk_id === batch.chunk_id),
      job: summarizeSourceJob(result.completion.job),
      idempotent: result.idempotent,
    };
  },
  fact_finalize_curation: async (context: ToolCallContext) => {
    const task = curateTask(context);
    const bindings = sourceJobBindings(task);
    const sourceInputs = task.input_artifacts.filter((item) => item.id.startsWith("source-"));
    if (sourceInputs.length === 0 || sourceInputs.some((item) => {
      const sourceId = item.id.slice("source-".length);
      return bindings[sourceId]?.source_revision_id !== item.revision;
    }) || Object.keys(bindings).length !== sourceInputs.length) {
      mcpFail("CURATION_INCOMPLETE", "Every exact source input requires one bound extraction job");
    }
    const completed = await Promise.all(Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right))
      .map(async ([sourceId, binding]) => {
        const summary = await validateCompletedJobResults(context.projectRoot, binding.job_id);
        if (summary.job.source_id !== sourceId
          || summary.job.source_revision_id !== binding.source_revision_id
          || summary.job.chunk_set_id !== binding.chunk_set_id
          || summary.job.input_revision !== binding.input_revision) {
          mcpFail("CURATION_RESULT_INVALID", `Completed job does not match task binding: ${binding.job_id}`);
        }
        return summary;
      }));
    const occurredAt = stringArg(context.args, "occurred_at");
    const resultId = stringArg(context.args, "result_id");
    const summary = factsCurationSummarySchema.parse({
      schema_version: 1,
      id: resultId,
      task_id: task.id,
      jobs: completed.map(({ job, results }) => ({
        job_id: job.id,
        input_revision: job.input_revision,
        source_id: job.source_id,
        source_revision_id: job.source_revision_id,
        chunk_set_id: job.chunk_set_id,
        results: results.map((result) => ({
          chunk_id: result.chunkId,
          chunk_hash: result.chunkHash,
          batch_id: result.batchId,
          batch_hash: result.batchHash,
        })),
      })),
      created_by: context.trusted.agentId,
      created_at: occurredAt,
      extensions: {},
    });
    const result = { id: resultId, revision: computeRevision(summary), contract: "facts-curation-summary@1" as const };
    const workflow = await commitWorkflowMutation(context.projectRoot, {
      expectedRevision: numberArg(context.args, "expected_workflow_revision"),
      eventId: stringArg(context.args, "event_id"),
      occurredAt,
      actor: context.trusted.agentId,
      operations: [{
        relativePath: `.workflow/results/${task.id}/${resultId}.json`,
        content: canonicalJson(summary),
        expectedAbsent: true,
      }],
      update: (state) => completeSourceProcessingTask({
        state,
        taskId: task.id,
        leaseId: stringArg(context.args, "lease_id"),
        owner: context.trusted.agentId,
        result,
        clock: { now: () => new Date(occurredAt) },
      }),
    });
    return { summary, result, workflow };
  },
  facts_review_status: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("FACTS_REVIEW_STATUS_DENIED", "Only the Director may read Facts review status");
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.manifest) mcpFail("PROJECT_INVALID", "Facts readiness requires a valid project manifest", project.diagnostics);
    const readiness = await readFactsReadiness(context.projectRoot, project.manifest.characters);
    const activeTaskId = readiness.active.summary?.task_id;
    const task = activeTaskId === undefined
      ? undefined
      : context.workflow.tasks.find((item) => item.id === activeTaskId && item.kind === "curate-facts");
    const bindings = task ? sourceJobBindings(task) : {};
    const jobs = await Promise.all(Object.values(bindings)
      .map((binding) => getJobStatus(context.projectRoot, binding.job_id)));
    const limit = numberArg(context.args, "limit");
    const reviewState = stringArg(context.args, "review_state") as ReviewState;
    const activeCurationRevision = readiness.active.summary === undefined
      ? computeRevision({ batch_ids: readiness.active.batch_ids, candidate_ids: readiness.candidateIds })
      : computeRevision(readiness.active.summary);
    const page = paginateCandidateIds({
      candidateIds: readiness.candidateIds,
      reviewed: readiness.reviewed,
      activeCurationRevision,
      reviewState,
      limit,
      ...(typeof context.args.cursor === "string" ? { cursor: context.args.cursor } : {}),
    });
    const legacyDecisionIds = readiness.journal.events
      .filter((event) => event.kind.startsWith("fact."))
      .filter((event) => {
        const decision = event.payload.decision;
        return decision !== null
          && typeof decision === "object"
          && !Array.isArray(decision)
          && typeof decision.candidate_id === "string"
          && !decision.candidate_id.startsWith("candidate-occurrence-");
      })
      .map((event) => event.id)
      .filter((decisionId) => !readiness.journal.events.some((event) =>
        event.kind === "candidate.identity_bound"
        && (event.payload.binding as { decision_id?: unknown } | undefined)?.decision_id === decisionId));
    return {
      overview: {
        counts: {
          total: readiness.candidateIds.length,
          reviewed: readiness.reviewed.size,
          unreviewed: readiness.candidateIds.length - readiness.reviewed.size,
          filtered: page.filteredCount,
          blocking_quality_diagnostics: readiness.blockingQualityDiagnostics.length,
          open_conflicts: readiness.projection.conflicts.conflicts.filter((conflict) => conflict.status === "open").length,
        },
        revisions: {
          active_curation: activeCurationRevision,
          fact_projection: readiness.projection.register.revision,
          conflict_projection: readiness.projection.conflicts.revision,
          fact_register: computeRevision(readiness.projection.register),
          conflict_register: computeRevision(readiness.projection.conflicts),
        },
        coverage: readiness.coverage,
        gate_ready: readiness.gateReady,
        legacy_candidate_identity_decision_ids: legacyDecisionIds,
        curation: task ? {
          task_id: task.id,
          task_status: task.status,
          job_counts: {
            total: jobs.length,
            completed: jobs.filter((job) => job.status === "completed").length,
          },
        } : undefined,
      },
      page: {
        review_state: reviewState,
        limit,
        items: page.pageIds.flatMap((id) => {
          const candidate = readiness.active.candidates.get(id);
          return candidate === undefined ? [] : [reviewPageItem(candidate, readiness.reviewed.has(id), readiness.qualityDiagnostics)];
        }),
        ...(page.nextCursor === undefined ? {} : { next_cursor: page.nextCursor }),
      },
    };
  },
  fact_query: (context: ToolCallContext) => queryFacts(context.projectRoot, (context.args.filter ?? {}) as never),
  fact_review: (context: ToolCallContext) => {
    const decision = objectArg(context.args, "decision");
    if (typeof decision.candidate_id !== "string" || !CANDIDATE_OCCURRENCE_PATTERN.test(decision.candidate_id)) {
      mcpFail("FACT_CANDIDATE_OCCURRENCE_ID_REQUIRED", "fact_review requires the exact candidate occurrence ID returned by facts_review_status");
    }
    return reviewCandidate(context.projectRoot, {
      decision,
      expectedProjectionRevision: stringArg(context.args, "expected_projection_revision") as `sha256:${string}`,
      ...(typeof context.args.expected_fact_revision === "number"
        ? { expectedFactRevision: context.args.expected_fact_revision }
        : {}),
      ...(context.args.patch === undefined ? {} : { patch: objectArg(context.args, "patch") as never }),
    });
  },
  facts_candidate_identity_migrate: (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("FACTS_CANDIDATE_IDENTITY_MIGRATION_DENIED", "Only the Director may migrate candidate identity");
    return migrateCandidateIdentity(context.projectRoot, {
      decisionId: stringArg(context.args, "decision_id"),
      expectedProjectionRevision: stringArg(context.args, "expected_projection_revision") as `sha256:${string}`,
      actor: context.trusted.agentId,
      occurredAt: stringArg(context.args, "occurred_at"),
    });
  },
  conflict_resolve: (context: ToolCallContext) => resolveConflict(context.projectRoot, {
    decision: context.args.decision,
    expectedProjectionRevision: stringArg(context.args, "expected_projection_revision") as `sha256:${string}`,
    expectedFactRevisions: (context.args.expected_fact_revisions ?? {}) as Record<string, number>,
  }),
  provenance_trace: (context: ToolCallContext) => traceProvenance(context.projectRoot, stringArg(context.args, "id")),
  provenance_verify: (context: ToolCallContext) => verifyProvenance(context.projectRoot),
} satisfies Record<string, (context: ToolCallContext) => unknown>;
