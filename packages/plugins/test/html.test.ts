import type { HtmlSource, MvuSource } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  compileHtmlSource,
  compileMvuSource,
  generatePluginContributions,
  generateActivePluginContributions,
  officialMvuAssetPin,
} from "../src/index.js";
import { reparseGeneratedCss, reparseGeneratedMarkup } from "../src/official/html/sanitize.js";
import { rootSelectorForComponent } from "../src/official/html/policy-v1.js";

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
    variables: [{
      name: "mood",
      type: "string",
      default: "calm",
      writable: false,
    }],
  };
}

function writableMvuSource(): MvuSource {
  return {
    ...mvuSource(),
    variables: [{
      name: "mood",
      type: "string",
      default: "calm",
      writable: true,
    }],
  };
}

function messageSource(): HtmlSource {
  return {
    schema_version: 1,
    plugin_id: "official.html",
    project_kind: "character_card",
    implementation,
    features: ["message_presentation"],
    components: [{
      id: "message-panel",
      feature: "message_presentation",
      tag: "div",
      label: "<script>alert(1)</script>",
      text: [{ kind: "text", value: "<img src=x> & `safe`" }],
      binding_paths: [],
    }],
  };
}

function interactiveSource(): HtmlSource {
  return {
    schema_version: 1,
    plugin_id: "official.html",
    project_kind: "character_card",
    implementation,
    features: ["status_bar", "greeting_selector"],
    components: [
      {
        id: "status-bar",
        feature: "status_bar",
        tag: "section",
        label: "Status",
        text: [{ kind: "text", value: "Mood" }],
        binding_paths: ["/mood"],
      },
      {
        id: "greeting-selector",
        feature: "greeting_selector",
        tag: "button",
        label: "Choose greeting",
        text: [{ kind: "text", value: "Choose" }],
        binding_paths: [],
      },
    ],
  };
}

describe("official HTML plugin", () => {
  it("compiles standalone message presentation with escaped markup and scoped CSS", () => {
    const compilation = compileHtmlSource(messageSource());
    const markup = compilation.contributions.regex_scripts[0]?.replaceString ?? "";

    expect(markup).toContain('id="cw-message-panel"');
    expect(markup).toContain("&lt;img src=x&gt;");
    expect(markup).not.toContain("<script");
    expect(compilation.css).toContain("@media");
    expect(compilation.css).toContain("prefers-reduced-motion");
    expect(compilation.contributions.regex_scripts).toHaveLength(2);
    expect(compilation.contributions.regex_scripts[0]).toMatchObject({
      markdownOnly: true,
      promptOnly: false,
      placement: [1],
    });
    expect(compilation.contributions.regex_scripts[1]).toMatchObject({
      markdownOnly: false,
      promptOnly: true,
      placement: [2],
      replaceString: "",
    });
    expect(compilation.contributions.helper_scripts[0]?.content).toContain("compareAndSwapMvu");
  });

  it("requires MVU bindings for status bar and applies approved greeting operations", () => {
    const mvu = compileMvuSource(mvuSource());
    const html = interactiveSource();
    const compilation = compileHtmlSource(html, {
      mvuPathRegistry: mvu.path_registry,
      greetingIds: ["primary", "alternate-1"],
    });

    expect(compilation.contributions.regex_scripts).toHaveLength(2);
    expect(compilation.contributions.regex_scripts[0]?.findRegex).toContain("StatusPlaceHolderImpl");
    expect(compilation.contributions.greeting_operations).toEqual([
      expect.objectContaining({ greeting_id: "primary", mode: "append" }),
      expect.objectContaining({ greeting_id: "alternate-1", mode: "append" }),
    ]);
    expect(compilation.contributions.metadata).toMatchObject({
      policy: "html-policy@1",
      component_ids: ["status-bar", "greeting-selector"],
    });
  });

  it("derives the MVU registry through active plugin ordering", () => {
    const [mvu, html] = generateActivePluginContributions(
      [interactiveSource(), mvuSource()],
      { greetingIds: ["primary"] },
    );

    expect(mvu?.plugin_id).toBe("official.mvu-zod");
    expect(html?.plugin_id).toBe("official.html");
    expect(html?.regex_scripts[0]?.replaceString).toContain("cw-status-bar");
  });

  it("fails closed for missing registry, greeting approval, unknown paths, and raw delimiters", () => {
    expect(() => compileHtmlSource(interactiveSource(), { greetingIds: ["primary"] })).toThrow("MVU path registry");
    expect(() => compileHtmlSource(messageSource(), { greetingIds: [] })).not.toThrow();
    expect(() => compileHtmlSource({
      ...messageSource(),
      features: ["greeting_selector"],
      components: [{ ...messageSource().components[0]!, feature: "greeting_selector" }],
    })).toThrow("greeting IDs");

    const unknownPath: HtmlSource = {
      ...interactiveSource(),
      components: [{ ...interactiveSource().components[0]!, binding_paths: ["/unknown"] }, interactiveSource().components[1]!],
    };
    expect(() => compileHtmlSource(unknownPath, { mvuPathRegistry: compileMvuSource(mvuSource()).path_registry, greetingIds: [] })).toThrow("未在 MVU registry");

    expect(() => generatePluginContributions({
      ...messageSource(),
      components: [{ ...messageSource().components[0]!, text: [{ kind: "text", value: "<% raw code %>" }] }],
    })).toThrow("raw EJS delimiter");
  });

  it("keeps dotted component IDs aligned across DOM and CSS scopes", () => {
    const source: HtmlSource = {
      ...messageSource(),
      components: [{ ...messageSource().components[0]!, id: "message.panel" }],
    };
    const compilation = compileHtmlSource(source);
    const markup = compilation.contributions.regex_scripts[0]?.replaceString ?? "";

    expect(markup).toContain('id="cw-message-panel"');
    expect(compilation.rendered[0]?.root_selector).toBe(rootSelectorForComponent("message.panel"));
    expect(compilation.css).toContain("#cw-message-panel");
  });

  it("exposes only write-enabled MVU bindings to the trusted runtime seam", () => {
    const mvu = compileMvuSource(writableMvuSource());
    const source: HtmlSource = {
      ...messageSource(),
      components: [{
        ...messageSource().components[0]!,
        feature: "status_bar",
        binding_paths: ["/mood"],
      }],
      features: ["status_bar"],
    };
    const compilation = compileHtmlSource(source, { mvuPathRegistry: mvu.path_registry });
    const runtime = compilation.contributions.helper_scripts[0]?.content ?? "";

    expect(runtime).toContain('"writable":true');
    expect(runtime).toContain("validateMvuState");
    expect(runtime).toContain("conflict === true");
  });

  it("rejects parsed HTML/CSS escape and scope bypasses", () => {
    expect(() => reparseGeneratedMarkup(
      '<div id="cw-safe" class="x" onclick="alert(1)"></div>',
      "cw-safe",
    )).toThrow("attribute");
    expect(() => reparseGeneratedMarkup(
      '<div id="cw-safe" id="cw-other"></div>',
      "cw-safe",
    )).toThrow("parse error");
    expect(() => reparseGeneratedCss(
      "#cw-safe{background:url(https://example.test/x)}",
      "#cw-safe",
    )).toThrow();
    expect(() => reparseGeneratedCss(
      ".host #cw-safe{color:red}",
      "#cw-safe",
    )).toThrow("root scope");
  });
});
