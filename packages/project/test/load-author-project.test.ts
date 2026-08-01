import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
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
import { officialPluginImplementationPin } from "../../plugins/src/index.js";

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

  it("covers plugin source directories and invalid server-derived selection fail-closed paths", async () => {
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
    await mkdir(path.join(projectRoot, "extensions", "unknown-plugin"), { recursive: true });
    await writeFile(path.join(projectRoot, "extensions", "unknown-plugin", "source.yaml"), "unknown: true\n", "utf8");
    await mkdir(path.join(projectRoot, "extensions", "official.ejs"), { recursive: true });
    await writeFile(path.join(projectRoot, "extensions", "official.ejs", "source.yaml"), "orphan: true\n", "utf8");
    await mkdir(path.join(projectRoot, ".workflow"), { recursive: true });
    await writeFile(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), "bad: true\n", "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.ok).toBe(false);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PLUGIN_ID_UNKNOWN",
      "PLUGIN_ORPHAN_SOURCE",
      "PLUGIN_SELECTION_INVALID",
      "PLUGIN_ARTIFACT_MISSING",
    ]));
  });
  it("covers valid-but-drifting plugin selections and orphan artifact loading", async () => {
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
    const revision = "sha256:" + "d".repeat(64);
    await mkdir(path.join(projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
    await writeFile(path.join(projectRoot, ".workflow", "plugin-artifacts", "plugin-official.ejs.json"), JSON.stringify({
      id: "plugin-official.ejs",
      plugin_id: "official.ejs",
      revision,
      source_revision: revision,
      resolved_source_hash: revision,
      implementation: officialPluginImplementationPin("official.ejs"),
      generated_at: "2026-07-20T00:00:00.000Z",
      status: "approved",
    }), "utf8");
    await mkdir(path.join(projectRoot, ".workflow"), { recursive: true });
    await writeFile(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), canonicalYaml({
      schema_version: 1,
      project_id: "other-project",
      intent_revision: revision,
      selections: [],
      updated_at: "2026-07-20T00:00:00.000Z",
    }), "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PLUGIN_SELECTION_PROJECT_MISMATCH",
      "PLUGIN_SELECTION_ACTIVE_MISMATCH",
      "PLUGIN_ORPHAN_ARTIFACT",
      "PLUGIN_ARTIFACT_MISSING",
    ]));
  });
  it("reports plugin selection source, implementation, capability, and artifact drift", async () => {
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
    await mkdir(path.join(projectRoot, ".workflow"), { recursive: true });
    await writeFile(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), canonicalYaml({
      schema_version: 1,
      project_id: "author-demo",
      intent_revision: "sha256:" + "d".repeat(64),
      selections: [{
        schema_version: 1,
        plugin_id: "official.mvu-zod",
        capabilities: ["html.message_presentation"],
        source_revision: "sha256:" + "e".repeat(64),
        implementation: officialPluginImplementationPin("official.ejs"),
        artifact_revision: "sha256:" + "f".repeat(64),
      }],
      updated_at: "2026-07-20T00:00:00.000Z",
    }), "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "PLUGIN_SELECTION_SOURCE_MISMATCH",
      "PLUGIN_SELECTION_IMPLEMENTATION_MISMATCH",
      "PLUGIN_SELECTION_CAPABILITIES_MISMATCH",
      "PLUGIN_ARTIFACT_MISSING",
    ]));
  });  it("covers author file type, encoding, identity, and world scanner diagnostics", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
    const greetingPath = path.join(projectRoot, "greetings.yaml");
    await rm(greetingPath);
    await writeFile(greetingPath, "", "utf8");
    await writeFile(path.join(projectRoot, "sources", "journals", "source-events.jsonl"), Buffer.from([0xff, 0xfe]));
    await rm(path.join(projectRoot, "facts", "decisions.jsonl"));
    await mkdir(path.join(projectRoot, "facts", "decisions.jsonl"));
    const characterPath = path.join(projectRoot, "characters", "alice", "character.yaml");
    const characterRaw = await readFile(characterPath, "utf8");
    await writeFile(characterPath, characterRaw.replace("id: alice", "id: wrong"), "utf8");
    await mkdir(path.join(projectRoot, "world", "geography"), { recursive: true });
    await writeFile(path.join(projectRoot, "world", "geography", "notes.yaml"), "not: [valid", "utf8");
    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    const codes = loaded.diagnostics.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["AUTHOR_FILE_TYPE_INVALID", "JOURNAL_ENCODING_INVALID", "CHARACTER_ID_MISMATCH"]));
  });

  it("covers loader identity, relationship, and world edge diagnostics", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({ ...manifest(), plugins: ["official.mvu-zod"] }),
      relationships: { enabled: true, character_ids: ["alice", "bob"], requirements: [], extensions: {} },
      world: { enabled: true, categories: ["geography"], scope: "World" },
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
    const yaml = await import("yaml");
    const relationshipPath = path.join(projectRoot, "relationships.yaml");
    const relationship = yaml.parse(await readFile(relationshipPath, "utf8")) as Record<string, unknown>;
    relationship.character_ids = ["bob", "alice"];
    await writeFile(relationshipPath, canonicalYaml(relationship), "utf8");

    const characterPath = path.join(projectRoot, "characters", "alice", "character.yaml");
    const character = yaml.parse(await readFile(characterPath, "utf8")) as Record<string, unknown>;
    character.id = "wrong";
    character.display_name = "Different";
    await writeFile(characterPath, canonicalYaml(character), "utf8");
    const modulePath = path.join(projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
    const module = yaml.parse(await readFile(modulePath, "utf8")) as Record<string, unknown>;
    module.module = "inner_nature";
    await writeFile(modulePath, canonicalYaml(module), "utf8");

    await mkdir(path.join(projectRoot, "world", "geography"), { recursive: true });
    await writeFile(path.join(projectRoot, "world", "geography", "duplicate.yaml"), canonicalYaml({
      schema_version: 1, id: "duplicate", category: "geography", title: "Duplicate", content: "one", related_ids: [],
    }), "utf8");
    await writeFile(path.join(projectRoot, "world", "geography", "duplicate-two.yaml"), canonicalYaml({
      schema_version: 1, id: "duplicate", category: "geography", title: "Duplicate", content: "two", related_ids: [],
    }), "utf8");

    const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
    const codes = loaded.diagnostics.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([

      "CHARACTER_MODULE_KIND_MISMATCH",
      "CHARACTER_ID_MISMATCH",
      "CHARACTER_NAME_MISMATCH",

      "RELATIONSHIPS_PARTICIPANTS_MISMATCH",
      "WORLD_ID_DUPLICATE",
    ]));
  });});
