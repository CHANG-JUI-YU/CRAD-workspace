import { z } from "zod";

import { jsonObjectSchema } from "./json.js";

export const ccv3AssetSchema = z
  .object({
    type: z.string(),
    uri: z.string(),
    name: z.string(),
    ext: z.string().regex(/^[a-z0-9]+$/u),
  })
  .passthrough();

export const ccv3LoreEntrySchema = z
  .object({
    keys: z.array(z.string()),
    content: z.string(),
    extensions: jsonObjectSchema,
    enabled: z.boolean(),
    insertion_order: z.number(),
    use_regex: z.boolean(),
    case_sensitive: z.boolean().optional(),
    constant: z.boolean().optional(),
    name: z.string().optional(),
    priority: z.number().optional(),
    id: z.union([z.string(), z.number()]).optional(),
    comment: z.string().optional(),
    selective: z.boolean().optional(),
    secondary_keys: z.array(z.string()).optional(),
    position: z.enum(["before_char", "after_char"]).optional(),
  })
  .passthrough();

export const ccv3LorebookSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    scan_depth: z.number().optional(),
    token_budget: z.number().optional(),
    recursive_scanning: z.boolean().optional(),
    extensions: jsonObjectSchema,
    entries: z.array(ccv3LoreEntrySchema),
  })
  .passthrough();

export const lorebookV3Schema = z
  .object({
    spec: z.literal("lorebook_v3"),
    data: ccv3LorebookSchema,
  })
  .passthrough();

export const ccv3DataSchema = z
  .object({
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
    extensions: jsonObjectSchema,
    character_book: ccv3LorebookSchema.optional(),
    assets: z.array(ccv3AssetSchema).optional(),
    nickname: z.string().optional(),
    creator_notes_multilingual: z.record(z.string(), z.string()).optional(),
    source: z.array(z.string()).optional(),
    creation_date: z.number().int().optional(),
    modification_date: z.number().int().optional(),
  })
  .passthrough();

export const characterCardV3Schema = z
  .object({
    spec: z.literal("chara_card_v3"),
    spec_version: z.literal("3.0"),
    data: ccv3DataSchema,
  })
  .passthrough();

export type Ccv3LoreEntry = z.infer<typeof ccv3LoreEntrySchema>;
export type Ccv3Lorebook = z.infer<typeof ccv3LorebookSchema>;
export type LorebookV3 = z.infer<typeof lorebookV3Schema>;
export type CharacterCardV3 = z.infer<typeof characterCardV3Schema>;
