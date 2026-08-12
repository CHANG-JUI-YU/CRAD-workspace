import { mkdir, open, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { ArtifactKind, ArtifactRecord, ProjectState } from "../project-state.js";
import { canonicalJson, CoreError } from "../core-utilities.js";
import { parseArtifactValue } from "../project-projection.js";
import type { RepositoryFile, RepositoryWriteSet } from "./project-repository.js";

export interface PublishMaterializationPaths {
  readonly json?: string;
  readonly png?: string;
}

export interface IncrementalMaterializationOptions {
  readonly readBlob?: (hash: string) => Promise<Uint8Array | undefined>;
  readonly publish_paths?: {
    readonly previous?: PublishMaterializationPaths;
    readonly current?: PublishMaterializationPaths;
  };
}

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

function sameContent(left: string | Uint8Array, right: string | Uint8Array): boolean {
  const leftBuffer = typeof left === "string" ? Buffer.from(left, "utf8") : Buffer.from(left);
  const rightBuffer = typeof right === "string" ? Buffer.from(right, "utf8") : Buffer.from(right);
  return leftBuffer.equals(rightBuffer);
}

function controlMaterializedFiles(state: ProjectState): RepositoryFile[] {
  return [
    { path: "project.json", content: canonicalJson({ project_id: state.project_id, project_name: state.project_name, project_slug: state.project_slug, status: state.project_status, revision: state.revision, updated_at: latestStateTimestamp(state) }) + "\n" },
    { path: ".workspace/interview.json", content: canonicalJson(state.interview) + "\n" },
    { path: ".workspace/blueprint-prechecks.json", content: canonicalJson(state.blueprint_prechecks) + "\n" },
    { path: ".workspace/adaptation-decisions.json", content: canonicalJson(state.adaptation_decisions) + "\n" },
    { path: ".workspace/quality-profile.json", content: canonicalJson(state.quality_profile) + "\n" },
    { path: ".workspace/workflow.json", content: canonicalJson({
      project_id: state.project_id,
      project_name: state.project_name,
      status: state.project_status,
      revision: state.revision,
      operations: state.operations,
      audit: state.audit,
      builds: state.builds,
      publishes: state.publishes,
      imports: state.imports,
      blueprint_prechecks: state.blueprint_prechecks,
      adaptation_decisions: state.adaptation_decisions,
      fact_review_passes: state.fact_review_passes,
      fact_review_runs: state.fact_review_runs,
      fact_review_decisions: state.fact_review_decisions,
    }) + "\n" },
    { path: "sources/manifest.json", content: canonicalJson({ candidates: state.candidates, sources: state.sources }) + "\n" },
    { path: "knowledge/chunks.json", content: canonicalJson(state.knowledge_chunks) + "\n" },
    { path: "facts/register.json", content: canonicalJson({ facts: state.facts, issues: state.issues, review_passes: state.fact_review_passes, review_runs: state.fact_review_runs, review_decisions: state.fact_review_decisions }) + "\n" },
  ];
}

function artifactSignature(artifact: ArtifactRecord): string {
  return canonicalJson({ id: artifact.id, key: artifact.key, revision: artifact.revision, content_hash: artifact.content_hash, status: artifact.status, dependency_fingerprint: artifact.dependency_fingerprint });
}

function artifactCharacterIdForMaterialization(artifact: ArtifactRecord): string | undefined {
  const value = parseArtifactValue(artifact);
  const document = value.document as Record<string, unknown> | undefined;
  const characterId = typeof document?.id === "string" ? document.id : typeof value.character_id === "string" ? value.character_id : undefined;
  return characterId ?? (artifact.kind === "zhuji" || artifact.kind === "palette" || artifact.kind === "wardrobe" ? artifact.name.split("/")[0]?.trim() : undefined);
}

function artifactPathForState(root: string, state: ProjectState, artifact: ArtifactRecord): string {
  const folders = characterFolderById(state.artifacts);
  const worldCounts = new Map<string, number>();
  for (const candidate of state.artifacts) if (candidate.kind === "world_lore") worldCounts.set(candidate.name, (worldCounts.get(candidate.name) ?? 0) + 1);
  return normalizeRepositoryPath(path.relative(root, artifactFilePath(root, artifact, folders, worldCounts)));
}

function materializedArtifactPath(root: string, state: ProjectState, artifact: ArtifactRecord): string {
  if (artifact.kind === "wardrobe") {
    const latest = [...state.artifacts].reverse().find((candidate) => candidate.key === artifact.key);
    if (latest?.id !== artifact.id) {
      const value = parseArtifactValue(artifact);
      const characterId = nonEmptyString(value.character_id) ?? nonEmptyString(artifact.name.split("/")[0]) ?? "character";
      const folder = characterFolderById(state.artifacts).get(characterId) ?? characterFolderName(characterId);
      return normalizeRepositoryPath(path.relative(root, path.join(root, "characters", folder, "wardrobe", "revisions", `${safeSegment(artifact.revision)}.md`)));
    }
  }
  return artifactPathForState(root, state, artifact);
}

function affectedArtifactIds(previous: ProjectState, current: ProjectState): Set<string> {
  const ids = new Set<string>();
  const previousById = new Map(previous.artifacts.map((artifact) => [artifact.id, artifact]));
  const currentById = new Map(current.artifacts.map((artifact) => [artifact.id, artifact]));
  for (const [id, artifact] of currentById) {
    const previousArtifact = previousById.get(id);
    if (previousArtifact === undefined || artifactSignature(artifact) !== artifactSignature(previousArtifact)) ids.add(id);
  }
  for (const id of previousById.keys()) if (!currentById.has(id)) ids.add(id);

  const previousFolders = characterFolderById(previous.artifacts);
  const currentFolders = characterFolderById(current.artifacts);
  const affectedCharacters = new Set<string>();
  for (const id of new Set([...previousFolders.keys(), ...currentFolders.keys()])) if (previousFolders.get(id) !== currentFolders.get(id)) affectedCharacters.add(id);
  const previousWorldCounts = new Map<string, number>();
  const currentWorldCounts = new Map<string, number>();
  for (const artifact of previous.artifacts) if (artifact.kind === "world_lore") previousWorldCounts.set(artifact.name, (previousWorldCounts.get(artifact.name) ?? 0) + 1);
  for (const artifact of current.artifacts) if (artifact.kind === "world_lore") currentWorldCounts.set(artifact.name, (currentWorldCounts.get(artifact.name) ?? 0) + 1);
  const affectedWorldNames = new Set<string>();
  for (const name of new Set([...previousWorldCounts.keys(), ...currentWorldCounts.keys()])) if (previousWorldCounts.get(name) !== currentWorldCounts.get(name)) affectedWorldNames.add(name);
  for (const artifact of [...previous.artifacts, ...current.artifacts]) {
    const characterId = artifactCharacterIdForMaterialization(artifact);
    if (characterId !== undefined && affectedCharacters.has(characterId)) ids.add(artifact.id);
    if (artifact.kind === "world_lore" && affectedWorldNames.has(artifact.name)) ids.add(artifact.id);
  }
  return ids;
}

function changedControlFiles(previous: ProjectState, current: ProjectState): RepositoryFile[] {
  const previousFiles = new Map(controlMaterializedFiles(previous).map((file) => [file.path, file]));
  return controlMaterializedFiles(current).filter((file) => {
    const old = previousFiles.get(file.path);
    return old === undefined || !sameContent(old.content, file.content);
  });
}

async function publishMaterializedFiles(
  state: ProjectState,
  paths: PublishMaterializationPaths | undefined,
  readBlob: ((hash: string) => Promise<Uint8Array | undefined>) | undefined,
): Promise<RepositoryFile[]> {
  const latest = state.publishes.at(-1);
  if (latest === undefined || paths === undefined) return [];
  const files: RepositoryFile[] = [];
  if (latest.content !== undefined && paths.json !== undefined) {
    files.push({ path: paths.json, content: latest.content.endsWith("\n") ? latest.content : `${latest.content}\n` });
  } else if (latest.content_ref !== undefined && paths.json !== undefined && readBlob !== undefined) {
    const blob = await readBlob(latest.content_ref.hash);
    if (blob !== undefined) {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(blob);
      files.push({ path: paths.json, content: decoded.endsWith("\n") ? decoded : `${decoded}\n` });
    }
  }
  if (latest.png_base64 !== undefined && paths.png !== undefined) {
    files.push({ path: paths.png, content: Buffer.from(latest.png_base64, "base64") });
  } else if (latest.png_ref !== undefined && paths.png !== undefined && readBlob !== undefined) {
    const blob = await readBlob(latest.png_ref.hash);
    if (blob !== undefined) files.push({ path: paths.png, content: blob });
  }
  return files;
}

/** Produce only files affected by a mutation; reconcile/repair still use the full path. */
export async function incrementalMaterializationWriteSet(
  previous: ProjectState,
  current: ProjectState,
  root = ".",
  options: IncrementalMaterializationOptions = {},
): Promise<RepositoryWriteSet> {
  const files = changedControlFiles(previous, current);
  const remove = new Set<string>();
  const changed = affectedArtifactIds(previous, current);
  const previousById = new Map(previous.artifacts.map((artifact) => [artifact.id, artifact]));
  const currentById = new Map(current.artifacts.map((artifact) => [artifact.id, artifact]));
  const changedWardrobeKeys = new Set<string>();
  for (const id of changed) {
    const artifact = currentById.get(id) ?? previousById.get(id);
    if (artifact?.kind === "wardrobe") changedWardrobeKeys.add(artifact.key);
  }
  for (const artifact of [...previous.artifacts, ...current.artifacts]) {
    if (artifact.kind === "wardrobe" && changedWardrobeKeys.has(artifact.key)) changed.add(artifact.id);
  }
  const currentPaths = new Set<string>();
  for (const id of changed) {
    const oldArtifact = previousById.get(id);
    const newArtifact = currentById.get(id);
    if (oldArtifact !== undefined && isPublicArtifactKind(oldArtifact.kind)) remove.add(materializedArtifactPath(root, previous, oldArtifact));
    if (newArtifact !== undefined && isPublicArtifactKind(newArtifact.kind)) {
      const target = materializedArtifactPath(root, current, newArtifact);
      currentPaths.add(target);
      files.push({ path: target, content: newArtifact.content.endsWith("\n") ? newArtifact.content : `${newArtifact.content}\n` });
    }
  }
  const previousPublish = previous.publishes.at(-1);
  const currentPublish = current.publishes.at(-1);
  const previousPublishPaths = options.publish_paths?.previous;
  const currentPublishPaths = options.publish_paths?.current;
  if (canonicalJson(previousPublish ?? null) !== canonicalJson(currentPublish ?? null)
    || canonicalJson(previousPublishPaths ?? null) !== canonicalJson(currentPublishPaths ?? null)) {
    const publishFiles = await publishMaterializedFiles(current, currentPublishPaths, options.readBlob);
    for (const file of publishFiles) {
      const target = normalizeRepositoryPath(file.path);
      currentPaths.add(target);
      files.push({ ...file, path: target });
    }
    if (publishFiles.length > 0) {
      for (const oldPath of [previousPublishPaths?.json, previousPublishPaths?.png]) {
        if (oldPath !== undefined && !currentPaths.has(normalizeRepositoryPath(oldPath))) remove.add(normalizeRepositoryPath(oldPath));
      }
    }
  }
  for (const file of files) if (currentPaths.has(file.path)) remove.delete(file.path);
  return { files, remove: [...remove] };
}
