import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeTemporaryWorkspace } from "@card-workspace/testing";
import {
  conflictRegisterSchema,
  factRegisterSchema,
  mvuSourceSchema,
  projectManifestSchema,
  sourceManifestSchema,
} from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalYaml,
  computeRevision,
  initializeProject,
  loadAuthorProject,
  savePluginSource,
  validateProject,
} from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function manifest() {
  return projectManifestSchema.parse({
    schema_version: 1,
    id: "author-demo",
    title: "作者專案",
    kind: "character_card",
    card: { name: "作者角色卡" },
    characters: [
      { id: "alice", display_name: "愛麗絲", mode: "zhuji", role: "primary" },
      { id: "bob", display_name: "鮑伯", mode: "palette", role: "supporting" },
    ],
  });
}

describe("loadAuthorProject", () => {
  it("active plugin source 缺少 server-derived selection 時 fail closed", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({ ...manifest(), plugins: ["official.mvu-zod"] }),
    });
    await savePluginSource(projectRoot, "official.mvu-zod", mvuSourceSchema.parse({
      schema_version: 1,
      project_kind: "character_card",
      implementation: {
        version: "1.0.0",
        digest: "sha256:" + "a".repeat(64),
        asset_manifest_id: "assets",
        asset_manifest_revision: "sha256:" + "b".repeat(64),
        asset_manifest_hash: "sha256:" + "c".repeat(64),
      },
      plugin_id: "official.mvu-zod",
      variables: [{ name: "mood", type: "string", default: "calm" }],
    }));
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(false);
    expect(loaded.pluginSources).toHaveLength(1);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PLUGIN_SELECTION_MISSING",
      "PLUGIN_ARTIFACT_MISSING",
    ]));
  });

  it("worldbook active plugin 與未知 plugin 不會被自動啟用", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: "worldbook-plugins",
        title: "世界書",
        kind: "worldbook",
        characters: [],
        card: { name: "世界書" },
        plugins: ["official.mvu-zod", "unknown-plugin"],
      }),
      world: { enabled: true, categories: ["geography"], scope: "群島世界" },
    });
    const loaded = await loadAuthorProject(workspace.projectsRoot, "worldbook-plugins");
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PLUGIN_PROJECT_KIND_DENIED",
      "PLUGIN_ID_UNKNOWN",
      "PLUGIN_SOURCE_MISSING",
    ]));
  });

  it("初始化並載入珠璣、調色盤與專案級 greeting", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(true);
    expect(loaded.characters.map((character) => character.modules.length)).toEqual([7, 4]);
    expect(loaded.characters[0]?.modules.at(-1)).toMatchObject({
      mode: "zhuji",
      module: "self_introduction",
    });
    expect(loaded.characters[0]?.modules.map((module) => module.module)).toEqual([
      "appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction",
    ]);
    await expect(readFile(path.join(loaded.projectRoot, "characters", "alice", "zhuji", "05-trait-dialogue.yaml"), "utf8")).resolves.toContain("trait_dialogue");
    await expect(readFile(path.join(loaded.projectRoot, "characters", "alice", "zhuji", "04-expanded-extension.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(loaded.greetings?.greetings).toEqual([
      expect.objectContaining({ kind: "primary", character_ids: ["alice"] }),
    ]);
    expect(loaded.sourceManifest).toMatchObject({ sources: [] });
    expect(loaded.factRegister).toMatchObject({ facts: [] });
    expect(loaded.conflictRegister).toMatchObject({ conflicts: [] });
    expect(Object.keys(loaded.sourceRevisions)).toContain("characters/alice/zhuji/07-self-introduction.yaml");
    expect(Object.keys(loaded.sourceRevisions)).toContain("project.yaml");
    expect(loaded.relationships).toBeUndefined();
    await expect(readFile(path.join(loaded.projectRoot, "relationships.yaml"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("啟用時建立合法且穩定的共享關係 placeholder 並納入 source revisions", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: manifest(),
      relationships: {
        enabled: true,
        character_ids: ["alice", "bob"],
        requirements: ["保持方向差異"],
        extensions: {},
      },
    });
    const firstRaw = await readFile(path.join(projectRoot, "relationships.yaml"), "utf8");
    const first = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    const second = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(first.ok).toBe(true);
    expect(first.relationships?.team_code).toMatch(/^[A-Z0-9]{6}$/u);
    expect(first.relationships?.character_ids).toEqual(["alice", "bob"]);
    expect(first.relationships?.perspectives).toHaveLength(4);
    expect(second.relationships?.team_code).toBe(first.relationships?.team_code);
    expect(await readFile(path.join(projectRoot, "relationships.yaml"), "utf8")).toBe(firstRaw);
    expect(first.sourceRevisions).toHaveProperty("relationships.yaml");
  });

  it("關係文件 participant 必須與 Blueprint 完全一致", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: manifest(),
      relationships: { enabled: true, character_ids: ["alice", "bob"], requirements: [], extensions: {} },
    });
    const relationshipPath = path.join(projectRoot, "relationships.yaml");
    const parsed = (await import("yaml")).parse(await readFile(relationshipPath, "utf8")) as Record<string, unknown>;
    parsed.character_ids = ["bob", "alice"];
    await writeFile(relationshipPath, canonicalYaml(parsed), "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.map((item) => item.code)).toContain("RELATIONSHIPS_PARTICIPANTS_MISMATCH");
  });

  it("初始化可載入且沒有角色與 greetings 的 worldbook", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: "worldbook-demo",
        title: "世界書",
        kind: "worldbook",
        characters: [],
        card: { name: "世界書" },
      }),
      world: { enabled: true, categories: ["geography"], scope: "群島世界" },
    });
    const loaded = await loadAuthorProject(workspace.projectsRoot, "worldbook-demo");
    expect(loaded.ok).toBe(true);
    expect(loaded.manifest?.kind).toBe("worldbook");
    expect(loaded.characters).toEqual([]);
    expect(loaded.greetings).toBeUndefined();
    expect(loaded.blueprint).toMatchObject({
      characters: [],
      world: { enabled: true, authoring_timing: "before_characters", categories: ["geography"] },
      greetings: { enabled: false, character_ids: [] },
    });
    await expect(readFile(path.join(projectRoot, "greetings.yaml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("唯讀載入含 expanded_extension 的舊版珠璣七模組 layout", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const zhujiRoot = path.join(projectRoot, "characters", "alice", "zhuji");
    await rm(path.join(zhujiRoot, "05-trait-dialogue.yaml"));
    await rename(path.join(zhujiRoot, "04-trait-refinement.yaml"), path.join(zhujiRoot, "05-trait-refinement.yaml"));
    await writeFile(path.join(zhujiRoot, "04-expanded-extension.yaml"), canonicalYaml({
      schema_version: 1,
      mode: "zhuji",
      module: "expanded_extension",
      title: "外延擴展",
      content: "[舊版待填寫]",
      sections: [],
      extensions: {},
    }), "utf8");

    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(true);
    expect(loaded.characters[0]?.modules.map((module) => module.module)).toEqual([
      "appearance", "inner_nature", "extension", "expanded_extension", "trait_refinement", "scene_dialogue", "self_introduction",
    ]);
    expect(Object.keys(loaded.sourceRevisions)).toContain("characters/alice/zhuji/04-expanded-extension.yaml");
    expect(Object.keys(loaded.sourceRevisions)).not.toContain("characters/alice/zhuji/05-trait-dialogue.yaml");
  });

  it("同一交易初始化合法且 revision deterministic 的空 Sources/Facts 狀態", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const source = sourceManifestSchema.parse((await import("yaml")).parse(await readFile(path.join(projectRoot, "sources", "manifest.yaml"), "utf8")));
    const facts = factRegisterSchema.parse((await import("yaml")).parse(await readFile(path.join(projectRoot, "facts", "register.yaml"), "utf8")));
    const conflicts = conflictRegisterSchema.parse((await import("yaml")).parse(await readFile(path.join(projectRoot, "facts", "conflicts.yaml"), "utf8")));
    expect(source.revision).toBe(computeRevision({ schema_version: 1, sources: [], extensions: {} }));
    expect(facts.revision).toBe(computeRevision({ schema_version: 1, facts: [], extensions: {} }));
    expect(conflicts.revision).toBe(computeRevision({ schema_version: 1, conflicts: [], extensions: {} }));
    await expect(readFile(path.join(projectRoot, "sources", "journals", "source-events.jsonl"), "utf8")).resolves.toBe("");
    await expect(readFile(path.join(projectRoot, "facts", "decisions.jsonl"), "utf8")).resolves.toBe("");
  });

  it("缺少 projection 回報 migration diagnostic，未知來源檔不會進入 loader", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    await rm(path.join(projectRoot, "facts", "register.yaml"));
    await writeFile(path.join(projectRoot, "sources", "unknown.yaml"), "bad: [\n", "utf8");
    await writeFile(path.join(projectRoot, "facts", "decisions.jsonl"), "not-json\n", "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.diagnostics.some((item) =>
      item.code === "PROJECT_SCHEMA_MIGRATION_REQUIRED"
      && item.location?.file === "facts/register.yaml"
    )).toBe(true);
    expect(loaded.diagnostics.map((item) => item.location?.file.replaceAll("\\", "/"))).not.toContain("sources/unknown.yaml");
    expect(loaded.diagnostics.map((item) => item.code)).toContain("JOURNAL_JSONL_INVALID");
  });

  it("一次聚合缺模組、模式混用、世界分類與 greeting 引用錯誤", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    await rm(path.join(projectRoot, "characters", "alice", "zhuji", "02-inner-nature.yaml"));
    await mkdir(path.join(projectRoot, "characters", "alice", "palette"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "greetings.yaml"),
      canonicalYaml({
        schema_version: 1,
        greetings: [
          { id: "primary", kind: "primary", content: "開場", character_ids: ["missing-character"] },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "world", "geography"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "world", "geography", "wrong.yaml"),
      canonicalYaml({
        schema_version: 1,
        id: "wrong-category",
        category: "people",
        title: "錯誤分類",
        content: "內容",
        related_ids: ["missing-world"],
      }),
      "utf8",
    );
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "AUTHOR_FILE_MISSING",
        "CHARACTER_MODE_MIXED",
        "WORLD_CATEGORY_MISMATCH",
        "GREETING_CHARACTER_MISSING",
        "WORLD_REFERENCE_MISSING",
      ]),
    );
  });

  it("巢狀同名檔不得冒充根 manifest", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = path.join(workspace.projectsRoot, "nested-only");
    await mkdir(path.join(projectRoot, "nested"), { recursive: true });
    await writeFile(path.join(projectRoot, "nested", "project.yaml"), canonicalYaml(manifest()), "utf8");
    await writeFile(
      path.join(projectRoot, "workflow.json"),
      await readFile(
        fileURLToPath(new URL("../../testing/fixtures/valid-project/workflow.json", import.meta.url)),
        "utf8",
      ),
      "utf8",
    );
    const result = await validateProject(workspace.projectsRoot, "nested-only");
    expect(result.diagnostics.map((item) => item.code)).toContain("PROJECT_MANIFEST_MISSING");
  });
});
