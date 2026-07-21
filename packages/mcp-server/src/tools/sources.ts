import {
  claimChunkTask,
  createChunkSet,
  createExtractionJob,
  getJobStatus,
  getTextProjection,
  intakeLocalSource,
  intakeRetrievedSource,
  readJobChunkPayload,
  readSourceManifest,
  storeChunkSet,
  verifyStoredChunkSet,
} from "@card-workspace/ingestion";
import { workflowStateSchema, type IngestionJob, type WorkflowTask } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { z } from "zod";

import { mcpFail } from "../errors.js";
import { numberArg, stringArg, type ToolCallContext } from "./types.js";

export const sourceJobBindingsSchema = z.record(z.string().min(1), z.object({
  source_revision_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  chunk_set_id: z.string().min(1),
  job_id: z.string().min(1),
  input_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
}).strict());

export type SourceJobBindings = z.infer<typeof sourceJobBindingsSchema>;

export function sourceJobBindings(task: WorkflowTask): SourceJobBindings {
  return sourceJobBindingsSchema.parse(task.extensions.source_jobs ?? {});
}

export function summarizeSourceJob(job: IngestionJob) {
  const now = Date.now();
  const nextTask = job.tasks.find((task) => task.status === "pending" || task.status === "failed"
    || (task.status === "processing" && task.lease !== undefined && Date.parse(task.lease.expires_at) <= now));
  return {
    id: job.id,
    revision: job.revision,
    status: job.status,
    source_id: job.source_id,
    source_revision_id: job.source_revision_id,
    chunk_set_id: job.chunk_set_id,
    input_revision: job.input_revision,
    progress: {
      total: job.tasks.length,
      pending: job.tasks.filter((task) => task.status === "pending").length,
      processing: job.tasks.filter((task) => task.status === "processing").length,
      completed: job.tasks.filter((task) => task.status === "completed").length,
      failed: job.tasks.filter((task) => task.status === "failed").length,
    },
    next_chunk: nextTask ? {
      chunk_id: nextTask.chunk_id,
      chunk_hash: nextTask.chunk_hash,
      status: nextTask.status,
      attempt: nextTask.attempt,
    } : null,
  };
}

function curateTask(context: ToolCallContext): WorkflowTask {
  const taskId = stringArg(context.args, "task_id");
  const task = context.workflow.tasks.find((item) => item.id === taskId);
  if (!task || task.kind !== "curate-facts" || task.status !== "claimed") {
    mcpFail("CURATE_FACTS_TASK_INVALID", "Source processing requires the claimed curate-facts task");
  }
  return task;
}

function boundJob(context: ToolCallContext, jobId: string) {
  const task = curateTask(context);
  const binding = Object.entries(sourceJobBindings(task)).find(([, item]) => item.job_id === jobId);
  if (!binding) mcpFail("SOURCE_JOB_NOT_BOUND", `Job is not bound to task ${task.id}: ${jobId}`);
  return { task, sourceId: binding[0], binding: binding[1] };
}

function assignedSourceId(task: WorkflowTask, requestedId: string, revision: string): string {
  if (task.input_artifacts.some((item) => item.id === `source-${requestedId}` && item.revision === revision)) {
    return requestedId;
  }
  if (requestedId.startsWith("source-")
    && task.input_artifacts.some((item) => item.id === requestedId && item.revision === revision)) {
    return requestedId.slice("source-".length);
  }
  mcpFail("SOURCE_TASK_INPUT_NOT_ASSIGNED", `Exact source revision is not assigned to task ${task.id}`);
}

