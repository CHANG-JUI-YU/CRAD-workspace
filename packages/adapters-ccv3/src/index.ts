import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, contentHash } from "@st-workspace/core";

export type JsonObject = Record<string, unknown>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const ccv3LoreEntrySchema = z.object({
  keys: z.array(z.string()),
  content: z.string(),
  extensions: jsonObjectSchema,
  enabled: z.boolean(),
  insertion_order: z.number().int(),
  use_regex: z.boolean(),
  name: z.string().optional(),
  comment: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  selective: z.boolean().optional(),
  secondary_keys: z.array(z.string()).optional(),
  position: z.enum(["before_char", "after_char"]).optional(),
}).passthrough();

export const ccv3LorebookSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  extensions: jsonObjectSchema,
  entries: z.array(ccv3LoreEntrySchema),
}).passthrough();

const ccv3DataSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  personality: z.string(),
  scenario: z.string(),
  first_mes: z.string(),
  mes_example: z.string(),
  creator_notes: z.string(),
  system_prompt: z.string(),
  post_history_instructions: z.string(),
  alternate_greetings: z.array(z.string()),
  group_only_greetings: z.array(z.string()),
  tags: z.array(z.string()),
  creator: z.string(),
  character_version: z.string(),
  wardrobe: z.string().optional(),
  extensions: jsonObjectSchema,
  character_book: ccv3LorebookSchema.optional(),
}).passthrough();

export const characterCardV3Schema = z.object({
  spec: z.literal("chara_card_v3"),
  spec_version: z.literal("3.0"),
  data: ccv3DataSchema,
}).passthrough();

export type CharacterCardV3 = z.infer<typeof characterCardV3Schema>;
export type Ccv3LoreEntry = z.infer<typeof ccv3LoreEntrySchema>;

export interface Ccv3Project {
  project_id: string;
  title: string;
  name: string;
  character_book_name?: string;
  character_book_description?: string;
  description: string;
  personality: string;
  scenario: string;
  wardrobe?: string;
  first_mes: string;
  alternate_greetings: string[];
  group_only_greetings: string[];
  lore_entries: Ccv3LoreEntry[];
  extensions?: JsonObject;
  artifact_ids?: string[];
  artifact_revisions?: Record<string, string>;
}

export interface PluginLoreEntry {
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  insertion_order: number;
  extensions?: JsonObject;
  position?: "before_char" | "after_char";
}

export interface PluginRegexScript {
  id?: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: boolean;
  minDepth?: number | null;
  maxDepth?: number | null;
}

export interface PluginHelperScript {
  type: "script";
  enabled: boolean;
  id: string;
  name: string;
  content: string;
  info: string;
  button: { enabled: boolean; buttons: Array<{ name: string; visible: boolean }> };
  data: Record<string, unknown>;
}

export interface PluginContribution {
  schema_version: 1;
  plugin_id: string;
  implementation: { version: string };
  artifact_revision: string;
  lore_entries: PluginLoreEntry[];
  regex_scripts: PluginRegexScript[];
  helper_scripts: PluginHelperScript[];
  greeting_operations: Array<{ greeting_id: string; mode: "append" | "replace"; content: string }>;
  metadata: JsonObject;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function managedId(pluginId: string, version: string, kind: string, value: string): string {
  const digest = createHash("sha256").update(`${pluginId}\n${version}\n${kind}\n${value}`, "utf8").digest("hex").slice(0, 24);
  return `cw.${pluginId.replaceAll(/[^a-z0-9]+/giu, "-")}.${kind}.${digest}`;
}

function managedHash(value: unknown): string {
  return contentHash(canonicalJson(value));
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .filter(([key]) => key !== "id" && key !== "card-workspace_content_hash")
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([key, child]) => [key, comparable(child)]));
  }
  return value;
}

function sameManagedContent(left: unknown, right: unknown): boolean {
  return managedHash(comparable(left)) === managedHash(comparable(right));
}

function appendManaged(target: unknown[], generated: JsonObject, id: string, targetPath: string): void {
  const existingIndex = target.findIndex((item) => item !== null && typeof item === "object" && !Array.isArray(item) && (item as JsonObject).id === id);
  const value = { ...generated, id, "card-workspace_content_hash": managedHash(generated) };
  if (existingIndex < 0) {
    target.push(value);
    return;
  }
  const existing = target[existingIndex];
  if (!sameManagedContent(existing, value)) throw new Error(`Plugin contribution collision at ${targetPath} id=${id}`);
}

function requiredArray(parent: JsonObject, key: string, targetPath: string): unknown[] {
  const current = parent[key];
  if (current === undefined) {
    parent[key] = [];
    return parent[key] as unknown[];
  }
  if (!Array.isArray(current)) throw new Error(`CCv3 target must be an array: ${targetPath}`);
  return current;
}

