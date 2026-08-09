import { deflateSync } from "node:zlib";
import { characterCardV3Schema, type CharacterCardV3 } from "@st-workspace/adapters-ccv3";

export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class PngFormatError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PngFormatError";
  }
}

export interface PngChunk {
  type: string;
  data: Buffer;
  raw: Buffer;
}

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    let value = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    crc = (crc >>> 8) ^ value;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePngChunk(type: string, data: Uint8Array): Buffer {
  if (!/^[A-Za-z]{4}$/u.test(type)) throw new PngFormatError("PNG_CHUNK_TYPE_INVALID", `Invalid PNG chunk type: ${type}`);
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const output = Buffer.alloc(payload.length + 12);
  output.writeUInt32BE(payload.length, 0);
  typeBuffer.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), payload.length + 8);
  return output;
}

export function parsePngChunks(input: Uint8Array, options: { maxFileBytes?: number; maxChunkBytes?: number } = {}): PngChunk[] {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const maxFile = options.maxFileBytes ?? 64 * 1024 * 1024;
  const maxChunk = options.maxChunkBytes ?? 32 * 1024 * 1024;
  if (buffer.length > maxFile) throw new PngFormatError("PNG_TOO_LARGE", `PNG exceeds ${maxFile} bytes`);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, 8).equals(pngSignature)) throw new PngFormatError("PNG_SIGNATURE_INVALID", "Invalid PNG signature");
  const chunks: PngChunk[] = [];
  let offset = 8;
  let index = 0;
  let sawIend = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new PngFormatError("PNG_CHUNK_TRUNCATED", "PNG chunk header is truncated");
    const length = buffer.readUInt32BE(offset);
    if (length > maxChunk) throw new PngFormatError("PNG_CHUNK_TOO_LARGE", `PNG chunk exceeds ${maxChunk} bytes`);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new PngFormatError("PNG_CHUNK_TRUNCATED", "PNG chunk data is truncated");
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new PngFormatError("PNG_CHUNK_TYPE_INVALID", `Invalid PNG chunk type: ${type}`);
    if (index === 0 && type !== "IHDR") throw new PngFormatError("PNG_IHDR_MISSING", "PNG must start with IHDR");
    if (index > 0 && type === "IHDR") throw new PngFormatError("PNG_IHDR_DUPLICATE", "PNG may contain only one IHDR");
    if (type === "IHDR" && length !== 13) throw new PngFormatError("PNG_IHDR_INVALID", "PNG IHDR must be 13 bytes");
    if (type === "IEND" && length !== 0) throw new PngFormatError("PNG_IEND_INVALID", "PNG IEND must be empty");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expected = buffer.readUInt32BE(offset + 8 + length);
    const actual = crc32(Buffer.concat([typeBuffer, data]));
    if (expected !== actual) throw new PngFormatError("PNG_CRC_INVALID", `PNG ${type} CRC mismatch`);
    chunks.push({ type, data: Buffer.from(data), raw: Buffer.from(buffer.subarray(offset, end)) });
    offset = end;
    index += 1;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) throw new PngFormatError("PNG_IEND_MISSING", "PNG is missing IEND");
  if (offset !== buffer.length) throw new PngFormatError("PNG_TRAILING_DATA", "Data exists after PNG IEND");
  return chunks;
}

function encodeTextChunk(keyword: string, text: string): Buffer {
  /* c8 ignore next -- callers provide fixed ASCII metadata keywords. */
  if (!/^[\x20-\x7e]{1,79}$/u.test(keyword)) throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword is invalid");
  /* c8 ignore next -- card metadata is base64, therefore always ASCII. */
  if ([...text].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) throw new PngFormatError("PNG_TEXT_NOT_ASCII", "PNG tEXt payload must be ASCII");
  return Buffer.concat([Buffer.from(keyword, "ascii"), Buffer.from([0]), Buffer.from(text, "ascii")]);
}

