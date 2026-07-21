import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { copyFixtureProject, makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadProject,
  parseStructuredFile,
  readStructuredData,
  scanStructuredFiles,
  validateProject,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("parseStructuredFile", () => {
  it("回報 YAML 精確行列", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await copyFixtureProject("invalid-project", workspace.projectsRoot);
    const result = await parseStructuredFile(path.join(projectRoot, "broken.yaml"));
    expect(result.diagnostics[0]).toMatchObject({ code: "YAML_PARSE_ERROR" });
    expect(result.diagnostics[0]?.location?.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.location?.column).toBeGreaterThan(0);
  });

  it("解析 JSON 並回報 JSON 錯誤位置", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const validPath = path.join(workspace.root, "valid.json");
    const invalidPath = path.join(workspace.root, "invalid.json");
    await writeFile(validPath, '{"ok":true}\n', "utf8");
    await writeFile(invalidPath, '{"ok": true,}\n', "utf8");
    await expect(readStructuredData(validPath)).resolves.toEqual({ ok: true });
    const invalid = await parseStructuredFile(invalidPath, { displayPath: "invalid.json" });
    expect(invalid.diagnostics[0]).toMatchObject({
      code: "JSON_PARSE_ERROR",
      location: { file: "invalid.json", line: 1 },
    });
    await expect(readStructuredData(invalidPath)).rejects.toThrow();
  });

  it("拒絕副檔名、過大檔案與非 UTF-8", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const textPath = path.join(workspace.root, "data.txt");
    const largePath = path.join(workspace.root, "large.yaml");
    const binaryPath = path.join(workspace.root, "binary.yaml");
    await writeFile(textPath, "text", "utf8");
    await writeFile(largePath, "value: 123\n", "utf8");
    await writeFile(binaryPath, Buffer.from([0xff, 0xfe]));
    await expect(parseStructuredFile(textPath)).resolves.toMatchObject({
      diagnostics: [{ code: "FILE_EXTENSION_DENIED" }],
    });
    await expect(parseStructuredFile(largePath, { maxBytes: 2 })).resolves.toMatchObject({
      diagnostics: [{ code: "FILE_TOO_LARGE" }],
    });
    await expect(parseStructuredFile(binaryPath)).resolves.toMatchObject({
      diagnostics: [{ code: "FILE_ENCODING_INVALID" }],
    });
  });

  it("深層 YAML 不會造成未處理的 stack overflow", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const filePath = path.join(workspace.root, "deep.yaml");
    await writeFile(filePath, `${"[".repeat(5_000)}1${"]".repeat(5_000)}`, "utf8");
    const parsed = await parseStructuredFile(filePath);
    expect(parsed.diagnostics[0]).toMatchObject({ code: "YAML_PARSE_ERROR" });
  });

  it("遞迴掃描時排序並排除衍生目錄", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await mkdir(path.join(workspace.root, "nested"), { recursive: true });
    await mkdir(path.join(workspace.root, ".build"), { recursive: true });
    await writeFile(path.join(workspace.root, "z.yaml"), "z: true\n", "utf8");
    await writeFile(path.join(workspace.root, "nested", "a.json"), "{}\n", "utf8");
    await writeFile(path.join(workspace.root, ".build", "ignored.yaml"), "bad: [\n", "utf8");
    const result = await scanStructuredFiles(workspace.root);
    expect(result.files.map((file) => path.relative(workspace.root, file.filePath))).toEqual([
      path.join("nested", "a.json"),
      "z.yaml",
    ]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("validateProject", () => {
  it("載入合法 manifest 與 workflow", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await copyFixtureProject("valid-project", workspace.projectsRoot);
    const result = await validateProject(workspace.projectsRoot, "valid-project");
    expect(result.ok).toBe(true);
    expect(result.manifest?.characters).toHaveLength(2);
  });

  it("一次聚合語法、schema 與缺檔錯誤", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await copyFixtureProject("invalid-project", workspace.projectsRoot);
    const result = await validateProject(workspace.projectsRoot, "invalid-project");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "YAML_PARSE_ERROR",
        "PROJECT_MANIFEST_INVALID",
        "WORKFLOW_STATE_MISSING",
      ]),
    );
  });

  it("偵測 manifest 缺失與專案 ID 不一致", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const missingRoot = path.join(workspace.projectsRoot, "missing");
    await mkdir(missingRoot, { recursive: true });
    await writeFile(
      path.join(missingRoot, "workflow.json"),
      JSON.stringify({ schema_version: 1, project_id: "missing", revision: 0, stage: "intake", artifacts: [], gates: [] }),
      "utf8",
    );
    const missing = await validateProject(workspace.projectsRoot, "missing");
    expect(missing.diagnostics.map((item) => item.code)).toContain("PROJECT_MANIFEST_MISSING");

    const projectRoot = await copyFixtureProject("valid-project", workspace.projectsRoot);
    const workflowPath = path.join(projectRoot, "workflow.json");
    const workflow = (await readStructuredData(workflowPath)) as Record<string, unknown>;
    workflow.project_id = "different";
    await writeFile(workflowPath, JSON.stringify(workflow), "utf8");
    const mismatch = await validateProject(workspace.projectsRoot, "valid-project");
    expect(mismatch.diagnostics.map((item) => item.code)).toContain("PROJECT_ID_MISMATCH");
  });

  it("loadProject 成功載入並在無效專案失敗", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await copyFixtureProject("valid-project", workspace.projectsRoot);
    await copyFixtureProject("invalid-project", workspace.projectsRoot);
    await expect(loadProject(workspace.projectsRoot, "valid-project")).resolves.toMatchObject({
      manifest: { id: "valid-project" },
    });
    await expect(loadProject(workspace.projectsRoot, "invalid-project")).rejects.toThrow(/專案驗證失敗/u);
  });
});
