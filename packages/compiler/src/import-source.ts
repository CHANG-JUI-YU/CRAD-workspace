import { importCharacterCard } from "@card-workspace/adapters-ccv3";
import { pngSignature, readCardMetadataFromPng } from "@card-workspace/adapters-png";
import { parseStructuredSource } from "@card-workspace/ingestion";
import type { ImportedCardEnvelope } from "@card-workspace/schemas";

const maxJsonBytes = 32 * 1024 * 1024;

export interface ImportCardSourceOptions {
  format?: "json" | "yaml";
}

export function importCardSource(input: Uint8Array, options: ImportCardSourceOptions = {}): ImportedCardEnvelope {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    const metadata = readCardMetadataFromPng(buffer);
    return importCharacterCard(metadata.value, buffer);
  }
  if (buffer.length > maxJsonBytes) throw new RangeError(`JSON 角色卡超過 ${maxJsonBytes} bytes`);
  const value = parseStructuredSource(buffer, options.format ?? "json");
  return importCharacterCard(value, buffer);
}
