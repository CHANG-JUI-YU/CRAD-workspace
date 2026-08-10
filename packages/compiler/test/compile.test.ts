import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord } from "@st-workspace/core";
import { readCardFromPng } from "@st-workspace/adapters-png";
import { compileProject, compileWorkspaceBundle } from "../src/index.js";

const momoka = "\u4e00\u689d\u6843\u83ef";
const worldbook = "\u4e16\u754c\u66f8";
const relationship = "\u95dc\u4fc2";
const wardrobe = "\u8863\u6ac3";

function artifact(id: string, key: string, kind: ArtifactRecord["kind"], name: string, value: unknown, mediaType = "application/json"): ArtifactRecord {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name, content, media_type: mediaType, content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "test", operation_id: "op" };
}

function character(id: string, displayName: string): unknown {
  return { kind: "character", document: { schema_version: 1, id, display_name: displayName, aliases: [], summary: "Base character data must not be copied into the card.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Do not copy this section.", provenance: [], extensions: {} }], provenance: [], extensions: {} } };
}

function zhuji(characterId: string, module: string, content: unknown): unknown {
  return { kind: "zhuji", character_id: characterId, module: { schema_version: 1, mode: "zhuji", module, title: module, data: content } };
}

function runtimeBlueprint(characters: Array<{ id: string; label?: string; display_name?: string; ordinal: number }>, primaryCharacterId?: string): unknown {
  return {
    schema_version: 1,
    kind: "blueprint",
    project_id: "runtime-blueprint",
    flow: "character",
    collaboration_mode: "independent",
    characters,
    intake_values: {},
    ...(primaryCharacterId === undefined ? {} : { primary_character_id: primaryCharacterId }),
    provenance: { blueprint_precheck_id: "precheck-1", checks: [] },
  };
}

function palette(characterId: string, module: string, content: string): unknown {
  return { kind: "palette", character_id: characterId, module: { schema_version: 1, mode: "palette", module, title: module, content, sections: {}, provenance: [], extensions: {} } };
}

function yamlArtifact(id: string, key: string, kind: ArtifactRecord["kind"], name: string, content: string): ArtifactRecord {
  return artifact(id, key, kind, name, content, "text/yaml");
}

