import { crc32 } from "./crc32.js";

export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngChunk {
  type: string;
  data: Buffer;
  raw: Buffer;
}

export class PngFormatError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PngFormatError";
  }
}

export interface ParsePngOptions {
  maxFileBytes?: number;
  maxChunkBytes?: number;
}

export function parsePngChunks(input: Uint8Array, options: ParsePngOptions = {}): PngChunk[] {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const maxFile = options.maxFileBytes ?? 64 * 1024 * 1024;
  const maxChunk = options.maxChunkBytes ?? 32 * 1024 * 1024;
  if (buffer.length > maxFile) throw new PngFormatError("PNG_TOO_LARGE", `PNG 超過 ${maxFile} bytes`);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, 8).equals(pngSignature)) {
    throw new PngFormatError("PNG_SIGNATURE_INVALID", "不是有效 PNG signature");
  }
  const chunks: PngChunk[] = [];
  let offset = 8;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new PngFormatError("PNG_CHUNK_TRUNCATED", "PNG chunk header 不完整");
    const length = buffer.readUInt32BE(offset);
    if (length > maxChunk) throw new PngFormatError("PNG_CHUNK_TOO_LARGE", `PNG chunk 超過 ${maxChunk} bytes`);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new PngFormatError("PNG_CHUNK_TRUNCATED", "PNG chunk data 不完整");
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new PngFormatError("PNG_CHUNK_TYPE_INVALID", `無效 chunk type：${type}`);
    if (chunkIndex === 0 && type !== "IHDR") throw new PngFormatError("PNG_IHDR_MISSING", "PNG 第一個 chunk 必須是 IHDR");
    if (chunkIndex > 0 && type === "IHDR") throw new PngFormatError("PNG_IHDR_DUPLICATE", "PNG 只能包含一個 IHDR chunk");
    if (type === "IHDR" && length !== 13) throw new PngFormatError("PNG_IHDR_INVALID", "PNG IHDR 長度必須是 13 bytes");
    if (type === "IEND" && length !== 0) throw new PngFormatError("PNG_IEND_INVALID", "PNG IEND 必須是空 chunk");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(Buffer.concat([typeBuffer, data]));
    if (expectedCrc !== actualCrc) throw new PngFormatError("PNG_CRC_INVALID", `${type} chunk CRC 錯誤`);
    chunks.push({ type, data: Buffer.from(data), raw: Buffer.from(buffer.subarray(offset, end)) });
    chunkIndex += 1;
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend) throw new PngFormatError("PNG_IEND_MISSING", "PNG 缺少 IEND chunk");
  if (offset !== buffer.length) throw new PngFormatError("PNG_TRAILING_DATA", "IEND 後存在未識別資料");
  return chunks;
}

export function encodePngChunk(type: string, data: Uint8Array): Buffer {
  if (!/^[A-Za-z]{4}$/u.test(type)) throw new PngFormatError("PNG_CHUNK_TYPE_INVALID", `無效 chunk type：${type}`);
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const output = Buffer.allocUnsafe(payload.length + 12);
  output.writeUInt32BE(payload.length, 0);
  typeBuffer.copy(output, 4);
  payload.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), payload.length + 8);
  return output;
}
