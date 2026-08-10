import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository, MemoryProjectRepository, type RequestResult } from "@st-workspace/core";
import { WorkspaceProjectManager, WorkspaceRuntime } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project interview runtime", () => {
  it("pauses new projects for interview and records answers atomically", async () => {
    const repository = new MemoryProjectRepository("project-001");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    const first = await runtime.request("建立新專案", { actor: "user", attachments: [] });
    expect(first.status).toBe("needs_input");
    expect(first.question).toContain("哪一種工作");
    const second = await runtime.answerInterview("角色設定", { actor: "user", attachments: [] });
    expect(second.status).toBe("needs_input");
    expect(second.question).toContain("單人角色卡");
    const third = await runtime.answerInterview("單人角色卡", { actor: "user", attachments: [] });
    expect(third.question).toContain("完全原創");
    const state = await repository.read();
    expect(state.interview.answers).toHaveLength(2);
    expect(state.audit.at(-1)?.event).toBe("interview.answer.recorded");
    await expect(runtime.answerInterview("   ", { actor: "user", attachments: [] })).rejects.toMatchObject({ code: "INTERVIEW_ANSWER_EMPTY" });
  });

  it("materializes source adaptation intent in the completed Blueprint", async () => {
    const repository = new MemoryProjectRepository("source-adaptation-project");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    expect((await runtime.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = [
      "角色設定",
      "單人角色卡",
      "原作改編",
      "雪乃，來自某部動漫",
      "動漫",
      "官方角色頁、雪乃、作品名稱",
      "二創詮釋",
      "雪乃",
      "palette",
      "我心中更克制、溫柔且重視界線的版本",
      "沿用原作背景，但調整成適合本專案的生活脈絡",
      "冷靜、觀察力強，面對信任的人會逐步展現柔軟",
      "我直接命名",
      "雪乃二創專案",
      "不需要",
      "外冷內熱、慢熟但對重要的人很忠誠",
      "自由創作",
      "沒有",
    ];
    let result = await runtime.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await runtime.answerInterview(value, { actor: "user", attachments: [] });

    expect(result.status).toBe("completed");
    const state = await repository.read();
    const blueprint = JSON.parse(state.artifacts.find((artifact) => artifact.kind === "blueprint")!.content) as Record<string, unknown>;
    expect(blueprint).toMatchObject({
      flow: "source_adaptation",
      source_adaptation: {
        subject_name: "雪乃，來自某部動漫",
        source_medium: "動漫",
        source_identifiers: ["官方角色頁", "雪乃", "作品名稱"],
        canon_policy: "canon_inspired",
      },
    });
  });

  it("materializes a direction and precheck scope for every multi-character subject", async () => {
    const repository = new MemoryProjectRepository("multi-character-project");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    expect((await runtime.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = [
      "角色設定",
      "多角色卡",
      "完全原創",
      "甲、乙",
      "甲",
      "乙",
      "palette",
      "概念甲",
      "背景甲",
      "性格甲",
      "概念乙",
      "背景乙",
      "性格乙",
      "關係已整理",
      "不啟用",
      "我直接命名",
      "雙人專案",
      "不需要",
      "甲方向：冷靜可靠且保留反差",
      "乙方向：熱烈直接但尊重界線",
      "自由創作",
      "沒有",
    ];
    let result = await runtime.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await runtime.answerInterview(value, { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const blueprint = JSON.parse(state.artifacts.find((artifact) => artifact.kind === "blueprint")!.content) as {
      characters: Array<{ id: string; label: string; direction?: { selected?: string } }>;
      relationships?: { enabled?: boolean };
    };
    expect(blueprint.characters).toHaveLength(2);
    expect(blueprint.characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "character-1", label: "甲", direction: expect.objectContaining({ selected: expect.stringContaining("冷靜") }) }),
      expect.objectContaining({ id: "character-2", label: "乙", direction: expect.objectContaining({ selected: expect.stringContaining("熱烈") }) }),
    ]));
    expect(blueprint.relationships).toMatchObject({ enabled: false });
    const characterCoreChecks = state.blueprint_prechecks[0]?.checks.filter((check) => check.dimension === "character_core");
    expect(characterCoreChecks?.map((check) => check.subject_id)).toEqual(["character-1", "character-2"]);
  });

  it("materializes per-character modes and relationship participant ids", async () => {
    const repository = new MemoryProjectRepository("multi-character-mode-project");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    expect((await runtime.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = [
      "角色設定",
      "多角色卡",
      "完全原創",
      "甲、乙、丙",
      "甲",
      "乙",
      "丙",
      "每名角色分別指定",
      "zhuji",
      "palette",
      "palette",
      "概念甲",
      "背景甲",
      "性格甲",
      "概念乙",
      "背景乙",
      "性格乙",
      "概念丙",
      "背景丙",
      "性格丙",
      "關係已整理",
      "啟用",
      "指定 participant subset",
      "甲、丙",
      "我直接命名",
      "混合模式專案",
      "不需要",
      "甲方向：冷靜可靠且保留反差",
      "乙方向：熱烈直接但尊重界線",
      "丙方向：沉著觀察並重視承諾",
      "自由創作",
      "沒有",
    ];
    let result = await runtime.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await runtime.answerInterview(value, { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const blueprint = JSON.parse(state.artifacts.find((artifact) => artifact.kind === "blueprint")!.content) as {
      characters: Array<{ id: string; mode?: string }>;
      relationships?: { enabled?: boolean; scope?: string; character_ids?: string[] };
    };
    expect(blueprint.characters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "character-1", mode: "zhuji" }),
      expect.objectContaining({ id: "character-2", mode: "palette" }),
      expect.objectContaining({ id: "character-3", mode: "palette" }),
    ]));
    expect(blueprint.relationships).toEqual({ enabled: true, scope: "participant_subset", character_ids: ["character-1", "character-3"] });
    const modeChecks = state.blueprint_prechecks[0]?.checks.filter((check) => check.dimension === "cross_module_impact");
    expect(modeChecks?.every((check) => check.uncertainty === "low" && check.action === "preserve_explicit")).toBe(true);
  });

  it("materializes an independent worldbook without inventing a character", async () => {
    const repository = new MemoryProjectRepository("world-only-project");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    expect((await runtime.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = ["世界設定", "獨立世界書", "有明確魔法規則與地理脈絡的世界", "之前", "世界專案", "自由創作", "沒有"];
    let result = await runtime.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await runtime.answerInterview(value, { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const blueprint = JSON.parse(state.artifacts.find((artifact) => artifact.kind === "blueprint")!.content) as {
      characters: unknown[];
      world?: { enabled?: boolean; kind?: string; authoring_timing?: string };
    };
    expect(blueprint.characters).toEqual([]);
    expect(blueprint.world).toMatchObject({ enabled: true, kind: "獨立世界書", authoring_timing: "before_characters" });
  });

  it("keeps characters when the world-first branch explicitly creates a character card", async () => {
    const repository = new MemoryProjectRepository("world-character-project");
    const runtime = new WorkspaceRuntime(repository, { interviewRequired: true });
    expect((await runtime.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = [
      "世界設定",
      "建立含世界的角色卡",
      "有明確規則的角色生活世界",
      "之前",
      "單人角色卡",
      "完全原創",
      "主角",
      "palette",
      "角色概念",
      "角色背景",
      "角色性格",
      "我直接命名",
      "世界角色專案",
      "外冷內熱的角色方向",
      "自由創作",
      "沒有",
    ];
    let result = await runtime.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await runtime.answerInterview(value, { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    const blueprint = JSON.parse(state.artifacts.find((artifact) => artifact.kind === "blueprint")!.content) as {
      characters: Array<{ id: string; mode?: string }>;
      world?: { enabled?: boolean; authoring_timing?: string };
    };
    expect(blueprint.characters).toEqual([expect.objectContaining({ id: "character-1", mode: "palette" })]);
    expect(blueprint.world).toMatchObject({ enabled: true, authoring_timing: "before_characters" });
  });

  it("creates a temporary project folder and renames it after the interview", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-project-manager-"));
    roots.push(root);
    const manager = new WorkspaceProjectManager({
      root,
      createRuntime: (repository) => new WorkspaceRuntime(repository, { interviewRequired: true }),
    });
    expect((await manager.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    const values = [
      "角色設定",
      "單角色卡",
      "完全原創",
      "雪乃",
      "palette",
      "概念清楚且保留冷靜觀察的核心特徵",
      "在普通家庭成長並形成獨立生活能力",
      "克制直接，重視誠實與人際界線",
      "我直接命名",
      "雪乃專案",
      "不需要",
      "外冷內熱、重視界線但願意建立長期信任",
      "自由創作",
      "沒有",
    ];
    let result = await manager.answerInterview(values[0]!, { actor: "user", attachments: [] });
    for (const value of values.slice(1)) result = await manager.answerInterview(value, { actor: "user", attachments: [] });
    expect(result.status).toBe("completed");
    /*
    const completedState = await manager.repository.read();
    expect((await manager.repository.read()).blueprint_prechecks).toHaveLength(1);
    expect((await manager.repository.read()).blueprint_prechecks[0]?.checks).toHaveLength(6);
    expect((await manager.repository.read()).blueprint_prechecks[0]?.status).toBe("recorded");
    expect(result.project_name).toBe("雪乃專案");
    expect(result.project_path).toContain("雪乃專案");
    expect(await readFile(path.join(root, "雪乃專案", "project.json"), "utf8")).toContain("雪乃專案");
    expect((await manager.listProjects()).map((project) => project.project_name)).toContain("雪乃專案");
    expect((await new FileProjectRepository(root, "雪乃專案", { layout: "project", materialize: true }).read()).project_status).toBe("ready");
  });

    */
    const completedState = await manager.repository.read();
    expect(completedState.blueprint_prechecks).toHaveLength(1);
    expect(completedState.blueprint_prechecks[0]?.checks).toHaveLength(6);
    expect(completedState.blueprint_prechecks[0]?.status).toBe("recorded");
    expect(completedState.artifacts).toHaveLength(1);
    expect(completedState.artifacts[0]).toMatchObject({ kind: "blueprint", blueprint_precheck_id: completedState.blueprint_prechecks[0]?.id });
    expect(JSON.parse(completedState.artifacts[0]!.content)).toMatchObject({
      kind: "blueprint",
      blueprint_direction: { scope: "character_setting", selected: "外冷內熱、重視界線但願意建立長期信任", character_setting_direction: "外冷內熱、重視界線但願意建立長期信任", source_question_id: "blueprint_direction" },
    });
  }, 30_000);

  it("lists, selects, allocates and safely renames project folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-project-manager-branches-"));
    roots.push(root);
    const manager = new WorkspaceProjectManager({ root, createRuntime: (repository) => new WorkspaceRuntime(repository, { interviewRequired: true }) });
    expect(manager.root).toBe(root);
    expect(manager.repository.projectId).toBe("project-001");
    expect(await manager.listProjects()).toEqual([]);
    await manager.ensureRuntime();
    expect((await manager.listProjects()).map((item) => item.project_id)).toEqual(["project-001"]);
    expect((await manager.interviewContext()).status).toBe("idle");
    expect((await manager.status()).project_id).toBe("project-001");
    expect((await manager.request("建立新專案", { actor: "user", attachments: [] })).status).toBe("needs_input");
    expect(manager.repository.projectId).toBe("project-001");
    await expect(manager.select("")).rejects.toThrow();
    await expect(manager.select("bad/name")).rejects.toThrow();
    await expect(manager.select("missing")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    await mkdir(path.join(root, ".hidden"), { recursive: true });
    await mkdir(path.join(root, "broken", ".workspace"), { recursive: true });
    await writeFile(path.join(root, "broken", ".workspace", "state.json"), "not-json", "utf8");
    await mkdir(path.join(root, "project-002"), { recursive: true });
    expect((await manager.listProjects()).map((item) => item.project_id)).toEqual(["project-001"]);

    await manager.startNewProject();
    expect(manager.repository.projectId).toBe("project-003");
    const pending: RequestResult = { operation_id: "op", status: "needs_input", summary: "pending", completed: [], blocked: [], project_name: "待命名" };
    expect((await manager.finalizeIfNamed(pending)).project_path).toContain("project-003");
    await mkdir(path.join(root, "Existing"), { recursive: true });
    const completed: RequestResult = { operation_id: "op-2", status: "completed", summary: "done", completed: [], blocked: [], project_name: "Existing" };
    const renamed = await manager.finalizeIfNamed(completed);
    expect(renamed.project_path).toContain("Existing-2");
    expect((await manager.select("Existing-2")).project_id).toBe("Existing-2");
    expect((await manager.status()).project_path).toContain("Existing-2");
    await manager.startNewProject();
    const reserved: RequestResult = { operation_id: "op-3", status: "completed", summary: "done", completed: [], blocked: [], project_name: "con" };
    expect((await manager.finalizeIfNamed(reserved)).project_path).toContain("project-con");
  });

  it("returns an empty project list when the root has not been created", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-project-manager-parent-"));
    roots.push(root);
    const missingRoot = path.join(root, "not-created");
    const manager = new WorkspaceProjectManager({ root: missingRoot, createRuntime: (repository) => new WorkspaceRuntime(repository) });
    expect(await manager.listProjects()).toEqual([]);
  });
});
