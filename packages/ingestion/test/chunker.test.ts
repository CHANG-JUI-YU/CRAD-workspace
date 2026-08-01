import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { initializeProject } from "@card-workspace/project";
import {
  extractedTextProjectionSchema,
  projectManifestSchema,
  sourceManifestSchema,
  type ChunkProfile,
} from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { getEncoding } from "js-tiktoken";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  createChunkSet,
  DEFAULT_CHUNK_PROFILE,
  getChunkSet,
  intakeLocalSource,
  listChunkSets,
  normalizeText,
  normalizedRangeToLineRange,
  normalizedRangeToSourceByteRange,
  normalizedRangeToSourceCharacterRange,
  sourceByteRangeToNormalizedRange,
  sourceCharacterRangeToNormalizedRange,
  sourceRevision,
  storeChunkSet,
  verifyChunkSet,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function projection(text: string, coordinateSpace: "raw_snapshot" | "extracted_projection" = "raw_snapshot") {
  const normalized = normalizeText(Buffer.from(text, "utf8"), coordinateSpace);
  return extractedTextProjectionSchema.parse({
    schema_version: 1,
    id: "projection-test",
    source_id: "novel",
    source_revision_id: sourceRevision(Buffer.from(text, "utf8")),
    text: normalized.text,
    normalized_hash: sourceRevision(Buffer.from(normalized.text, "utf8")),
    adapter_id: "text",
    adapter_version: "1",
    normalizer_id: "utf8-newline",
    normalizer_version: "1.0.0",
    line_map: normalized.lineMap,
    mappings: [],
  });
}

function profile(overrides: Partial<ChunkProfile> = {}): ChunkProfile {
  return { ...DEFAULT_CHUNK_PROFILE, target_tokens: 5_000, overlap_tokens: 500, ...overrides };
}

async function projectWithSource(text: string) {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "chunk-demo",
      title: "Chunk Demo",
      kind: "character_card",
      card: { name: "Demo" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  const filePath = path.join(workspace.root, "novel.txt");
  await writeFile(filePath, text, "utf8");
  const intake = await intakeLocalSource({ projectRoot, filePath, sourceId: "novel", title: "Novel" });
  return { workspace, projectRoot, intake };
}

describe("text normalization and line map", () => {
  it("只移除開頭 BOM 並正規化換行，保留空白、Unicode 與標點", () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("甲\r\n 乙\r丙 e\u0301！？", "utf8"),
    ]);
    const result = normalizeText(bytes);
    expect(result.text).toBe("甲\n 乙\n丙 e\u0301！？");
    expect(result.lineMap).toMatchObject({
      coordinate_space: "raw_snapshot",
      removed_leading_bom: true,
      source_byte_size: bytes.length,
    });
    expect(normalizedRangeToSourceByteRange(result.text, result.lineMap, [0, 1])).toEqual([3, 6]);
    expect(sourceByteRangeToNormalizedRange(result.text, result.lineMap, [3, 6])).toEqual([0, 1]);
    expect(sourceCharacterRangeToNormalizedRange(result.lineMap, [1, 5])).toEqual([0, 3]);
    expect(() => sourceByteRangeToNormalizedRange(result.text, result.lineMap, [6, 7])).toThrow(/CRLF/u);
    const emoji = normalizeText(Buffer.from("😀", "utf8"));
    expect(() => normalizedRangeToSourceByteRange(emoji.text, emoji.lineMap, [0, 1])).toThrow(/surrogate/u);
  });

  it("拒絕無效 UTF-8；projection coordinate 不冒充 raw byte range", () => {
    expect(() => normalizeText(Buffer.from([0xff]))).toThrow(/有效 UTF-8/u);
    const result = normalizeText(Buffer.from("甲\r\n乙"), "extracted_projection");
    expect(normalizedRangeToSourceByteRange(result.text, result.lineMap, [0, 1])).toBeUndefined();
    expect(sourceByteRangeToNormalizedRange(result.text, result.lineMap, [0, 3])).toBeUndefined();
  });
});

