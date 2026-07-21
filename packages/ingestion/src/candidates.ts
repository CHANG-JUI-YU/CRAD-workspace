import { readFile, stat } from "node:fs/promises";

import {
  candidateBatchSchema,
  factCandidateSchema,
  type CandidateBatch,
  type FactCandidate,
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
import {
  completeChunkTask,
  getJobStatus,
  type CompleteChunkTaskOptions,
  type JobResult,
} from "./jobs.js";
import { getTextProjection, readSourceManifest, SOURCE_MANIFEST_PATH } from "./source-manifest.js";
import { IngestionError } from "./types.js";
import { diagnoseFactCandidateQuality } from "./fact-quality.js";

export interface SubmitCandidateBatchResult {
  batch: CandidateBatch;
  batchId: string;
  batchHash: Revision;
  idempotent: boolean;
  relativePath: string;
}

export type CandidateBatchDraft = Omit<CandidateBatch, "id" | "content_hash">;
export type MaterializedCandidateDraft = Omit<FactCandidate, "id" | "created_by" | "created_at">;
export type CandidateBatchMaterializationDraft = Omit<CandidateBatchDraft, "candidates" | "created_by"> & {
  candidates: readonly MaterializedCandidateDraft[];
};

export interface SubmitAndCompleteChunkCandidatesOptions
  extends Omit<CompleteChunkTaskOptions, "resultBatchId" | "resultBatchHash"> {
  batch: unknown;
}

export interface SubmitAndCompleteChunkCandidatesResult {
  submission: SubmitCandidateBatchResult;
  completion: JobResult;
  idempotent: boolean;
}

function fail(code: string, message: string, originalError?: unknown): never {
  throw new IngestionError(code, message, originalError);
}

function batchPath(batchId: string): string {
  return assertIngestionProjectPath(`facts/candidates/${assertSafeSegment(batchId)}.json`).relativePath;
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

async function readStateText(
  projectRoot: string,
  relativePath: string,
  code: string,
  message: string,
): Promise<string> {
  try {
    return await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8");
  } catch (error) {
    fail(code, message, error);
  }
}

function contentPayload(batch: CandidateBatchDraft): CandidateBatchDraft {
  return {
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
}

export function computeCandidateBatchHash(batch: CandidateBatchDraft): Revision {
  return computeRevision(contentPayload(batch));
}

export function candidateBatchId(contentHash: Revision): string {
  return `batch-${contentHash.slice("sha256:".length)}`;
}

export function createCandidateBatch(input: CandidateBatchDraft): CandidateBatch {
  const contentHash = computeCandidateBatchHash(input);
  return candidateBatchSchema.parse({
    ...input,
    id: candidateBatchId(contentHash),
    content_hash: contentHash,
  });
}

export function materializeCandidateBatch(
  input: CandidateBatchMaterializationDraft,
  trustedCreatedBy: string,
): CandidateBatch {
  const candidates = input.candidates.map((candidate, ordinal) => factCandidateSchema.parse({
    ...candidate,
    id: `candidate-${computeRevision({
      job_id: input.job_id,
      chunk_id: input.chunk_id,
      chunk_hash: input.chunk_hash,
      ordinal,
      candidate,
    }).slice("sha256:".length)}`,
    created_by: trustedCreatedBy,
    created_at: input.created_at,
  }));
  return createCandidateBatch({ ...input, candidates, created_by: trustedCreatedBy });
}

function parseBatch(input: unknown): CandidateBatch {
  const parsed = candidateBatchSchema.safeParse(input);
  if (!parsed.success) {
    fail("CANDIDATE_BATCH_INVALID", "candidate batch schema 無效", parsed.error);
  }
  return parsed.data;
}

function assertBatchIdentity(batch: CandidateBatch): void {
  const expectedHash = computeCandidateBatchHash(batch);
  if (batch.content_hash !== expectedHash) {
    fail("CANDIDATE_BATCH_HASH_MISMATCH", `candidate batch content hash 不符：${batch.id}`);
  }
  if (batch.id !== candidateBatchId(expectedHash)) {
    fail("CANDIDATE_BATCH_ID_MISMATCH", `candidate batch deterministic ID 不符：${batch.id}`);
  }
}

function assertCandidateGate(candidate: FactCandidate): void {
  if (candidate.status !== "submitted") {
    fail("CANDIDATE_STATUS_INVALID", `新 candidate status 必須是 submitted：${candidate.id}`);
  }
  if (candidate.classification !== "creative_completion" && candidate.evidence.length === 0) {
    fail("CANDIDATE_EVIDENCE_REQUIRED", `${candidate.classification} 需要 evidence：${candidate.id}`);
  }
  if (candidate.classification === "creative_completion" && !candidate.rationale) {
    fail("CANDIDATE_RATIONALE_REQUIRED", `creative_completion 需要 rationale：${candidate.id}`);
  }
  const evidenceIds = candidate.evidence.map((evidence) => evidence.id);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    fail("CANDIDATE_EVIDENCE_ID_DUPLICATE", `candidate evidence ID 不得重複：${candidate.id}`);
  }
  const diagnostics = diagnoseFactCandidateQuality(candidate);
  if (diagnostics.length > 0) {
    fail("CANDIDATE_PLACEHOLDER_FORBIDDEN", `candidate 含明確 test/placeholder 語意：${candidate.id}`, diagnostics);
  }
}

function assertExpectedJobRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 0 || actual !== expected) {
    fail("CANDIDATE_JOB_STATE_CONFLICT", `job revision 衝突：預期 ${expected}，實際 ${actual}`);
  }
}

