import type {
  Chunk,
  EvidenceLocator,
  ExtractedTextProjection,
  FactEvidence,
} from "@card-workspace/schemas";

import { normalizedRangeToLineRange, normalizedRangeToSourceByteRange } from "./line-map.js";
import { IngestionError } from "./types.js";

export interface EvidenceArtifacts {
  projection: ExtractedTextProjection;
  chunk: Chunk;
}

function quoteOccurrences(content: string, quote: string): number[] {
  const matches: number[] = [];
  for (let start = content.indexOf(quote); start >= 0; start = content.indexOf(quote, start + 1)) {
    matches.push(start);
  }
  return matches;
}

function fail(code: string, message: string): never {
  throw new IngestionError(code, message);
}

function rangesEqual(left: readonly number[], right: readonly number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function assertScalarBoundary(text: string, offset: number): void {
  if (offset <= 0 || offset >= text.length) return;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
    fail("EVIDENCE_CHARACTER_RANGE_INVALID", `evidence range 位於 Unicode surrogate pair 中間：${offset}`);
  }
}

export function validateEvidenceArtifacts(evidence: FactEvidence, artifacts: EvidenceArtifacts): FactEvidence {
  const { projection, chunk } = artifacts;
  if (evidence.source_id !== projection.source_id || evidence.source_id !== chunk.source_id) {
    fail("EVIDENCE_SOURCE_MISMATCH", `evidence source 引用鏈不符：${evidence.id}`);
  }
  if (
    evidence.source_revision_id !== projection.source_revision_id
    || evidence.source_revision_id !== chunk.source_revision_id
  ) {
    fail("EVIDENCE_REVISION_MISMATCH", `evidence source revision 引用鏈不符：${evidence.id}`);
  }
  if (evidence.chunk_set_id !== chunk.chunk_set_id) {
    fail("EVIDENCE_CHUNK_SET_MISMATCH", `evidence chunk set 引用鏈不符：${evidence.id}`);
  }
  if (evidence.chunk_id !== chunk.id) {
    fail("EVIDENCE_CHUNK_MISMATCH", `evidence chunk 引用鏈不符：${evidence.id}`);
  }
  if (evidence.chunk_hash !== chunk.content_hash) {
    fail("EVIDENCE_CHUNK_HASH_MISMATCH", `evidence chunk hash 不符：${evidence.id}`);
  }

  const [start, end] = evidence.normalized_character_range;
  const [chunkStart, chunkEnd] = chunk.normalized_character_range;
  if (start >= end || start < chunkStart || end > chunkEnd || end > projection.text.length) {
    fail("EVIDENCE_CHARACTER_RANGE_INVALID", `evidence normalized character range 無效：${evidence.id}`);
  }
  assertScalarBoundary(projection.text, start);
  assertScalarBoundary(projection.text, end);
  if (projection.text.slice(start, end) !== evidence.quote) {
    fail("EVIDENCE_QUOTE_MISMATCH", `evidence quote 不等於指定 normalized range：${evidence.id}`);
  }

  if (!projection.line_map) {
    fail("EVIDENCE_LINE_MAP_MISSING", `projection 缺少 evidence line map：${evidence.id}`);
  }
  const expectedLines = normalizedRangeToLineRange(projection.line_map, [start, end]);
  if (!rangesEqual(evidence.normalized_line_range, expectedLines)) {
    fail("EVIDENCE_LINE_RANGE_MISMATCH", `evidence normalized line range 不符：${evidence.id}`);
  }

  const expectedRawBytes = normalizedRangeToSourceByteRange(
    projection.text,
    projection.line_map,
    [start, end],
  );
  if (expectedRawBytes) {
    if (!evidence.raw_byte_range) {
      fail("EVIDENCE_RAW_BYTE_RANGE_REQUIRED", `raw snapshot evidence 需要 raw byte range：${evidence.id}`);
    }
    if (!rangesEqual(evidence.raw_byte_range, expectedRawBytes)) {
      fail("EVIDENCE_RAW_BYTE_RANGE_MISMATCH", `evidence raw byte range 不符：${evidence.id}`);
    }
  } else if (evidence.raw_byte_range) {
    fail("EVIDENCE_RAW_BYTE_RANGE_FORBIDDEN", `field projection evidence 不得宣稱 raw byte range：${evidence.id}`);
  }

  return evidence;
}

export function resolveEvidenceLocator(
  locator: EvidenceLocator,
  projection: ExtractedTextProjection,
  chunk: Chunk,
): FactEvidence {
  const matches = quoteOccurrences(chunk.content, locator.quote);
  if (matches.length === 0 || (locator.occurrence !== undefined && locator.occurrence >= matches.length)) {
    fail("EVIDENCE_QUOTE_NOT_FOUND", `chunk 中找不到指定 evidence quote occurrence：${locator.id}`);
  }
  if (matches.length > 1 && locator.occurrence === undefined) {
    fail("EVIDENCE_QUOTE_AMBIGUOUS", `chunk 中 evidence quote 不唯一，必須指定 occurrence：${locator.id}`);
  }

  const localStart = matches[locator.occurrence ?? 0]!;
  const start = chunk.normalized_character_range[0] + localStart;
  const range: [number, number] = [start, start + locator.quote.length];
  if (!projection.line_map) {
    fail("EVIDENCE_LINE_MAP_MISSING", `projection 缺少 evidence line map：${locator.id}`);
  }
  const rawByteRange = normalizedRangeToSourceByteRange(projection.text, projection.line_map, range);
  const evidence: FactEvidence = {
    id: locator.id,
    source_id: chunk.source_id,
    source_revision_id: chunk.source_revision_id,
    chunk_set_id: chunk.chunk_set_id,
    chunk_id: chunk.id,
    chunk_hash: chunk.content_hash,
    quote: locator.quote,
    normalized_character_range: range,
    normalized_line_range: normalizedRangeToLineRange(projection.line_map, range),
    ...(rawByteRange ? { raw_byte_range: rawByteRange } : {}),
    ...(locator.chapter === undefined ? {} : { chapter: locator.chapter }),
    extensions: locator.extensions,
  };
  return validateEvidenceArtifacts(evidence, { projection, chunk });
}
