import { mkdir, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { ArtifactKind, ArtifactRecord, ProjectState } from "../project-state.js";
import { CoreError } from "../core-utilities.js";
import { parseArtifactValue } from "../project-projection.js";

export function latestStateTimestamp(state: ProjectState): string {
  const timestamps = [
    ...state.artifacts.map((item) => item.updated_at),
    ...state.operations.map((item) => item.updated_at),
    ...state.audit.map((item) => item.occurred_at),
    ...state.builds.map((item) => item.created_at),
    ...state.publishes.map((item) => item.created_at),
    ...state.imports.map((item) => item.created_at),
  ].filter((value) => value.length > 0).sort();
  return timestamps.at(-1) ?? "1970-01-01T00:00:00.000Z";
}

export function safeSegment(value: string): string {
  const safe = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/gu, "-").replace(/\s+/gu, "-").replace(/^\.+|\.+$/gu, "");
  return safe.length === 0 ? "item" : safe.slice(0, 100);
}

export async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!( ["EISDIR", "EINVAL", "ENOTSUP", "EPERM", "EBUSY"] as string[]).includes(code ?? "")) throw error;
  }
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function characterFolderName(characterId: string, displayName?: string): string {
  const safeId = safeSegment(characterId);
  return displayName === undefined ? safeId : `${safeId}-${safeSegment(displayName)}`;
}

export function characterFolderById(artifacts: readonly ArtifactRecord[]): Map<string, string> {
  const displayNames = new Map<string, string | undefined>();
  for (const artifact of artifacts) {
    if (artifact.kind !== "character") continue;
    const value = parseArtifactValue(artifact);
    const characterId = nonEmptyString(value.document?.id);
    if (characterId === undefined) continue;
    displayNames.set(characterId, nonEmptyString(value.document?.display_name));
  }

  const folders = new Map<string, string>();
  for (const artifact of artifacts) {
    const value = parseArtifactValue(artifact);
    if (artifact.kind === "character") {
      const characterId = nonEmptyString(value.document?.id);
      if (characterId !== undefined) folders.set(characterId, characterFolderName(characterId, displayNames.get(characterId)));
      continue;
    }
    if (artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe") {
      const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
      folders.set(characterId, characterFolderName(characterId, displayNames.get(characterId)));
    }
  }
  return folders;
}

export function normalizeRepositoryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (path.isAbsolute(value) || normalized.length === 0 || normalized.includes(":") || normalized.split("/").some((segment) => segment === ".." || segment === "." || segment.length === 0)) {
    throw new CoreError("REPOSITORY_PATH_INVALID", `Repository path must stay inside the project: ${value}`, true);
  }
  return normalized;
}

export function assertTransactionTargetPath(relativePath: string): void {
  if (relativePath === ".workspace"
    || relativePath === ".workspace/recovery-ledger.jsonl"
    || relativePath.startsWith(".workspace/recovery-ledger.jsonl/")
    || relativePath === ".workspace/transactions"
    || relativePath.startsWith(".workspace/transactions/")
    || relativePath.startsWith(".workspace/.staging-")) {
    throw new CoreError("REPOSITORY_PATH_INVALID", `Repository path is reserved for transaction recovery: ${relativePath}`, true);
  }
}

export async function writeStagedFile(filePath: string, content: Uint8Array | string): Promise<void> {
  const handle = await open(filePath, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function moveToBackup(targetPath: string, backupPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await mkdir(path.dirname(backupPath), { recursive: true });
  await renameWithRetry(targetPath, backupPath);
  await syncDirectory(path.dirname(targetPath));
  await syncDirectory(path.dirname(backupPath));
  return true;
}

export async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!( ["EPERM", "EACCES", "EBUSY"] as string[]).includes(code ?? "") || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

export function artifactFilePath(root: string, artifact: ArtifactRecord, characterFolders: ReadonlyMap<string, string> = new Map(), worldArtifactCounts: ReadonlyMap<string, number> = new Map()): string {
  const value = parseArtifactValue(artifact);
  const extension = artifact.media_type === "application/json" ? "json" : "md";
  if (artifact.kind === "zhuji" || artifact.kind === "palette") {
    const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
    const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
    const mode = artifact.kind;
    return path.join(root, "characters", characterFolder, mode, `${safeSegment(String(value.module?.module ?? artifact.name))}.json`);
  }
  if (artifact.kind === "wardrobe") {
    const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
    const characterFolder = characterFolders.get(characterId) ?? characterFolderName(characterId);
    return path.join(root, "characters", characterFolder, "wardrobe", "wardrobe.md");
  }
  if (artifact.kind === "character") {
    const characterId = nonEmptyString(value.document?.id);
    const characterFolder = characterId === undefined ? safeSegment(artifact.name) : characterFolders.get(characterId) ?? characterFolderName(characterId, nonEmptyString(value.document?.display_name));
    return path.join(root, "characters", characterFolder, `character.${extension}`);
  }
  if (artifact.kind === "blueprint") return path.join(root, "blueprint", "blueprint.json");
  if (artifact.kind === "relationship") return path.join(root, "relationships", "relationships.json");
  if (artifact.kind === "world_lore") {
    const base = safeSegment(artifact.name);
    const fileName = (worldArtifactCounts.get(artifact.name) ?? 0) > 1 ? `${base}-${safeSegment(artifact.id)}` : base;
    return path.join(root, "world", `${fileName}.json`);
  }
  if (artifact.kind === "greeting") return path.join(root, "greetings", "greetings.json");
  if (artifact.kind === "plugin") return path.join(root, "plugins", `${safeSegment(String(value.plugin_id ?? artifact.name))}.${extension}`);
  return path.join(root, ".workspace", "artifacts", safeSegment(artifact.kind), `${safeSegment(artifact.name)}.${extension}`);
}

export function isPublicArtifactKind(kind: ArtifactKind): boolean {
  return kind === "character"
    || kind === "relationship"
    || kind === "world_lore"
    || kind === "greeting"
    || kind === "blueprint"
    || kind === "zhuji"
    || kind === "palette"
    || kind === "wardrobe"
    || kind === "plugin"
    || kind === "unknown";
}
