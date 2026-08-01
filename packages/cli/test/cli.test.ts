import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { candidateBatchSchema, workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { candidateBatchId, computeCandidateBatchHash } from "@card-workspace/ingestion";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
describe("CLI", () => {
  it("init、validate、query 與 dry-run patch 可端到端執行", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");

    const initCapture = capture();
    await runCli(
      [
        "--workspace-root",
        workspace.root,
        "init",
        "demo",
        "--title",
        "示範",
        "--character",
        "alice:愛麗絲:zhuji:primary",
        "bob:鮑伯:palette:supporting",
      ],
      { io: initCapture.io },
    );
    expect(JSON.parse(initCapture.output().stdout)).toMatchObject({ ok: true, project_id: "demo" });

    const validateCapture = capture();
    await runCli(["--workspace-root", workspace.root, "validate", "demo"], {
      io: validateCapture.io,
    });
    expect(JSON.parse(validateCapture.output().stdout)).toMatchObject({ ok: true });

    const queryCapture = capture();
    await runCli(["--workspace-root", workspace.root, "query", "demo", "project.yaml", "/title"], {
      io: queryCapture.io,
    });
    const queryResult = JSON.parse(queryCapture.output().stdout) as { revision: string; value: string };
    expect(queryResult.value).toBe("示範");

    const patchCapture = capture();
    await runCli(
      [
        "--workspace-root",
        workspace.root,
        "patch",
        "demo",
        "project.yaml",
        "--patch",
        '[{"op":"replace","path":"/title","value":"修改後"}]',
        "--expected-revision",
        queryResult.revision,
        "--dry-run",
      ],
      { io: patchCapture.io },
    );
    expect(JSON.parse(patchCapture.output().stdout)).toMatchObject({ dryRun: true });
    expect(await readFile(path.join(workspace.projectsRoot, "demo", "project.yaml"), "utf8")).toContain(
      "示範",
    );

    const applyCapture = capture();
    await runCli(
      [
        "--workspace-root",
        workspace.root,
        "patch",
        "demo",
        "project.yaml",
        "--patch",
        '[{"op":"replace","path":"/title","value":"修改後"}]',
        "--expected-revision",
        queryResult.revision,
        "--apply",
      ],
      { io: applyCapture.io },
    );
    expect(JSON.parse(applyCapture.output().stdout)).toMatchObject({
      dryRun: false,
      workflowRevision: 1,
    });
    expect(await readFile(path.join(workspace.projectsRoot, "demo", "project.yaml"), "utf8")).toContain(
      "修改後",
    );

    await expect(
      runCli(
        [
          "--workspace-root",
          workspace.root,
          "patch",
          "demo",
          "project.yaml",
          "--patch",
          '[{"op":"replace","path":"/title","value":"過期修改"}]',
          "--expected-revision",
          queryResult.revision,
          "--apply",
        ],
        { io: capture().io },
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    const previewReady = await commitWorkflowMutation(path.join(workspace.projectsRoot, "demo"), {
      expectedRevision: 1,
      eventId: "cli-content-approved",
      actor: "engine",
      occurredAt: "2026-07-19T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: 2,
        stage: "compile_preview",
        artifacts: [{
          id: "author-content",
          status: "approved",
          revision: `sha256:${"a".repeat(64)}`,
          updated_at: "2026-07-19T00:00:00.000Z",
          extensions: {},
        }],
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
          { id: "content", status: "approved", input_revisions: [{ id: "author-content", revision: `sha256:${"a".repeat(64)}` }], extensions: {} },
          { id: "publish", status: "pending", input_revisions: [], extensions: {} },
        ],
      }),
    });
    expect(previewReady.stage).toBe("compile_preview");
    expect(previewReady.gates.find((gate) => gate.id === "content")?.status).toBe("approved");
    expect(previewReady.artifacts.map((artifact) => artifact.id)).toContain("author-content");

    const compileCapture = capture();
    await runCli(
      ["--workspace-root", workspace.root, "compile", "demo", "--no-publish", "--no-png"],
      { io: compileCapture.io },
    );
    expect(JSON.parse(compileCapture.output().stdout)).toMatchObject({ ok: true, published: false });

    const cardPath = path.join(workspace.root, "card.json");
    const compiled = await import("@card-workspace/compiler").then(({ buildProject }) =>
      buildProject({ workspaceRoot: workspace.root, projectId: "demo", publish: false, png: false }),
    );
    await writeFile(cardPath, JSON.stringify(compiled.card), "utf8");
    const importCapture = capture();
    await runCli(["--workspace-root", workspace.root, "import", "card.json"], { io: importCapture.io });
    expect(JSON.parse(importCapture.output().stdout)).toMatchObject({
      envelope: { source_format: "v3" },
      canonical_ir: { characters: [{ mode: "imported" }] },
    });
    const diffCapture = capture();
    await runCli(["--workspace-root", workspace.root, "diff", "demo", "project.yaml", "project.yaml"], { io: diffCapture.io });
    expect(JSON.parse(diffCapture.output().stdout)).toMatchObject({ differences: [] });
    const planCapture = capture();
    await runCli(["--workspace-root", workspace.root, "plan", "demo"], { io: planCapture.io });
    expect(JSON.parse(planCapture.output().stdout)).toMatchObject({ ok: true });
    await writeFile(path.join(workspace.root, "conversation.json"), JSON.stringify(["Hello", "Bye"]), "utf8");
    const simulateCapture = capture();
    await runCli(["--workspace-root", workspace.root, "simulate", "demo", "--conversation", "conversation.json"], { io: simulateCapture.io });
    expect(JSON.parse(simulateCapture.output().stdout)).toHaveProperty("token_report");
    const auditCapture = capture();
    await runCli(["--workspace-root", workspace.root, "audit", "card.json"], { io: auditCapture.io });
    expect(JSON.parse(auditCapture.output().stdout)).toHaveProperty("ok");
    const roundtripCapture = capture();
    await runCli(["--workspace-root", workspace.root, "roundtrip", "card.json"], { io: roundtripCapture.io });
    expect(JSON.parse(roundtripCapture.output().stdout)).toHaveProperty("differences");
    await expect(runCli(["--workspace-root", workspace.root, "compile", "demo"], { io: capture().io })).rejects.toMatchObject({ code: "PUBLISH_PREVIEW_REQUIRED" });
  });

  it("Sources/Facts 命令可從來源匯入續接至查詢與 provenance 驗證", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    await runCli(
      ["--workspace-root", workspace.root, "init", "sources-demo", "--title", "來源示範"],
      { io: capture().io },
    );

    const sourcePath = path.join(workspace.root, "chapter.md");
    await writeFile(sourcePath, "# 第一章\n\n愛麗絲有銀色頭髮。\n", "utf8");
    const addCapture = capture();
    await runCli(
      [
        "--workspace-root", workspace.root,
        "source", "add", "sources-demo", sourcePath,
        "--source-id", "novel", "--title", "原作小說", "--tier", "official",
      ],
      { io: addCapture.io },
    );
    const added = JSON.parse(addCapture.output().stdout) as {
      ok: boolean;
      revision: { id: string };
      manifest_revision: string;
    };
    expect(added.ok).toBe(true);
    expect(added.revision.id).toMatch(/^sha256:/u);

    const chunkCapture = capture();
    await runCli(
      [
        "--workspace-root", workspace.root,
        "source", "chunk", "sources-demo", "novel",
        "--expected-revision", added.revision.id,
      ],
      { io: chunkCapture.io },
    );
    expect(JSON.parse(chunkCapture.output().stdout)).toMatchObject({
      ok: true,
      source_revision: added.revision.id,
      job: { job: { source_id: "novel", status: "pending" } },
    });

    const statusCapture = capture();
    await runCli(
      ["--workspace-root", workspace.root, "source", "status", "sources-demo", "novel"],
      { io: statusCapture.io },
    );
    expect(JSON.parse(statusCapture.output().stdout)).toMatchObject({
      source: { id: "novel", current_revision_id: added.revision.id },
      chunks: [{ source_revision_id: added.revision.id }],
      jobs: [{ source_id: "novel" }],
    });

    const verifyCapture = capture();
    await runCli(
      ["--workspace-root", workspace.root, "source", "verify", "sources-demo", "novel"],
      { io: verifyCapture.io },
    );
    expect(JSON.parse(verifyCapture.output().stdout)).toMatchObject({ ok: true });

    const factsCapture = capture();
    await runCli(
      ["--workspace-root", workspace.root, "fact", "query", "sources-demo"],
      { io: factsCapture.io },
    );
    expect(JSON.parse(factsCapture.output().stdout)).toMatchObject({ facts: [] });

    const provenanceCapture = capture();
    await runCli(
      ["--workspace-root", workspace.root, "provenance", "verify", "sources-demo"],
      { io: provenanceCapture.io },
    );
    expect(JSON.parse(provenanceCapture.output().stdout)).toMatchObject({ ok: true, diagnostics: [] });

    await expect(runCli(
      [
        "--workspace-root", workspace.root,
        "source", "add", "sources-demo", "../chapter.md",
        "--source-id", "escape", "--title", "越界",
      ],
      { io: capture().io },
    )).rejects.toMatchObject({ code: "SOURCE_PATH_NOT_EXPLICIT" });
  });
  it("covers CLI defaults, CAS guards, source lifecycle, and empty queries", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    const io = capture();
    await runCli(["--workspace-root", workspace.root, "init", "cli-edges", "--title", "CLI edges"], { io: io.io });

    const sourcePath = path.join(workspace.root, "source.txt");
    await writeFile(sourcePath, "first source", "utf8");
    const addedCapture = capture();
    await runCli(["--workspace-root", workspace.root, "source", "add", "cli-edges", sourcePath, "--source-id", "src", "--title", "Source"], { io: addedCapture.io });
    const added = JSON.parse(addedCapture.output().stdout) as { revision: { id: string } };
    await expect(runCli(["--workspace-root", workspace.root, "source", "add", "cli-edges", sourcePath, "--source-id", "src", "--title", "Duplicate"], { io: capture().io })).rejects.toMatchObject({ code: "SOURCE_ALREADY_EXISTS" });

    await writeFile(sourcePath, "revised source", "utf8");
    const revisedCapture = capture();
    await runCli(["--workspace-root", workspace.root, "source", "revise", "cli-edges", "src", sourcePath, "--expected-revision", added.revision.id], { io: revisedCapture.io });
    const revised = JSON.parse(revisedCapture.output().stdout) as { revision: { id: string } };
    expect(revised.revision.id).toMatch(/^sha256:/u);
    await expect(runCli(["--workspace-root", workspace.root, "source", "revise", "cli-edges", "src", sourcePath, "--expected-revision", added.revision.id], { io: capture().io })).rejects.toMatchObject({ code: "SOURCE_REVISION_CONFLICT" });

    await runCli(["--workspace-root", workspace.root, "source", "list", "cli-edges"], { io: capture().io });
    await runCli(["--workspace-root", workspace.root, "source", "verify", "cli-edges"], { io: capture().io });
    await expect(runCli(["--workspace-root", workspace.root, "source", "verify", "cli-edges", "missing"], { io: capture().io })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    await expect(runCli(["--workspace-root", workspace.root, "source", "status", "cli-edges", "missing"], { io: capture().io })).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });

    const queryCapture = capture();
    await runCli(["--workspace-root", workspace.root, "query", "cli-edges", "project.yaml"], { io: queryCapture.io });
    const query = JSON.parse(queryCapture.output().stdout) as { revision: string };
    const patchPath = path.join(workspace.root, "patch.json");
    await writeFile(patchPath, JSON.stringify([{ op: "replace", path: "/title", value: "CLI patched" }]), "utf8");
    await expect(runCli(["--workspace-root", workspace.root, "patch", "cli-edges", "project.yaml", "--patch", "@patch.json", "--expected-revision", query.revision], { io: capture().io })).rejects.toThrow("--dry-run");
    await expect(runCli(["--workspace-root", workspace.root, "patch", "cli-edges", "project.yaml", "--patch", "@patch.json", "--expected-revision", query.revision, "--dry-run", "--apply"], { io: capture().io })).rejects.toThrow("--dry-run");

    const validateCapture = capture();
    await mkdir(path.join(workspace.projectsRoot, "missing-project"), { recursive: true });
    await runCli(["--workspace-root", workspace.root, "validate", "missing-project"], { io: validateCapture.io });
    expect(process.exitCode).toBe(2);
    process.exitCode = undefined;
    await runCli(["--workspace-root", workspace.root, "fact", "query", "cli-edges", "--status", "accepted", "--subject", "s", "--predicate", "p", "--source-id", "src", "--gate-status", "clear"], { io: capture().io });
  });

  it("covers CLI help, default characters, source option fallbacks, and parser guards", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    const help = capture();
    await expect(runCli(["--workspace-root", workspace.root, "--help"], { io: help.io })).rejects.toThrow(/outputHelp/u);
    expect(help.output().stdout).toContain("Usage");
    await runCli(["--workspace-root", workspace.root, "init", "cli-default", "--title", "Default"], { io: capture().io });
    const sourcePath = path.join(workspace.root, "source.md");
    await writeFile(sourcePath, "source text with enough content", "utf8");
    await runCli(["--workspace-root", workspace.root, "source", "add", "cli-default", sourcePath, "--source-id", "source", "--title", "Source", "--format", "markdown", "--author", "Author", "--language", "en", "--actor", "tester"], { io: capture().io });
    await expect(runCli(["--workspace-root", workspace.root, "source", "status", "cli-default", "source"], { io: capture().io })).resolves.toBeUndefined();
    await expect(runCli(["--workspace-root", workspace.root, "patch", "cli-default", "project.yaml", "--patch", "{}", "--expected-revision", `sha256:${"0".repeat(64)}`, "--dry-run"], { io: capture().io })).rejects.toThrow();
  });

  it("covers CLI source and fact guard branches plus raw conversation fallback", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    await runCli(["--workspace-root", workspace.root, "init", "cli-guard", "--title", "CLI guard"], { io: capture().io });
    const sourcePath = path.join(workspace.root, "guard.txt");
    await writeFile(sourcePath, "guard source", "utf8");
    const added = capture();
    await runCli(["--workspace-root", workspace.root, "source", "add", "cli-guard", sourcePath, "--source-id", "guard", "--title", "Guard"], { io: added.io });
    const revision = (JSON.parse(added.output().stdout) as { revision: { id: string } }).revision.id;
    await expect(runCli(["--workspace-root", workspace.root, "source", "status", "cli-guard", "guard"], { io: capture().io })).resolves.toBeUndefined();
    await expect(runCli(["--workspace-root", workspace.root, "source", "revise", "cli-guard", "guard", workspace.root + "\\..\\guard.txt", "--expected-revision", revision], { io: capture().io })).rejects.toMatchObject({ code: "SOURCE_PATH_NOT_EXPLICIT" });
    await expect(runCli(["--workspace-root", workspace.root, "fact", "review", "cli-guard", "missing", "--decision", "invalid", "--decision-id", "d", "--fact-id", "f", "--rationale", "r", "--expected-revision", revision], { io: capture().io })).rejects.toMatchObject({ code: "FACT_DECISION_INVALID" });
    await expect(runCli(["--workspace-root", workspace.root, "fact", "resolve", "cli-guard", "conflict", "--decision-file", "{}", "--expected-revision", revision, "--expected-fact-revisions", "[]"], { io: capture().io })).rejects.toMatchObject({ code: "FACT_REVISION_INVALID" });
    await runCli(["--workspace-root", workspace.root, "fact", "conflicts", "cli-guard", "--status", "open"], { io: capture().io });
    await writeFile(path.join(workspace.root, "conversation.txt"), "not JSON conversation", "utf8");
    await runCli(["--workspace-root", workspace.root, "simulate", "cli-guard", "--conversation", "conversation.txt"], { io: capture().io });
  });
  it("covers CLI fact submission actor binding, provenance missing IDs, and compile options", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    await runCli(["--workspace-root", workspace.root, "init", "cli-fact", "--title", "CLI fact"], { io: capture().io });
    const sourcePath = path.join(workspace.root, "fact-source.txt");
    await writeFile(sourcePath, "A fact source for candidate extraction.", "utf8");
    const sourceAdded = capture();
    await runCli(["--workspace-root", workspace.root, "source", "add", "cli-fact", sourcePath, "--source-id", "source", "--title", "Fact source"], { io: sourceAdded.io });
    const sourceRevision = (JSON.parse(sourceAdded.output().stdout) as { revision: { id: string } }).revision.id;
    const chunked = capture();
    await runCli(["--workspace-root", workspace.root, "source", "chunk", "cli-fact", "source", "--expected-revision", sourceRevision], { io: chunked.io });
    const chunkPayload = JSON.parse(chunked.output().stdout) as { chunk_set: { manifest: { id: string }; chunks: Array<{ id: string; content_hash: string }> }; job: { job: { id: string; input_revision: string } } };
    const firstChunk = chunkPayload.chunk_set.chunks[0];
    if (!firstChunk) throw new Error("fact source chunk missing");
    const draft = {
      schema_version: 1 as const,
      id: "batch-cli",
      source_id: "source",
      source_revision_id: sourceRevision,
      chunk_set_id: chunkPayload.chunk_set.manifest.id,
      chunk_id: firstChunk.id,
      chunk_hash: firstChunk.content_hash,
      job_id: chunkPayload.job.job.id,
      input_revision: chunkPayload.job.job.input_revision,
      candidates: [],
      created_by: "creator",
      created_at: "2026-07-21T00:00:00.000Z",
      extensions: {},
    };
    const batchHash = computeCandidateBatchHash(draft);
    const batch = candidateBatchSchema.parse({ ...draft, id: candidateBatchId(batchHash), content_hash: batchHash });
    const batchPath = path.join(workspace.root, "batch.json");
    await writeFile(batchPath, JSON.stringify(batch), "utf8");
    await expect(runCli([
      "--workspace-root", workspace.root,
      "fact", "submit", "cli-fact", "@batch.json",
      "--expected-revision", "0",
      "--actor", "different-actor",
    ], { io: capture().io })).rejects.toMatchObject({ code: "CANDIDATE_ACTOR_MISMATCH" });
    const submitted = capture();
    await runCli(["--workspace-root", workspace.root, "fact", "submit", "cli-fact", "@batch.json", "--expected-revision", "0", "--actor", "creator"], { io: submitted.io });
    expect(JSON.parse(submitted.output().stdout)).toMatchObject({ ok: true, batch: { id: candidateBatchId(batchHash) } });
    const validated = capture();
    await runCli(["--workspace-root", workspace.root, "fact", "validate", "cli-fact", candidateBatchId(batchHash)], { io: validated.io });
    expect(JSON.parse(validated.output().stdout)).toMatchObject({ ok: true, batch: { id: candidateBatchId(batchHash) } });
    await expect(runCli(["--workspace-root", workspace.root, "provenance", "trace", "cli-fact", "missing-fact"], { io: capture().io })).resolves.toBeUndefined();
    await runCli(["--workspace-root", workspace.root, "fact", "conflicts", "cli-fact"], { io: capture().io });
  });

});

