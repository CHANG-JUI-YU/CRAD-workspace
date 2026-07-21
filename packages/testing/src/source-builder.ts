import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  characterCardV2Schema,
  characterCardV3Schema,
  chunkSchema,
  chunkSetManifestSchema,
  extractedTextProjectionSchema,
  sourceRecordSchema,
  sourceRevisionSchema,
  type CharacterCardV2,
  type CharacterCardV3,
  type Chunk,
  type ChunkSetManifest,
  type ExtractedTextProjection,
  type SourceRecord,
  type SourceRevision,
} from "@card-workspace/schemas";
import {
  encodePngChunk,
  encodeTextChunk,
  pngSignature,
  writeCardToPng,
} from "@card-workspace/adapters-png";

const timestamp = "2026-07-13T10:00:00.000Z";
const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export interface SourceFixtureArtifacts {
  rawBytes: Buffer;
  source: SourceRecord;
  revision: SourceRevision;
  projection: ExtractedTextProjection;
  chunkSet: ChunkSetManifest;
  chunks: Chunk[];
}

export interface SourceFixtureOptions {
  sourceId?: string;
  title?: string;
  text?: string;
  rawBytes?: Uint8Array;
  revision?: number;
}

export interface CharacterCardV1Fixture {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
}

export function fixtureRevision(input: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function sourcesFactsFixturePath(
  name: "chapter.md" | "projection.json" | "projection.yaml" | "chat.txt",
): string {
  return path.join(packageRoot, "fixtures", "sources-facts", name);
}

export function buildLargeUnsectionedText(characterCount = 120_000): string {
  const sentence = "Alice records one stable observation without a chapter heading. ";
  return sentence.repeat(Math.ceil(characterCount / sentence.length)).slice(0, characterCount);
}

export function buildCrossChunkEvidenceText(boundary = 24_000): { text: string; quote: string } {
  const quote = "silver bells rang across the boundary";
  const prefix = "x".repeat(Math.max(0, boundary - 7));
  return { text: `${prefix}${quote}\n${buildLargeUnsectionedText(8_000)}`, quote };
}

export function buildSourceFixture(options: SourceFixtureOptions = {}): SourceFixtureArtifacts {
  const sourceId = options.sourceId ?? "novel";
  const title = options.title ?? "Fixture Novel";
  const text = options.text ?? "# Chapter One\n\nAlice has silver hair.\n";
  const rawBytes = Buffer.from(options.rawBytes ?? Buffer.from(text, "utf8"));
  const rawHash = fixtureRevision(rawBytes);
  const normalizedHash = fixtureRevision(text);
  const digest = rawHash.slice("sha256:".length);
  const revisionNumber = options.revision ?? 1;
  const chunkId = `${sourceId}-chunk-${revisionNumber}`;
  const chunkSetId = `${sourceId}-set-${revisionNumber}`;
  const lineCount = Math.max(1, text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
  const revision = sourceRevisionSchema.parse({
    schema_version: 1,
    source_id: sourceId,
    id: rawHash,
    media_type: "text/markdown",
    original_extension: ".md",
    raw_hash: rawHash,
    normalized_hash: normalizedHash,
    title,
    acquired_at: timestamp,
    tier: "official",
    origin: { kind: "local", uri: `fixture://${sourceId}/${revisionNumber}` },
    snapshot: {
      path: `sources/snapshots/${sourceId}/${digest}.md`,
      byte_size: rawBytes.byteLength,
      raw_hash: rawHash,
    },
    adapter_id: "text",
    adapter_version: "1",
    normalizer_id: "utf8-newline",
    normalizer_version: "1",
  });
  const projection = extractedTextProjectionSchema.parse({
    schema_version: 1,
    id: `${sourceId}-projection-${revisionNumber}`,
    source_id: sourceId,
    source_revision_id: rawHash,
    text,
    normalized_hash: normalizedHash,
    adapter_id: "text",
    adapter_version: "1",
    normalizer_id: "utf8-newline",
    normalizer_version: "1",
    mappings: [{
      evidence_kind: "raw_snapshot",
      normalized_character_range: [0, text.length],
      raw_byte_range: [0, rawBytes.byteLength],
      normalized_line_range: [1, lineCount],
    }],
  });
  const chunk = chunkSchema.parse({
    schema_version: 1,
    id: chunkId,
    source_id: sourceId,
    source_revision_id: rawHash,
    chunk_set_id: chunkSetId,
    sequence: 0,
    chapter_path: [],
    normalized_character_range: [0, text.length],
    normalized_line_range: [1, lineCount],
    raw_byte_range: [0, rawBytes.byteLength],
    main_range: [0, text.length],
    token_count: Math.max(1, Math.ceil(text.length / 4)),
    content_hash: fixtureRevision(text),
    content: text,
  });
  const chunkSet = chunkSetManifestSchema.parse({
    schema_version: 1,
    id: chunkSetId,
    source_id: sourceId,
    source_revision_id: rawHash,
    normalized_hash: normalizedHash,
    profile: {
      id: "fixture-profile",
      strategy: "sliding-window",
      version: "1",
      tokenizer_id: "cl100k-base",
      tokenizer_version: "1",
      target_tokens: 5_000,
      overlap_tokens: 500,
    },
    chunk_ids: [chunkId],
    chunk_count: 1,
    total_tokens: chunk.token_count,
  });
  const source = sourceRecordSchema.parse({
    id: sourceId,
    title,
    tier: "official",
    current_revision_id: rawHash,
    current_chunk_set: { source_revision_id: rawHash, chunk_set_id: chunkSetId },
    revision_ids: [rawHash],
  });
  return { rawBytes, source, revision, projection, chunkSet, chunks: [chunk] };
}

export function buildSourceRevisionPair(): [SourceFixtureArtifacts, SourceFixtureArtifacts] {
  return [
    buildSourceFixture({ text: "Alice has silver hair.\n", revision: 1 }),
    buildSourceFixture({ text: "Alice has silver hair and blue eyes.\n", revision: 2 }),
  ];
}

export function buildCharacterCardV1(overrides: Partial<CharacterCardV1Fixture> = {}): CharacterCardV1Fixture {
  return {
    name: "Alice",
    description: "A fixture character.",
    personality: "Careful",
    scenario: "A library",
    first_mes: "Hello",
    mes_example: "<START>\nAlice: Welcome.",
    ...overrides,
  };
}

export function buildCharacterCardV3(
  dataOverrides: Partial<CharacterCardV3["data"]> = {},
): CharacterCardV3 {
  return characterCardV3Schema.parse({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Alice",
      description: "A fixture character.",
      personality: "Careful",
      scenario: "A library",
      first_mes: "Hello",
      mes_example: "<START>\nAlice: Welcome.",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: [],
      tags: ["fixture"],
      creator: "card-workspace",
      character_version: "1",
      extensions: {},
      ...dataOverrides,
    },
  });
}

export function buildCharacterCardV2(
  dataOverrides: Partial<CharacterCardV2["data"]> = {},
): CharacterCardV2 {
  const v3 = buildCharacterCardV3();
  const data = Object.fromEntries(
    Object.entries(v3.data).filter(([key]) => key !== "group_only_greetings"),
  );
  return characterCardV2Schema.parse({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { ...data, ...dataOverrides },
  });
}

function basePng(extraChunks: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    pngSignature,
    encodePngChunk("IHDR", ihdr),
    ...extraChunks,
    encodePngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    encodePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function buildCharacterCardPng(options: { v2Backfill?: boolean } = {}): Buffer {
  return writeCardToPng(
    basePng(),
    buildCharacterCardV3(),
    options.v2Backfill ? buildCharacterCardV2() : undefined,
  );
}

export function buildCharaOnlyPng(): Buffer {
  const payload = Buffer.from(JSON.stringify(buildCharacterCardV2()), "utf8").toString("base64");
  return basePng([encodePngChunk("tEXt", encodeTextChunk("chara", payload))]);
}

export function corruptSourceFixture(
  fixture: SourceFixtureArtifacts,
  kind: "snapshot" | "chunk" | "journal",
): Buffer | Chunk | string {
  if (kind === "snapshot") return Buffer.concat([fixture.rawBytes, Buffer.from("corrupt")]);
  if (kind === "journal") return '{"sequence":1}\nnot-json\n';
  return { ...fixture.chunks[0]!, content: `${fixture.chunks[0]!.content}corrupt` };
}
