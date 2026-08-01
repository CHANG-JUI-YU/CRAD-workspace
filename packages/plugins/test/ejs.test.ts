import type { EjsSource, MvuSource } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";
import { compileEjsExpression, conditionCode } from "../src/official/ejs/generate-expression.js";
import { emitEjsControl, emitEjsJsonLiteral, emitEjsOutputText, emitEjsStringLiteral, reparseGeneratedEjs } from "../src/official/ejs/ejs-literal.js";
import { validateEjsSource } from "../src/official/ejs/validate.js";

import {
  compileEjsSource,
  compileMvuSource,
  generateActivePluginContributions,
  generatePluginContributions,
  officialMvuAssetPin,
} from "../src/index.js";

const implementation = officialMvuAssetPin({
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
});

function mvuSource(): MvuSource {
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [
      {
        id: "mood",
        label: "Mood",
        kind: "string",
        default: "calm",
        writable: true,
        update_rules: ["Update mood when the scene changes."],
      },
      {
        id: "level",
        label: "Level",
        kind: "integer",
        default: 50,
        min: 0,
        max: 100,
        clamp: true,
        writable: true,
        update_rules: ["Update level when the scene changes."],
      },
      {
        id: "phase",
        label: "Phase",
        kind: "enum",
        values: ["calm", "alert"],
        default: "calm",
        writable: false,
        update_rules: [],
      },
    ],
  };
}

function registry() {
  return compileMvuSource(mvuSource()).path_registry;
}

function entrySource(content = "Mood <tag> `safe` ${value}"): EjsSource {
  return {
    schema_version: 1,
    plugin_id: "official.ejs",
    project_kind: "character_card",
    implementation,
    entries: [{
      id: "show-mood",
      condition: { path: "/mood", operator: "equals", value: "calm" },
      content,
    }],
    preprocessing: [{ id: "mood-alias", path: "/mood" }],
    sections: [],
    dynamic_text: [],
  };
}

