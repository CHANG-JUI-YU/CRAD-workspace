import { copyFile, constants, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HttpSourceFetcher, inspectLegacyProject } from "@st-workspace/adapters";
import { compileWorkspaceBundle } from "@st-workspace/compiler";
import { FileAttachmentStore, FileProjectRepository } from "@st-workspace/core";
import { AgentAdapter, WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { startWorkspaceServer } from "@st-workspace/server";

async function createExclusiveBackup(inputPath: string): Promise<string> {
  let backupPath = `${inputPath}.bundle-backup.json`;
  let suffix = 2;
  while (true) {
    try {
      await copyFile(inputPath, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      backupPath = `${inputPath}.bundle-backup-${suffix}.json`;
      suffix += 1;
    }
  }
}

const args = process.argv.slice(2);
const command = args[0] ?? "status";
if (command === "serve") {
  await startWorkspaceServer({ actor: "cli" });
  console.log(`ST Workspace server listening on http://127.0.0.1:${process.env.ST_WORKSPACE_PORT ?? "8787"}`);
} else {
if (command === "agents") {
  const root = process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
  const requestedProject = process.env.ST_WORKSPACE_PROJECT;
  const selectedProject = typeof requestedProject === "string" && requestedProject.trim().length > 0 ? requestedProject.trim() : undefined;
  const manager = selectedProject === undefined
    ? new WorkspaceProjectManager({ root, createRuntime: (repository) => new WorkspaceRuntime(repository, { interviewRequired: true, attachmentStore: new FileAttachmentStore(root, repository.projectId) }) })
    : undefined;
  const runtime = manager?.runtime ?? new WorkspaceRuntime(new FileProjectRepository(root, selectedProject ?? "default", { layout: "project", materialize: true }), { attachmentStore: new FileAttachmentStore(root, selectedProject ?? "default") });
  const agentAdapter = new AgentAdapter(runtime);
  console.log(JSON.stringify({ default_agent: "director", agents: agentAdapter.list() }, null, 2));
} else {
if (command === "repair-export") {
  const inputPath = args[1];
  if (inputPath === undefined) throw new Error("repair-export requires a bundle JSON path");
  const outputPath = args[2] ?? inputPath;
  const inPlace = resolve(inputPath) === resolve(outputPath);
  const bundle = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const compiled = compileWorkspaceBundle(bundle);
  const backupPath = inPlace ? await createExclusiveBackup(inputPath) : undefined;
  await writeFile(outputPath, `${compiled.json}\n`, "utf8");
  const pngPath = outputPath.replace(/\.json$/iu, ".png");
  await writeFile(pngPath, compiled.png);
  console.log(JSON.stringify({
    json_path: outputPath,
    png_path: pngPath,
    ...(backupPath === undefined ? {} : { backup_path: backupPath }),
    content_hash: compiled.content_hash,
  }, null, 2));
} else {
if (command === "import-legacy") {
  const legacyRoot = args[1];
  if (legacyRoot === undefined) throw new Error("import-legacy requires a legacy project path");
  console.log(JSON.stringify(await inspectLegacyProject(legacyRoot), null, 2));
} else {
const attachIndex = args.indexOf("--attach");
const attachmentPath = attachIndex >= 0 ? args[attachIndex + 1] : undefined;
const requestArgs = attachIndex >= 0
  ? args.slice(command === "request" ? 1 : 0, attachIndex)
  : args.slice(command === "request" ? 1 : 0);
const request = requestArgs.join(" ");
const projectRoot = process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
const fetcher = new HttpSourceFetcher();
const attachments = attachmentPath === undefined ? [] : [{ name: attachmentPath.split(/[\\/]/u).at(-1) ?? attachmentPath, content: new Uint8Array(await readFile(attachmentPath)) }];
const requestedProject = process.env.ST_WORKSPACE_PROJECT;
const selectedProject = typeof requestedProject === "string" && requestedProject.trim().length > 0 ? requestedProject.trim() : undefined;
const manager = selectedProject === undefined
  ? new WorkspaceProjectManager({ root: projectRoot, createRuntime: (repository) => new WorkspaceRuntime(repository, { fetcher: fetcher.fetch, interviewRequired: true, attachmentStore: new FileAttachmentStore(projectRoot, repository.projectId) }) })
  : undefined;
const runtime = manager?.runtime ?? new WorkspaceRuntime(new FileProjectRepository(projectRoot, selectedProject ?? "default", { layout: "project", materialize: true }), { fetcher: fetcher.fetch, attachmentStore: new FileAttachmentStore(projectRoot, selectedProject ?? "default") });
const agentAdapter = new AgentAdapter(runtime);
const result = command === "status"
  ? manager === undefined ? await runtime.status() : await manager.status()
  : manager === undefined
    ? await agentAdapter.request({ request, context: { actor: "cli", attachments } })
    : await manager.request(request, { actor: "cli", attachments });
console.log(JSON.stringify(result, null, 2));
}
}
}
}