it("covers loader missing-foundation and parser branches", async () => {
  const empty = await makeTemporaryWorkspace();
  cleanups.push(empty.cleanup);
  await mkdir(path.join(empty.projectsRoot, "empty-project"), { recursive: true });
  const missing = await loadAuthorProject(empty.projectsRoot, "empty-project");
  expect(missing.ok).toBe(false);
  expect(missing.manifest).toBeUndefined();

  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest: manifest() });
  await writeFile(path.join(projectRoot, "greetings.yaml"), "not: [valid", "utf8");
  await writeFile(path.join(projectRoot, "characters", "alice", "character.yaml"), "not: [valid", "utf8");
  await rm(path.join(projectRoot, "sources", "projection.yaml"), { force: true });
  const loaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
  expect(loaded.ok).toBe(false);
  expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["YAML_PARSE_ERROR"]));

  await rm(path.join(projectRoot, "facts", "conflicts.yaml"));
  const migration = await loadAuthorProject(workspace.projectsRoot, "author-demo");
  expect(migration.diagnostics.map((item) => item.code)).toContain("PROJECT_SCHEMA_MIGRATION_REQUIRED");
});
it("covers loader plugin, relationship, and world file guard matrices", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({ ...manifest(), plugins: ["official.mvu-zod"] }),
  });
  const source = mvuSourceSchema.parse({
    schema_version: 1,
    project_kind: "character_card",
    implementation: officialPluginImplementationPin("official.mvu-zod"),
    plugin_id: "official.mvu-zod",
    variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
    update_rules: [],
  });
  await savePluginSource(projectRoot, "official.mvu-zod", source);
  await writeFile(path.join(projectRoot, "extensions", "official.mvu-zod", "source.yaml"), canonicalYaml({ ...source, project_kind: "worldbook" }), "utf8");
  await mkdir(path.join(projectRoot, ".workflow"), { recursive: true });
  await writeFile(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), "not: [valid", "utf8");
  await mkdir(path.join(projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
  await writeFile(path.join(projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"), JSON.stringify({
    id: "plugin-official.ejs",
    plugin_id: "official.ejs",
    revision: `sha256:${"a".repeat(64)}`,
    source_revision: `sha256:${"b".repeat(64)}`,
    resolved_source_hash: `sha256:${"c".repeat(64)}`,
    implementation: officialPluginImplementationPin("official.ejs"),
    generated_at: "2026-07-22T00:00:00.000Z",
    status: "approved",
  }), "utf8");
  const pluginLoaded = await loadAuthorProject(workspace.projectsRoot, "author-demo");
  expect(pluginLoaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    "PLUGIN_SOURCE_INVALID",
    "PLUGIN_SELECTION_INVALID",
    "PLUGIN_ARTIFACT_ID_MISMATCH",
  ]));

  const worldWorkspace = await makeTemporaryWorkspace();
  cleanups.push(worldWorkspace.cleanup);
  const worldRoot = await initializeProject({
    projectsRoot: worldWorkspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "world-guards",
      title: "World guards",
      kind: "worldbook",
      card: { name: "World guards" },
      characters: [],
    }),
    world: { enabled: true, categories: ["geography"] },
  });


  await mkdir(path.join(worldRoot, "world", "geography"), { recursive: true });
  await writeFile(path.join(worldRoot, "world", "geography", "notes.yaml"), "not: [valid", "utf8");
  const worldLoaded = await loadAuthorProject(worldWorkspace.projectsRoot, "world-guards");
  expect(worldLoaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    "YAML_PARSE_ERROR",
  ]));
});
it("covers loader relationship kind, world format, and artifact parse guards", async () => {
  const relationshipWorkspace = await makeTemporaryWorkspace();
  cleanups.push(relationshipWorkspace.cleanup);
  const relationshipRoot = await initializeProject({
    projectsRoot: relationshipWorkspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "relationship-guards",
      title: "Relationship guards",
      kind: "character_card",
      card: { name: "Relationship guards" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }, { id: "bob", display_name: "Bob", mode: "palette", role: "supporting" }],
    }),
    relationships: { enabled: true, character_ids: ["alice", "bob"], requirements: [], extensions: {} },
    world: { enabled: true, categories: ["geography"] },
  });
  type BlueprintFixture = Record<string, unknown> & { relationships: { character_ids: string[] }; characters: Array<Record<string, unknown>> };
  const relationshipBlueprint = parseYaml(await readFile(path.join(relationshipRoot, "blueprint.yaml"), "utf8")) as BlueprintFixture;
  relationshipBlueprint.relationships.character_ids = ["alice", "missing-character"];
  relationshipBlueprint.characters.push({ id: "missing-character", display_name: "Missing", mode: "zhuji", core_concept: "Missing for loader guard", fact_refs: [], extensions: {} });
  await writeFile(path.join(relationshipRoot, "blueprint.yaml"), canonicalYaml(relationshipBlueprint), "utf8");
  await mkdir(path.join(relationshipRoot, "world", "geography"), { recursive: true });
  await writeFile(path.join(relationshipRoot, "world", "geography", "notes.json"), "{}", "utf8");
  const relationshipLoaded = await loadAuthorProject(relationshipWorkspace.projectsRoot, "relationship-guards");
  expect(relationshipLoaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
    "RELATIONSHIPS_CHARACTER_MISSING",
    "WORLD_FILE_FORMAT_INVALID",
  ]));

  const worldWorkspace = await makeTemporaryWorkspace();
  cleanups.push(worldWorkspace.cleanup);
  const worldRoot = await initializeProject({
    projectsRoot: worldWorkspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "world-relationship-guards",
      title: "World relationship guards",
      kind: "worldbook",
      card: { name: "World relationship guards" },
      characters: [],
    }),
    world: { enabled: true, categories: ["geography"] },
  });
  const worldBlueprint = parseYaml(await readFile(path.join(worldRoot, "blueprint.yaml"), "utf8")) as BlueprintFixture;
  worldBlueprint.characters = [
    { id: "ghost-a", display_name: "Ghost A", mode: "zhuji", core_concept: "World guard", fact_refs: [], extensions: {} },
    { id: "ghost-b", display_name: "Ghost B", mode: "zhuji", core_concept: "World guard", fact_refs: [], extensions: {} },
  ];
  worldBlueprint.relationships = { enabled: true, character_ids: ["ghost-a", "ghost-b"], requirements: [], extensions: {} };
  await writeFile(path.join(worldRoot, "blueprint.yaml"), canonicalYaml(worldBlueprint), "utf8");
  const worldLoaded = await loadAuthorProject(worldWorkspace.projectsRoot, "world-relationship-guards");
  expect(worldLoaded.diagnostics.map((item) => item.code)).toContain("RELATIONSHIPS_PROJECT_KIND_INVALID");

  const artifactWorkspace = await makeTemporaryWorkspace();
  cleanups.push(artifactWorkspace.cleanup);
  const artifactRoot = await initializeProject({ projectsRoot: artifactWorkspace.projectsRoot, manifest: projectManifestSchema.parse({ ...manifest(), plugins: ["official.mvu-zod"] }) });
  await mkdir(path.join(artifactRoot, ".workflow", "plugin-artifacts"), { recursive: true });
  await writeFile(path.join(artifactRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"), "not-json", "utf8");
  const artifactLoaded = await loadAuthorProject(artifactWorkspace.projectsRoot, "author-demo");
  expect(artifactLoaded.diagnostics.map((item) => item.code)).toContain("PLUGIN_ARTIFACT_INVALID");
});
