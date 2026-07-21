import { importCharacterCard } from "@card-workspace/adapters-ccv3";
import { encodePngChunk, encodeTextChunk, pngSignature, writeCardToPng } from "@card-workspace/adapters-png";
import { describe, expect, it } from "vitest";

import {
  characterCardSourceAdapter,
  extractSource,
  MAX_PROJECTION_BYTES,
  MAX_SOURCE_BYTES,
  selectSourceAdapter,
  SourceAdapterError,
  structuredSourceAdapter,
  textSourceAdapter,
} from "../src/index.js";

function v1() {
  return {
    name: "Legacy",
    description: "Description",
    personality: "Personality",
    scenario: "Scenario",
    first_mes: "Hello",
    mes_example: "Example",
  };
}

function v3() {
  return importCharacterCard({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "愛麗絲",
      description: "描述",
      personality: "性格",
      scenario: "場景",
      first_mes: "你好",
      mes_example: "示例",
      creator_notes: "註記",
      system_prompt: "系統",
      post_history_instructions: "歷史後",
      alternate_greetings: ["替代"],
      group_only_greetings: ["群組"],
      tags: [],
      creator: "",
      character_version: "1",
      extensions: {},
      character_book: {
        extensions: {},
        entries: [{
          id: "lore-1",
          keys: ["Alice"],
          content: "世界設定",
          extensions: {},
          enabled: true,
          insertion_order: 1,
          use_regex: false,
        }],
      },
    },
  }).card;
}

function v2() {
  const card = structuredClone(v3());
  const data: Record<string, unknown> = { ...card.data };
  delete data.group_only_greetings;
  return { ...card, spec: "chara_card_v2", spec_version: "2.0", data };
}

function basePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    pngSignature,
    encodePngChunk("IHDR", ihdr),
    encodePngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    encodePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function charaOnlyPng(): Buffer {
  const payload = Buffer.from(JSON.stringify(v2()), "utf8").toString("base64");
  const chunks = [
    encodePngChunk("tEXt", encodeTextChunk("chara", payload)),
  ];
  const png = basePng();
  const iend = encodePngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([png.subarray(0, png.length - iend.length), ...chunks, iend]);
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`預期錯誤 ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SourceAdapterError);
    if (error instanceof SourceAdapterError) expect(error.code).toBe(code);
  }
}

describe("source adapter selection", () => {
  it("先依 bytes 內容選擇，metadata 只協助判斷", () => {
    expect(selectSourceAdapter(Buffer.from(JSON.stringify(v1())), { fileName: "wrong.txt" })).toBe(characterCardSourceAdapter);
    expect(selectSourceAdapter(Buffer.from('{"z":1}'), { fileName: "wrong.md" })).toBe(structuredSourceAdapter);
    expect(selectSourceAdapter(Buffer.from("plain"), { fileName: "source.md" })).toBe(textSourceAdapter);
    expect(selectSourceAdapter(writeCardToPng(basePng(), v3()), { fileName: "wrong.json" })).toBe(characterCardSourceAdapter);
  });

  it("拒絕未知 binary、無效 UTF-8 及錯誤 JSON/YAML", () => {
    expectCode(() => extractSource(Buffer.from([0, 1, 2]), { fileName: "data.bin" }), "SOURCE_FORMAT_UNSUPPORTED");
    expectCode(() => extractSource(Buffer.from([0xff]), { fileName: "bad.txt" }), "SOURCE_UTF8_INVALID");
    expectCode(() => extractSource(Buffer.from("{bad"), { fileName: "bad.json" }), "SOURCE_JSON_INVALID");
    expectCode(() => extractSource(Buffer.from("key: ["), { fileName: "bad.yaml" }), "SOURCE_YAML_INVALID");
  });
});

describe("text and structured adapters", () => {
  it("fatal 解碼但保留 BOM、換行與 Unicode 原文", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("甲\r\n乙\r丙\n")]);
    const result = extractSource(bytes, { format: "chat" });
    expect(result).toMatchObject({ format: "chat", evidence: "raw", hasByteOrderMark: true });
    expect(result.text).toBe("\uFEFF甲\r\n乙\r丙\n");
  });

  it("JSON 與 YAML 依 canonical key order 產生穩定 projection/path mapping", () => {
    const json = extractSource(Buffer.from('{"z":"末","a":{"b":"首"}}'), {});
    const yaml = extractSource(Buffer.from("z: 末\na:\n  b: 首\n"), { mediaType: "application/yaml" });
    expect(json.text).toBe("首\n\n末");
    expect(yaml.text).toBe(json.text);
    expect(json.fieldMappings).toEqual([
      { start: 0, end: 1, fieldPath: "/a/b" },
      { start: 3, end: 4, fieldPath: "/z" },
    ]);
    expect(extractSource(Buffer.from('{"z":"末","a":{"b":"首"}}'), {})).toEqual(json);
  });

  it("公開並執行來源及 projection 大小限制", () => {
    expect(MAX_SOURCE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_PROJECTION_BYTES).toBe(16 * 1024 * 1024);
    expectCode(
      () => textSourceAdapter.extract(Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61), { format: "text" }),
      "SOURCE_TOO_LARGE",
    );
    expectCode(
      () => textSourceAdapter.extract(Buffer.alloc(MAX_PROJECTION_BYTES + 1, 0x61), { format: "text" }),
      "PROJECTION_TOO_LARGE",
    );
  });
});

describe("character card adapter", () => {
  it.each([
    ["v1", v1()],
    ["v2", v2()],
    ["v3", v3()],
  ])("投影 %s JSON", (_name, card) => {
    const result = extractSource(Buffer.from(JSON.stringify(card)), { fileName: "card.data" });
    expect(result.format).toBe("character-card");
    expect(result.extensions).toMatchObject({ sourceFormat: _name });
    expect(result.fieldMappings.map((mapping) => mapping.fieldPath)).toContain("/data/name");
  });

  it("支援 ccv3 與 chara-only PNG", () => {
    const ccv3 = extractSource(writeCardToPng(basePng(), v3()), {});
    const chara = extractSource(charaOnlyPng(), {});
    expect(ccv3.extensions).toMatchObject({ authority: "ccv3", sourceFormat: "v3" });
    expect(chara.extensions).toMatchObject({ authority: "chara", sourceFormat: "v2" });
  });

  it("按 canonical order 投影並讓 greetings/lore 回到欄位與 entry ID，不猜模式", () => {
    const result = characterCardSourceAdapter.extract(Buffer.from(JSON.stringify(v3())), {});
    expect(result.sections.map((section) => section.fieldPath)).toEqual([
      "/data/name",
      "/data/description",
      "/data/personality",
      "/data/scenario",
      "/data/first_mes",
      "/data/mes_example",
      "/data/creator_notes",
      "/data/system_prompt",
      "/data/post_history_instructions",
      "/data/alternate_greetings/0",
      "/data/group_only_greetings/0",
      "/data/character_book/entries/0/content",
    ]);
    expect(result.sections.at(-1)).toMatchObject({ kind: "lore-entry", entryId: "lore-1" });
    expect(JSON.stringify(result)).not.toMatch(/zhuji|palette|珠璣|調色盤/iu);
    expect(characterCardSourceAdapter.extract(Buffer.from(JSON.stringify(v3())), {})).toEqual(result);
  });
});
