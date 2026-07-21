import type { EjsSource, JsonValue, PluginContributions } from "@card-workspace/schemas";

import { conditionCode } from "./generate-expression.js";
import { emitEjsControl, emitEjsJsonLiteral, emitEjsOutputText, emitEjsStringLiteral, reparseGeneratedEjs } from "./ejs-literal.js";
import type { MvuPathRegistry } from "../mvu/paths.js";
import type { EjsValidationContext } from "./validate.js";

function lore(
  id: string,
  name: string,
  content: string,
  insertionOrder: number,
  kind: string,
): PluginContributions["lore_entries"][number] {
  return {
    id,
    name,
    keys: [],
    content: reparseGeneratedEjs(content),
    use_regex: false,
    enabled: true,
    insertion_order: insertionOrder,
    constant: true,
    position: "after_char",
    extensions: {
      "card-workspace/plugin": "official.ejs",
      "card-workspace/ejs-kind": kind,
    },
  };
}

function preprocessing(context: EjsValidationContext): PluginContributions["lore_entries"][number] {
  const lines = ["@@preprocessing"];
  for (const alias of [...context.aliases].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    lines.push(emitEjsControl(`define(${emitEjsStringLiteral(alias.variable)}, getvar(${emitEjsStringLiteral(alias.binding.read_path)}, { defaults: ${emitEjsJsonLiteral(alias.binding.default)} }));`));
  }
  return lore("plugin.ejs.preprocessing", "EJS preprocessing", lines.join("\n"), 19_900, "preprocessing");
}

interface RenderBranch {
  readonly when: Parameters<typeof conditionCode>[0];
  readonly output: string;
}

function renderBranches(
  branches: readonly RenderBranch[],
  fallback: string | undefined,
  context: EjsValidationContext,
): string {
  const lines: string[] = [];
  branches.forEach((branch, index) => {
    if (index === 0) lines.push(emitEjsControl(`if (${conditionCode(branch.when, context)}) {`));
    else lines.push(emitEjsControl(`} else if (${conditionCode(branch.when, context)}) {`));
    lines.push(emitEjsOutputText(branch.output));
  });
  if (fallback !== undefined) {
    lines.push(emitEjsControl("} else {"));
    lines.push(emitEjsOutputText(fallback));
  }
  lines.push(emitEjsControl("}"));
  return lines.join("\n");
}

export function generateEjsLoreEntries(context: EjsValidationContext): PluginContributions["lore_entries"] {
  const source: EjsSource = context.source;
  const entries = [preprocessing(context)];
  entries.push(...source.entries
    .slice()
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((entry) => lore(
      `plugin.ejs.entry.${entry.id}`,
      `EJS entry ${entry.id}`,
      `@@if ${conditionCode(entry.condition, context)}\n${emitEjsOutputText(entry.content)}`,
      20_000,
      "entry",
    )));
  entries.push(...source.sections
    .slice()
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((section) => lore(
      `plugin.ejs.section.${section.id}`,
      `EJS section ${section.id}`,
       renderBranches(section.branches.map((branch) => ({ when: branch.when, output: branch.content })), section.fallback, context),
      20_100,
      "section",
    )));
  entries.push(...source.dynamic_text
    .slice()
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((dynamic) => lore(
      `plugin.ejs.dynamic.${dynamic.id}`,
      `EJS dynamic text ${dynamic.id}`,
       renderBranches(dynamic.branches.map((branch) => ({ when: branch.when, output: branch.text })), dynamic.fallback, context),
      20_200,
      "dynamic-text",
    )));
  return entries;
}

function pathRegistryMetadata(registry: MvuPathRegistry): JsonValue {
  const paths: Record<string, JsonValue> = {};
  for (const [path, binding] of Object.entries(registry.paths)) {
    paths[path] = {
      id: binding.id,
      label: binding.label,
      kind: binding.kind,
      path: binding.path,
      read_path: binding.read_path,
      patch_path: binding.patch_path,
      default: binding.default,
      ...(binding.min === undefined ? {} : { min: binding.min }),
      ...(binding.max === undefined ? {} : { max: binding.max }),
      ...(binding.values === undefined ? {} : { values: [...binding.values] }),
      writable: binding.writable,
      visibility: binding.visibility,
      container: binding.container,
    };
  }
  return {
    schema_version: registry.schema_version,
    paths,
    by_id: { ...registry.by_id },
    runtime_read_paths: { ...registry.runtime_read_paths },
    json_patch_paths: { ...registry.json_patch_paths },
  };
}

export function ejsMetadata(context: EjsValidationContext): Record<string, JsonValue> {
  return {
    entry_count: context.source.entries.length,
    section_count: context.source.sections.length,
    dynamic_text_count: context.source.dynamic_text.length,
    preprocessing_aliases: context.aliases.map((alias) => alias.id),
    path_registry: pathRegistryMetadata(context.mvuPathRegistry),
  };
}
