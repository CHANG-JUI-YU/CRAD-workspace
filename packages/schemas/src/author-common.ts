import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const provenanceKindSchema = z.enum(["user", "fact", "creator", "conversion", "import"]);

const factProvenanceRefSchema = z
  .object({
    kind: z.literal("fact"),
    ref: stableIdSchema,
    requires_single_value: z.boolean().default(false),
    note: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

const otherProvenanceRefSchema = z
  .object({
    kind: z.enum(["user", "creator", "conversion", "import"]),
    ref: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const provenanceRefSchema = z.discriminatedUnion("kind", [
  factProvenanceRefSchema,
  otherProvenanceRefSchema,
]);

export const authorActivationOverrideSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("default") }).strict(),
  z.object({ type: z.literal("constant") }).strict(),
  z
    .object({
      type: z.literal("keyed"),
      keys: z.array(z.string().min(1)).min(1),
      secondary_keys: z.array(z.string().min(1)).default([]),
      secondary_logic: z.enum(["any", "all", "not_any", "not_all"]).default("any"),
      use_regex: z.boolean().default(false),
      case_sensitive: z.boolean().default(false),
      match_whole_words: z.boolean().default(false),
      scan_depth: z.number().int().positive().optional(),
      group: stableIdSchema.optional(),
      triggers: z
        .array(z.enum(["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"]))
        .default([]),
    })
    .strict(),
  z.object({ type: z.literal("disabled") }).strict(),
]);

export const authorPlacementOverrideSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("default") }).strict(),
  z.object({ type: z.enum(["before_character", "after_character", "before_examples", "after_examples"]) }).strict(),
  z.object({ type: z.literal("authors_note"), side: z.enum(["before", "after"]) }).strict(),
  z
    .object({
      type: z.literal("at_depth"),
      depth: z.number().int().nonnegative(),
      role: z.enum(["system", "user", "assistant"]).default("system"),
    })
    .strict(),
  z.object({ type: z.literal("outlet"), name: z.string().min(1) }).strict(),
]);

export const authorRecursionOverrideSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("default") }).strict(),
  z.object({ type: z.literal("isolated") }).strict(),
  z
    .object({
      type: z.literal("chain"),
      incoming: z.boolean().default(true),
      outgoing: z.boolean().default(true),
      delay_until_recursion: z.number().int().nonnegative().optional(),
      max_depth: z.number().int().positive().max(32).default(4),
      depends_on: z.array(stableIdSchema).default([]),
    })
    .strict(),
]);

export const compileOverrideSchema = z
  .object({
    category: stableIdSchema.optional(),
    activation: authorActivationOverrideSchema.default({ type: "default" }),
    placement: authorPlacementOverrideSchema.default({ type: "default" }),
    recursion: authorRecursionOverrideSchema.default({ type: "default" }),
    priority: z.number().finite().default(0),
    token_budget: z.number().int().positive().optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const defaultCompileOverride = {
  activation: { type: "default" as const },
  placement: { type: "default" as const },
  recursion: { type: "default" as const },
  priority: 0,
  extensions: {},
};

export const authorSectionSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().min(1),
    content: z.string().min(1),
    compile: compileOverrideSchema.default(defaultCompileOverride),
    provenance: z.array(provenanceRefSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const authorDocumentBodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  sections: z.array(authorSectionSchema).default([]),
  compile: compileOverrideSchema.default(defaultCompileOverride),
  provenance: z.array(provenanceRefSchema).default([]),
  extensions: jsonObjectSchema.default({}),
});

export type ProvenanceRef = z.infer<typeof provenanceRefSchema>;
export type CompileOverride = z.infer<typeof compileOverrideSchema>;
export type AuthorSection = z.infer<typeof authorSectionSchema>;