function capture() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

describe("CLI", () => {
  it("啟動loopback Dashboard並尊重port與no-open", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
    await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
    const dashboardStarter = vi.fn(() => Promise.resolve({ address: "http://127.0.0.1:4510", url: "http://127.0.0.1:4510/#bootstrap=secret" }));
    const browserOpener = vi.fn();
    const output = capture();

    await runCli(["--workspace-root", workspace.root, "dashboard", "--port", "4510", "--no-open"], {
      io: output.io, dashboardStarter, browserOpener,
    });

    expect(dashboardStarter).toHaveBeenCalledWith({ workspaceRoot: workspace.root, port: 4510, logger: true });
    expect(browserOpener).not.toHaveBeenCalled();
    expect(output.output().stderr).toBe("Dashboard: http://127.0.0.1:4510\n");

    await runCli(["--workspace-root", workspace.root, "dashboard"], {
      io: output.io, dashboardStarter, browserOpener,
    });
    expect(dashboardStarter).toHaveBeenLastCalledWith({ workspaceRoot: workspace.root, logger: true });
    expect(browserOpener).toHaveBeenCalledWith("http://127.0.0.1:4510/#bootstrap=secret");
  });
});


it("covers CLI workspace discovery, dashboard options, parser defaults, and optional source fields", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
  await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");

  await runCli(["init", "cli-discovery", "--title", "Discovered", "--character", "solo"], {
    cwd: workspace.root,
    io: capture().io,
  });
  await runCli(["--workspace-root", workspace.root, "dashboard", "--no-open", "--port", "43123"], {
    dashboardStarter: async (options) => {
       await Promise.resolve();
      expect(options).toMatchObject({ workspaceRoot: workspace.root, port: 43123, logger: true });
      return { address: "127.0.0.1:43123", url: "http://127.0.0.1:43123" };
    },
    browserOpener: () => { throw new Error("browser should not open"); },
    io: capture().io,
  });

  const sourcePath = path.join(workspace.root, "optional-source.md");
  await writeFile(sourcePath, "optional source content", "utf8");
  const added = capture();
  await runCli([
    "--workspace-root", workspace.root, "source", "add", "cli-discovery", sourcePath,
    "--source-id", "optional", "--title", "Optional", "--format", "markdown", "--author", "Author", "--language", "en",
  ], { io: added.io });
  const revision = (JSON.parse(added.output().stdout) as { revision: { id: string } }).revision.id;
  await writeFile(sourcePath, "optional revised content", "utf8");
  await runCli([
    "--workspace-root", workspace.root, "source", "revise", "cli-discovery", "optional", sourcePath,
    "--expected-revision", revision, "--format", "markdown", "--author", "Editor", "--language", "en",
  ], { io: capture().io });

  await writeFile(path.join(workspace.root, "conversation-invalid.json"), "{not-json", "utf8");
  await runCli(["--workspace-root", workspace.root, "simulate", "cli-discovery", "--conversation", "conversation-invalid.json"], { io: capture().io });
  await expect(runCli([
    "--workspace-root", workspace.root, "compile", "cli-discovery", "--no-publish", "--no-png",
    "--v2-backfill", "--preview-id", "cli-preview", "--token-budget", "100",
  ], { io: capture().io })).rejects.toBeDefined();
});


