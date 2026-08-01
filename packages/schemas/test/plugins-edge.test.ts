import { describe, expect, it } from "vitest";

import {
  blueprintPluginSelectionSchema,
  ejsConditionSchema,
  ejsExpressionSchema,
  ejsSourceSchema,
  htmlSourceSchema,
  jsonPointerPathSchema,
  mvuSourceSchema,
  mvuUpdateRuleSchema,
  mvuVariableNodeSchema,
  pluginContributionsSchema,
  pluginRevisionIntentSchema,
  pluginSelectionSchema,
  type PluginImplementationPin,
} from "../src/index.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const implementation: PluginImplementationPin = {
  version: "1.0.0",
  digest: hash("a"),
  asset_manifest_id: "sillytavern-assets",
  asset_manifest_revision: hash("b"),
  asset_manifest_hash: hash("c"),
};

function mvuVariable(overrides: Record<string, unknown> = {}) {
  return { id: "mood", label: "Mood", kind: "string", default: "calm", ...overrides };
}

function mvuSource(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [mvuVariable()],
    update_rules: [],
    ...overrides,
  };
}

function ejsSource(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    plugin_id: "official.ejs",
    project_kind: "character_card",
    implementation,
    entries: [{ id: "entry", condition: { path: "/mood", operator: "equals", value: "calm" }, content: "Mood" }],
    preprocessing: [],
    sections: [],
    dynamic_text: [],
    ...overrides,
  };
}

function htmlSource(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    plugin_id: "official.html",
    project_kind: "character_card",
    implementation,
    features: ["message_presentation"],
    components: [{ id: "message", feature: "message_presentation", tag: "p", label: "Message", text: [], binding_paths: [] }],
    ...overrides,
  };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    project_id: "demo-project",
    revision: hash("d"),
    project_kind: "character_card",
    base_selection_revision: "absent",
    selections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
    dependency_closure: ["official.mvu-zod"],
    implementation_pins: [{ plugin_id: "official.mvu-zod", implementation }],
    ...overrides,
  };
}

