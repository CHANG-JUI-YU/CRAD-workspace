import {
  canonicalJson,
  contentHash,
  pluginProposalValueSchema,
  type PluginSource,
  type TemplateProposalValue,
} from "@st-workspace/core";
import type { PluginContribution, PluginHelperScript, PluginLoreEntry } from "@st-workspace/adapters-ccv3";

type PluginProposal = Extract<TemplateProposalValue, { kind: "plugin" }>;

const implementationVersions: Record<PluginSource["plugin_id"], string> = {
  "official.mvu-zod": "1.0.0",
  "official.ejs": "1.0.0",
  "official.html": "1.0.0",
};

function revision(value: unknown): string {
  return contentHash(canonicalJson(value));
}

function safeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function conditionText(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.kind === "literal") return `literal=${JSON.stringify(record.value)}`;
    return `${String(record.path)} ${String(record.operator)}${record.value === undefined ? "" : ` ${JSON.stringify(record.value)}`}`;
  }
  return `literal=${JSON.stringify(value)}`;
}

function helper(id: string, name: string, content: string, info: string, data: Record<string, unknown> = {}): PluginHelperScript {
  return { type: "script", enabled: true, id, name, content, info, button: { enabled: false, buttons: [] }, data };
}

function entry(id: string, name: string, content: string, keys: string[] = []): PluginLoreEntry {
  return { id, name, keys, content, enabled: true, insertion_order: 1000, extensions: { "card-workspace": { managed: true } }, position: "after_char" };
}

function mvuRuntimeSource(variables: Array<Record<string, unknown>>): { init: string; update: string; run: string } {
  const defaults = Object.fromEntries(variables.map((variable) => [variable.id, variable.default ?? null]));
  const registry = Object.fromEntries(variables.map((variable) => [
    `/${variable.id}`,
    { kind: variable.kind, writable: variable.writable ?? false },
  ]));
  const init = `(function () { return ${JSON.stringify(defaults)}; })`;
  const update = `(function (state, path, value) { const registry = ${JSON.stringify(registry)}; if (!Object.prototype.hasOwnProperty.call(registry, path)) return state; const node = registry[path]; if (node.writable === false) return state; if (value === undefined) return state; const next = Object.assign({}, state); const key = path.slice(1); switch (node.kind) { case "string": if (typeof value !== "string") return state; next[key] = value; break; case "number": case "integer": if (typeof value !== "number" || !Number.isFinite(value)) return state; next[key] = value; break; case "boolean": if (typeof value !== "boolean") return state; next[key] = value; break; default: next[key] = value; } return next; })`;
  const run = `(function (state, path) { return Object.prototype.hasOwnProperty.call(state, path.slice(1)) ? state[path.slice(1)] : undefined; })`;
  return { init, update, run };
}

function ejsEvaluatorSource(): string {
  return `(function (condition, context) { if (condition === null || typeof condition !== "object") return false; if (condition.kind === "literal") return context.literal === condition.value; const parts = String(condition.path).split("/").filter(Boolean); let current = context; for (const part of parts) { if (current === null || current === undefined || typeof current !== "object") return false; current = current[part]; } switch (condition.operator) { case "equals": return current === condition.value; case "not_equals": return current !== condition.value; case "greater_than": return current > condition.value; case "less_than": return current < condition.value; case "truthy": return Boolean(current); case "falsy": return !current; } return false; })`;
}

function compileMvu(proposal: PluginProposal): PluginContribution {
  if (proposal.source.plugin_id !== "official.mvu-zod") throw new Error("MVU compiler received a different plugin source");
  const source = proposal.source;
  const variables = source.variables as Array<Record<string, unknown>>;
  const pathRegistry = Object.fromEntries(variables.map((variable) => [
    `/${variable.id}`,
    { id: variable.id, kind: variable.kind, label: variable.label, writable: variable.writable, visibility: variable.visibility, default: variable.default },
  ]));
  const runtime = mvuRuntimeSource(variables);
  const generated = {
    schema_version: 1,
    plugin_id: source.plugin_id,
    implementation: { version: implementationVersions[source.plugin_id] },
    variables,
    update_rules: source.update_rules,
    path_registry: pathRegistry,
    runtime,
  };
  const artifactRevision = revision(generated);
  return {
    schema_version: 1,
    plugin_id: source.plugin_id,
    implementation: generated.implementation,
    artifact_revision: artifactRevision,
    lore_entries: [entry("plugin.mvu-zod.contract", "MVU typed state contract", JSON.stringify({ variables: source.variables, update_rules: source.update_rules }))],
    regex_scripts: [],
    helper_scripts: [helper("plugin.mvu-zod.runtime", "MVU Zod runtime manifest", JSON.stringify(generated), "Generated from the typed official.mvu-zod proposal.", { runtime })],
    greeting_operations: [],
    metadata: { source_schema_version: 1, path_registry: pathRegistry, variable_count: variables.length, generated_entry_ids: ["plugin.mvu-zod.contract"], runtime },
  };
}

