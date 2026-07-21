import { z } from "zod";

import { provenanceRefSchema } from "./author-common.js";
import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const greetingKindSchema = z.enum(["primary", "alternate", "group_only"]);

export const greetingSchema = z
  .object({
    id: stableIdSchema,
    kind: greetingKindSchema,
    content: z.string().min(1),
    character_ids: z.array(stableIdSchema).min(1),
    scene: z.string().min(1).optional(),
    perspective: z.string().min(1).optional(),
    player_freedom: z.string().min(1).optional(),
    provenance: z.array(provenanceRefSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const greetingsDocumentSchema = z
  .object({
    schema_version: z.literal(1),
    greetings: z.array(greetingSchema).min(1),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    let primaryCount = 0;
    document.greetings.forEach((greeting, index) => {
      if (greeting.kind === "primary") primaryCount += 1;
      if (ids.has(greeting.id)) {
        context.addIssue({
          code: "custom",
          message: `Greeting ID 重複：${greeting.id}`,
          path: ["greetings", index, "id"],
        });
      }
      ids.add(greeting.id);
    });
    if (primaryCount !== 1) {
      context.addIssue({
        code: "custom",
        message: `Greetings 必須恰有一個 primary，目前為 ${primaryCount}`,
        path: ["greetings"],
      });
    }
  });

export type GreetingKind = z.infer<typeof greetingKindSchema>;
export type Greeting = z.infer<typeof greetingSchema>;
export type GreetingsDocument = z.infer<typeof greetingsDocumentSchema>;