describe("deterministic chunker", () => {
  it("鎖定 cl100k_base golden 並在大型單段以 token-safe hard split", () => {
    const text = "word ".repeat(12_000);
    const artifacts = createChunkSet({ projection: projection(text), profile: profile() });
    const tokenizer = getEncoding("cl100k_base");
    expect(tokenizer.encode("hello world")).toHaveLength(2);
    expect(artifacts.chunks.length).toBeGreaterThan(2);
    for (const chunk of artifacts.chunks) {
      expect(tokenizer.encode(chunk.content)).toHaveLength(chunk.token_count);
      expect(tokenizer.encode(text.slice(chunk.main_range[0], chunk.main_range[1])).length).toBeLessThanOrEqual(5_000);
      if (chunk.leading_overlap_range) {
        expect(chunk.leading_overlap_range[1]).toBe(chunk.main_range[0]);
        expect(tokenizer.encode(text.slice(...chunk.leading_overlap_range)).length).toBeLessThanOrEqual(500);
      }
      if (chunk.trailing_overlap_range) {
        expect(chunk.trailing_overlap_range[0]).toBe(chunk.main_range[1]);
        expect(tokenizer.encode(text.slice(...chunk.trailing_overlap_range)).length).toBeLessThanOrEqual(500);
      }
    }
    expect(artifacts.chunks.map((chunk) => chunk.main_range[0])).toEqual([
      0,
      ...artifacts.chunks.slice(0, -1).map((chunk) => chunk.main_range[1]),
    ]);
  });

  it("依章節優先於較後段落，並讓策略版本建立新 deterministic set", () => {
    const text = `${"word ".repeat(3_000)}\n# Chapter Two\n${"word ".repeat(4_000)}`;
    const input = projection(text);
    const first = createChunkSet({ projection: input, profile: profile() });
    const retry = createChunkSet({ projection: input, profile: profile() });
    const changed = createChunkSet({
      projection: input,
      profile: profile({ version: "1.0.1" }),
    });
    expect(retry).toEqual(first);
    expect(first.chunks[0]?.main_range[1]).toBe(text.indexOf("# Chapter Two"));
    expect(first.chunks[1]?.chapter_path).toEqual(["Chapter Two"]);
    expect(changed.manifest.id).not.toBe(first.manifest.id);
    expect(changed.chunks.map((chunk) => chunk.id)).not.toEqual(first.chunks.map((chunk) => chunk.id));
  });
});

describe("chunk store", () => {
  it("create/store/list/get/verify idempotent，且新 profile 不刪舊 set", async () => {
    const { projectRoot, intake } = await projectWithSource("word ".repeat(6_000));
    const first = createChunkSet({ projection: intake.projection, profile: profile() });
    const stored = await storeChunkSet({ projectRoot, artifacts: first, actor: "tester" });
    expect(stored.idempotent).toBe(false);
    expect((await storeChunkSet({ projectRoot, artifacts: first, actor: "tester" })).idempotent).toBe(true);
    expect(await getChunkSet(projectRoot, "novel", intake.revision.id, first.manifest.id)).toEqual(first);
    expect(await verifyChunkSet(projectRoot, "novel", intake.revision.id, first.manifest.id)).toEqual(first);

    const second = createChunkSet({
      projection: intake.projection,
      profile: profile({ version: "1.0.1" }),
    });
    await storeChunkSet({ projectRoot, artifacts: second, actor: "tester" });
    expect((await listChunkSets(projectRoot, "novel")).map((item) => item.id).sort()).toEqual(
      [first.manifest.id, second.manifest.id].sort(),
    );
    const manifest = sourceManifestSchema.parse(
      parseYaml(await readFile(path.join(projectRoot, "sources/manifest.yaml"), "utf8")),
    );
    expect(manifest.sources[0].current_chunk_set).toEqual({
      source_revision_id: intake.revision.id,
      chunk_set_id: second.manifest.id,
    });
  });

  it("交易故障不留下 chunks，current pointer 與 journal 不漂移", async () => {
    const { projectRoot, intake } = await projectWithSource("word ".repeat(6_000));
    const first = createChunkSet({ projection: intake.projection, profile: profile() });
    await storeChunkSet({ projectRoot, artifacts: first, actor: "tester" });
    const journalBefore = await readFile(path.join(projectRoot, "sources/journals/source-events.jsonl"), "utf8");
    const second = createChunkSet({
      projection: intake.projection,
      profile: profile({ version: "failure-version" }),
    });
    await expect(storeChunkSet({
      projectRoot,
      artifacts: second,
      actor: "tester",
      beforePublish: (index) => {
        if (index === second.chunks.length + 1) throw new Error("injected chunk failure");
      },
    })).rejects.toThrow("injected chunk failure");
    await expect(getChunkSet(projectRoot, "novel", intake.revision.id, second.manifest.id)).rejects.toMatchObject({
      code: "CHUNK_SET_NOT_FOUND",
    });
    const manifest = sourceManifestSchema.parse(
      parseYaml(await readFile(path.join(projectRoot, "sources/manifest.yaml"), "utf8")),
    );
    expect(manifest.sources[0].current_chunk_set.chunk_set_id).toBe(first.manifest.id);
    await expect(readFile(path.join(projectRoot, "sources/journals/source-events.jsonl"), "utf8")).resolves.toBe(journalBefore);
  });

  it("rejects unsupported profiles and projection integrity drift", () => {
    const input = projection("One sentence. ".repeat(4_000) + "\n\nSecond sentence!\n# Chapter\nThird sentence?");
    expect(() => createChunkSet({ projection: input, profile: profile({ tokenizer_id: "other" }) })).toThrow(/cl100k_base/u);
    expect(() => createChunkSet({ projection: { ...input, line_map: undefined } as typeof input })).toThrow(/line map/u);
    expect(() => createChunkSet({ projection: { ...input, line_map: { ...input.line_map!, normalized_character_count: input.text.length + 1 } } })).toThrow(/line map/u);
    expect(() => createChunkSet({ projection: { ...input, normalized_hash: `sha256:${"f".repeat(64)}` } })).toThrow(/hash/u);
    const sentenceChunks = createChunkSet({ projection: input, profile: profile({ target_tokens: 5_000, overlap_tokens: 500 }) });
    expect(sentenceChunks.chunks.length).toBeGreaterThan(1);
  });
});

