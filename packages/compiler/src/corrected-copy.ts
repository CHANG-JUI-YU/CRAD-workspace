import { deepMergeJson } from "@card-workspace/adapters-ccv3";
import { writeCardToPng } from "@card-workspace/adapters-png";
import { canonicalJson, canonicalYaml } from "@card-workspace/project";
import { characterCardV3Schema, type ImportedCardEnvelope, type JsonObject } from "@card-workspace/schemas";

export type CorrectedCardFormat = "png" | "json" | "yaml";

export function correctedCardV3(envelope: ImportedCardEnvelope) {
  const sourceRoot = envelope.source_format === "v1" && envelope.passthrough.root
    ? envelope.passthrough.root as JsonObject
    : {};
  return characterCardV3Schema.parse(deepMergeJson(sourceRoot, envelope.card as JsonObject));
}

export function writeCorrectedCard(
  source: Uint8Array,
  envelope: ImportedCardEnvelope,
  format: CorrectedCardFormat,
): Buffer {
  const card = correctedCardV3(envelope);
  if (format === "png") return writeCardToPng(source, card);
  const text = format === "json" ? canonicalJson(card) : canonicalYaml(card);
  return Buffer.from(text, "utf8");
}