it("covers CLI validation and error branches", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
  await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
  await runCli(["--workspace-root", workspace.root, "init", "cli-errors", "--title", "Errors", "--character", "alice:Alice:palette:supporting"], { io: capture().io });
  await expect(runCli(["--workspace-root", workspace.root, "patch", "cli-errors", "project.yaml", "--patch", "[]", "--expected-revision", "sha256:" + "a".repeat(64)], { io: capture().io })).rejects.toThrow();
  await expect(runCli(["--workspace-root", workspace.root, "patch", "cli-errors", "project.yaml", "--patch", "not-json", "--expected-revision", "sha256:" + "a".repeat(64), "--apply"], { io: capture().io })).rejects.toThrow();
  await expect(runCli(["--workspace-root", workspace.root, "dashboard", "--port", "-1"], { io: capture().io, dashboardStarter: async () => { await Promise.resolve(); return { address: "", url: "" }; } })).rejects.toMatchObject({ code: "CLI_ARGUMENT_INVALID" });
  await expect(runCli(["--workspace-root", workspace.root, "source", "revise", "cli-errors", "missing", path.join(workspace.root, "missing.md"), "--expected-revision", "sha256:" + "a".repeat(64)], { io: capture().io })).rejects.toBeDefined();
  await expect(runCli(["--workspace-root", workspace.root, "fact", "review", "cli-errors", "candidate", "--decision", "invalid", "--decision-id", "d", "--fact-id", "f", "--rationale", "r", "--expected-revision", "sha256:" + "a".repeat(64)], { io: capture().io })).rejects.toMatchObject({ code: "FACT_DECISION_INVALID" });
  await expect(runCli(["--workspace-root", workspace.root, "fact", "resolve", "cli-errors", "conflict", "--decision-file", "{}", "--expected-revision", "sha256:" + "a".repeat(64), "--expected-fact-revisions", "[]"], { io: capture().io })).rejects.toMatchObject({ code: "FACT_REVISION_INVALID" });
  await expect(runCli(["--workspace-root", workspace.root, "compile", "cli-errors"], { io: capture().io })).rejects.toMatchObject({ code: "PUBLISH_PREVIEW_REQUIRED" });
});

