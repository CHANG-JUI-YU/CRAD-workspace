import {
  canonicalProjectIrSchema,
  pluginContributionsSchema,
  type EjsSource,
  type HtmlSource,
  type MvuSource,
  type PluginImplementationPin,
} from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  compileMvuSource,
  generateActivePluginContributions,
  officialPluginImplementationPin,
  officialPluginImplementationRegistry,
} from "@card-workspace/plugins";
import { emitCharacterCardV3 } from "@card-workspace/adapters-ccv3";
import { readCardFromPng, writeCardToPng } from "@card-workspace/adapters-png";
import { buildCharacterCardPng } from "@card-workspace/testing";
import {
  appendPluginLoreForSimulation,
  compileActivePlugins,
  createApproximateTokenizer,
  simulateTokens,
  simulateTriggers,
} from "../src/index.js";

const implementation: PluginImplementationPin = officialPluginImplementationPin("official.mvu-zod");

const source: MvuSource = {
  schema_version: 1,
  plugin_id: "official.mvu-zod",
  project_kind: "character_card",
  implementation,
  variables: [{ name: "mood", type: "string", default: "calm", writable: true }],
};

describe("compileActivePlugins", () => {
  it("沒有 source 時保持空輸出，並可編譯 typed source", () => {
    expect(compileActivePlugins()).toEqual([]);
    expect(compileActivePlugins([source])[0]).toMatchObject({ plugin_id: "official.mvu-zod" });
  });

  it("worldbook plugin compile fail closed", () => {
    expect(() => compileActivePlugins([source], { projectKind: "worldbook" })).toThrow("character_card");
  });

  it("可選 exact registry 會拒絕 digest drift，不會自動套用新 implementation", () => {
    const pinned = officialPluginImplementationRegistry.implementations.find(
      (record) => record.plugin_id === "official.mvu-zod",
    );
    expect(pinned).toBeDefined();
    if (!pinned) return;
    expect(compileActivePlugins([{ ...source, implementation: pinned.implementation }], {
      projectKind: "character_card",
      implementationRegistry: officialPluginImplementationRegistry,
    })).toHaveLength(1);
    expect(() => compileActivePlugins([{ ...source, implementation: {
      ...pinned.implementation,
      digest: `sha256:${"f".repeat(64)}`,
    } }], {
      projectKind: "character_card",
      implementationRegistry: officialPluginImplementationRegistry,
    })).toThrow("digest 不符");
  });

  it("將 plugin lore 納入 token/trigger simulation IR 並保持 deterministic", () => {
    const project = canonicalProjectIrSchema.parse({
      schema_version: 1,
      project_id: "sim-plugin",
      title: "Plugin simulation",
      card: { name: "Plugin simulation", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
      characters: [{ id: "alice", display_name: "Alice", aliases: [], summary: "S", mode: "zhuji", role: "primary", extensions: {} }],
      greetings: [{ id: "primary", kind: "primary", content: "Hi", character_ids: ["alice"], provenance: [], extensions: {} }],
      entries: [],
      extensions: {},
    });
    const contributions = compileMvuSource(source).contributions;
    const simulated = appendPluginLoreForSimulation(project, [contributions]);
    expect(simulated.entries).toHaveLength(contributions.lore_entries.length);
    expect(simulated.entries.every((entry) => entry.insertion_order >= 1_000_000)).toBe(true);
    expect(simulated.entries.every((entry) => entry.recursion.incoming === false && entry.recursion.outgoing === false)).toBe(true);
    expect(simulated.entries.map((entry) => entry.id)).toEqual([...simulated.entries.map((entry) => entry.id)].sort());
    expect(appendPluginLoreForSimulation(project, [contributions])).toEqual(simulated);
  });

  it("從 MVU→EJS→HTML 產生 deterministic full-stack card contributions", () => {
    const ejs: EjsSource = {
      schema_version: 1,
      plugin_id: "official.ejs",
      project_kind: "character_card",
      implementation,
      entries: [{ id: "show-mood", condition: { path: "/mood", operator: "truthy" }, content: "Mood" }],
      preprocessing: [{ id: "mood-alias", path: "/mood" }],
      sections: [],
      dynamic_text: [],
    };
    const html: HtmlSource = {
      schema_version: 1,
      plugin_id: "official.html",
      project_kind: "character_card",
      implementation,
      features: ["status_bar"],
      components: [{
        id: "status",
        feature: "status_bar",
        tag: "section",
        label: "Status",
        text: [{ kind: "text", value: "Mood" }],
        binding_paths: ["/mood"],
      }],
    };
    const contributions = generateActivePluginContributions([html, ejs, source], { greetingIds: ["primary"] });
    expect(contributions.map((item) => item.plugin_id)).toEqual([
      "official.mvu-zod",
      "official.ejs",
      "official.html",
    ]);
    const project = canonicalProjectIrSchema.parse({
      schema_version: 1,
      project_id: "full-stack",
      title: "Full stack",
      card: { name: "Full stack", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
      characters: [{ id: "alice", display_name: "Alice", aliases: [], summary: "S", mode: "zhuji", role: "primary", extensions: {} }],
      greetings: [{ id: "primary", kind: "primary", content: "Hi", character_ids: ["alice"], provenance: [], extensions: {} }],
      entries: [],
      extensions: {},
    });
    const first = emitCharacterCardV3(project, { pluginContributions: contributions });
    const second = emitCharacterCardV3(project, { pluginContributions: contributions });
    expect(first).toEqual(second);
    expect(first.data.extensions?.["card-workspace"]?.plugins).toBeDefined();
    expect(first.data.character_book?.entries).toHaveLength(
      contributions.reduce((total, item) => total + item.lore_entries.length, 0),
    );

    const png = writeCardToPng(buildCharacterCardPng(), first);
    expect(readCardFromPng(png).card).toEqual(first);
  });

  it("把 plugin lore 的 constant/keyed/disabled 影響納入 token 與 trigger golden", () => {
    const project = canonicalProjectIrSchema.parse({
      schema_version: 1,
      project_id: "plugin-impact",
      title: "Plugin impact",
      card: { name: "Plugin impact", profile: "minimal_worldbook", avatar: "assets/avatar.png" },
      characters: [{ id: "alice", display_name: "Alice", aliases: [], summary: "S", mode: "zhuji", role: "primary", extensions: {} }],
      greetings: [{ id: "primary", kind: "primary", content: "Hi", character_ids: ["alice"], provenance: [], extensions: {} }],
      entries: [],
      extensions: {},
    });
    const contribution = pluginContributionsSchema.parse({
      schema_version: 1,
      plugin_id: "official.ejs",
      implementation,
      artifact_revision: `sha256:${"d".repeat(64)}`,
      lore_entries: [
        {
          id: "plugin-impact-constant",
          name: "Constant",
          keys: [],
          content: "always included",
          use_regex: false,
          enabled: true,
          insertion_order: 1,
          constant: true,
          extensions: {},
        },
        {
          id: "plugin-impact-keyed",
          name: "Keyed",
          keys: ["Alice"],
          content: "matched",
          use_regex: false,
          enabled: true,
          insertion_order: 2,
          extensions: {},
        },
        {
          id: "plugin-impact-disabled",
          name: "Disabled",
          keys: ["Alice"],
          content: "disabled",
          use_regex: false,
          enabled: false,
          insertion_order: 3,
          extensions: {},
        },
        {
          id: "plugin-impact-invalid-regex",
          name: "Invalid regex",
          keys: ["/[broken/u"],
          content: "invalid",
          use_regex: true,
          enabled: true,
          insertion_order: 4,
          extensions: {},
        },
      ],
      regex_scripts: [],
      helper_scripts: [],
      greeting_operations: [],
      metadata: {},
    });
    const simulated = appendPluginLoreForSimulation(project, [contribution]);
    const tokenReport = simulateTokens(simulated, { tokenizer: createApproximateTokenizer() });
    expect(tokenReport.entries.find((entry) => entry.entry_id === "plugin-impact-constant")).toMatchObject({
      constant: true,
      included: true,
    });
    expect(tokenReport.entries.find((entry) => entry.entry_id === "plugin-impact-disabled")).toMatchObject({
      included: false,
      evicted: false,
    });

    const triggerResult = simulateTriggers(simulated, {
      messages: ["Alice enters the room"],
      profile: "sillytavern-regex-helper@1",
    });
    expect(triggerResult.report.profile).toBe("sillytavern-regex-helper@1");
    expect(triggerResult.report.active_entry_ids).toEqual(expect.arrayContaining([
      "plugin-impact-constant",
      "plugin-impact-keyed",
    ]));
    expect(triggerResult.report.active_entry_ids).not.toContain("plugin-impact-disabled");
    expect(triggerResult.report.active_entry_ids).not.toContain("plugin-impact-invalid-regex");
    expect(triggerResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TRIGGER_REGEX_INVALID", severity: "warning" }),
    ]));
  });
});
