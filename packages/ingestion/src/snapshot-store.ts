import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Revision } from "@card-workspace/schemas";
import { assertIngestionProjectPath, assertSafeSegment, resolveExistingWithin } from "@card-workspace/project";

import { IngestionError } from "./types.js";

const snapshotExtensions = new Set(["chat", "json", "md", "png", "txt", "yaml", "yml"]);

export function revisionDigest(revision: Revision): string {
  return revision.slice("sha256:".length);
}

export function sourceRevision(bytes: Buffer): Revision {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function controlledSnapshotExtension(extension: string | undefined, format: string): string {
  const candidate = extension?.replace(/^\./u, "").toLowerCase();
  if (candidate && snapshotExtensions.has(candidate)) return candidate;
  const fallback: Record<string, string> = {
    "character-card": "json",
    chat: "chat",
    json: "json",
    markdown: "md",
    text: "txt",
    yaml: "yaml",
  };
  return fallback[format] ?? "txt";
}

export function snapshotPath(sourceId: string, revision: Revision, extension: string): string {
  const safeSourceId = assertSafeSegment(sourceId);
  if (!snapshotExtensions.has(extension)) {
    throw new IngestionError("SOURCE_EXTENSION_INVALID", `不允許的 snapshot 副檔名：${extension}`);
  }
  const relativePath = `sources/snapshots/${safeSourceId}/${revisionDigest(revision)}.${extension}`;
  return assertIngestionProjectPath(relativePath).relativePath;
}

export async function verifySnapshot(
  projectRoot: string,
  relativePath: string,
  expectedRevision: Revision,
): Promise<Buffer> {
  const classified = assertIngestionProjectPath(relativePath);
  if (classified.kind !== "snapshot") {
    throw new IngestionError("SNAPSHOT_PATH_INVALID", `不是受控 snapshot 路徑：${relativePath}`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(await resolveExistingWithin(projectRoot, relativePath));
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("SNAPSHOT_MISSING", `無法讀取 snapshot：${relativePath}`, error);
  }
  const actual = sourceRevision(bytes);
  if (actual !== expectedRevision) {
    throw new IngestionError(
      "SNAPSHOT_HASH_MISMATCH",
      `snapshot hash 不符：預期 ${expectedRevision}，實際 ${actual}`,
    );
  }
  return bytes;
}

export async function verifyExistingImmutable(
  projectRoot: string,
  relativePath: string,
  expected: Buffer,
): Promise<void> {
  try {
    const actual = await readFile(await resolveExistingWithin(projectRoot, relativePath));
    if (!actual.equals(expected)) {
      throw new IngestionError("IMMUTABLE_ARTIFACT_MISMATCH", `既有 immutable artifact 內容不符：${relativePath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("IMMUTABLE_ARTIFACT_INVALID", `無法驗證 immutable artifact：${relativePath}`, error);
  }
}
