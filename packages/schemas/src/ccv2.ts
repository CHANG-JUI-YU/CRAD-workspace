import { z } from "zod";

import { ccv3LorebookSchema, ccv3LoreEntrySchema } from "./ccv3.js";
import { jsonObjectSchema } from "./json.js";

export const ccv2LoreEntrySchema = ccv3LoreEntrySchema.omit({ use_regex: true }).passthrough();
export const ccv2LorebookSchema = ccv3LorebookSchema
  .omit({ entries: true })
  .extend({ entries: z.array(ccv2LoreEntrySchema) })
  .passthrough();

export const ccv2DataSchema = z
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
    tags: z.array(z.string()),
    creator: z.string(),
    character_version: z.string(),
    extensions: jsonObjectSchema,
    character_book: ccv2LorebookSchema.optional(),
  })
  .passthrough();

export const characterCardV2Schema = z
  .object({
    spec: z.literal("chara_card_v2"),
    spec_version: z.literal("2.0"),
    data: ccv2DataSchema,
  })
  .passthrough();

export type CharacterCardV2 = z.infer<typeof characterCardV2Schema>;
