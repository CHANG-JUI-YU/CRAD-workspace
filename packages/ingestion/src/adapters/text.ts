import {
  assertProjectionSize,
  assertSourceSize,
  decodeUtf8,
  SourceAdapterError,
  type ExtractedTextDocument,
  type SourceAdapter,
  type SourceInputDescriptor,
  type SourceMetadata,
} from "../types.js";

const TEXT_EXTENSIONS = new Set([".txt", ".text", ".md", ".markdown", ".chat", ".log"]);

function extension(metadata: SourceMetadata): string {
  const value = metadata.extension ?? metadata.fileName?.match(/(\.[^./\\]+)$/u)?.[1] ?? "";
  return value.toLowerCase().startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function format(metadata: SourceMetadata): "text" | "markdown" | "chat" {
  if (metadata.format === "markdown" || [".md", ".markdown"].includes(extension(metadata))) return "markdown";
  if (metadata.format === "chat" || extension(metadata) === ".chat") return "chat";
  return "text";
}

function hasBinaryControls(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) return true;
  }
  return false;
}

function metadataAllowsText(metadata: SourceMetadata): boolean {
  return metadata.format === "text"
    || metadata.format === "markdown"
    || metadata.format === "chat"
    || metadata.mediaType?.toLowerCase().startsWith("text/") === true
    || TEXT_EXTENSIONS.has(extension(metadata));
}

export const textSourceAdapter: SourceAdapter = {
  id: "text",
  version: "1.0.0",
  supports(input: SourceInputDescriptor): boolean {
    if (!metadataAllowsText(input.metadata)) return false;
    try {
      return !hasBinaryControls(decodeUtf8(input.bytes).text);
    } catch {
      return true;
    }
  },
  extract(bytes: Buffer, metadata: SourceMetadata): ExtractedTextDocument {
    assertSourceSize(bytes);
    const decoded = decodeUtf8(bytes);
    if (hasBinaryControls(decoded.text)) {
      throw new SourceAdapterError("SOURCE_BINARY_UNKNOWN", "文字來源含二進位控制字元");
    }
    assertProjectionSize(decoded.text);
    return {
      schemaVersion: 1,
      adapter: { id: this.id, version: this.version },
      format: format(metadata),
      evidence: "raw",
      text: decoded.text,
      hasByteOrderMark: decoded.hasByteOrderMark,
      sections: [{ start: 0, end: decoded.text.length, fieldPath: "", kind: "document" }],
      fieldMappings: [{ start: 0, end: decoded.text.length, fieldPath: "" }],
      extensions: {},
    };
  },
};
