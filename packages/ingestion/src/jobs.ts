import { readFile, stat } from "node:fs/promises";

import {
  candidateBatchSchema,
  ingestionJobSchema,
  journalEventEnvelopeSchema,
  type CandidateBatch,
  type Chunk,
  type IngestionChunkTask,
  type IngestionJob,
  type Revision,
} from "@card-workspace/schemas";
import {
  assertIngestionProjectPath,
  assertSafeSegment,
  canonicalJson,
  computeRevision,
  computeTextRevision,
  resolveExistingWithin,
  resolveWithin,
  runFileTransaction,
} from "@card-workspace/project";

import { verifyStoredChunkSet } from "./chunk-store.js";
import { validateEvidenceArtifacts } from "./evidence.js";
import { appendCanonicalEvent, createSourceEvent, eventSemanticRevision } from "./events.js";
import { getTextProjection, readSourceManifest, SOURCE_JOURNAL_PATH } from "./source-manifest.js";
import { IngestionError } from "./types.js";

type Clock = () => Date;
type BeforePublish = (index: number) => void | Promise<void>;

interface JobMutationBase {
  projectRoot: string;
  jobId: string;
  expectedRevision: number;
  actor?: string;
  now?: Clock;
  beforePublish?: BeforePublish;
}

export interface CreateExtractionJobOptions {
  projectRoot: string;
  sourceId: string;
  sourceRevisionId: Revision;
  chunkSetId: string;
  createdBy: string;
  curationRunId?: string;
  now?: Clock;
  beforePublish?: BeforePublish;
}

export interface ClaimChunkTaskOptions extends JobMutationBase {
  chunkId: string;
  owner: string;
  leaseId: string;
  leaseDurationMs: number;
}

interface TaskResultBase extends JobMutationBase {
  chunkId: string;
  leaseId: string;
  owner: string;
  sourceRevisionId: Revision;
  chunkSetId: string;
  chunkHash: Revision;
}

export interface CompleteChunkTaskOptions extends TaskResultBase {
  resultBatchId: string;
  resultBatchHash: Revision;
}

export interface FailChunkTaskOptions extends TaskResultBase {
  diagnostics: string[];
}

export type SupersedeJobOptions = JobMutationBase;

export interface JobResult {
  job: IngestionJob;
  idempotent?: boolean;
  eventId?: string;
}

export interface JobChunkPayload {
  job: IngestionJob;
  task: IngestionChunkTask;
  chunk: Chunk;
}

export interface CompletedJobResultRef {
  chunkId: string;
  chunkHash: Revision;
  batchId: string;
  batchHash: Revision;
}

export interface CompletedJobResultsSummary {
  job: IngestionJob;
  results: CompletedJobResultRef[];
}

interface LoadedJob {
  job: IngestionJob;
  text: string;
  relativePath: string;
}

function jobPath(jobId: string): string {
  return assertIngestionProjectPath(`sources/jobs/${assertSafeSegment(jobId)}.json`).relativePath;
}

