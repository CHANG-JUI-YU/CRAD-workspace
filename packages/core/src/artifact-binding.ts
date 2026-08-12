import type { ArtifactRecord } from "./project-state.js";

export interface ArtifactBinding {
  characterIds: string[];
  global: boolean;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseStructuredContent(artifact: ArtifactRecord): JsonRecord | undefined {
  try {
    return record(JSON.parse(artifact.content));
  } catch {
    return undefined;
  }
}

function unique(ids: readonly (string | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined))];
}

/** Decode the legacy authoring key format (`_HHHH`) without losing underscores. */
export function decodeLegacyArtifactSegment(value: string): string {
  return value.replace(/_([0-9a-f]{4})/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function legacySegment(artifact: ArtifactRecord): string | undefined {
  const keySeparator = artifact.key.indexOf(":");
  const keyValue = keySeparator < 0 ? undefined : artifact.key.slice(keySeparator + 1).split("/")[0];
  const candidate = keyValue ?? artifact.name.split("/")[0];
  if (candidate === undefined || candidate.trim().length === 0 || candidate === "default") return undefined;
  const decoded = decodeLegacyArtifactSegment(candidate.trim());
  if (artifact.kind === "zhuji" || artifact.kind === "palette") {
    const moduleSuffixes = [
      "appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction",
      "basic_information", "personality_palette", "tri_faceted", "secondary_interpretation",
    ];
    const suffix = moduleSuffixes.find((module) => decoded.endsWith(`-${module}`));
    if (suffix !== undefined) return decoded.slice(0, -(suffix.length + 1));
  }
  return decoded;
}

/**
 * Return the stable character binding for an artifact.
 *
 * Structured proposal content is authoritative. Legacy name/key parsing is
 * only used when the artifact does not contain a JSON object with routing
 * metadata, so a renamed artifact cannot silently change its owner.
 */
export function artifactBinding(artifact: ArtifactRecord): ArtifactBinding {
  const structured = parseStructuredContent(artifact);
  if (structured !== undefined) {
    if (artifact.kind === "character") {
      const document = record(structured.document);
      return { characterIds: unique([text(document?.id)]), global: false };
    }
    if (artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
      return { characterIds: unique([text(structured.character_id)]), global: false };
    }
    if (artifact.kind === "greeting") {
      const document = record(structured.document);
      const greetings = Array.isArray(document?.greetings) ? document.greetings : [];
      const characterIds = greetings.flatMap((entry) => {
        const item = record(entry);
        return Array.isArray(item?.character_ids) ? item.character_ids.map(text) : [];
      });
      return { characterIds: unique(characterIds), global: true };
    }
    return { characterIds: [], global: true };
  }

  if (artifact.kind === "character" || artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
    return { characterIds: unique([legacySegment(artifact)]), global: false };
  }
  return { characterIds: unique([legacySegment(artifact)]), global: true };
}
