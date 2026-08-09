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
});
