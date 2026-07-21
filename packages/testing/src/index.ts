import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringify as stringifyYaml } from "yaml";

export * from "./fact-builder.js";
export * from "./source-builder.js";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = path.join(packageRoot, "fixtures");

export interface TemporaryWorkspace {
  root: string;
  projectsRoot: string;
  exportsRoot: string;
  cleanup: () => Promise<void>;
}

export async function makeTemporaryWorkspace(): Promise<TemporaryWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), "card-workspace-"));
  const projectsRoot = path.join(root, "projects");
  const exportsRoot = path.join(root, "exports");
  await Promise.all([
    mkdir(projectsRoot, { recursive: true }),
    mkdir(exportsRoot, { recursive: true }),
  ]);

  return {
    root,
    projectsRoot,
    exportsRoot,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

export async function copyFixtureProject(
  fixtureName: "invalid-project" | "valid-project",
  projectsRoot: string,
): Promise<string> {
  const destination = path.join(projectsRoot, fixtureName);
  await cp(path.join(fixtureRoot, fixtureName), destination, { recursive: true });
  return destination;
}

export async function writeYamlFixture(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyYaml(value, { lineWidth: 0 }), "utf8");
}

export async function writeJsonFixture(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
