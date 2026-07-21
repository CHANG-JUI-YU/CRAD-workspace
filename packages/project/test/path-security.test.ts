import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeSegment,
  ProjectError,
  resolveCreatableWithin,
  resolveExistingWithin,
  resolveProjectDirectory,
  resolveWithin,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("resolveWithin", () => {
  it.each([
    "../escape.yaml",
    "..\\escape.yaml",
    "C:\\escape.yaml",
    "C:drive-relative.yaml",
    "file.yaml:stream",
    "\\\\server\\share\\file.yaml",
  ])(
    "拒絕越界路徑 %s",
    async (candidate) => {
      const workspace = await makeTemporaryWorkspace();
      cleanups.push(workspace.cleanup);
      await expect(resolveWithin(workspace.root, candidate)).rejects.toBeInstanceOf(ProjectError);
    },
  );

  it("允許根目錄內的巢狀新檔案", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const result = await resolveWithin(workspace.root, "projects/demo/project.yaml");
    expect(result).toBe(path.join(workspace.root, "projects", "demo", "project.yaml"));
  });

  it("拒絕 junction 或 symlink 指向根目錄外", async () => {
    const workspace = await makeTemporaryWorkspace();
    const outside = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup, outside.cleanup);
    await writeFile(path.join(outside.root, "secret.yaml"), "secret: true\n", "utf8");
    const link = path.join(workspace.root, "linked");
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(outside.root, link, process.platform === "win32" ? "junction" : "dir");
    await expect(resolveWithin(workspace.root, "linked/secret.yaml")).rejects.toMatchObject({
      code: "PATH_SYMLINK_ESCAPE",
    });
  });

  it("提供安全 segment、既有路徑與可建立副檔名 helper", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const filePath = path.join(workspace.root, "exists.yaml");
    await writeFile(filePath, "ok: true\n", "utf8");
    expect(assertSafeSegment("safe-id")).toBe("safe-id");
    expect(() => assertSafeSegment("../bad")).toThrow(/無效/u);
    await expect(resolveExistingWithin(workspace.root, "exists.yaml")).resolves.toBe(filePath);
    await expect(resolveExistingWithin(workspace.root, "missing.yaml")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      resolveCreatableWithin(workspace.root, "new.yaml", [".yaml"]),
    ).resolves.toBe(path.join(workspace.root, "new.yaml"));
    await expect(resolveCreatableWithin(workspace.root, "new.exe", [".yaml"])).rejects.toMatchObject({
      code: "PATH_EXTENSION_DENIED",
    });
  });

  it("驗證專案 ID", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await expect(resolveProjectDirectory(workspace.projectsRoot, "demo")).resolves.toBe(
      path.join(workspace.projectsRoot, "demo"),
    );
    await expect(resolveProjectDirectory(workspace.projectsRoot, "Bad ID")).rejects.toMatchObject({
      code: "PROJECT_ID_INVALID",
    });
  });

  it("受控 export 路徑不能經專案 ID 或 symlink 逃逸", async () => {
    const workspace = await makeTemporaryWorkspace();
    const outside = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup, outside.cleanup);
    expect(() => assertSafeSegment("../outside")).toThrow(/無效/u);
    await mkdir(path.join(workspace.root, "exports"), { recursive: true });
    await symlink(outside.root, path.join(workspace.root, "exports", "demo"), process.platform === "win32" ? "junction" : "dir");
    await expect(resolveWithin(workspace.root, "exports/demo/card.json")).rejects.toMatchObject({ code: "PATH_SYMLINK_ESCAPE" });
  });
});
