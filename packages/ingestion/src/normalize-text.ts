import type { TextLineMap, TextLineMapEntry } from "@card-workspace/schemas";

import { SourceAdapterError } from "./types.js";

export const NORMALIZER_ID = "utf8-newline";
export const NORMALIZER_VERSION = "1.0.0";

export interface NormalizedText {
  text: string;
  lineMap: TextLineMap;
}

export function normalizeText(
  bytes: Buffer,
  coordinateSpace: TextLineMap["coordinate_space"] = "raw_snapshot",
): NormalizedText {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SourceAdapterError("SOURCE_UTF8_INVALID", "來源不是有效 UTF-8");
  }

  const removedLeadingBom = bytes.length >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf;
  let sourceCharacter = removedLeadingBom ? 1 : 0;
  let sourceByte = removedLeadingBom ? 3 : 0;
  let normalizedCharacter = 0;
  let normalized = "";
  const lines: TextLineMapEntry[] = [];
  let normalizedLine = 1;

  while (sourceCharacter <= source.length) {
    let contentEnd = sourceCharacter;
    while (contentEnd < source.length && source[contentEnd] !== "\r" && source[contentEnd] !== "\n") {
      contentEnd += 1;
    }
    const content = source.slice(sourceCharacter, contentEnd);
    const contentBytes = Buffer.byteLength(content, "utf8");
    const normalizedStart = normalizedCharacter;
    normalized += content;
    normalizedCharacter += content.length;

    let lineEnding: TextLineMapEntry["line_ending"] = "none";
    let endingCharacters = 0;
    let endingBytes = 0;
    if (contentEnd < source.length) {
      if (source[contentEnd] === "\r" && source[contentEnd + 1] === "\n") {
        lineEnding = "crlf";
        endingCharacters = 2;
        endingBytes = 2;
      } else if (source[contentEnd] === "\r") {
        lineEnding = "cr";
        endingCharacters = 1;
        endingBytes = 1;
      } else {
        lineEnding = "lf";
        endingCharacters = 1;
        endingBytes = 1;
      }
    }

    lines.push({
      normalized_line: normalizedLine,
      normalized_character_range: [normalizedStart, normalizedCharacter],
      source_character_range: [sourceCharacter, contentEnd],
      source_byte_range: [sourceByte, sourceByte + contentBytes],
      line_ending: lineEnding,
      ...(lineEnding === "none" ? {} : {
        source_line_ending_character_range: [contentEnd, contentEnd + endingCharacters] as [number, number],
        source_line_ending_byte_range: [sourceByte + contentBytes, sourceByte + contentBytes + endingBytes] as [number, number],
      }),
    });

    if (lineEnding === "none") break;
    normalized += "\n";
    normalizedCharacter += 1;
    sourceCharacter = contentEnd + endingCharacters;
    sourceByte += contentBytes + endingBytes;
    normalizedLine += 1;
  }

  return {
    text: normalized,
    lineMap: {
      schema_version: 1,
      coordinate_space: coordinateSpace,
      source_byte_size: bytes.length,
      source_character_count: source.length,
      normalized_character_count: normalized.length,
      removed_leading_bom: removedLeadingBom,
      lines,
    },
  };
}
