import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { resolveWorkspaceRoot } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

describe("resolveWorkspaceRoot", () => {
  it("優先採用有效 CARD_WORKSPACE_ROOT", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "package.json"), '{"name":"card-workspace"}\n', "utf8");
    expect(
      await resolveWorkspaceRoot({
        environment: { CARD_WORKSPACE_ROOT: workspace.root },
        start: "C:\\definitely-wrong",
      }),
    ).toBe(workspace.root);
  });

  it("設定無效環境根目錄時 fail fast，不退回 cwd", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await expect(
      resolveWorkspaceRoot({ environment: { CARD_WORKSPACE_ROOT: workspace.root } }),
    ).rejects.toMatchObject({ code: "WORKSPACE_ROOT_INVALID" });
  });

  it("未設定環境變數時由 marker 向上尋找", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await writeFile(path.join(workspace.root, "package.json"), '{"name":"card-workspace"}\n', "utf8");
    const nested = path.join(workspace.root, "deep", "child");
    await mkdir(nested, { recursive: true });
    expect(await resolveWorkspaceRoot({ environment: {}, start: nested })).toBe(workspace.root);
  });
});
