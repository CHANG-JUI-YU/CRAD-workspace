import {
  pluginImplementationPinSchema,
  pluginSourceSchema,
  type BlueprintPluginSelection,
  type OfficialPluginId,
  type PluginImplementationPin,
  type PluginSource,
  type Revision,
} from "@card-workspace/schemas";

import { canonicalJson, revisionFor } from "./canonical.js";
import { generatePluginContributions, type PluginGenerationContext } from "./generators.js";
import { officialMvuAssetPin } from "./official/assets.js";
import { compileMvuSource } from "./official/mvu/index.js";

export interface OfficialPluginDefinition {
  readonly id: OfficialPluginId;
  readonly dependencies: readonly OfficialPluginId[];
  readonly capabilityDependencies?: Readonly<Record<string, readonly OfficialPluginId[]>>;
}

export const officialPluginRegistry: Readonly<Record<OfficialPluginId, OfficialPluginDefinition>> = {
  "official.mvu-zod": { id: "official.mvu-zod", dependencies: [] },
  "official.ejs": { id: "official.ejs", dependencies: ["official.mvu-zod"] },
  "official.html": {
    id: "official.html",
    dependencies: [],
    capabilityDependencies: { "html.status_bar": ["official.mvu-zod"] },
  },
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Resolves the capability-sensitive dependency closure for an approved selection. */
export function resolvePluginSelectionDependencies(
  selections: readonly BlueprintPluginSelection[],
): OfficialPluginId[] {
  const ids = new Set<OfficialPluginId>(selections.map((selection) => selection.plugin_id));
  for (const selection of selections) {
    const definition = officialPluginRegistry[selection.plugin_id];
    for (const dependency of definition.dependencies) ids.add(dependency);
    for (const capability of selection.capabilities) {
      for (const dependency of definition.capabilityDependencies?.[capability] ?? []) ids.add(dependency);
    }
  }
  return [...ids].sort(compareText);
}

export interface OfficialPluginImplementationRecord {
  readonly plugin_id: OfficialPluginId;
  readonly implementation: PluginImplementationPin;
}

export interface OfficialPluginMigration {
  readonly plugin_id: OfficialPluginId;
  readonly from: PluginImplementationPin;
  readonly to: PluginImplementationPin;
  readonly revision: Revision;
}

export interface OfficialPluginImplementationRegistry {
  readonly schema_version: 1;
  readonly revision: Revision;
  readonly implementations: readonly OfficialPluginImplementationRecord[];
  readonly migrations: readonly OfficialPluginMigration[];
}

export interface OfficialPluginMigrationInput {
  readonly plugin_id: OfficialPluginId;
  readonly from: PluginImplementationPin;
  readonly to: PluginImplementationPin;
}

function pinIdentity(pluginId: OfficialPluginId, implementation: PluginImplementationPin): string {
  return canonicalJson({ plugin_id: pluginId, implementation });
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function createOfficialPluginImplementationRegistry(
  implementations: readonly OfficialPluginImplementationRecord[],
  migrations: readonly OfficialPluginMigrationInput[] = [],
): OfficialPluginImplementationRegistry {
  const normalizedImplementations = implementations
    .map((record) => ({
      plugin_id: record.plugin_id,
      implementation: pluginImplementationPinSchema.parse(record.implementation),
    }))
    .sort((left, right) =>
      compareText(left.plugin_id, right.plugin_id)
      || compareText(left.implementation.version, right.implementation.version)
      || compareText(left.implementation.digest, right.implementation.digest),
    );
  const seenIdentities = new Set<string>();
  const seenVersions = new Map<string, string>();
  for (const record of normalizedImplementations) {
    const identity = pinIdentity(record.plugin_id, record.implementation);
    if (seenIdentities.has(identity)) {
      throw new Error(`plugin implementation pin 重複: ${record.plugin_id}@${record.implementation.version}`);
    }
    seenIdentities.add(identity);
    const versionKey = `${record.plugin_id}@${record.implementation.version}`;
    const previousDigest = seenVersions.get(versionKey);
    if (previousDigest !== undefined && previousDigest !== record.implementation.digest) {
      throw new Error(`同一 plugin implementation version 不可使用不同 digest: ${versionKey}`);
    }
    seenVersions.set(versionKey, record.implementation.digest);
  }

  const resolveInput = (pluginId: OfficialPluginId, implementation: PluginImplementationPin): void => {
    if (!normalizedImplementations.some((record) => pinIdentity(record.plugin_id, record.implementation) === pinIdentity(pluginId, implementation))) {
      throw new Error(`migration 引用未註冊的 implementation pin: ${pluginId}@${implementation.version}`);
    }
  };
  const normalizedMigrations = migrations
    .map((migration) => {
      const from = pluginImplementationPinSchema.parse(migration.from);
      const to = pluginImplementationPinSchema.parse(migration.to);
      if (canonicalJson(from) === canonicalJson(to)) {
        throw new Error(`migration 不可使用相同 implementation pin: ${migration.plugin_id}`);
      }
      resolveInput(migration.plugin_id, from);
      resolveInput(migration.plugin_id, to);
      return {
        plugin_id: migration.plugin_id,
        from,
        to,
        revision: revisionFor({ schema_version: 1, plugin_id: migration.plugin_id, from, to }),
      } satisfies OfficialPluginMigration;
    })
    .sort((left, right) =>
      compareText(left.plugin_id, right.plugin_id)
      || compareText(left.from.version, right.from.version)
      || compareText(left.to.version, right.to.version),
    );
  const body = {
    schema_version: 1 as const,
    implementations: normalizedImplementations,
    migrations: normalizedMigrations,
  };
  return freezeDeep({ ...body, revision: revisionFor(body) });
}

export function resolveExactPluginImplementation(
  registry: OfficialPluginImplementationRegistry,
  pluginId: OfficialPluginId,
  implementation: PluginImplementationPin,
): OfficialPluginImplementationRecord {
  const parsed = pluginImplementationPinSchema.parse(implementation);
  const match = registry.implementations.find((record) =>
    pinIdentity(record.plugin_id, record.implementation) === pinIdentity(pluginId, parsed));
  if (match) return match;
  const sameVersion = registry.implementations.some((record) =>
    record.plugin_id === pluginId && record.implementation.version === parsed.version);
  if (sameVersion) {
    throw new Error(`implementation pin digest 不符，禁止 fall-forward: ${pluginId}@${parsed.version}`);
  }
  throw new Error(`未知的 exact implementation pin: ${pluginId}@${parsed.version}`);
}

export function assertPluginSourcePinned(
  registry: OfficialPluginImplementationRegistry,
  source: PluginSource,
): OfficialPluginImplementationRecord {
  const parsed = pluginSourceSchema.parse(source);
  return resolveExactPluginImplementation(registry, parsed.plugin_id, parsed.implementation);
}

export function assertRegistryUpgradePreservesPins(
  previous: OfficialPluginImplementationRegistry,
  next: OfficialPluginImplementationRegistry,
): void {
  for (const record of previous.implementations) {
    resolveExactPluginImplementation(next, record.plugin_id, record.implementation);
  }
}

export interface MigratedPluginSource {
  readonly source: PluginSource;
  readonly migration_revision: Revision;
  readonly from: PluginImplementationPin;
  readonly to: PluginImplementationPin;
}

export function migratePinnedPluginSource(
  registry: OfficialPluginImplementationRegistry,
  source: PluginSource,
  target: PluginImplementationPin,
): MigratedPluginSource {
  const parsed = pluginSourceSchema.parse(source);
  const current = resolveExactPluginImplementation(registry, parsed.plugin_id, parsed.implementation);
  const next = resolveExactPluginImplementation(registry, parsed.plugin_id, target);
  const migration = registry.migrations.find((item) =>
    item.plugin_id === parsed.plugin_id
    && canonicalJson(item.from) === canonicalJson(current.implementation)
    && canonicalJson(item.to) === canonicalJson(next.implementation));
  if (!migration) {
    throw new Error(`未找到明確 migration，拒絕自動升級 ${parsed.plugin_id}`);
  }
  return {
    source: pluginSourceSchema.parse({ ...parsed, implementation: next.implementation }),
    migration_revision: migration.revision,
    from: current.implementation,
    to: next.implementation,
  };
}

const localAssetManifest = {
  id: "card-workspace-plugin-assets",
  revision: revisionFor({ schema_version: 1, id: "card-workspace-plugin-assets", assets: [] }),
  hash: revisionFor({ schema_version: 1, id: "card-workspace-plugin-assets", assets: [] }),
} as const;

function localOfficialPin(pluginId: OfficialPluginId): PluginImplementationPin {
  const digest = revisionFor({ schema_version: 1, plugin_id: pluginId, generator: "card-workspace-official-plugin", version: "1.0.0" });
  return pluginId === "official.mvu-zod"
    ? officialMvuAssetPin({ version: "1.0.0", digest })
    : {
        version: "1.0.0",
        digest,
        asset_manifest_id: localAssetManifest.id,
        asset_manifest_revision: localAssetManifest.revision,
        asset_manifest_hash: localAssetManifest.hash,
      };
}

export const officialPluginImplementationRegistry = createOfficialPluginImplementationRegistry([
  { plugin_id: "official.ejs", implementation: localOfficialPin("official.ejs") },
  { plugin_id: "official.html", implementation: localOfficialPin("official.html") },
  { plugin_id: "official.mvu-zod", implementation: localOfficialPin("official.mvu-zod") },
]);

export function officialPluginImplementationPin(pluginId: OfficialPluginId): PluginImplementationPin {
  const record = officialPluginImplementationRegistry.implementations.find((item) => item.plugin_id === pluginId);
  if (!record) throw new Error(`缺少官方 plugin implementation pin: ${pluginId}`);
  return record.implementation;
}

function requiresMvu(source: PluginSource): boolean {
  return source.plugin_id === "official.ejs"
    || (source.plugin_id === "official.html" && source.features.includes("status_bar"));
}

export function resolveActivePluginSources(sources: readonly PluginSource[]): PluginSource[] {
  const parsed = sources.map((source) => pluginSourceSchema.parse(source));
  const byId = new Map<OfficialPluginId, PluginSource>();
  for (const source of parsed) {
    if (byId.has(source.plugin_id)) throw new Error(`Plugin 不可重複啟用: ${source.plugin_id}`);
    byId.set(source.plugin_id, source);
  }
  for (const source of parsed) {
    if (requiresMvu(source) && !byId.has("official.mvu-zod")) {
      throw new Error(`${source.plugin_id} 依賴 official.mvu-zod，缺少 MVU source`);
    }
  }
  const order: OfficialPluginId[] = ["official.mvu-zod", "official.ejs", "official.html"];
  return order.flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
}

export function generateActivePluginContributions(
  sources: readonly PluginSource[],
  context: PluginGenerationContext = {},
) {
  const resolved = resolveActivePluginSources(sources);
  if (context.implementationRegistry) {
    for (const source of resolved) assertPluginSourcePinned(context.implementationRegistry, source);
  }
  const mvuSource = resolved.find((source) => source.plugin_id === "official.mvu-zod");
  const resolvedContext = mvuSource
    ? { ...context, mvuPathRegistry: compileMvuSource(mvuSource).path_registry }
    : context;
  return resolved.map((source) => generatePluginContributions(source, resolvedContext));
}