describe("official EJS plugin", () => {
  it("requires the approved MVU registry and emits deterministic preprocessing and entry output", () => {
    expect(() => compileEjsSource(entrySource(), undefined)).toThrow("MVU path registry");

    const first = compileEjsSource(entrySource(), registry());
    const second = compileEjsSource(entrySource(), registry());

    expect(first.artifact_revision).toBe(second.artifact_revision);
    expect(first.contributions.lore_entries.map((entry) => entry.id)).toEqual([
      "plugin.ejs.preprocessing",
      "plugin.ejs.entry.show-mood",
    ]);
    expect(first.contributions.lore_entries[0]?.content).toContain("@@preprocessing");
    expect(first.contributions.lore_entries[0]?.content).toContain("stat_data.mood");
    expect(first.contributions.lore_entries[1]?.content).toContain("@@if cw_mood_alias === \"calm\"");
    expect(first.contributions.lore_entries[1]?.content).toContain("\\u003Ctag\\u003E");
    expect(first.contributions.lore_entries[1]?.content).not.toContain("${value}");
    expect(first.contributions.metadata).toMatchObject({ entry_count: 1, preprocessing_aliases: ["mood-alias"] });
  });

  it("resolves nested expressions, sections, dynamic text, and registry dependencies", () => {
    const source: EjsSource = {
      ...entrySource("entry"),
      entries: [],
      preprocessing: [{ id: "level-alias", path: "/level" }, { id: "phase-alias", path: "/phase" }],
      sections: [{
        id: "level-section",
        branches: [
          { when: { kind: "range", path: "/level", min: 0, max: 49 }, content: "low" },
          { when: { kind: "range", path: "/level", min: 50, max: 100 }, content: "high" },
        ],
        fallback: "unknown",
      }],
      dynamic_text: [{
        id: "phase-text",
        branches: [{
          when: {
            kind: "all",
            conditions: [
              { kind: "in", value: { kind: "variable", path: "/phase" }, values: ["calm"] },
              { kind: "not", condition: { kind: "literal", value: false } },
            ],
          },
          text: "calm phase",
        }],
        fallback: "other phase",
      }],
    };

    const [mvu, ejs] = generateActivePluginContributions([source, mvuSource()]);
    expect(mvu?.plugin_id).toBe("official.mvu-zod");
    expect(ejs?.plugin_id).toBe("official.ejs");
    expect(ejs?.lore_entries[1]?.content).toContain("else if");
    expect(ejs?.lore_entries[2]?.content).toContain("includes");
    expect(ejs?.metadata).toMatchObject({ section_count: 1, dynamic_text_count: 1 });
  });

  it("rejects range overlap, gaps without fallback, and unknown paths", () => {
    const overlap: EjsSource = {
      ...entrySource(),
      entries: [],
      preprocessing: [],
      sections: [{
        id: "overlap",
        branches: [
          { when: { kind: "range", path: "/level", min: 0, max: 50 }, content: "a" },
          { when: { kind: "range", path: "/level", min: 50, max: 100 }, content: "b" },
        ],
      }],
      dynamic_text: [],
    };
    expect(() => compileEjsSource(overlap, registry())).toThrow("overlap");

    const gap: EjsSource = {
      ...overlap,
      sections: [{
        id: "gap",
        branches: [
          { when: { kind: "range", path: "/level", min: 0, max: 40 }, content: "a" },
          { when: { kind: "range", path: "/level", min: 50, max: 100 }, content: "b" },
        ],
      }],
    };
    expect(() => compileEjsSource(gap, registry())).toThrow("fallback");

    const unknown = entrySource();
    unknown.entries[0]!.condition = { path: "/missing", operator: "truthy" };
    expect(() => compileEjsSource(unknown, registry())).toThrow("未在 MVU path registry");
  });

  it("rejects authored EJS delimiters and direct generation without dependency context", () => {
    expect(() => compileEjsSource(entrySource("raw <% malicious() %>"), registry())).toThrow("raw EJS delimiter");
    expect(() => generatePluginContributions(entrySource())).toThrow("MVU path registry");
  });
  it("covers legacy and recursive EJS expression type guards", () => {
    const context = { mvuPathRegistry: registry(), aliasesByPath: new Map([["/mood", "cw_mood"]]) };
    for (const condition of [
      { path: "/mood", operator: "truthy" },
      { path: "/mood", operator: "falsy" },
      { path: "/mood", operator: "equals", value: "calm" },
      { path: "/level", operator: "greater_than", value: 1 },
      { path: "/level", operator: "less_than", value: 99 },
    ] as const) expect(conditionCode(condition as never, context)).toMatch(/./);
    for (const expression of [
      { kind: "literal", value: null },
      { kind: "compare", operator: "equals", left: { kind: "variable", path: "/mood" }, right: { kind: "literal", value: "calm" } },
      { kind: "compare", operator: "not_equals", left: { kind: "variable", path: "/level" }, right: { kind: "literal", value: 0 } },
      { kind: "in", value: { kind: "variable", path: "/phase" }, values: ["calm", "alert"] },
      { kind: "all", conditions: [{ kind: "literal", value: true }] },
      { kind: "any", conditions: [{ kind: "literal", value: false }] },
      { kind: "not", condition: { kind: "literal", value: false } },
      { kind: "range", path: "/level", min: 0, max: 100, min_inclusive: false, max_inclusive: false },
    ] as const) expect(compileEjsExpression(expression as never, context).type).toBeDefined();
    for (const expression of [
      { kind: "compare", operator: "equals", left: { kind: "variable", path: "/mood" }, right: { kind: "literal", value: 1 } },
      { kind: "compare", operator: "greater_than", left: { kind: "variable", path: "/mood" }, right: { kind: "literal", value: "x" } },
      { kind: "in", value: { kind: "variable", path: "/phase" }, values: ["missing"] },
      { kind: "range", path: "/mood", min: 0 },
      { kind: "range", path: "/level", min: -1 },
      { kind: "range", path: "/level", max: 101 },
      { kind: "variable", path: "/missing" },
    ] as const) expect(() => compileEjsExpression(expression as never, context)).toThrow();
  });  it("covers EJS legacy comparison and expression fallback branches", () => {
    const context = { mvuPathRegistry: registry(), aliasesByPath: new Map<string, string>() };
    expect(conditionCode({ path: "/mood", operator: "not_equals", value: "alert" } as never, context)).toContain("!==");
    expect(conditionCode({ path: "/level", operator: "greater_than", value: 1 } as never, context)).toContain(">" );
    expect(conditionCode({ path: "/level", operator: "less_than", value: 99 } as never, context)).toContain("<");
    expect(() => conditionCode({ path: "/mood", operator: "equals" } as never, context)).toThrow();
    expect(() => conditionCode({ path: "/mood", operator: "equals", value: 1 } as never, context)).toThrow();
    expect(conditionCode({ kind: "variable", path: "/mood" } as never, context)).toMatch(/^Boolean\(/u);
    expect(compileEjsExpression({ kind: "compare", operator: "greater_than", left: { kind: "variable", path: "/level" }, right: { kind: "literal", value: 1 } } as never, context).code).toContain(">" );
    expect(compileEjsExpression({ kind: "range", path: "/level", min: 1, max: 2, min_inclusive: true, max_inclusive: true } as never, context).code).toContain(">=");
    expect(compileEjsExpression({ kind: "range", path: "/level" } as never, context).code).toBe("");
  });
  it("covers EJS literal reparsing and validation guards", () => {
    expect(emitEjsStringLiteral("line")).toContain("line");
    expect(emitEjsJsonLiteral({ value: "ok" })).toContain("value");
    expect(emitEjsOutputText("safe")).toContain("<%=");
    expect(emitEjsControl("if (true) {")).toContain("<%_");
    expect(() => emitEjsControl("line" + String.fromCharCode(10) + "break")).toThrow();
    expect(reparseGeneratedEjs("prefix <%= \"ok\" %>")).toContain("prefix");
    expect(reparseGeneratedEjs("<%_ define(\"x\") _%><%_ if (true) { _%>x<%_ } _%>")).toContain("x");
    expect(reparseGeneratedEjs("<%_ if (true) { _%>x<%_ } else { _%>y<%_ } _%>")).toContain("x");
    for (const source of ["<%", "<% bad %>", "<%_ } _%>", "<%_ if (true) { _%>"]) {
      expect(() => reparseGeneratedEjs(source)).toThrow();
    }
    const valid = entrySource();
    expect(validateEjsSource(valid, registry()).aliases).toHaveLength(1);
    expect(() => validateEjsSource({ ...valid, preprocessing: [{ id: "missing", path: "/missing" }] }, registry())).toThrow();
    expect(() => validateEjsSource({ ...valid, preprocessing: [{ id: "same", path: "/mood" }, { id: "same", path: "/level" }] }, registry())).toThrow();
    const range = { id: "range", branches: [
      { when: { kind: "range", path: "/level", min: 0, max: 1 }, content: "a" },
      { when: { kind: "range", path: "/level", min: 3, max: 4 }, content: "b" },
    ] };
    expect(() => validateEjsSource({ ...valid, entries: [], sections: [range] }, registry())).toThrow("fallback");
    expect(validateEjsSource({ ...valid, entries: [], sections: [{ ...range, fallback: "other" }] }, registry()).aliases).toHaveLength(1);
  });});