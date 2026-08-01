/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
  it("apply ??鈭斗??湔雿???workflow revision", async () => {
    const { projectRoot, revision } = await setup();
    const result = await patchProjectFile({
      projectRoot,
      relativePath: "project.yaml",
      operations: [{ op: "replace", path: "/title", value: "Edited" }],
      expectedRevision: revision,
    });
    expect(result.affectedFiles).toEqual(["project.yaml", "workflow.json"]);
    expect(result.workflowRevision).toBe(1);
    expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toContain("Edited");
    expect(JSON.parse(await readFile(path.join(projectRoot, "workflow.json"), "utf8"))).toMatchObject({
      revision: 1,
    });
  });

  it("schema invalid patch does not write files", async () => {
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

  it("no-op 銝遣蝡漱??銝???workflow revision", async () => {
    const { projectRoot, revision } = await setup();
    const current = await parseStructuredFile(path.join(projectRoot, "project.yaml"));
    const currentTitle = (current.data as { title: string }).title;
    const result = await patchProjectFile({
      projectRoot,
      relativePath: "project.yaml",
      operations: [{ op: "replace", path: "/title", value: currentTitle }],
      expectedRevision: revision,
    });
    expect(result.noOp).toBe(true);
    expect(result.affectedFiles).toEqual([]);
    expect(JSON.parse(await readFile(path.join(projectRoot, "workflow.json"), "utf8"))).toMatchObject({
      revision: 0,
    });
  });

  it("??靽格銵??甇詨惇頝臬?", async () => {
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

  it("internal ingestion assertion ???蝣?artifacts?rojections ??journals", () => {
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
    expect(() => assertIngestionProjectPath("project.yaml")).toThrowError();
    expect(() => assertIngestionProjectPath("sources/snapshots/../manifest.yaml")).toThrowError();
    expect(() => assertIngestionProjectPath(".build/provenance-index.json")).toThrowError();
  });

  it("??靽格 immutable project metadata", async () => {
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

  it("covers workflow, author-module, dry-run, and JSON patch branches", async () => {
    const { projectRoot } = await setup();
    const workflowPath = path.join(projectRoot, "workflow.json");
    const workflowParsed = await parseStructuredFile(workflowPath);
    if (workflowParsed.data === undefined) throw new Error("workflow parse failed");
    const workflowRevision = computeRevision(workflowParsed.data);
    const workflowDryRun = await patchProjectFile({
      projectRoot,
      relativePath: "workflow.json",
      operations: [{ op: "replace", path: "/stage", value: "blueprint" }],
      expectedRevision: workflowRevision,
      dryRun: true,
    });
    expect(workflowDryRun.dryRun).toBe(true);
    expect(workflowDryRun.affectedFiles).toEqual(["workflow.json"]);
    expect(JSON.parse(await readFile(workflowPath, "utf8")).revision).toBe(0);

    const modulePath = "blueprint.yaml";
    const moduleParsed = await parseStructuredFile(path.join(projectRoot, modulePath));
    if (moduleParsed.data === undefined) throw new Error("module parse failed");
    const moduleRevision = computeRevision(moduleParsed.data);
    const moduleDryRun = await patchProjectFile({
      projectRoot,
      relativePath: modulePath,
      operations: [{ op: "replace", path: "/purpose", value: "Updated purpose" }],
      expectedRevision: moduleRevision,
      dryRun: true,
    });
    expect(moduleDryRun.rebuildScopes).toEqual(["author-model"]);
    expect(moduleDryRun.content).toContain("Updated purpose");
  });
});
