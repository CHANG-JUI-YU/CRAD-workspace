import {
  canonicalProjectIrSchema,
  type CanonicalLoreEntry,
  type CanonicalProjectIr,
  type PluginContributions,
} from "@card-workspace/schemas";

const pluginRole = ["system", "user", "assistant"] as const;

function pluginEntryActivation(entry: PluginContributions["lore_entries"][number]): CanonicalLoreEntry["activation"] {
  if (!entry.enabled) return { type: "disabled" };
  if (entry.constant === true || entry.keys.length === 0) return { type: "constant" };
  return {
    type: "keyed",
    keys: [...entry.keys],
    secondary_keys: [],
    secondary_logic: "any",
    use_regex: entry.use_regex,
    case_sensitive: false,
    match_whole_words: false,
    triggers: [],
  };
}

function pluginEntryPlacement(entry: PluginContributions["lore_entries"][number]): CanonicalLoreEntry["placement"] {
  if (entry.depth !== undefined) {
    return {
      type: "at_depth",
      depth: entry.depth,
      role: pluginRole[entry.role ?? 2] ?? "assistant",
    };
  }
  const position = entry.position === "before_char"
    ? "before_character"
    : entry.position === "after_char"
      ? "after_character"
      : entry.position ?? "after_character";
  return { type: position };
}

function toCanonicalPluginEntry(
  pluginId: string,
  entry: PluginContributions["lore_entries"][number],
  index: number,
): CanonicalLoreEntry {
  return {
    id: entry.id,
    category: `plugin-${pluginId}`,
    title: entry.name,
    fragments: [{
      id: `plugin-${pluginId.replaceAll(".", "-")}-${index}`,
      title: entry.name,
      content: entry.content,
      provenance: [],
      extensions: {},
    }],
    content_format: "raw",
    activation: pluginEntryActivation(entry),
    placement: pluginEntryPlacement(entry),
    recursion: { incoming: false, outgoing: false, max_depth: 1, depends_on: [] },
    insertion_order: 1_000_000 + index,
    priority: 0,
    provenance: [],
    extensions: {
      ...entry.extensions,
      "card-workspace/plugin-id": pluginId,
      "card-workspace/plugin-entry-id": entry.id,
    },
    passthrough: {},
    decisions: [
      { field: "activation", source: "stable_order", explanation: "由官方 plugin contribution 的 fixed activation 產生" },
      { field: "placement", source: "stable_order", explanation: "由官方 plugin contribution 的 fixed placement 產生" },
      { field: "recursion", source: "stable_order", explanation: "官方 plugin asset 不參與世界書遞迴" },
      { field: "insertion_order", source: "stable_order", explanation: "plugin entries 使用保留的 deterministic insertion range" },
    ],
  };
}

export function appendPluginLoreForSimulation(
  project: CanonicalProjectIr,
  contributions: readonly PluginContributions[],
): CanonicalProjectIr {
  if (contributions.length === 0) return project;
  const existingIds = new Set(project.entries.map((entry) => entry.id));
  const entries: CanonicalLoreEntry[] = [];
  for (const contribution of [...contributions].sort((left, right) =>
    left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0)) {
    for (const entry of contribution.lore_entries
      .slice()
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
      if (existingIds.has(entry.id)) throw new Error(`plugin lore entry ID collision: ${entry.id}`);
      existingIds.add(entry.id);
      entries.push(toCanonicalPluginEntry(contribution.plugin_id, entry, entries.length));
    }
  }
  if (entries.length === 0) return project;
  return canonicalProjectIrSchema.parse({ ...project, entries: [...project.entries, ...entries] });
}
