import { canonicalProjectIrSchema, type PluginContributions } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  deepMergeJson,
  downgradeCharacterCardV3ToV2,
  emitCharacterCardV3,
  emitLorebookV3,
  applyPluginContributionsToCharacterCard,
  applyPluginGreetingOperations,
} from "../src/index.js";

function canonicalProject() {
  return canonicalProjectIrSchema.parse({
    schema_version: 1,
    project_id: "demo",
    title: "示範",
    card: { name: "示範卡", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
    characters: [
      {
        id: "alice",
        display_name: "愛麗絲",
        aliases: [],
        summary: "摘要",
        mode: "zhuji",
        role: "primary",
        extensions: {},
      },
    ],
    greetings: [
      { id: "primary", kind: "primary", content: "首發", character_ids: ["alice"], provenance: [], extensions: {} },
      { id: "alt", kind: "alternate", content: "替代", character_ids: ["alice"], provenance: [], extensions: {} },
      { id: "group", kind: "group_only", content: "群組", character_ids: ["alice"], provenance: [], extensions: {} },
    ],
    entries: [
      {
        id: "character.alice.self_introduction",
        owner_id: "alice",
        category: "character_core",
        title: "自我介紹",
        fragments: [
          { id: "character.alice.self_introduction.main", title: "自我介紹", content: "我是愛麗絲。", provenance: [], extensions: {} },
        ],
        activation: { type: "constant" },
        placement: { type: "before_character" },
        recursion: { incoming: false, outgoing: false, max_depth: 4, depends_on: [] },
        insertion_order: 100,
        priority: 0,
        provenance: [],
        extensions: { position: 999, vendor: { array: [1, 2], keep: true } },
        decisions: [],
      },
    ],
    extensions: { vendor: { nested: { keep: true } } },
  });
}

function hasUuidWithField(value: unknown, field: string, expected: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record[field] === expected
    && typeof record.id === "string"
    && /^[0-9a-f-]{36}$/u.test(record.id);
}

function arrayValues(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

describe("CCv3 emit", () => {
  it("將 typed plugin contributions 映射到精確 CCv3 路徑並保持 managed append idempotent", () => {
    const contribution: PluginContributions = {
      schema_version: 1,
      plugin_id: "official.ejs",
      implementation: {
        version: "1.0.0",
        digest: `sha256:${"a".repeat(64)}`,
        asset_manifest_id: "sillytavern-assets",
        asset_manifest_revision: `sha256:${"b".repeat(64)}`,
        asset_manifest_hash: `sha256:${"c".repeat(64)}`,
      },
      artifact_revision: `sha256:${"d".repeat(64)}`,
      lore_entries: [{
        id: "plugin.ejs.entry",
        name: "EJS entry",
        keys: [],
        content: "<% if (true) { %>ok<% } %>",
        enabled: true,
        insertion_order: 20_000,
        extensions: { "card-workspace/plugin": "official.ejs" },
      }],
      regex_scripts: [{
        scriptName: "EJS regex",
        findRegex: "x",
        replaceString: "y",
        trimStrings: [],
        placement: [1],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: false,
      }],
      helper_scripts: [{
        type: "script",
        enabled: true,
        id: "ejs-helper",
        name: "EJS helper",
        content: "export const ok = true;",
        info: "generated",
         button: { enabled: false, buttons: [] },
        data: {},
      }],
      greeting_operations: [{ greeting_id: "primary", mode: "append", content: "\nplugin" }],
      metadata: { source: "test" },
    };
    const base = emitCharacterCardV3(canonicalProject());
    const card = emitCharacterCardV3(canonicalProject(), { pluginContributions: [contribution] });
    expect(card.data.first_mes).toBe("首發\nplugin");
    expect(card.data.character_book?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plugin.ejs.entry", content: contribution.lore_entries[0]!.content }),
    ]));
    expect(arrayValues(card.data.extensions.regex_scripts).some((value) => hasUuidWithField(value, "scriptName", "EJS regex"))).toBe(true);
    expect(arrayValues(card.data.extensions["tavern_helper/scripts"]).some((value) => hasUuidWithField(value, "name", "EJS helper"))).toBe(true);
    const once = applyPluginContributionsToCharacterCard(base, [contribution]);
    expect(applyPluginContributionsToCharacterCard(once, [contribution])).toEqual(once);
    const greeting = canonicalProject().greetings[0]!;
    const greetingOnce = applyPluginGreetingOperations(greeting, [contribution]);
    expect(applyPluginGreetingOperations({ ...greeting, content: greetingOnce }, [contribution])).toBe(greetingOnce);
  });

  it("同一 managed ID 的不同內容 fail closed", () => {
    const contribution: PluginContributions = {
      schema_version: 1,
      plugin_id: "official.ejs",
      implementation: {
        version: "1.0.0",
        digest: `sha256:${"a".repeat(64)}`,
        asset_manifest_id: "sillytavern-assets",
        asset_manifest_revision: `sha256:${"b".repeat(64)}`,
        asset_manifest_hash: `sha256:${"c".repeat(64)}`,
      },
      artifact_revision: `sha256:${"d".repeat(64)}`,
      lore_entries: [{ id: "plugin.ejs.entry", name: "one", keys: [], content: "one", enabled: true, insertion_order: 1, extensions: {} }],
      regex_scripts: [],
      helper_scripts: [],
      greeting_operations: [],
      metadata: {},
    };
    const card = emitCharacterCardV3(canonicalProject());
    const changed = { ...contribution, lore_entries: [{ ...contribution.lore_entries[0]!, content: "two" }] };
    expect(() => applyPluginContributionsToCharacterCard(card, [contribution, changed])).toThrow("collision");
  });

  it("輸出 standalone lorebook_v3 並重用完整 entry mapping", () => {
    const project = canonicalProjectIrSchema.parse({
      ...canonicalProject(),
      project_kind: "worldbook",
      characters: [],
      greetings: [],
    });
    const worldbook = emitLorebookV3(project);
    expect(worldbook).toMatchObject({
      spec: "lorebook_v3",
      data: {
        name: "示範卡",
        entries: [{ id: "character.alice.self_introduction", use_regex: false, extensions: { position: 0 } }],
      },
    });
    expect(worldbook).not.toHaveProperty("data.first_mes");
    expect(() => emitCharacterCardV3(project)).toThrow("不可輸出角色卡");
  });

  it("輸出 canonical V3、minimal-worldbook 與三類 greetings", () => {
    const card = emitCharacterCardV3(canonicalProject());
    expect(card).toMatchObject({ spec: "chara_card_v3", spec_version: "3.0" });
    expect(card).not.toHaveProperty("name");
    expect(card.data).toMatchObject({
      name: "示範卡",
      description: "",
      personality: "",
      scenario: "",
      mes_example: "",
      first_mes: "首發",
      alternate_greetings: ["替代"],
      group_only_greetings: ["群組"],
    });
    expect(card.data.character_book?.entries[0]).toMatchObject({
      id: "character.alice.self_introduction",
      use_regex: false,
      extensions: { position: 0, exclude_recursion: true, prevent_recursion: true },
    });
    expect(card.data.character_book?.entries[0]?.content).toContain("<lore_entry");
    expect(card.data.character_book?.entries[0]?.content).toContain("我是愛麗絲。");
  });

  it("deep merge 物件且陣列使用 generated replace", () => {
    expect(
      deepMergeJson(
        { object: { old: true }, array: [1, 2] },
        { object: { next: true }, array: [3] },
      ),
    ).toEqual({ object: { old: true, next: true }, array: [3] });
  });

  it("完整映射 placement、activation、raw content 與遞迴 extension", () => {
    const project = canonicalProject();
    const base = project.entries[0]!;
    const variants = [
      { id: "before", placement: { type: "before_character" as const }, activation: { type: "disabled" as const } },
      { id: "after", placement: { type: "after_character" as const }, activation: { type: "constant" as const } },
      { id: "note-before", placement: { type: "authors_note" as const, side: "before" as const }, activation: { type: "constant" as const } },
      { id: "note-after", placement: { type: "authors_note" as const, side: "after" as const }, activation: { type: "constant" as const } },
      { id: "depth", placement: { type: "at_depth" as const, depth: 7, role: "assistant" as const }, activation: { type: "constant" as const } },
      { id: "before-examples", placement: { type: "before_examples" as const }, activation: { type: "constant" as const } },
      { id: "after-examples", placement: { type: "after_examples" as const }, activation: { type: "constant" as const } },
      { id: "outlet", placement: { type: "outlet" as const, name: "memory" }, activation: { type: "conditional" as const, plugin: "rules", expression: "enabled" } },
      {
        id: "keyed",
        placement: { type: "at_depth" as const, depth: 2, role: "user" as const },
        activation: {
          type: "keyed" as const,
          keys: ["Alice"],
          secondary_keys: ["friend"],
          secondary_logic: "all" as const,
          use_regex: true,
          case_sensitive: true,
          match_whole_words: true,
          scan_depth: 5,
          group: "friends",
          triggers: ["normal" as const],
        },
      },
    ].map((variant, index) => ({
      ...base,
      ...variant,
      title: variant.id,
      fragments: [{ ...base.fragments[0]!, id: `fragment-${index}`, content: `raw-${index}` }],
      content_format: "raw" as const,
      recursion: { ...base.recursion, incoming: true, outgoing: true, delay_until_recursion: 2 },
    }));
    const card = emitCharacterCardV3(canonicalProjectIrSchema.parse({
      ...project,
      entries: variants,
      passthrough: { character_book: { extensions: [] } },
    }));
    const entries = card.data.character_book!.entries;
    expect(entries.map((entry) => entry.extensions.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 4]);
    expect(entries[4]).toMatchObject({ content: "raw-4", extensions: { depth: 7, role: 2, delay_until_recursion: 2 } });
    expect(entries[7]).toMatchObject({ enabled: true, extensions: { outlet_name: "memory", "card-workspace/conditional": { plugin: "rules" } } });
    expect(entries[8]).toMatchObject({
      keys: ["Alice"], secondary_keys: ["friend"], use_regex: true, selective: true,
      extensions: { selectiveLogic: 3, match_whole_words: true, case_sensitive: true, scan_depth: 5, group: "friends" },
    });
    expect(entries[0]?.enabled).toBe(false);
  });

  it("自然匯出 ownerless relationships raw team body", () => {
    const project = canonicalProject();
    const relationship = {
      ...project.entries[0]!,
      id: "project.relationships",
      owner_id: undefined,
      title: "角色關係",
      category: "project_relationships",
      fragments: [{ id: "project.relationships.main", title: "角色關係", content: "<team_ABC123>\n關係正文\n</team_ABC123>", provenance: [], extensions: {} }],
      content_format: "raw" as const,
      activation: { type: "keyed" as const, keys: ["愛麗絲"], secondary_keys: [], secondary_logic: "any" as const, use_regex: false, case_sensitive: false, match_whole_words: false, triggers: [] },
    };
    delete relationship.owner_id;
    const card = emitCharacterCardV3(canonicalProjectIrSchema.parse({ ...project, entries: [relationship] }));
    expect(card.data.character_book?.entries[0]).toMatchObject({
      id: "project.relationships",
      keys: ["愛麗絲"],
      content: "<team_ABC123>\n關係正文\n</team_ABC123>",
    });
  });

  it("拒絕缺少 primary greeting 的 canonical IR", () => {
    const project = canonicalProject();
    expect(() => emitCharacterCardV3({ ...project, greetings: project.greetings.filter((item) => item.kind !== "primary") }))
      .toThrow("Canonical IR 缺少 primary greeting");
  });
});

describe("V2 downgrade", () => {
  it("不是只改 discriminator，會移除 V3-only 欄位並回報損失", () => {
    const card = emitCharacterCardV3(canonicalProject());
    const result = downgradeCharacterCardV3ToV2(card);
    expect(result.card).toMatchObject({ spec: "chara_card_v2", spec_version: "2.0" });
    expect(result.card.data).not.toHaveProperty("group_only_greetings");
    expect(result.card.data.character_book?.entries[0]).not.toHaveProperty("use_regex");
    expect(result.card.data.creator_notes).toContain("由 CCv3 降級");
    expect(result.losses).toContainEqual(
      expect.objectContaining({ path: "/data/group_only_greetings" }),
    );
  });
});
