import {
  characterCardV3Schema,
  lorebookV3Schema,
  type CanonicalLoreEntry,
  type CanonicalPlacement,
  type CanonicalProjectIr,
  type Ccv3LoreEntry,
  type Ccv3Lorebook,
  type CharacterCardV3,
  type JsonObject,
  type PluginContributions,
  type LorebookV3,
} from "@card-workspace/schemas";

import { deepMergeJson } from "./merge.js";
import { applyPluginContributionsToCharacterCard, applyPluginGreetingOperations } from "./plugin-contributions.js";
import { renderLoreEntry } from "./render.js";

function placementExtension(placement: CanonicalPlacement): JsonObject {
  switch (placement.type) {
    case "before_character":
      return { position: 0 };
    case "after_character":
      return { position: 1 };
    case "authors_note":
      return { position: placement.side === "before" ? 2 : 3 };
    case "at_depth":
      return { position: 4, depth: placement.depth, role: { system: 0, user: 1, assistant: 2 }[placement.role] };
    case "before_examples":
      return { position: 5 };
    case "after_examples":
      return { position: 6 };
    case "outlet":
      return { position: 7, outlet_name: placement.name };
  }
}

function fallbackPosition(placement: CanonicalPlacement): "before_char" | "after_char" {
  return placement.type === "before_character" ? "before_char" : "after_char";
}

function entryExtensions(entry: CanonicalLoreEntry): JsonObject {
  const recursion: JsonObject = {
    exclude_recursion: !entry.recursion.incoming,
    prevent_recursion: !entry.recursion.outgoing,
  };
  if (entry.recursion.delay_until_recursion !== undefined) {
    recursion.delay_until_recursion = entry.recursion.delay_until_recursion;
  }
  const activation: JsonObject = {};
  if (entry.activation.type === "keyed") {
    activation.selectiveLogic = { any: 0, not_all: 1, not_any: 2, all: 3 }[entry.activation.secondary_logic];
    activation.match_whole_words = entry.activation.match_whole_words;
    activation.case_sensitive = entry.activation.case_sensitive;
    activation.triggers = entry.activation.triggers;
    if (entry.activation.scan_depth !== undefined) activation.scan_depth = entry.activation.scan_depth;
    if (entry.activation.group !== undefined) activation.group = entry.activation.group;
  } else if (entry.activation.type === "conditional") {
    activation["card-workspace/conditional"] = {
      plugin: entry.activation.plugin,
      expression: entry.activation.expression,
    };
  }
  return deepMergeJson(entry.extensions, {
    ...placementExtension(entry.placement),
    ...recursion,
    ...activation,
  });
}

function emitLoreEntry(entry: CanonicalLoreEntry): Ccv3LoreEntry {
  const keyed = entry.activation.type === "keyed" ? entry.activation : undefined;
  return deepMergeJson(entry.passthrough, {
    id: entry.id,
    name: entry.title,
    comment: entry.title,
    keys: keyed?.keys ?? [],
    secondary_keys: keyed?.secondary_keys ?? [],
    content: entry.content_format === "raw" ? entry.fragments.map((fragment) => fragment.content).join("\n") : renderLoreEntry(entry),
    extensions: entryExtensions(entry),
    enabled: entry.activation.type !== "disabled",
    insertion_order: entry.insertion_order,
    use_regex: keyed?.use_regex ?? false,
    constant: entry.activation.type === "constant",
    selective: (keyed?.secondary_keys.length ?? 0) > 0,
    position: fallbackPosition(entry.placement),
    priority: entry.priority,
  }) as Ccv3LoreEntry;
}

function emitLorebookData(project: CanonicalProjectIr, name: string, standalone: boolean): Ccv3Lorebook {
  const passthroughExtensions = project.passthrough.character_book.extensions;
  const extensions = standalone
    ? deepMergeJson(project.extensions, {
        "card-workspace": { project_id: project.project_id, schema_version: project.schema_version },
      })
    : passthroughExtensions && typeof passthroughExtensions === "object" && !Array.isArray(passthroughExtensions)
      ? passthroughExtensions
      : {};
  return deepMergeJson(project.passthrough.character_book, {
    name,
    description: "由 Canonical IR 編譯的角色與世界設定。",
    extensions,
    entries: project.entries.map(emitLoreEntry),
  } as unknown as JsonObject) as Ccv3Lorebook;
}

export function emitLorebookV3(project: CanonicalProjectIr): LorebookV3 {
  if (project.project_kind !== "worldbook") throw new Error("只有 worldbook Canonical IR 可輸出 standalone lorebook");
  return lorebookV3Schema.parse({
    spec: "lorebook_v3",
    data: emitLorebookData(project, project.card.name, true),
  });
}

export function emitCharacterCardV3(
  project: CanonicalProjectIr,
  options: { pluginContributions?: readonly PluginContributions[] } = {},
): CharacterCardV3 {
  if (project.project_kind !== "character_card") throw new Error("worldbook Canonical IR 不可輸出角色卡");
  const primary = project.greetings.find((greeting) => greeting.kind === "primary");
  if (!primary) throw new Error("Canonical IR 缺少 primary greeting");
  const dataExtensions = deepMergeJson(project.extensions, {
    "card-workspace": { project_id: project.project_id, schema_version: project.schema_version },
  });
  const characterBook = emitLorebookData(project, `${project.card.name} Worldbook`, false);
  const data = deepMergeJson(project.passthrough.data, {
    name: project.card.name,
    description: "",
    personality: "",
    scenario: "",
    first_mes: applyPluginGreetingOperations(primary, options.pluginContributions),
    mes_example: "",
    creator_notes: `由 Card Workspace 專案 ${project.title} 編譯。`,
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: project.greetings
      .filter((greeting) => greeting.kind === "alternate")
      .map((greeting) => applyPluginGreetingOperations(greeting, options.pluginContributions)),
    group_only_greetings: project.greetings
      .filter((greeting) => greeting.kind === "group_only")
      .map((greeting) => applyPluginGreetingOperations(greeting, options.pluginContributions)),
    tags: [],
    creator: "Card Workspace",
    character_version: "1.0",
    extensions: dataExtensions,
    character_book: characterBook as unknown as JsonObject,
  });
  const card = characterCardV3Schema.parse(deepMergeJson(project.passthrough.root, {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data,
  }));
  return characterCardV3Schema.parse(applyPluginContributionsToCharacterCard(card, options.pluginContributions));
}
