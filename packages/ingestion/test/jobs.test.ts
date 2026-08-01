import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, computeRevision, initializeProject } from "@card-workspace/project";
import {
  journalEventEnvelopeSchema,
  projectManifestSchema,
  type CandidateBatch,
  type ChunkProfile,
} from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimChunkTask,
  completeChunkTask,
  computeCandidateBatchHash,
  createChunkSet,
  createExtractionJob,
  DEFAULT_CHUNK_PROFILE,
  eventSemanticRevision,
  failChunkTask,
  getJobStatus,
  intakeLocalSource,
  readActiveCandidateIndex,
  readFactProjection,
  readHistoricalCandidateIndex,
  readJobChunkPayload,
  storeChunkSet,
  submitAndCompleteChunkCandidates,
  submitCandidateBatch,
  supersedeJob,
  reviewCandidate,
  validateCompletedJobResults,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const t0 = new Date("2026-07-13T10:00:00.000Z");
const sha = (character: string) => `sha256:${character.repeat(64)}` as const;

function profile(): ChunkProfile {
  return { ...DEFAULT_CHUNK_PROFILE, target_tokens: 5_000, overlap_tokens: 500 };
}

async function fixture(text = "word ".repeat(6_000)) {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "jobs-demo",
      title: "Jobs Demo",
      kind: "character_card",
      card: { name: "Demo" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  const filePath = path.join(workspace.root, "novel.txt");
  await writeFile(filePath, text, "utf8");
  const intake = await intakeLocalSource({ projectRoot, filePath, sourceId: "novel", title: "Novel" });
  const chunks = createChunkSet({ projection: intake.projection, profile: profile() });
  await storeChunkSet({ projectRoot, artifacts: chunks, actor: "tester", timestamp: t0.toISOString() });
  const created = await createExtractionJob({
    projectRoot,
    sourceId: "novel",
    sourceRevisionId: intake.revision.id,
    chunkSetId: chunks.manifest.id,
    createdBy: "tester",
    now: () => t0,
  });
  return { workspace, projectRoot, filePath, intake, chunks, created };
}

function claimOptions(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  return {
    projectRoot: f.projectRoot,
    jobId: f.created.job.id,
    chunkId: f.created.job.tasks[0]!.chunk_id,
    expectedRevision: f.created.job.revision,
    owner: "worker-1",
    leaseId: "lease-1",
    leaseDurationMs: 60_000,
    actor: "worker-1",
    now: () => t0,
    ...overrides,
  };
}

function resultIdentity(f: Awaited<ReturnType<typeof fixture>>, revision: number, overrides: Record<string, unknown> = {}) {
  const task = f.created.job.tasks[0]!;
  return {
    projectRoot: f.projectRoot,
    jobId: f.created.job.id,
    chunkId: task.chunk_id,
    expectedRevision: revision,
    leaseId: "lease-1",
    owner: "worker-1",
    sourceRevisionId: f.created.job.source_revision_id,
    chunkSetId: f.created.job.chunk_set_id,
    chunkHash: task.chunk_hash,
    actor: "worker-1",
    now: () => new Date(t0.getTime() + 1_000),
    ...overrides,
  };
}

function creativeBatch(
  f: Awaited<ReturnType<typeof fixture>>,
  chunkId: string,
  suffix: string,
): CandidateBatch {
  const draft = {
    schema_version: 1 as const,
    id: `batch-${"0".repeat(64)}`,
    source_id: f.created.job.source_id,
    source_revision_id: f.created.job.source_revision_id,
    chunk_set_id: f.created.job.chunk_set_id,
    chunk_id: chunkId,
    chunk_hash: f.created.job.tasks.find((task) => task.chunk_id === chunkId)!.chunk_hash,
    job_id: f.created.job.id,
    input_revision: f.created.job.input_revision,
    candidates: [{
      schema_version: 1 as const,
      id: `candidate-${suffix}`,
      subject: "alice",
      predicate: "notes",
      value: `result-${suffix}`,
      classification: "creative_completion" as const,
      confidence: 1,
      scope: { character_ids: [], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [],
      rationale: "job unit test result",
      status: "submitted" as const,
      created_by: "worker-1",
      created_at: t0.toISOString(),
      extensions: {},
    }],
    created_by: "worker-1",
    created_at: t0.toISOString(),
    content_hash: sha("0"),
    extensions: {},
  };
  const contentHash = computeCandidateBatchHash(draft);
  return {
    ...draft,
    id: `batch-${contentHash.slice("sha256:".length)}`,
    content_hash: contentHash,
  };
}

function emptyBatch(f: Awaited<ReturnType<typeof fixture>>, chunkId: string): CandidateBatch {
  const draft = { ...creativeBatch(f, chunkId, "empty"), candidates: [] };
  const contentHash = computeCandidateBatchHash(draft);
  return { ...draft, id: `batch-${contentHash.slice("sha256:".length)}`, content_hash: contentHash };
}

async function submitCreativeBatch(
  f: Awaited<ReturnType<typeof fixture>>,
  jobRevision: number,
  chunkId: string,
  suffix: string,
) {
  return submitCandidateBatch(f.projectRoot, creativeBatch(f, chunkId, suffix), jobRevision);
}

describe("resumable ingestion jobs", () => {
  it("由 verified chunk set 建立 deterministic、idempotent immutable identity", async () => {
    const f = await fixture();
    const retry = await createExtractionJob({
      projectRoot: f.projectRoot,
      sourceId: "novel",
      sourceRevisionId: f.intake.revision.id,
      chunkSetId: f.chunks.manifest.id,
      createdBy: "another-user",
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(f.created.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(retry.job).toEqual(f.created.job);
    expect(retry.job.tasks.map((task) => task.chunk_id)).toEqual(f.chunks.manifest.chunk_ids);
    expect(retry.job.input_revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const legacyIdentity = {
      kind: "fact_extraction",
      source_id: f.created.job.source_id,
      source_revision_id: f.created.job.source_revision_id,
      chunk_set_id: f.created.job.chunk_set_id,
      chunks: f.created.job.tasks.map((task) => ({ chunk_id: task.chunk_id, chunk_hash: task.chunk_hash })),
    };
    expect(f.created.job.input_revision).toBe(computeRevision(legacyIdentity));
    expect(f.created.job.id).toBe(`job-${computeRevision(legacyIdentity).slice("sha256:".length)}`);
    expect(f.created.job.extensions).toEqual({});
  });

  it("includes optional curation run identity without changing legacy job IDs", async () => {
    const f = await fixture("short source");
    const first = await createExtractionJob({
      projectRoot: f.projectRoot, sourceId: "novel", sourceRevisionId: f.intake.revision.id,
      chunkSetId: f.chunks.manifest.id, createdBy: "tester", curationRunId: "quality-1", now: () => t0,
    });
    const retry = await createExtractionJob({
      projectRoot: f.projectRoot, sourceId: "novel", sourceRevisionId: f.intake.revision.id,
      chunkSetId: f.chunks.manifest.id, createdBy: "other", curationRunId: "quality-1", now: () => t0,
    });
    const second = await createExtractionJob({
      projectRoot: f.projectRoot, sourceId: "novel", sourceRevisionId: f.intake.revision.id,
      chunkSetId: f.chunks.manifest.id, createdBy: "tester", curationRunId: "quality-2", now: () => t0,
    });
    expect(first.job.id).not.toBe(f.created.job.id);
    expect(second.job.id).not.toBe(first.job.id);
    expect(first.job.extensions).toEqual({ curation_run_id: "quality-1" });
    expect(retry).toMatchObject({ idempotent: true, job: first.job });
  });

  it("claim/complete 驗 lease 與 batch，全部 task 完成才 completed", async () => {
    const f = await fixture();
    let job = (await claimChunkTask(claimOptions(f))).job;
    expect(job.tasks[0]).toMatchObject({ status: "processing", attempt: 1 });
    let batch = await submitCreativeBatch(f, job.revision, job.tasks[0]!.chunk_id, "0");
    job = (await completeChunkTask({
      ...resultIdentity(f, job.revision),
      resultBatchId: batch.batchId,
      resultBatchHash: batch.batchHash,
    })).job;
    expect(job.status).toBe(f.chunks.chunks.length === 1 ? "completed" : "pending");

    for (const [index, task] of job.tasks.entries()) {
      if (task.status === "completed") continue;
      job = (await claimChunkTask({
        ...claimOptions(f),
        chunkId: task.chunk_id,
        expectedRevision: job.revision,
        leaseId: `lease-${index + 1}`,
      })).job;
      batch = await submitCreativeBatch(f, job.revision, task.chunk_id, String(index + 1));
      job = (await completeChunkTask({
        ...resultIdentity(f, job.revision),
        chunkId: task.chunk_id,
        chunkHash: task.chunk_hash,
        leaseId: `lease-${index + 1}`,
        resultBatchId: batch.batchId,
        resultBatchHash: batch.batchHash,
      })).job;
    }
    expect(job.status).toBe("completed");
    expect(job.tasks.every((task) => task.status === "completed")).toBe(true);
  });

  it("讀取 claim 後 chunk payload 會驗證 job immutable identity 與完整 chunk set", async () => {
    const f = await fixture("short source");
    const claimed = await claimChunkTask(claimOptions(f));
    const payload = await readJobChunkPayload(f.projectRoot, f.created.job.id, f.created.job.tasks[0]!.chunk_id);
    expect(payload.job).toEqual(claimed.job);
    expect(payload.task).toEqual(claimed.job.tasks[0]);
    expect(payload.chunk).toEqual(f.chunks.chunks[0]);
  });

  it("submit-and-complete saga 可由已寫 batch 或已完成 result 冪等恢復，並產生 completed summary", async () => {
    const f = await fixture("short source");
    const claimed = await claimChunkTask(claimOptions(f));
    const task = claimed.job.tasks[0]!;
    const batch = creativeBatch(f, task.chunk_id, "saga");
    let injectCompletionFailure = true;
    const options = {
      ...resultIdentity(f, claimed.job.revision),
      batch,
      beforePublish: (index: number) => {
        if (injectCompletionFailure && index === 1) throw new Error("injected saga completion failure");
      },
    };
    await expect(submitAndCompleteChunkCandidates(options)).rejects.toThrow("injected saga completion failure");
    await expect(readFile(path.join(f.projectRoot, "facts/candidates", `${batch.id}.json`), "utf8")).resolves.toBeDefined();
    expect((await getJobStatus(f.projectRoot, f.created.job.id)).tasks[0]!.status).toBe("processing");

    injectCompletionFailure = false;
    const recovered = await submitAndCompleteChunkCandidates(options);
    expect(recovered.idempotent).toBe(false);
    expect(recovered.submission.idempotent).toBe(true);
    expect(recovered.completion.job.status).toBe("completed");

    const retry = await submitAndCompleteChunkCandidates(options);
    expect(retry.idempotent).toBe(true);
    expect(retry.submission.idempotent).toBe(true);
    expect(retry.completion).toMatchObject({ idempotent: true, job: recovered.completion.job });
    await expect(submitAndCompleteChunkCandidates({
      ...options,
      batch: creativeBatch(f, task.chunk_id, "different"),
    })).rejects.toMatchObject({ code: "CANDIDATE_CHUNK_RESULT_CONFLICT" });

    await expect(validateCompletedJobResults(f.projectRoot, f.created.job.id)).resolves.toEqual({
      job: recovered.completion.job,
      results: [{
        chunkId: task.chunk_id,
        chunkHash: task.chunk_hash,
        batchId: batch.id,
        batchHash: batch.content_hash,
      }],
    });
    const storedBatchPath = path.join(f.projectRoot, "facts/candidates", `${batch.id}.json`);
    const tampered = JSON.parse(await readFile(storedBatchPath, "utf8")) as Record<string, unknown>;
    tampered.created_by = "tampered-worker";
    await writeFile(storedBatchPath, JSON.stringify(tampered), "utf8");
    await expect(validateCompletedJobResults(f.projectRoot, f.created.job.id)).rejects.toMatchObject({
      code: "JOB_RESULT_BATCH_MISMATCH",
    });
  });

  it("active index 以 occurrence IDs 回傳跨 batch 重複 raw candidates，並排除 orphan", async () => {
    const f = await fixture();
    expect(f.created.job.tasks.length).toBeGreaterThan(1);
    let job = f.created.job;
    let firstBatchId = "";
    for (const [index, pending] of job.tasks.entries()) {
      const claimed = await claimChunkTask({
        ...claimOptions(f),
        chunkId: pending.chunk_id,
        expectedRevision: job.revision,
        leaseId: `lease-active-${index}`,
      });
      const task = claimed.job.tasks.find((item) => item.chunk_id === pending.chunk_id)!;
      const activeBatch = creativeBatch(f, task.chunk_id, "duplicate");
      const completed = await submitAndCompleteChunkCandidates({
        ...resultIdentity(f, claimed.job.revision),
        chunkId: task.chunk_id,
        chunkHash: task.chunk_hash,
        leaseId: `lease-active-${index}`,
        batch: activeBatch,
      });
      firstBatchId ||= completed.submission.batchId;
      job = completed.completion.job;
    }
    const validated = await validateCompletedJobResults(f.projectRoot, f.created.job.id);
    const summary = {
      schema_version: 1 as const,
      id: "facts-summary",
      task_id: "curate-facts",
      jobs: [{
        job_id: validated.job.id,
        input_revision: validated.job.input_revision,
        source_id: validated.job.source_id,
        source_revision_id: validated.job.source_revision_id,
        chunk_set_id: validated.job.chunk_set_id,
        results: validated.results.map((result) => ({
          chunk_id: result.chunkId,
          chunk_hash: result.chunkHash,
          batch_id: result.batchId,
          batch_hash: result.batchHash,
        })),
      }],
      created_by: "curator",
      created_at: t0.toISOString(),
      extensions: {},
    };
    const result = { id: summary.id, revision: computeRevision(summary), contract: "facts-curation-summary@1" };
    const workflow = JSON.parse(await readFile(path.join(f.projectRoot, "workflow.json"), "utf8")) as Record<string, unknown>;
    const activeWorkflow = {
      ...workflow,
      entry_kind: "source_adaptation",
      stage: "facts_review",
      tasks: [{
        id: "curate-facts",
        kind: "curate-facts",
        status: "completed",
        assigned_agent: "fact-curator",
        capabilities: ["facts.propose"],
        input_artifacts: [],
        output_contract: "facts-curation-summary@1",
        dependencies: [],
        attempt: 1,
        max_attempts: 3,
        result,
        extensions: {},
      }],
    };
    const resultDirectory = path.join(f.projectRoot, ".workflow", "results", "curate-facts");
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(path.join(resultDirectory, "facts-summary.json"), canonicalJson(summary), "utf8");
    await writeFile(path.join(f.projectRoot, "workflow.json"), canonicalJson(activeWorkflow), "utf8");

    const task = f.created.job.tasks[0]!;
    const orphanBatch = creativeBatch(f, task.chunk_id, "duplicate");
    orphanBatch.id = `${orphanBatch.id}-orphan`;
    await writeFile(path.join(f.projectRoot, "facts", "candidates", `${orphanBatch.id}.json`), canonicalJson(orphanBatch), "utf8");
    const historical = await readHistoricalCandidateIndex(f.projectRoot);
    expect(historical.has("candidate-duplicate")).toBe(false);
    const active = await readActiveCandidateIndex(f.projectRoot);
    expect(active.candidates.size).toBe(f.created.job.tasks.length);
    expect([...active.candidates.keys()].every((id) => /^candidate-occurrence-[a-f0-9]{64}$/u.test(id))).toBe(true);
    expect(new Set([...active.candidates.values()].map((item) => item.extensions.source_candidate_id)))
      .toEqual(new Set(["candidate-duplicate"]));
    expect(active.batch_ids).toContain(firstBatchId);
    expect(active.batch_ids).not.toContain(orphanBatch.id);

    let projection = await readFactProjection(f.projectRoot);
    for (const [index, occurrenceId] of [...active.candidates.keys()].entries()) {
      const reviewed = await reviewCandidate(f.projectRoot, {
        decision: {
          schema_version: 1,
          id: `decision-occurrence-${index}`,
          candidate_id: occurrenceId,
          fact_id: `fact-occurrence-${index}`,
          type: "rejected",
          rationale: "independent occurrence review",
          actor: "director",
          decided_at: t0.toISOString(),
        },
        expectedProjectionRevision: projection.register.revision,
      });
      projection = reviewed.projection;
    }
    expect(projection.register.facts).toHaveLength(active.candidates.size);

    const tampered = structuredClone(summary);
    tampered.jobs[0]!.results[0]!.chunk_hash = sha("f");
    const tamperedWorkflow = structuredClone(activeWorkflow);
    tamperedWorkflow.tasks[0]!.result.revision = computeRevision(tampered);
    await writeFile(path.join(resultDirectory, "facts-summary.json"), canonicalJson(tampered), "utf8");
    await writeFile(path.join(f.projectRoot, "workflow.json"), canonicalJson(tamperedWorkflow), "utf8");
    await expect(readActiveCandidateIndex(f.projectRoot)).rejects.toMatchObject({ code: "FACTS_ACTIVE_CURATION_INVALID" });
  });

  it("submit-and-complete 接受空 candidate batch 並完成 chunk", async () => {
    const f = await fixture("short source");
    const claimed = await claimChunkTask(claimOptions(f));
    const task = claimed.job.tasks[0]!;
    const completed = await submitAndCompleteChunkCandidates({
      ...resultIdentity(f, claimed.job.revision),
      batch: emptyBatch(f, task.chunk_id),
    });
    expect(completed.submission.batch.candidates).toEqual([]);
    expect(completed.completion.job).toMatchObject({ status: "completed", tasks: [{ status: "completed" }] });
  });

  it("complete task 拒絕引用同 job 其他 chunk 的 batch", async () => {
    const f = await fixture();
    expect(f.created.job.tasks.length).toBeGreaterThan(1);
    const firstClaim = await claimChunkTask(claimOptions(f));
    const firstTask = firstClaim.job.tasks[0]!;
    const batch = await submitCreativeBatch(f, firstClaim.job.revision, firstTask.chunk_id, "first");
    const secondTask = firstClaim.job.tasks[1]!;
    const secondClaim = await claimChunkTask({
      ...claimOptions(f),
      chunkId: secondTask.chunk_id,
      expectedRevision: firstClaim.job.revision,
      leaseId: "lease-2",
    });
    await expect(completeChunkTask({
      ...resultIdentity(f, secondClaim.job.revision),
      chunkId: secondTask.chunk_id,
      chunkHash: secondTask.chunk_hash,
      leaseId: "lease-2",
      resultBatchId: batch.batchId,
      resultBatchHash: batch.batchHash,
    })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_MISMATCH" });
  });

  it("並行 claim 以 raw revision CAS 保證只有一方成功", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      claimChunkTask(claimOptions(f, { leaseId: "lease-a", owner: "worker-a" })),
      claimChunkTask(claimOptions(f, { leaseId: "lease-b", owner: "worker-b" })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "JOB_REVISION_CONFLICT" } });
    expect((await getJobStatus(f.projectRoot, f.created.job.id)).tasks[0]!.attempt).toBe(1);
  });

  it("session 中斷後 expired processing 可重 claim，attempt 單調且舊 lease 拒絕", async () => {
    const f = await fixture();
    const first = await claimChunkTask(claimOptions(f, { leaseDurationMs: 1_000 }));
    const resumedAt = new Date(t0.getTime() + 1_001);
    const resumed = await claimChunkTask(claimOptions(f, {
      expectedRevision: first.job.revision,
      leaseId: "lease-2",
      owner: "worker-2",
      now: () => resumedAt,
    }));
    expect(resumed.job.tasks[0]).toMatchObject({ status: "processing", attempt: 2, lease: { id: "lease-2" } });
    await expect(completeChunkTask({
      ...resultIdentity(f, resumed.job.revision),
      resultBatchId: "batch-late",
      resultBatchHash: sha("c"),
      now: () => resumedAt,
    })).rejects.toMatchObject({ code: "JOB_LEASE_STALE" });
  });

  it("failed task 不完成 job且可續接重試", async () => {
    const f = await fixture();
    const claimed = await claimChunkTask(claimOptions(f));
    const failed = await failChunkTask({
      ...resultIdentity(f, claimed.job.revision),
      diagnostics: ["model-timeout"],
    });
    expect(failed.job).toMatchObject({ status: "failed" });
    expect(failed.job.tasks[0]).toMatchObject({ status: "failed", attempt: 1, diagnostics: ["model-timeout"] });
    const retried = await claimChunkTask(claimOptions(f, {
      expectedRevision: failed.job.revision,
      leaseId: "lease-2",
    }));
    expect(retried.job.tasks[0]).toMatchObject({ status: "processing", attempt: 2 });
  });

  it("拒絕錯 chunk hash、過期 lease、舊 source revision與 superseded 結果", async () => {
    const wrongHashFixture = await fixture();
    const wrongHashClaim = await claimChunkTask(claimOptions(wrongHashFixture));
    await expect(completeChunkTask({
      ...resultIdentity(wrongHashFixture, wrongHashClaim.job.revision, { chunkHash: sha("f") }),
      resultBatchId: "batch-1",
      resultBatchHash: sha("b"),
    })).rejects.toMatchObject({ code: "JOB_CHUNK_HASH_MISMATCH" });

    const expiredFixture = await fixture();
    const expiredClaim = await claimChunkTask(claimOptions(expiredFixture, { leaseDurationMs: 1_000 }));
    await expect(failChunkTask({
      ...resultIdentity(expiredFixture, expiredClaim.job.revision, { now: () => new Date(t0.getTime() + 1_001) }),
      diagnostics: ["late"],
    })).rejects.toMatchObject({ code: "JOB_LEASE_STALE" });

    const staleFixture = await fixture();
    const staleClaim = await claimChunkTask(claimOptions(staleFixture));
    await writeFile(staleFixture.filePath, "new revision", "utf8");
    await intakeLocalSource({
      projectRoot: staleFixture.projectRoot,
      filePath: staleFixture.filePath,
      sourceId: "novel",
      title: "Novel",
    });
    await expect(completeChunkTask({
      ...resultIdentity(staleFixture, staleClaim.job.revision),
      resultBatchId: "batch-stale",
      resultBatchHash: sha("d"),
    })).rejects.toMatchObject({ code: "JOB_INPUT_STALE" });

    const supersededFixture = await fixture();
    const supersededClaim = await claimChunkTask(claimOptions(supersededFixture));
    const superseded = await supersedeJob({
      projectRoot: supersededFixture.projectRoot,
      jobId: supersededFixture.created.job.id,
      expectedRevision: supersededClaim.job.revision,
      actor: "tester",
      now: () => t0,
    });
    expect(superseded.job.tasks.every((task) => task.status === "superseded" && task.lease === undefined)).toBe(true);
    await expect(completeChunkTask({
      ...resultIdentity(supersededFixture, superseded.job.revision),
      resultBatchId: "batch-late",
      resultBatchHash: sha("e"),
    })).rejects.toMatchObject({ code: "JOB_SUPERSEDED" });
  });

  it("transaction failure 不造成 processing/completed 或 event chain 漂移", async () => {
    const f = await fixture();
    const jobBefore = await getJobStatus(f.projectRoot, f.created.job.id);
    const journalPath = path.join(f.projectRoot, "sources/journals/source-events.jsonl");
    const journalBefore = await readFile(journalPath, "utf8");
    await expect(claimChunkTask(claimOptions(f, {
      beforePublish: (index: number) => {
        if (index === 1) throw new Error("injected job failure");
      },
    }))).rejects.toThrow("injected job failure");
    expect(await getJobStatus(f.projectRoot, f.created.job.id)).toEqual(jobBefore);
    await expect(readFile(journalPath, "utf8")).resolves.toBe(journalBefore);

    const claimed = await claimChunkTask(claimOptions(f));
    const journalClaimed = await readFile(journalPath, "utf8");
    const batch = await submitCreativeBatch(f, claimed.job.revision, claimed.job.tasks[0]!.chunk_id, "failure");
    await expect(completeChunkTask({
      ...resultIdentity(f, claimed.job.revision),
      resultBatchId: batch.batchId,
      resultBatchHash: batch.batchHash,
      beforePublish: (index: number) => {
        if (index === 1) throw new Error("injected completion failure");
      },
    })).rejects.toThrow("injected completion failure");
    expect((await getJobStatus(f.projectRoot, f.created.job.id)).tasks[0]!.status).toBe("processing");
    await expect(readFile(journalPath, "utf8")).resolves.toBe(journalClaimed);

    const events = journalClaimed.trimEnd().split("\n").map((line) => journalEventEnvelopeSchema.parse(JSON.parse(line)));
    const sourceEvents = events.filter((event) => event.aggregate_id === "novel");
    for (let index = 1; index < sourceEvents.length; index += 1) {
      expect(sourceEvents[index].prior_revision).toBe(eventSemanticRevision(sourceEvents[index - 1]));
    }
  });
  it("covers job identity, lease, task, result, and supersede guard branches", async () => {
    const f = await fixture("short source");
    await expect(getJobStatus(f.projectRoot, "job-missing")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    await mkdir(path.join(f.projectRoot, "sources", "jobs"), { recursive: true });
    await writeFile(path.join(f.projectRoot, "sources", "jobs", "job-malformed.json"), "not-json\n", "utf8");
    await expect(getJobStatus(f.projectRoot, "job-malformed")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    const jobFile = path.join(f.projectRoot, "sources", "jobs", f.created.job.id + ".json");
    const pendingRaw = JSON.parse(await readFile(jobFile, "utf8")) as Record<string, unknown>;
    await writeFile(jobFile, JSON.stringify({
      ...pendingRaw,
      status: "completed",
      tasks: (pendingRaw.tasks as Array<Record<string, unknown>>).map((task) => ({ ...task, status: "completed", result_batch_id: "batch-missing", result_batch_hash: sha("a") })),
    }), "utf8");
    await expect(validateCompletedJobResults(f.projectRoot, f.created.job.id)).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_INVALID" });
    await writeFile(jobFile, JSON.stringify(pendingRaw), "utf8");    await expect(readJobChunkPayload(f.projectRoot, f.created.job.id, "chunk-missing")).rejects.toMatchObject({ code: "JOB_TASK_NOT_FOUND" });
    await expect(claimChunkTask(claimOptions(f, { leaseDurationMs: 0 }))).rejects.toMatchObject({ code: "JOB_LEASE_DURATION_INVALID" });
    await expect(claimChunkTask(claimOptions(f, { expectedRevision: -1 }))).rejects.toMatchObject({ code: "JOB_REVISION_CONFLICT" });
    await expect(claimChunkTask(claimOptions(f, { chunkId: "chunk-missing" }))).rejects.toMatchObject({ code: "JOB_TASK_NOT_FOUND" });

    const claimed = await claimChunkTask(claimOptions(f));
    await expect(claimChunkTask({ ...claimOptions(f), expectedRevision: claimed.job.revision, leaseId: "lease-2" }))
      .rejects.toMatchObject({ code: "JOB_TASK_NOT_CLAIMABLE" });
    await expect(completeChunkTask({
      ...resultIdentity(f, claimed.job.revision), resultBatchId: "batch-missing", resultBatchHash: sha("a"),
    })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_INVALID" });
    await expect(failChunkTask({
      ...resultIdentity(f, claimed.job.revision), owner: "other-worker", diagnostics: ["failed"],
    })).rejects.toMatchObject({ code: "JOB_LEASE_STALE" });
    await expect(failChunkTask({
      ...resultIdentity(f, claimed.job.revision), chunkHash: sha("f"), diagnostics: ["failed"],
    })).rejects.toMatchObject({ code: "JOB_CHUNK_HASH_MISMATCH" });

    const failed = await failChunkTask({
      ...resultIdentity(f, claimed.job.revision), diagnostics: ["provider-timeout"],
    });
    expect(failed.job.status).toBe("failed");
    const superseded = await supersedeJob({ projectRoot: f.projectRoot, jobId: f.created.job.id, expectedRevision: failed.job.revision, actor: "tester", now: () => t0 });
    expect(superseded.job.status).toBe("superseded");
    await expect(supersedeJob({ projectRoot: f.projectRoot, jobId: f.created.job.id, expectedRevision: superseded.job.revision, actor: "tester", now: () => t0 }))
      .rejects.toMatchObject({ code: "JOB_SUPERSEDED" });
    await expect(claimChunkTask({ ...claimOptions(f), expectedRevision: superseded.job.revision }))
      .rejects.toMatchObject({ code: "JOB_SUPERSEDED" });
  });

  it("covers empty jobs, immutable identity drift, and explicit result-input guards", async () => {
    const empty = await fixture("");
    expect(empty.created.job.status).toBe("completed");
    expect(empty.created.job.tasks).toEqual([]);
    await expect(validateCompletedJobResults(empty.projectRoot, empty.created.job.id)).resolves.toMatchObject({ results: [] });

    const f = await fixture("short source");
    const jobFile = path.join(f.projectRoot, "sources", "jobs", f.created.job.id + ".json");
    const original = JSON.parse(await readFile(jobFile, "utf8")) as Record<string, unknown>;
    await writeFile(jobFile, JSON.stringify({ ...original, id: "wrong-id" }), "utf8");
    await expect(getJobStatus(f.projectRoot, f.created.job.id)).rejects.toMatchObject({ code: "JOB_IDENTITY_MISMATCH" });
    await writeFile(jobFile, JSON.stringify(original), "utf8");
    await writeFile(jobFile, JSON.stringify({ ...original, input_revision: sha("a") }), "utf8");
    await expect(getJobStatus(f.projectRoot, f.created.job.id)).rejects.toMatchObject({ code: "JOB_IDENTITY_MISMATCH" });
    await writeFile(jobFile, JSON.stringify(original), "utf8");

    await expect(claimChunkTask(claimOptions(f, { owner: "bad/owner" }))).rejects.toThrow();
    const claimed = await claimChunkTask(claimOptions(f));
    await expect(completeChunkTask({
      ...resultIdentity(f, claimed.job.revision),
      sourceRevisionId: sha("z"),
      resultBatchId: "batch-missing",
      resultBatchHash: sha("a"),
    })).rejects.toMatchObject({ code: "JOB_INPUT_MISMATCH" });
    await expect(completeChunkTask({
      ...resultIdentity(f, claimed.job.revision),
      chunkSetId: "other-set",
      resultBatchId: "batch-missing",
      resultBatchHash: sha("a"),
    })).rejects.toMatchObject({ code: "JOB_INPUT_MISMATCH" });

  });
  it("rejects stored candidate batches with submitted-state and evidence identity drift", async () => {
    const f = await fixture("short source");
    const claimed = await claimChunkTask(claimOptions(f));
    const task = claimed.job.tasks[0]!;
    const original = await submitCreativeBatch(f, claimed.job.revision, task.chunk_id, "status-drift");
    const storedPath = path.join(f.projectRoot, "facts", "candidates", original.batchId + ".json");
    const raw = JSON.parse(await readFile(storedPath, "utf8")) as CandidateBatch;
    const rejected = {
      ...raw,
      candidates: raw.candidates.map((candidate) => ({ ...candidate, status: "rejected" as const })),
    };
    const rejectedHash = computeCandidateBatchHash(rejected);
    const rejectedBatch = {
      ...rejected,
      id: "batch-" + rejectedHash.slice("sha256:".length),
      content_hash: rejectedHash,
    };
    await writeFile(path.join(f.projectRoot, "facts", "candidates", rejectedBatch.id + ".json"), canonicalJson(rejectedBatch), "utf8");
    await expect(completeChunkTask({
      ...resultIdentity(f, claimed.job.revision),
      resultBatchId: rejectedBatch.id,
      resultBatchHash: rejectedBatch.content_hash,
    })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_MISMATCH" });
  });
});

it("covers ingestion job read, claim, completion, and malformed persistence guards", async () => {
  const fixtureValue = await fixture("word ".repeat(200));
  const job = fixtureValue.created.job;
  const task = job.tasks[0]!;
  await expect(getJobStatus(fixtureValue.projectRoot, "missing-job")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  await expect(readJobChunkPayload(fixtureValue.projectRoot, job.id, "missing-chunk")).rejects.toMatchObject({ code: "JOB_TASK_NOT_FOUND" });
  await expect(validateCompletedJobResults(fixtureValue.projectRoot, job.id)).rejects.toMatchObject({ code: "JOB_NOT_COMPLETED" });
  await expect(claimChunkTask({
    projectRoot: fixtureValue.projectRoot,
    jobId: job.id,
    chunkId: task.chunk_id,
    expectedRevision: job.revision,
    owner: "tester",
    leaseId: "invalid-duration",
    leaseDurationMs: 0,
  })).rejects.toMatchObject({ code: "JOB_LEASE_DURATION_INVALID" });
  await expect(claimChunkTask({
    projectRoot: fixtureValue.projectRoot,
    jobId: job.id,
    chunkId: task.chunk_id,
    expectedRevision: job.revision + 1,
    owner: "tester",
    leaseId: "lease",
    leaseDurationMs: 1000,
  })).rejects.toMatchObject({ code: "JOB_REVISION_CONFLICT" });

  await mkdir(path.join(fixtureValue.projectRoot, "sources", "jobs"), { recursive: true });
  await writeFile(path.join(fixtureValue.projectRoot, "sources", "jobs", "malformed.json"), "not-json", "utf8");
  await expect(getJobStatus(fixtureValue.projectRoot, "malformed")).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
});


it("covers remaining ingestion job status and stored-batch branch edges", async () => {
  const empty = await fixture("");
  await expect(claimChunkTask({ projectRoot: empty.projectRoot, jobId: empty.created.job.id, chunkId: "missing", expectedRevision: empty.created.job.revision, owner: "worker", leaseId: "lease", leaseDurationMs: 1000, actor: "worker", now: () => t0 })).rejects.toMatchObject({ code: "JOB_COMPLETED" });
  const f = await fixture("short source");

  const claimed = await claimChunkTask(claimOptions(f));
  const task = claimed.job.tasks[0]!;
  const submitted = await submitCreativeBatch(f, claimed.job.revision, task.chunk_id, "duplicate-candidate");
  const batchPath = path.join(f.projectRoot, "facts", "candidates", submitted.batchId + ".json");
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as CandidateBatch;
  const duplicateCandidates = { ...batch, candidates: [batch.candidates[0]!, batch.candidates[0]!] };
  const duplicateCandidatesHash = computeCandidateBatchHash(duplicateCandidates);
  const duplicateCandidatesBatch = { ...duplicateCandidates, id: "batch-" + duplicateCandidatesHash.slice("sha256:".length), content_hash: duplicateCandidatesHash };
  await writeFile(path.join(f.projectRoot, "facts", "candidates", duplicateCandidatesBatch.id + ".json"), canonicalJson(duplicateCandidatesBatch), "utf8");
  await expect(completeChunkTask({ ...resultIdentity(f, claimed.job.revision), resultBatchId: duplicateCandidatesBatch.id, resultBatchHash: duplicateCandidatesBatch.content_hash })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_MISMATCH" });

  const duplicateEvidence = {
    ...batch.candidates[0]!,
    evidence: [{
      id: "duplicate-evidence", source_id: batch.source_id, source_revision_id: batch.source_revision_id,
      chunk_set_id: batch.chunk_set_id, chunk_id: batch.chunk_id, chunk_hash: batch.chunk_hash,
      quote: "evidence", normalized_character_range: [0, 0], normalized_line_range: [1, 1],
    }, {
      id: "duplicate-evidence", source_id: batch.source_id, source_revision_id: batch.source_revision_id,
      chunk_set_id: batch.chunk_set_id, chunk_id: batch.chunk_id, chunk_hash: batch.chunk_hash,
      quote: "evidence", normalized_character_range: [0, 0], normalized_line_range: [1, 1],
    }],
  };
  const duplicateEvidenceDraft = { ...batch, candidates: [duplicateEvidence] };
  const duplicateEvidenceHash = computeCandidateBatchHash(duplicateEvidenceDraft);
  const duplicateEvidenceBatch = { ...duplicateEvidenceDraft, id: "batch-" + duplicateEvidenceHash.slice("sha256:".length), content_hash: duplicateEvidenceHash };
  await writeFile(path.join(f.projectRoot, "facts", "candidates", duplicateEvidenceBatch.id + ".json"), canonicalJson(duplicateEvidenceBatch), "utf8");
  await expect(completeChunkTask({ ...resultIdentity(f, claimed.job.revision), resultBatchId: duplicateEvidenceBatch.id, resultBatchHash: duplicateEvidenceBatch.content_hash })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_MISMATCH" });

  await writeFile(path.join(f.projectRoot, "sources", "journals", "source-events.jsonl"), "", "utf8");
  const createdEmptyJournal = await createExtractionJob({
    projectRoot: f.projectRoot, sourceId: "novel", sourceRevisionId: f.intake.revision.id,
    chunkSetId: f.chunks.manifest.id, createdBy: "tester", curationRunId: "empty-journal", now: () => t0,
  });
  expect(createdEmptyJournal.idempotent).toBe(false);
});

it("covers remaining job optional actors, evidence identity, result references, and completion guards", async () => {
  const f = await fixture("short source");
  const claimed = await claimChunkTask({ ...claimOptions(f), actor: undefined, now: undefined, leaseDurationMs: 600_000 });
  const task = claimed.job.tasks[0]!;
  const submitted = await submitCreativeBatch(f, claimed.job.revision, task.chunk_id, "optional-now");
  const batchPath = path.join(f.projectRoot, "facts", "candidates", submitted.batchId + ".json");
  const batch = JSON.parse(await readFile(batchPath, "utf8")) as CandidateBatch;
  const candidate = batch.candidates[0]!;
  const mismatchedEvidence = {
    id: "mismatched-evidence",
    source_id: "other-source",
    source_revision_id: batch.source_revision_id,
    chunk_set_id: batch.chunk_set_id,
    chunk_id: batch.chunk_id,
    chunk_hash: batch.chunk_hash,
    quote: "evidence",
    normalized_character_range: [0, 0] as [number, number],
    normalized_line_range: [1, 1] as [number, number],
  };
  const invalidEvidenceBatch = { ...batch, candidates: [{ ...candidate, evidence: [mismatchedEvidence] }] };
  const invalidEvidenceHash = computeCandidateBatchHash(invalidEvidenceBatch);
  const invalidEvidenceId = `batch-${invalidEvidenceHash.slice("sha256:".length)}`;
  await writeFile(path.join(f.projectRoot, "facts", "candidates", invalidEvidenceId + ".json"), canonicalJson({ ...invalidEvidenceBatch, id: invalidEvidenceId, content_hash: invalidEvidenceHash }), "utf8");
  await expect(completeChunkTask({
    ...resultIdentity(f, claimed.job.revision),
    now: undefined,
    resultBatchId: invalidEvidenceId,
    resultBatchHash: invalidEvidenceHash,
  })).rejects.toMatchObject({ code: "JOB_RESULT_BATCH_MISMATCH" });

  const completed = await completeChunkTask({
    ...resultIdentity(f, claimed.job.revision),
    now: undefined,
    resultBatchId: submitted.batchId,
    resultBatchHash: submitted.batchHash,
  });
  const superseded = await supersedeJob({
    projectRoot: f.projectRoot,
    jobId: f.created.job.id,
    expectedRevision: completed.job.revision,
    actor: undefined,
    now: undefined,
  });
  expect(superseded.job.tasks[0]).toMatchObject({ result_batch_id: submitted.batchId, result_batch_hash: submitted.batchHash });

  const missingResult = await fixture("short source");
  const missingResultPath = path.join(missingResult.projectRoot, "sources", "jobs", missingResult.created.job.id + ".json");
  const missingResultRaw = JSON.parse(await readFile(missingResultPath, "utf8")) as Record<string, unknown>;
  await writeFile(missingResultPath, canonicalJson({
    ...missingResultRaw,
    status: "completed",
    tasks: (missingResultRaw.tasks as Array<Record<string, unknown>>).map((item) => ({ ...item, status: "completed" })),
  }), "utf8");
  await expect(validateCompletedJobResults(missingResult.projectRoot, missingResult.created.job.id)).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
});