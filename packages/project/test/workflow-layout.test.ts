import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { projectManifestSchema } from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertWorkflowProjectPath,
  classifyWorkflowProjectPath,
  initializeProject,
  scanStructuredFiles,
  validateProject,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function manifest(id = "workflow-layout") {
  return projectManifestSchema.parse({
    schema_version: 1,
    id,
    title: "Workflow layout",
    kind: "character_card",
    card: { name: "Layout" },
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
  });
}

describe("workflow layout", () => {
  it("初始化在單一 project transaction 建立 v2、Blueprint 與 logical journal", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });

    expect(JSON.parse(await readFile(path.join(root, "workflow.json"), "utf8"))).toMatchObject({
      schema_version: 2,
      workflow_definition_id: "original-v1",
      entry_kind: "original",
      stage: "intake",
    });
    expect(await readFile(path.join(root, "blueprint.yaml"), "utf8")).toContain("project_id: workflow-layout");
    await expect(readFile(path.join(root, ".workflow", "journal.jsonl"), "utf8")).resolves.toBe("");
    await expect(validateProject(workspace.projectsRoot, "workflow-layout")).resolves.toMatchObject({ ok: true });
  });

  it("分類器只接受固定 workflow artifacts", () => {
    expect(classifyWorkflowProjectPath(".workflow/journal.jsonl")?.kind).toBe("journal");
    expect(classifyWorkflowProjectPath(".workflow/results/task-1/revision-1.json")?.kind).toBe("result");
    expect(classifyWorkflowProjectPath(".workflow/reviews/task-1/review-1.json")?.kind).toBe("review");
    expect(classifyWorkflowProjectPath(".workflow/previews/preview-1.json")?.kind).toBe("preview");
    expect(classifyWorkflowProjectPath(".workflow/decisions/decision-1.json")?.kind).toBe("decision");
    for (const denied of [
      ".workflow/other.json",
      ".workflow/results/task-1/../escape.json",
      ".workflow/results/task-1/arbitrary.yaml",
      ".workflow/hidden/value.json",
    ]) {
      expect(() => assertWorkflowProjectPath(denied)).toThrow(/受控 artifacts/u);
    }
  });

  it("作者結構化掃描排除 .workflow", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await mkdir(path.join(workspace.root, ".workflow", "results", "task-1"), { recursive: true });
    await writeFile(path.join(workspace.root, ".workflow", "results", "task-1", "bad.json"), "{bad", "utf8");
    await writeFile(path.join(workspace.root, "author.yaml"), "ok: true\n", "utf8");
    const scan = await scanStructuredFiles(workspace.root);
    expect(scan.files.map((file) => path.basename(file.filePath))).toEqual(["author.yaml"]);
    expect(scan.diagnostics).toEqual([]);
  });

  it("精確根檔驗證拒絕 Blueprint link 並聚合其他診斷", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest("linked-layout") });
    const outside = path.join(workspace.root, "outside-blueprint.yaml");
    const blueprintPath = path.join(root, "blueprint.yaml");
    const blueprint = await readFile(blueprintPath);
    await writeFile(outside, "bad: true\n", "utf8");
    await (await import("node:fs/promises")).rm(blueprintPath);
    let linked = true;
    try {
      await symlink(outside, blueprintPath, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      linked = false;
      await writeFile(blueprintPath, blueprint);
    }
    await writeFile(path.join(root, ".workflow", "journal.jsonl"), "not-json\n", "utf8");
    const result = await validateProject(workspace.projectsRoot, "linked-layout");
    const expected = ["WORKFLOW_JOURNAL_JSONL_INVALID"];
    if (linked) expected.push("PROJECT_PATH_LINK_DENIED");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(expected));
  });
});
