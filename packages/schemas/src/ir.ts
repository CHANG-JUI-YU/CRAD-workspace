import { z } from "zod";

import { compileOverrideSchema, provenanceRefSchema } from "./author-common.js";
import { authoringModeSchema, characterRoleSchema, projectKindSchema } from "./project.js";
import { greetingKindSchema } from "./greetings.js";
import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const contentFragmentSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().min(1),
    content: z.string().min(1),
    provenance: z.array(provenanceRefSchema),
    extensions: jsonObjectSchema,
  })
  .strict();

export const canonicalActivationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant") }).strict(),
  z
    .object({
      type: z.literal("keyed"),
      keys: z.array(z.string().min(1)).min(1),
      secondary_keys: z.array(z.string().min(1)),
      secondary_logic: z.enum(["any", "all", "not_any", "not_all"]),
      use_regex: z.boolean(),
      case_sensitive: z.boolean(),
      match_whole_words: z.boolean(),
      scan_depth: z.number().int().positive().optional(),
      group: stableIdSchema.optional(),
      triggers: z.array(z.enum(["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"])),
    })
    .strict(),
  z.object({ type: z.literal("conditional"), plugin: stableIdSchema, expression: z.string().min(1) }).strict(),
  z.object({ type: z.literal("disabled") }).strict(),
]);

export const canonicalPlacementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["before_character", "after_character", "before_examples", "after_examples"]) }).strict(),
  z.object({ type: z.literal("authors_note"), side: z.enum(["before", "after"]) }).strict(),
  z
    .object({
      type: z.literal("at_depth"),
      depth: z.number().int().nonnegative(),
      role: z.enum(["system", "user", "assistant"]),
    })
    .strict(),
  z.object({ type: z.literal("outlet"), name: z.string().min(1) }).strict(),
]);

export const canonicalRecursionSchema = z
  .object({
    incoming: z.boolean(),
    outgoing: z.boolean(),
    delay_until_recursion: z.number().int().nonnegative().optional(),
    max_depth: z.number().int().positive().max(32),
    depends_on: z.array(stableIdSchema),
  })
  .strict();

export const runtimeRouteSchema = z
  .object({
    audience: z.enum(["both", "narrative", "update", "plugin"]),
    plugin: stableIdSchema.optional(),
  })
  .strict();

export const canonicalCharacterSchema = z
  .object({
    id: stableIdSchema,
    display_name: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    summary: z.string().min(1),
    mode: z.union([authoringModeSchema, z.literal("imported")]),
    role: characterRoleSchema,
    extensions: jsonObjectSchema,
  })
  .strict();

export const canonicalGreetingSchema = z
  .object({
    id: stableIdSchema,
    kind: greetingKindSchema,
    content: z.string().min(1),
    character_ids: z.array(stableIdSchema).min(1),
    provenance: z.array(provenanceRefSchema),
    extensions: jsonObjectSchema,
    passthrough: jsonObjectSchema.default({}),
  })
  .strict();

export const normalizedLoreNodeSchema = z
  .object({
    id: stableIdSchema,
    owner_id: stableIdSchema.optional(),
    category: stableIdSchema,
    title: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    fragments: z.array(contentFragmentSchema).min(1),
    content_format: z.enum(["workspace_xml", "raw"]).default("workspace_xml"),
    compile: compileOverrideSchema,
    provenance: z.array(provenanceRefSchema),
    extensions: jsonObjectSchema,
    passthrough: jsonObjectSchema.default({}),
  })
  .strict();

const normalizedProjectIrBaseSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    project_kind: projectKindSchema.default("character_card"),
    title: z.string().min(1),
    card: z
      .object({
        name: z.string().min(1),
        profile: z.literal("minimal_worldbook"),
        avatar: z.string().min(1),
      })
      .strict(),
    characters: z.array(canonicalCharacterSchema),
    greetings: z.array(canonicalGreetingSchema),
    nodes: z.array(normalizedLoreNodeSchema),
    extensions: jsonObjectSchema,
    passthrough: z
      .object({
        source_envelope: jsonObjectSchema.default({}),
        root: jsonObjectSchema.default({}),
        data: jsonObjectSchema.default({}),
        character_book: jsonObjectSchema.default({}),
      })
      .strict()
      .default({ source_envelope: {}, root: {}, data: {}, character_book: {} }),
  })
  .strict();

function validateProjectShape(
  project: { project_kind: "character_card" | "worldbook"; characters: unknown[]; greetings: Array<{ kind: string }> },
  context: z.RefinementCtx,
): void {
    if (project.project_kind === "character_card" && project.characters.length === 0) {
      context.addIssue({ code: "custom", message: "角色卡 IR 至少需要一個角色", path: ["characters"] });
    }
    if (project.project_kind === "character_card" && !project.greetings.some((item) => item.kind === "primary")) {
      context.addIssue({ code: "custom", message: "角色卡 IR 需要 primary greeting", path: ["greetings"] });
    }
    if (project.project_kind === "worldbook" && (project.characters.length !== 0 || project.greetings.length !== 0)) {
      context.addIssue({ code: "custom", message: "世界書 IR 不可包含角色或 greetings" });
    }
}

export const normalizedProjectIrSchema = normalizedProjectIrBaseSchema.superRefine(validateProjectShape);

export const planningDecisionSchema = z
  .object({
    field: z.enum(["activation", "placement", "recursion", "insertion_order"]),
    source: z.enum(["author_override", "category_default", "stable_order"]),
    explanation: z.string().min(1),
  })
  .strict();

export const canonicalLoreEntrySchema = z
  .object({
    id: stableIdSchema,
    owner_id: stableIdSchema.optional(),
    category: stableIdSchema,
    title: z.string().min(1),
    fragments: z.array(contentFragmentSchema).min(1),
    content_format: z.enum(["workspace_xml", "raw"]).default("workspace_xml"),
    activation: canonicalActivationSchema,
    placement: canonicalPlacementSchema,
    recursion: canonicalRecursionSchema,
    route: runtimeRouteSchema.optional(),
    insertion_order: z.number().int(),
    priority: z.number().finite(),
    token_budget: z.number().int().positive().optional(),
    provenance: z.array(provenanceRefSchema),
    extensions: jsonObjectSchema,
    passthrough: jsonObjectSchema.default({}),
    decisions: z.array(planningDecisionSchema),
  })
  .strict();

export const canonicalProjectIrSchema = normalizedProjectIrBaseSchema
  .omit({ nodes: true })
  .extend({ entries: z.array(canonicalLoreEntrySchema) })
  .strict()
  .superRefine(validateProjectShape);

export type ContentFragment = z.infer<typeof contentFragmentSchema>;
export type CanonicalActivation = z.infer<typeof canonicalActivationSchema>;
export type CanonicalPlacement = z.infer<typeof canonicalPlacementSchema>;
export type CanonicalRecursion = z.infer<typeof canonicalRecursionSchema>;
export type NormalizedLoreNode = z.infer<typeof normalizedLoreNodeSchema>;
export type NormalizedProjectIr = z.infer<typeof normalizedProjectIrSchema>;
export type CanonicalLoreEntry = z.infer<typeof canonicalLoreEntrySchema>;
export type CanonicalProjectIr = z.infer<typeof canonicalProjectIrSchema>;
