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
});
