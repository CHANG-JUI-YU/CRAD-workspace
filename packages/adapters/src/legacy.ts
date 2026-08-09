import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { contentHash, type ArtifactKind } from "@st-workspace/core";

export interface LegacyFileReport {
  relative_path: string;
  size: number;
  original_hash: string;
  media_type: string;
}

export interface LegacyCandidate {
  relative_path: string;
  kind: "artifact" | "source" | "unknown";
  name: string;
  original_hash: string;
  notes: string[];
}

export interface LegacyInspection {
  root: string;
  files: LegacyFileReport[];
  candidates: LegacyCandidate[];
  unsupported: string[];
  warnings: string[];
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(root, absolute));
    else paths.push(path.relative(root, absolute));
  }
  return paths;
}

function mediaType(file: string): string {
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".md")) return "text/markdown";
  if (file.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function artifactKind(value: unknown): ArtifactKind {
  if (value === null || typeof value !== "object") return "unknown";
  const record = value as Record<string, unknown>;
  const text = `${record.kind ?? ""} ${record.type ?? ""} ${record.category ?? ""}`.toLocaleLowerCase();
  if (text.includes("character") || text.includes("角色") || "name" in record && "description" in record) return "character";
  if (text.includes("relationship") || text.includes("關係")) return "relationship";
  if (text.includes("world") || text.includes("lore") || text.includes("世界")) return "world_lore";
  if (text.includes("greeting") || text.includes("開場")) return "greeting";
  return "unknown";
}

export async function inspectLegacyProject(root: string): Promise<LegacyInspection> {
  const relativePaths = await walk(root);
  const files: LegacyFileReport[] = [];
  const candidates: LegacyCandidate[] = [];
  const unsupported: string[] = [];
  const warnings: string[] = [];
  for (const relativePath of relativePaths) {
    const absolute = path.join(root, relativePath);
    const content = await readFile(absolute);
    const hash = contentHash(content);
    const type = mediaType(relativePath.toLocaleLowerCase());
    files.push({ relative_path: relativePath, size: content.byteLength, original_hash: hash, media_type: type });
    if (type === "application/octet-stream") {
      unsupported.push(relativePath);
      continue;
    }
    if (type === "application/json") {
      try {
        const parsed: unknown = JSON.parse(content.toString("utf8"));
        const kind = artifactKind(parsed);
        if (kind !== "unknown") {
          const record = parsed as Record<string, unknown>;
          candidates.push({ relative_path: relativePath, kind: "artifact", name: typeof record.name === "string" ? record.name : path.basename(relativePath, ".json"), original_hash: hash, notes: ["JSON artifact requires explicit conversion before import."] });
        } else {
          candidates.push({ relative_path: relativePath, kind: "source", name: path.basename(relativePath), original_hash: hash, notes: ["JSON shape is unknown; preserve and review before conversion."] });
        }
      } catch {
        warnings.push(`${relativePath}: JSON parse failed; preserved as unsupported source.`);
        candidates.push({ relative_path: relativePath, kind: "unknown", name: path.basename(relativePath), original_hash: hash, notes: ["Invalid JSON; no automatic conversion."] });
      }
    } else {
      candidates.push({ relative_path: relativePath, kind: "source", name: path.basename(relativePath), original_hash: hash, notes: ["Text source can be imported through the controlled source path."] });
    }
  }
  return { root, files, candidates, unsupported, warnings };
}
