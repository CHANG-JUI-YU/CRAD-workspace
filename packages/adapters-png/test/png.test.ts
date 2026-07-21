import {
  characterCardV2Schema,
  characterCardV3Schema,
  type CharacterCardV2,
  type CharacterCardV3,
} from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  decodeTextChunk,
  encodePngChunk,
  encodeTextChunk,
  parsePngChunks,
  pngSignature,
  PngFormatError,
  readCardFromPng,
  writeCardToPng,
} from "../src/index.js";

function cardV3(name = "愛麗絲"): CharacterCardV3 {
  return characterCardV3Schema.parse({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name,
      description: "",
      personality: "",
      scenario: "",
      first_mes: "你好",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      group_only_greetings: [],
      tags: [],
      creator: "",
      character_version: "1",
      extensions: { vendor: { keep: true } },
    },
  });
}

function cardV2(): CharacterCardV2 {
  const v3 = cardV3();
  const data = { ...v3.data };
  delete data.group_only_greetings;
  return characterCardV2Schema.parse({ spec: "chara_card_v2", spec_version: "2.0", data });
}

function expectPngError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`預期 PNG 錯誤：${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(PngFormatError);
    if (!(error instanceof PngFormatError)) return;
    expect(error.code).toBe(code);
  }
}

function basePng(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    pngSignature,
    encodePngChunk("IHDR", ihdr),
    ...extra,
    encodePngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])),
    encodePngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function metadata(keyword: "ccv3" | "chara", card: CharacterCardV3 | CharacterCardV2): Buffer {
  const payload = Buffer.from(JSON.stringify(card), "utf8").toString("base64");
  return encodePngChunk("tEXt", encodeTextChunk(keyword, payload));
}

describe("PNG card adapter", () => {
  it("以 UTF-8 Base64 寫入 ccv3 並保留非角色 chunks", () => {
    const ancillary = encodePngChunk("ruSt", Buffer.from("preserve", "ascii"));
    const source = basePng([ancillary]);
    const output = writeCardToPng(source, cardV3());
    const read = readCardFromPng(output);

    expect(read.authority).toBe("ccv3");
    expect(read.card).toEqual(cardV3());
    expect(parsePngChunks(output).find((chunk) => chunk.type === "ruSt")?.raw).toEqual(ancillary);
    expect(parsePngChunks(output).at(-2)?.type).toBe("tEXt");
  });

  it("雙 metadata 時以 ccv3 為權威，並接受真正 V2 backfill", () => {
    const output = writeCardToPng(basePng(), cardV3("V3"), cardV2());
    const read = readCardFromPng(output);
    expect(read).toMatchObject({ authority: "ccv3", hasV2Backfill: true });
    expect(read.card.data.name).toBe("V3");
  });

  it("重寫時移除既有角色 metadata，但保留其他 tEXt", () => {
    const note = encodePngChunk("tEXt", encodeTextChunk("note", "keep"));
    const source = basePng([metadata("ccv3", cardV3("old")), metadata("chara", cardV2()), note]);
    const output = writeCardToPng(source, cardV3("new"));
    const texts = parsePngChunks(output)
      .filter((chunk) => chunk.type === "tEXt")
      .map((chunk) => decodeTextChunk(chunk.data).keyword);
    expect(texts).toEqual(["note", "ccv3"]);
    expect(readCardFromPng(output).card.data.name).toBe("new");
  });

  it("拒絕 CRC 損壞、重複 metadata 與非法結構", () => {
    const corrupt = Buffer.from(basePng());
    corrupt[corrupt.length - 1] ^= 0xff;
    expect(() => parsePngChunks(corrupt)).toThrowError(PngFormatError);

    const duplicate = basePng([metadata("ccv3", cardV3()), metadata("ccv3", cardV3())]);
    expectPngError(() => readCardFromPng(duplicate), "PNG_CARD_CHUNK_DUPLICATE");

    const noIhdr = Buffer.concat([pngSignature, encodePngChunk("IEND", Buffer.alloc(0))]);
    expectPngError(() => parsePngChunks(noIhdr), "PNG_IHDR_MISSING");
  });

  it("拒絕錯誤 Base64、非法 UTF-8 與非 ASCII tEXt", () => {
    const invalidBase64 = basePng([encodePngChunk("tEXt", encodeTextChunk("ccv3", "%%%"))]);
    expectPngError(() => readCardFromPng(invalidBase64), "PNG_CARD_BASE64_INVALID");

    const invalidUtf8 = Buffer.from([0xc3, 0x28]).toString("base64");
    const utf8Png = basePng([encodePngChunk("tEXt", encodeTextChunk("ccv3", invalidUtf8))]);
    expectPngError(() => readCardFromPng(utf8Png), "PNG_CARD_JSON_INVALID");

    expectPngError(
      () => decodeTextChunk(Buffer.from([0x63, 0x63, 0x76, 0x33, 0, 0xff])),
      "PNG_TEXT_NOT_ASCII",
    );
  });

  it.each([
    ["file size", () => parsePngChunks(basePng(), { maxFileBytes: 1 }), "PNG_TOO_LARGE"],
    ["signature", () => parsePngChunks(Buffer.alloc(8)), "PNG_SIGNATURE_INVALID"],
    ["header truncation", () => parsePngChunks(Buffer.concat([pngSignature, Buffer.from([0])])), "PNG_CHUNK_TRUNCATED"],
    ["chunk size", () => parsePngChunks(basePng(), { maxChunkBytes: 1 }), "PNG_CHUNK_TOO_LARGE"],
    ["data truncation", () => parsePngChunks(basePng().subarray(0, 24)), "PNG_CHUNK_TRUNCATED"],
    ["duplicate IHDR", () => parsePngChunks(basePng([encodePngChunk("IHDR", Buffer.alloc(13))])), "PNG_IHDR_DUPLICATE"],
    ["invalid IHDR", () => parsePngChunks(Buffer.concat([pngSignature, encodePngChunk("IHDR", Buffer.alloc(0))])), "PNG_IHDR_INVALID"],
    ["invalid IEND", () => parsePngChunks(basePng([encodePngChunk("IEND", Buffer.from([1]))])), "PNG_IEND_INVALID"],
    ["missing IEND", () => parsePngChunks(Buffer.concat([pngSignature, encodePngChunk("IHDR", Buffer.alloc(13))])), "PNG_IEND_MISSING"],
    ["trailing data", () => parsePngChunks(Buffer.concat([basePng(), Buffer.from([0])])), "PNG_TRAILING_DATA"],
    ["invalid encoded type", () => encodePngChunk("bad", Buffer.alloc(0)), "PNG_CHUNK_TYPE_INVALID"],
  ])("拒絕 %s", (_label, operation, code) => {
    expectPngError(operation, code);
  });

  it("拒絕非法 chunk type", () => {
    const png = Buffer.from(basePng());
    png.write("1HDR", 12, "ascii");
    expectPngError(() => parsePngChunks(png), "PNG_CHUNK_TYPE_INVALID");
  });

  it("拒絕非法 tEXt keyword、separator 與 payload", () => {
    expectPngError(() => encodeTextChunk("", "text"), "PNG_TEXT_KEYWORD_INVALID");
    expectPngError(() => encodeTextChunk("a".repeat(80), "text"), "PNG_TEXT_KEYWORD_INVALID");
    expectPngError(() => encodeTextChunk("key", "非 ASCII"), "PNG_TEXT_NOT_ASCII");
    expectPngError(() => decodeTextChunk(Buffer.from("missing-separator", "ascii")), "PNG_TEXT_INVALID");
    expectPngError(() => decodeTextChunk(Buffer.concat([Buffer.alloc(80, 0x61), Buffer.from([0])])), "PNG_TEXT_INVALID");
    expectPngError(() => decodeTextChunk(Buffer.from([0x1f, 0, 0x61])), "PNG_TEXT_KEYWORD_INVALID");
  });
});
