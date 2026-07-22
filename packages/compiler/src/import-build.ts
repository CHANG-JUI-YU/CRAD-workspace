import {
  canonicalProjectIrSchema,
  jsonObjectSchema,
  stableIdSchema,
  type CanonicalActivation,
  type CanonicalPlacement,
  type CanonicalProjectIr,
  type Ccv3LoreEntry,
  type ImportedCardEnvelope,
  type JsonObject,
} from "@card-workspace/schemas";

const dataKnown = new Set([
  "name", "description", "personality", "scenario", "first_mes", "mes_example", "creator_notes",
  "system_prompt", "post_history_instructions", "alternate_greetings", "group_only_greetings", "tags",
  "creator", "character_version", "extensions", "character_book", "assets", "nickname",
  "creator_notes_multilingual", "source", "creation_date", "modification_date",
]);
const bookKnown = new Set(["name", "description", "scan_depth", "token_budget", "recursive_scanning", "extensions", "entries"]);
const entryKnown = new Set([
  "keys", "content", "extensions", "enabled", "insertion_order", "use_regex", "case_sensitive", "constant",
  "name", "priority", "id", "comment", "selective", "secondary_keys", "position",
]);

function omitKnown(value: Record<string, unknown>, known: Set<string>): JsonObject {
  return jsonObjectSchema.parse(Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key))));
}

function entryId(entry: Ccv3LoreEntry, index: number): string {
  const candidate = typeof entry.id === "string" ? entry.id : "";
  return stableIdSchema.safeParse(candidate).success ? candidate : `import-entry-${String(index + 1).padStart(4, "0")}`;
}

function activation(entry: Ccv3LoreEntry): CanonicalActivation {
  if (!entry.enabled) return { type: "disabled" };
  if (entry.constant) return { type: "constant" };
  const extension = entry.extensions;
  const logic = { 0: "any", 1: "not_all", 2: "not_any", 3: "all" } as const;
  const rawLogic = typeof extension.selectiveLogic === "number" ? extension.selectiveLogic : 0;
  const triggers = Array.isArray(extension.triggers)
    ? extension.triggers.filter((item): item is "normal" | "continue" | "impersonate" | "swipe" | "regenerate" | "quiet" =>
        typeof item === "string" && ["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"].includes(item))
    : [];
  return {
    type: "keyed",
    keys: entry.keys.length > 0 ? entry.keys : [entry.name ?? String(entry.id ?? "imported")],
    secondary_keys: entry.secondary_keys ?? [],
    secondary_logic: logic[rawLogic as keyof typeof logic] ?? "any",
    use_regex: entry.use_regex,
    case_sensitive: entry.case_sensitive ?? extension.case_sensitive === true,
    match_whole_words: extension.match_whole_words === true,
    ...(typeof extension.scan_depth === "number" && extension.scan_depth > 0 ? { scan_depth: extension.scan_depth } : {}),
    ...(typeof extension.group === "string" && stableIdSchema.safeParse(extension.group).success ? { group: extension.group } : {}),
    triggers,
  };
}

function placement(entry: Ccv3LoreEntry): CanonicalPlacement {
  const position = entry.extensions.position;
  if (position === 0) return { type: "before_character" };
  if (position === 2 || position === 3) return { type: "authors_note", side: position === 2 ? "before" : "after" };
  if (position === 4) {
    const role = { 0: "system", 1: "user", 2: "assistant" } as const;
    const roleValue = typeof entry.extensions.role === "number" ? entry.extensions.role : 0;
    return {
      type: "at_depth",
      depth: typeof entry.extensions.depth === "number" && entry.extensions.depth >= 0 ? entry.extensions.depth : 4,
      role: role[roleValue as keyof typeof role] ?? "system",
    };
  }
  if (position === 5) return { type: "before_examples" };
  if (position === 6) return { type: "after_examples" };
  if (position === 7 && typeof entry.extensions.outlet_name === "string") {
    return { type: "outlet", name: entry.extensions.outlet_name };
  }
  return entry.position === "before_char" ? { type: "before_character" } : { type: "after_character" };
}

export function importedCardToCanonicalIr(envelope: ImportedCardEnvelope): CanonicalProjectIr {
  const card = envelope.card;
  const projectId = `import-${envelope.raw_revision.slice(7, 19)}`;
  const provenance = [{ kind: "import" as const, ref: envelope.raw_revision, extensions: {} }];
  const book = card.data.character_book;
  const rootPassthrough = omitKnown(card as Record<string, unknown>, new Set(["spec", "spec_version", "data"]));
  const dataPassthrough = omitKnown(card.data as Record<string, unknown>, dataKnown);
  const bookPassthrough = book
    ? { ...omitKnown(book as Record<string, unknown>, bookKnown), extensions: book.extensions }
    : {};
  return canonicalProjectIrSchema.parse({
    schema_version: 1,
    project_id: projectId,
    title: `Imported ${card.data.name}`,
    card: { name: card.data.name, profile: "minimal_worldbook" },
    characters: [{
      id: "imported-character",
      display_name: card.data.name,
      aliases: [],
      summary: card.data.description || "Imported character",
      mode: "imported",
      role: "primary",
      extensions: {},
    }],
    greetings: [
      { id: "primary", kind: "primary", content: card.data.first_mes || "[空白開場白]", character_ids: ["imported-character"], provenance, extensions: {} },
      ...card.data.alternate_greetings.map((content, index) => ({ id: `alternate-${index + 1}`, kind: "alternate" as const, content, character_ids: ["imported-character"], provenance, extensions: {} })),
      ...card.data.group_only_greetings.map((content, index) => ({ id: `group-${index + 1}`, kind: "group_only" as const, content, character_ids: ["imported-character"], provenance, extensions: {} })),
    ],
    entries: (book?.entries ?? []).map((entry, index) => ({
      id: entryId(entry, index),
      owner_id: "imported-character",
      category: "imported_lore",
      title: entry.name ?? entry.comment ?? `Imported Entry ${index + 1}`,
      fragments: [{ id: `import-fragment-${index + 1}`, title: entry.name ?? "Imported Lore", content: entry.content, provenance, extensions: {} }],
      content_format: "raw",
      activation: activation(entry),
      placement: placement(entry),
      recursion: {
        incoming: entry.extensions.exclude_recursion !== true,
        outgoing: entry.extensions.prevent_recursion !== true,
        ...(typeof entry.extensions.delay_until_recursion === "number" ? { delay_until_recursion: entry.extensions.delay_until_recursion } : {}),
        max_depth: 4,
        depends_on: [],
      },
      insertion_order: entry.insertion_order,
      priority: entry.priority ?? 0,
      provenance,
      extensions: entry.extensions,
      passthrough: omitKnown(entry as Record<string, unknown>, entryKnown),
      decisions: [],
    })),
    extensions: card.data.extensions,
    passthrough: {
      source_envelope: envelope.passthrough,
      root: rootPassthrough,
      data: dataPassthrough,
      character_book: bookPassthrough,
    },
  });
}
