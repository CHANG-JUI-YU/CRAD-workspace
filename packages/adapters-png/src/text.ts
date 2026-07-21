import { PngFormatError } from "./chunks.js";

export interface TextChunk {
  keyword: string;
  text: string;
}

export function encodeTextChunk(keyword: string, text: string): Buffer {
  if (!/^[\x20-\x7e]{1,79}$/u.test(keyword) || keyword.includes("\0")) {
    throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword 必須是 1 至 79 個可列印 ASCII 字元");
  }
  if ([...text].some((character) => character.codePointAt(0)! > 0x7f)) {
    throw new PngFormatError("PNG_TEXT_NOT_ASCII", "PNG tEXt payload 必須是 ASCII");
  }
  return Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "ascii")]);
}

export function decodeTextChunk(data: Uint8Array): TextChunk {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const separator = buffer.indexOf(0);
  if (separator <= 0 || separator > 79) throw new PngFormatError("PNG_TEXT_INVALID", "PNG tEXt 缺少合法 keyword separator");
  const keywordBytes = buffer.subarray(0, separator);
  const textBytes = buffer.subarray(separator + 1);
  if (keywordBytes.some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw new PngFormatError("PNG_TEXT_KEYWORD_INVALID", "PNG tEXt keyword 必須是可列印 ASCII");
  }
  if (textBytes.some((byte) => byte > 0x7f)) {
    throw new PngFormatError("PNG_TEXT_NOT_ASCII", "PNG tEXt payload 必須是 ASCII");
  }
  return {
    keyword: keywordBytes.toString("ascii"),
    text: textBytes.toString("ascii"),
  };
}