it("covers CLI parser failures, publish dispatch, and optional fact inputs", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
  await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
  await runCli(["--workspace-root", workspace.root, "init", "cli-more", "--title", "More"], { io: capture().io });

  await writeFile(path.join(workspace.root, "bad.yaml"), "not: [valid", "utf8");
  await expect(runCli(["--workspace-root", workspace.root, "query", "cli-more", "bad.yaml"], { io: capture().io })).rejects.toBeDefined();
  await expect(runCli(["--workspace-root", workspace.root, "diff", "cli-more", "bad.yaml", "project.yaml"], { io: capture().io })).rejects.toBeDefined();
  await writeFile(path.join(workspace.root, "conversation-object.json"), "{}", "utf8");
  await runCli(["--workspace-root", workspace.root, "simulate", "cli-more", "--conversation", "conversation-object.json"], { io: capture().io });
  await expect(runCli(["--workspace-root", workspace.root, "compile", "cli-more", "--preview-id", "missing-preview"], { io: capture().io })).rejects.toBeDefined();

  await expect(runCli([
    "--workspace-root", workspace.root,
    "fact", "review", "cli-more", "missing-candidate",
    "--decision", "rejected", "--decision-id", "decision-more", "--fact-id", "fact-more",
    "--rationale", "guard", "--expected-revision", `sha256:${"0".repeat(64)}`,
    "--expected-fact-revision", "0", "--patch", "{}",
  ], { io: capture().io })).rejects.toBeDefined();
  await expect(runCli([
    "--workspace-root", workspace.root,
    "fact", "resolve", "cli-more", "missing-conflict",
    "--decision-file", "{}", "--expected-revision", `sha256:${"0".repeat(64)}`,
    "--expected-fact-revisions", "123",
  ], { io: capture().io })).rejects.toMatchObject({ code: "FACT_REVISION_INVALID" });
});
it("covers remaining CLI optional source, planning, and fact argument branches", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const rootManifest = await readFile(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8");
  await writeFile(path.join(workspace.root, "package.json"), rootManifest, "utf8");
  await runCli(["--workspace-root", workspace.root, "init", "cli-optionals", "--title", "Optionals"], { io: capture().io });
  const sourcePath = path.join(workspace.root, "optional.txt");
  await writeFile(sourcePath, "optional source", "utf8");
  await runCli(["--workspace-root", workspace.root, "source", "add", "cli-optionals", sourcePath, "--source-id", "optional", "--title", "Optional"], { io: capture().io });
  await rm(path.join(workspace.projectsRoot, "cli-optionals", "sources", "jobs"), { recursive: true, force: true });
  const status = capture();
  await runCli(["--workspace-root", workspace.root, "source", "status", "cli-optionals", "optional"], { io: status.io });
  expect(JSON.parse(status.output().stdout)).toMatchObject({ jobs: [] });

  await expect(runCli(["--workspace-root", workspace.root, "plan", "missing-plan-project"], { io: capture().io })).rejects.toBeDefined();
  await expect(runCli([
    "--workspace-root", workspace.root, "fact", "review", "cli-optionals", "missing-candidate",
    "--decision", "rejected", "--decision-id", "decision-optional", "--fact-id", "fact-optional",
    "--rationale", "optional", "--expected-revision", `sha256:${"0".repeat(64)}`,
  ], { io: capture().io })).rejects.toBeDefined();
  await expect(runCli([
    "--workspace-root", workspace.root, "fact", "resolve", "cli-optionals", "missing-conflict",
    "--decision-file", "{}", "--expected-revision", `sha256:${"0".repeat(64)}`, "--expected-fact-revisions", "null",
  ], { io: capture().io })).rejects.toMatchObject({ code: "FACT_REVISION_INVALID" });
});