it("covers line-map terminal boundaries, empty ranges, and invalid offsets", () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Alpha\r\n😀Beta", "utf8")]);
  const normalized = normalizeText(bytes);
  const end = normalized.text.length;
  expect(normalizedRangeToSourceByteRange(normalized.text, normalized.lineMap, [0, end])).toEqual([3, bytes.length]);
  expect(sourceByteRangeToNormalizedRange(normalized.text, normalized.lineMap, [0, bytes.length])).toEqual([0, end]);
  expect(sourceCharacterRangeToNormalizedRange(normalized.lineMap, [0, normalized.lineMap.source_character_count])).toEqual([0, end]);
  expect(normalizedRangeToLineRange(normalized.lineMap, [0, 0])).toEqual([1, 1]);
  expect(() => sourceByteRangeToNormalizedRange(normalized.text, normalized.lineMap, [1, 2])).toThrow(/BOM/u);
  expect(() => sourceByteRangeToNormalizedRange(normalized.text, normalized.lineMap, [11, 12])).toThrow(/UTF-8 character|offset/u);
  expect(() => normalizedRangeToLineRange(normalized.lineMap, [-1, 0])).toThrow();
  expect(() => normalizedRangeToSourceCharacterRange(normalized.text, normalized.lineMap, [end + 1, end + 1])).toThrow();
});

it("covers chunk store missing, identity, and immutable content guards", async () => {
  const { projectRoot, intake } = await projectWithSource("word ".repeat(2_000));
  await expect(listChunkSets(projectRoot, "novel", intake.revision.id)).resolves.toEqual([]);
  const artifacts = createChunkSet({ projection: intake.projection, profile: profile() });
  await expect(getChunkSet(projectRoot, "novel", intake.revision.id, artifacts.manifest.id)).rejects.toMatchObject({ code: "CHUNK_SET_NOT_FOUND" });
  await storeChunkSet({ projectRoot, artifacts, actor: "tester" });
  const root = path.join(projectRoot, "sources/chunks/novel", intake.revision.id.slice("sha256:".length), artifacts.manifest.id);
  const manifestPath = path.join(root, "manifest.json");
  const manifestRaw = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, manifestRaw.replace(artifacts.manifest.id, "chunk-set-wrong"), "utf8");
  await expect(getChunkSet(projectRoot, "novel", intake.revision.id, artifacts.manifest.id)).rejects.toMatchObject({ code: "CHUNK_SET_IDENTITY_MISMATCH" });
  await writeFile(manifestPath, manifestRaw, "utf8");
  const chunkId = artifacts.manifest.chunk_ids[0]!;
  const chunkPath = path.join(root, chunkId + ".json");
  const chunkRaw = await readFile(chunkPath, "utf8");
  await writeFile(chunkPath, chunkRaw.replace(chunkId, "chunk-wrong"), "utf8");
  await expect(getChunkSet(projectRoot, "novel", intake.revision.id, artifacts.manifest.id)).rejects.toMatchObject({ code: "CHUNK_IDENTITY_MISMATCH" });
  await writeFile(chunkPath, chunkRaw, "utf8");
  const chunkValue = JSON.parse(chunkRaw) as Record<string, unknown>;
  chunkValue.content = "tampered";
  await writeFile(chunkPath, JSON.stringify(chunkValue), "utf8");
  await expect(verifyChunkSet(projectRoot, "novel", intake.revision.id, artifacts.manifest.id)).rejects.toMatchObject({ code: "CHUNK_SET_CONTENT_MISMATCH" });
});

it("covers empty chunk profiles and profile schema guards", () => {
  const empty = createChunkSet({ projection: projection("") });
  expect(empty.chunks).toEqual([]);
  expect(() => createChunkSet({
    projection: projection("??"),
    profile: { ...profile(), target_tokens: 1, overlap_tokens: 1 } as ChunkProfile,
  })).toThrow();
});