function compileEjs(proposal: PluginProposal): PluginContribution {
  if (proposal.source.plugin_id !== "official.ejs") throw new Error("EJS compiler received a different plugin source");
  const source = proposal.source;
  const loreEntries: PluginLoreEntry[] = [
    ...source.entries.map((item) => entry(`plugin.ejs.entry.${item.id}`, `EJS entry ${item.id}`, `[when ${conditionText(item.when)}]\n${item.content}`)),
    ...source.sections.map((section) => entry(`plugin.ejs.section.${section.id}`, `EJS section ${section.id}`, [
      ...section.branches.map((branch) => `[when ${conditionText(branch.when)}]\n${branch.content}`),
      ...(section.fallback === undefined ? [] : [`[fallback]\n${section.fallback}`]),
    ].join("\n"))),
    ...source.dynamic_text.map((item) => entry(`plugin.ejs.dynamic.${item.id}`, `EJS dynamic text ${item.id}`, [
      ...item.branches.map((branch) => `[when ${conditionText(branch.when)}]\n${branch.text}`),
      ...(item.fallback === undefined ? [] : [`[fallback]\n${item.fallback}`]),
    ].join("\n"))),
  ];
  const generated = { plugin_id: source.plugin_id, implementation: { version: implementationVersions[source.plugin_id] }, entries: loreEntries, preprocessing: source.preprocessing };
  const evaluateCondition = ejsEvaluatorSource();
  return {
    schema_version: 1,
    plugin_id: source.plugin_id,
    implementation: generated.implementation,
    artifact_revision: revision(generated),
    lore_entries: loreEntries,
    regex_scripts: [],
    helper_scripts: [helper("plugin.ejs.manifest", "Typed EJS manifest", JSON.stringify({ preprocessing: source.preprocessing, entry_ids: loreEntries.map((item) => item.id) }), "Generated from typed EJS branches; authored raw delimiters are rejected.", { runtime: { evaluateCondition } })],
    greeting_operations: [],
    metadata: { source_schema_version: 1, preprocessing: source.preprocessing, generated_entry_ids: loreEntries.map((item) => item.id), runtime: { evaluateCondition } },
  };
}

function renderHtmlComponent(component: Extract<PluginSource, { plugin_id: "official.html" }>["components"][number]): string {
  const text = component.text.map((item) => safeText(item.value)).join("");
  const uniqueBindings = [...new Set(component.binding_paths)];
  const bindings = uniqueBindings.length === 0 ? "" : ` data-cw-bind="${uniqueBindings.map((path) => safeText(path)).join(" ")}"`;
  const label = safeText(component.label);
  if (component.tag === "input") return `<${component.tag} aria-label="${label}"${bindings}>`;
  return `<${component.tag} data-cw-component="${safeText(component.id)}" aria-label="${label}"${bindings}>${text}</${component.tag}>`;
}

function compileHtml(proposal: PluginProposal): PluginContribution {
  if (proposal.source.plugin_id !== "official.html") throw new Error("HTML compiler received a different plugin source");
  const source = proposal.source;
  const markup = source.components.map(renderHtmlComponent).join("\n");
  const generated = { plugin_id: source.plugin_id, implementation: { version: implementationVersions[source.plugin_id] }, features: source.features, markup };
  const greetingOperations = source.features.includes("greeting_selector")
    ? [{ greeting_id: "primary", mode: "append" as const, content: `\n${markup}` }]
    : [];
  const injectionSlots = source.features.map((feature) => ({
    feature,
    slot: feature === "greeting_selector" ? "greeting" : feature === "status_bar" ? "status_bar" : "message_presentation",
    mode: "append" as const,
  }));
  return {
    schema_version: 1,
    plugin_id: source.plugin_id,
    implementation: generated.implementation,
    artifact_revision: revision(generated),
    lore_entries: [],
    regex_scripts: [],
    helper_scripts: [helper("plugin.html.runtime", "Typed HTML runtime manifest", JSON.stringify({ features: source.features, markup, components: source.components.map((component) => ({ id: component.id, feature: component.feature, binding_paths: [...new Set(component.binding_paths)] })) }), "Generated from the HTML allowlist; no script or remote resource is accepted.")],
    greeting_operations: greetingOperations,
    metadata: { source_schema_version: 1, policy: "html-policy@1", features: source.features, component_ids: source.components.map((component) => component.id), markup, injection_slots: injectionSlots },
  };
}

export function generatePluginContributions(proposal: unknown): PluginContribution {
  const parsed = pluginProposalValueSchema.parse(proposal);
  switch (parsed.plugin_id) {
    case "official.mvu-zod": return compileMvu(parsed);
    case "official.ejs": return compileEjs(parsed);
    case "official.html": return compileHtml(parsed);
  }
}

export const compilePluginProposal = generatePluginContributions;
