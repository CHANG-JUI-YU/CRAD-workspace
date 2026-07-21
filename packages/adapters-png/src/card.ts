import {
  characterCardV2Schema,
  characterCardV3Schema,
  type CharacterCardV2,
  type CharacterCardV3,
} from "@card-workspace/schemas";

import { encodePngChunk, parsePngChunks, pngSignature, PngFormatError } from "./chunks.js";
import { decodeTextChunk, encodeTextChunk } from "./text.js";

export interface ReadPngCardResult {
  authority: "ccv3" | "chara";
  card: CharacterCardV3 | CharacterCardV2;
  hasV2Backfill: boolean;
}

export interface ReadPngMetadataResult {
  authority: "ccv3" | "chara";
  value: unknown;
  hasV2Backfill: boolean;
}

function decodeBase64Json(text: string): unknown {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) {
    throw new PngFormatError("PNG_CARD_BASE64_INVALID", "角色卡 metadata 不是有效 Base64");
  }
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text, "base64"));
    return JSON.parse(json) as unknown;
  } catch {
    throw new PngFormatError("PNG_CARD_JSON_INVALID", "角色卡 metadata 不是有效 UTF-8 JSON");
  }
}

export function readCardMetadataFromPng(input: Uint8Array): ReadPngMetadataResult {
  const cardChunks = parsePngChunks(input)
    .filter((chunk) => chunk.type === "tEXt")
    .map((chunk) => decodeTextChunk(chunk.data))
    .filter((chunk) => chunk.keyword.toLowerCase() === "ccv3" || chunk.keyword.toLowerCase() === "chara");
  const ccv3 = cardChunks.filter((chunk) => chunk.keyword.toLowerCase() === "ccv3");
  const chara = cardChunks.filter((chunk) => chunk.keyword.toLowerCase() === "chara");
  if (ccv3.length > 1 || chara.length > 1) throw new PngFormatError("PNG_CARD_CHUNK_DUPLICATE", "PNG 含重複角色卡 metadata chunk");
  if (ccv3[0]) {
    return {
      authority: "ccv3",
      value: decodeBase64Json(ccv3[0].text),
      hasV2Backfill: chara.length === 1,
    };
  }
  if (chara[0]) {
    return {
      authority: "chara",
      value: decodeBase64Json(chara[0].text),
      hasV2Backfill: true,
    };
  }
  throw new PngFormatError("PNG_CARD_CHUNK_MISSING", "PNG 不含 ccv3 或 chara metadata");
}

export function readCardFromPng(input: Uint8Array): ReadPngCardResult {
  const metadata = readCardMetadataFromPng(input);
  return {
    authority: metadata.authority,
    card: metadata.authority === "ccv3"
      ? characterCardV3Schema.parse(metadata.value)
      : characterCardV2Schema.parse(metadata.value),
    hasV2Backfill: metadata.hasV2Backfill,
  };
}

function cardText(card: CharacterCardV3 | CharacterCardV2): string {
  return Buffer.from(JSON.stringify(card), "utf8").toString("base64");
}

export function writeCardToPng(
  input: Uint8Array,
  card: CharacterCardV3,
  v2Backfill?: CharacterCardV2,
): Buffer {
  const v3 = characterCardV3Schema.parse(card);
  const v2 = v2Backfill ? characterCardV2Schema.parse(v2Backfill) : undefined;
  const chunks = parsePngChunks(input);
  const output: Buffer[] = [pngSignature];
  for (const chunk of chunks) {
    if (chunk.type === "IEND") {
      output.push(encodePngChunk("tEXt", encodeTextChunk("ccv3", cardText(v3))));
      if (v2) output.push(encodePngChunk("tEXt", encodeTextChunk("chara", cardText(v2))));
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
