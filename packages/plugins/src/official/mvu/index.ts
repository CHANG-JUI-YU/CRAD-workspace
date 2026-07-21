import {
  pluginContributionsSchema,
  type JsonValue,
  type MvuSource,
  type PluginContributions,
  type Revision,
} from "@card-workspace/schemas";

import { revisionFor, safeJsValue } from "../../canonical.js";
import { generateMvuRegexScripts } from "./generate-regex.js";
import { generateMvuInitialState, generateMvuZodSource } from "./generate-zod.js";
import {
  generateMvuInitVar,
  generateMvuInitialStateJson,
  generateMvuLoreEntries,
  generateMvuOutputFormat,
  generateMvuUpdateRules,
  generateMvuVariableList,
} from "./generate-entries.js";
import { assertOfficialMvuAssetPin, officialMvuAssetManifest, mvuRuntimeAssets } from "../assets.js";
import { buildMvuPathRegistry, normalizeMvuSource } from "./paths.js";
import { validateMvuSource } from "./validate.js";

export interface MvuCompilation {
  readonly source: MvuSource;
  readonly schema_source: string;
  readonly initial_state: ReturnType<typeof generateMvuInitialState>;
  readonly path_registry: ReturnType<typeof buildMvuPathRegistry>;
  readonly asset_manifest: typeof officialMvuAssetManifest;
  readonly artifact_revision: Revision;
  readonly contributions: PluginContributions;
}

export function compileMvuSource(source: MvuSource): MvuCompilation {
  const parsed = validateMvuSource(source);
  assertOfficialMvuAssetPin(parsed.implementation);
  const normalized = normalizeMvuSource(parsed);
  const schemaSource = generateMvuZodSource(parsed);
  const initialState = generateMvuInitialState(parsed);
  const pathRegistry = buildMvuPathRegistry(normalized.roots);
  const runtimeHelperSource = [
    `globalThis.__CARD_WORKSPACE_MVU_PATHS__ = ${safeJsValue(pathRegistry as unknown as JsonValue)};`,
    "export function getMvuPathRegistry() { return globalThis.__CARD_WORKSPACE_MVU_PATHS__ ?? null; }",
  ].join("\n");
  const resolvedSourceHash = revisionFor({
    source: parsed,
    schema_source: schemaSource,
    initial_state: initialState,
    path_registry: pathRegistry,
  });
  const artifactRevision = revisionFor({
    canonical_source_revision: revisionFor(parsed),
    resolved_source_hash: resolvedSourceHash,
    implementation: parsed.implementation,
    asset_manifest: officialMvuAssetManifest,
  });
  const contributions = pluginContributionsSchema.parse({
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    implementation: parsed.implementation,
    artifact_revision: artifactRevision,
    lore_entries: generateMvuLoreEntries(parsed),
    regex_scripts: generateMvuRegexScripts(),
    helper_scripts: [
      {
        type: "script",
        enabled: true,
        id: "official.mvu-zod.schema",
        name: "Card Workspace MVU Zod schema",
        content: schemaSource,
        info: "Generated from the typed official.mvu-zod source.",
        button: { enabled: false, buttons: [] },
        data: {},
      },
      {
        type: "script",
        enabled: true,
        id: "official.mvu-zod.runtime",
        name: "Card Workspace MVU path registry",
        content: runtimeHelperSource,
        info: "The host owns runtime state; this helper exposes no authored code execution.",
        button: { enabled: false, buttons: [] },
        data: {},
      },
    ],
    greeting_operations: [],
    metadata: {
      source_schema_version: parsed.schema_version,
      project_kind: parsed.project_kind,
      initial_state: initialState,
      path_registry: pathRegistry,
      variable_count: Object.keys(pathRegistry.by_id).length,
      schema_source_revision: revisionFor(schemaSource),
      resolved_source_hash: resolvedSourceHash,
      asset_manifest: {
        id: officialMvuAssetManifest.id,
        revision: officialMvuAssetManifest.revision,
        hash: officialMvuAssetManifest.hash,
        assets: mvuRuntimeAssets(),
      },
      generated_entry_ids: [
        "plugin.mvu-zod.initvar",
        "plugin.mvu-zod.variable-list",
        "plugin.mvu-zod.update-rules",
        "plugin.mvu-zod.output-format",
      ],
    },
  });
  return {
    source: parsed,
    schema_source: schemaSource,
    initial_state: initialState,
    path_registry: pathRegistry,
    asset_manifest: officialMvuAssetManifest,
    artifact_revision: artifactRevision,
    contributions,
  };
}

export {
  buildMvuPathRegistry,
  generateMvuInitVar,
  generateMvuInitialState,
  generateMvuInitialStateJson,
  generateMvuLoreEntries,
  generateMvuOutputFormat,
  generateMvuRegexScripts,
  generateMvuUpdateRules,
  generateMvuVariableList,
  generateMvuZodSource,
  normalizeMvuSource,
  validateMvuSource,
};

export type { MvuPathBinding, MvuPathRegistry, NormalizedMvuNode } from "./paths.js";
