import { deflateSync, inflateSync } from "node:zlib";
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

function isLatin1KeywordByte(byte: number): boolean {
  return (byte >= 0x20 && byte <= 0x7e) || (byte >= 0xa1 && byte <= 0xff);
}

function validateTextKeyword(keyword: Uint8Array): void {
  if (keyword.length < 1 || keyword.length > 79 || !keyword.every(isLatin1KeywordByte)) {
    throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword is invalid");
  }
  if (keyword[0] === 0x20 || keyword[keyword.length - 1] === 0x20) {
    throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword cannot start or end with a space");
  }
  for (let index = 1; index < keyword.length; index += 1) {
    if (keyword[index] === 0x20 && keyword[index - 1] === 0x20) {
      throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword cannot contain consecutive spaces");
    }
  }
}

function encodeTextChunk(keyword: string, text: string): Buffer {
  if ([...keyword].some((character) => (character.codePointAt(0) ?? 0) > 0xff)) throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword is not Latin-1");
  const keywordBuffer = Buffer.from(keyword, "latin1");
  validateTextKeyword(keywordBuffer);
  /* c8 ignore next -- card metadata is base64, therefore always ASCII. */
  if ([...text].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) throw new PngFormatError("PNG_TEXT_NOT_ASCII", "PNG tEXt payload must be ASCII");
  return Buffer.concat([keywordBuffer, Buffer.from([0]), Buffer.from(text, "ascii")]);
}

function decodeTextChunk(data: Uint8Array): { keyword: string; text: string } {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const separator = buffer.indexOf(0);
  if (separator <= 0 || separator > 79) throw new PngFormatError("PNG_TEXT_INVALID", "PNG tEXt keyword separator is invalid");
  const keyword = buffer.subarray(0, separator);
  const text = buffer.subarray(separator + 1);
  validateTextKeyword(keyword);
  return { keyword: keyword.toString("latin1"), text: text.toString("latin1") };
}

function createBasePng(): Buffer {
  const width = 512;
  const height = 768;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.alloc(1 + width * 4);
  scanline[0] = 0;
  for (let offset = 1; offset < scanline.length; offset += 4) {
    scanline[offset] = 0xd8;
    scanline[offset + 1] = 0xd8;
    scanline[offset + 2] = 0xd8;
    scanline[offset + 3] = 0xff;
  }
  const imageData = Buffer.alloc(scanline.length * height);
  for (let row = 0; row < height; row += 1) scanline.copy(imageData, row * scanline.length);
  return Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(imageData)), encodePngChunk("IEND", Buffer.alloc(0))]);
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
  const decoded = Buffer.from(text, "base64");
  if (decoded.toString("base64") !== text) throw new PngFormatError("PNG_CARD_BASE64_INVALID", "Card metadata is not canonical Base64");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
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

export interface PngImageInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

export function readPngImageInfo(input: Uint8Array): PngImageInfo | undefined {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, 8).equals(pngSignature)) return undefined;
  const chunks = parsePngChunks(input);
  const ihdr = chunks[0];
  if (ihdr === undefined || ihdr.type !== "IHDR") return undefined;
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8] ?? 0;
  const colorType = ihdr.data[9] ?? 0;
  const interlace = ihdr.data[12] ?? 0;
  return { width, height, bitDepth, colorType, interlace };
}

export const CARD_IMAGE_MAX_DIMENSION = 2048;

const builtInPlaceholderBasePng = createBasePng();
const builtInPlaceholderIdat = Buffer.concat(
  parsePngChunks(builtInPlaceholderBasePng)
    .filter((chunk) => chunk.type === "IDAT")
    .map((chunk) => chunk.data)
);

export function isBuiltInPlaceholderImage(input: Uint8Array): boolean {
  try {
    const info = readPngImageInfo(input);
    if (info === undefined || info.width !== 512 || info.height !== 768) return false;
    const idat = Buffer.concat(
      parsePngChunks(input)
        .filter((chunk) => chunk.type === "IDAT")
        .map((chunk) => chunk.data)
    );
    return idat.equals(builtInPlaceholderIdat);
  } catch {
    return false;
  }
}

export function validatePngImage(input: Uint8Array, options: { maxDimension?: number } = {}): PngImageInfo {
  const maxDimension = options.maxDimension ?? CARD_IMAGE_MAX_DIMENSION;
  const info = readPngImageInfo(input);
  if (info === undefined) throw new PngFormatError("PNG_SIGNATURE_INVALID", "角色圖必須是 PNG 檔案");
  if (info.width > maxDimension || info.height > maxDimension) {
    throw new PngFormatError("CARD_IMAGE_TOO_LARGE", `角色圖尺寸 ${info.width}×${info.height} 超過上限 ${maxDimension}×${maxDimension}`);
  }
  return info;
}

