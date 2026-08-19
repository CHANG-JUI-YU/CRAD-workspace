import { describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import * as runtimeEntry from "../src/index.js";
import * as runtimeImplementation from "../src/workspace-runtime.js";

describe("Audit 11 #156 runtime entrypoint decomposition", () => {
  it("preserves the public export surface through the package barrel", () => {
    expect(Object.keys(runtimeEntry).sort()).toEqual(Object.keys(runtimeImplementation).sort());
    expect(runtimeEntry.WorkspaceRuntime).toBe(runtimeImplementation.WorkspaceRuntime);
    expect(runtimeEntry.WorkspaceWorker).toBe(runtimeImplementation.WorkspaceWorker);
    expect(runtimeEntry.WorkspaceProjectManager).toBe(runtimeImplementation.WorkspaceProjectManager);
  });

  it("keeps WorkspaceRuntime behavior available through the package entrypoint", async () => {
    const runtime = new runtimeEntry.WorkspaceRuntime(new MemoryProjectRepository("audit11-runtime-entrypoint"));
    await expect(runtime.recoverableOperations()).resolves.toEqual([]);
  });
});
