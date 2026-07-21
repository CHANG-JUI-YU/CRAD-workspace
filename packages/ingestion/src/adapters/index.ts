import {
  assertSourceSize,
  SourceAdapterError,
  type ExtractedTextDocument,
  type SourceAdapter,
  type SourceInputDescriptor,
  type SourceMetadata,
} from "../types.js";
import { characterCardSourceAdapter } from "./character-card.js";
import { structuredSourceAdapter } from "./structured.js";
import { textSourceAdapter } from "./text.js";

export * from "./character-card.js";
export * from "./structured.js";
export * from "./text.js";

export const sourceAdapters: readonly SourceAdapter[] = [
  characterCardSourceAdapter,
  structuredSourceAdapter,
  textSourceAdapter,
];

export function selectSourceAdapter(
  bytes: Buffer,
  metadata: SourceMetadata = {},
  adapters: readonly SourceAdapter[] = sourceAdapters,
): SourceAdapter {
  assertSourceSize(bytes);
  const descriptor: SourceInputDescriptor = { bytes, metadata };
  const adapter = adapters.find((candidate) => candidate.supports(descriptor));
  if (!adapter) throw new SourceAdapterError("SOURCE_FORMAT_UNSUPPORTED", "未知或不支援的來源格式");
  return adapter;
}

export function extractSource(
  bytes: Buffer,
  metadata: SourceMetadata = {},
  adapters: readonly SourceAdapter[] = sourceAdapters,
): ExtractedTextDocument {
  return selectSourceAdapter(bytes, metadata, adapters).extract(bytes, metadata);
}
