import { describe, expect, it } from "vitest";

import { downgradeCharacterCardV3ToV2, importCharacterCard } from "../src/index.js";

function v3(version = "3.0") {
  return {
    future_root: { keep: true },
    spec: "chara_card_v3",
    spec_version: version,
    data: {
      name: "愛麗絲",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "你好",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: ["群組"],
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
  it("V1 六欄補成完整 V3 並保留未知 root", () => {
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

  it("V2 升級補 required fields 並移除本工具降級警告", () => {
    const source = downgradeCharacterCardV3ToV2(importCharacterCard(v3()).card).card;
    const result = importCharacterCard(source);
    expect(result.source_format).toBe("v2");
    expect(result.card.data.group_only_greetings).toEqual([]);
    expect(result.card.data.creator_notes).not.toContain("由 CCv3 降級");
    expect(result.card.data.character_book?.entries[0]?.use_regex).toBe(false);
  });

  it("future 3.x 警告但完整保存未知巢狀欄位", () => {
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

  it("相同 raw snapshot 產生相同 import revision", () => {
    const raw = JSON.stringify(v3());
    expect(importCharacterCard(JSON.parse(raw), raw).raw_revision).toBe(
      importCharacterCard(JSON.parse(raw), raw).raw_revision,
    );
  });

  it("可將沒有 worldbook 與 V3-only 欄位的最小卡降級", () => {
    const result = downgradeCharacterCardV3ToV2(importCharacterCard({ name: "Minimal" }).card);
    expect(result.card.data.character_book).toBeUndefined();
    expect(result.losses).toEqual([]);
  });
});
