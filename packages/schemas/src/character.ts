import { z } from "zod";

import { authorSectionSchema, provenanceRefSchema } from "./author-common.js";
import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const characterRelationshipSchema = z
  .object({
    target_id: stableIdSchema,
    summary: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    provenance: z.array(provenanceRefSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const characterDocumentSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    display_name: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    relationships: z.array(characterRelationshipSchema).default([]),
    sections: z.array(authorSectionSchema).default([]),
    provenance: z.array(provenanceRefSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((character, context) => {
    const targets = new Set<string>();
    character.relationships.forEach((relationship, index) => {
      if (targets.has(relationship.target_id)) {
        context.addIssue({
          code: "custom",
          message: `關係目標重複：${relationship.target_id}`,
          path: ["relationships", index, "target_id"],
        });
      }
      targets.add(relationship.target_id);
    });
  });

export type CharacterDocument = z.infer<typeof characterDocumentSchema>;
