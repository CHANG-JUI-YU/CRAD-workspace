import { z } from "zod";

import { authorDocumentBodySchema } from "./author-common.js";
import { stableIdSchema } from "./ids.js";

export const worldCategorySchema = z.enum([
  "people",
  "geography",
  "organizations",
  "history",
  "concepts",
  "systems",
  "items",
  "events",
]);

export const worldEntrySchema = authorDocumentBodySchema
  .extend({
    schema_version: z.literal(1),
    id: stableIdSchema,
    category: worldCategorySchema,
    aliases: z.array(z.string().min(1)).default([]),
    related_ids: z.array(stableIdSchema).default([]),
  })
  .strict();

export type WorldCategory = z.infer<typeof worldCategorySchema>;
export type WorldEntry = z.infer<typeof worldEntrySchema>;