export async function validateCandidateBatch(projectRoot: string, input: unknown): Promise<CandidateBatch> {
  const batch = parseBatch(input);
  assertBatchIdentity(batch);
  const candidateIds = batch.candidates.map((candidate) => candidate.id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    fail("CANDIDATE_ID_DUPLICATE", `candidate batch 含重複 candidate ID：${batch.id}`);
  }

  const manifest = await readSourceManifest(projectRoot);
  const source = manifest.sources.find((candidate) => candidate.id === batch.source_id);
  if (!source) fail("CANDIDATE_SOURCE_NOT_FOUND", `candidate batch source 不存在：${batch.source_id}`);
  if (
    source.current_revision_id !== batch.source_revision_id
    || source.current_chunk_set?.source_revision_id !== batch.source_revision_id
    || source.current_chunk_set.chunk_set_id !== batch.chunk_set_id
  ) {
    fail("CANDIDATE_SOURCE_STALE", `candidate batch source revision/chunk set 已過期：${batch.id}`);
  }

  const job = await getJobStatus(projectRoot, batch.job_id);
  if (
    job.source_id !== batch.source_id
    || job.source_revision_id !== batch.source_revision_id
    || job.chunk_set_id !== batch.chunk_set_id
  ) {
    fail("CANDIDATE_JOB_INPUT_MISMATCH", `candidate batch 與 job source input 不符：${batch.id}`);
  }
  if (job.input_revision !== batch.input_revision) {
    fail("CANDIDATE_JOB_REVISION_MISMATCH", `candidate batch job input revision 不符：${batch.id}`);
  }
  if (job.status === "superseded") {
    fail("CANDIDATE_JOB_SUPERSEDED", `candidate batch job 已 superseded：${batch.job_id}`);
  }
  const task = job.tasks.find((candidate) => candidate.chunk_id === batch.chunk_id);
  if (!task) {
    fail("CANDIDATE_JOB_CHUNK_NOT_FOUND", `candidate batch chunk 不存在於 job：${batch.chunk_id}`);
  }
  if (task.chunk_hash !== batch.chunk_hash) {
    fail("CANDIDATE_JOB_CHUNK_HASH_MISMATCH", `candidate batch chunk hash 與 job 不符：${batch.chunk_id}`);
  }

  const projection = await getTextProjection(projectRoot, batch.source_id, batch.source_revision_id);
  const artifacts = await verifyStoredChunkSet(
    projectRoot,
    batch.source_id,
    batch.source_revision_id,
    batch.chunk_set_id,
  );
  const chunks = new Map(artifacts.chunks.map((chunk) => [chunk.id, chunk]));
  for (const candidate of batch.candidates) {
    assertCandidateGate(candidate);
    for (const evidence of candidate.evidence) {
      if (
        evidence.source_id !== batch.source_id
        || evidence.source_revision_id !== batch.source_revision_id
        || evidence.chunk_set_id !== batch.chunk_set_id
      ) {
        fail("EVIDENCE_BATCH_CHAIN_MISMATCH", `evidence 不屬於提交 batch 的 source chain：${evidence.id}`);
      }
      if (evidence.chunk_id !== batch.chunk_id || evidence.chunk_hash !== batch.chunk_hash) {
        fail("EVIDENCE_BATCH_CHUNK_MISMATCH", `evidence 不屬於 candidate batch 指定 chunk：${evidence.id}`);
      }
      const chunk = chunks.get(evidence.chunk_id);
      if (!chunk) fail("EVIDENCE_CHUNK_NOT_FOUND", `evidence chunk 不存在：${evidence.chunk_id}`);
      validateEvidenceArtifacts(evidence, { projection, chunk });
    }
  }
  return batch;
}

