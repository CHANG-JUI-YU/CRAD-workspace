import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { emitCharacterCardV3, type Ccv3Project } from "@st-workspace/adapters-ccv3";
import { cropPngCover, encodePngChunk, parsePngChunks, pngSignature, readCardFromPng, readCardMetadataFromPng, readPngImageInfo, validatePngImage, writeCardToPng } from "../src/index.js";

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

  it("reads PNG image dimensions and rejects non-PNG input", () => {
    const png = makePng(8, 4);
    expect(readPngImageInfo(png)).toEqual({ width: 8, height: 4, bitDepth: 8, colorType: 6, interlace: 0 });
    expect(readPngImageInfo(Buffer.from("not a png"))).toBeUndefined();
  });

  it("cover-crops the wider side to the requested aspect ratio", () => {
    const cropped = cropPngCover(makePng(8, 4), "1:1");
    expect(readPngImageInfo(cropped)).toEqual({ width: 4, height: 4, bitDepth: 8, colorType: 6, interlace: 0 });
    const pixels = inflateSync(Buffer.concat(parsePngChunks(cropped).filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
    expect(pixels[1]).toBe(255);
    expect(pixels[2 * 4 + 1]).toBe(0);
  });

  it("cover-crops the taller side and keeps identical ratios unchanged", () => {
    expect(readPngImageInfo(cropPngCover(makePng(4, 8), "1:1"))?.width).toBe(4);
    const unchanged = cropPngCover(makePng(4, 4), "1:1");
    expect(readPngImageInfo(unchanged)?.width).toBe(4);
    expect(readPngImageInfo(unchanged)?.height).toBe(4);
  });

  it("decodes Sub-filtered rows correctly before cropping", () => {
    const cropped = cropPngCover(makePng(8, 4, 4, 1), "1:1");
    const pixels = inflateSync(Buffer.concat(parsePngChunks(cropped).filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
    expect(pixels[1]).toBe(255);
    expect(pixels[2 * 4 + 1]).toBe(0);
  });

  it("rejects unsupported formats and invalid aspect ratios", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 3;
    const indexed = Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(Buffer.alloc(1 + 4 * 4))), encodePngChunk("IEND", Buffer.alloc(0))]);
    let formatError: unknown;
    try {
      cropPngCover(indexed, "1:1");
    } catch (error) {
      formatError = error;
    }
    expect(formatError).toMatchObject({ code: "CARD_IMAGE_FORMAT_UNSUPPORTED" });
    let aspectError: unknown;
    try {
      cropPngCover(makePng(4, 4), "wide");
    } catch (error) {
      aspectError = error;
    }
    expect(aspectError).toMatchObject({ code: "CARD_IMAGE_ASPECT_INVALID" });
  });

  it("rejects invalid scanline filter 5 (BUG2-18)", () => {
    const invalidFilterPng = makePng(4, 4, 4, 5);
    expect(() => cropPngCover(invalidFilterPng, "1:1")).toThrow(/filter: 5/u);
  });

  it("rejects zero-sized IHDR dimensions before image processing", () => {
    for (const png of [makePng(0, 4), makePng(4, 0)]) {
      let validationError: unknown;
      try {
        validatePngImage(png);
      } catch (error) {
        validationError = error;
      }
      expect(validationError).toMatchObject({ name: "PngFormatError", code: "PNG_IHDR_DIMENSIONS_INVALID" });

      let cropError: unknown;
      try {
        cropPngCover(png, "1:1");
      } catch (error) {
        cropError = error;
      }
      expect(cropError).toMatchObject({ name: "PngFormatError", code: "PNG_IHDR_DIMENSIONS_INVALID" });
    }
  });

  it("enforces max dimension limits in validatePngImage and cropPngCover (BUG2-18)", () => {
    const oversizedPng = makePng(2049, 100);
    expect(() => validatePngImage(oversizedPng)).toThrow(/2049×100/u);
    expect(() => cropPngCover(oversizedPng, "1:1")).toThrow(/2049×100/u);

    const boundaryPng = makePng(2048, 2048);
    expect(validatePngImage(boundaryPng)).toMatchObject({ width: 2048, height: 2048 });
  });

  it("rejects truncated or malformed IDAT decompressed output (BUG2-18)", () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0);
    ihdr.writeUInt32BE(4, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    // Inflated bytes too short (only 1 byte instead of (1 + 4*4)*4)
    const malformedIdat = Buffer.concat([
      pngSignature,
      encodePngChunk("IHDR", ihdr),
      encodePngChunk("IDAT", deflateSync(Buffer.alloc(1))),
      encodePngChunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => cropPngCover(malformedIdat, "1:1")).toThrow(/長度不符|解壓失敗/u);
  });
});

function makePng(width: number, height: number, channels = 4, filter = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const rowBytes = 1 + width * channels;
  const raw = Buffer.alloc(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowBytes;
    raw[offset] = filter;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * channels;
      raw[pixel] = column < width / 2 ? 255 : 0;
      raw[pixel + 1] = 0;
      raw[pixel + 2] = 0;
      raw[pixel + 3] = 255;
    }
  }
  if (filter === 1) {
    for (let row = 0; row < height; row += 1) {
      const offset = row * rowBytes + 1;
      for (let column = width - 1; column >= 1; column -= 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          raw[offset + column * channels + channel] = (raw[offset + column * channels + channel] - raw[offset + (column - 1) * channels + channel] + 256) & 0xff;
        }
      }
    }
  }
  return Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(raw)), encodePngChunk("IEND", Buffer.alloc(0))]);
}