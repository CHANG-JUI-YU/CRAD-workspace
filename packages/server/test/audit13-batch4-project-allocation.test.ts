import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FileProjectRepository } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { startWorkspaceServer, type WorkspaceServer } from "../src/index.js";

function managerFor(root: string): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function closeServer(server: WorkspaceServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

async function serverBase(server: WorkspaceServer): Promise<string> {
  await server.workspaceWorker.stop();
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function createProjectThroughServer(base: string): Promise<{ project_id: string }> {
  const response = await fetch(`${base}/workspace/project/new`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`project/new failed with ${response.status}: ${await response.text()}`);
  return await response.json() as { project_id: string };
}

async function runServerAllocatorChild(root: string): Promise<{ project_id: string }> {
  const serverModule = pathToFileURL(path.resolve("packages/server/dist/index.js")).href;
  const script = `
    const { startWorkspaceServer } = await import(${JSON.stringify(serverModule)});
    const root = process.argv[1];
    const server = await startWorkspaceServer({ port: 0, projectRoot: root, runtimeRevision: "audit13-child" });
    if (server.workspaceWorker) await server.workspaceWorker.stop();
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const response = await fetch("http://127.0.0.1:" + address.port + "/workspace/project/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("project/new failed: " + response.status + " " + await response.text());
    const payload = await response.json();
    console.log(JSON.stringify({ project_id: payload.project_id }));
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  `;

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, root], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`child allocator exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
        if (line === undefined) throw new Error(`child allocator produced no output: ${stderr}`);
        resolve(JSON.parse(line) as { project_id: string });
      } catch (error) {
        reject(error);
      }
    });
  });
}

describe("Audit 13 BUG13-03 atomic project allocation", () => {
  it("allocates unique directories to independent managers under repeated contention", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-manager-allocation-"));
    try {
      for (let round = 0; round < 5; round += 1) {
        const roundRoot = path.join(root, `round-${round}`);
        const first = managerFor(roundRoot);
        const second = managerFor(roundRoot);
        await Promise.all([first.ensureRuntime(), second.ensureRuntime()]);
        expect(new Set([first.repository.projectId, second.repository.projectId])).toEqual(
          new Set(["project-001", "project-002"]),
        );
        expect((await readdir(roundRoot)).sort()).toEqual(["project-001", "project-002"]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the same allocator for fresh-session and explicit new-project paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-shared-allocation-"));
    try {
      const manager = managerFor(root);
      await manager.ensureRuntime();
      expect(manager.repository.projectId).toBe("project-001");
      await manager.startNewProject();
      expect(manager.repository.projectId).toBe("project-002");
      expect((await readdir(root)).sort()).toEqual(["project-001", "project-002"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats normal, empty, corrupt and interrupted directories as owned and fills only a real gap", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-allocation-recovery-"));
    try {
      const existing = new FileProjectRepository(root, "project-001", { layout: "project" });
      await existing.read();
      await mkdir(path.join(root, "project-002"));
      await mkdir(path.join(root, "project-004", ".workspace"), { recursive: true });
      const corruptState = "{ definitely-not-json\n";
      await writeFile(path.join(root, "project-004", ".workspace", "state.json"), corruptState, "utf8");

      const manager = managerFor(root);
      await manager.ensureRuntime();
      expect(manager.repository.projectId).toBe("project-003");
      expect(await pathExists(path.join(root, "project-002", ".workspace", "state.json"))).toBe(false);
      expect(await readFile(path.join(root, "project-004", ".workspace", "state.json"), "utf8")).toBe(corruptState);

      await manager.startNewProject();
      expect(manager.repository.projectId).toBe("project-005");
      expect((await readdir(root)).sort()).toEqual([
        "project-001",
        "project-002",
        "project-003",
        "project-004",
        "project-005",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allocates distinct projects through two independent server instances", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-server-allocation-"));
    const first = await startWorkspaceServer({ port: 0, projectRoot: root, runtimeRevision: "audit13" }) as WorkspaceServer;
    const second = await startWorkspaceServer({ port: 0, projectRoot: root, runtimeRevision: "audit13" }) as WorkspaceServer;
    try {
      const [firstBase, secondBase] = await Promise.all([serverBase(first), serverBase(second)]);
      const [a, b] = await Promise.all([
        createProjectThroughServer(firstBase),
        createProjectThroughServer(secondBase),
      ]);
      expect(new Set([a.project_id, b.project_id])).toEqual(new Set(["project-001", "project-002"]));
      expect((await readdir(root)).sort()).toEqual(["project-001", "project-002"]);
    } finally {
      await Promise.all([closeServer(first), closeServer(second)]);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps allocation atomic across separate server processes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "audit13-process-allocation-"));
    try {
      const [a, b] = await Promise.all([
        runServerAllocatorChild(root),
        runServerAllocatorChild(root),
      ]);
      expect(new Set([a.project_id, b.project_id])).toEqual(new Set(["project-001", "project-002"]));
      expect((await readdir(root)).sort()).toEqual(["project-001", "project-002"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
