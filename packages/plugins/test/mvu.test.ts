import {
  mvuSourceSchema,
  type JsonValue,
  type MvuSource,
} from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  compileMvuSource,
  generateMvuOutputFormat,
  generateMvuUpdateRules,
  officialMvuAssetPin,
  validateMvuSource,
} from "../src/index.js";

const implementation = officialMvuAssetPin({
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
});

function nestedSource(): MvuSource {
  const hostile = "Calm <tag> `quoted` ${value}\\\u0000\u2028\u2029\uD800\r\n";
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [{
      id: "world-state",
      label: hostile,
      kind: "object",
      default: {
        "mood-state": hostile,
        level: 5,
        phase: "calm",
        enabled: true,
        items: [{ title: "one" }],
      },
      writable: false,
      update_rules: [],
      fields: [
        {
          id: "mood-state",
          label: "Mood",
          kind: "string",
          default: hostile,
          writable: true,
          min_length: 1,
          max_length: 64,
          update_rules: ["Update the current mood."],
        },
        {
          id: "level",
          label: "Level",
          kind: "integer",
          default: 5,
          writable: true,
          min: 0,
          max: 100,
          clamp: true,
          update_rules: ["Adjust level only when the scene changes."],
        },
        {
          id: "phase",
          label: "Phase",
          kind: "enum",
          values: ["calm", "alert"],
          default: "calm",
          writable: true,
          update_rules: ["Choose one declared phase."],
        },
        {
          id: "enabled",
          label: "Enabled",
          kind: "boolean",
          default: true,
          writable: false,
          update_rules: [],
        },
        {
          id: "items",
          label: "Items",
          kind: "array",
          default: [{ title: "one" }],
          min_items: 1,
          max_items: 4,
          writable: false,
          update_rules: [],
          items: {
            id: "item",
            label: "Item shape",
            kind: "object",
            default: { title: "one" },
            writable: false,
            update_rules: [],
            fields: [{
              id: "title",
              label: "Title",
              kind: "string",
              default: "one",
              writable: false,
              update_rules: [],
            }],
          },
        },
      ],
    }],
    update_rules: [{
      path: "/world-state/level",
      type: "integer",
      range_min: 0,
      range_max: 100,
      check: ["scene changed"],
    }],
  } as MvuSource;
}

function cloneSource(): MvuSource {
  return structuredClone(nestedSource());
}

function objectRoot(source: MvuSource) {
  const root = source.variables[0];
  if (!root || !("kind" in root) || root.kind !== "object") throw new Error("測試 source root 不是 object");
  return root;
}

function objectField(source: MvuSource, id: string) {
  const field = objectRoot(source).fields.find((candidate) => candidate.id === id);
  if (!field) throw new Error("測試 source 缺少 field: " + $id);
  return field;
}

function asJsonObject(value: JsonValue): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("測試值不是 JSON object");
  }
  return value;
}

