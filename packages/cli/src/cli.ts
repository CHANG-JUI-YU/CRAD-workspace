import { copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { HttpSourceFetcher, inspectLegacyProject } from "@st-workspace/adapters";
import { compileWorkspaceBundle } from "@st-workspace/compiler";
import { FileAttachmentStore, FileProjectRepository } from "@st-workspace/core";
import { AgentAdapter, WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { startWorkspaceServer } from "@st-workspace/server";
import { CliDomainError, CliUsageError, CLI_PROGRAM, EXIT_FATAL, EXIT_OK, parseArgv } from "./parser.js";
import { planRepairExport, runRepairExport, type RepairExportFs } from "./repair-export.js";
import { formatHelp } from "./usage.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

interface EnvSelection {
  projectRoot: string;
  selectedProject: string | undefined;
}

function envSelection(): EnvSelection {
  const projectRoot = process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
  const requestedProject = process.env.ST_WORKSPACE_PROJECT;
  const selectedProject = typeof requestedProject === "string" && requestedProject.trim().length > 0 ? requestedProject.trim() : undefined;
  return { projectRoot, selectedProject };
}

function createRuntime(selection: EnvSelection): { manager: WorkspaceProjectManager | undefined; runtime: WorkspaceRuntime } {
  if (selection.selectedProject === undefined) {
    const manager = new WorkspaceProjectManager({
      root: selection.projectRoot,
      createRuntime: (repository) => new WorkspaceRuntime(repository, { interviewRequired: true, attachmentStore: new FileAttachmentStore(repository) }),
    });
    return { manager, runtime: manager.runtime };
  }
  const runtime = new WorkspaceRuntime(
    new FileProjectRepository(selection.projectRoot, selection.selectedProject, { layout: "project", materialize: true }),
    { attachmentStore: new FileAttachmentStore(selection.projectRoot, selection.selectedProject) },
  );
  return { manager: undefined, runtime };
}

function createRequestRuntime(selection: EnvSelection, fetcher: HttpSourceFetcher): { manager: WorkspaceProjectManager | undefined; runtime: WorkspaceRuntime } {
  if (selection.selectedProject === undefined) {
    const manager = new WorkspaceProjectManager({
      root: selection.projectRoot,
      createRuntime: (repository) =>
        new WorkspaceRuntime(repository, { fetcher: fetcher.fetch, interviewRequired: true, attachmentStore: new FileAttachmentStore(repository) }),
    });
    return { manager, runtime: manager.runtime };
  }
  const runtime = new WorkspaceRuntime(
    new FileProjectRepository(selection.projectRoot, selection.selectedProject, { layout: "project", materialize: true }),
    { fetcher: fetcher.fetch, attachmentStore: new FileAttachmentStore(selection.projectRoot, selection.selectedProject) },
  );
  return { manager: undefined, runtime };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validateAttachment(attachmentPath: string): Promise<void> {
  try {
    const info = await stat(attachmentPath);
    if (!info.isFile()) {
      throw new CliUsageError(`Attachment is not a regular file: "${attachmentPath}"`);
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`Cannot read attachment "${attachmentPath}": ${errorMessage(error)}`);
  }
}

function reportError(error: unknown, io: CliIo): number {
  if (error instanceof CliUsageError) {
    io.err(`${error.message}\nRun "${CLI_PROGRAM} help" for usage.\n`);
    return error.exitCode;
  }
  if (error instanceof CliDomainError) {
    io.err(`${error.message}\n`);
    return error.exitCode;
  }
  io.err(`Unexpected error: ${errorMessage(error)}\n`);
  if (error instanceof Error && error.stack !== undefined) io.err(`${error.stack}\n`);
  return EXIT_FATAL;
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    return reportError(error, io);
  }
  if (parsed.kind === "help") {
    io.out(formatHelp(parsed.topic));
    return EXIT_OK;
  }
  try {
    switch (parsed.kind) {
      case "serve": {
        await startWorkspaceServer({ actor: "cli" });
        io.out(`ST Workspace server listening on http://127.0.0.1:${process.env.ST_WORKSPACE_PORT ?? "8787"}\n`);
        return EXIT_OK;
      }
      case "agents": {
        const { runtime } = createRuntime(envSelection());
        const agentAdapter = new AgentAdapter(runtime);
        io.out(`${JSON.stringify({ default_agent: "director", agents: agentAdapter.list() }, null, 2)}\n`);
        return EXIT_OK;
      }
      case "status": {
        const { manager, runtime } = createRuntime(envSelection());
        const result = manager === undefined ? await runtime.status() : await manager.status();
        io.out(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT_OK;
      }
      case "request": {
        for (const attachmentPath of parsed.attachments) await validateAttachment(attachmentPath);
        const attachments = await Promise.all(
          parsed.attachments.map(async (attachmentPath) => ({
            name: attachmentPath.split(/[\\/]/u).at(-1) ?? attachmentPath,
            content: new Uint8Array(await readFile(attachmentPath)),
          })),
        );
        const { manager, runtime } = createRequestRuntime(envSelection(), new HttpSourceFetcher());
        const agentAdapter = new AgentAdapter(runtime);
        const result =
          manager === undefined
            ? await agentAdapter.request({ request: parsed.text, context: { actor: "cli", attachments } })
            : await manager.request(parsed.text, { actor: "cli", attachments });
        io.out(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT_OK;
      }
      case "repair-export": {
        const plan = planRepairExport(parsed.inputPath, parsed.outputPath);
        let bundle: unknown;
        try {
          bundle = JSON.parse(await readFile(plan.inputJsonPath, "utf8")) as unknown;
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new CliDomainError(`Cannot parse bundle JSON at "${plan.inputJsonPath}": ${errorMessage(error)}`);
          }
          throw new CliUsageError(`Cannot read bundle JSON at "${plan.inputJsonPath}": ${errorMessage(error)}`);
        }
        const compiled = compileWorkspaceBundle(bundle);
        const fs: RepairExportFs = { copyFile, writeFile, rename, unlink, stat };
        const result = await runRepairExport(fs, plan, compiled);
        io.out(`${JSON.stringify(result, null, 2)}\n`);
        return EXIT_OK;
      }
      case "import-legacy": {
        io.out(`${JSON.stringify(await inspectLegacyProject(parsed.legacyRoot), null, 2)}\n`);
        return EXIT_OK;
      }
    }
  } catch (error) {
    return reportError(error, io);
  }
}
