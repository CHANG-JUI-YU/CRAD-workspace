import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  canonicalJson,
  assertFoundationDocumentPath,
  computeRevision,
  diffValues,
  initializeProject,
  parseStructuredFile,
  patchProjectFile,
  queryPointer,
  resolveProjectDirectory,
  resolveExistingWithin,
  resolveWithin,
  resolveWorkspaceRoot,
  type Operation,
} from "@card-workspace/project";
import {
  buildProject,
  importCardSource,
  importedCardToCanonicalIr,
  normalizeAuthorProject,
  planCanonicalProject,
  roundTripImportedCard,
  simulateTriggers,
} from "@card-workspace/compiler";
import { auditCharacterCard } from "@card-workspace/diagnostics";
import {
  createChunkSet,
  createExtractionJob,
  getSourceRevision,
  getTextProjection,
  intakeLocalSource,
  listChunkSets,
  listSources,
  queryFacts,
  readFactProjection,
  readSourceManifest,
  resolveConflict,
  reviewCandidate,
  storeChunkSet,
  submitCandidateBatch,
  traceProvenance,
  validateCandidateBatch,
  verifyChunkSet,
  verifyProvenance,
  type SourceFormatHint,
} from "@card-workspace/ingestion";
import { loadAuthorProject } from "@card-workspace/project";
import {
  candidateBatchSchema,
  ingestionJobSchema,
  projectManifestSchema,
  type AuthoringMode,
  type FactClassification,
  type SourceTier,
} from "@card-workspace/schemas";
import { Command, Option } from "commander";
import { createCompilePreview, publishApprovedPreview } from "@card-workspace/workflow";
import { startDashboard } from "@card-workspace/dashboard-server";


export interface CliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface CliContext {
  io?: CliIo;
  cwd?: string;
  dashboardStarter?: (options: { workspaceRoot: string; port?: number; logger: boolean }) => Promise<{ address: string; url: string }>;
  browserOpener?: (url: string) => void;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function print(io: CliIo, value: unknown): void {
  io.stdout(canonicalJson(value));
}

async function roots(command: Command, cwd?: string): Promise<{ root: string; projectsRoot: string }> {
  const globalOptions = command.optsWithGlobals<{ workspaceRoot?: string }>();
  const root = await resolveWorkspaceRoot({
    ...(globalOptions.workspaceRoot ? { explicit: globalOptions.workspaceRoot } : {}),
    ...(cwd ? { start: cwd } : {}),
  });
  return { root, projectsRoot: path.join(root, "projects") };
}

function parseCharacter(value: string): {
  id: string;
  display_name: string;
  mode: AuthoringMode;
  role: "primary" | "supporting";
} {
  const [id, displayName, mode = "zhuji", role = "primary"] = value.split(":");
  return {
    id: id ?? "",
    display_name: displayName ?? id ?? "",
    mode: mode as AuthoringMode,
    role: role as "primary" | "supporting",
  };
}

async function parsePatchInput(input: string): Promise<Operation[]> {
  const text = input.startsWith("@") ? await readFile(input.slice(1), "utf8") : input;
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Patch 必須是 RFC 6902 操作陣列");
  return parsed as Operation[];
}

async function parseJsonInput(root: string, input: string): Promise<unknown> {
  const text = input.startsWith("@")
    ? await readFile(await resolveExistingWithin(root, input.slice(1)), "utf8")
    : input;
  return JSON.parse(text) as unknown;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw Object.assign(new Error(`必須是非負整數：${value}`), { code: "CLI_ARGUMENT_INVALID" });
  }
  return parsed;
}

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function projectRoot(command: Command, projectId: string, cwd?: string): Promise<string> {
  const { projectsRoot } = await roots(command, cwd);
  return resolveProjectDirectory(projectsRoot, projectId);
}

