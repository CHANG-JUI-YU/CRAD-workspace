import { describe, expect, it } from "vitest";
import { applyPluginContributionsToCharacterCard, emitCharacterCardV3, type Ccv3Project, type PluginContribution } from "../src/index.js";

const project: Ccv3Project = {
  project_id: "demo",
  title: "Demo",
  name: "Demo",
  description: "A complete character.",
  personality: "Calm and direct.",
  scenario: "A quiet room.",
  first_mes: "Hello.",
  alternate_greetings: [],
  group_only_greetings: [],
  lore_entries: [],
};

const contribution: PluginContribution = {
  schema_version: 1,
  plugin_id: "official.test",
  implementation: { version: "1.0.0" },
  artifact_revision: "a".repeat(64),
  lore_entries: [{ id: "test.entry", name: "Test", keys: [], content: "Managed content", enabled: true, insertion_order: 1 }],
  regex_scripts: [],
  helper_scripts: [],
  greeting_operations: [{ greeting_id: "primary", mode: "append", content: "\nPlugin" }],
  metadata: { source: "test" },
};

describe("CCv3 emitter", () => {
  it("emits a schema-valid card with deterministic managed plugin resources", () => {
    const first = emitCharacterCardV3(project, { pluginContributions: [contribution] });
    const second = emitCharacterCardV3(project, { pluginContributions: [contribution] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.spec).toBe("chara_card_v3");
    expect(first.data.first_mes).toBe("Hello.\nPlugin");
    expect(first.data.character_book?.entries).toHaveLength(1);
    expect(first.data.extensions["card-workspace"]).toMatchObject({ plugins: { "official.test": { artifact_revision: "a".repeat(64) } } });
  });

  it("is idempotent and rejects managed resource collisions", () => {
    const card = emitCharacterCardV3(project, { pluginContributions: [contribution] });
    const repeated = applyPluginContributionsToCharacterCard(card, [contribution]);
    expect(repeated.data.character_book?.entries).toHaveLength(1);
    expect(() => applyPluginContributionsToCharacterCard(card, [{ ...contribution, artifact_revision: "b".repeat(64) }])).toThrow(/collision/u);
  });

  it("creates missing managed arrays and applies replace/position plugin branches", () => {
    const complex: PluginContribution = {
      ...contribution,
      plugin_id: "official.complex",
      lore_entries: [{ ...contribution.lore_entries[0]!, position: "before_char" }],
      regex_scripts: [{ scriptName: "demo", findRegex: "x", replaceString: "y", trimStrings: [], placement: [], disabled: false, markdownOnly: false, promptOnly: false, runOnEdit: false, substituteRegex: false }],
      helper_scripts: [{ type: "script", enabled: true, id: "helper", name: "Helper", content: "x", info: "info", button: { enabled: true, buttons: [{ name: "Run", visible: true }] }, data: {} }],
      greeting_operations: [{ greeting_id: "primary", mode: "replace", content: "Replaced" }],
    };
    const card = emitCharacterCardV3(project, { pluginContributions: [complex] });
    expect(card.data.first_mes).toBe("Replaced");
    expect(card.data.extensions.regex_scripts).toHaveLength(1);
    expect(() => applyPluginContributionsToCharacterCard({ ...card, data: { ...card.data, extensions: { ...card.data.extensions, regex_scripts: "bad" } } } as never, [complex])).toThrow(/array/u);
  });
});
