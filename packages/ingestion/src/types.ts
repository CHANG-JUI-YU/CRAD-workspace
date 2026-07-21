export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECTION_BYTES = 16 * 1024 * 1024;

export type SourceFormatHint =
  | "text"
  | "markdown"
  | "chat"
  | "json"
  | "yaml"
  | "character-card";

export interface SourceMetadata {
  fileName?: string;
  extension?: string;
  mediaType?: string;
  format?: SourceFormatHint;
  title?: string;
  language?: string;
}

export interface SourceInputDescriptor {
  bytes: Buffer;
  metadata: SourceMetadata;
}

export interface ExtractedTextMapping {
  start: number;
  end: number;
  fieldPath: string;
  entryId?: string;
}

export interface ExtractedTextSection extends ExtractedTextMapping {
  kind: "document" | "field" | "greeting" | "lore-entry";
  label?: string;
}

export interface ExtractedTextDocument {
  schemaVersion: 1;
  adapter: {
    id: string;
    version: string;
  };
  format: "text" | "markdown" | "chat" | "json" | "yaml" | "character-card";
  evidence: "raw" | "projection";
  text: string;
  hasByteOrderMark: boolean;
  sections: ExtractedTextSection[];
  fieldMappings: ExtractedTextMapping[];
  extensions: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  version: string;
  supports(input: SourceInputDescriptor): boolean;
  extract(bytes: Buffer, metadata: SourceMetadata): ExtractedTextDocument;
}

export class SourceAdapterError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SourceAdapterError";
  }
}

export class IngestionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}

export function assertSourceSize(bytes: Buffer): void {
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new SourceAdapterError("SOURCE_TOO_LARGE", `來源超過 ${MAX_SOURCE_BYTES} bytes 限制`);
  }
}

export function assertProjectionSize(text: string): void {
  const size = Buffer.byteLength(text, "utf8");
  if (size > MAX_PROJECTION_BYTES) {
    throw new SourceAdapterError(
      "PROJECTION_TOO_LARGE",
      `文字 projection 超過 ${MAX_PROJECTION_BYTES} bytes 限制`,
    );
  }
}

export function decodeUtf8(bytes: Buffer): { text: string; hasByteOrderMark: boolean } {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      hasByteOrderMark: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    };
  } catch {
    throw new SourceAdapterError("SOURCE_UTF8_INVALID", "來源不是有效 UTF-8");
  }
}
