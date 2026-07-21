import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { initializeProject } from "@card-workspace/project";
import {
  chunkSchema,
  extractedTextProjectionSchema,
  projectManifestSchema,
  type CandidateBatch,
  type Chunk,
  type FactCandidate,
  type FactEvidence,
} from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  candidateBatchId,
  claimChunkTask,
  completeChunkTask,
  computeCandidateBatchHash,
  createChunkSet,
  createExtractionJob,
  DEFAULT_CHUNK_PROFILE,
  intakeLocalSource,
  normalizedRangeToLineRange,
  normalizedRangeToSourceByteRange,
  resolveEvidenceLocator,
  storeChunkSet,
  submitCandidateBatch,
  validateCandidateBatch,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const timestamp = "2026-07-13T10:00:00.000Z";

async function fixture(text = `第一行：黑髮😀\r\n第二行：眼睛是藍色。\r\n${"word ".repeat(6_000)}`, extension = ".txt") {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "evidence-demo",
      title: "Evidence Demo",
      kind: "character_card",
      card: { name: "Demo" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  const filePath = path.join(workspace.root, `source${extension}`);
  await writeFile(filePath, text, "utf8");
  const intake = await intakeLocalSource({ projectRoot, filePath, sourceId: "novel", title: "Novel" });
  const chunks = createChunkSet({
    projection: intake.projection,
    profile: { ...DEFAULT_CHUNK_PROFILE, target_tokens: 5_000, overlap_tokens: 500 },
  });
  await storeChunkSet({ projectRoot, artifacts: chunks, actor: "tester", timestamp });
  const created = await createExtractionJob({
    projectRoot,
    sourceId: "novel",
    sourceRevisionId: intake.revision.id,
    chunkSetId: chunks.manifest.id,
    createdBy: "tester",
    now: () => new Date(timestamp),
  });
  return { workspace, projectRoot, filePath, intake, chunks, created };
}

function evidenceFor(
  f: Awaited<ReturnType<typeof fixture>>,
  chunk: Chunk,
  range: [number, number],
  id = "evidence-1",
): FactEvidence {
  const lineMap = f.intake.projection.line_map!;
  const raw = normalizedRangeToSourceByteRange(f.intake.projection.text, lineMap, range);
  return {
    id,
    source_id: "novel",
    source_revision_id: f.intake.revision.id,
    chunk_set_id: f.chunks.manifest.id,
    chunk_id: chunk.id,
    chunk_hash: chunk.content_hash,
    quote: f.intake.projection.text.slice(...range),
    normalized_character_range: range,
    normalized_line_range: normalizedRangeToLineRange(lineMap, range),
    ...(raw ? { raw_byte_range: raw } : {}),
    extensions: {},
  };
}

function sourceCandidate(evidence: FactEvidence[], id = "candidate-1"): FactCandidate {
  return {
    schema_version: 1,
    id,
    subject: "alice",
    predicate: "appearance.hair",
    value: "黑髮",
    classification: "source_fact",
    confidence: 0.95,
    scope: { character_ids: [], extensions: {} },
    valid_time: { extensions: {} },
    evidence,
    status: "submitted",
    created_by: "fact-curator",
    created_at: timestamp,
    extensions: {},
  };
}

function finalizeBatch(
  f: Awaited<ReturnType<typeof fixture>>,
  candidates: FactCandidate[],
  overrides: Partial<CandidateBatch> = {},
): CandidateBatch {
  const draft = {
    schema_version: 1 as const,
    id: "batch-placeholder",
    source_id: "novel",
    source_revision_id: f.intake.revision.id,
    chunk_set_id: f.chunks.manifest.id,
    chunk_id: f.created.job.tasks[0]!.chunk_id,
    chunk_hash: f.created.job.tasks[0]!.chunk_hash,
    job_id: f.created.job.id,
    input_revision: f.created.job.input_revision,
    candidates,
    created_by: "fact-curator",
    created_at: timestamp,
    content_hash: `sha256:${"0".repeat(64)}` as const,
    extensions: {},
    ...overrides,
  };
  const contentHash = computeCandidateBatchHash(draft);
  return { ...draft, content_hash: contentHash, id: candidateBatchId(contentHash) };
}

function firstRange(f: Awaited<ReturnType<typeof fixture>>, quote: string): [number, number] {
  const start = f.intake.projection.text.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote 不存在：${quote}`);
  return [start, start + quote.length];
}

function thrownCode(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
}

describe("evidence validation", () => {
  it("從 exact locator 推導 CJK、emoji 與 CRLF multiline ranges", async () => {
    const f = await fixture("前言\r\n黑髮😀\r\n第二行證據\r\n");
    const chunk = f.chunks.chunks[0]!;

    const unicode = resolveEvidenceLocator(
      { id: "evidence-unicode", quote: "黑髮😀", extensions: {} },
      f.intake.projection,
      chunk,
    );
    expect(unicode.normalized_character_range).toEqual([3, 7]);
    expect(unicode.normalized_line_range).toEqual([2, 2]);
    expect(unicode.raw_byte_range).toEqual([8, 18]);

    const multiline = resolveEvidenceLocator(
      { id: "evidence-multiline", quote: "黑髮😀\n第二行", extensions: {} },
      f.intake.projection,
      chunk,
    );
    expect(multiline.normalized_character_range).toEqual([3, 11]);
    expect(multiline.normalized_line_range).toEqual([2, 3]);
    expect(multiline.raw_byte_range).toEqual([8, 29]);
  });

  it("拒絕 ambiguous/missing occurrence，並可選取重疊 quote occurrence", async () => {
    const f = await fixture("aaaa");
    const chunk = f.chunks.chunks[0]!;
    const locator = { id: "evidence-repeat", quote: "aa", extensions: {} };

    expect(thrownCode(() => resolveEvidenceLocator(locator, f.intake.projection, chunk))).toBe(
      "EVIDENCE_QUOTE_AMBIGUOUS",
    );
    expect(resolveEvidenceLocator(
      { ...locator, occurrence: 1 },
      f.intake.projection,
      chunk,
    ).normalized_character_range).toEqual([1, 3]);
    expect(thrownCode(() => resolveEvidenceLocator(
      { ...locator, occurrence: 3 },
      f.intake.projection,
      chunk,
    ))).toBe("EVIDENCE_QUOTE_NOT_FOUND");
    expect(thrownCode(() => resolveEvidenceLocator(
      { ...locator, quote: "AA" },
      f.intake.projection,
      chunk,
    ))).toBe("EVIDENCE_QUOTE_NOT_FOUND");
  });

  it("精確驗證單行、多行與 Unicode quote/line/raw byte ranges", async () => {
    const f = await fixture();
    const chunk = f.chunks.chunks[0]!;
    const single = evidenceFor(f, chunk, firstRange(f, "黑髮😀"), "evidence-unicode");
    const multiline = evidenceFor(f, chunk, firstRange(f, "黑髮😀\n第二行：眼睛"), "evidence-multiline");
    const batch = finalizeBatch(f, [sourceCandidate([single, multiline])]);
    await expect(validateCandidateBatch(f.projectRoot, batch)).resolves.toEqual(batch);
    expect(single.raw_byte_range![1] - single.raw_byte_range![0]).toBe(Buffer.byteLength(single.quote));
    expect(multiline.normalized_line_range).toEqual([1, 2]);
  });

  it("chunk overlap 仍以 revision 全域 range 驗證，但 batch 只接受指定 chunk evidence", async () => {
    const f = await fixture();
    const next = f.chunks.chunks.find((chunk) => chunk.leading_overlap_range);
    expect(next).toBeDefined();
    const range = next!.leading_overlap_range!;
    const shortRange: [number, number] = [range[0], Math.min(range[0] + 12, range[1])];
    const previous = f.chunks.chunks[next!.sequence - 1]!;
    const left = evidenceFor(f, previous, shortRange, "evidence-left-overlap");
    const right = evidenceFor(f, next!, shortRange, "evidence-right-overlap");
    const batch = finalizeBatch(f, [sourceCandidate([right])], {
      chunk_id: next!.id,
      chunk_hash: next!.content_hash,
    });
    await expect(validateCandidateBatch(f.projectRoot, batch)).resolves.toEqual(batch);
    await expect(validateCandidateBatch(f.projectRoot, finalizeBatch(f, [sourceCandidate([left, right])], {
      chunk_id: next!.id,
      chunk_hash: next!.content_hash,
    }))).rejects.toMatchObject({ code: "EVIDENCE_BATCH_CHUNK_MISMATCH" });

    const local = structuredClone(right);
    local.normalized_character_range = [0, shortRange[1] - shortRange[0]];
    const invalid = finalizeBatch(f, [sourceCandidate([local])], {
      chunk_id: next!.id,
      chunk_hash: next!.content_hash,
    });
    await expect(validateCandidateBatch(f.projectRoot, invalid)).rejects.toMatchObject({
      code: "EVIDENCE_CHARACTER_RANGE_INVALID",
    });
  });

  it.each([
    ["batch chain source", (item: FactEvidence) => { item.source_id = "other"; }, "EVIDENCE_BATCH_CHAIN_MISMATCH"],
    ["batch chain revision", (item: FactEvidence) => { item.source_revision_id = `sha256:${"f".repeat(64)}`; }, "EVIDENCE_BATCH_CHAIN_MISMATCH"],
    ["chunk set", (item: FactEvidence) => { item.chunk_set_id = "chunk-set-wrong"; }, "EVIDENCE_BATCH_CHAIN_MISMATCH"],
    ["chunk", (item: FactEvidence) => { item.chunk_id = "chunk-wrong"; }, "EVIDENCE_BATCH_CHUNK_MISMATCH"],
    ["chunk hash", (item: FactEvidence) => { item.chunk_hash = `sha256:${"e".repeat(64)}`; }, "EVIDENCE_BATCH_CHUNK_MISMATCH"],
    ["character range", (item: FactEvidence) => { item.normalized_character_range = [0, 999_999]; }, "EVIDENCE_CHARACTER_RANGE_INVALID"],
    ["line range", (item: FactEvidence) => { item.normalized_line_range = [2, 2]; }, "EVIDENCE_LINE_RANGE_MISMATCH"],
    ["quote", (item: FactEvidence) => { item.quote = "近似但不相等"; }, "EVIDENCE_QUOTE_MISMATCH"],
    ["missing raw byte", (item: FactEvidence) => { delete item.raw_byte_range; }, "EVIDENCE_RAW_BYTE_RANGE_REQUIRED"],
    ["raw byte", (item: FactEvidence) => { item.raw_byte_range = [0, 1]; }, "EVIDENCE_RAW_BYTE_RANGE_MISMATCH"],
  ])("拒絕錯誤 %s reference/hash/range/quote", async (_label, mutate, code) => {
    const f = await fixture("第一行：黑髮😀\r\n第二行：眼睛是藍色。");
    const item = evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮😀"));
    mutate(item);
    const batch = finalizeBatch(f, [sourceCandidate([item])]);
    await expect(validateCandidateBatch(f.projectRoot, batch)).rejects.toMatchObject({ code });
  });

  it("拒絕 snapshot、projection 與 chunk artifact 篡改", async () => {
    const snapshot = await fixture("黑髮證據");
    const snapshotBatch = finalizeBatch(snapshot, [sourceCandidate([
      evidenceFor(snapshot, snapshot.chunks.chunks[0]!, firstRange(snapshot, "黑髮")),
    ])]);
    await writeFile(path.join(snapshot.projectRoot, snapshot.intake.revision.snapshot.path), "遭篡改", "utf8");
    await expect(validateCandidateBatch(snapshot.projectRoot, snapshotBatch)).rejects.toMatchObject({ code: "SNAPSHOT_HASH_MISMATCH" });

    const projection = await fixture("黑髮證據");
    const projectionBatch = finalizeBatch(projection, [sourceCandidate([
      evidenceFor(projection, projection.chunks.chunks[0]!, firstRange(projection, "黑髮")),
    ])]);
    const digest = projection.intake.revision.id.slice("sha256:".length);
    const projectionPath = path.join(projection.projectRoot, "sources/projections/novel", `${digest}.json`);
    const projectionJson = extractedTextProjectionSchema.parse(JSON.parse(await readFile(projectionPath, "utf8")));
    projectionJson.text = "遭篡改";
    await writeFile(projectionPath, JSON.stringify(projectionJson), "utf8");
    await expect(validateCandidateBatch(projection.projectRoot, projectionBatch)).rejects.toMatchObject({
      code: "SOURCE_PROJECTION_HASH_MISMATCH",
    });

    const chunk = await fixture("黑髮證據");
    const chunkBatch = finalizeBatch(chunk, [sourceCandidate([
      evidenceFor(chunk, chunk.chunks.chunks[0]!, firstRange(chunk, "黑髮")),
    ])]);
    const chunkDigest = chunk.intake.revision.id.slice("sha256:".length);
    const storedChunkPath = path.join(
      chunk.projectRoot,
      "sources/chunks/novel",
      chunkDigest,
      chunk.chunks.manifest.id,
      `${chunk.chunks.chunks[0]!.id}.json`,
    );
    const chunkJson = chunkSchema.parse(JSON.parse(await readFile(storedChunkPath, "utf8")));
    chunkJson.content = "遭篡改";
    await writeFile(storedChunkPath, JSON.stringify(chunkJson), "utf8");
    await expect(validateCandidateBatch(chunk.projectRoot, chunkBatch)).rejects.toMatchObject({
      code: "CHUNK_SET_CONTENT_MISMATCH",
    });
  });

  it("field projection 可驗 quote，但不可冒充 raw snapshot byte range", async () => {
    const f = await fixture(JSON.stringify({ description: "黑髮證據" }), ".json");
    expect(f.intake.projection.line_map!.coordinate_space).toBe("extracted_projection");
    const item = evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮證據"));
    expect(item.raw_byte_range).toBeUndefined();
    await expect(validateCandidateBatch(
      f.projectRoot,
      finalizeBatch(f, [sourceCandidate([item])]),
    )).resolves.toBeDefined();
    item.raw_byte_range = [0, Buffer.byteLength(item.quote)];
    await expect(validateCandidateBatch(
      f.projectRoot,
      finalizeBatch(f, [sourceCandidate([item])]),
    )).rejects.toMatchObject({ code: "EVIDENCE_RAW_BYTE_RANGE_FORBIDDEN" });
  });
});

describe("candidate batch submission", () => {
  it("套用三種 classification gate，且只接受 submitted candidate", async () => {
    const f = await fixture("黑髮證據");
    const item = evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮"));
    const inference = { ...sourceCandidate([item], "candidate-inference"), classification: "reasonable_inference" as const };
    const creative = {
      ...sourceCandidate([], "candidate-creative"),
      classification: "creative_completion" as const,
      rationale: "補足未描述的細節",
    };
    await expect(validateCandidateBatch(
      f.projectRoot,
      finalizeBatch(f, [sourceCandidate([item]), inference, creative]),
    )).resolves.toBeDefined();

    const noEvidence = finalizeBatch(f, [{ ...inference, evidence: [] }]);
    await expect(validateCandidateBatch(f.projectRoot, noEvidence)).rejects.toMatchObject({ code: "CANDIDATE_BATCH_INVALID" });
    const noRationale = finalizeBatch(f, [{ ...creative, rationale: undefined } as unknown as FactCandidate]);
    await expect(validateCandidateBatch(f.projectRoot, noRationale)).rejects.toMatchObject({ code: "CANDIDATE_BATCH_INVALID" });
    const accepted = finalizeBatch(f, [{ ...sourceCandidate([item]), status: "accepted" }]);
    await expect(validateCandidateBatch(f.projectRoot, accepted)).rejects.toMatchObject({ code: "CANDIDATE_STATUS_INVALID" });
  });

  it("新 submission 拒絕明確 test/placeholder 語意值", async () => {
    const f = await fixture("黑髮證據");
    const item = evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮"));
    const placeholder = sourceCandidate([item], "candidate-context-only");
    const batch = finalizeBatch(f, [{ ...placeholder, value: "placeholder" }]);
    await expect(submitCandidateBatch(f.projectRoot, batch, 0)).rejects.toMatchObject({
      code: "CANDIDATE_PLACEHOLDER_FORBIDDEN",
    });
    await expect(access(path.join(f.projectRoot, "facts/candidates", `${batch.id}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("接受指定 chunk 的空 candidate batch，拒絕 job 不存在或 hash 不符的 chunk", async () => {
    const f = await fixture("沒有可提取事實");
    await expect(validateCandidateBatch(f.projectRoot, finalizeBatch(f, []))).resolves.toBeDefined();
    await expect(validateCandidateBatch(f.projectRoot, finalizeBatch(f, [], {
      chunk_id: "chunk-missing",
    }))).rejects.toMatchObject({ code: "CANDIDATE_JOB_CHUNK_NOT_FOUND" });
    await expect(validateCandidateBatch(f.projectRoot, finalizeBatch(f, [], {
      chunk_hash: `sha256:${"f".repeat(64)}`,
    }))).rejects.toMatchObject({ code: "CANDIDATE_JOB_CHUNK_HASH_MISMATCH" });
  });

  it("任一 candidate 無效時整批不落地，並拒絕 stale source/job input", async () => {
    const f = await fixture("黑髮與藍眼證據");
    const valid = sourceCandidate([evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮"))]);
    const invalidEvidence = evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "藍眼"), "evidence-invalid");
    invalidEvidence.quote = "錯誤";
    const batch = finalizeBatch(f, [valid, sourceCandidate([invalidEvidence], "candidate-invalid")]);
    await expect(submitCandidateBatch(f.projectRoot, batch, 0)).rejects.toMatchObject({ code: "EVIDENCE_QUOTE_MISMATCH" });
    await expect(access(path.join(f.projectRoot, "facts/candidates", `${batch.id}.json`))).rejects.toMatchObject({ code: "ENOENT" });

    const staleInput = finalizeBatch(f, [valid], { input_revision: `sha256:${"f".repeat(64)}` });
    await expect(validateCandidateBatch(f.projectRoot, staleInput)).rejects.toMatchObject({
      code: "CANDIDATE_JOB_REVISION_MISMATCH",
    });
    await expect(submitCandidateBatch(f.projectRoot, finalizeBatch(f, [valid]), 1)).rejects.toMatchObject({
      code: "CANDIDATE_JOB_STATE_CONFLICT",
    });

    await writeFile(f.filePath, "來源新版本", "utf8");
    await intakeLocalSource({ projectRoot: f.projectRoot, filePath: f.filePath, sourceId: "novel", title: "Novel" });
    await expect(validateCandidateBatch(f.projectRoot, finalizeBatch(f, [valid]))).rejects.toMatchObject({
      code: "CANDIDATE_SOURCE_STALE",
    });
  });

  it("deterministic ID/hash、同 payload idempotent、同 ID 不同 payload conflict", async () => {
    const f = await fixture("黑髮證據");
    const batch = finalizeBatch(f, [sourceCandidate([
      evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮")),
    ])]);
    expect(batch.id).toBe(candidateBatchId(batch.content_hash));
    expect(computeCandidateBatchHash(batch)).toBe(batch.content_hash);
    await expect(validateCandidateBatch(f.projectRoot, { ...batch, content_hash: `sha256:${"f".repeat(64)}` })).rejects.toMatchObject({
      code: "CANDIDATE_BATCH_HASH_MISMATCH",
    });
    await expect(validateCandidateBatch(f.projectRoot, { ...batch, id: "batch-wrong" })).rejects.toMatchObject({
      code: "CANDIDATE_BATCH_ID_MISMATCH",
    });
    const first = await submitCandidateBatch(f.projectRoot, batch, 0);
    const retry = await submitCandidateBatch(f.projectRoot, batch, 0);
    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(retry.batchHash).toBe(first.batchHash);

    const conflicting = structuredClone(batch);
    conflicting.candidates[0]!.value = "白髮";
    await expect(submitCandidateBatch(f.projectRoot, conflicting, 0)).rejects.toMatchObject({
      code: "CANDIDATE_BATCH_CONFLICT",
    });
  });

  it("先提交 immutable batch，再由既有 complete task 契約引用 batch ID/hash", async () => {
    const f = await fixture("黑髮證據");
    const task = f.created.job.tasks[0]!;
    const claimed = await claimChunkTask({
      projectRoot: f.projectRoot,
      jobId: f.created.job.id,
      chunkId: task.chunk_id,
      expectedRevision: 0,
      owner: "worker",
      leaseId: "lease-1",
      leaseDurationMs: 60_000,
      now: () => new Date(timestamp),
    });
    const batch = finalizeBatch(f, [sourceCandidate([
      evidenceFor(f, f.chunks.chunks[0]!, firstRange(f, "黑髮")),
    ])]);
    const submitted = await submitCandidateBatch(f.projectRoot, batch, claimed.job.revision);
    const completed = await completeChunkTask({
      projectRoot: f.projectRoot,
      jobId: f.created.job.id,
      chunkId: task.chunk_id,
      expectedRevision: claimed.job.revision,
      leaseId: "lease-1",
      owner: "worker",
      sourceRevisionId: f.created.job.source_revision_id,
      chunkSetId: f.created.job.chunk_set_id,
      chunkHash: task.chunk_hash,
      resultBatchId: submitted.batchId,
      resultBatchHash: submitted.batchHash,
      now: () => new Date(Date.parse(timestamp) + 1_000),
    });
    expect(completed.job.tasks[0]).toMatchObject({
      status: "completed",
      result_batch_id: submitted.batchId,
      result_batch_hash: submitted.batchHash,
    });
  });
});
