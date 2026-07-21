import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { projectManifestSchema } from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  computeTextRevision,
  initializeProject,
  migrateWorkflowProjectV1ToV2,
  patchProjectFile,
  validateProject,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function manifest() {
  return projectManifestSchema.parse({
    schema_version: 1,
    id: "migration-demo",
    title: "Migration",
    kind: "character_card",
    card: { name: "Migration" },
    characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
  });
}

const legacy = {
  schema_version: 1,
  project_id: "migration-demo",
  stage: "blueprint",
  revision: 3,
  artifacts: {},
  gates: {},
  metadata: { legacy: true },
};

describe("workflow project migration", () => {
  it("v1 load 僅回報 migration required，不改寫 bytes", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const workflowPath = path.join(root, "workflow.json");
    const bytes = canonicalJson(legacy);
    await writeFile(workflowPath, bytes, "utf8");
    await rm(path.join(root, "blueprint.yaml"));
    await rm(path.join(root, ".workflow"), { recursive: true });
    const result = await validateProject(workspace.projectsRoot, "migration-demo");
    expect(result.workflow).toBeUndefined();
    expect(result.diagnostics.map((item) => item.code)).toContain("WORKFLOW_MIGRATION_REQUIRED");
    expect(result.diagnostics).toHaveLength(1);
    await expect(readFile(workflowPath, "utf8")).resolves.toBe(bytes);
  });

  it("顯式 migration 以 raw CAS 同交易寫 projection、event 與備份引用", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const workflowPath = path.join(root, "workflow.json");
    const bytes = canonicalJson(legacy);
    await writeFile(workflowPath, bytes, "utf8");
    const expectedRawRevision = computeTextRevision(bytes);
    const migrated = await migrateWorkflowProjectV1ToV2({ projectRoot: root, expectedRawRevision });
    expect(migrated.workflow).toMatchObject({ schema_version: 2, stage: "blueprint", revision: 3 });
    const event = JSON.parse((await readFile(path.join(root, ".workflow", "journal.jsonl"), "utf8")).trim()) as unknown;
    expect(event).toMatchObject({ kind: "workflow_migrated", payload: { backup: { path: migrated.backupPath } } });
    const backup = JSON.parse(await readFile(path.join(root, ...migrated.backupPath.split("/")), "utf8")) as { source_raw?: unknown };
    expect(backup.source_raw).toBe(bytes);
    await expect(validateProject(workspace.projectsRoot, "migration-demo")).resolves.toMatchObject({ ok: true });
  });

  it("stale raw CAS 不留下部分 migration artifacts", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    await writeFile(path.join(root, "workflow.json"), canonicalJson(legacy), "utf8");
    await expect(migrateWorkflowProjectV1ToV2({
      projectRoot: root,
      expectedRawRevision: `sha256:${"0".repeat(64)}`,
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(readFile(path.join(root, ".workflow", "journal.jsonl"), "utf8")).resolves.toBe("");
  });

  it("一般 RFC 6902 patch 不可修改 .workflow artifacts", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    await expect(patchProjectFile({
      projectRoot: root,
      relativePath: ".workflow/previews/preview-1.json",
      operations: [],
      expectedRevision: `sha256:${"0".repeat(64)}`,
    })).rejects.toMatchObject({ code: "DOCUMENT_TARGET_DENIED" });
  });

  it("migration 拒絕 .workflow junction 或 symlink", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const root = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const bytes = canonicalJson(legacy);
    await writeFile(path.join(root, "workflow.json"), bytes, "utf8");
    await rm(path.join(root, ".workflow"), { recursive: true });
    const linked = path.join(root, "linked-workflow");
    await mkdir(linked);
    await symlink(linked, path.join(root, ".workflow"), process.platform === "win32" ? "junction" : "dir");
    await expect(migrateWorkflowProjectV1ToV2({
      projectRoot: root,
      expectedRawRevision: computeTextRevision(bytes),
    })).rejects.toMatchObject({ code: "PROJECT_PATH_LINK_DENIED" });
  });
});
