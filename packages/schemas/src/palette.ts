import { z } from "zod";

import { authorDocumentBodySchema } from "./author-common.js";

export const paletteModuleKindSchema = z.enum([
  "basic_information",
  "personality_palette",
  "tri_faceted",
  "secondary_interpretation",
]);

export const paletteModuleSchema = authorDocumentBodySchema
  .extend({
    schema_version: z.literal(1),
    mode: z.literal("palette"),
    module: paletteModuleKindSchema,
  })
  .strict();

export const requiredPaletteModules = paletteModuleKindSchema.options;

export type PaletteModule = z.infer<typeof paletteModuleSchema>;
export type PaletteModuleKind = z.infer<typeof paletteModuleKindSchema>;