describe("V3 compiler", () => {
  it("converts a workspace bundle into a Tavern-loadable CCv3 card without treating self-introduction as greeting", () => {
    const result = compileWorkspaceBundle({
      schema_version: 1,
      card: { project_id: "momoka", project_name: momoka, display_name: momoka, mode: "zhuji", artifact_versions: { appearance: "rev-1" } },
      blueprint: "characters:\n  - display_name: Momoka",
      zhuji_modules: {
        appearance: "appearance content",
        self_introduction: "self introduction content",
      },
      wardrobe: "# Momoka wardrobe",
    });
    const entries = result.card.data.character_book?.entries ?? [];
    expect(result.card).toMatchObject({ spec: "chara_card_v3", spec_version: "3.0", data: { name: momoka } });
    expect(result.card.data.description).toBe("");
    expect(result.card.data.personality).toBe("");
    expect(result.card.data.scenario).toBe("");
    expect(result.card.data.mes_example).toBe("");
    expect(result.card.data.creator_notes).toBe("");
    expect(result.card.data.system_prompt).toBe("");
    expect(result.card.data.post_history_instructions).toBe("");
    expect(result.card.data.first_mes).toBe("");
    expect(result.card.data.character_book?.name).toBe(`${momoka}_${worldbook}`);
    expect(entries.map((item) => item.name)).toEqual([`${momoka}_衣櫃`, `${momoka}_外觀`, `${momoka}_自我介紹`]);
    expect(entries.find((item) => item.name === `${momoka}_衣櫃`)?.content).toBe("# Momoka wardrobe");
    expect(entries.some((item) => item.content === "characters:\n  - display_name: Momoka")).toBe(false);
    expect(readCardFromPng(result.png).card).toEqual(result.card);
  });

  it("uses the project name and keeps generated plugin resources in technical extensions", async () => {
    const repository = new MemoryProjectRepository("demo");
    const plugin = { kind: "plugin", plugin_id: "official.html", capabilities: ["html.status_bar"], source: { plugin_id: "official.html", features: ["status_bar"], components: [{ id: "status", feature: "status_bar", tag: "div", label: "Status", text: [{ kind: "text", value: "Ready" }], binding_paths: [] }] } };
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Demo Project",
      artifacts: [artifact("character-1", "character:demo", "character", "Demo", character("demo", "Demo")), artifact("plugin-1", "plugin:official.html", "plugin", "official.html", plugin)],
    }));
    const result = compileProject(await repository.read());
    expect(result.card.data.name).toBe("Demo Project");
    expect(result.card.data.description).toBe("");
    expect(result.card.data.personality).toBe("");
    expect(result.card.data.scenario).toBe("");
    expect(result.card.data.character_book?.name).toBe("Demo Project_世界書");
    expect(result.plugin_trace.plugins.map((item) => item.plugin_id)).toEqual(["official.html"]);
    expect(readCardFromPng(result.png).card).toEqual(result.card);
  });

  it("puts the complete wardrobe in a named worldbook entry instead of card.wardrobe", async () => {
    const repository = new MemoryProjectRepository("wardrobe-card");
    const content = "# Demo wardrobe\n\n- daily outfit\n- formal outfit";
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Wardrobe Project",
      artifacts: [
        artifact("character", "character:demo", "character", "Demo", character("demo", "Demo")),
        artifact("wardrobe", "wardrobe:demo", "wardrobe", "demo/wardrobe", content, "text/markdown"),
      ],
    }));
    const result = compileProject(await repository.read());
    const entry = result.card.data.character_book?.entries.find((item) => item.name === `Demo_${wardrobe}`);
    expect(result.card.data.wardrobe).toBeUndefined();
    expect(entry?.content).toBe(content);
    expect(readCardFromPng(result.png).card.data.wardrobe).toBeUndefined();
  });

  it("keeps greetings on the card and emits world lore by title/content", async () => {
    const repository = new MemoryProjectRepository("variants");
    const greetings = { document: { greetings: [{ id: "primary", kind: "primary", content: "Hi", character_ids: ["demo"] }, { id: "alternate", kind: "alternate", content: "Hello", character_ids: ["demo"] }, { id: "group", kind: "group_only", content: "Welcome", character_ids: ["demo"] }] } };
    const world = { entries: [{ id: "entry", title: "Academy", content: "Lore" }, { id: "empty", title: "No content" }] };
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Variants",
      artifacts: [
        artifact("character", "character:demo", "character", "Demo", character("demo", "Demo")),
        artifact("greetings", "greeting:greetings", "greeting", "greetings", greetings),
        artifact("world", "world_lore:world", "world_lore", "world", world),
        artifact("unknown", "unknown:plain", "unknown", "plain", "plain fallback"),
      ],
    }));
    const result = compileProject(await repository.read());
    const entries = result.card.data.character_book?.entries ?? [];
    expect(result.card.data.first_mes).toBe("Hi");
    expect(result.card.data.alternate_greetings).toEqual(["Hello"]);
    expect(result.card.data.group_only_greetings).toEqual(["Welcome"]);
    expect(entries.some((item) => item.name === "Academy" && item.content === "Lore")).toBe(true);
    expect(entries.some((item) => item.content === "plain fallback")).toBe(false);
  });

  it("filters selected modes and uses the fixed Chinese module names", async () => {
    const repository = new MemoryProjectRepository("modes");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Mode Project",
      artifacts: [
        artifact("character", "character:demo", "character", "Demo", character("demo", "Demo")),
        artifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", zhuji("demo", "appearance", { summary: "Zhuji appearance" })),
        artifact("zhuji-intro", "zhuji:demo/self_introduction", "zhuji", "demo/self_introduction", zhuji("demo", "self_introduction", { greeting: "Zhuji intro" })),
        artifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", palette("demo", "basic_information", "Palette basic")),
      ],
    }));
    const state = await repository.read();
    const zhujiCard = compileProject(state, { mode_selection: "zhuji" }).card;
    const paletteCard = compileProject(state, { mode_selection: "palette" }).card;
    const bothCard = compileProject(state, { mode_selection: "both" }).card;
    expect(zhujiCard.data.character_book?.entries.map((item) => item.name)).toEqual(["Demo_外觀", "Demo_自我介紹"]);
    expect(paletteCard.data.character_book?.entries.map((item) => item.name)).toEqual(["Demo_基本資訊"]);
    expect(bothCard.data.character_book?.entries.map((item) => item.name)).toEqual(["Demo_基本資訊", "Demo_外觀", "Demo_自我介紹"]);
  });

  it("excludes accepted facts and base character prose from the card", async () => {
    const repository = new MemoryProjectRepository("edge-cases");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Edge Cases",
      artifacts: [artifact("character", "character:demo", "character", "Demo", character("demo", "must not be exported"))],
      facts: [{ id: "fact-1", statement: "must not be exported", subject: "Demo", predicate: "is", value: "hidden", status: "accepted", confidence: 1, source_ids: [], evidence: ["user: explicit"], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "test" }],
    }));
    const result = compileProject(await repository.read());
    expect(result.card.data.name).toBe("Edge Cases");
    expect(result.card.data.first_mes).toBe("");
    expect(result.card.data.character_book?.entries).toHaveLength(0);
    expect(result.card.data.character_book?.entries.some((item) => item.content.includes("must not be exported"))).toBe(false);
  });

  it("fails clearly when a plugin artifact is malformed", async () => {
    const repository = new MemoryProjectRepository("bad-plugin");
    const content = "not-json";
    const hash = contentHash(content);
    await repository.commit(0, (state) => ({ ...state, artifacts: [{ id: "plugin", key: "plugin:bad", kind: "plugin", name: "bad", content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "test", operation_id: "op" }] }));
    const state = await repository.read();
    expect(() => compileProject(state)).toThrow(/PLUGIN_COMPILE_INVALID/u);
  });

  it("compiles the YAML proposal artifacts materialized by a real project", async () => {
    const repository = new MemoryProjectRepository("yaml-project");
    const blueprint = `schema_version: 1
project_id: yaml-project
characters:
  - character_id: demo
    display_name: Demo
`;
    const appearance = `schema_version: 1
id: proposal-demo-appearance-1
owner: zhuji-creator
value:
  kind: zhuji
  character_id: demo
  module:
    schema_version: 1
    mode: zhuji
    module: appearance
    title: 外顯
    data:
      核心:
        描述: 金髮與明亮笑容
    provenance:
      - kind: creator
`;
    const selfIntroduction = `schema_version: 1
id: proposal-demo-self-introduction-1
owner: zhuji-creator
value:
  kind: zhuji
  character_id: demo
  module:
    schema_version: 1
    mode: zhuji
    module: self_introduction
    title: 自我介紹
    data:
      內容: 我是 Demo。
`;
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "YAML Project",
      artifacts: [
        yamlArtifact("blueprint", "blueprint:yaml-project", "blueprint", "YAML Project", blueprint),
        yamlArtifact("appearance", "zhuji:demo-appearance", "zhuji", "Demo-appearance", appearance),
        yamlArtifact("self-introduction", "zhuji:demo-self_introduction", "zhuji", "Demo-self_introduction", selfIntroduction),
        artifact("wardrobe", "wardrobe:demo", "wardrobe", "demo/wardrobe", "# Demo wardrobe", "text/markdown"),
      ],
    }));
    const result = compileProject(await repository.read());
    const entries = result.card.data.character_book?.entries ?? [];
    expect(result.card.data.description).toBe("");
    expect(result.card.data.personality).toBe("");
    expect(result.card.data.scenario).toBe("");
    expect(result.card.data.first_mes).toBe("");
    expect(entries.map((item) => item.name)).toEqual(["Demo_外觀", "Demo_自我介紹", "Demo_衣櫃"]);
    expect(entries.find((item) => item.name === "Demo_外觀")?.content).toBe("title: 外顯\ndata:\n  核心:\n    描述: 金髮與明亮笑容");
    expect(entries.find((item) => item.name === "Demo_自我介紹")?.content).toBe("title: 自我介紹\ndata:\n  內容: 我是 Demo。");
    expect(entries.find((item) => item.name === "Demo_衣櫃")?.content).toBe("# Demo wardrobe");
  });

  it("compiles the runtime JSON Blueprint roster and preserves nested mode structure", async () => {
    const repository = new MemoryProjectRepository("runtime-json-blueprint");
    const nestedZhuji = {
      核心: {
        描述: "金髮與明亮笑容",
        標籤: ["開朗", "敏銳"],
        語料: [
          "第一句語料",
          { 場景: "午後教室", 對白: ["你好。", "今天也一起走吧。"] },
        ],
      },
    };
    const nestedPalette = {
      冷色調: { 主色: "深藍", 點綴: ["銀白", "霧紫"] },
      例外: ["壓力下會提高音量"],
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Runtime Blueprint Project",
      artifacts: [
        artifact("blueprint", "blueprint:runtime-json-blueprint", "blueprint", "project-blueprint", runtimeBlueprint([
          { id: "second", label: "第二角色", ordinal: 1 },
          { id: "first", label: "第一角色", ordinal: 2 },
        ])),
        artifact("first-appearance", "zhuji:first/appearance", "zhuji", "first/appearance", zhuji("first", "appearance", { 內容: "第一角色內容" })),
        artifact("second-appearance", "zhuji:second/appearance", "zhuji", "second/appearance", zhuji("second", "appearance", nestedZhuji)),
        artifact("second-palette", "palette:second/basic_information", "palette", "second/basic_information", {
          kind: "palette",
          character_id: "second",
          module: {
            schema_version: 1,
            mode: "palette",
            module: "basic_information",
            title: "基本資訊",
            content: "安靜而可靠。",
            sections: nestedPalette,
            provenance: [{ kind: "creator", agent: "palette-creator" }],
            extensions: { technical: true },
          },
        }),
      ],
    }));

    const result = compileProject(await repository.read());
    const entries = result.card.data.character_book?.entries ?? [];
    const appearance = entries.find((item) => item.name === "第二角色_外觀");
    const paletteEntry = entries.find((item) => item.name === "第二角色_基本資訊");
    const workspace = result.card.data.extensions["card-workspace"] as { project?: { primary_character_id?: string; characters?: Array<{ id: string; display_name: string }> } };

    expect(workspace.project?.primary_character_id).toBe("second");
    expect(workspace.project?.characters?.map((character) => [character.id, character.display_name])).toEqual([
      ["second", "第二角色"],
      ["first", "第一角色"],
    ]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "PRIMARY_CHARACTER_ID_FALLBACK", severity: "warning" })]);
    expect(appearance?.content).toContain("## data");
    expect(appearance?.content).toContain("### 核心");
    expect(appearance?.content).toContain("#### 描述");
    expect(appearance?.content).toContain("#### 標籤");
    expect(appearance?.content).toContain("1. 開朗");
    expect(appearance?.content).toContain("#### 場景");
    expect(appearance?.content).toContain("午後教室");
    expect(appearance?.content).toContain("你好。");
    expect(appearance?.content).not.toContain("schema_version");
    expect(appearance?.content).not.toContain("provenance");
    expect(paletteEntry?.content).toContain("## content");
    expect(paletteEntry?.content).toContain("安靜而可靠。");
    expect(paletteEntry?.content).toContain("## sections");
    expect(paletteEntry?.content).toContain("### 冷色調");
    expect(paletteEntry?.content).toContain("#### 主色");
    expect(paletteEntry?.content).toContain("1. 銀白");
    expect(result.card.data.description).toBe("");
    expect(result.card.data.personality).toBe("");
    expect(result.card.data.scenario).toBe("");
  });

  it("honors explicit JSON Blueprint primary_character_id without a fallback diagnostic", async () => {
    const repository = new MemoryProjectRepository("explicit-primary");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [
        artifact("blueprint", "blueprint:explicit-primary", "blueprint", "project-blueprint", runtimeBlueprint([
          { id: "first", display_name: "第一角色", ordinal: 1 },
          { id: "second", label: "第二角色", ordinal: 2 },
        ], "second")),
        artifact("first-appearance", "zhuji:first/appearance", "zhuji", "first/appearance", zhuji("first", "appearance", { 內容: "第一角色內容" })),
        artifact("second-appearance", "zhuji:second/appearance", "zhuji", "second/appearance", zhuji("second", "appearance", { 內容: "第二角色內容" })),
      ],
    }));

    const result = compileProject(await repository.read());
    const workspace = result.card.data.extensions["card-workspace"] as { project?: { primary_character_id?: string } };
    expect(workspace.project?.primary_character_id).toBe("second");
    expect(result.diagnostics).toEqual([]);
    expect(result.card.data.character_book?.entries.map((item) => item.name)).toEqual(["第一角色_外觀", "第二角色_外觀"]);
  });

  it("keeps a formal Character display_name ahead of a temporary Blueprint label", async () => {
    const repository = new MemoryProjectRepository("formal-character-name");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [
        artifact("blueprint", "blueprint:formal-character-name", "blueprint", "project-blueprint", runtimeBlueprint([
          { id: "demo", label: "暫用角色名稱", ordinal: 1 },
        ])),
        artifact("character", "character:demo", "character", "formal-character", character("demo", "正式角色名稱")),
        artifact("appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", zhuji("demo", "appearance", { 內容: "角色內容" })),
      ],
    }));

    const result = compileProject(await repository.read());
    const workspace = result.card.data.extensions["card-workspace"] as { project?: { characters?: Array<{ id: string; display_name: string }> } };
    expect(result.card.data.character_book?.entries.map((item) => item.name)).toEqual(["正式角色名稱_外觀"]);
    expect(workspace.project?.characters).toEqual([expect.objectContaining({ id: "demo", display_name: "正式角色名稱" })]);
  });

  it("falls back when explicit primary_character_id is not a known character", async () => {
    const repository = new MemoryProjectRepository("invalid-primary");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [
        artifact("blueprint", "blueprint:invalid-primary", "blueprint", "project-blueprint", runtimeBlueprint([
          { id: "first", label: "第一角色", ordinal: 1 },
          { id: "second", label: "第二角色", ordinal: 2 },
        ], "missing")),
        artifact("first-appearance", "zhuji:first/appearance", "zhuji", "first/appearance", zhuji("first", "appearance", { 內容: "第一角色內容" })),
        artifact("second-appearance", "zhuji:second/appearance", "zhuji", "second/appearance", zhuji("second", "appearance", { 內容: "第二角色內容" })),
      ],
    }));

    const result = compileProject(await repository.read());
    const workspace = result.card.data.extensions["card-workspace"] as { project?: { primary_character_id?: string } };
    expect(workspace.project?.primary_character_id).toBe("first");
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "PRIMARY_CHARACTER_ID_INVALID", severity: "warning" })]);
    expect(JSON.stringify(result.card)).not.toContain('"primary_character_id":"missing"');
  });

  it("filters latest artifacts and card metadata to the selected mode", async () => {
    const repository = new MemoryProjectRepository("filtered");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Filtered Project",
      artifacts: [
        artifact("character", "character:demo", "character", "Demo", character("demo", "Demo")),
        artifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", zhuji("demo", "appearance", { summary: "Zhuji appearance" })),
        artifact("palette-basic", "palette:demo/basic_information", "palette", "demo/basic_information", palette("demo", "basic_information", "Palette basic")),
        artifact("review", "review:1", "review", "review", { review: "not part of the card" }),
      ],
    }));
    const state = await repository.read();
    const zhujiResult = compileProject(state, { mode_selection: "zhuji" });
    expect(zhujiResult.normalized.latestArtifacts.map((item) => item.id)).toEqual(["character", "zhuji-appearance"]);
    expect(zhujiResult.normalized.project.artifact_ids).toEqual(["character", "zhuji-appearance"]);
    expect(Object.keys(zhujiResult.normalized.project.artifact_revisions)).toEqual(["character:demo", "zhuji:demo/appearance"]);
    const paletteResult = compileProject(state, { mode_selection: "palette" });
    expect(paletteResult.normalized.latestArtifacts.map((item) => item.id)).toEqual(["character", "palette-basic"]);
    expect(paletteResult.normalized.project.artifact_ids).toEqual(["character", "palette-basic"]);
    const bothResult = compileProject(state, { mode_selection: "both" });
    expect(bothResult.normalized.latestArtifacts.map((item) => item.id)).toEqual(["character", "palette-basic", "zhuji-appearance"]);
    expect(bothResult.normalized.project.artifact_ids).toEqual(["character", "palette-basic", "zhuji-appearance"]);
  });

  it("reports MODE_SELECTION_UNAVAILABLE instead of silently downgrading", async () => {
    const repository = new MemoryProjectRepository("no-palette");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Zhuji Only",
      artifacts: [
        artifact("character", "character:demo", "character", "Demo", character("demo", "Demo")),
        artifact("zhuji-appearance", "zhuji:demo/appearance", "zhuji", "demo/appearance", zhuji("demo", "appearance", { summary: "Zhuji appearance" })),
      ],
    }));
    const result = compileProject(await repository.read(), { mode_selection: "both" });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MODE_SELECTION_UNAVAILABLE", severity: "error" })]));
    expect(result.normalized.mode_selection).toBeUndefined();
    expect(result.normalized.latestArtifacts.map((item) => item.id)).toEqual(["character"]);
  });
});