/**
 * Cover-crop an 8-bit RGB/RGBA non-interlaced PNG to the requested aspect
 * ratio without scaling: the larger side is trimmed around the centre.
 */
export function cropPngCover(input: Uint8Array, aspectRatio: string): Buffer {
  const info = validatePngImage(input, { maxDimension: CARD_IMAGE_MAX_DIMENSION });
  const { width, height, bitDepth, colorType, interlace } = info;
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new PngFormatError("CARD_IMAGE_FORMAT_UNSUPPORTED", "角色圖只支援 8-bit RGB/RGBA 的非交錯 PNG");
  }
  const match = /^(\d+):(\d+)$/u.exec(aspectRatio);
  if (match === null) throw new PngFormatError("CARD_IMAGE_ASPECT_INVALID", `裁切比例 ${aspectRatio} 必須是 N:M 格式`);
  const targetWidth = Number(match[1]);
  const targetHeight = Number(match[2]);
  if (targetWidth <= 0 || targetHeight <= 0) throw new PngFormatError("CARD_IMAGE_ASPECT_INVALID", `裁切比例 ${aspectRatio} 必須是正整數`);
  const targetRatio = targetWidth / targetHeight;

  const channels = colorType === 6 ? 4 : 3;
  const scanlineBytes = 1 + width * channels;
  const idat = Buffer.concat(parsePngChunks(input).filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  let raw: Buffer;
  try {
    raw = inflateSync(idat, { maxOutputLength: scanlineBytes * height });
  } catch (error) {
    throw new PngFormatError("CARD_IMAGE_DECODE_FAILED", `角色圖解壓失敗：${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw.length !== scanlineBytes * height) throw new PngFormatError("CARD_IMAGE_DECODE_FAILED", "角色圖像素資料長度不符");

  const unfiltered = Buffer.alloc(width * channels * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * scanlineBytes;
    const filter = raw[offset] ?? 0;
    if (filter > 4) {
      throw new PngFormatError("CARD_IMAGE_FORMAT_UNSUPPORTED", `不支援的 PNG scanline filter: ${filter}`);
    }
    const start = offset + 1;
    for (let index = 0; index < width * channels; index += 1) {
      const byte = raw[start + index] ?? 0;
      const left = index >= channels ? (unfiltered[row * width * channels + index - channels] ?? 0) : 0;
      const above = row > 0 ? (unfiltered[(row - 1) * width * channels + index] ?? 0) : 0;
      const aboveLeft = row > 0 && index >= channels ? (unfiltered[(row - 1) * width * channels + index - channels] ?? 0) : 0;
      let value = byte;
      switch (filter) {
        case 0:
          value = byte;
          break;
        case 1:
          value = (byte + left) & 0xff;
          break;
        case 2:
          value = (byte + above) & 0xff;
          break;
        case 3:
          value = (byte + Math.floor((left + above) / 2)) & 0xff;
          break;
        case 4: {
          const estimate = left + above - aboveLeft;
          const pa = Math.abs(estimate - left);
          const pb = Math.abs(estimate - above);
          const pc = Math.abs(estimate - aboveLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : aboveLeft;
          value = (byte + predictor) & 0xff;
          break;
        }
        default:
          throw new PngFormatError("CARD_IMAGE_FORMAT_UNSUPPORTED", `不支援的 PNG scanline filter: ${filter}`);
      }
      unfiltered[row * width * channels + index] = value;
    }
  }

  let cropWidth = width;
  let cropHeight = height;
  let offsetX = 0;
  let offsetY = 0;
  if (width / height > targetRatio) {
    cropWidth = Math.max(1, Math.round(height * targetRatio));
    offsetX = Math.floor((width - cropWidth) / 2);
  } else if (width / height < targetRatio) {
    cropHeight = Math.max(1, Math.round(width / targetRatio));
    offsetY = Math.floor((height - cropHeight) / 2);
  }

  const cropped = Buffer.alloc(cropWidth * channels * cropHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceRow = (row + offsetY) * width * channels + offsetX * channels;
    unfiltered.copy(cropped, row * cropWidth * channels, sourceRow, sourceRow + cropWidth * channels);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cropWidth, 0);
  ihdr.writeUInt32BE(cropHeight, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const compressed = Buffer.alloc(cropped.length + cropHeight);
  let compressedOffset = 0;
  for (let row = 0; row < cropHeight; row += 1) {
    compressed[compressedOffset] = 0;
    compressedOffset += 1;
    cropped.copy(compressed, compressedOffset, row * cropWidth * channels, (row + 1) * cropWidth * channels);
    compressedOffset += cropWidth * channels;
  }
  return Buffer.concat([pngSignature, encodePngChunk("IHDR", ihdr), encodePngChunk("IDAT", deflateSync(compressed)), encodePngChunk("IEND", Buffer.alloc(0))]);
}
