import { createHash } from "node:crypto";

import {
  ccv3DataSchema,
  characterCardV2Schema,
  characterCardV3Schema,
  importedCardEnvelopeSchema,
  jsonObjectSchema,
  type CharacterCardV3,
  type Diagnostic,
  type ImportedCardEnvelope,
  type JsonObject,
} from "@card-workspace/schemas";
import { z } from "zod";

const v1Schema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    personality: z.string().default(""),
    scenario: z.string().default(""),
    first_mes: z.string().default(""),
    mes_example: z.string().default(""),
  })
  .passthrough();

function rawRevision(value: unknown, source?: string | Buffer): `sha256:${string}` {
  const bytes = source ?? JSON.stringify(value);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function warning(code: string, message: string, path: Array<string | number>): Diagnostic {
  return {
    code,
    severity: "warning",
    message,
    location: { file: "imported-card", path },
    evidence: [],
    fixability: "manual",
  };
}

function defaults(data: Record<string, unknown>): CharacterCardV3["data"] {
  return ccv3DataSchema.parse({
    ...data,
    name: data.name,
    description: data.description ?? "",
    personality: data.personality ?? "",
    scenario: data.scenario ?? "",
    first_mes: data.first_mes ?? "",
    mes_example: data.mes_example ?? "",
    creator_notes: data.creator_notes ?? "",
    system_prompt: data.system_prompt ?? "",
    post_history_instructions: data.post_history_instructions ?? "",
    alternate_greetings: data.alternate_greetings ?? [],
    group_only_greetings: data.group_only_greetings ?? [],
    tags: data.tags ?? [],
    creator: data.creator ?? "",
    character_version: data.character_version ?? "",
    extensions: data.extensions ?? {},
  });
}

function importV1(value: unknown): { card: CharacterCardV3; passthrough: JsonObject } {
  const source = v1Schema.parse(value);
  const { name, description, personality, scenario, first_mes, mes_example, ...unknownRoot } = source;
  return {
    card: characterCardV3Schema.parse({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: defaults({ name, description, personality, scenario, first_mes, mes_example }),
    }),
    passthrough: { root: jsonObjectSchema.parse(unknownRoot) },
  };
}

function importV2(value: unknown): CharacterCardV3 {
  const source = characterCardV2Schema.parse(value);
  const characterBook = source.data.character_book
    ? {
        ...source.data.character_book,
        entries: source.data.character_book.entries.map((entry) => ({ ...entry, use_regex: false })),
      }
    : undefined;
  const creatorNotes = source.data.creator_notes.replace(/^\[由 CCv3 降級；部分 V3 功能可能遺失\]\r?\n/u, "");
  return characterCardV3Schema.parse({
    ...source,
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: defaults({
      ...source.data,
      creator_notes: creatorNotes,
      group_only_greetings: [],
      ...(characterBook ? { character_book: characterBook } : {}),
    }),
  });
}

function importV3(value: unknown): { card: CharacterCardV3; sourceVersion: string; diagnostics: Diagnostic[] } {
  if (!value || typeof value !== "object") throw new TypeError("V3 卡片必須是物件");
  const source = value as Record<string, unknown>;
  const sourceVersion = typeof source.spec_version === "string" ? source.spec_version : "";
  if (!/^3(?:\.\d+)?$/u.test(sourceVersion)) throw new TypeError(`不支援的 V3 版本：${sourceVersion}`);
  const data = ccv3DataSchema.parse(source.data);
  return {
    card: characterCardV3Schema.parse({ ...source, spec: "chara_card_v3", spec_version: "3.0", data }),
    sourceVersion,
    diagnostics: sourceVersion === "3.0"
      ? []
      : [warning("IMPORT_FUTURE_V3", `匯入較新的 CCv3 ${sourceVersion}；未知欄位已保留。`, ["spec_version"])],
  };
}

export function importCharacterCard(value: unknown, rawSource?: string | Buffer): ImportedCardEnvelope {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let sourceFormat: "v1" | "v2" | "v3";
  let sourceVersion: string;
  let card: CharacterCardV3;
  let passthrough: JsonObject = {};
  let diagnostics: Diagnostic[] = [];
  if (source.spec === "chara_card_v3") {
    sourceFormat = "v3";
    const imported = importV3(value);
    card = imported.card;
    sourceVersion = imported.sourceVersion;
    diagnostics = imported.diagnostics;
    passthrough = { source_spec_version: sourceVersion };
  } else if (source.spec === "chara_card_v2") {
    sourceFormat = "v2";
    sourceVersion = typeof source.spec_version === "string" ? source.spec_version : "2.0";
    card = importV2(value);
  } else {
    sourceFormat = "v1";
    sourceVersion = "1.0";
    const imported = importV1(value);
    card = imported.card;
    passthrough = imported.passthrough;
  }
  return importedCardEnvelopeSchema.parse({
    schema_version: 1,
    source_format: sourceFormat,
    source_version: sourceVersion,
    raw_revision: rawRevision(value, rawSource),
    card,
    passthrough,
    diagnostics,
    losses: [],
  });
}
