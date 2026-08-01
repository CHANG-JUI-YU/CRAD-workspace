import { describe, expect, it } from "vitest";

import { downgradeCharacterCardV3ToV2, importCharacterCard } from "../src/index.js";

function v3(version = "3.0") {
  return {
    future_root: { keep: true },
    spec: "chara_card_v3",
    spec_version: version,
    data: {
      name: "Alice",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "雿末",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: ["蝢斤?"],
      tags: [],
      creator: "",
      character_version: "1",
      extensions: { vendor: { nested: [1, 2] } },
      future_data: "keep",
      character_book: {
        extensions: { book_vendor: true },
        future_book: "keep",
        entries: [{
          id: "entry",
          keys: ["Alice"],
          content: "Lore",
          extensions: { entry_vendor: true },
          enabled: true,
          insertion_order: 1,
          use_regex: false,
          future_entry: "keep",
        }],
      },
    },
  };
}

describe("card import", () => {
  it("V1 ?剜?鋆?摰 V3 銝虫????root", () => {
    const result = importCharacterCard({
      name: "Legacy",
      description: "D",
      personality: "P",
      scenario: "S",
      first_mes: "F",
      mes_example: "M",
      vendor: true,
    });
    expect(result).toMatchObject({ source_format: "v1", card: { spec: "chara_card_v3" } });
    expect(result.card.data.group_only_greetings).toEqual([]);
    expect(result.passthrough).toEqual({ root: { vendor: true } });
  });

  it("V2 ??鋆?required fields 銝衣宏?斗撌亙??霅血?", () => {
    const source = downgradeCharacterCardV3ToV2(importCharacterCard(v3()).card).card;
    const result = importCharacterCard(source);
    expect(result.source_format).toBe("v2");
    expect(result.card.data.group_only_greetings).toEqual([]);
    expect(result.card.data.creator_notes).not.toContain("??CCv3 ??");
    expect(result.card.data.character_book?.entries[0]?.use_regex).toBe(false);
  });

  it("future 3.x 霅血?雿??港?摮?亙楷?甈?", () => {
    const result = importCharacterCard(v3("3.7"));
    expect(result.source_version).toBe("3.7");
    expect(result.diagnostics.map((item) => item.code)).toContain("IMPORT_FUTURE_V3");
    expect(result.card).toMatchObject({
      future_root: { keep: true },
      data: {
        future_data: "keep",
        character_book: {
          future_book: "keep",
          entries: [{ future_entry: "keep" }],
        },
      },
    });
  });

  it("?詨? raw snapshot ?Ｙ??詨? import revision", () => {
    const raw = JSON.stringify(v3());
    expect(importCharacterCard(JSON.parse(raw), raw).raw_revision).toBe(
      importCharacterCard(JSON.parse(raw), raw).raw_revision,
    );
  });

  it("?臬?瘝? worldbook ??V3-only 甈???撠??", () => {
    const result = downgradeCharacterCardV3ToV2(importCharacterCard({ name: "Minimal" }).card);
    expect(result.card.data.character_book).toBeUndefined();
    expect(result.losses).toEqual([]);
  });

  it("covers card import format guards and raw byte revisions", () => {
    expect(() => importCharacterCard({ spec: "chara_card_v3", spec_version: "2.0", data: {} })).toThrow();
    const legacy = structuredClone(v3()) as Record<string, unknown>;
    legacy.spec = "chara_card_v2";
    legacy.spec_version = "2.0";
    (legacy.data as Record<string, unknown>).creator_notes = "[CCv3 撠嚗3 甈?]\nNotes";
    const v2 = importCharacterCard(legacy);
    expect(v2.source_format).toBe("v2");
    expect(v2.card.data.creator_notes).toContain("Notes");
    const raw = Buffer.from("{}");
    expect(importCharacterCard({ name: "bytes" }, raw).raw_revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