async function assertCurrentSourceRevision(root: string, sourceId: string, expected: string): Promise<void> {
  const source = (await readSourceManifest(root)).sources.find((item) => item.id === sourceId);
  if (!source) throw Object.assign(new Error(`找不到 source：${sourceId}`), { code: "SOURCE_NOT_FOUND" });
  if (source.current_revision_id !== expected) {
    throw Object.assign(
      new Error(`source revision 衝突：預期 ${expected}，實際 ${source.current_revision_id ?? "none"}`),
      { code: "SOURCE_REVISION_CONFLICT" },
    );
  }
}

async function readStoredBatch(root: string, batchId: string): Promise<unknown> {
  const file = await resolveExistingWithin(root, `facts/candidates/${batchId}.json`);
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function listSourceJobs(root: string, sourceId: string) {
  let names: string[];
  try {
    names = (await readdir(await resolveWithin(root, "sources/jobs"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const jobs = await Promise.all(names.map(async (name) => ingestionJobSchema.parse(JSON.parse(
    await readFile(await resolveExistingWithin(root, `sources/jobs/${name}`), "utf8"),
  ))));
  return jobs.filter((job) => job.source_id === sourceId);
}

async function readWorkspaceInput(root: string, candidate: string): Promise<Buffer> {
  return readFile(await resolveWithin(root, candidate));
}

export function createProgram(context: CliContext = {}): Command {
  const io = context.io ?? defaultIo;
  const program = new Command()
    .name("card-workspace")
    .description("Card Workspace vNext 確定性專案工具")
    .version("0.1.0")
    .option("--workspace-root <path>", "工作區根目錄")
    .configureOutput({
      writeOut: (value) => io.stdout(value),
      writeErr: () => {},
    })
    .exitOverride();

  program
    .command("dashboard")
    .description("啟動loopback-only桌面Dashboard")
    .option("--no-open", "不要自動開啟瀏覽器")
    .option("--port <port>", "指定loopback port", parseNonNegativeInteger)
    .action(async (options: { open: boolean; port?: number }, command: Command) => {
      const { root } = await roots(command, context.cwd);
      const running = await (context.dashboardStarter ?? startDashboard)({
        workspaceRoot: root,
        ...(options.port === undefined ? {} : { port: options.port }),
        logger: true,
      });
      io.stderr(`Dashboard: ${running.address}\n`);
      if (options.open) (context.browserOpener ?? openBrowser)(running.url);
    });

  program
    .command("init")
    .argument("<project-id>")
    .requiredOption("--title <title>", "專案標題")
    .addOption(new Option("--character <spec...>", "角色宣告，格式 id:name:mode:role").default([]))
    .action(async (projectId: string, options: { title: string; character: string[] }, command: Command) => {
      const { projectsRoot } = await roots(command, context.cwd);
      const characters =
        options.character.length > 0
          ? options.character.map(parseCharacter)
          : [{ id: projectId, display_name: options.title, mode: "zhuji" as const, role: "primary" as const }];
      const manifest = projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: options.title,
        kind: "character_card",
        characters,
        card: { name: options.title },
      });
      const projectRoot = await initializeProject({ projectsRoot, manifest });
      print(io, { ok: true, project_id: projectId, project_root: projectRoot });
    });

  program
    .command("validate")
    .argument("<project-id>")
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const { projectsRoot } = await roots(command, context.cwd);
      const result = await loadAuthorProject(projectsRoot, projectId);
      print(io, result);
      if (!result.ok) process.exitCode = 2;
    });

  program
    .command("query")
    .argument("<project-id>")
    .argument("<file>")
    .argument("[pointer]", "RFC 6901 JSON Pointer", "")
    .action(async (projectId: string, relativeFile: string, pointer: string, _options: unknown, command: Command) => {
      const { projectsRoot } = await roots(command, context.cwd);
      const projectRoot = await resolveProjectDirectory(projectsRoot, projectId);
      const filePath = await resolveWithin(projectRoot, assertFoundationDocumentPath(relativeFile));
      const parsed = await parseStructuredFile(filePath);
      if (parsed.data === undefined) throw new Error(parsed.diagnostics.map((item) => item.message).join("\n"));
      print(io, {
        revision: computeRevision(parsed.data),
        pointer,
        value: queryPointer(parsed.data, pointer),
      });
    });

  program
    .command("patch")
    .argument("<project-id>")
    .argument("<file>")
    .requiredOption("--patch <json-or-@file>", "RFC 6902 patch")
    .requiredOption("--expected-revision <revision>", "樂觀鎖 revision")
    .option("--dry-run", "只顯示差異，不寫入")
    .option("--apply", "確認套用變更")
    .action(
      async (
        projectId: string,
        relativeFile: string,
        options: { patch: string; expectedRevision: string; dryRun?: boolean; apply?: boolean },
        command: Command,
      ) => {
        const { projectsRoot } = await roots(command, context.cwd);
        if (Boolean(options.dryRun) === Boolean(options.apply)) {
          throw new Error("必須且只能指定 --dry-run 或 --apply");
        }
        const projectRoot = await resolveProjectDirectory(projectsRoot, projectId);
        const result = await patchProjectFile({
          projectRoot,
          relativePath: relativeFile,
          operations: await parsePatchInput(options.patch),
          expectedRevision: options.expectedRevision,
          dryRun: options.dryRun ?? false,
        });
        print(io, result);
      },
    );

  program
    .command("diff")
    .argument("<project-id>")
    .argument("<left-file>")
    .argument("<right-file>")
    .action(
      async (projectId: string, leftFile: string, rightFile: string, _options: unknown, command: Command) => {
        const { projectsRoot } = await roots(command, context.cwd);
        const projectRoot = await resolveProjectDirectory(projectsRoot, projectId);
        const leftDocument = assertFoundationDocumentPath(leftFile);
        const rightDocument = assertFoundationDocumentPath(rightFile);
        const [leftPath, rightPath] = await Promise.all([
          resolveWithin(projectRoot, leftDocument),
          resolveWithin(projectRoot, rightDocument),
        ]);
        const [left, right] = await Promise.all([
          parseStructuredFile(leftPath),
          parseStructuredFile(rightPath),
        ]);
        if (left.data === undefined || right.data === undefined) {
          throw new Error([...left.diagnostics, ...right.diagnostics].map((item) => item.message).join("\n"));
        }
        print(io, { differences: diffValues(left.data, right.data) });
      },
    );

  program
    .command("plan")
    .argument("<project-id>")
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const { root, projectsRoot } = await roots(command, context.cwd);
      void root;
      const loaded = await loadAuthorProject(projectsRoot, projectId);
      const normalized = normalizeAuthorProject(loaded);
      if (!normalized.ok || !normalized.ir) throw new Error(normalized.diagnostics.map((item) => item.message).join("\n"));
      const planned = planCanonicalProject(normalized.ir);
      if (!planned.ok || !planned.ir) throw new Error(planned.diagnostics.map((item) => item.message).join("\n"));
      print(io, planned);
    });

  program
    .command("simulate")
    .argument("<project-id>")
    .requiredOption("--conversation <file>", "UTF-8 JSON 字串陣列或純文字對話")
    .action(async (projectId: string, options: { conversation: string }, command: Command) => {
      const { root } = await roots(command, context.cwd);
      const built = await buildProject({ workspaceRoot: root, projectId, publish: false, png: false });
      const source = await readWorkspaceInput(root, options.conversation);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(source);
      let messages: string[];
      try {
        const parsed = JSON.parse(text) as unknown;
        messages = Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [text];
      } catch {
        messages = [text];
      }
      print(io, {
        token_report: built.tokenReport,
        trigger_result: simulateTriggers(built.planned, { messages }),
      });
    });

  program
    .command("compile")
    .argument("<project-id>")
    .option("--no-publish", "只在記憶體中編譯")
    .option("--no-png", "不產生 PNG")
    .option("--v2-backfill", "PNG 同時寫入真正 V2 chara backfill")
    .option("--preview-id <id>", "preview ID；發布時必填")
    .option("--token-budget <tokens>", "選填的世界書 token 預算", (value) => Number.parseInt(value, 10))
    .action(async (
      projectId: string,
       options: { publish: boolean; png: boolean; v2Backfill?: boolean; tokenBudget?: number; previewId?: string },
      command: Command,
    ) => {
      const { root } = await roots(command, context.cwd);
      const previewId = options.previewId ?? `preview-${Date.now()}`;
      if (options.publish && options.previewId === undefined) {
        throw Object.assign(new Error("發布必須指定已批准的 --preview-id"), { code: "PUBLISH_PREVIEW_REQUIRED" });
      }
      const output = options.publish
        ? await publishApprovedPreview({
            workspaceRoot: root,
            projectId,
            previewId,
            eventId: `publish-${previewId}`,
            actor: "user",
            occurredAt: new Date().toISOString(),
          })
        : { preview: await createCompilePreview({
            workspaceRoot: root,
            projectId,
            previewId,
            eventId: `compile-${previewId}`,
            actor: "user",
            occurredAt: new Date().toISOString(),
             build: {
               png: options.png,
               v2Backfill: options.v2Backfill ?? false,
               ...(options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
             },
          }) };
      print(io, {
        ok: true,
        published: options.publish,
        preview_id: output.preview.id,
        input_revision: output.preview.input_revision,
        audit: output.preview.audit,
        artifacts: output.preview.artifact_hashes,
      });
    });

  program
    .command("audit")
    .argument("<file>")
    .action(async (file: string, _options: unknown, command: Command) => {
      const { root } = await roots(command, context.cwd);
      const envelope = importCardSource(await readWorkspaceInput(root, file));
      print(io, auditCharacterCard(envelope.card));
    });

  program
    .command("import")
    .argument("<file>")
    .action(async (file: string, _options: unknown, command: Command) => {
      const { root } = await roots(command, context.cwd);
      const envelope = importCardSource(await readWorkspaceInput(root, file));
      print(io, { envelope, canonical_ir: importedCardToCanonicalIr(envelope) });
    });

  program
    .command("roundtrip")
    .argument("<file>")
    .action(async (file: string, _options: unknown, command: Command) => {
      const { root } = await roots(command, context.cwd);
      print(io, roundTripImportedCard(importCardSource(await readWorkspaceInput(root, file))));
    });

  const source = program.command("source").description("管理來源、revision、chunks 與 extraction jobs");

  source
    .command("add")
    .argument("<project-id>")
    .argument("<file>", "明確的外部絕對單檔路徑")
    .requiredOption("--source-id <id>", "source ID")
    .requiredOption("--title <title>", "來源標題")
    .addOption(new Option("--tier <tier>").choices(["official", "common_fanon", "single_author_fanon", "user_original", "unknown"]))
    .addOption(new Option("--format <format>").choices(["text", "markdown", "chat", "json", "yaml", "character-card"]))
    .option("--author <author>")
    .option("--language <language>")
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      file: string,
      options: {
        sourceId: string; title: string; tier?: SourceTier; format?: SourceFormatHint;
        author?: string; language?: string; actor: string;
      },
      command: Command,
    ) => {
      if (!path.isAbsolute(file) || file.split(/[\\/]/u).includes("..")) {
        throw Object.assign(new Error("source file 必須是無 traversal 的明確絕對路徑"), { code: "SOURCE_PATH_NOT_EXPLICIT" });
      }
      const root = await projectRoot(command, projectId, context.cwd);
      if ((await listSources(root)).some((item) => item.id === options.sourceId)) {
        throw Object.assign(new Error(`source 已存在：${options.sourceId}`), { code: "SOURCE_ALREADY_EXISTS" });
      }
      const result = await intakeLocalSource({
        projectRoot: root,
        filePath: file,
        sourceId: options.sourceId,
        title: options.title,
        ...(options.tier ? { tier: options.tier } : {}),
        ...(options.format ? { format: options.format } : {}),
        ...(options.author ? { author: options.author } : {}),
        ...(options.language ? { language: options.language } : {}),
        actor: options.actor,
      });
      print(io, { ok: true, ...result, manifest_revision: (await readSourceManifest(root)).revision });
    });

  source
    .command("revise")
    .argument("<project-id>")
    .argument("<source-id>")
    .argument("<file>", "明確的外部絕對單檔路徑")
    .requiredOption("--expected-revision <revision>", "目前 source revision")
    .option("--title <title>")
    .addOption(new Option("--tier <tier>").choices(["official", "common_fanon", "single_author_fanon", "user_original", "unknown"]))
    .addOption(new Option("--format <format>").choices(["text", "markdown", "chat", "json", "yaml", "character-card"]))
    .option("--author <author>")
    .option("--language <language>")
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      sourceId: string,
      file: string,
      options: {
        expectedRevision: string; title?: string; tier?: SourceTier; format?: SourceFormatHint;
        author?: string; language?: string; actor: string;
      },
      command: Command,
    ) => {
      if (!path.isAbsolute(file) || file.split(/[\\/]/u).includes("..")) {
        throw Object.assign(new Error("source file 必須是無 traversal 的明確絕對路徑"), { code: "SOURCE_PATH_NOT_EXPLICIT" });
      }
      const root = await projectRoot(command, projectId, context.cwd);
      await assertCurrentSourceRevision(root, sourceId, options.expectedRevision);
      const current = (await listSources(root)).find((item) => item.id === sourceId)!;
      const result = await intakeLocalSource({
        projectRoot: root,
        filePath: file,
        sourceId,
        title: options.title ?? current.title,
        tier: options.tier ?? current.tier,
        ...(options.format ? { format: options.format } : {}),
        ...(options.author ? { author: options.author } : {}),
        ...(options.language ? { language: options.language } : {}),
        actor: options.actor,
      });
      print(io, { ok: true, ...result, manifest_revision: (await readSourceManifest(root)).revision });
    });

  source
    .command("list")
    .argument("<project-id>")
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const root = await projectRoot(command, projectId, context.cwd);
      const manifest = await readSourceManifest(root);
      print(io, { revision: manifest.revision, sources: manifest.sources });
    });

  source
    .command("chunk")
    .argument("<project-id>")
    .argument("<source-id>")
    .requiredOption("--expected-revision <revision>", "目前 source revision")
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      sourceId: string,
      options: { expectedRevision: string; actor: string },
      command: Command,
    ) => {
      const root = await projectRoot(command, projectId, context.cwd);
      await assertCurrentSourceRevision(root, sourceId, options.expectedRevision);
      const projection = await getTextProjection(root, sourceId, options.expectedRevision as `sha256:${string}`);
      const stored = await storeChunkSet({ projectRoot: root, artifacts: createChunkSet({ projection }), actor: options.actor });
      const job = await createExtractionJob({
        projectRoot: root,
        sourceId,
        sourceRevisionId: projection.source_revision_id,
        chunkSetId: stored.manifest.id,
        createdBy: options.actor,
      });
      print(io, { ok: true, source_revision: projection.source_revision_id, chunk_set: stored, job });
    });

  source
    .command("status")
    .argument("<project-id>")
    .argument("<source-id>")
    .action(async (projectId: string, sourceId: string, _options: unknown, command: Command) => {
      const root = await projectRoot(command, projectId, context.cwd);
      const sourceRecord = (await listSources(root)).find((item) => item.id === sourceId);
      if (!sourceRecord) throw Object.assign(new Error(`找不到 source：${sourceId}`), { code: "SOURCE_NOT_FOUND" });
      print(io, {
        source: sourceRecord,
        chunks: await listChunkSets(root, sourceId),
        jobs: await listSourceJobs(root, sourceId),
      });
    });

  source
    .command("verify")
    .argument("<project-id>")
    .argument("[source-id]")
    .action(async (projectId: string, sourceId: string | undefined, _options: unknown, command: Command) => {
      const root = await projectRoot(command, projectId, context.cwd);
      const selected = (await listSources(root)).filter((item) => sourceId === undefined || item.id === sourceId);
      if (sourceId !== undefined && selected.length === 0) {
        throw Object.assign(new Error(`找不到 source：${sourceId}`), { code: "SOURCE_NOT_FOUND" });
      }
      const verified = [];
      for (const item of selected) {
        const revisions = [];
        for (const revisionId of item.revision_ids) {
          const revision = await getSourceRevision(root, item.id, revisionId);
          const chunkSets = await listChunkSets(root, item.id, revisionId);
          for (const chunkSet of chunkSets) await verifyChunkSet(root, item.id, revisionId, chunkSet.id);
          revisions.push({ revision, chunk_sets: chunkSets });
        }
        verified.push({ source: item, revisions });
      }
      print(io, { ok: true, sources: verified });
    });

  const fact = program.command("fact").description("提交、審核與查詢事實");

  fact
    .command("submit")
    .argument("<project-id>")
    .argument("<json-or-@file>", "inline JSON 或 @workspace-relative-file")
    .requiredOption("--expected-revision <revision>", "job 數字 revision", parseNonNegativeInteger)
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      input: string,
      options: { expectedRevision: number; actor: string },
      command: Command,
    ) => {
      const { root: workspaceRoot } = await roots(command, context.cwd);
      const root = await projectRoot(command, projectId, context.cwd);
      const parsed = candidateBatchSchema.parse(await parseJsonInput(workspaceRoot, input));
      if (parsed.created_by !== options.actor) {
        throw Object.assign(new Error(`batch created_by 必須符合 --actor：${options.actor}`), { code: "CANDIDATE_ACTOR_MISMATCH" });
      }
      print(io, { ok: true, ...(await submitCandidateBatch(root, parsed, options.expectedRevision)) });
    });

  fact
    .command("validate")
    .argument("<project-id>")
    .argument("<batch-id>")
    .action(async (projectId: string, batchId: string, _options: unknown, command: Command) => {
      const root = await projectRoot(command, projectId, context.cwd);
      print(io, { ok: true, batch: await validateCandidateBatch(root, await readStoredBatch(root, batchId)) });
    });

  fact
    .command("review")
    .argument("<project-id>")
    .argument("<candidate-id>")
    .requiredOption("--decision <status>", "accepted|rejected|superseded|withdrawn")
    .requiredOption("--decision-id <id>")
    .requiredOption("--fact-id <id>")
    .requiredOption("--rationale <text>")
    .requiredOption("--expected-revision <revision>", "fact projection revision")
    .option("--expected-fact-revision <revision>", "既有 fact 數字 revision", parseNonNegativeInteger)
    .option("--patch <json-or-@file>", "inline JSON 或 @workspace-relative-file")
    .option("--decided-at <timestamp>")
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      candidateId: string,
      options: {
        decision: string; decisionId: string; factId: string; rationale: string; expectedRevision: string;
        expectedFactRevision?: number; patch?: string; decidedAt?: string; actor: string;
      },
      command: Command,
    ) => {
      if (!["accepted", "rejected", "superseded", "withdrawn"].includes(options.decision)) {
        throw Object.assign(new Error(`無效 review decision：${options.decision}`), { code: "FACT_DECISION_INVALID" });
      }
      const { root: workspaceRoot } = await roots(command, context.cwd);
      const root = await projectRoot(command, projectId, context.cwd);
      const result = await reviewCandidate(root, {
        decision: {
          schema_version: 1,
          id: options.decisionId,
          candidate_id: candidateId,
          fact_id: options.factId,
          type: options.decision,
          rationale: options.rationale,
          actor: options.actor,
          decided_at: options.decidedAt ?? new Date().toISOString(),
        },
        expectedProjectionRevision: options.expectedRevision as `sha256:${string}`,
        ...(options.expectedFactRevision === undefined ? {} : { expectedFactRevision: options.expectedFactRevision }),
        ...(options.patch ? { patch: await parseJsonInput(workspaceRoot, options.patch) as never } : {}),
      });
      print(io, { ok: true, ...result });
    });

  fact
    .command("conflicts")
    .argument("<project-id>")
    .option("--status <status>", "open|resolved")
    .action(async (projectId: string, options: { status?: string }, command: Command) => {
      const root = await projectRoot(command, projectId, context.cwd);
      const projection = await readFactProjection(root);
      const conflicts = projection.conflicts.conflicts.filter((item) => options.status === undefined || item.status === options.status);
      print(io, { revision: projection.conflicts.revision, conflicts });
    });

  fact
    .command("resolve")
    .argument("<project-id>")
    .argument("<conflict-id>")
    .requiredOption("--decision-file <json-or-@file>", "inline JSON 或 @workspace-relative-file")
    .requiredOption("--expected-revision <revision>", "fact projection revision")
    .requiredOption("--expected-fact-revisions <json-or-@file>", "fact ID 到數字 revision 的 JSON object")
    .option("--actor <actor>", "操作者 ID", "user")
    .action(async (
      projectId: string,
      conflictId: string,
      options: { decisionFile: string; expectedRevision: string; expectedFactRevisions: string; actor: string },
      command: Command,
    ) => {
      const { root: workspaceRoot } = await roots(command, context.cwd);
      const root = await projectRoot(command, projectId, context.cwd);
      const raw = await parseJsonInput(workspaceRoot, options.decisionFile) as Record<string, unknown>;
      const decision = {
        ...raw,
        conflict_id: conflictId,
        actor: options.actor,
        decided_at: raw.decided_at ?? new Date().toISOString(),
      };
      const expectedFactRevisions = await parseJsonInput(workspaceRoot, options.expectedFactRevisions);
      if (expectedFactRevisions === null || Array.isArray(expectedFactRevisions) || typeof expectedFactRevisions !== "object") {
        throw Object.assign(new Error("--expected-fact-revisions 必須是 JSON object"), { code: "FACT_REVISION_INVALID" });
      }
      print(io, { ok: true, ...(await resolveConflict(root, {
        decision,
        expectedProjectionRevision: options.expectedRevision as `sha256:${string}`,
        expectedFactRevisions: expectedFactRevisions as Record<string, number>,
      })) });
    });

  fact
    .command("query")
    .argument("<project-id>")
    .option("--status <status>")
    .option("--subject <subject>")
    .option("--predicate <predicate>")
    .option("--classification <classification>")
    .option("--source-id <source-id>")
    .option("--gate-status <status>", "clear|blocked_unresolved_conflict")
    .action(async (
      projectId: string,
      options: {
        status?: "accepted" | "rejected" | "superseded" | "withdrawn";
        subject?: string; predicate?: string; classification?: FactClassification; sourceId?: string;
        gateStatus?: "clear" | "blocked_unresolved_conflict";
      },
      command: Command,
    ) => {
      const root = await projectRoot(command, projectId, context.cwd);
      print(io, await queryFacts(root, options));
    });

  const provenance = program.command("provenance").description("追蹤與驗證 provenance chain");

  provenance
    .command("trace")
    .argument("<project-id>")
    .argument("<fact-or-fragment-id>")
    .action(async (projectId: string, id: string, _options: unknown, command: Command) => {
      print(io, await traceProvenance(await projectRoot(command, projectId, context.cwd), id));
    });

  provenance
    .command("verify")
    .argument("<project-id>")
    .action(async (projectId: string, _options: unknown, command: Command) => {
      const result = await verifyProvenance(await projectRoot(command, projectId, context.cwd));
      print(io, result);
      if (!result.ok) {
        process.exitCode = result.diagnostics.some((item) => item.code.includes("unresolved-conflict")) ? 3 : 2;
      }
    });

  return program;
}

export async function runCli(argv: string[], context: CliContext = {}): Promise<void> {
  await createProgram(context).parseAsync(argv, { from: "user" });
}
