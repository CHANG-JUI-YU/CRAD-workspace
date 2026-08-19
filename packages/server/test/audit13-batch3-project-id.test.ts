import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileAttachmentStore,
  FileProjectRepository,
  resolveProjectDirectory,
} from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { startWorkspaceServer } from "../src/index.js";

async function missing(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch {
    return true;
  }
}

function managerFor(root: string, projectId: string): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    initialProjectId: projectId,
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

describe("Audit 13 BUG13-02 project id filesystem boundary", () => {
  it("rejects traversal, dot segments, Windows separators and portable filename hazards consistently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-project-id-"));
    try {
      const invalid = [
        "",
        "   ",
        ".",
        "..",
        "../outside",
        "..\\outside",
        "nested/project",
        "nested\\project",
        "CON",
        "aux.txt",
        "LPT9",
        "project.",
        "project ",
        "project:name",
      ];
      for (const projectId of invalid) {
        expect(() => new FileProjectRepository(root, projectId, { layout: "project" })).toThrowError(
          expect.objectContaining({ code: "PROJECT_ID_INVALID" }),
        );
        expect(() => new FileAttachmentStore(root, projectId)).toThrowError(
          expect.objectContaining({ code: "PROJECT_ID_INVALID" }),
        );
        expect(() => managerFor(root, projectId)).toThrowError(
          expect.objectContaining({ code: "PROJECT_ID_INVALID" }),
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps valid Unicode and established slug forms inside the project root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-project-id-valid-"));
    try {
      for (const projectId of ["project-001", "alpha-beta", "專案-α"]) {
        const expected = resolveProjectDirectory(root, projectId);
        expect(path.relative(path.resolve(root), expected)).toBe(projectId);
        const repository = new FileProjectRepository(root, projectId, { layout: "project" });
        expect(path.resolve(repository.projectDirectory)).toBe(expected);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe relocation before creating a target path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-project-relocate-"));
    try {
      const repository = new FileProjectRepository(root, "project-001", { layout: "project" });
      await repository.read();
      await expect(repository.relocate("..\\outside")).rejects.toMatchObject({ code: "PROJECT_ID_INVALID" });
      await expect(repository.relocate("CON")).rejects.toMatchObject({ code: "PROJECT_ID_INVALID" });
      expect(await missing(path.join(root, "CON"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects explicit server project traversal before binding or writing outside root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-server-project-id-"));
    const outsideName = `outside-${path.basename(root)}`;
    const outside = path.join(path.dirname(root), outsideName);
    try {
      await expect(startWorkspaceServer({
        projectRoot: root,
        projectId: `../${outsideName}`,
        runtimeRevision: "audit13",
        port: 0,
      })).rejects.toMatchObject({ code: "PROJECT_ID_INVALID" });
      expect(await missing(outside)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects ST_WORKSPACE_PROJECT traversal with the same stable error and no outside write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-server-env-project-id-"));
    const outsideName = `env-outside-${path.basename(root)}`;
    const outside = path.join(path.dirname(root), outsideName);
    const previousRoot = process.env.ST_WORKSPACE_PROJECT_ROOT;
    const previousProject = process.env.ST_WORKSPACE_PROJECT;
    process.env.ST_WORKSPACE_PROJECT_ROOT = root;
    process.env.ST_WORKSPACE_PROJECT = `../${outsideName}`;
    try {
      await expect(startWorkspaceServer({ runtimeRevision: "audit13", port: 0 })).rejects.toMatchObject({
        code: "PROJECT_ID_INVALID",
      });
      expect(await missing(outside)).toBe(true);
    } finally {
      if (previousRoot === undefined) delete process.env.ST_WORKSPACE_PROJECT_ROOT;
      else process.env.ST_WORKSPACE_PROJECT_ROOT = previousRoot;
      if (previousProject === undefined) delete process.env.ST_WORKSPACE_PROJECT;
      else process.env.ST_WORKSPACE_PROJECT = previousProject;
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
