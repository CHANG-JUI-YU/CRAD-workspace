import { parseDocument } from "yaml";

import {
  assertProjectionSize,
  assertSourceSize,
  decodeUtf8,
  SourceAdapterError,
  type ExtractedTextDocument,
  type ExtractedTextMapping,
  type ExtractedTextSection,
  type SourceAdapter,
  type SourceInputDescriptor,
  type SourceMetadata,
} from "../types.js";

type StructuredFormat = "json" | "yaml";

function extension(metadata: SourceMetadata): string {
  const value = metadata.extension ?? metadata.fileName?.match(/(\.[^./\\]+)$/u)?.[1] ?? "";
  return value.toLowerCase().startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function hintedFormat(metadata: SourceMetadata): StructuredFormat | undefined {
  const ext = extension(metadata);
  const mediaType = metadata.mediaType?.split(";", 1)[0]?.trim().toLowerCase();
  if (metadata.format === "json" || ext === ".json" || mediaType === "application/json") return "json";
  if (
    metadata.format === "yaml"
    || ext === ".yaml"
    || ext === ".yml"
    || mediaType === "application/yaml"
    || mediaType === "application/x-yaml"
  ) return "yaml";
  return undefined;
}

function looksLikeJson(text: string): boolean {
  const first = text.replace(/^\uFEFF/u, "").trimStart()[0];
  return first === "{" || first === "[";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/u, "")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceAdapterError("SOURCE_JSON_INVALID", `無效 JSON：${message}`);
  }
}

function parseYaml(text: string): unknown {
  const document = parseDocument(text.replace(/^\uFEFF/u, ""), {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors[0]) {
    throw new SourceAdapterError("SOURCE_YAML_INVALID", `無效 YAML：${document.errors[0].message}`);
  }
  try {
    return document.toJS({ maxAliasCount: 100 }) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceAdapterError("SOURCE_YAML_INVALID", `無效 YAML：${message}`);
  }
}

export function parseStructuredSource(bytes: Buffer, format: StructuredFormat): unknown {
  assertSourceSize(bytes);
  const text = decodeUtf8(bytes).text;
  return format === "json" ? parseJson(text) : parseYaml(text);
}

function pointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new SourceAdapterError("SOURCE_STRUCTURE_UNSUPPORTED", "結構含不支援的值");
  return encoded;
}

function project(value: unknown): { text: string; mappings: ExtractedTextMapping[]; sections: ExtractedTextSection[] } {
  let text = "";
  const mappings: ExtractedTextMapping[] = [];
  const sections: ExtractedTextSection[] = [];

  const append = (fieldPath: string, item: unknown): void => {
    if (text.length > 0) text += "\n\n";
    const rendered = scalarText(item);
    const start = text.length;
    text += rendered;
    const mapping = { start, end: text.length, fieldPath };
    mappings.push(mapping);
    sections.push({ ...mapping, kind: "field" });
  };

  const visit = (item: unknown, fieldPath: string, ancestors: Set<object>): void => {
    if (item === null || typeof item !== "object") {
      append(fieldPath, item);
      return;
    }
    if (ancestors.has(item)) throw new SourceAdapterError("SOURCE_STRUCTURE_UNSUPPORTED", "結構不得循環引用");
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (item.length === 0) append(fieldPath, item);
      item.forEach((child, index) => visit(child, `${fieldPath}/${index}`, ancestors));
    } else {
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (keys.length === 0) append(fieldPath, record);
      for (const key of keys) visit(record[key], `${fieldPath}/${pointerSegment(key)}`, ancestors);
    }
    ancestors.delete(item);
  };

  visit(value, "", new Set());
  return { text, mappings, sections };
}

function determineFormat(text: string, metadata: SourceMetadata): StructuredFormat {
  if (looksLikeJson(text)) return "json";
  return hintedFormat(metadata) ?? "yaml";
}

export const structuredSourceAdapter: SourceAdapter = {
  id: "structured",
  version: "1.0.0",
  supports(input: SourceInputDescriptor): boolean {
    try {
      const text = decodeUtf8(input.bytes).text;
      return looksLikeJson(text) || hintedFormat(input.metadata) !== undefined;
    } catch {
      return hintedFormat(input.metadata) !== undefined;
    }
  },
  extract(bytes: Buffer, metadata: SourceMetadata): ExtractedTextDocument {
    assertSourceSize(bytes);
    const decoded = decodeUtf8(bytes);
    const format = determineFormat(decoded.text, metadata);
    const value = parseStructuredSource(bytes, format);
    const projection = project(value);
    assertProjectionSize(projection.text);
    return {
      schemaVersion: 1,
      adapter: { id: this.id, version: this.version },
      format,
      evidence: "projection",
      text: projection.text,
      hasByteOrderMark: decoded.hasByteOrderMark,
      sections: projection.sections,
      fieldMappings: projection.mappings,
      extensions: {},
    };
  },
};
