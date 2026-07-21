import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { stableIdSchema } from "@card-workspace/schemas";

import { ProjectError } from "./errors.js";

function isOutside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function nearestExistingPath(target: string): Promise<string> {
  let current = target;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

export async function resolveWithin(base: string, candidate: string): Promise<string> {
  if (
    !candidate ||
    candidate.includes("\0") ||
    path.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    /^[a-zA-Z]:/u.test(candidate) ||
    candidate.includes(":")
  ) {
    throw new ProjectError("PATH_INVALID", `不允許的相對路徑：${candidate}`);
  }

  const absoluteBase = path.resolve(base);
  const resolved = path.resolve(absoluteBase, candidate);
  if (isOutside(absoluteBase, resolved)) {
    throw new ProjectError("PATH_OUTSIDE_ROOT", `路徑超出允許範圍：${candidate}`);
  }

  const existingBase = await nearestExistingPath(absoluteBase);
  const realBase = await realpath(existingBase);
  const existingTarget = await nearestExistingPath(resolved);
  const realTarget = await realpath(existingTarget);

  if (isOutside(realBase, realTarget)) {
    throw new ProjectError("PATH_SYMLINK_ESCAPE", `路徑經連結後超出允許範圍：${candidate}`);
  }

  return resolved;
}

export function assertSafeSegment(value: string): string {
  const parsed = stableIdSchema.safeParse(value);
  if (!parsed.success || value === "." || value === "..") {
    throw new ProjectError("PATH_SEGMENT_INVALID", `無效的安全路徑片段：${value}`);
  }
  return parsed.data;
}

export async function resolveExistingWithin(base: string, candidate: string): Promise<string> {
  const resolved = await resolveWithin(base, candidate);
  await lstat(resolved);
  return resolved;
}

export async function resolveCreatableWithin(
  base: string,
  candidate: string,
  allowedExtensions: readonly string[],
): Promise<string> {
  const extension = path.extname(candidate).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new ProjectError("PATH_EXTENSION_DENIED", `不允許建立 ${extension || "無副檔名"} 檔案`);
  }
  return resolveWithin(base, candidate);
}

export async function resolveProjectDirectory(
  projectsRoot: string,
  projectId: string,
): Promise<string> {
  const parsed = stableIdSchema.safeParse(projectId);
  if (!parsed.success) {
    throw new ProjectError("PROJECT_ID_INVALID", `無效的專案 ID：${projectId}`);
  }
  return resolveWithin(projectsRoot, parsed.data);
}
