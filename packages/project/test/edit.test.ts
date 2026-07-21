import { readFile } from "node:fs/promises";
import path from "node:path";

import { copyFixtureProject, makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertIngestionProjectPath,
  computeRevision,
  parseStructuredFile,
  patchProjectFile,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function setup() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await copyFixtureProject("valid-project", workspace.projectsRoot);
  const parsed = await parseStructuredFile(path.join(projectRoot, "project.yaml"));
  if (parsed.data === undefined) throw new Error("fixture parse failed");
  return { workspace, projectRoot, revision: computeRevision(parsed.data) };
}

describe("patchProjectFile", () => {
  it("apply 同一交易更新作者檔與 workflow revision", async () => {
    const { projectRoot, revision } = await setup();
    const result = await patchProjectFile({
      projectRoot,
      relativePath: "project.yaml",
      operations: [{ op: "replace", path: "/title", value: "修改後" }],
      expectedRevision: revision,
    });
    expect(result.affectedFiles).toEqual(["project.yaml", "workflow.json"]);
    expect(result.workflowRevision).toBe(1);
    expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toContain("修改後");
    expect(JSON.parse(await readFile(path.join(projectRoot, "workflow.json"), "utf8"))).toMatchObject({
      revision: 1,
    });
  });

  it("schema invalid patch 不寫入任何檔案", async () => {
    const { projectRoot, revision } = await setup();
    const beforeProject = await readFile(path.join(projectRoot, "project.yaml"), "utf8");
    const beforeWorkflow = await readFile(path.join(projectRoot, "workflow.json"), "utf8");
    await expect(
      patchProjectFile({
        projectRoot,
        relativePath: "project.yaml",
        operations: [{ op: "remove", path: "/title" }],
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ code: "PATCH_SCHEMA_INVALID" });
    await expect(readFile(path.join(projectRoot, "project.yaml"), "utf8")).resolves.toBe(beforeProject);
    await expect(readFile(path.join(projectRoot, "workflow.json"), "utf8")).resolves.toBe(beforeWorkflow);
  });

  it("no-op 不建立交易也不增加 workflow revision", async () => {
    const { projectRoot, revision } = await setup();
    const result = await patchProjectFile({
      projectRoot,
      relativePath: "project.yaml",
      operations: [{ op: "replace", path: "/title", value: "有效測試專案" }],
      expectedRevision: revision,
    });
    expect(result.noOp).toBe(true);
    expect(result.affectedFiles).toEqual([]);
    expect(JSON.parse(await readFile(path.join(projectRoot, "workflow.json"), "utf8"))).toMatchObject({
      revision: 0,
    });
  });

  it("拒絕修改衍生或未歸屬路徑", async () => {
    const { projectRoot, revision } = await setup();
    await expect(
      patchProjectFile({
        projectRoot,
        relativePath: ".build/output.json",
        operations: [],
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_TARGET_DENIED" });
    for (const relativePath of [
      "sources/snapshots/novel/revision.txt",
      "sources/journals/source-events.jsonl",
      "facts/decisions.jsonl",
      "facts/candidates/batch-1.json",
    ]) {
      await expect(
        patchProjectFile({ projectRoot, relativePath, operations: [], expectedRevision: revision }),
      ).rejects.toMatchObject({ code: "DOCUMENT_TARGET_DENIED" });
    }
  });

  it("internal ingestion assertion 僅接受明確 artifacts、projections 與 journals", () => {
    expect(assertIngestionProjectPath("sources/snapshots/novel/revision.txt").kind).toBe("snapshot");
    expect(assertIngestionProjectPath("sources/revisions/novel/revision.json").kind).toBe("source_revision");
    expect(assertIngestionProjectPath("sources/projections/novel/revision.json").kind).toBe("text_projection");
    expect(assertIngestionProjectPath("sources/chunks/novel/revision/set-1/manifest.json").kind).toBe("chunk_set");
    expect(assertIngestionProjectPath("sources/chunks/novel/revision/set-1/chunk-1.json").kind).toBe("chunk");
    expect(assertIngestionProjectPath("facts/candidates/batch-1.json").kind).toBe("candidate_batch");
    expect(assertIngestionProjectPath("sources/jobs/job-1.json").kind).toBe("job");
    expect(assertIngestionProjectPath("sources/journals/source-events.jsonl").kind).toBe("source_journal");
    expect(assertIngestionProjectPath("sources/research/research-batch-a/current.json").kind).toBe("research_batch");
    expect(assertIngestionProjectPath("sources/research/research-batch-a/abc123.json").kind).toBe("research_batch");
    expect(assertIngestionProjectPath("facts/decisions.jsonl").kind).toBe("decision_journal");
    expect(() => assertIngestionProjectPath("project.yaml")).toThrowError("ingestion 僅允許存取受控 Sources/Facts 路徑");
    expect(() => assertIngestionProjectPath("sources/snapshots/../manifest.yaml")).toThrowError("ingestion 僅允許存取受控 Sources/Facts 路徑");
    expect(() => assertIngestionProjectPath(".build/provenance-index.json")).toThrowError("ingestion 僅允許存取受控 Sources/Facts 路徑");
  });

  it("拒絕修改 immutable project metadata", async () => {
    const { projectRoot, revision } = await setup();
    await expect(
      patchProjectFile({
        projectRoot,
        relativePath: "project.yaml",
        operations: [{ op: "replace", path: "/id", value: "renamed" }],
        expectedRevision: revision,
      }),
    ).rejects.toMatchObject({ code: "PATCH_PATH_DENIED" });
  });
});