describe("official MVU/Zod plugin", () => {
  it("generates the complete deterministic asset chain for nested variables", () => {
    const first = compileMvuSource(nestedSource());
    const second = compileMvuSource(nestedSource());

    expect(first.artifact_revision).toBe(second.artifact_revision);
    expect(first.schema_source).toBe(second.schema_source);
    expect(first.path_registry).toEqual(second.path_registry);
    const firstState = asJsonObject(first.initial_state);
    const firstWorldState = asJsonObject(firstState["world-state"]!);
    expect(typeof firstWorldState["mood-state"]).toBe("string");
    expect(firstWorldState.level).toBe(5);
    expect(firstWorldState.phase).toBe("calm");
    expect(firstWorldState.enabled).toBe(true);
    expect(firstWorldState.items).toEqual([{ title: "one" }]);
    expect(first.path_registry.runtime_read_paths["world-state"]).toBe('stat_data["world-state"]');
    expect(first.path_registry.runtime_read_paths["mood-state"]).toBe('stat_data["world-state"]["mood-state"]');
    expect(first.path_registry.json_patch_paths.level).toBe("/world-state/level");
    expect(first.path_registry.json_patch_paths["mood-state"]).toBe("/world-state/mood-state");
    expect(first.path_registry.json_patch_paths.level).not.toContain("stat_data");
    expect(first.path_registry.by_id.item).toBeUndefined();
    expect(first.contributions.metadata).toMatchObject({ variable_count: 6 });
  });

  it("emits safe JavaScript, Zod transforms, paths, entries, and prompt hiding", () => {
    const compilation = compileMvuSource(nestedSource());
    const schema = compilation.schema_source;
    const lore = compilation.contributions.lore_entries;

    expect(schema).toContain("registerMvuSchema");
    expect(schema).toContain(".prefault(");
    expect(schema).toContain("_.clamp");
    expect(schema).toContain("Math.trunc");
    expect(schema).toContain("\\u0024");
    expect(schema).not.toContain("${value}");
    expect(schema).not.toContain("export type Schema");

    expect(asJsonObject(compilation.initial_state)["world-state"]).toBeDefined();
    expect(lore.map((entry) => entry.id)).toEqual([
      "plugin.mvu-zod.initvar",
      "plugin.mvu-zod.variable-list",
      "plugin.mvu-zod.update-rules",
      "plugin.mvu-zod.output-format",
    ]);
    expect(lore[0]).toMatchObject({ enabled: false, constant: false, insertion_order: 14720 });
    expect(lore[0]?.content).toContain("<initvar>");
    expect(lore[1]?.content).toContain("{{format_message_variable::stat_data}}");
    expect(lore[1]?.name).not.toContain("[mvu_update]");
    expect(lore[2]?.name).toContain("[mvu_update]");
    expect(lore[3]?.content).toContain("不得包含 runtime state wrapper");
    expect(compilation.contributions.regex_scripts[0]).toMatchObject({
      placement: [2],
      promptOnly: true,
      markdownOnly: false,
      minDepth: 4,
    });
    expect(compilation.contributions.regex_scripts[0]?.findRegex).not.toContain("StatusPlaceHolder");
    expect(compilation.contributions.helper_scripts[1]?.content).toContain("__CARD_WORKSPACE_MVU_PATHS__");
    expect(compilation.asset_manifest.assets[0]?.url).toContain("@043b72ae5f261de0953b2954bb5aba3f24c87bcb/");
    expect(Object.isFrozen(compilation.asset_manifest)).toBe(true);
    expect(Object.isFrozen(compilation.asset_manifest.assets)).toBe(true);
  });

  it("renders update rules and JSON Patch instructions without runtime paths", () => {
    const rules = generateMvuUpdateRules(nestedSource());
    const output = generateMvuOutputFormat();

    expect(rules).toContain("變量更新規則:");
    expect(rules).toContain("0~100");
    expect(rules).toContain("/world-state/level");
    expect(rules).not.toContain("stat_data");
    expect(output).toContain("<JSONPatch>");
    expect(output).toContain('"op": "replace"');
    expect(output).toContain('"op": "delta"');
    expect(output).not.toContain("stat_data");
  });

  it("rejects duplicate IDs, invalid defaults, uncovered writes, and writable array shapes", () => {
    const duplicate = cloneSource();
    objectRoot(duplicate).fields.push({ ...objectRoot(duplicate).fields[0]!, id: "world-state" });
    expect(() => mvuSourceSchema.parse(duplicate)).toThrow("重複");

    const invalidDefault = cloneSource();
    objectField(invalidDefault, "level").default = 101;
    expect(() => validateMvuSource(invalidDefault)).toThrow();

    const uncovered = cloneSource();
    objectField(uncovered, "mood-state").update_rules = [];
    expect(() => validateMvuSource(uncovered)).toThrow("update rule");

    const writableArrayItem = cloneSource();
    const items = objectField(writableArrayItem, "items");
    if (items.kind !== "array") throw new Error("測試 source items 不是 array");
    items.items.writable = true;
    expect(() => validateMvuSource(writableArrayItem)).toThrow("array item");
  });

  it("requires the immutable official runtime asset pin", () => {
    const wrongPin = cloneSource();
    wrongPin.implementation.asset_manifest_hash = `sha256:${"b".repeat(64)}`;
    expect(() => compileMvuSource(wrongPin)).toThrow("asset manifest");
  });  it("validates every default shape and update-rule compatibility branch", () => {
    const objectDefaults = [
      { value: null },
      { value: { unknown: "x" } },
      { value: {} },
      { value: { "mood-state": 1, level: 5, phase: "calm", enabled: true, items: [{ title: "one" }] } },
    ] as const;
    for (const { value } of objectDefaults) {
      const source = cloneSource();
      objectRoot(source).default = value as never;
      expect(() => validateMvuSource(source)).toThrow();
    }

    const stringTooShort = cloneSource();
    objectField(stringTooShort, "mood-state").default = "";
    expect(() => validateMvuSource(stringTooShort)).toThrow();
    const stringTooLong = cloneSource();
    objectField(stringTooLong, "mood-state").default = "x".repeat(65);
    expect(() => validateMvuSource(stringTooLong)).toThrow();
    const numberWrong = cloneSource();
    objectField(numberWrong, "level").default = Number.NaN;
    expect(() => validateMvuSource(numberWrong)).toThrow();
    const integerWrong = cloneSource();
    objectField(integerWrong, "level").default = 1.5;
    expect(() => validateMvuSource(integerWrong)).toThrow();
    const boolWrong = cloneSource();
    objectField(boolWrong, "enabled").default = "yes";
    expect(() => validateMvuSource(boolWrong)).toThrow();
    const enumWrong = cloneSource();
    objectField(enumWrong, "phase").default = "unknown";
    expect(() => validateMvuSource(enumWrong)).toThrow();
    const arrayWrong = cloneSource();
    const arrayNode = objectField(arrayWrong, "items");
    if (arrayNode.kind !== "array" || arrayNode.items.kind !== "object") throw new Error("expected nested array object");
    arrayNode.items.fields[0]!.default = 1 as never;
    expect(() => validateMvuSource(arrayWrong)).toThrow();


    const compatibleRules = cloneSource();
    compatibleRules.update_rules = [
      { path: "/world-state/level", type: "integer", range_min: 0, range_max: 100, check: ["scene"] },
      { path: "/world-state/phase", type: "string", check: ["phase"] },
      { path: "/world-state/mood-state", type: "string", check: ["mood"] },
    ];
    expect(validateMvuSource(compatibleRules).update_rules).toHaveLength(3);

    for (const rule of [
      { path: "/world-state/mood-state", type: "number", check: ["bad"] },
      { path: "/world-state/mood-state", range_min: 0, check: ["bad"] },
      { path: "/world-state/level", range_min: 0.5, check: ["bad"] },
      { path: "/world-state/level", range_min: -1, check: ["bad"] },
      { path: "/world-state/level", range_max: 101, check: ["bad"] },
      { path: "/world-state/missing", check: ["bad"] },
    ]) {
      const source = cloneSource();
      source.update_rules = [rule];
      expect(() => validateMvuSource(source)).toThrow();
    }

    const explicitWritableRule = cloneSource();
    objectField(explicitWritableRule, "mood-state").update_rules = [];
    explicitWritableRule.update_rules = [{ path: "/world-state/mood-state", check: ["explicit"] }];
    expect(validateMvuSource(explicitWritableRule).update_rules).toHaveLength(1);
    const unwritten = cloneSource();
    objectField(unwritten, "mood-state").writable = true;
    objectField(unwritten, "mood-state").update_rules = [];
    expect(() => validateMvuSource(unwritten)).toThrow("update rule");
  });
  it("covers MVU constraint, object-safety, collection, and range guards", () => {
    const cases: Array<(source: MvuSource) => void> = [
      (source) => { objectField(source, "level").min = 10; objectField(source, "level").max = 1; },
      (source) => { objectField(source, "mood-state").min_length = 10; objectField(source, "mood-state").max_length = 1; },
      (source) => { const items = objectField(source, "items"); if (items.kind !== "array") throw new Error("items"); items.min_items = 3; items.max_items = 1; },
      (source) => { objectRoot(source).default = JSON.parse('{"__proto__":"x"}') as never; },
      (source) => { const root = objectRoot(source); root.default = { "mood-state": "ok", level: 1, phase: "calm", enabled: true, items: [] } as never; const items = objectField(source, "items"); if (items.kind !== "array") throw new Error("items"); items.min_items = 1; },
      (source) => { const items = objectField(source, "items"); if (items.kind !== "array") throw new Error("items"); items.default = null as never; },
      (source) => { const items = objectField(source, "items"); if (items.kind !== "array") throw new Error("items"); items.default = [{ title: "one" }, { title: "two" }, { title: "three" }, { title: "four" }, { title: "five" }] as never; items.max_items = 4; },

    ];
    for (const [index, mutate] of cases.entries()) {
      const source = cloneSource();
      mutate(source);
      expect(() => validateMvuSource(source), `case ${index}`).toThrow();
    }
    const numericRange = cloneSource();
    numericRange.update_rules = [
      { path: "/world-state/level", type: "string", check: ["bad"] },
      { path: "/world-state/level", range_max: 101, check: ["bad"] },
    ];
    expect(() => validateMvuSource(numericRange)).toThrow();
    const safe = cloneSource();
    objectRoot(safe).default = { "mood-state": "ok", level: 1, phase: "calm", enabled: true, items: [{ title: "one" }] };
    expect(validateMvuSource(safe)).toBeDefined();
  });
  it("covers MVU default-value and generator branch matrix", () => {
    const valid = () => ({ "mood-state": "ok", level: 5, phase: "calm", enabled: true, items: [{ title: "one" }] });
    const cases: Array<(source: MvuSource) => void> = [
      (source) => { objectRoot(source).default = { ...valid(), "mood-state": "" }; },
      (source) => { objectRoot(source).default = { ...valid(), "mood-state": "x".repeat(65) }; },
      (source) => { objectRoot(source).default = { ...valid(), level: Number.NaN }; },
      (source) => { objectRoot(source).default = { ...valid(), level: 1.5 }; },
      (source) => { objectRoot(source).default = { ...valid(), level: -1 }; },
      (source) => { objectRoot(source).default = { ...valid(), level: 101 }; },
      (source) => { objectRoot(source).default = { ...valid(), phase: "unknown" }; },
      (source) => { objectRoot(source).default = { ...valid(), enabled: "yes" }; },
      (source) => { objectRoot(source).default = { ...valid(), items: null }; },
      (source) => { objectRoot(source).default = { ...valid(), items: [] }; },
      (source) => { objectRoot(source).default = { ...valid(), items: [{ title: "one" }, { title: "two" }, { title: "three" }, { title: "four" }, { title: "five" }] }; },
      (source) => { objectRoot(source).default = { ...valid(), items: [{ title: 1 }] }; },

    ];
    for (const [index, mutate] of cases.entries()) {
      const source = cloneSource();
      mutate(source);
      expect(() => validateMvuSource(source), "case " + index).toThrow();
    }

    const generated = cloneSource();
    const root = objectRoot(generated);
    root.description = "Root description";
    objectField(generated, "mood-state").description = "Mood description";
    objectField(generated, "mood-state").min_length = undefined;
    objectField(generated, "mood-state").max_length = undefined;
    const level = objectField(generated, "level");
    if (level.kind !== "integer") throw new Error("expected integer");
    level.min = 1;
    level.max = undefined;
    level.clamp = true;

    generated.variables.push({
      id: "score", label: "Score", kind: "number", default: 1, writable: false, update_rules: [],
    });
    generated.update_rules = [
      { path: "/world-state/level", range_min: 1, check: ["min only"] },
      { path: "/world-state/phase", format: "enum", value: "phase", check: ["no range"] },
      { path: "/score", range_max: 10, check: ["max only"] },
    ];
    expect(generateMvuUpdateRules(generated)).toContain(">= 1");
    expect(generateMvuUpdateRules(generated)).toContain("<= 10");

    const legacy = mvuSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      implementation,
      variables: [
        { name: "legacy_string", type: "string", default: "ok", writable: false },
        { name: "legacy_number", type: "number", default: 1, writable: false, min: 0 },
        { name: "legacy_integer", type: "integer", default: 1, writable: false, max: 5 },
        { name: "legacy_boolean", type: "boolean", default: true, writable: false },
      ],
      update_rules: [],
    });
    expect(compileMvuSource(legacy).schema_source).toContain("legacy_string");
  });
});
