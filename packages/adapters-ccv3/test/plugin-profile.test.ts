import type { PluginContributions } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  applyPluginContributionsToCharacterCard,
  managedPluginResourceId,
  sillytavernRegexHelperProfileId,
  sillytavernRegexHelperProfileRevision,
  toManagedRegexScriptV1,
  toManagedTavernHelperScriptV1,
  validatePluginCompatibilityProfile,
} from "../src/index.js";
import { emitCharacterCardV3 } from "../src/emit.js";
import { canonicalProjectIrSchema } from "@card-workspace/schemas";

function contribution(): PluginContributions {
  return {
    schema_version: 1,
    plugin_id: "official.ejs",
    implementation: {
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      asset_manifest_id: "sillytavern-assets",
      asset_manifest_revision: `sha256:${"b".repeat(64)}`,
      asset_manifest_hash: `sha256:${"c".repeat(64)}`,
    },
    artifact_revision: `sha256:${"d".repeat(64)}`,
    lore_entries: [],
    regex_scripts: [{
      scriptName: "Display EJS",
      findRegex: "x",
      replaceString: "y",
      trimStrings: [],
      placement: [1],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: false,
    }],
    helper_scripts: [{
      type: "script",
      enabled: true,
      id: "ejs-runtime",
      name: "EJS runtime",
      content: "export const ok = true;",
      info: "generated",
      button: { enabled: false, buttons: [] },
      data: {},
    }],
    greeting_operations: [],
    metadata: {},
  };
}

const project = canonicalProjectIrSchema.parse({
  schema_version: 1,
  project_id: "profile-test",
  title: "Profile test",
  project_kind: "character_card",
  card: { name: "Profile", profile: "minimal_worldbook", avatar: "avatar.png" },
  characters: [{
    id: "alice",
    display_name: "Alice",
    aliases: [],
    summary: "Alice summary",
    mode: "zhuji",
    role: "primary",
    extensions: {},
  }],
  greetings: [{ id: "primary", kind: "primary", content: "Hello", character_ids: ["alice"], provenance: [], extensions: {} }],
  entries: [],
  extensions: {},
});

describe("sillytavern-regex-helper@1", () => {
  it("validates exact managed fields and maps deterministic managed IDs", () => {
    const value = contribution();
    expect(validatePluginCompatibilityProfile(value)).toEqual(value);
    expect(sillytavernRegexHelperProfileId).toBe("sillytavern-regex-helper@1");
    expect(sillytavernRegexHelperProfileRevision).toBe("sha256:247294f6d563cfe8b124d60b9015477298d18164b73bb581a26b62bda2064780");

    const regex = value.regex_scripts[0]!;
    const regexId = managedPluginResourceId(value.plugin_id, value.implementation.version, "regex", regex.scriptName);
    expect(toManagedRegexScriptV1(regex, regexId)).toMatchObject({ id: regexId, minDepth: null, maxDepth: null });

    const helper = value.helper_scripts[0]!;
    const helperId = managedPluginResourceId(value.plugin_id, value.implementation.version, "helper", helper.id);
    expect(toManagedTavernHelperScriptV1(helper, helperId)).toMatchObject({ id: helperId, type: "script", button: { enabled: false, buttons: [] }, data: {} });
  });

  it("rejects unsupported extra or legacy managed fields", () => {
    expect(() => validatePluginCompatibilityProfile({
      ...contribution(),
      regex_scripts: [{ ...contribution().regex_scripts[0]!, unsupported: true }],
    })).toThrow();
    expect(() => validatePluginCompatibilityProfile({
      ...contribution(),
      helper_scripts: [{ ...contribution().helper_scripts[0]!, button: false }],
    })).toThrow();
  });

  it("emits exact managed output and preserves idempotency", () => {
    const first = emitCharacterCardV3(project, { pluginContributions: [contribution()] });
    const second = applyPluginContributionsToCharacterCard(first, [contribution()]);
    expect(second).toEqual(first);
    expect(first.data.extensions.regex_scripts?.[0]).toMatchObject({ minDepth: null, maxDepth: null });
    expect(first.data.extensions["tavern_helper/scripts"]?.[0]).toMatchObject({
      type: "script",
      button: { enabled: false, buttons: [] },
      data: {},
    });
  });
});
