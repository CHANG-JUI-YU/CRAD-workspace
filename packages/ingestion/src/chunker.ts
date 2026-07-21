import {
  chunkProfileSchema,
  chunkSchema,
  chunkSetManifestSchema,
  type Chunk,
  type ChunkProfile,
  type ChunkSetManifest,
  type ExtractedTextProjection,
} from "@card-workspace/schemas";
import { computeRevision, computeTextRevision } from "@card-workspace/project";
import { getEncoding } from "js-tiktoken";

import { normalizedRangeToLineRange, normalizedRangeToSourceByteRange } from "./line-map.js";
import { IngestionError } from "./types.js";

export const TOKENIZER_ID = "cl100k_base";
export const TOKENIZER_VERSION = "js-tiktoken@1.0.21";

export const DEFAULT_CHUNK_PROFILE: ChunkProfile = chunkProfileSchema.parse({
  id: "default-7500-750",
  strategy: "boundary-sliding-window",
  version: "1.0.0",
  tokenizer_id: TOKENIZER_ID,
  tokenizer_version: TOKENIZER_VERSION,
  target_tokens: 7_500,
  overlap_tokens: 750,
});

export interface ChunkSetArtifacts {
  manifest: ChunkSetManifest;
  chunks: Chunk[];
}

export interface CreateChunkSetOptions {
  projection: ExtractedTextProjection;
  profile?: ChunkProfile;
}

interface BoundaryGroups {
  chapter: number[];
  paragraph: number[];
  sentence: number[];
}

function safeBoundary(text: string, offset: number): number {
  if (offset > 0 && offset < text.length) {
    const previous = text.charCodeAt(offset - 1);
    const current = text.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
      return offset - 1;
    }
  }
  return offset;
}

function boundaryGroups(text: string): BoundaryGroups {
  const chapter: number[] = [];
  const paragraph: number[] = [];
  const sentence: number[] = [];
  const chapterPattern = /^(?:#{1,6}\s+\S.*|chapter\s+\S.*|第[^\n]{1,40}[章節卷部篇回](?:\s.*)?)$/gimu;
  const paragraphPattern = /\n{2,}/gu;
  const sentencePattern = /[。！？!?]["'」』】）》]*[ \t]*(?:\n|$)|\n/gu;
  for (const match of text.matchAll(chapterPattern)) {
    if ((match.index ?? 0) > 0) chapter.push(match.index ?? 0);
  }
  for (const match of text.matchAll(paragraphPattern)) {
    paragraph.push((match.index ?? 0) + match[0].length);
  }
  for (const match of text.matchAll(sentencePattern)) {
    sentence.push((match.index ?? 0) + match[0].length);
  }
  return { chapter, paragraph, sentence };
}

function latestBoundary(
  candidates: readonly number[],
  start: number,
  hardEnd: number,
  minimumTokens: number,
  count: (value: string) => number,
  text: string,
): number | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate === undefined || candidate <= start || candidate > hardEnd) continue;
    if (count(text.slice(start, candidate)) >= minimumTokens) return candidate;
  }
  return undefined;
}