async function readExistingBatch(projectRoot: string, relativePath: string): Promise<CandidateBatch> {
  try {
    return candidateBatchSchema.parse(
      JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8")),
    );
  } catch (error) {
    fail("CANDIDATE_BATCH_STORED_INVALID", `既有 candidate batch 無效：${relativePath}`, error);
  }
}

export async function submitCandidateBatch(
  projectRoot: string,
  input: unknown,
  expectedRevision: number,
): Promise<SubmitCandidateBatchResult> {
  const candidate = parseBatch(input);
  const relativePath = batchPath(candidate.id);
  if (await exists(projectRoot, relativePath)) {
    const existing = await readExistingBatch(projectRoot, relativePath);
    if (canonicalJson(existing) !== canonicalJson(candidate)) {
      fail("CANDIDATE_BATCH_CONFLICT", `同 ID candidate batch 已存在但 payload 不同：${candidate.id}`);
    }
    const batch = await validateCandidateBatch(projectRoot, candidate);
    assertExpectedJobRevision((await getJobStatus(projectRoot, batch.job_id)).revision, expectedRevision);
    return { batch, batchId: batch.id, batchHash: batch.content_hash, idempotent: true, relativePath };
  }

  const relativeJobPath = jobPath(candidate.job_id);
  const [manifestText, jobText] = await Promise.all([
    readStateText(
      projectRoot,
      SOURCE_MANIFEST_PATH,
      "CANDIDATE_SOURCE_STATE_INVALID",
      "無法擷取 candidate batch 的 source state",
    ),
    readStateText(
      projectRoot,
      relativeJobPath,
      "CANDIDATE_JOB_NOT_FOUND",
      `無法擷取 candidate batch job：${candidate.job_id}`,
    ),
  ]);
  const batch = await validateCandidateBatch(projectRoot, candidate);
  const job = await getJobStatus(projectRoot, batch.job_id);
  assertExpectedJobRevision(job.revision, expectedRevision);
  try {
    await runFileTransaction({
      root: projectRoot,
      operations: [{ relativePath, content: canonicalJson(batch), expectedAbsent: true }],
      expectations: [
        { relativePath: SOURCE_MANIFEST_PATH, expectedRawRevision: computeTextRevision(manifestText) },
        { relativePath: relativeJobPath, expectedRawRevision: computeTextRevision(jobText) },
      ],
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "TRANSACTION_TARGET_EXISTS") {
      const existing = await readExistingBatch(projectRoot, relativePath);
      if (canonicalJson(existing) === canonicalJson(batch)) {
        return { batch: existing, batchId: existing.id, batchHash: existing.content_hash, idempotent: true, relativePath };
      }
      fail("CANDIDATE_BATCH_CONFLICT", `同 ID candidate batch 已存在但 payload 不同：${batch.id}`, error);
    }
    if (code === "REVISION_CONFLICT" || code === "TRANSACTION_LOCKED") {
      fail("CANDIDATE_JOB_STATE_CONFLICT", `source/job 在 candidate batch 提交期間已變更：${batch.id}`, error);
    }
    throw error;
  }
  return { batch, batchId: batch.id, batchHash: batch.content_hash, idempotent: false, relativePath };
}

export async function submitAndCompleteChunkCandidates(
  options: SubmitAndCompleteChunkCandidatesOptions,
): Promise<SubmitAndCompleteChunkCandidatesResult> {
  const batch = parseBatch(options.batch);
  assertBatchIdentity(batch);
  const currentJob = await getJobStatus(options.projectRoot, options.jobId);
  const task = currentJob.tasks.find((candidate) => candidate.chunk_id === options.chunkId);
  if (task?.status === "completed") {
    if (task.result_batch_id !== batch.id || task.result_batch_hash !== batch.content_hash) {
      fail("CANDIDATE_CHUNK_RESULT_CONFLICT", `chunk 已由不同 candidate batch 完成：${options.chunkId}`);
    }
    const submission = await submitCandidateBatch(options.projectRoot, batch, currentJob.revision);
    return {
      submission,
      completion: { job: currentJob, idempotent: true },
      idempotent: true,
    };
  }

  const submission = await submitCandidateBatch(options.projectRoot, batch, options.expectedRevision);
  const completion = await completeChunkTask({
    ...options,
    resultBatchId: submission.batchId,
    resultBatchHash: submission.batchHash,
  });
  return { submission, completion, idempotent: false };
}