function applyPluginContribution(card: CharacterCardV3, contribution: PluginContribution): void {
  const data = card.data as unknown as JsonObject;
  const book = (data.character_book ?? { name: `${card.data.name}_世界書`, description: "", extensions: {}, entries: [] }) as JsonObject;
  data.character_book = book;
  const entries = requiredArray(book, "entries", "/data/character_book/entries/-");
  for (const entry of [...contribution.lore_entries].sort((left, right) => lexicalCompare(left.id, right.id))) {
    const payload: JsonObject = {
      id: entry.id,
      name: entry.name,
      comment: entry.name,
      keys: [...entry.keys],
      content: entry.content,
      extensions: entry.extensions ?? {},
      enabled: entry.enabled,
      insertion_order: entry.insertion_order,
      use_regex: false,
      ...(entry.position === undefined ? {} : { position: entry.position }),
    };
    appendManaged(entries, payload, entry.id, "/data/character_book/entries/-");
  }

  const extensions = (data.extensions ?? {}) as JsonObject;
  data.extensions = extensions;
  const regexScripts = requiredArray(extensions, "regex_scripts", "/data/extensions/regex_scripts/-");
  for (const script of [...contribution.regex_scripts].sort((left, right) => lexicalCompare(left.scriptName, right.scriptName))) {
    const id = script.id ?? managedId(contribution.plugin_id, contribution.implementation.version, "regex", script.scriptName);
    appendManaged(regexScripts, { ...script, id }, id, "/data/extensions/regex_scripts/-");
  }
  const helperRoot = (extensions.tavern_helper ?? {}) as JsonObject;
  extensions.tavern_helper = helperRoot;
  const helperScripts = requiredArray(helperRoot, "scripts", "/data/extensions/tavern_helper/scripts/-");
  for (const script of [...contribution.helper_scripts].sort((left, right) => lexicalCompare(left.id, right.id))) {
    appendManaged(helperScripts, { ...script }, script.id, "/data/extensions/tavern_helper/scripts/-");
  }
  const workspaceRoot = (extensions["card-workspace"] ?? {}) as JsonObject;
  extensions["card-workspace"] = workspaceRoot;
  const plugins = (workspaceRoot.plugins ?? {}) as JsonObject;
  workspaceRoot.plugins = plugins;
  const trace = {
    artifact_revision: contribution.artifact_revision,
    implementation: contribution.implementation,
    metadata: contribution.metadata,
  };
  const existingTrace = plugins[contribution.plugin_id];
  if (existingTrace !== undefined && !sameManagedContent(existingTrace, trace)) {
    throw new Error(`Plugin trace collision at /data/extensions/card-workspace/plugins/${contribution.plugin_id}`);
  }
  plugins[contribution.plugin_id] = trace;
}

export function applyPluginContributionsToCharacterCard(card: CharacterCardV3, contributions: readonly PluginContribution[] = []): CharacterCardV3 {
  const result = structuredClone(card);
  for (const contribution of contributions) applyPluginContribution(result, contribution);
  return characterCardV3Schema.parse(result);
}

export function applyPluginGreetingOperations(greetingId: string, content: string, contributions: readonly PluginContribution[] = []): string {
  let result = content;
  const operations = contributions
    .flatMap((contribution) => contribution.greeting_operations
      .filter((operation) => operation.greeting_id === greetingId)
      .map((operation) => ({ plugin: contribution.plugin_id, operation })))
    .sort((left, right) => lexicalCompare(left.plugin, right.plugin));
  for (const { operation } of operations) result = operation.mode === "replace" ? operation.content : result.endsWith(operation.content) ? result : `${result}${operation.content}`;
  return result;
}

export function emitCharacterCardV3(project: Ccv3Project, options: { pluginContributions?: readonly PluginContribution[] } = {}): CharacterCardV3 {
  const contributions = options.pluginContributions ?? [];
  const projectExtensions = project.extensions ?? {};
  const projectWorkspace = projectExtensions["card-workspace"];
  const additionalExtensions = Object.fromEntries(Object.entries(projectExtensions).filter(([key]) => key !== "card-workspace"));
  const workspaceExtension = projectWorkspace !== null && typeof projectWorkspace === "object" && !Array.isArray(projectWorkspace) ? projectWorkspace : {};
  const card = characterCardV3Schema.parse({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: project.name,
      description: project.description,
      personality: project.personality,
      scenario: project.scenario,
      ...(project.wardrobe === undefined ? {} : { wardrobe: project.wardrobe }),
      first_mes: applyPluginGreetingOperations("primary", project.first_mes, contributions),
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: project.alternate_greetings.map((value, index) => applyPluginGreetingOperations(`alternate-${index}`, value, contributions)),
      group_only_greetings: project.group_only_greetings.map((value, index) => applyPluginGreetingOperations(`group-${index}`, value, contributions)),
      tags: [],
      creator: "ST Workspace V3",
      character_version: "3.0",
      extensions: {
        "card-workspace": {
          project_id: project.project_id,
          schema_version: 1,
          artifact_ids: project.artifact_ids ?? [],
          artifact_revisions: project.artifact_revisions ?? {},
          ...workspaceExtension,
        },
        ...additionalExtensions,
      },
      character_book: {
        name: project.character_book_name ?? `${project.name}_世界書`,
        description: project.character_book_description ?? "",
        extensions: {},
        entries: [...project.lore_entries].sort((left, right) => lexicalCompare(String(left.id ?? ""), String(right.id ?? ""))),
      },
    },
  });
  return applyPluginContributionsToCharacterCard(card, contributions);
}

export function canonicalCardJson(card: CharacterCardV3): string {
  return canonicalJson(characterCardV3Schema.parse(card));
}

export function cardContentHash(card: CharacterCardV3): string {
  return contentHash(canonicalCardJson(card));
}

export function managedPluginResourceId(pluginId: string, version: string, kind: string, value: string): string {
  return managedId(pluginId, version, kind, value);
}