export const sourceTools = {
  source_intake_local: async (context: ToolCallContext) => intakeLocalSource({
    projectRoot: context.projectRoot,
    sourceId: stringArg(context.args, "source_id"),
    title: stringArg(context.args, "title"),
    filePath: stringArg(context.args, "file_path"),
    actor: context.trusted.agentId,
  }),
  source_intake_retrieved: async (context: ToolCallContext) => intakeRetrievedSource({
    projectRoot: context.projectRoot,
    sourceId: stringArg(context.args, "source_id"),
    title: stringArg(context.args, "title"),
    bytes: Buffer.from(stringArg(context.args, "bytes_base64"), "base64"),
    requestedUrl: stringArg(context.args, "requested_url"),
    canonicalUrl: stringArg(context.args, "canonical_url"),
    fetchedAt: stringArg(context.args, "fetched_at"),
    actor: context.trusted.agentId,
    ...(typeof context.args.media_type === "string" ? { mediaType: context.args.media_type } : {}),
    ...(typeof context.args.extension === "string" ? { extension: context.args.extension } : {}),
    ...(typeof context.args.language === "string" ? { language: context.args.language } : {}),
  }),
  source_create_chunks: async (context: ToolCallContext) => {
    const task = curateTask(context);
    const requestedSourceId = stringArg(context.args, "source_id");
    const sourceRevisionId = stringArg(context.args, "source_revision_id") as `sha256:${string}`;
    const sourceId = assignedSourceId(task, requestedSourceId, sourceRevisionId);
    const source = (await readSourceManifest(context.projectRoot)).sources.find((item) => item.id === sourceId);
    const currentSet = source?.current_chunk_set;
    const stored = currentSet?.source_revision_id === sourceRevisionId
      ? {
          ...await verifyStoredChunkSet(context.projectRoot, sourceId, sourceRevisionId, currentSet.chunk_set_id),
          idempotent: true,
        }
      : await storeChunkSet({
          projectRoot: context.projectRoot,
          artifacts: createChunkSet({ projection: await getTextProjection(context.projectRoot, sourceId, sourceRevisionId) }),
          actor: context.trusted.agentId,
        });
    const job = await createExtractionJob({
      projectRoot: context.projectRoot,
      sourceId,
      sourceRevisionId,
      chunkSetId: stored.manifest.id,
      createdBy: context.trusted.agentId,
      ...(typeof task.extensions.curation_run_id === "string"
        ? { curationRunId: task.extensions.curation_run_id }
        : {}),
    });
    const binding = {
      source_revision_id: sourceRevisionId,
      chunk_set_id: stored.manifest.id,
      job_id: job.job.id,
      input_revision: job.job.input_revision,
    };
    const next = await commitWorkflowMutation(context.projectRoot, {
      expectedRevision: numberArg(context.args, "expected_workflow_revision"),
      eventId: stringArg(context.args, "event_id"),
      occurredAt: stringArg(context.args, "occurred_at"),
      actor: context.trusted.agentId,
      update: (state) => {
        const current = state.tasks.find((item) => item.id === task.id);
        if (!current || current.kind !== "curate-facts" || current.status !== "claimed") {
          mcpFail("CURATE_FACTS_TASK_INVALID", "Source processing task changed before job binding");
        }
        const bindings = sourceJobBindings(current);
        const existing = bindings[sourceId];
        if (existing) mcpFail("SOURCE_JOB_BINDING_CONFLICT", `Source already has a task-bound job: ${sourceId}`);
        return workflowStateSchema.parse({
          ...state,
          revision: state.revision + 1,
          tasks: state.tasks.map((item) => item.id === current.id
            ? { ...item, extensions: { ...item.extensions, source_jobs: { ...bindings, [sourceId]: binding } } }
            : item),
        });
      },
    });
    return {
      chunk_set: stored.manifest,
      job: summarizeSourceJob(job.job),
      workflow: next,
      idempotent: stored.idempotent && job.idempotent === true,
    };
  },
  source_get_chunk_task: async (context: ToolCallContext) => {
    const jobId = stringArg(context.args, "job_id");
    const bound = boundJob(context, jobId);
    if (context.args.claim !== true) {
      const job = await getJobStatus(context.projectRoot, jobId);
      if (job.source_id !== bound.sourceId || job.source_revision_id !== bound.binding.source_revision_id
        || job.chunk_set_id !== bound.binding.chunk_set_id || job.input_revision !== bound.binding.input_revision) {
        mcpFail("SOURCE_JOB_NOT_BOUND", `Job identity does not match task binding: ${jobId}`);
      }
      return { job: summarizeSourceJob(job) };
    }
    const claimed = await claimChunkTask({
      projectRoot: context.projectRoot,
      jobId,
      chunkId: stringArg(context.args, "chunk_id"),
      expectedRevision: numberArg(context.args, "expected_job_revision"),
      owner: context.trusted.agentId,
      leaseId: stringArg(context.args, "chunk_lease_id"),
      leaseDurationMs: numberArg(context.args, "chunk_lease_duration_ms"),
      actor: context.trusted.agentId,
    });
    const payload = await readJobChunkPayload(context.projectRoot, claimed.job.id, stringArg(context.args, "chunk_id"));
    if (payload.job.source_id !== bound.sourceId || payload.job.input_revision !== bound.binding.input_revision) {
      mcpFail("SOURCE_JOB_NOT_BOUND", `Claimed job identity does not match task binding: ${jobId}`);
    }
    return { job: summarizeSourceJob(payload.job), task: payload.task, chunk: payload.chunk };
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
