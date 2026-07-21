import type { EjsSource, MvuSource } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

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
});