describe("plugin schema edge matrix", () => {
  it("accepts RFC6901 pointers and rejects unsafe or malformed characters", () => {
    for (const path of ["/", "/mood", "/a~0b", "/a~1b", "/emoji-😀"]) {
      expect(jsonPointerPathSchema.safeParse(path).success).toBe(true);
    }
    for (const path of ["", "mood", "/a~", "/a~2", "/a b", "/a\t", "/a\u0000", "/a\u007f", "/a'b", "/a<b", "/a\\b"]) {
      expect(jsonPointerPathSchema.safeParse(path).success).toBe(false);
    }
  });

  it("enforces plugin selection capability discriminators", () => {
    expect(blueprintPluginSelectionSchema.safeParse({ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }).success).toBe(true);
    expect(blueprintPluginSelectionSchema.safeParse({ plugin_id: "official.ejs", capabilities: ["ejs"] }).success).toBe(true);
    expect(blueprintPluginSelectionSchema.safeParse({ plugin_id: "official.html", capabilities: ["html.status_bar"] }).success).toBe(true);
    for (const value of [
      { plugin_id: "official.mvu-zod", capabilities: ["ejs"] },
      { plugin_id: "official.ejs", capabilities: ["mvu"] },
      { plugin_id: "official.html", capabilities: ["mvu"] },
      { plugin_id: "official.mvu-zod", capabilities: [] },
      { plugin_id: "official.mvu-zod", capabilities: ["mvu"], unknown: true },
    ]) expect(blueprintPluginSelectionSchema.safeParse(value).success).toBe(false);
    expect(pluginSelectionSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source_revision: hash("d"),
      implementation,
      artifact_revision: hash("e"),
    }).success).toBe(true);
    expect(pluginSelectionSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source_revision: "bad",
      implementation,
      artifact_revision: hash("e"),
    }).success).toBe(false);
  });

  it("covers legacy and recursive MVU variable contracts", () => {
    for (const variable of [
      { name: "text", type: "string", default: "ok" },
      { name: "amount", type: "number", default: 1.5, min: 0, max: 2 },
      { name: "count", type: "integer", default: 1, min: 0, max: 2 },
      { name: "enabled", type: "boolean", default: true },
    ]) expect(mvuSource({ variables: [variable] }).variables).toHaveLength(1);

    for (const variable of [
      { name: "text", type: "string", default: 1 },
      { name: "amount", type: "number", default: "1" },
      { name: "count", type: "integer", default: 1.5 },
      { name: "enabled", type: "boolean", default: "yes" },
      { name: "text", type: "string", default: "ok", min: 0 },
      { name: "amount", type: "number", default: 1, min: 2, max: 1 },
    ]) expect(mvuSourceSchema.safeParse(mvuSource({ variables: [variable] })).success).toBe(false);

    const validNodes = [
      mvuVariable({ kind: "string", default: "ok", min_length: 1, max_length: 2, writable: true, update_rules: ["change"] }),
      mvuVariable({ kind: "number", default: 1, min: 0, max: 2, clamp: false }),
      mvuVariable({ kind: "integer", default: 1, min: 0, max: 2 }),
      mvuVariable({ kind: "boolean", default: false, visibility: "hidden" }),
      mvuVariable({ kind: "enum", values: ["a", "b"], default: "a" }),
      mvuVariable({ kind: "object", default: { child: "ok" }, fields: [mvuVariable({ id: "child" })] }),
      mvuVariable({ kind: "array", default: [{ value: "ok" }], min_items: 1, max_items: 2, items: mvuVariable({ id: "item" }) }),
    ];
    for (const node of validNodes) expect(mvuVariableNodeSchema.safeParse(node).success).toBe(true);
    for (const node of [
      mvuVariable({ kind: "string", default: "x", min_length: 2, max_length: 1 }),
      mvuVariable({ kind: "string", default: "x", min_length: 2 }),
      mvuVariable({ kind: "string", default: "abcd", max_length: 2 }),
      mvuVariable({ kind: "number", default: 1, min: 2 }),
      mvuVariable({ kind: "number", default: 3, max: 2 }),
      mvuVariable({ kind: "number", default: 1, min: 2, max: 1 }),
      mvuVariable({ kind: "integer", default: 1, min: 2 }),
      mvuVariable({ kind: "integer", default: 3, max: 2 }),
      mvuVariable({ kind: "enum", values: ["a", "a"], default: "a" }),
      mvuVariable({ kind: "enum", values: ["a", "b"], default: "c" }),
      mvuVariable({ kind: "array", default: [], min_items: 1 }),
      mvuVariable({ kind: "array", default: [1, 2], max_items: 1 }),
      mvuVariable({ kind: "array", default: [], min_items: 2, max_items: 1 }),
      mvuVariable({ kind: "object", default: {}, fields: [] }),
    ]) expect(mvuVariableNodeSchema.safeParse(node).success).toBe(false);

    expect(mvuSourceSchema.safeParse(mvuSource({ variables: [mvuVariable({ id: "__proto__" })] })).success).toBe(false);
    expect(mvuSourceSchema.safeParse(mvuSource({ variables: [mvuVariable(), mvuVariable({ id: "mood" })] })).success).toBe(false);
    expect(mvuSourceSchema.safeParse(mvuSource({
      variables: [mvuVariable({ kind: "object", default: {}, fields: [mvuVariable({ id: "child" })] })],
      update_rules: [{ path: "/mood", check: ["change"] }, { path: "/mood", check: ["again"] }],
    })).success).toBe(false);
    for (const rule of [
      { path: "/mood", check: ["change"], range_min: 0, range_max: 1 },
      { path: "/mood", check: ["change"], format: "number", value: "1" },
    ]) expect(mvuUpdateRuleSchema.safeParse(rule).success).toBe(true);
    expect(mvuUpdateRuleSchema.safeParse({ path: "/mood", check: ["change"], range_min: 2, range_max: 1 }).success).toBe(false);
  });

  it("covers EJS conditions, recursive expressions, and source-level guards", () => {
    for (const condition of [
      { path: "/mood", operator: "truthy" },
      { path: "/mood", operator: "falsy" },
      { path: "/mood", operator: "equals", value: "calm" },
      { path: "/level", operator: "greater_than", value: 1 },
      { path: "/enabled", operator: "less_than", value: false },
    ]) expect(ejsConditionSchema.safeParse(condition).success).toBe(true);
    for (const condition of [
      { path: "/mood", operator: "truthy", value: true },
      { path: "/mood", operator: "equals" },
      { path: "/mood", operator: "bad", value: true },
    ]) expect(ejsConditionSchema.safeParse(condition).success).toBe(false);
    const expressions = [
      { kind: "variable", path: "/mood" },
      { kind: "literal", value: null },
      { kind: "compare", operator: "equals", left: { kind: "variable", path: "/mood" }, right: { kind: "literal", value: "calm" } },
      { kind: "in", value: { kind: "variable", path: "/mood" }, values: ["calm", null, 1, true] },
      { kind: "all", conditions: [{ kind: "literal", value: true }] },
      { kind: "any", conditions: [{ kind: "literal", value: false }] },
      { kind: "not", condition: { kind: "literal", value: false } },
      { kind: "range", path: "/level", min: 0, max: 100, min_inclusive: false, max_inclusive: true },
      { kind: "range", path: "/level", min: undefined, max: 100 },
    ];
    for (const expression of expressions) expect(ejsExpressionSchema.safeParse(expression).success).toBe(true);
    for (const expression of [
      { kind: "range", path: "/level" },
      { kind: "range", path: "/level", min: 2, max: 1 },
      { kind: "in", value: { kind: "literal", value: 1 }, values: [] },
      { kind: "all", conditions: [] },
      { kind: "any", conditions: [] },
      { kind: "variable", path: "level" },
    ]) expect(ejsExpressionSchema.safeParse(expression).success).toBe(false);
    expect(ejsSourceSchema.safeParse(ejsSource({ entries: [], sections: [], dynamic_text: [] })).success).toBe(false);
    expect(ejsSourceSchema.safeParse(ejsSource({ preprocessing: [{ id: "same", path: "/mood" }, { id: "same", path: "/level" }] })).success).toBe(false);
    expect(ejsSourceSchema.safeParse(ejsSource({ entries: [{ id: "entry", condition: { path: "/mood", operator: "truthy" }, content: "<% bad %>" }] })).success).toBe(false);
    expect(ejsSourceSchema.safeParse(ejsSource({ sections: [{ id: "section", branches: [{ when: { path: "/mood", operator: "truthy" }, content: "ok" }], fallback: "%>" }] })).success).toBe(false);
    expect(ejsSourceSchema.safeParse(ejsSource({ dynamic_text: [{ id: "dynamic", branches: [{ when: { path: "/mood", operator: "truthy" }, text: "<% bad" }] }] })).success).toBe(false);
  });

  it("covers HTML source feature, component and delimiter guards", () => {
    expect(htmlSourceSchema.safeParse(htmlSource({ features: ["status_bar"], components: [{ id: "status", feature: "status_bar", tag: "input", label: "Status", text: [], binding_paths: ["/mood"] }] })).success).toBe(true);
    for (const source of [
      htmlSource({ features: ["status_bar"], components: [{ id: "message", feature: "message_presentation", tag: "p", label: "Message" }] }),
      htmlSource({ components: [{ id: "message", feature: "message_presentation", tag: "input", label: "Input", text: [{ kind: "text", value: "bad" }] }] }),
      htmlSource({ components: [{ id: "message", feature: "message_presentation", tag: "br", label: "Break", text: [{ kind: "text", value: "bad" }] }] }),
      htmlSource({ components: [
        { id: "same", feature: "message_presentation", tag: "p", label: "A" },
        { id: "same", feature: "message_presentation", tag: "p", label: "B" },
      ] }),
      htmlSource({ components: [{ id: "message", feature: "message_presentation", tag: "p", label: "<% bad %>" }] }),
      htmlSource({ components: [{ id: "message", feature: "message_presentation", tag: "p", label: "ok", text: [{ kind: "text", value: "%>" }] }] }),
    ]) expect(htmlSourceSchema.safeParse(source).success).toBe(false);
    expect(htmlSourceSchema.safeParse(htmlSource({ features: ["greeting_selector"], components: [{ id: "selector", feature: "greeting_selector", tag: "select", label: "Greeting", text: [] }] })).success).toBe(true);
  });

  it("covers contribution and revision intent invariants", () => {
    expect(pluginContributionsSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      implementation,
      artifact_revision: hash("e"),
      lore_entries: [],
      regex_scripts: [{ scriptName: "script", findRegex: "x", replaceString: "y", trimStrings: [], placement: [], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: false }],
      helper_scripts: [],
      greeting_operations: [],
      metadata: { enabled: true },
    }).success).toBe(true);
    expect(pluginContributionsSchema.safeParse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      implementation,
      artifact_revision: hash("e"),
      lore_entries: [],
      regex_scripts: [{ scriptName: "script", findRegex: "x", replaceString: "y", trimStrings: [], placement: [], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: false, minDepth: 2, maxDepth: 1 }],
      helper_scripts: [],
      greeting_operations: [],
      metadata: {},
    }).success).toBe(false);
    expect(pluginRevisionIntentSchema.safeParse(intent()).success).toBe(true);
    const invalidIntents = [
      intent({ project_kind: "worldbook", selections: [] }),
      intent({ project_kind: "worldbook" }),
      intent({ selections: [
        { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
        { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
      ] }),
      intent({ dependency_closure: ["official.mvu-zod", "official.mvu-zod"] }),
      intent({ implementation_pins: [{ plugin_id: "official.mvu-zod", implementation }, { plugin_id: "official.mvu-zod", implementation }] }),
      intent({ dependency_closure: [] }),
      intent({ implementation_pins: [] }),
      intent({ selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }], dependency_closure: ["official.ejs"], implementation_pins: [{ plugin_id: "official.ejs", implementation }] }),
      intent({ selections: [{ plugin_id: "official.html", capabilities: ["html.status_bar"] }], dependency_closure: ["official.html"], implementation_pins: [{ plugin_id: "official.html", implementation }] }),
      intent({ selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }], dependency_closure: ["official.ejs", "official.mvu-zod"], implementation_pins: [{ plugin_id: "official.ejs", implementation }] }),
      intent({ selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }, { plugin_id: "official.mvu-zod", capabilities: ["mvu"] }] }),
    ];
    for (const [index, value] of invalidIntents.entries()) {
      expect(pluginRevisionIntentSchema.safeParse(value).success, `invalid intent ${index}`).toBe(false);
    }
  });
});
