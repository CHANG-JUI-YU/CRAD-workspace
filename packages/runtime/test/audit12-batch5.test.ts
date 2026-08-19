import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJECT_RELOCATION_INTENT_PATH } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "../src/index.js";
import { RecoverableProjectRepository } from "../src/project-relocation.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function missing(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function manager(root: string): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

async function crashAfterRelocate(root: string, target = "Recovered-Project"): Promise<void> {
  const initial = new RecoverableProjectRepository(root, "project-001", { layout: "project", materialize: true });
  const state = await initial.read();
  const crashing = new RecoverableProjectRepository(root, "project-001", {
    layout: "project",
    materialize: true,
    failure_injection: { point: "after_relocate", mode: "crash" },
  });

  await expect(crashing.relocateAndCommitIdentity(target, state.revision, {
    project_name: "Recovered Project",
    project_status: "ready",
  })).rejects.toThrow("Injected repository crash at after_relocate");
}

describe("Audit 12 RISK12-01 recoverable project finalization", () => {
  it("recovers metadata deterministically after relocation succeeds but before metadata commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-risk12-relocation-"));
    roots.push(root);
    await crashAfterRelocate(root);

    expect(await missing(path.join(root, "project-001"))).toBe(true);
    const target = path.join(root, "Recovered-Project");
    const preRecovery = JSON.parse(await readFile(path.join(target, ".workspace", "state.json"), "utf8")) as { project_id: string; revision: number };
    expect(preRecovery).toMatchObject({ project_id: "project-001", revision: 0 });
    expect(await missing(path.join(target, PROJECT_RELOCATION_INTENT_PATH))).toBe(false);

    const recoveredRepository = new RecoverableProjectRepository(root, "Recovered-Project", { layout: "project", materialize: true });
    const recovered = await recoveredRepository.read();
    expect(recovered).toMatchObject({
      project_id: "Recovered-Project",
      project_slug: "Recovered-Project",
      project_name: "Recovered Project",
      project_status: "ready",
      revision: 1,
    });
    expect(path.basename(recoveredRepository.projectDirectory)).toBe(recovered.project_id);
    expect(await missing(path.join(target, PROJECT_RELOCATION_INTENT_PATH))).toBe(true);
    await expect(readFile(path.join(target, "project.json"), "utf8")).resolves.toContain('"project_id":"Recovered-Project"');

    const restarted = new RecoverableProjectRepository(root, "Recovered-Project", { layout: "project", materialize: true });
    await expect(restarted.read()).resolves.toMatchObject({ project_id: "Recovered-Project", revision: 1 });
  });

  it("recovers a pending relocation while listing projects after restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-risk12-list-"));
    roots.push(root);
    await crashAfterRelocate(root, "Listed-Project");

    const projects = manager(root);
    const listed = await projects.listProjects();
    expect(listed).toContainEqual(expect.objectContaining({
      project_id: "Listed-Project",
      project_name: "Recovered Project",
      status: "ready",
      path: path.join(root, "Listed-Project"),
      revision: 1,
    }));
    expect(await missing(path.join(root, "project-001"))).toBe(true);
    expect(await missing(path.join(root, "Listed-Project", PROJECT_RELOCATION_INTENT_PATH))).toBe(true);
  });

  it("keeps directory id, project id and slug aligned during normal finalization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-risk12-normal-"));
    roots.push(root);
    const projects = manager(root);

    const result = await projects.finalizeIfNamed({
      operation_id: "done",
      status: "completed",
      summary: "done",
      completed: [],
      blocked: [],
      project_name: "Stable Project",
    });
    const state = await projects.repository.read();

    expect(result.project_id).toBe("Stable-Project");
    expect(path.basename(result.project_path ?? "")).toBe("Stable-Project");
    expect(state).toMatchObject({
      project_id: "Stable-Project",
      project_slug: "Stable-Project",
      project_name: "Stable Project",
      project_status: "ready",
    });
    expect(await missing(path.join(root, "Stable-Project", PROJECT_RELOCATION_INTENT_PATH))).toBe(true);
  });
});
