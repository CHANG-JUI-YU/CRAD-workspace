import { readFile } from "node:fs/promises";

import {
  candidateBatchSchema,
  factsCurationSummarySchema,
  workflowStateSchema,
  type FactCandidate,
  type FactsCurationSummary,
} from "@card-workspace/schemas";
import {
  assertSafeSegment,
  canonicalJson,
  computeRevision,
  resolveExistingWithin,
} from "@card-workspace/project";

import { validateCompletedJobResults } from "./jobs.js";
import { readHistoricalCandidateIndex } from "./projector.js";
import { createCandidateOccurrence } from "./candidate-occurrence.js";
import { IngestionError } from "./types.js";

export interface ActiveCandidateIndex {
  summary?: FactsCurationSummary;
  candidates: Map<string, FactCandidate>;
  batch_ids: string[];
}

export function resolveActiveCandidate(
  candidates: ReadonlyMap<string, FactCandidate>,
  candidateId: string,
): FactCandidate | undefined {
  const direct = candidates.get(candidateId);
  if (direct !== undefined) return direct;
  const matches = [...candidates.values()].filter((candidate) =>
    candidate.extensions.source_candidate_id === candidateId);
  return matches.length === 1 ? matches[0] : undefined;
}

function fail(message: string, cause?: unknown): never {
  throw new IngestionError("FACTS_ACTIVE_CURATION_INVALID", message, cause);
}

async function readJson(projectRoot: string, relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(await resolveExistingWithin(projectRoot, relativePath), "utf8"));
}

export async function readActiveCandidateIndex(projectRoot: string): Promise<ActiveCandidateIndex> {
  try {
    const workflow = workflowStateSchema.parse(await readJson(projectRoot, "workflow.json"));
    if (workflow.entry_kind !== "source_adaptation") {
      const historical = await readHistoricalCandidateIndex(projectRoot);
      return {
        candidates: new Map([...historical].filter(([id, candidate]) => id === candidate.id)),
        batch_ids: [],
      };
    }
    const task = [...workflow.tasks].reverse().find((item) =>
      item.kind === "curate-facts"
      && item.status === "completed"
      && item.result?.contract === "facts-curation-summary@1");
    if (!task?.result) fail("找不到 completed facts-curation-summary@1 task result");

    const resultId = assertSafeSegment(task.result.id);
    const taskId = assertSafeSegment(task.id);
    const summary = factsCurationSummarySchema.parse(await readJson(
      projectRoot,
      `.workflow/results/${taskId}/${resultId}.json`,
    ));
    if (summary.id !== resultId || summary.task_id !== taskId || computeRevision(summary) !== task.result.revision) {
      fail(`facts curation summary identity/revision 不符：${resultId}`);
    }
    if (new Set(summary.jobs.map((job) => job.job_id)).size !== summary.jobs.length) {
      fail(`facts curation summary 含重複 job：${resultId}`);
    }

    const candidates = new Map<string, FactCandidate>();
    const batchIds = new Set<string>();
    for (const jobRef of summary.jobs) {
      const completed = await validateCompletedJobResults(projectRoot, jobRef.job_id);
      const actualJob = completed.job;
      if (
        actualJob.input_revision !== jobRef.input_revision
        || actualJob.source_id !== jobRef.source_id
        || actualJob.source_revision_id !== jobRef.source_revision_id
        || actualJob.chunk_set_id !== jobRef.chunk_set_id
      ) {
        fail(`summary job identity 不符：${jobRef.job_id}`);
      }
      const actualResults = completed.results.map((result) => ({
        chunk_id: result.chunkId,
        chunk_hash: result.chunkHash,
        batch_id: result.batchId,
        batch_hash: result.batchHash,
      }));
      if (canonicalJson(actualResults) !== canonicalJson(jobRef.results)) {
        fail(`summary job results 不符：${jobRef.job_id}`);
      }
      for (const result of jobRef.results) {
        if (batchIds.has(result.batch_id)) fail(`summary 重複引用 batch：${result.batch_id}`);
        batchIds.add(result.batch_id);
        const batch = candidateBatchSchema.parse(await readJson(
          projectRoot,
          `facts/candidates/${assertSafeSegment(result.batch_id)}.json`,
        ));
        if (
          batch.id !== result.batch_id
          || batch.content_hash !== result.batch_hash
          || batch.job_id !== jobRef.job_id
          || batch.input_revision !== jobRef.input_revision
          || batch.chunk_id !== result.chunk_id
          || batch.chunk_hash !== result.chunk_hash
        ) {
          fail(`summary batch/job/chunk reference 不符：${result.batch_id}`);
        }
        for (const candidate of batch.candidates) {
          const occurrence = createCandidateOccurrence(batch.id, candidate);
          if (candidates.has(occurrence.id)) fail(`active candidate occurrence ID 重複：${occurrence.id}`);
          candidates.set(occurrence.id, occurrence);
        }
      }
    }
    return { summary, candidates, batch_ids: [...batchIds] };
  } catch (error) {
    if (error instanceof IngestionError && error.code === "FACTS_ACTIVE_CURATION_INVALID") throw error;
    fail("無法解析或驗證 active facts curation", error);
  }
}
