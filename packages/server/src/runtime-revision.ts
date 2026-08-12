import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_SERVICE = "st-workspace-v3";

interface RuntimeFile {
  relativePath: string;
  absolutePath: string;
}

async function collectJavaScriptFiles(directory: string, relativeDirectory: string): Promise<RuntimeFile[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: RuntimeFile[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(absolutePath, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push({ absolutePath, relativePath });
    }
  }
  return files;
}

/**
 * Hash the exact JavaScript that a built workspace can load. Paths are part of
 * the input so a rename cannot collide with an unchanged file set. Sorting and
 * explicit separators make the result independent of filesystem enumeration.
 */
export async function computeRuntimeRevision(workspaceRoot: string): Promise<string> {
  const packagesRoot = path.join(workspaceRoot, "packages");
  let packageEntries;
  try {
    packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return `sha256:${createHash("sha256").digest("hex")}`;
    throw error;
  }

  const files: RuntimeFile[] = [];
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    const packageDist = path.join(packagesRoot, entry.name, "dist");
    files.push(...await collectJavaScriptFiles(packageDist, path.posix.join("packages", entry.name, "dist")));
  }
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}