async function exists(projectRoot: string, relativePath: string): Promise<boolean> {
  try {
    await stat(await resolveWithin(projectRoot, relativePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function fail(code: string, message: string, originalError?: unknown): never {
  throw new IngestionError(code, message, originalError);
}

async function loadJob(projectRoot: string, jobId: string): Promise<LoadedJob> {
  const relativePath = jobPath(jobId);
  try {
    const text = await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8");
    const job = ingestionJobSchema.parse(JSON.parse(text));
    if (job.id !== jobId) fail("JOB_IDENTITY_MISMATCH", `job 身份不符：${jobId}`);
    const curationRunId = typeof job.extensions.curation_run_id === "string"
      ? job.extensions.curation_run_id
      : undefined;
    const immutableIdentity = {
      kind: job.kind,
      source_id: job.source_id,
      source_revision_id: job.source_revision_id,
      chunk_set_id: job.chunk_set_id,
      chunks: job.tasks.map((task) => ({ chunk_id: task.chunk_id, chunk_hash: task.chunk_hash })),
      ...(curationRunId === undefined ? {} : { curation_run_id: curationRunId }),
    };
    if (
      computeRevision(immutableIdentity) !== job.input_revision
      || job.id !== `job-${job.input_revision.slice("sha256:".length)}`
    ) {
      fail("JOB_IDENTITY_MISMATCH", `job immutable identity 不符：${jobId}`);
    }
    return { job, text, relativePath };
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    fail("JOB_NOT_FOUND", `無法讀取合法 job：${jobId}`, error);
  }
}

function assertExpectedRevision(job: IngestionJob, expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || job.revision !== expectedRevision) {
    fail("JOB_REVISION_CONFLICT", `job revision 衝突：預期 ${expectedRevision}，實際 ${job.revision}`);
  }
}

function taskAt(job: IngestionJob, chunkId: string): { task: IngestionChunkTask; index: number } {
  const index = job.tasks.findIndex((candidate) => candidate.chunk_id === chunkId);
  const task = job.tasks[index];
  if (!task || index < 0) fail("JOB_TASK_NOT_FOUND", `job 不含 chunk task：${chunkId}`);
  return { task, index };
}

function deriveStatus(tasks: IngestionChunkTask[]): IngestionJob["status"] {
  if (tasks.length > 0 && tasks.every((task) => task.status === "superseded")) return "superseded";
  if (tasks.every((task) => task.status === "completed")) return "completed";
  if (tasks.some((task) => task.status === "processing")) return "processing";
  if (tasks.some((task) => task.status === "failed")) return "failed";
  return "pending";
}

function replaceTask(job: IngestionJob, index: number, task: IngestionChunkTask): IngestionJob {
  const tasks = job.tasks.map((candidate, candidateIndex) => candidateIndex === index ? task : candidate);
  return ingestionJobSchema.parse({ ...job, revision: job.revision + 1, status: deriveStatus(tasks), tasks });
}

async function assertCurrentInput(projectRoot: string, job: IngestionJob): Promise<void> {
  const manifest = await readSourceManifest(projectRoot);
  const source = manifest.sources.find((candidate) => candidate.id === job.source_id);
  if (
    !source
    || source.current_revision_id !== job.source_revision_id
    || source.current_chunk_set?.source_revision_id !== job.source_revision_id
    || source.current_chunk_set.chunk_set_id !== job.chunk_set_id
  ) {
    fail("JOB_INPUT_STALE", `job input 已不是 source 的 current revision/chunk set：${job.id}`);
  }
}

function assertResultIdentity(
  job: IngestionJob,
  task: IngestionChunkTask,
  options: TaskResultBase,
  now: Date,
): void {
  if (job.status === "superseded" || task.status === "superseded") {
    fail("JOB_SUPERSEDED", `job 或 task 已 superseded：${job.id}`);
  }
  if (
    options.sourceRevisionId !== job.source_revision_id
    || options.chunkSetId !== job.chunk_set_id
    || options.chunkId !== task.chunk_id
  ) {
    fail("JOB_INPUT_MISMATCH", `提交結果的 source revision/chunk set/chunk 不符：${task.chunk_id}`);
  }
  if (options.chunkHash !== task.chunk_hash) {
    fail("JOB_CHUNK_HASH_MISMATCH", `提交結果的 chunk hash 不符：${task.chunk_id}`);
  }
  if (task.status !== "processing" || task.lease?.id !== options.leaseId || task.lease.owner !== options.owner) {
    fail("JOB_LEASE_STALE", `task lease 已失效：${task.chunk_id}`);
  }
  if (Date.parse(task.lease.expires_at) <= now.getTime()) {
    fail("JOB_LEASE_STALE", `task lease 已過期：${task.chunk_id}`);
  }
}

async function assertStoredChunk(projectRoot: string, job: IngestionJob, task: IngestionChunkTask): Promise<void> {
  const artifacts = await verifyStoredChunkSet(projectRoot, job.source_id, job.source_revision_id, job.chunk_set_id);
  const chunk = artifacts.chunks.find((candidate) => candidate.id === task.chunk_id);
  if (!chunk || chunk.content_hash !== task.chunk_hash) {
    fail("JOB_CHUNK_HASH_MISMATCH", `儲存的 chunk hash 不符：${task.chunk_id}`);
  }
}

async function assertStoredCandidateBatch(
  projectRoot: string,
  batchId: string,
  batchHash: Revision,
  job: IngestionJob,
  task: IngestionChunkTask,
): Promise<CandidateBatch> {
  const relativePath = assertIngestionProjectPath(
    `facts/candidates/${assertSafeSegment(batchId)}.json`,
  ).relativePath;
  try {
    const batch = candidateBatchSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")),
    );
    const content = {
      schema_version: batch.schema_version,
      source_id: batch.source_id,
      source_revision_id: batch.source_revision_id,
      chunk_set_id: batch.chunk_set_id,
      chunk_id: batch.chunk_id,
      chunk_hash: batch.chunk_hash,
      job_id: batch.job_id,
      input_revision: batch.input_revision,
      candidates: batch.candidates,
      created_by: batch.created_by,
      created_at: batch.created_at,
      extensions: batch.extensions,
    };
    const expectedHash = computeRevision(content);
    if (
      batch.id !== batchId
      || batch.content_hash !== batchHash
      || batch.content_hash !== expectedHash
      || batch.id !== `batch-${expectedHash.slice("sha256:".length)}`
      || batch.job_id !== job.id
      || batch.source_id !== job.source_id
      || batch.source_revision_id !== job.source_revision_id
      || batch.chunk_set_id !== job.chunk_set_id
      || batch.chunk_id !== task.chunk_id
      || batch.chunk_hash !== task.chunk_hash
      || batch.input_revision !== job.input_revision
    ) {
      fail("JOB_RESULT_BATCH_MISMATCH", `candidate batch 與完成 task input 不符：${batchId}`);
    }
    const candidateIds = batch.candidates.map((candidate) => candidate.id);
    if (new Set(candidateIds).size !== candidateIds.length) {
      fail("JOB_RESULT_BATCH_MISMATCH", `candidate batch 含重複 candidate ID：${batchId}`);
    }
    const artifacts = await verifyStoredChunkSet(projectRoot, job.source_id, job.source_revision_id, job.chunk_set_id);
    const chunk = artifacts.chunks.find((candidate) => candidate.id === task.chunk_id);
    if (!chunk || chunk.content_hash !== task.chunk_hash) {
      fail("JOB_CHUNK_HASH_MISMATCH", `儲存的 chunk hash 不符：${task.chunk_id}`);
    }
    const projection = await getTextProjection(projectRoot, job.source_id, job.source_revision_id);
    for (const candidate of batch.candidates) {
      if (candidate.status !== "submitted") {
        fail("JOB_RESULT_BATCH_MISMATCH", `candidate status 必須是 submitted：${candidate.id}`);
      }
      const evidenceIds = candidate.evidence.map((evidence) => evidence.id);
      if (new Set(evidenceIds).size !== evidenceIds.length) {
        fail("JOB_RESULT_BATCH_MISMATCH", `candidate evidence ID 不得重複：${candidate.id}`);
      }
      for (const evidence of candidate.evidence) {
        if (
          evidence.source_id !== batch.source_id
          || evidence.source_revision_id !== batch.source_revision_id
          || evidence.chunk_set_id !== batch.chunk_set_id
          || evidence.chunk_id !== batch.chunk_id
          || evidence.chunk_hash !== batch.chunk_hash
        ) {
          fail("JOB_RESULT_BATCH_MISMATCH", `candidate evidence 不屬於完成 task：${evidence.id}`);
        }
        validateEvidenceArtifacts(evidence, { projection, chunk });
      }
    }
    return batch;
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    fail("JOB_RESULT_BATCH_INVALID", `無法讀取合法 candidate batch：${batchId}`, error);
  }
}

async function persistMutation(
  loaded: LoadedJob,
  nextJob: IngestionJob,
  options: JobMutationBase,
): Promise<JobResult> {
  const journalText = await readFile(
    await resolveExistingWithin(options.projectRoot, SOURCE_JOURNAL_PATH),
    "utf8",
  );
  const events = journalText.trim().length === 0
    ? []
    : journalText.trimEnd().split("\n").map((line) => journalEventEnvelopeSchema.parse(JSON.parse(line)));
  const priorEvent = [...events].reverse().find((event) => event.aggregate_id === nextJob.source_id);
  const event = createSourceEvent({
    kind: "source.job_updated",
    sourceId: nextJob.source_id,
    ...(priorEvent ? { priorRevision: eventSemanticRevision(priorEvent) } : {}),
    actor: assertSafeSegment(options.actor ?? "system"),
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    sequence: events.length + 1,
    payload: {
      job_id: nextJob.id,
      job_revision: nextJob.revision,
      job_status: nextJob.status,
      input_revision: nextJob.input_revision,
    },
  });
  try {
    await runFileTransaction({
      root: options.projectRoot,
      operations: [
        {
          relativePath: loaded.relativePath,
          content: canonicalJson(nextJob),
          expectedRawRevision: computeTextRevision(loaded.text),
        },
        {
          relativePath: SOURCE_JOURNAL_PATH,
          content: appendCanonicalEvent(journalText, event),
          expectedRawRevision: computeTextRevision(journalText),
        },
      ],
      ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
    });
  } catch (error) {
    if (["REVISION_CONFLICT", "TRANSACTION_LOCKED"].includes((error as { code?: string }).code ?? "")) {
      fail("JOB_REVISION_CONFLICT", `job 或 source journal 已被並行更新：${nextJob.id}`, error);
    }
    throw error;
  }
  return { job: nextJob, eventId: event.id };
}

export async function createExtractionJob(options: CreateExtractionJobOptions): Promise<JobResult> {
  const artifacts = await verifyStoredChunkSet(
    options.projectRoot,
    options.sourceId,
    options.sourceRevisionId,
    options.chunkSetId,
  );
  const sourceId = assertSafeSegment(options.sourceId);
  const createdBy = assertSafeSegment(options.createdBy);
  const curationRunId = options.curationRunId === undefined ? undefined : assertSafeSegment(options.curationRunId);
  const identity = {
    kind: "fact_extraction" as const,
    source_id: sourceId,
    source_revision_id: options.sourceRevisionId,
    chunk_set_id: artifacts.manifest.id,
    chunks: artifacts.chunks.map((chunk) => ({ chunk_id: chunk.id, chunk_hash: chunk.content_hash })),
    ...(curationRunId === undefined ? {} : { curation_run_id: curationRunId }),
  };
  const inputRevision = computeRevision(identity);
  const jobId = `job-${inputRevision.slice("sha256:".length)}`;
  const relativePath = jobPath(jobId);
  const job = ingestionJobSchema.parse({
    schema_version: 1,
    id: jobId,
    kind: identity.kind,
    revision: 0,
    status: identity.chunks.length === 0 ? "completed" : "pending",
    source_id: sourceId,
    source_revision_id: options.sourceRevisionId,
    chunk_set_id: artifacts.manifest.id,
    input_revision: inputRevision,
    created_by: createdBy,
    created_at: (options.now ?? (() => new Date()))().toISOString(),
    tasks: identity.chunks.map((chunk) => ({
      ...chunk,
      status: "pending" as const,
      attempt: 0,
      diagnostics: [],
    })),
    extensions: curationRunId === undefined ? {} : { curation_run_id: curationRunId },
  });
  if (await exists(options.projectRoot, relativePath)) {
    const existing = (await loadJob(options.projectRoot, jobId)).job;
    const existingCurationRunId = typeof existing.extensions.curation_run_id === "string"
      ? existing.extensions.curation_run_id
      : undefined;
    const existingIdentity = {
      kind: existing.kind,
      source_id: existing.source_id,
      source_revision_id: existing.source_revision_id,
      chunk_set_id: existing.chunk_set_id,
      chunks: existing.tasks.map((task) => ({ chunk_id: task.chunk_id, chunk_hash: task.chunk_hash })),
      ...(existingCurationRunId === undefined ? {} : { curation_run_id: existingCurationRunId }),
    };
    if (existing.input_revision !== inputRevision || computeRevision(existingIdentity) !== inputRevision) {
      fail("JOB_IDENTITY_MISMATCH", `既有 job immutable identity 不符：${jobId}`);
    }
    return { job: existing, idempotent: true };
  }
  const journalText = await readFile(
    await resolveExistingWithin(options.projectRoot, SOURCE_JOURNAL_PATH),
    "utf8",
  );
  const events = journalText.trim().length === 0
    ? []
    : journalText.trimEnd().split("\n").map((line) => journalEventEnvelopeSchema.parse(JSON.parse(line)));
  const priorEvent = [...events].reverse().find((event) => event.aggregate_id === sourceId);
  const event = createSourceEvent({
    kind: "source.job_updated",
    sourceId,
    ...(priorEvent ? { priorRevision: eventSemanticRevision(priorEvent) } : {}),
    actor: createdBy,
    timestamp: job.created_at,
    sequence: events.length + 1,
    payload: {
      job_id: job.id,
      job_revision: job.revision,
      job_status: job.status,
      input_revision: job.input_revision,
    },
  });
  try {
    await runFileTransaction({
      root: options.projectRoot,
      operations: [
        { relativePath, content: canonicalJson(job), expectedAbsent: true },
        {
          relativePath: SOURCE_JOURNAL_PATH,
          content: appendCanonicalEvent(journalText, event),
          expectedRawRevision: computeTextRevision(journalText),
        },
      ],
      ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "TRANSACTION_TARGET_EXISTS") {
      return createExtractionJob(options);
    }
    if (["REVISION_CONFLICT", "TRANSACTION_LOCKED"].includes((error as { code?: string }).code ?? "")) {
      fail("JOB_REVISION_CONFLICT", `job 或 source journal 已被並行更新：${job.id}`, error);
    }
    throw error;
  }
  return { job, idempotent: false, eventId: event.id };
}

export async function getJobStatus(projectRoot: string, jobId: string): Promise<IngestionJob> {
  return (await loadJob(projectRoot, jobId)).job;
}

export async function readJobChunkPayload(
  projectRoot: string,
  jobId: string,
  chunkId: string,
): Promise<JobChunkPayload> {
  const loaded = await loadJob(projectRoot, jobId);
  const { task } = taskAt(loaded.job, chunkId);
  const artifacts = await verifyStoredChunkSet(
    projectRoot,
    loaded.job.source_id,
    loaded.job.source_revision_id,
    loaded.job.chunk_set_id,
  );
  const chunk = artifacts.chunks.find((candidate) => candidate.id === task.chunk_id);
  if (!chunk || chunk.content_hash !== task.chunk_hash) {
    fail("JOB_CHUNK_HASH_MISMATCH", `儲存的 chunk hash 不符：${task.chunk_id}`);
  }
  return { job: loaded.job, task, chunk };
}

export async function validateCompletedJobResults(
  projectRoot: string,
  jobId: string,
): Promise<CompletedJobResultsSummary> {
  const loaded = await loadJob(projectRoot, jobId);
  if (loaded.job.status !== "completed") {
    fail("JOB_NOT_COMPLETED", `job 尚未 completed：${jobId}`);
  }
  const results: CompletedJobResultRef[] = [];
  for (const task of loaded.job.tasks) {
    if (!task.result_batch_id || !task.result_batch_hash) {
      fail("JOB_RESULT_BATCH_INVALID", `completed task 缺少 result batch reference：${task.chunk_id}`);
    }
    await assertStoredCandidateBatch(
      projectRoot,
      task.result_batch_id,
      task.result_batch_hash,
      loaded.job,
      task,
    );
    results.push({
      chunkId: task.chunk_id,
      chunkHash: task.chunk_hash,
      batchId: task.result_batch_id,
      batchHash: task.result_batch_hash,
    });
  }
  return { job: loaded.job, results };
}

export async function claimChunkTask(options: ClaimChunkTaskOptions): Promise<JobResult> {
  if (!Number.isFinite(options.leaseDurationMs) || options.leaseDurationMs <= 0) {
    fail("JOB_LEASE_DURATION_INVALID", "leaseDurationMs 必須為正數");
  }
  const loaded = await loadJob(options.projectRoot, options.jobId);
  assertExpectedRevision(loaded.job, options.expectedRevision);
  if (loaded.job.status === "superseded") fail("JOB_SUPERSEDED", `job 已 superseded：${loaded.job.id}`);
  if (loaded.job.status === "completed") fail("JOB_COMPLETED", `job 已 completed：${loaded.job.id}`);
  await assertCurrentInput(options.projectRoot, loaded.job);
  const { task, index } = taskAt(loaded.job, options.chunkId);
  const now = (options.now ?? (() => new Date()))();
  const expired = task.status === "processing" && Date.parse(task.lease!.expires_at) <= now.getTime();
  if (task.status !== "pending" && task.status !== "failed" && !expired) {
    fail("JOB_TASK_NOT_CLAIMABLE", `task 目前不可 claim：${task.chunk_id}`);
  }
  const nextTask = {
    chunk_id: task.chunk_id,
    chunk_hash: task.chunk_hash,
    status: "processing" as const,
    attempt: task.attempt + 1,
    lease: {
      id: assertSafeSegment(options.leaseId),
      owner: assertSafeSegment(options.owner),
      claimed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + options.leaseDurationMs).toISOString(),
    },
    diagnostics: task.diagnostics,
  };
  return persistMutation(loaded, replaceTask(loaded.job, index, nextTask), options);
}

export async function completeChunkTask(options: CompleteChunkTaskOptions): Promise<JobResult> {
  const loaded = await loadJob(options.projectRoot, options.jobId);
  assertExpectedRevision(loaded.job, options.expectedRevision);
  const { task, index } = taskAt(loaded.job, options.chunkId);
  assertResultIdentity(loaded.job, task, options, (options.now ?? (() => new Date()))());
  await assertCurrentInput(options.projectRoot, loaded.job);
  await assertStoredChunk(options.projectRoot, loaded.job, task);
  await assertStoredCandidateBatch(
    options.projectRoot,
    options.resultBatchId,
    options.resultBatchHash,
    loaded.job,
    task,
  );
  const nextTask: IngestionChunkTask = {
    chunk_id: task.chunk_id,
    chunk_hash: task.chunk_hash,
    status: "completed",
    attempt: task.attempt,
    result_batch_id: assertSafeSegment(options.resultBatchId),
    result_batch_hash: options.resultBatchHash,
    diagnostics: task.diagnostics,
  };
  return persistMutation(loaded, replaceTask(loaded.job, index, nextTask), options);
}

export async function failChunkTask(options: FailChunkTaskOptions): Promise<JobResult> {
  const loaded = await loadJob(options.projectRoot, options.jobId);
  assertExpectedRevision(loaded.job, options.expectedRevision);
  const { task, index } = taskAt(loaded.job, options.chunkId);
  assertResultIdentity(loaded.job, task, options, (options.now ?? (() => new Date()))());
  await assertCurrentInput(options.projectRoot, loaded.job);
  await assertStoredChunk(options.projectRoot, loaded.job, task);
  const nextTask: IngestionChunkTask = {
    chunk_id: task.chunk_id,
    chunk_hash: task.chunk_hash,
    status: "failed",
    attempt: task.attempt,
    diagnostics: options.diagnostics.map(assertSafeSegment),
  };
  return persistMutation(loaded, replaceTask(loaded.job, index, nextTask), options);
}

export async function supersedeJob(options: SupersedeJobOptions): Promise<JobResult> {
  const loaded = await loadJob(options.projectRoot, options.jobId);
  assertExpectedRevision(loaded.job, options.expectedRevision);
  if (loaded.job.status === "superseded") fail("JOB_SUPERSEDED", `job 已 superseded：${loaded.job.id}`);
  const tasks = loaded.job.tasks.map((task): IngestionChunkTask => ({
    chunk_id: task.chunk_id,
    chunk_hash: task.chunk_hash,
    status: "superseded",
    attempt: task.attempt,
    ...(task.result_batch_id ? { result_batch_id: task.result_batch_id } : {}),
    ...(task.result_batch_hash ? { result_batch_hash: task.result_batch_hash } : {}),
    diagnostics: task.diagnostics,
  }));
  const nextJob = ingestionJobSchema.parse({
    ...loaded.job,
    revision: loaded.job.revision + 1,
    status: "superseded",
    tasks,
  });
  return persistMutation(loaded, nextJob, options);
}
