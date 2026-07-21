import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { workflowStateSchema } from "@card-workspace/schemas";
import { commitWorkflowMutation } from "@card-workspace/workflow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  process.exitCode = undefined;
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
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
});