function hardEndForTokenLimit(
  text: string,
  start: number,
  tokenLimit: number,
  count: (value: string) => number,
): number {
  let low = start + 1;
  let high = text.length;
  let best = start;
  while (low <= high) {
    const middle = safeBoundary(text, Math.floor((low + high) / 2));
    if (middle <= start) {
      low = Math.floor((low + high) / 2) + 1;
      continue;
    }
    if (count(text.slice(start, middle)) <= tokenLimit) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  while (best > start && count(text.slice(start, best)) > tokenLimit) best = safeBoundary(text, best - 1);
  if (best === start) {
    const next = text.codePointAt(start) === undefined ? start : start + (text.codePointAt(start)! > 0xffff ? 2 : 1);
    if (next > start && count(text.slice(start, next)) <= tokenLimit) return next;
    throw new IngestionError("CHUNK_TOKEN_LIMIT_IMPOSSIBLE", "單一 Unicode character 超過 token limit");
  }
  return best;
}

function leadingOverlapStart(
  text: string,
  end: number,
  tokenLimit: number,
  count: (value: string) => number,
): number {
  let low = 0;
  let high = end;
  let best = end;
  while (low <= high) {
    const middle = safeBoundary(text, Math.floor((low + high) / 2));
    if (count(text.slice(middle, end)) <= tokenLimit) {
      best = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  while (best < end && count(text.slice(best, end)) > tokenLimit) {
    const codePoint = text.codePointAt(best);
    best += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  }
  return best;
}

function chapterPathAt(text: string, offset: number): string[] {
  const lineEnd = text.indexOf("\n", offset);
  const prefix = text.slice(0, lineEnd === -1 ? text.length : lineEnd);
  const matches = [...prefix.matchAll(/^(#{1,6})\s+(\S.*)$/gmu)];
  const latest = matches.at(-1);
  if (latest?.[2]) return [latest[2]];
  const traditional = [...prefix.matchAll(/^(第[^\n]{1,40}[章節卷部篇回](?:\s.*)?)$/gmu)].at(-1);
  if (traditional?.[1]) return [traditional[1]];
  const english = [...prefix.matchAll(/^(chapter\s+\S.*)$/gimu)].at(-1);
  return english?.[1] ? [english[1]] : [];
}

export function createChunkSet(options: CreateChunkSetOptions): ChunkSetArtifacts {
  const profile = chunkProfileSchema.parse(options.profile ?? DEFAULT_CHUNK_PROFILE);
  if (profile.tokenizer_id !== TOKENIZER_ID || profile.tokenizer_version !== TOKENIZER_VERSION) {
    throw new IngestionError(
      "CHUNK_TOKENIZER_UNSUPPORTED",
      `只支援 ${TOKENIZER_ID} ${TOKENIZER_VERSION}`,
    );
  }
  const projection = options.projection;
  if (!projection.line_map) {
    throw new IngestionError("PROJECTION_LINE_MAP_MISSING", "建立 chunk set 需要保存的 projection line map");
  }
  if (projection.line_map.normalized_character_count !== projection.text.length) {
    throw new IngestionError("PROJECTION_LINE_MAP_MISMATCH", "projection text 與 line map 長度不符");
  }
  const encoding = getEncoding("cl100k_base");
  const count = (value: string): number => encoding.encode(value).length;
  const normalizedHash = computeTextRevision(projection.text);
  if (normalizedHash !== projection.normalized_hash) {
    throw new IngestionError("SOURCE_PROJECTION_HASH_MISMATCH", "projection normalized hash 不符");
  }
  const setDigest = computeRevision({
    source_revision_id: projection.source_revision_id,
    normalized_hash: normalizedHash,
    normalizer_id: projection.normalizer_id,
    normalizer_version: projection.normalizer_version,
    profile,
  }).slice("sha256:".length);
  const chunkSetId = `chunk-set-${setDigest}`;
  const boundaries = boundaryGroups(projection.text);
  const mainRanges: Array<[number, number]> = [];
  let start = 0;
  while (start < projection.text.length) {
    const hardEnd = hardEndForTokenLimit(projection.text, start, profile.target_tokens, count);
    if (hardEnd === projection.text.length) {
      mainRanges.push([start, hardEnd]);
      break;
    }
    const minimumTokens = Math.floor(profile.target_tokens * 0.5);
    const end = latestBoundary(boundaries.chapter, start, hardEnd, minimumTokens, count, projection.text)
      ?? latestBoundary(boundaries.paragraph, start, hardEnd, minimumTokens, count, projection.text)
      ?? latestBoundary(boundaries.sentence, start, hardEnd, minimumTokens, count, projection.text)
      ?? hardEnd;
    mainRanges.push([start, end]);
    start = end;
  }

  const chunks = mainRanges.map(([mainStart, mainEnd], sequence) => {
    const chunkStart = sequence === 0
      ? mainStart
      : leadingOverlapStart(projection.text, mainStart, profile.overlap_tokens, count);
    const chunkEnd = sequence === mainRanges.length - 1
      ? mainEnd
      : hardEndForTokenLimit(projection.text, mainEnd, profile.overlap_tokens, count);
    const content = projection.text.slice(chunkStart, chunkEnd);
    const contentHash = computeTextRevision(content);
    const idDigest = computeRevision({
      source_revision_id: projection.source_revision_id,
      chunk_set_id: chunkSetId,
      normalized_character_range: [chunkStart, chunkEnd],
      main_range: [mainStart, mainEnd],
      content_hash: contentHash,
    }).slice("sha256:".length);
    const normalizedRange: [number, number] = [chunkStart, chunkEnd];
    return chunkSchema.parse({
      schema_version: 1,
      id: `chunk-${idDigest}`,
      source_id: projection.source_id,
      source_revision_id: projection.source_revision_id,
      chunk_set_id: chunkSetId,
      sequence,
      chapter_path: chapterPathAt(projection.text, mainStart),
      normalized_character_range: normalizedRange,
      normalized_line_range: normalizedRangeToLineRange(projection.line_map!, normalizedRange),
      ...(normalizedRangeToSourceByteRange(projection.text, projection.line_map!, normalizedRange)
        ? { raw_byte_range: normalizedRangeToSourceByteRange(projection.text, projection.line_map!, normalizedRange) }
        : {}),
      main_range: [mainStart, mainEnd],
      ...(chunkStart < mainStart ? { leading_overlap_range: [chunkStart, mainStart] } : {}),
      ...(chunkEnd > mainEnd ? { trailing_overlap_range: [mainEnd, chunkEnd] } : {}),
      token_count: count(content),
      content_hash: contentHash,
      content,
      extensions: {},
    });
  });

  return {
    manifest: chunkSetManifestSchema.parse({
      schema_version: 1,
      id: chunkSetId,
      source_id: projection.source_id,
      source_revision_id: projection.source_revision_id,
      normalized_hash: normalizedHash,
      profile,
      chunk_ids: chunks.map((chunk) => chunk.id),
      chunk_count: chunks.length,
      total_tokens: count(projection.text),
      extensions: {
        normalizer_id: projection.normalizer_id,
        normalizer_version: projection.normalizer_version,
      },
    }),
    chunks,
  };
}
