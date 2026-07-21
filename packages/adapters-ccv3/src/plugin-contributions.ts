import { createHash } from "node:crypto";

import type {
  CanonicalProjectIr,
  CharacterCardV3,
  JsonObject,
  JsonValue,
  PluginContributions,
} from "@card-workspace/schemas";

import { deepMergeJson } from "./merge.js";
import {
  managedPluginResourceId,
  sillytavernRegexHelperProfileId,
  toManagedRegexScriptV1,
  toManagedTavernHelperScriptV1,
  validatePluginCompatibilityProfile,
} from "./plugin-profile-v1.js";

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("plugin contribution 不接受非 finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("plugin contribution 不接受 undefined 或 function");
}

function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function comparableManagedContent(value: JsonValue, root = true): JsonValue {
  if (Array.isArray(value)) return value.map((child) => comparableManagedContent(child, false));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !root || (key !== "id" && key !== "card-workspace_content_hash"))
      .map(([key, child]) => [key, comparableManagedContent(child, false)]));
  }
  return value;
}

function sameManagedContent(existing: JsonValue, generated: JsonValue): boolean {
  return contentHash(comparableManagedContent(existing)) === contentHash(comparableManagedContent(generated));
}

function appendManaged(array: JsonValue[], generated: JsonObject, id: string, path: string): void {
  const existingIndex = array.findIndex((value) => (
    typeof value === "object" && value !== null && !Array.isArray(value) && value.id === id
  ));
  const withHash: JsonObject = { ...generated, id, "card-workspace_content_hash": contentHash(generated) };
  if (existingIndex < 0) {
    array.push(withHash);
    return;
  }
  const existing = array[existingIndex];
  if (!existing || typeof existing !== "object" || Array.isArray(existing) || !sameManagedContent(existing, withHash)) {
    throw new Error(`Plugin managed contribution collision at ${path} id=${id}`);
  }
}

function requiredArray(target: JsonObject, key: string, path: string): JsonValue[] {
  const value = target[key];
  if (value === undefined) {
    target[key] = [];
    return target[key] as JsonValue[];
  }
  if (!Array.isArray(value)) throw new Error(`CCv3 target must be an array: ${path}`);
  return value;
}

function withoutUndefined(value: object): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as JsonObject;
}

function applyPluginContribution(card: CharacterCardV3, contribution: PluginContributions): void {
  const data = card.data as unknown as JsonObject;
  const characterBook = data.character_book;
  if (characterBook !== undefined && (typeof characterBook !== "object" || characterBook === null || Array.isArray(characterBook))) {
    throw new Error("CCv3 target /data/character_book must be an object");
  }
  const book = (characterBook ?? { name: `${card.data.name} Worldbook`, extensions: {}, entries: [] }) as JsonObject;
  if (characterBook === undefined) data.character_book = book;

  const loreEntries = requiredArray(book, "entries", "/data/character_book/entries/-");
  for (const entry of [...contribution.lore_entries].sort((left, right) => lexicalCompare(left.id, right.id))) {
    appendManaged(loreEntries, withoutUndefined({
      id: entry.id,
      name: entry.name,
      keys: entry.keys,
      content: entry.content,
      extensions: entry.extensions,
      enabled: entry.enabled,
      insertion_order: entry.insertion_order,
      use_regex: entry.use_regex ?? false,
      constant: entry.constant,
      position: entry.position,
      depth: entry.depth,
      role: entry.role,
    }), entry.id, "/data/character_book/entries/-");
  }

  const extensions = data.extensions as JsonObject;
  const regexTarget = requiredArray(extensions, "regex_scripts", "/data/extensions/regex_scripts/-");
  for (const script of [...contribution.regex_scripts].sort((left, right) => lexicalCompare(left.scriptName, right.scriptName))) {
    const id = managedPluginResourceId(contribution.plugin_id, contribution.implementation.version, "regex", script.scriptName);
    appendManaged(regexTarget, toManagedRegexScriptV1(script, id), id, "/data/extensions/regex_scripts/-");
  }

  const helperTarget = requiredArray(extensions, "tavern_helper/scripts", "/data/extensions/tavern_helper/scripts/-");
  for (const script of [...contribution.helper_scripts].sort((left, right) => lexicalCompare(left.id, right.id))) {
    const id = managedPluginResourceId(contribution.plugin_id, contribution.implementation.version, "helper", script.id);
    appendManaged(helperTarget, toManagedTavernHelperScriptV1(script, id), id, "/data/extensions/tavern_helper/scripts/-");
  }

  const traceRoot = extensions["card-workspace"];
  if (traceRoot !== undefined && (typeof traceRoot !== "object" || traceRoot === null || Array.isArray(traceRoot))) {
    throw new Error("CCv3 target /data/extensions/card-workspace must be an object");
  }
  const trace = (traceRoot ?? {}) as JsonObject;
  extensions["card-workspace"] = trace;
  const pluginTrace = trace.plugins;
  if (pluginTrace !== undefined && (typeof pluginTrace !== "object" || pluginTrace === null || Array.isArray(pluginTrace))) {
    throw new Error("CCv3 target /data/extensions/card-workspace/plugins must be an object");
  }
  const plugins = (pluginTrace ?? {}) as JsonObject;
  trace.plugins = plugins;
  const record: JsonObject = {
    artifact_revision: contribution.artifact_revision,
    implementation: contribution.implementation,
    compatibility_profile: sillytavernRegexHelperProfileId,
    metadata: contribution.metadata,
  };
  const existingRecord = plugins[contribution.plugin_id];
  if (existingRecord !== undefined && !sameManagedContent(existingRecord, record)) {
    throw new Error(`Plugin trace collision at /data/extensions/card-workspace/plugins/${contribution.plugin_id}`);
  }
  plugins[contribution.plugin_id] = record;
}

export function applyPluginContributionsToCharacterCard(
  card: CharacterCardV3,
  contributions: readonly PluginContributions[] = [],
): CharacterCardV3 {
  const result = structuredClone(card);
  for (const rawContribution of contributions) {
    applyPluginContribution(result, validatePluginCompatibilityProfile(rawContribution));
  }
  return result;
}

export function applyPluginGreetingOperations(
  greeting: CanonicalProjectIr["greetings"][number],
  contributions: readonly PluginContributions[] = [],
): string {
  let content = greeting.content;
  const operations = contributions
    .flatMap((contribution) => contribution.greeting_operations
      .filter((operation) => operation.greeting_id === greeting.id)
      .map((operation) => ({ pluginId: contribution.plugin_id, operation })))
    .sort((left, right) => lexicalCompare(left.pluginId, right.pluginId));
  for (const { operation } of operations) {
    if (operation.mode === "replace") {
      content = operation.content;
    } else if (!content.endsWith(operation.content)) {
      content = `${content}${operation.content}`;
    }
  }
  return content;
}

export function mergePluginMetadata(base: JsonObject, contributions: readonly PluginContributions[]): JsonObject {
  return contributions.reduce((result, contribution) => deepMergeJson(result, {
    "card-workspace": {
      plugins: {
        [contribution.plugin_id]: {
          artifact_revision: contribution.artifact_revision,
          implementation: contribution.implementation,
        },
      },
    },
  }), structuredClone(base));
}