function decodeTextChunk(data: Uint8Array): { keyword: string; text: string } {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const separator = buffer.indexOf(0);
  if (separator <= 0 || separator > 79) throw new PngFormatError("PNG_TEXT_INVALID", "PNG tEXt keyword separator is invalid");
  const keyword = buffer.subarray(0, separator);
  const text = buffer.subarray(separator + 1);
  if (keyword.some((byte) => byte < 0x20 || byte > 0x7e) || text.some((byte) => byte > 0x7f)) throw new PngFormatError("PNG_TEXT_NOT_ASCII", "PNG tEXt is not ASCII");
  return { keyword: keyword.toString("ascii"), text: text.toString("ascii") };
}

function createBasePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.from([0, 0, 0, 0, 0]);
  return Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(scanline)), encodePngChunk("IEND", Buffer.alloc(0))]);
}

function base64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function v2Backfill(card: CharacterCardV3): Record<string, unknown> {
  return { spec: "chara_card_v2", spec_version: "2.0", data: card.data };
}

export interface ReadPngMetadataResult {
  authority: "ccv3" | "chara";
  value: unknown;
  hasV2Backfill: boolean;
}

function decodeBase64Json(text: string): unknown {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) throw new PngFormatError("PNG_CARD_BASE64_INVALID", "Card metadata is not valid Base64");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text, "base64"))) as unknown;
  } catch {
    throw new PngFormatError("PNG_CARD_JSON_INVALID", "Card metadata is not valid UTF-8 JSON");
  }
}

export function readCardMetadataFromPng(input: Uint8Array): ReadPngMetadataResult {
  const chunks = parsePngChunks(input)
    .filter((chunk) => chunk.type === "tEXt")
    .map((chunk) => decodeTextChunk(chunk.data))
    .filter((chunk) => ["ccv3", "chara"].includes(chunk.keyword.toLowerCase()));
  const ccv3 = chunks.filter((chunk) => chunk.keyword.toLowerCase() === "ccv3");
  const chara = chunks.filter((chunk) => chunk.keyword.toLowerCase() === "chara");
  if (ccv3.length > 1 || chara.length > 1) throw new PngFormatError("PNG_CARD_CHUNK_DUPLICATE", "PNG has duplicate card metadata");
  if (ccv3[0] !== undefined) return { authority: "ccv3", value: decodeBase64Json(ccv3[0].text), hasV2Backfill: chara.length === 1 };
  if (chara[0] !== undefined) return { authority: "chara", value: decodeBase64Json(chara[0].text), hasV2Backfill: true };
  throw new PngFormatError("PNG_CARD_CHUNK_MISSING", "PNG has no ccv3 or chara metadata");
}

export function readCardFromPng(input: Uint8Array): { authority: "ccv3" | "chara"; card: CharacterCardV3; hasV2Backfill: boolean } {
  const metadata = readCardMetadataFromPng(input);
  const card = metadata.authority === "ccv3"
    ? characterCardV3Schema.parse(metadata.value)
    : characterCardV3Schema.parse({ spec: "chara_card_v3", spec_version: "3.0", data: (metadata.value as { data?: unknown }).data });
  return { authority: metadata.authority, card, hasV2Backfill: metadata.hasV2Backfill };
}

export function writeCardToPng(input: Uint8Array | undefined, card: CharacterCardV3, options: { includeV2Backfill?: boolean } = {}): Buffer {
  const parsed = characterCardV3Schema.parse(card);
  const source = input === undefined ? createBasePng() : Buffer.from(input);
  const chunks = parsePngChunks(source);
  const includeV2 = options.includeV2Backfill ?? true;
  const output: Buffer[] = [pngSignature];
  for (const chunk of chunks) {
    if (chunk.type === "IEND") {
      output.push(encodePngChunk("tEXt", encodeTextChunk("ccv3", base64Json(parsed))));
      if (includeV2) output.push(encodePngChunk("tEXt", encodeTextChunk("chara", base64Json(v2Backfill(parsed)))));
      output.push(chunk.raw);
      continue;
    }
    if (chunk.type === "tEXt") {
      const text = decodeTextChunk(chunk.data);
      if (["ccv3", "chara"].includes(text.keyword.toLowerCase())) continue;
    }
    output.push(chunk.raw);
  }
  return Buffer.concat(output);
}
