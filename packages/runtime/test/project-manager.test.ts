import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manager(root: string, initialProjectId?: string): WorkspaceProjectManager {
  return new WorkspaceProjectManager({
    root,
    ...(initialProjectId === undefined ? {} : { initialProjectId }),
    createRuntime: (repository) => new WorkspaceRuntime(repository),
  });
}

describe("workspace project manager", () => {
  it("exposes a lazy project and enriches runtime results", async () => {
    const root = path.join(os.tmpdir(), `st-workspace-v3-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    roots.push(root);
    const projects = manager(root);
    expect(projects.root).toBe(root);
    expect(projects.repository.projectId).toBe("project-001");
    expect(projects.runtime).toBe(await projects.ensureRuntime());
    expect((await projects.listProjects()).map((item) => item.project_id)).toEqual(["project-001"]);
    const status = await projects.status();
    expect(status.project_id).toBe("project-001");
    expect(status.project_path).toContain("project-001");
    expect((await projects.interviewContext()).project_id).toBe("project-001");
    const paused = await projects.answerInterview("角色設定", { actor: "user", attachments: [] });
    expect(paused.project_id).toBe("project-001");
    expect(paused.project_path).toContain("project-001");
  });

  it("starts a new session instead of reopening an existing project-001", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-fresh-session-"));
    roots.push(root);
    const previous = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const previousState = await previous.read();
    await previous.commit(previousState.revision, (state) => ({
      ...state,
      project_name: "舊專案",
      project_slug: "舊專案",
      project_status: "ready",
    }));

    const projects = manager(root);
    const context = await projects.interviewContext();
    expect(context.project_id).toBe("project-002");
    expect(context.status).toBe("idle");
    expect(context.answers).toEqual([]);
    expect((await projects.status()).project_id).toBe("project-002");
    expect((await projects.listProjects()).map((item) => item.project_id)).toEqual(["project-001", "project-002"]);
    expect((await previous.read()).project_name).toBe("舊專案");

    await projects.select("project-001");
    expect((await projects.status()).project_id).toBe("project-001");
    expect((await projects.status()).project_name).toBe("舊專案");
  });

  it("starts sequential projects, filters incomplete folders and selects by id or folder", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-manager-"));
    roots.push(root);
    const projects = manager(root);
    await projects.startNewProject();
    await projects.startNewProject();
    await mkdir(path.join(root, ".hidden", ".workspace"), { recursive: true });
    await mkdir(path.join(root, "incomplete"), { recursive: true });
    await mkdir(path.join(root, "broken", ".workspace"), { recursive: true });
    await writeFile(path.join(root, "broken", ".workspace", "state.json"), "not-json", "utf8");
    const listed = await projects.listProjects();
    expect(listed.map((item) => item.project_id)).toEqual(["broken", "project-001", "project-002"]);
    const broken = listed.find((item) => item.project_id === "broken");
    expect(broken?.status).toBe("uninitialized");
    await expect(projects.select("")).rejects.toThrow("project name or id");
    await expect(projects.select("../outside")).rejects.toThrow("project name or id");
    await expect(projects.select("missing")).rejects.toThrow("was not found");
    expect((await projects.select("project-001")).project_id).toBe("project-001");
    expect((await projects.select("project-002")).project_id).toBe("project-002");
  });

  it("finalizes names safely and avoids directory collisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-finalize-"));
    roots.push(root);
    const projects = manager(root);
    const pending = await projects.finalizeIfNamed({ operation_id: "pending", status: "needs_input", summary: "waiting", completed: [], blocked: [] });
    expect(pending.project_id).toBe("project-001");
    await mkdir(path.join(root, "Demo"), { recursive: true });
    const first = await projects.finalizeIfNamed({ operation_id: "done", status: "completed", summary: "done", completed: [], blocked: [], project_name: "Demo" });
    expect(first.project_id).toBe("Demo-2");
    expect(first.project_path).toContain("Demo-2");
    await access(path.join(root, "Demo-2", "project.json"));
    const second = await projects.finalizeIfNamed({ operation_id: "done-2", status: "completed", summary: "done", completed: [], blocked: [], project_name: "..." });
    expect(second.project_id).toBe("project");
  });

  it("creates a fresh project before a new-project request", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-new-project-"));
    roots.push(root);
    const projects = manager(root);
    await projects.startNewProject();
    const result = await projects.request("new project", { actor: "user", attachments: [] });
    expect(result.project_id).toBe("project-002");
  });

  it("switches to the selected project when a continue interview completes", { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-continue-"));
    roots.push(root);
    const previous = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const previousState = await previous.read();
    await previous.commit(previousState.revision, (state) => ({
      ...state,
      project_name: "目標專案",
      project_slug: "目標專案",
      project_status: "ready",
    }));

    const projects = manager(root);
    expect((await projects.interviewContext()).project_id).toBe("project-002");
    const answers = ["繼續專案", "目標專案", "繼續的專案", "不需要", "自由創作", "不需要"];
    let result;
    for (const answer of answers) {
      result = await projects.answerInterview(answer, { actor: "user", attachments: [] });
    }
    expect(result?.status).toBe("completed");
    expect(result?.project_id).toBe("project-001");
    expect((await projects.status()).project_id).toBe("project-001");
  });

  it("imports a legacy card when a legacy review interview completes", { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-legacy-"));
    roots.push(root);
    const cardPath = path.join(root, "legacy-card.json");
    await writeFile(cardPath, JSON.stringify({ name: "Legacy", description: "A complete legacy card" }), "utf8");
    const projects = manager(root);
    const answers = ["舊卡審核", cardPath, "審核專案", "不需要", "自由創作", "不需要"];
    let result;
    for (const answer of answers) {
      result = await projects.answerInterview(answer, { actor: "user", attachments: [] });
    }
    expect(result?.status).toBe("completed");
    expect(result?.project_id).toBe("審核專案");
    expect(result?.summary).toContain("匯入");
    expect((result?.completed ?? []).length).toBeGreaterThan(0);
    expect((await projects.status()).project_id).toBe("審核專案");

    const missing = manager(await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-legacy-missing-")));
    roots.push((missing as unknown as { root: string }).root);
    const missingAnswers = ["舊卡審核", path.join(root, "nope.json"), "審核專案", "不需要", "自由創作", "不需要"];
    for (const answer of missingAnswers) {
      try {
        await missing.answerInterview(answer, { actor: "user", attachments: [] });
      } catch (error) {
        expect((error as { code?: string }).code).toBe("LEGACY_CARD_NOT_FOUND");
        return;
      }
    }
    throw new Error("expected LEGACY_CARD_NOT_FOUND");
  });

  it("switches to an existing project when a world interview targets it", { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-world-"));
    roots.push(root);
    const previous = new FileProjectRepository(root, "project-001", { layout: "project", materialize: true });
    const previousState = await previous.read();
    await previous.commit(previousState.revision, (state) => ({
      ...state,
      project_name: "世界專案",
      project_slug: "世界專案",
      project_status: "ready",
    }));

    const projects = manager(root);
    expect((await projects.interviewContext()).project_id).toBe("project-002");
    let result = await projects.answerInterview("世界設定", { actor: "user", attachments: [] });
    const worldKind = (await projects.interviewContext()).question?.options?.find((option) => option.includes("既有專案"));
    expect(worldKind).toBeDefined();
    result = await projects.answerInterview(worldKind!, { actor: "user", attachments: [] });
    const answers = ["世界專案", "一個蒸汽龐克都市", undefined, "世界書專案", "自由創作", "不需要"];
    for (let index = 0; index < answers.length; index += 1) {
      let answer = answers[index];
      if (answer === undefined) {
        const ctx = await projects.interviewContext();
        answer = ctx.question?.options?.[0];
        expect(answer).toBeDefined();
      }
      result = await projects.answerInterview(answer!, { actor: "user", attachments: [] });
    }
    expect(result?.status).toBe("completed");
    expect(result?.project_id).toBe("project-001");
    expect((await projects.status()).project_id).toBe("project-001");
  });
});
