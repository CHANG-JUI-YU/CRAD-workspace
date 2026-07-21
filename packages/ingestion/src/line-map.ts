import type { TextLineMap, TextLineMapEntry } from "@card-workspace/schemas";

import { IngestionError } from "./types.js";

type Range = [number, number];

function fail(message: string): never {
  throw new IngestionError("LINE_MAP_RANGE_INVALID", message);
}

function assertRange(range: Range, limit: number, label: string): void {
  if (range[0] < 0 || range[1] < range[0] || range[1] > limit) {
    fail(`${label} 超出範圍：${range[0]}..${range[1]}`);
  }
}

function assertScalarBoundary(text: string, offset: number): void {
  if (offset <= 0 || offset >= text.length) return;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
    fail(`character offset 位於 Unicode surrogate pair 中間：${offset}`);
  }
}

function entryForNormalizedOffset(lineMap: TextLineMap, offset: number): TextLineMapEntry {
  const exactStart = lineMap.lines.find((entry) => entry.normalized_character_range[0] === offset);
  if (exactStart) return exactStart;
  const entry = lineMap.lines.find((candidate) => {
    const [start, end] = candidate.normalized_character_range;
    return offset >= start && offset <= end;
  });
  if (!entry) fail(`找不到 normalized character offset：${offset}`);
  return entry;
}

function normalizedBoundaryToSource(
  normalizedText: string,
  lineMap: TextLineMap,
  offset: number,
  kind: "byte" | "character",
): number {
  if (offset === lineMap.normalized_character_count) {
    return kind === "byte" ? lineMap.source_byte_size : lineMap.source_character_count;
  }
  const entry = entryForNormalizedOffset(lineMap, offset);
  const [normalizedStart] = entry.normalized_character_range;
  const prefix = normalizedText.slice(normalizedStart, offset);
  if (kind === "byte") return entry.source_byte_range[0] + Buffer.byteLength(prefix, "utf8");
  return entry.source_character_range[0] + prefix.length;
}

export function normalizedRangeToSourceByteRange(
  normalizedText: string,
  lineMap: TextLineMap,
  range: Range,
): Range | undefined {
  assertRange(range, normalizedText.length, "normalized character range");
  if (lineMap.coordinate_space !== "raw_snapshot") return undefined;
  assertScalarBoundary(normalizedText, range[0]);
  assertScalarBoundary(normalizedText, range[1]);
  return [
    normalizedBoundaryToSource(normalizedText, lineMap, range[0], "byte"),
    normalizedBoundaryToSource(normalizedText, lineMap, range[1], "byte"),
  ];
}

export function normalizedRangeToSourceCharacterRange(
  normalizedText: string,
  lineMap: TextLineMap,
  range: Range,
): Range {
  assertRange(range, normalizedText.length, "normalized character range");
  return [
    normalizedBoundaryToSource(normalizedText, lineMap, range[0], "character"),
    normalizedBoundaryToSource(normalizedText, lineMap, range[1], "character"),
  ];
}

function sourceCharacterBoundaryToNormalized(lineMap: TextLineMap, offset: number): number {
  if (offset === lineMap.source_character_count) return lineMap.normalized_character_count;
  if (lineMap.removed_leading_bom && offset <= 1) return 0;
  for (const entry of lineMap.lines) {
    const [start, end] = entry.source_character_range;
    if (offset >= start && offset <= end) {
      return entry.normalized_character_range[0] + offset - start;
    }
    const ending = entry.source_line_ending_character_range;
    if (ending && offset === ending[1]) return entry.normalized_character_range[1] + 1;
    if (ending && offset > ending[0] && offset < ending[1]) {
      fail(`source character offset 位於不可逆的 CRLF 中間：${offset}`);
    }
  }
  fail(`找不到 source character offset：${offset}`);
}

export function sourceCharacterRangeToNormalizedRange(lineMap: TextLineMap, range: Range): Range {
  assertRange(range, lineMap.source_character_count, "source character range");
  return [
    sourceCharacterBoundaryToNormalized(lineMap, range[0]),
    sourceCharacterBoundaryToNormalized(lineMap, range[1]),
  ];
}

function sourceByteBoundaryToNormalized(
  normalizedText: string,
  lineMap: TextLineMap,
  offset: number,
): number {
  if (offset === lineMap.source_byte_size) return lineMap.normalized_character_count;
  if (lineMap.removed_leading_bom) {
    if (offset === 0 || offset === 3) return 0;
    if (offset > 0 && offset < 3) fail(`source byte offset 位於 UTF-8 BOM 中間：${offset}`);
  }
  for (const entry of lineMap.lines) {
    const [byteStart, byteEnd] = entry.source_byte_range;
    if (offset >= byteStart && offset <= byteEnd) {
      const [normalizedStart, normalizedEnd] = entry.normalized_character_range;
      let byte = byteStart;
      for (let character = normalizedStart; character <= normalizedEnd;) {
        if (byte === offset) return character;
        const codePoint = normalizedText.codePointAt(character);
        if (codePoint === undefined) break;
        const width = codePoint > 0xffff ? 2 : 1;
        byte += Buffer.byteLength(normalizedText.slice(character, character + width), "utf8");
        character += width;
      }
      fail(`source byte offset 位於 UTF-8 character 中間：${offset}`);
    }
    const ending = entry.source_line_ending_byte_range;
    if (ending) {
      if (offset === ending[0]) return entry.normalized_character_range[1];
      if (offset === ending[1]) return entry.normalized_character_range[1] + 1;
      if (offset > ending[0] && offset < ending[1]) {
        fail(`source byte offset 位於不可逆的 CRLF 中間：${offset}`);
      }
    }
  }
  fail(`找不到 source byte offset：${offset}`);
}

export function sourceByteRangeToNormalizedRange(
  normalizedText: string,
  lineMap: TextLineMap,
  range: Range,
): Range | undefined {
  if (lineMap.coordinate_space !== "raw_snapshot") return undefined;
  assertRange(range, lineMap.source_byte_size, "source byte range");
  return [
    sourceByteBoundaryToNormalized(normalizedText, lineMap, range[0]),
    sourceByteBoundaryToNormalized(normalizedText, lineMap, range[1]),
  ];
}

export function normalizedRangeToLineRange(lineMap: TextLineMap, range: Range): Range {
  assertRange(range, lineMap.normalized_character_count, "normalized character range");
  const start = entryForNormalizedOffset(lineMap, range[0]).normalized_line;
  const endOffset = range[1] > range[0] ? range[1] - 1 : range[1];
  return [start, entryForNormalizedOffset(lineMap, endOffset).normalized_line];
}
