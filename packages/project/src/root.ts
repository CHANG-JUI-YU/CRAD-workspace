import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { ProjectError } from "./errors.js";

async function isWorkspaceRoot(candidate: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")) as {
      name?: string;
    };
    return manifest.name === "card-workspace";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function findWorkspaceRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (await isWorkspaceRoot(current)) return realpath(current);
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ProjectError("WORKSPACE_ROOT_NOT_FOUND", `找不到 card-workspace 根目錄：${start}`);
    }
    current = parent;
  }
}

export async function resolveWorkspaceRoot(options: {
  explicit?: string;
  environment?: NodeJS.ProcessEnv;
  start?: string;
} = {}): Promise<string> {
  const environment = options.environment ?? process.env;
  const configured = options.explicit ?? environment.CARD_WORKSPACE_ROOT;
  if (configured) {
    const root = path.resolve(configured);
    if (!(await isWorkspaceRoot(root))) {
      throw new ProjectError("WORKSPACE_ROOT_INVALID", `設定的工作區根目錄無效：${configured}`);
    }
    return realpath(root);
  }
  return findWorkspaceRoot(options.start ?? process.cwd());
}
