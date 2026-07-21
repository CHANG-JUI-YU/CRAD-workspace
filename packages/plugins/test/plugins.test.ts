import type { EjsSource, HtmlSource, MvuSource } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  applyTypedTemplateParameters,
  generateActivePluginContributions,
  generatePluginContributions,
  officialMvuAssetPin,
  resolveActivePluginSources,
} from "../src/index.js";

const implementation = officialMvuAssetPin({ version: "1.0.0", digest: `sha256:${"a".repeat(64)}` });

function mvuSource(): MvuSource {
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [
      { name: "mood", type: "string", default: "calm\u2028${injection}", writable: true },
      { name: "level", type: "integer", default: 1, writable: false },
    ],
  };
}

function htmlSource(): HtmlSource {
  return {
    schema_version: 1,
    plugin_id: "official.html",
    project_kind: "character_card",
    implementation,
    features: ["status_bar", "greeting_selector"],
    components: [
      {
        id: "status",
        feature: "status_bar",
        tag: "section",
        label: "<Status>",
        text: [{ kind: "text", value: "Mood & `safe`" }],
        binding_paths: ["/mood"],
      },
      {
        id: "selector",
        feature: "greeting_selector",
        tag: "button",
        label: "Choose",
        text: [{ kind: "text", value: "Choose" }],
        binding_paths: [],
      },
    ],
  };
}

function ejsSource(): EjsSource {
  return {
    schema_version: 1,
    plugin_id: "official.ejs",
    project_kind: "character_card",
    implementation,
    entries: [{ id: "mood-entry", condition: { path: "/mood", operator: "truthy" }, content: "A scene entry" }],
  };
}

function messageOnlyHtmlSource(): HtmlSource {
  return {
    schema_version: 1,
    plugin_id: "official.html",
    project_kind: "character_card",
    implementation,
    features: ["message_presentation"],
    components: [{
      id: "message",
      feature: "message_presentation",
      tag: "div",
      label: "Message",
      text: [{ kind: "text", value: "Message" }],
      binding_paths: [],
    }],
  };
}

describe("official authoring plugins", () => {
  it("依賴順序先 MVU，且 EJS/HTML status bar 缺依賴時 fail closed", () => {
    expect(() => resolveActivePluginSources([htmlSource()])).toThrow("缺少 MVU source");
    expect(() => resolveActivePluginSources([ejsSource()])).toThrow("缺少 MVU source");
    expect(resolveActivePluginSources([htmlSource(), mvuSource()]).map((source) => source.plugin_id)).toEqual([
      "official.mvu-zod",
      "official.html",
    ]);
    expect(resolveActivePluginSources([messageOnlyHtmlSource()]).map((source) => source.plugin_id)).toEqual(["official.html"]);
    expect(() => resolveActivePluginSources([mvuSource(), mvuSource()])).toThrow("不可重複啟用");
  });

  it("完整 selection 依賴閉包維持 MVU→EJS→HTML 順序", () => {
    const contributions = generateActivePluginContributions([htmlSource(), ejsSource(), mvuSource()], { greetingIds: ["primary"] });
    expect(contributions.map((contribution) => contribution.plugin_id)).toEqual([
      "official.mvu-zod",
      "official.ejs",
      "official.html",
    ]);
    expect(generateActivePluginContributions([messageOnlyHtmlSource()]).map((contribution) => contribution.plugin_id))
      .toEqual(["official.html"]);
  });

  it("生成 MVU runtime 時不把特殊字元當作 source code", () => {
    const contributions = generatePluginContributions(mvuSource());
    const content = contributions.helper_scripts[0]!.content;
    expect(content).not.toContain("<%");
    expect(content).not.toContain("${injection}");
    expect(content).toContain("\\u0024");
    expect(contributions.metadata).toMatchObject({ variable_count: 2 });
  });

  it("HTML 只從 typed component 產生 escaped markup 與 greeting operation", () => {
    const [mvu, html] = generateActivePluginContributions([htmlSource(), mvuSource()], { greetingIds: ["primary"] });
    expect(mvu).toBeDefined();
    expect(html?.regex_scripts[0]?.replaceString).toContain("&lt;Status&gt;");
    expect(html?.regex_scripts[0]?.replaceString).not.toContain("<script");
    expect(html?.greeting_operations).toEqual([
      expect.objectContaining({ greeting_id: "primary", mode: "append" }),
    ]);
  });

  it("template 參數只能寫入 plugin contract allowlist 的 scalar 欄位", () => {
    const source = { label: "old", nested: { enabled: false } };
    expect(applyTypedTemplateParameters(source, { "/label": "new" }, ["/label"])).toEqual({
      label: "new",
      nested: { enabled: false },
    });
    expect(() => applyTypedTemplateParameters(source, { "/nested/enabled": true }, ["/label"])).toThrow("allowlist");
    expect(() => applyTypedTemplateParameters(source, { "/__proto__": true }, ["/__proto__"])).toThrow("禁止");
  });
});
