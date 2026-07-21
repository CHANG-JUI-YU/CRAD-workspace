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
  if (!field) throw new Error(`測試 source 缺少 field: ${id}`);
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
  });
});
