import { emitCharacterCardV3 } from "@card-workspace/adapters-ccv3";
import { diffValues } from "@card-workspace/project";
import type { ImportedCardEnvelope, JsonObject } from "@card-workspace/schemas";

import { importedCardToCanonicalIr } from "./import-build.js";
import type { RoundTripDifference, RoundTripReport } from "./manifest.js";

const dataKnown = new Set([
  "name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes",
  "system_prompt", "post_history_instructions", "alternate_greetings", "group_only_greetings", "tags",
  "creator", "character_version", "extensions", "character_book", "assets", "nickname",
  "creator_notes_multilingual", "source", "creation_date", "modification_date",
]);
const bookKnown = new Set(["name", "description", "scan_depth", "token_budget", "recursive_scanning", "extensions", "entries"]);
const entryKnown = new Set([
  "keys", "content", "extensions", "enabled", "insertion_order", "use_regex", "case_sensitive", "constant",
  "name", "priority", "id", "comment", "selective", "secondary_keys", "position",
]);

function unknownFields(value: Record<string, unknown>, known: Set<string>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key))) as JsonObject;
}

function unknownSnapshot(card: ImportedCardEnvelope["card"]): JsonObject {
  const root = { ...card } as Record<string, unknown>;
  delete root.spec;
  delete root.spec_version;
  delete root.data;
  const data = card.data as Record<string, unknown>;
  const book = card.data.character_book;
  return {
    root: root as JsonObject,
    data_extensions: card.data.extensions,
    data_future: unknownFields(data, dataKnown),
    book_extensions: book?.extensions ?? {},
    book_future: book ? unknownFields(book as Record<string, unknown>, bookKnown) : {},
    entry_extensions: (book?.entries ?? []).map((entry) => entry.extensions),
    entry_future: (book?.entries ?? []).map((entry) => unknownFields(entry as Record<string, unknown>, entryKnown)),
  };
}

export function roundTripImportedCard(envelope: ImportedCardEnvelope): RoundTripReport {
  const emitted = emitCharacterCardV3(importedCardToCanonicalIr(envelope));
  const unexpected = diffValues(unknownSnapshot(envelope.card), unknownSnapshot(emitted))
    .filter((difference) => difference.kind !== "added")
    .map<RoundTripDifference>((difference) => ({
      path: difference.path,
      classification: "unexpected_loss",
      reason: "未知欄位或 extension 在 round-trip 後改變",
    }));
  const expected: RoundTripDifference[] = envelope.card.data.description || envelope.card.data.personality || envelope.card.data.scenario || envelope.card.data.mes_example
    ? [{ path: "/data", classification: "expected_loss", reason: "minimal_worldbook profile 會清空四個主卡提示欄位" }]
    : [];
  const differences = [...expected, ...unexpected];
  return {
    schema_version: 1,
    status: unexpected.length > 0 ? "unexpected_loss" : expected.length > 0 ? "expected_loss" : "equivalent",
    differences,
  };
}
