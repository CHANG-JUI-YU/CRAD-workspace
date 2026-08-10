import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProjectRepository, contentHash, type ArtifactRecord } from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file project repository", () => {
  function artifact(kind: ArtifactRecord["kind"], name: string, content: string, media_type = "application/json"): ArtifactRecord {
    const hash = contentHash(content);
    const timestamp = new Date().toISOString();
    return { id: `${kind}-${name}`, key: `${kind}:${name}`, kind, name, content, media_type, content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "test", operation_id: "op" };
  }

  it("persists an atomic state and can reopen it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-"));
    temporaryRoots.push(root);
    const first = new FileProjectRepository(root, "demo");
    await first.commit(0, (state) => ({ ...state, candidates: [{ id: "candidate-1", title: "Persistent", status: "pending" }] }));
    const raw = await readFile(path.join(root, "demo", "state.json"), "utf8");
    expect(JSON.parse(raw).revision).toBe(1);
    const reopened = new FileProjectRepository(root, "demo");
    expect((await reopened.read()).candidates[0]?.title).toBe("Persistent");
  });

  it("fails closed when an existing state file is corrupted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-corrupt-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "demo"), { recursive: true });
    await writeFile(path.join(root, "demo", "state.json"), "{not-json", "utf8");
    await expect(new FileProjectRepository(root, "demo").read()).rejects.toThrow();
  });

  it("creates missing state files and rejects stale file revisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-missing-"));
    temporaryRoots.push(root);
    const repository = new FileProjectRepository(root, "demo");
    expect((await repository.read()).revision).toBe(0);
    await repository.commit(0, (state) => ({ ...state }));
    await expect(repository.commit(0, (state) => ({ ...state }))).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("creates the standard project files immediately for a new materialized project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-new-materialize-"));
    temporaryRoots.push(root);
    const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
    const state = await repository.read();
    expect(state.revision).toBe(0);
    await expect(readFile(path.join(root, "demo", "project.json"), "utf8")).resolves.toContain('"project_id":"demo"');
    await expect(readFile(path.join(root, "demo", ".workspace", "interview.json"), "utf8")).resolves.toContain('"status":"idle"');
    await expect(readFile(path.join(root, "demo", "sources", "manifest.json"), "utf8")).resolves.toContain('"candidates":[]');
  });

  it("archives the legacy root state, proposals and exports before materializing semantic paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-legacy-migration-"));
    temporaryRoots.push(root);
    const legacy = new FileProjectRepository(root, "demo");
    const blueprint = artifact("blueprint", "legacy", JSON.stringify({ kind: "blueprint", concept: "legacy concept" }));
    await legacy.commit(0, (state) => ({ ...state, project_name: "Legacy", project_status: "ready", artifacts: [blueprint] }));
    await mkdir(path.join(root, "demo", "proposals"), { recursive: true });
    await mkdir(path.join(root, "demo", "exports"), { recursive: true });
    await writeFile(path.join(root, "demo", "proposals", "draft.yaml"), "draft: true", "utf8");
    await writeFile(path.join(root, "demo", "exports", "card.json"), "legacy export", "utf8");

    const migrated = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
    const state = await migrated.read();
    expect(state.project_name).toBe("Legacy");
    expect(await readFile(path.join(root, "demo", "blueprint", "blueprint.json"), "utf8")).toContain("legacy concept");
    await expect(readFile(path.join(root, "demo", "proposals", "draft.yaml"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(root, "demo", "exports", "card.json"), "utf8")).rejects.toThrow();
    const migrations = await readdir(path.join(root, "demo", ".workspace", "legacy-layout"));
    expect(migrations).toHaveLength(1);
    const archived = await readdir(path.join(root, "demo", ".workspace", "legacy-layout", migrations[0]!));
    expect(archived).toEqual(expect.arrayContaining(["state.json", "proposals", "exports", "migration.json"]));
    await migrated.read();
    expect(await readdir(path.join(root, "demo", ".workspace", "legacy-layout"))).toEqual(migrations);
  });

  it("keeps the latest published exports when migrating a legacy layout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-legacy-keep-"));
    temporaryRoots.push(root);
    const legacy = new FileProjectRepository(root, "demo");
    const blueprint = artifact("blueprint", "legacy", JSON.stringify({ kind: "blueprint", concept: "legacy concept" }));
    const timestamp = new Date().toISOString();
    await legacy.commit(0, (state) => ({
      ...state,
      project_name: "Legacy",
      project_status: "published",
      artifacts: [blueprint],
      publishes: [{ id: "publish-1", operation_id: "op-publish", artifact_ids: ["artifact-1"], content: "published content", content_hash: contentHash("published content"), export_json_path: "exports/Legacy-珠璣角色卡.json", export_png_path: "exports/Legacy-珠璣角色卡.png", created_at: timestamp }],
    }));
    await mkdir(path.join(root, "demo", "proposals"), { recursive: true });
    await mkdir(path.join(root, "demo", "exports"), { recursive: true });
    await writeFile(path.join(root, "demo", "proposals", "draft.yaml"), "draft: true", "utf8");
    await writeFile(path.join(root, "demo", "exports", "Legacy-珠璣角色卡.json"), "latest export", "utf8");
    await writeFile(path.join(root, "demo", "exports", "old.json"), "old export", "utf8");

    const migrated = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
    const state = await migrated.read();
    expect(state.publishes).toHaveLength(1);
    await expect(readFile(path.join(root, "demo", "exports", "Legacy-珠璣角色卡.json"), "utf8")).resolves.toContain("published content");
    await expect(readFile(path.join(root, "demo", "exports", "old.json"), "utf8")).rejects.toThrow();
    const migrations = await readdir(path.join(root, "demo", ".workspace", "legacy-layout"));
    expect(migrations).toHaveLength(1);
    const archived = await readdir(path.join(root, "demo", ".workspace", "legacy-layout", migrations[0]!));
    expect(archived).toEqual(expect.arrayContaining(["state.json", "proposals", "exports", "migration.json"]));
    const archivedExports = await readdir(path.join(root, "demo", ".workspace", "legacy-layout", migrations[0]!, "exports"));
    expect(archivedExports).toEqual(["old.json"]);
  });

  it("reconciles an existing state-only project without changing its revision", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-reconcile-"));
    temporaryRoots.push(root);
    const blueprint = artifact("blueprint", "Rina", "# Blueprint\n\nA stable character concept.", "text/markdown");
    const stateOnly = new FileProjectRepository(root, "demo", { layout: "project" });
    await stateOnly.commit(0, (state) => ({ ...state, project_status: "ready", artifacts: [blueprint] }));
    const materialized = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });

    const first = await materialized.read();
    const projectFile = await readFile(path.join(root, "demo", "project.json"), "utf8");
    expect(first.revision).toBe(1);
    expect(projectFile).toContain('"status":"ready"');
    await expect(readFile(path.join(root, "demo", "blueprint", "blueprint.json"), "utf8")).resolves.toContain("A stable character concept.");

    const second = await materialized.read();
    expect(second.revision).toBe(first.revision);
    await expect(readFile(path.join(root, "demo", "project.json"), "utf8")).resolves.toBe(projectFile);
  });

  it("groups character, zhuji, and palette files under id-display-name folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-character-folders-"));
    temporaryRoots.push(root);
    const displayName = "\u8389\u5948";
    const rina = artifact("character", "legacy-rina-name", JSON.stringify({
      kind: "character",
      document: { schema_version: 1, id: "rina", display_name: displayName, summary: "Rina" },
    }));
    const other = artifact("character", "legacy-other-name", JSON.stringify({
      kind: "character",
      document: { schema_version: 1, id: "other", display_name: displayName, summary: "Other" },
    }));
    const rinaZhuji = artifact("zhuji", "rina/appearance", JSON.stringify({ kind: "zhuji", character_id: "rina", module: { module: "appearance" } }));
    const rinaPalette = artifact("palette", "rina/basic_information", JSON.stringify({ kind: "palette", character_id: "rina", module: { module: "basic_information" } }));
    const rinaWardrobePrevious = { ...artifact("wardrobe", "rina/wardrobe", "# Rina 的衣櫃（舊版）\n\n## 衣櫃概況\n- 總件數：1\n\n## 上衣\n| 款式 | 顏色／材質 | 數量 |\n| --- | --- | ---: |\n| 灰色 T 恤 | 棉質 | 1 |\n", "text/markdown"), id: "wardrobe-previous" };
    const rinaWardrobe = { ...artifact("wardrobe", "rina/wardrobe", "# Rina 的衣櫃\n\n## 衣櫃概況\n- 總件數：1\n\n## 上衣\n| 款式 | 顏色／材質 | 數量 |\n| --- | --- | ---: |\n| 白色 T 恤 | 棉質 | 1 |\n", "text/markdown"), based_on: rinaWardrobePrevious.revision };
    const otherZhuji = artifact("zhuji", "other/appearance", JSON.stringify({ kind: "zhuji", character_id: "other", module: { module: "appearance" } }));
    const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });

    await repository.commit(0, (state) => ({ ...state, artifacts: [rina, other, rinaZhuji, rinaPalette, rinaWardrobePrevious, rinaWardrobe, otherZhuji] }));

    await expect(readFile(path.join(root, "demo", "characters", `rina-${displayName}`, "character.json"), "utf8")).resolves.toContain('"id":"rina"');
    await expect(readFile(path.join(root, "demo", "characters", `rina-${displayName}`, "zhuji", "appearance.json"), "utf8")).resolves.toContain('"character_id":"rina"');
    await expect(readFile(path.join(root, "demo", "characters", `rina-${displayName}`, "palette", "basic_information.json"), "utf8")).resolves.toContain('"character_id":"rina"');
    await expect(readFile(path.join(root, "demo", "characters", `rina-${displayName}`, "wardrobe", "wardrobe.md"), "utf8")).resolves.toContain("白色 T 恤");
    await expect(readFile(path.join(root, "demo", "characters", `rina-${displayName}`, "wardrobe", "revisions", `${rinaWardrobePrevious.revision}.md`), "utf8")).resolves.toContain("灰色 T 恤");
    await expect(readFile(path.join(root, "demo", "characters", `other-${displayName}`, "character.json"), "utf8")).resolves.toContain('"id":"other"');
    await expect(readFile(path.join(root, "demo", "characters", `other-${displayName}`, "zhuji", "appearance.json"), "utf8")).resolves.toContain('"character_id":"other"');
  });

  it("normalizes character ids and display names in canonical folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-character-folder-safe-"));
    temporaryRoots.push(root);
    const character = artifact("character", "legacy", JSON.stringify({
      kind: "character",
      document: { schema_version: 1, id: "rina id", display_name: "Rina / Prime", summary: "Safe path" },
    }));
    const zhuji = artifact("zhuji", "rina id/appearance", JSON.stringify({ kind: "zhuji", character_id: "rina id", module: { module: "appearance" } }));
    const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });

    await repository.commit(0, (state) => ({ ...state, artifacts: [character, zhuji] }));

    await expect(readFile(path.join(root, "demo", "characters", "rina-id-Rina---Prime", "character.json"), "utf8")).resolves.toContain('"id":"rina id"');
    await expect(readFile(path.join(root, "demo", "characters", "rina-id-Rina---Prime", "zhuji", "appearance.json"), "utf8")).resolves.toContain('"character_id":"rina id"');
  });

  it("rejects a corrupted file during the commit read path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-commit-corrupt-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "demo"), { recursive: true });
    await writeFile(path.join(root, "demo", "state.json"), "{broken", "utf8");
    await expect(new FileProjectRepository(root, "demo").commit(0, (state) => state)).rejects.toThrow();
  });

  it("materializes project files and artifact paths for all preserved kinds", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-materialize-"));
    temporaryRoots.push(root);
    const repository = new FileProjectRepository(root, "demo", { layout: "project", materialize: true });
    const artifacts = [
      artifact("character", "Yukino", JSON.stringify({ name: "Yukino" })),
      artifact("blueprint", "project", JSON.stringify({ concept: "calm" })),
      artifact("zhuji", "Yukino/appearance", JSON.stringify({ character_id: "Yukino", module: { module: "appearance" } })),
      artifact("palette", "Yukino/basic", JSON.stringify({ character_id: "Yukino", module: { module: "basic" } })),
      artifact("relationship", "network", "relationship" , "text/markdown"),
      artifact("world_lore", "world", "world", "text/markdown"),
      artifact("greeting", "greeting", "greeting", "text/markdown"),
      artifact("plugin", "demo", JSON.stringify({ plugin_id: "demo" })),
      artifact("review", "report", "review", "text/markdown"),
      artifact("character", "...", "already has a newline\n", "text/markdown"),
      artifact("zhuji", "fallback", "not-json"),
      artifact("palette", "fallback", JSON.stringify({ module: {} })),
      artifact("plugin", "fallback", "plugin text\n", "text/markdown"),
    ];
    const publishContent = `${JSON.stringify({ published: true })}\n`;
    const publishHash = contentHash(publishContent);
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Demo",
      project_slug: "demo",
      project_status: "ready",
      artifacts,
      publishes: [{ id: "publish-1", operation_id: "op", artifact_ids: [], content: publishContent, content_hash: publishHash, created_at: new Date().toISOString() }],
    }));
    expect(await readFile(path.join(root, "demo", "project.json"), "utf8")).toContain("Demo");
    expect(await readFile(path.join(root, "demo", "blueprint", "blueprint.json"), "utf8")).toContain("calm");
    expect(await readFile(path.join(root, "demo", "knowledge", "chunks.json"), "utf8")).toContain("[]");
    expect(await readFile(path.join(root, "demo", ".workspace", "workflow.json"), "utf8")).toContain("ready");
    expect(await readFile(path.join(root, "demo", "characters", "Yukino", "character.json"), "utf8")).toContain("Yukino");
    expect(await readFile(path.join(root, "demo", "characters", "Yukino", "zhuji", "appearance.json"), "utf8")).toContain("appearance");
    expect(await readFile(path.join(root, "demo", "characters", "Yukino", "palette", "basic.json"), "utf8")).toContain("basic");
    expect(await readFile(path.join(root, "demo", "relationships", "relationships.json"), "utf8")).toContain("relationship");
    expect(await readFile(path.join(root, "demo", "world", "world.json"), "utf8")).toContain("world");
    expect(await readFile(path.join(root, "demo", "greetings", "greetings.json"), "utf8")).toContain("greeting");
    expect(await readFile(path.join(root, "demo", "plugins", "demo.json"), "utf8")).toContain("plugin_id");
    await expect(readFile(path.join(root, "demo", ".workspace", "artifacts", "review", "report.md"), "utf8")).rejects.toThrow();
    expect(await readFile(path.join(root, "demo", "exports", "Demo-珠璣角色卡.json"), "utf8")).toContain("published");
  });
});
