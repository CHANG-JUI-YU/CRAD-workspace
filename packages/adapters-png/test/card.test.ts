import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emitCharacterCardV3, type Ccv3Project } from "@st-workspace/adapters-ccv3";
import { encodePngChunk, parsePngChunks, pngSignature, readCardFromPng, readCardMetadataFromPng, writeCardToPng } from "../src/index.js";

const project: Ccv3Project = {
  project_id: "demo",
  title: "Demo",
  name: "Demo",
  description: "A complete character.",
  personality: "Calm.",
  scenario: "A room.",
  first_mes: "Hello.",
  alternate_greetings: [],
  group_only_greetings: [],
  lore_entries: [],
};

describe("PNG card adapter", () => {
  it("writes valid ccv3 and chara metadata and reads it back", () => {
    const card = emitCharacterCardV3(project);
    const png = writeCardToPng(undefined, card);
    expect(writeCardToPng(undefined, card)).toEqual(png);
    const chunks = parsePngChunks(png);
    expect(chunks[0]?.type).toBe("IHDR");
    expect(chunks[0]?.data.readUInt32BE(0)).toBe(512);
    expect(chunks[0]?.data.readUInt32BE(4)).toBe(768);
    const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
    const imageData = inflateSync(idat);
    const rowBytes = 1 + 512 * 4;
    expect(imageData.length).toBe(rowBytes * 768);
    expect([...Array(768)].every((_, row) => {
      const rowStart = row * rowBytes;
      return imageData[rowStart] === 0
        && [...Array(512)].every((__, column) => imageData[rowStart + 1 + column * 4 + 3] === 0xff);
    })).toBe(true);
    expect(chunks.some((chunk) => chunk.type === "tEXt")).toBe(true);
    expect(readCardFromPng(png)).toMatchObject({ authority: "ccv3", card, hasV2Backfill: true });
  });

  it("rejects a corrupted PNG chunk", () => {
    const card = emitCharacterCardV3(project);
    const png = writeCardToPng(undefined, card);
    const corrupted = Buffer.from(png);
    corrupted[corrupted.length - 5] = (corrupted[corrupted.length - 5] ?? 0) ^ 0xff;
    expect(() => parsePngChunks(corrupted)).toThrow(/CRC|PNG/u);
  });

  it("rejects malformed PNG envelopes and supports chara-only metadata", () => {
    expect(() => encodePngChunk("bad", Buffer.alloc(0))).toThrow(/chunk type/u);
    const png = writeCardToPng(undefined, emitCharacterCardV3(project));
    expect(() => parsePngChunks(Buffer.from([1, 2, 3]))).toThrow(/signature/u);
    expect(() => parsePngChunks(png, { maxFileBytes: 1 })).toThrow(/exceeds/u);
    expect(() => parsePngChunks(png.subarray(0, png.length - 1))).toThrow(/truncated|missing IEND/u);
    expect(() => parsePngChunks(Buffer.concat([png, Buffer.from([0])]))).toThrow(/trailing|Data exists after PNG IEND/u);
    const chunks = parsePngChunks(png);
    const withoutCcv3 = Buffer.concat([pngSignature, ...chunks.filter((chunk) => chunk.type !== "tEXt" || !chunk.data.toString("ascii").startsWith("ccv3\u0000")).map((chunk) => chunk.raw)]);
    expect(readCardMetadataFromPng(withoutCcv3).authority).toBe("chara");
    const duplicated = Buffer.concat([pngSignature, ...chunks.flatMap((chunk) => chunk.type === "IEND" ? [chunks.find((candidate) => candidate.type === "tEXt")!.raw, chunk.raw] : [chunk.raw])]);
    expect(() => readCardMetadataFromPng(duplicated)).toThrow(/duplicate/u);
  });

  it("covers chunk, metadata, and rewrite edge cases", () => {
    const ihdr = encodePngChunk("IHDR", Buffer.alloc(13));
    const iend = encodePngChunk("IEND", Buffer.alloc(0));
    const idat = encodePngChunk("IDAT", Buffer.alloc(0));
    const envelope = (...chunks: Buffer[]) => Buffer.concat([pngSignature, ...chunks]);

    expect(() => parsePngChunks(envelope(idat, iend))).toThrow(/IHDR/u);
    expect(() => parsePngChunks(envelope(ihdr, ihdr, iend))).toThrow(/IHDR/u);
    expect(() => parsePngChunks(envelope(encodePngChunk("IHDR", Buffer.alloc(0)), iend))).toThrow(/IHDR/u);
    expect(() => parsePngChunks(envelope(ihdr, encodePngChunk("IEND", Buffer.from([1]))))).toThrow(/IEND/u);
    expect(() => parsePngChunks(envelope(ihdr), { maxChunkBytes: 1 })).toThrow(/chunk exceeds/u);
    const truncated = Buffer.concat([pngSignature, Buffer.from([0, 0, 0, 14]), Buffer.from("IHDR", "ascii"), Buffer.alloc(13)]);
    expect(() => parsePngChunks(truncated)).toThrow(/chunk data is truncated/u);
    const badCrc = Buffer.from(envelope(ihdr, iend));
    badCrc[badCrc.length - 1] = (badCrc[badCrc.length - 1] ?? 0) ^ 0xff;
    expect(() => parsePngChunks(badCrc)).toThrow(/CRC/u);
    expect(() => parsePngChunks(envelope(ihdr, idat))).toThrow(/missing IEND/u);

    const metadataPng = (data: Buffer) => envelope(ihdr, encodePngChunk("tEXt", data), iend);
    expect(() => readCardMetadataFromPng(metadataPng(Buffer.from([0, 1, 2])))).toThrow(/keyword separator/u);
    expect(() => readCardMetadataFromPng(metadataPng(Buffer.from([99, 99, 118, 51, 0, 0x80])))).toThrow(/ASCII|Base64/u);
    expect(() => readCardMetadataFromPng(metadataPng(Buffer.from("ccv3\u0000%%%%", "ascii")))).toThrow(/Base64/u);
    expect(() => readCardMetadataFromPng(metadataPng(Buffer.from(`ccv3\u0000${Buffer.from([0xc3, 0x28]).toString("base64")}`, "ascii")))).toThrow(/UTF-8 JSON/u);
    expect(() => readCardMetadataFromPng(envelope(ihdr, iend))).toThrow(/no ccv3 or chara/u);

    const card = emitCharacterCardV3(project);
    const ccv3Only = writeCardToPng(undefined, card, { includeV2Backfill: false });
    expect(readCardMetadataFromPng(ccv3Only)).toMatchObject({ authority: "ccv3", hasV2Backfill: false });
    const sourceChunks = parsePngChunks(writeCardToPng(undefined, card));
    const charaOnly = Buffer.concat([
      pngSignature,
      ...sourceChunks.filter((chunk) => chunk.type !== "tEXt" || !chunk.data.toString("ascii").startsWith("ccv3\u0000")).map((chunk) => chunk.raw),
    ]);
    expect(readCardFromPng(charaOnly).authority).toBe("chara");
    expect(readCardMetadataFromPng(writeCardToPng(ccv3Only, card)).authority).toBe("ccv3");
  });

  it("accepts and preserves legal Latin-1 unrelated tEXt while rewriting card metadata", () => {
    const card = emitCharacterCardV3(project);
    const original = writeCardToPng(undefined, card);
    const originalChunks = parsePngChunks(original);
    const unrelated = encodePngChunk("tEXt", Buffer.concat([
      Buffer.from("Comment", "latin1"),
      Buffer.from([0]),
      Buffer.from([0xe9, 0x00, 0xff]),
    ]));
    const input = Buffer.concat([
      pngSignature,
      ...originalChunks.flatMap((chunk) => chunk.type === "IEND" ? [unrelated, chunk.raw] : [chunk.raw]),
    ]);
    expect(readCardFromPng(input).card).toEqual(card);

    const rewritten = writeCardToPng(input, card);
    const rewrittenChunks = parsePngChunks(rewritten);
    expect(rewrittenChunks.find((chunk) => chunk.type === "tEXt" && chunk.data.subarray(0, 8).equals(Buffer.from("Comment\u0000", "latin1")))?.raw).toEqual(unrelated);
    expect(rewrittenChunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.raw)).toEqual(originalChunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.raw));
    expect(readCardFromPng(rewritten)).toMatchObject({ authority: "ccv3", card, hasV2Backfill: true });
  });

  it("keeps card payload validation strict even when unrelated Latin-1 metadata is valid", () => {
    const ihdr = encodePngChunk("IHDR", Buffer.alloc(13));
    const iend = encodePngChunk("IEND", Buffer.alloc(0));
    const latin1 = encodePngChunk("tEXt", Buffer.concat([Buffer.from("Comment", "latin1"), Buffer.from([0, 0xe9])]));
    const malformedBase64 = encodePngChunk("tEXt", Buffer.from("ccv3\u0000%%%%", "ascii"));
    const malformedJson = encodePngChunk("tEXt", Buffer.from(`chara\u0000${Buffer.from("{}", "utf8").toString("base64")}`, "ascii"));
    expect(() => readCardMetadataFromPng(Buffer.concat([pngSignature, ihdr, latin1, malformedBase64, iend]))).toThrow(/Base64/u);
    expect(() => readCardFromPng(Buffer.concat([pngSignature, ihdr, latin1, malformedJson, iend]))).toThrow(/required|invalid|card/u);
  });
});
