import { describe, expect, it } from "vitest";
import { generatePluginContributions } from "../src/index.js";

describe("typed plugin generators", () => {
  it("generates a managed MVU contribution", () => {
    const result = generatePluginContributions({ kind: "plugin", plugin_id: "official.mvu-zod", capabilities: ["mvu"], source: { plugin_id: "official.mvu-zod", variables: [{ id: "enabled", label: "Enabled", kind: "boolean", default: true, visibility: "visible", writable: true, update_rules: [] }], update_rules: [] } });
    expect(result.plugin_id).toBe("official.mvu-zod");
    expect(result.helper_scripts[0]?.content).toContain("path_registry");
    expect(result.lore_entries[0]?.id).toBe("plugin.mvu-zod.contract");
  });

  it("generates EJS and HTML without accepting raw authored delimiters", () => {
    const ejs = generatePluginContributions({ kind: "plugin", plugin_id: "official.ejs", capabilities: ["ejs"], source: { plugin_id: "official.ejs", entries: [{ id: "entry", when: { kind: "literal", value: true }, content: "Hello" }], sections: [], dynamic_text: [], preprocessing: [] } });
    const html = generatePluginContributions({ kind: "plugin", plugin_id: "official.html", capabilities: ["html.status_bar"], source: { plugin_id: "official.html", features: ["status_bar"], components: [{ id: "status", feature: "status_bar", tag: "div", label: "Status", text: [{ kind: "text", value: "Ready" }], binding_paths: [] }] } });
    expect(ejs.lore_entries[0]?.content).toContain("Hello");
    expect(html.helper_scripts[0]?.content).toContain("data-cw-component");
    expect(() => generatePluginContributions({ kind: "plugin", plugin_id: "official.ejs", source: { plugin_id: "official.ejs", entries: [{ id: "bad", when: { kind: "literal", value: true }, content: "<% raw" }], sections: [], dynamic_text: [], preprocessing: [] } })).toThrow();
  });

  it("renders conditional EJS branches and HTML greeting/input components", () => {
    const ejs = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.ejs",
      capabilities: ["ejs"],
      source: {
        plugin_id: "official.ejs",
        entries: [{ id: "conditional", when: { path: "/state/count", operator: "greater_than", value: 1 }, content: "Conditional" }],
        sections: [{ id: "section", branches: [{ when: { path: "/state/mode", operator: "truthy" }, content: "Branch" }], fallback: "Fallback" }],
        dynamic_text: [{ id: "dynamic", branches: [{ when: { path: "/state/ready", operator: "truthy" }, text: "Ready" }], fallback: "Not ready" }],
        preprocessing: [],
      },
    });
    const html = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.html",
      capabilities: ["html.greeting_selector"],
      source: {
        plugin_id: "official.html",
        features: ["greeting_selector"],
        components: [{ id: "picker", feature: "greeting_selector", tag: "input", label: "Greeting", text: [], binding_paths: ["/greeting"] }],
      },
    });
    expect(ejs.lore_entries.map((entry) => entry.content).join(" ")).toContain("greater_than");
    expect(html.greeting_operations).toHaveLength(1);
    expect(html.helper_scripts[0]?.content).toContain("<input");
  });

  it("emits an executable MVU runtime alongside the managed manifest", () => {
    const result = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source: {
        plugin_id: "official.mvu-zod",
        variables: [
          { id: "enabled", label: "Enabled", kind: "boolean", default: true, visibility: "visible", writable: true, update_rules: [] },
          { id: "count", label: "Count", kind: "integer", default: 2, visibility: "visible", writable: true, update_rules: [] },
        ],
        update_rules: [],
      },
    });
    const runtime = (result.helper_scripts[0]?.data.runtime ?? {}) as { init: string; update: string; run: string };
    expect(typeof runtime.init).toBe("string");
    expect(typeof runtime.update).toBe("string");
    expect(typeof runtime.run).toBe("string");
    const init = new Function(`return ${runtime.init}`)() as (state?: unknown) => unknown;
    const update = new Function(`return ${runtime.update}`)() as (state: unknown, path: string, value: unknown) => unknown;
    const run = new Function(`return ${runtime.run}`)() as (state: unknown, path: string) => unknown;
    expect(init(undefined)).toEqual({ enabled: true, count: 2 });
    expect(update({ enabled: true, count: 2 }, "/enabled", false)).toEqual({ enabled: false, count: 2 });
    expect(run({ enabled: true, count: 2 }, "/count")).toBe(2);
  });

  it("emits an executable EJS condition evaluator that respects path operators", () => {
    const ejs = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.ejs",
      capabilities: ["ejs"],
      source: {
        plugin_id: "official.ejs",
        entries: [],
        sections: [{ id: "section", branches: [{ when: { path: "/state/count", operator: "greater_than", value: 1 }, content: "Branch" }] }],
        dynamic_text: [],
        preprocessing: [],
      },
    });
    const runtime = (ejs.helper_scripts[0]?.data.runtime ?? {}) as { evaluateCondition: string };
    const evaluate = new Function(`return ${runtime.evaluateCondition}`)() as (condition: { kind: string; path?: string; operator?: string; value?: unknown; literal?: unknown }, context: unknown) => boolean;
    expect(evaluate({ kind: "literal", value: true }, { literal: true })).toBe(true);
    expect(evaluate({ kind: "literal", value: true }, { literal: false })).toBe(false);
    expect(evaluate({ kind: "path", path: "/state/count", operator: "greater_than", value: 1 }, { state: { count: 5 } })).toBe(true);
    expect(evaluate({ kind: "path", path: "/state/count", operator: "less_than", value: 1 }, { state: { count: 5 } })).toBe(false);
    expect(evaluate({ kind: "path", path: "/state/mode", operator: "equals", value: "run" }, { state: { mode: "run" } })).toBe(true);
    expect(evaluate({ kind: "path", path: "/state/ready", operator: "truthy" }, { state: { ready: false } })).toBe(false);
  });

  it("deduplicates binding paths into a single data-cw-bind attribute", () => {
    const html = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.html",
      capabilities: ["html.message_presentation"],
      source: {
        plugin_id: "official.html",
        features: ["message_presentation"],
        components: [{ id: "status", feature: "message_presentation", tag: "div", label: "Status", text: [{ kind: "text", value: "Ready" }], binding_paths: ["/state/count", "/state/count", "/state/mode"] }],
      },
    });
    const markup = (JSON.parse(html.helper_scripts[0]?.content ?? "{}") as { markup: string }).markup;
    const occurrences = markup.match(/data-cw-bind/gu) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(markup).toContain('data-cw-bind="/state/count /state/mode"');
  });

  it("declares visible injection slots for each enabled HTML feature", () => {
    const html = generatePluginContributions({
      kind: "plugin",
      plugin_id: "official.html",
      capabilities: ["html.status_bar", "html.greeting_selector"],
      source: {
        plugin_id: "official.html",
        features: ["status_bar", "greeting_selector"],
        components: [
          { id: "status", feature: "status_bar", tag: "span", label: "Status", text: [], binding_paths: [] },
          { id: "picker", feature: "greeting_selector", tag: "input", label: "Greeting", text: [], binding_paths: ["/greeting"] },
        ],
      },
    });
    const slots = (html.metadata.injection_slots as Array<{ feature: string; slot: string; mode: string }>) ?? [];
    expect(slots).toEqual(expect.arrayContaining([
      { feature: "status_bar", slot: "status_bar", mode: "append" },
      { feature: "greeting_selector", slot: "greeting", mode: "append" },
    ]));
  });
});
