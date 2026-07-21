import { importCharacterCard } from "@card-workspace/adapters-ccv3";
import { pngSignature, readCardMetadataFromPng } from "@card-workspace/adapters-png";

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
} from "../types.js";

const MAIN_FIELDS = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
] as const;

function isPng(bytes: Buffer): boolean {
  return bytes.length >= pngSignature.length && bytes.subarray(0, pngSignature.length).equals(pngSignature);
}

function parseJson(bytes: Buffer): { value: unknown; hasByteOrderMark: boolean } {
  const decoded = decodeUtf8(bytes);
  try {
    return { value: JSON.parse(decoded.text.replace(/^\uFEFF/u, "")) as unknown, hasByteOrderMark: decoded.hasByteOrderMark };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceAdapterError("CARD_JSON_INVALID", `角色卡 JSON 無效：${message}`);
  }
}

function isCardShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.spec === "chara_card_v2" || source.spec === "chara_card_v3") return true;
  return ["name", "description", "personality", "scenario", "first_mes", "mes_example"]
    .every((field) => typeof source[field] === "string");
}

function projectCard(card: ReturnType<typeof importCharacterCard>["card"]): {
  text: string;
  mappings: ExtractedTextMapping[];
  sections: ExtractedTextSection[];
} {
  let text = "";
  const mappings: ExtractedTextMapping[] = [];
  const sections: ExtractedTextSection[] = [];
  const append = (
    value: string,
    fieldPath: string,
    kind: ExtractedTextSection["kind"],
    label?: string,
    entryId?: string,
  ): void => {
    if (text.length > 0) text += "\n\n";
    const start = text.length;
    text += value;
    const mapping: ExtractedTextMapping = {
      start,
      end: text.length,
      fieldPath,
      ...(entryId === undefined ? {} : { entryId }),
    };
    mappings.push(mapping);
    sections.push({ ...mapping, kind, ...(label === undefined ? {} : { label }) });
  };

  for (const field of MAIN_FIELDS) {
    append(card.data[field], `/data/${field}`, "field", field);
  }
  card.data.alternate_greetings.forEach((value, index) => {
    append(value, `/data/alternate_greetings/${index}`, "greeting", `alternate_greeting:${index}`);
  });
  card.data.group_only_greetings.forEach((value, index) => {
    append(value, `/data/group_only_greetings/${index}`, "greeting", `group_only_greeting:${index}`);
  });
  card.data.character_book?.entries.forEach((entry, index) => {
    const entryId = entry.id === undefined ? `index:${index}` : String(entry.id);
    append(
      entry.content,
      `/data/character_book/entries/${index}/content`,
      "lore-entry",
      entry.name ?? entry.comment ?? `lore_entry:${index}`,
      entryId,
    );
  });
  return { text, mappings, sections };
}

export const characterCardSourceAdapter: SourceAdapter = {
  id: "character-card",
  version: "1.0.0",
  supports(input: SourceInputDescriptor): boolean {
    if (isPng(input.bytes)) return true;
    try {
      return isCardShape(parseJson(input.bytes).value);
    } catch {
      return false;
    }
  },
  extract(bytes: Buffer): ExtractedTextDocument {
    assertSourceSize(bytes);
    let value: unknown;
    let hasByteOrderMark = false;
    let authority: "ccv3" | "chara" | "json" = "json";
    let hasV2Backfill = false;
    if (isPng(bytes)) {
      const metadata = readCardMetadataFromPng(bytes);
      value = metadata.value;
      authority = metadata.authority;
      hasV2Backfill = metadata.hasV2Backfill;
    } else {
      const parsed = parseJson(bytes);
      value = parsed.value;
      hasByteOrderMark = parsed.hasByteOrderMark;
    }
    if (!isCardShape(value)) throw new SourceAdapterError("CARD_SHAPE_INVALID", "JSON 不是支援的 V1/V2/V3 角色卡");
    const imported = importCharacterCard(value, bytes);
    const projection = projectCard(imported.card);
    assertProjectionSize(projection.text);
    return {
      schemaVersion: 1,
      adapter: { id: this.id, version: this.version },
      format: "character-card",
      evidence: "projection",
      text: projection.text,
      hasByteOrderMark,
      sections: projection.sections,
      fieldMappings: projection.mappings,
      extensions: {
        sourceFormat: imported.source_format,
        sourceVersion: imported.source_version,
        authority,
        hasV2Backfill,
      },
    };
  },
};
