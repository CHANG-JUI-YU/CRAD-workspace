import { importCharacterCard } from "@card-workspace/adapters-ccv3";
import { encodePngChunk, encodeTextChunk, pngSignature } from "@card-workspace/adapters-png";
import { describe, expect, it } from "vitest";

import { importCardSource, importedCardToCanonicalIr, roundTripImportedCard } from "../src/index.js";

function sourceCard() {
  return {
    vendor_root: { keep: true },
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Import",
      description: "legacy description",
      personality: "",
      scenario: "",
      first_mes: "Hello",
      mes_example: "",
      creator_notes: "notes",
      system_prompt: "system",
      post_history_instructions: "post",
      alternate_greetings: ["Alt"],
      group_only_greetings: ["Group"],
      tags: ["tag"],
      creator: "creator",
      character_version: "2",
      extensions: { vendor_data: { nested: [1, 2] } },
      vendor_data_field: "keep",
      character_book: {
        extensions: { vendor_book: true },
        vendor_book_field: "keep",
        entries: [{
          id: "lore-one",
          keys: ["key"],
          content: "raw lore",
          extensions: { vendor_entry: { keep: true }, position: 1 },
          enabled: true,
          insertion_order: 12,
          use_regex: false,
          vendor_entry_field: "keep",
        }],
      },
    },
  };
}

describe("import round-trip", () => {
  it("不猜測作者模式，保留 raw lore 與 stable import ID", () => {
    const envelope = importCharacterCard(sourceCard());
    const first = importedCardToCanonicalIr(envelope);
    const second = importedCardToCanonicalIr(envelope);
    expect(first.project_id).toBe(second.project_id);
    expect(first.characters[0]?.mode).toBe("imported");
    expect(first.entries[0]).toMatchObject({ id: "lore-one", content_format: "raw" });
  });

  it("統一來源入口可讀 JSON 與 ccv3 PNG", () => {
    const raw = Buffer.from(JSON.stringify(sourceCard()), "utf8");
    expect(importCardSource(raw).source_format).toBe("v3");
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const payload = raw.toString("base64");
    const png = Buffer.concat([
      pngSignature,
      encodePngChunk("IHDR", ihdr),
      encodePngChunk("tEXt", encodeTextChunk("ccv3", payload)),
      encodePngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(importCardSource(png).card.data.name).toBe("Import");
  });

  it("安全解析 YAML 後以 card schema 驗證並保留 source passthrough", () => {
    const yaml = Buffer.from([
      "name: YAML Import",
      "description: Legacy",
      "personality: Direct",
      "scenario: Test",
      "first_mes: Hello",
      "mes_example: Example",
      "vendor_future:",
      "  retained: true",
    ].join("\n"), "utf8");
    const envelope = importCardSource(yaml, { format: "yaml" });
    expect(envelope.card.data.name).toBe("YAML Import");
    expect(importedCardToCanonicalIr(envelope).passthrough).toMatchObject({
      source_envelope: { root: { vendor_future: { retained: true } } },
    });
    expect(() => importCardSource(Buffer.from("name: [unterminated", "utf8"), { format: "yaml" })).toThrow();
  });

  it("未知 root/data/book/entry 欄位與 extensions 無 unexpected loss", () => {
    const report = roundTripImportedCard(importCharacterCard(sourceCard()));
    expect(report.status).toBe("expected_loss");
    expect(report.differences.filter((item) => item.classification === "unexpected_loss")).toEqual([]);
  });

  it("匯入 legacy entry fallback 與完整 activation、placement extensions", () => {
    const source = sourceCard();
    source.data.description = "";
    source.data.first_mes = "";
    source.data.character_book.entries = [
      {
        id: "invalid id", keys: [], content: "disabled", extensions: { position: 0 },
        enabled: false, insertion_order: 1, use_regex: false,
      },
      {
        id: "constant", keys: [], content: "constant", extensions: { position: 2 },
        enabled: true, constant: true, insertion_order: 2, use_regex: false,
      },
      {
        id: "keyed-depth", keys: [], name: "Fallback Key", content: "keyed",
        extensions: {
          position: 4, depth: -1, role: 99, selectiveLogic: 99,
          triggers: ["normal", "invalid", 3], case_sensitive: true,
          match_whole_words: true, scan_depth: 3, group: "valid-group",
          delay_until_recursion: 1, exclude_recursion: true, prevent_recursion: true,
        },
        enabled: true, insertion_order: 3, use_regex: true,
      },
      {
        id: "outlet", keys: ["outlet"], content: "outlet", extensions: { position: 7, outlet_name: "memory" },
        enabled: true, insertion_order: 4, use_regex: false,
      },
      {
        id: "fallback", keys: ["fallback"], content: "fallback", extensions: { position: 7 },
        enabled: true, insertion_order: 5, use_regex: false, position: "before_char",
      },
    ];
    const ir = importedCardToCanonicalIr(importCharacterCard(source));
    expect(ir.characters[0]?.summary).toBe("Imported character");
    expect(ir.greetings[0]?.content).toBe("[空白開場白]");
    expect(ir.entries[0]).toMatchObject({ id: "import-entry-0001", activation: { type: "disabled" }, placement: { type: "before_character" } });
    expect(ir.entries[1]).toMatchObject({ activation: { type: "constant" }, placement: { type: "authors_note", side: "before" } });
    expect(ir.entries[2]).toMatchObject({
      activation: { type: "keyed", keys: ["Fallback Key"], secondary_logic: "any", triggers: ["normal"], scan_depth: 3, group: "valid-group" },
      placement: { type: "at_depth", depth: 4, role: "system" },
      recursion: { incoming: false, outgoing: false, delay_until_recursion: 1 },
    });
    expect(ir.entries[3]?.placement).toEqual({ type: "outlet", name: "memory" });
    expect(ir.entries[4]?.placement).toEqual({ type: "before_character" });
  });
});
