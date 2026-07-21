import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalYaml, computeRevision, initializeProject, loadAuthorProject, orderedYaml } from "@card-workspace/project";
import { factRegisterSchema, projectManifestSchema, relationshipsDocumentSchema, zhujiModuleSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { normalizeAuthorProject, planCanonicalProject } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function makeProject(mode: "zhuji" | "palette" = "zhuji") {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const manifest = projectManifestSchema.parse({
    schema_version: 1,
    id: "forge-demo",
    title: "Forge 示範",
    kind: "character_card",
    card: { name: "Forge 卡" },
    characters: [{ id: "alice", display_name: "愛麗絲", mode, role: "primary" }],
  });
  const projectRoot = await initializeProject({ projectsRoot: workspace.projectsRoot, manifest });
  return { workspace, projectRoot };
}

describe("normalizeAuthorProject", () => {
  it("產生 deterministic 語意節點且模組7不進 greeting", async () => {
    const { workspace } = await makeProject();
    const loaded = await loadAuthorProject(workspace.projectsRoot, "forge-demo");
    const first = normalizeAuthorProject(loaded);
    const second = normalizeAuthorProject(loaded);
    expect(first).toEqual(second);
    expect(first.ir?.nodes.map((node) => node.id)).not.toContain("character.alice.identity");
    expect(first.ir?.nodes.map((node) => node.id)).toContain("character.alice.self_introduction");
    expect(first.ir?.greetings).toHaveLength(1);
    expect(first.ir?.greetings[0]).toMatchObject({ id: "primary", kind: "primary" });
    expect(JSON.stringify(first.ir)).not.toContain('"module":"self_introduction","kind":"primary"');
  });

  it("顯示名稱變更不改 stable node IDs", async () => {
    const { workspace, projectRoot } = await makeProject();
    const before = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    const characterPath = path.join(projectRoot, "characters", "alice", "character.yaml");
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(characterPath, "utf8"));
    await writeFile(characterPath, source.replace("display_name: 愛麗絲", "display_name: Alice"), "utf8");
    const manifestPath = path.join(projectRoot, "project.yaml");
    const manifestSource = await import("node:fs/promises").then(({ readFile }) => readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, manifestSource.replace("display_name: 愛麗絲", "display_name: Alice"), "utf8");
    const after = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    expect(after.ir?.nodes.map((node) => node.id)).toEqual(before.ir?.nodes.map((node) => node.id));
  });

  it("保留 typed fact ref，但不以 fact value 改寫作者內容", async () => {
    const { workspace, projectRoot } = await makeProject();
    const modulePath = path.join(projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
    const raw = await readFile(modulePath, "utf8");
    await writeFile(
      modulePath,
      raw.replace("provenance: []", "provenance:\n  - kind: fact\n    ref: fact-secret"),
      "utf8",
    );
    const facts = [{
      schema_version: 1 as const,
      id: "fact-secret",
      subject: "alice",
      predicate: "appearance.secret",
      value: "MUST_NOT_BE_INJECTED",
      classification: "creative_completion" as const,
      confidence: 1,
      scope: { character_ids: [], extensions: {} },
      valid_time: { extensions: {} },
      evidence: [],
      source_tiers: ["user_original" as const],
      status: "accepted" as const,
      fact_revision: 1,
      decision_id: "decision-secret",
      created_by: "user",
      created_at: "2026-07-13T10:00:00.000Z",
      supersedes: [],
      decision_ids: ["decision-secret"],
      extensions: {},
    }];
    const state = { schema_version: 1 as const, facts, extensions: {} };
    await writeFile(
      path.join(projectRoot, "facts", "register.yaml"),
      canonicalYaml(factRegisterSchema.parse({ ...state, revision: computeRevision(state) })),
      "utf8",
    );
    const result = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    const appearance = result.ir?.nodes.find((node) => node.id === "character.alice.appearance");
    expect(appearance?.fragments[0]?.provenance).toEqual([{
      kind: "fact",
      ref: "fact-secret",
      requires_single_value: false,
      extensions: {},
    }]);
    expect(JSON.stringify(result.ir)).not.toContain("MUST_NOT_BE_INJECTED");
  });

  it("將 structured Zhuji data 依作者欄位順序序列化為單一 YAML fragment", async () => {
    const { workspace, projectRoot } = await makeProject();
    const modulePath = path.join(projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
    const data = {
      外顯核心: { 姓名: "愛麗絲" }, 面貌: {}, 身體基礎數據: {}, 性器官特徵: {}, 其他器官特徵: {},
      聲音: {}, 服裝風格與著裝習慣: {}, 交互模式: {}, 整體感官體驗: {},
    };
    await writeFile(modulePath, canonicalYaml(zhujiModuleSchema.parse({
      schema_version: 1,
      mode: "zhuji",
      module: "appearance",
      title: "外顯",
      data,
      provenance: [{ kind: "creator", note: "structured data" }],
    })), "utf8");

    const result = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    const appearance = result.ir?.nodes.find((node) => node.id === "character.alice.appearance");
    expect(appearance?.fragments).toHaveLength(1);
    expect(appearance?.fragments[0]?.content).toBe(orderedYaml(data));
    expect(appearance?.fragments[0]?.content.indexOf("外顯核心:")).toBeLessThan(
      appearance?.fragments[0]?.content.indexOf("交互模式:") ?? -1,
    );
    expect(appearance?.fragments[0]?.provenance[0]).toMatchObject({ kind: "creator", note: "structured data" });
  });

  it("將共享關係正規化為 ownerless raw 節點並以參與者名稱與 aliases 啟動", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const manifest = projectManifestSchema.parse({
      schema_version: 1,
      id: "relationship-demo",
      title: "關係示範",
      kind: "character_card",
      card: { name: "關係卡" },
      characters: [
        { id: "alice", display_name: "愛麗絲", mode: "zhuji", role: "primary" },
        { id: "bob", display_name: "鮑伯", mode: "palette", role: "supporting" },
      ],
    });
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest,
      relationships: { enabled: true, character_ids: ["alice", "bob"], requirements: [], extensions: {} },
    });
    const alicePath = path.join(projectRoot, "characters", "alice", "character.yaml");
    await writeFile(alicePath, (await readFile(alicePath, "utf8")).replace("aliases: []", "aliases:\n  - 小愛"), "utf8");
    await writeFile(path.join(projectRoot, "relationships.yaml"), canonicalYaml(relationshipsDocumentSchema.parse({
      schema_version: 1,
      team_code: "TEAM42",
      character_ids: ["alice", "bob"],
      character_summaries: [
        { character_id: "alice", summary: "冷靜領隊" },
        { character_id: "bob", summary: "直率夥伴" },
      ],
      perspectives: [
        { source_character_id: "alice", target_character_id: "alice", summary: "自認理性" },
        { source_character_id: "alice", target_character_id: "bob", summary: "信任其直覺" },
        { source_character_id: "bob", target_character_id: "alice", summary: "尊敬但會質疑" },
        { source_character_id: "bob", target_character_id: "bob", summary: "自認坦率" },
      ],
      groups: [{ id: "pair", name: "搭檔", member_ids: ["alice", "bob"], formation_cause: "共同任務", operating_pattern: "互補", exclusivity: "低", latent_conflicts: ["決策速度"], joining_conditions: "互信" }],
      summary: { network_character: "互補", inter_group_relations: "單一搭檔", stability: "穩定", conflict_triggers: [{ trigger: "獨斷", severity: "high" }], intimacy_opportunities: ["共同冒險"] },
    })), "utf8");

    const normalized = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "relationship-demo"));
    const node = normalized.ir?.nodes.find((item) => item.id === "project.relationships");
    expect(node).toMatchObject({ aliases: ["愛麗絲", "小愛", "鮑伯"], content_format: "raw" });
    expect(node).not.toHaveProperty("owner_id");
    expect(node?.fragments[0]?.content).toContain("<team_TEAM42>");
    expect(node?.fragments[0]?.content).toContain("愛麗絲 -> 鮑伯：信任其直覺");
    expect(node?.fragments[0]?.content).toContain("小團體");
    expect(node?.fragments[0]?.content).not.toContain("thinking");
    const planned = planCanonicalProject(normalized.ir!);
    const entry = planned.ir?.entries.find((item) => item.id === "project.relationships");
    expect(entry?.activation).toMatchObject({ type: "keyed", keys: ["愛麗絲", "小愛", "鮑伯"] });
    expect(entry).not.toHaveProperty("owner_id");
  });
});

