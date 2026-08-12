import { contentHash, internalId, type KnowledgeChunk, type SourceRecord } from "@st-workspace/core";

/** Version tag stamped on every chunk produced by the built-in extractor. */
export const KNOWLEDGE_EXTRACTOR_REVISION = "extractor-v1";

/**
 * Split a canonical source into stable, human-reviewable chunks.  Chunking is
 * deliberately independent from fact extraction so a different extractor can
 * reuse the same source material without changing the repository contract.
 */
export function splitIntoChunks(text: string, size = 800): string[] {
  const normalized = text.trim();
  if (normalized.length <= size) return normalized.length === 0 ? [] : [normalized];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    let end = Math.min(offset + size, normalized.length);
    if (end < normalized.length) {
      while (end > offset && normalized.charCodeAt(end - 1) >= 0xd800 && normalized.charCodeAt(end - 1) <= 0xdbff) end -= 1;
      const window = normalized.slice(offset, end);
      const boundary = Math.max(window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"), window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"), window.lastIndexOf("\n"));
      if (boundary > size * 0.5) end = offset + boundary + 1;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}
/** Sentence-level extraction is an input to structured extraction, not a fact. */
export function sentenceCandidates(text: string): string[] {
  return text
    .split(/(?:[.!?。！？；;]+|\n+)/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

export function chunkSource(source: SourceRecord, extractorRevision = KNOWLEDGE_EXTRACTOR_REVISION): KnowledgeChunk[] {
  return splitIntoChunks(source.canonical_text).map((text, ordinal) => ({
    id: internalId("chunk"),
    source_id: source.id,
    ordinal,
    text,
    hash: contentHash(text),
    extractor_revision: extractorRevision,
    created_at: new Date().toISOString(),
  }));
}
