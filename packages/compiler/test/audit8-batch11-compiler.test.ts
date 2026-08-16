import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord } from "@st-workspace/core";
import { compileProject, compileWorkspaceBundle, normalizeProject, type CompileOptions } from "../src/index.js";

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

async function compiled(artifacts: ArtifactRecord[], options?: CompileOptions) {
  const repository = new MemoryProjectRepository("batch11-compiler");
  await repository.commit(0, (state) => ({ ...state, project_name: "Compiler Batch", artifacts }));
  return compileProject(await repository.read(), options);
}

describe("Audit 8 batch 11: compiler branch coverage", () => {
  it("returns every available mode combination through resolvedModeSelection", async () => {
    const modes = { zhuji: artifact("zhuji-a", "zhuji:a/appearance", "zhuji", "a/appearance", zhuji("a", "appearance", { x: 1 })), palette: artifact("palette-a", "palette:a/basic_information", "palette", "a/basic_information", palette("a", "basic_information", "b")) };
    const base = artifact("c", "character:a", "character", "A", character("a", "A"));
    const zhujiOnly = await compiled([base, modes.zhuji]);
    const paletteOnly = await compiled([base, modes.palette]);
    const both = await compiled([base, modes.zhuji, modes.palette]);
    const none = await compiled([base]);
    expect(zhujiOnly.normalized.mode_selection).toBe("zhuji");
    expect(paletteOnly.normalized.mode_selection).toBe("palette");
    expect(both.normalized.mode_selection).toBe("both");
    expect(none.normalized.mode_selection).toBeUndefined();
    expect(none.diagnostics.some((item) => item.code === "MODE_SELECTION_UNAVAILABLE")).toBe(false);
  });

  it("produces the requested-mode unavailable message for every available combination", async () => {
    const modes = { zhuji: artifact("zhuji-a", "zhuji:a/appearance", "zhuji", "a/appearance", zhuji("a", "appearance", { x: 1 })), palette: artifact("palette-a", "palette:a/basic_information", "palette", "a/basic_information", palette("a", "basic_information", "b")) };
    const base = artifact("c", "character:a", "character", "A", character("a", "A"));
    const zhujiOnly = await compiled([base, modes.zhuji], { mode_selection: "palette" });
    const paletteOnly = await compiled([base, modes.palette], { mode_selection: "zhuji" });
    const none = await compiled([base], { mode_selection: "both" });
    const both = await compiled([base, modes.zhuji, modes.palette], { mode_selection: "both" });
    expect(zhujiOnly.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MODE_SELECTION_UNAVAILABLE", severity: "error", message: expect.stringContaining("zhuji") })]));
    expect(paletteOnly.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MODE_SELECTION_UNAVAILABLE", severity: "error", message: expect.stringContaining("palette") })]));
    expect(none.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MODE_SELECTION_UNAVAILABLE", severity: "error", message: expect.stringContaining("\u7121") })]));
    expect(both.diagnostics.some((item) => item.code === "MODE_SELECTION_UNAVAILABLE")).toBe(false);
    expect(both.normalized.mode_selection).toBe("both");
  });

  it("skips a zhuji artifact whose JSON module is missing its identity fields", async () => {
    const broken = { kind: "zhuji", character_id: "a" };
    const result = await compiled([artifact("c", "character:a", "character", "A", character("a", "A")), artifact("broken", "zhuji:a/appearance", "zhuji", "a/appearance", broken)]);
    expect(result.card.data.character_book?.entries ?? []).toHaveLength(0);
  });

  it("ignores a zhuji JSON artifact whose mode does not match its kind", async () => {
    const wrongMode = { kind: "zhuji", character_id: "a", module: { mode: "palette", module: "appearance", title: "t", data: { x: 1 } } };
    const result = await compiled([artifact("c", "character:a", "character", "A", character("a", "A")), artifact("wrong", "zhuji:a/appearance", "zhuji", "a/appearance", wrongMode)]);
    expect(result.card.data.character_book?.entries ?? []).toHaveLength(0);
  });

  it("parses a YAML module with an inline data value", async () => {
    const yaml = ["schema_version: 1", "id: proposal-a-1", "value:", "  kind: zhuji", "  character_id: a", "  module:", "    mode: zhuji", "    module: appearance", "    title: \u5916\u986f", "    data: inline text"].join("\n");
    const result = await compiled([artifact("c", "character:a", "character", "A", character("a", "A")), artifact("yaml-a", "zhuji:a/appearance", "zhuji", "a/appearance", yaml, "text/yaml")]);
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toBe("title: \u5916\u986f\ndata: inline text");
  });

  it("parses a YAML module with a content block instead of data", async () => {
    const yaml = ["schema_version: 1", "id: proposal-a-1", "value:", "  kind: palette", "  character_id: a", "  module:", "    mode: palette", "    module: basic_information", "    title: \u57fa\u672c", "    content:", "      \u7b2c\u4e00\u884c", "      \u7b2c\u4e8c\u884c"].join("\n");
    const result = await compiled([artifact("c", "character:a", "character", "A", character("a", "A")), artifact("yaml-p", "palette:a/basic_information", "palette", "a/basic_information", yaml, "text/yaml")]);
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toBe("title: \u57fa\u672c\ncontent:\n  \u7b2c\u4e00\u884c\n  \u7b2c\u4e8c\u884c");
  });

  it("rejects YAML modules with missing fields or a mismatched kind", async () => {
    const missingTitle = ["value:", "  kind: zhuji", "  character_id: a", "  module:", "    mode: zhuji", "    module: appearance"].join("\n");
    const wrongKind = ["value:", "  kind: zhuji", "  character_id: a", "  module:", "    mode: palette", "    module: appearance", "    title: t", "    data: x"].join("\n");
    const noValue = "schema_version: 1\n";
    const result = await compiled([
      artifact("c", "character:a", "character", "A", character("a", "A")),
      artifact("no-title", "zhuji:a/appearance", "zhuji", "a/appearance", missingTitle, "text/yaml"),
      artifact("wrong-kind", "zhuji:a/appearance-2", "zhuji", "a/appearance-2", wrongKind, "text/yaml"),
      artifact("no-value", "zhuji:a/appearance-3", "zhuji", "a/appearance-3", noValue, "text/yaml"),
    ]);
    expect(result.card.data.character_book?.entries ?? []).toHaveLength(0);
  });

  it("unquotes double-quoted YAML scalars through JSON parsing and falls back on malformed JSON", async () => {
    const yaml = ["value:", "  kind: zhuji", "  character_id: a", "  module:", "    mode: zhuji", "    module: appearance", "    title: \"\\u5916\\u986f\"", "    data: x"].join("\n");
    const brokenQuote = ["value:", "  kind: zhuji", "  character_id: a", "  module:", "    mode: zhuji", "    module: appearance", "    title: \"\u672a\u9589\u5408", "    data: x"].join("\n");
    const result = await compiled([
      artifact("c", "character:a", "character", "A", character("a", "A")),
      artifact("escaped", "zhuji:a/appearance", "zhuji", "a/appearance", yaml, "text/yaml"),
      artifact("broken", "zhuji:a/appearance-2", "zhuji", "a/appearance-2", brokenQuote, "text/yaml"),
    ]);
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe("A_\u5916\u89c0");
    expect(entries[0]?.content).toBe("title: \"\u672a\u9589\u5408\ndata: x");
    expect(entries[1]?.name).toBe("A_\u5916\u89c0");
    expect(entries[1]?.content).toBe("title: \u5916\u986f\ndata: x");
  });

  it("emits every relationship section into one worldbook entry", async () => {
    const relationship = {
      kind: "relationship",
      document: {
        schema_version: 2,
        team_code: "TEAM-1",
        character_ids: ["a", "b"],
        self_perspectives: [{ source_character_id: "a", target_character_id: "a", summary: "self-reflection" }],
        edges: [{ source_character_id: "a", target_character_id: "b", summary: "trust" }],
        character_summaries: [{ character_id: "a", summary: "summary of a" }],
        summary: {
          network_character: "close",
          inter_group_relations: "cooperative",
          stability: "high",
          conflict_triggers: [{ trigger: "misunderstanding", severity: "high" }],
          intimacy_opportunities: ["one on one"],
        },
        groups: [{ id: "g1", name: "group", member_ids: ["a"], formation_cause: "origin", operating_pattern: "regular", exclusivity: "exclusive", latent_conflicts: ["ideal"], joining_conditions: "referral" }],
        provenance: [],
        extensions: {},
      },
    };
    const result = await compiled([artifact("c", "character:a", "character", "A", character("a", "A")), artifact("rel", "relationship:rel", "relationship", "rel", relationship)]);
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(1);
    const content = entries[0]?.content ?? "";
    expect(content).toContain("Team: TEAM-1");
    expect(content).toContain("Participants: A, b");
    expect(content).toContain("Network: close");
    expect(content).toContain("Character summaries:");
    expect(content).toContain("Self perspectives:");
    expect(content).toContain("Directed edges:");
    expect(content).toContain("Groups:");
    expect(content).toContain("Conflict triggers:");
    expect(content).toContain("Intimacy opportunities:");
  });

  it("keeps a relationship with no character book text out of the card", async () => {
    const empty = { kind: "relationship", document: { schema_version: 2, character_ids: [], provenance: [], extensions: {} } };
    const result = await compiled([artifact("rel", "relationship:rel", "relationship", "rel", empty)]);
    expect(result.card.data.character_book?.entries ?? []).toHaveLength(0);
  });

  it("maps relationship and wardrobe artifacts into project metadata", async () => {
    const relationship = { kind: "relationship", document: { schema_version: 2, character_ids: ["a", "b"], provenance: [], extensions: {} } };
    const result = await compiled([
      artifact("rel", "relationship:rel", "relationship", "rel", relationship),
      artifact("wardrobe", "wardrobe:demo", "wardrobe", "demo/wardrobe", "# wardrobe", "text/markdown"),
    ]);
    const metadata = result.card.data.extensions["card-workspace-project"] as { relationships?: Array<{ character_ids: string[] }>; wardrobes?: Array<{ character_id: string }> };
    expect(metadata.relationships).toEqual([expect.objectContaining({ artifact_id: "rel", character_ids: ["a", "b"] })]);
    expect(metadata.wardrobes).toEqual([expect.objectContaining({ artifact_id: "wardrobe", character_id: "demo" })]);
  });

  it("lists character modes and artifact ids in project metadata", async () => {
    const result = await compiled([
      artifact("blueprint", "blueprint:b", "blueprint", "b", runtimeBlueprint([{ id: "a", label: "A", ordinal: 1 }], "a")),
      artifact("zhuji-a", "zhuji:a/appearance", "zhuji", "a/appearance", zhuji("a", "appearance", { x: 1 })),
    ]);
    const metadata = result.card.data.extensions["card-workspace-project"] as { characters: Array<{ id: string; modes: string[]; artifact_ids: string[] }>; mode_artifacts: Array<{ mode: string }>; export_mode: string };
    expect(metadata.characters).toEqual([expect.objectContaining({ id: "a", modes: ["zhuji"], artifact_ids: ["zhuji-a"] })]);
    expect(metadata.mode_artifacts).toEqual([expect.objectContaining({ mode: "zhuji", module: "appearance" })]);
    expect(metadata.export_mode).toBe("zhuji");
  });

  it("deduplicates identical first_mes values across greeting artifacts", async () => {
    const greeting = (id: string, content: string) => ({ document: { greetings: [{ id, kind: "primary", content }] } });
    const result = await compiled([
      artifact("g1", "greeting:g1", "greeting", "g1", greeting("primary", "hi")),
      artifact("g2", "greeting:g2", "greeting", "g2", greeting("primary", "hi")),
    ]);
    expect(result.card.data.first_mes).toBe("hi");
  });

  it("compiles a bundle with palette modules and a wardrobe object", async () => {
    const result = compileWorkspaceBundle({
      schema_version: 1,
      card: { project_id: "bundle", project_name: "Bundle", display_name: "Bundle", mode: "palette", artifact_versions: { basic_information: "r1", broken: 123 } },
      blueprint: "characters:\n  - display_name: Bundle",
      palette_modules: { basic_information: "palette content" },
      zhuji_modules: {},
      wardrobe: { display_name: "role", content: "# wardrobe" },
    });
    expect(result.card.data.character_book?.entries.map((item) => item.name)).toEqual(["Bundle_\u57fa\u672c\u8cc7\u8a0a", "role_\u8863\u6ac3"]);
    expect(result.card.data.extensions["card-workspace"]).toMatchObject({ source_format: "workspace-bundle", source_module_count: 1, source_wardrobe_count: 1, export_mode: "palette" });
  });

  it("compiles a bundle wardrobe map keyed by character names", async () => {
    const result = compileWorkspaceBundle({
      schema_version: 1,
      card: { project_id: "bundle", project_name: "Bundle", display_name: "Bundle" },
      blueprint: "characters:\n  - display_name: Bundle",
      wardrobe_markdown: { role: "# wardrobe A", other: { content: "# wardrobe B" }, empty: "" },
    });
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries.map((item) => item.name)).toEqual(["role_\u8863\u6ac3", "other_\u8863\u6ac3"]);
    expect(entries.find((item) => item.name === "role_\u8863\u6ac3")?.content).toBe("# wardrobe A");
  });

  it("throws when a workspace bundle has no card metadata", () => {
    expect(() => compileWorkspaceBundle({ schema_version: 1 })).toThrow(/WORKSPACE_BUNDLE_INVALID/u);
  });

  it("normalizes a project without any artifacts", async () => {
    const result = await compiled([]);
    expect(result.normalized.latestArtifacts).toEqual([]);
    expect(result.normalized.diagnostics).toEqual([]);
    expect(result.card.data.name).toBe("Compiler Batch");
    expect(result.card.data.character_book?.entries ?? []).toHaveLength(0);
  });

  it("keeps alternate and group-only greetings on a selected mode card", async () => {
    const greeting = { document: { greetings: [{ id: "primary", kind: "primary", content: "main" }, { id: "a", kind: "alternate", content: "alt" }, { id: "g", kind: "group_only", content: "group" }] } };
    const result = await compiled([artifact("g", "greeting:g", "greeting", "g", greeting)]);
    expect(result.card.data.first_mes).toBe("main");
    expect(result.card.data.alternate_greetings).toEqual(["alt"]);
    expect(result.card.data.group_only_greetings).toEqual(["group"]);
  });

  it("filters mode entries against an explicit mode selection", async () => {
    const result = await compiled([
      artifact("c", "character:a", "character", "A", character("a", "A")),
      artifact("zhuji-a", "zhuji:a/appearance", "zhuji", "a/appearance", zhuji("a", "appearance", { x: 1 })),
    ], { mode_selection: "palette" });
    const entries = result.card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(0);
    expect(result.normalized.mode_selection).toBeUndefined();
  });

  it("exposes normalizeProject with explicit mode selection metadata", async () => {
    const repository = new MemoryProjectRepository("batch11-norm");
    await repository.commit(0, (state) => ({
      ...state,
      project_name: "Norm",
      artifacts: [artifact("c", "character:a", "character", "A", character("a", "A")), artifact("zhuji-a", "zhuji:a/appearance", "zhuji", "a/appearance", zhuji("a", "appearance", { x: 1 }))],
    }));
    const normalized = normalizeProject(await repository.read(), { mode_selection: "zhuji" });
    expect(normalized.mode_selection).toBe("zhuji");
    expect(normalized.latestArtifacts.map((item) => item.id)).toEqual(["c", "zhuji-a"]);
  });
});