describe("planCanonicalProject", () => {
  it("所有角色條目只以正式名稱與 aliases 啟動並使用穩定順序", async () => {
    const { workspace, projectRoot } = await makeProject();
    const characterPath = path.join(projectRoot, "characters", "alice", "character.yaml");
    const source = await readFile(characterPath, "utf8");
    await writeFile(characterPath, source.replace("aliases: []", "aliases:\n  - 小愛\n  - 愛麗絲小姐"), "utf8");
    const normalized = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    const planned = planCanonicalProject(normalized.ir!);
    expect(planned.ok).toBe(true);
    const characterEntries = planned.ir?.entries.filter((entry) => entry.owner_id === "alice") ?? [];
    expect(characterEntries.map((entry) => entry.id)).toEqual([
      "character.alice.appearance",
      "character.alice.inner_nature",
      "character.alice.extension",
      "character.alice.trait_refinement",
      "character.alice.trait_dialogue",
      "character.alice.scene_dialogue",
      "character.alice.self_introduction",
    ]);
    for (const entry of characterEntries) {
      expect(entry.activation).toMatchObject({
        type: "keyed",
        keys: ["愛麗絲", "小愛", "愛麗絲小姐"],
      });
      if (entry.activation.type !== "keyed") throw new Error("角色條目應使用 keyed activation");
      expect(entry.activation.keys).not.toContain(entry.title);
    }
    const orders = planned.ir?.entries.map((entry) => entry.insertion_order) ?? [];
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
  });

  it("拒絕遞迴依賴 cycle", async () => {
    const { workspace } = await makeProject();
    const normalized = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    if (!normalized.ir) throw new Error("正規化失敗");
    const ir = structuredClone(normalized.ir);
    ir.nodes[0]!.compile.recursion = {
      type: "chain",
      incoming: true,
      outgoing: true,
      max_depth: 4,
      depends_on: [ir.nodes[1]!.id],
    };
    ir.nodes[1]!.compile.recursion = {
      type: "chain",
      incoming: true,
      outgoing: true,
      max_depth: 4,
      depends_on: [ir.nodes[0]!.id],
    };
    const planned = planCanonicalProject(ir);
    expect(planned.ok).toBe(false);
    expect(planned.diagnostics.map((item) => item.code)).toContain("RECURSION_DEPENDENCY_CYCLE");
  });

  it("Palette 條目依作者檔案順序輸出", async () => {
    const { workspace } = await makeProject("palette");
    const normalized = normalizeAuthorProject(await loadAuthorProject(workspace.projectsRoot, "forge-demo"));
    const planned = planCanonicalProject(normalized.ir!);
    expect(planned.ir?.entries.filter((entry) => entry.owner_id === "alice").map((entry) => entry.id)).toEqual([
      "character.alice.basic_information",
      "character.alice.personality_palette",
      "character.alice.tri_faceted",
      "character.alice.secondary_interpretation",
    ]);
  });
});
