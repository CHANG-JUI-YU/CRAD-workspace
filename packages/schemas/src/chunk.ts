import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const offsetRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([start, end]) => end >= start, "range end 不得小於 start");

export const lineRangeSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([start, end]) => end >= start, "line range end 不得小於 start");

export const chunkProfileSchema = z
  .object({
    id: stableIdSchema,
    strategy: stableIdSchema,
    version: z.string().min(1),
    tokenizer_id: stableIdSchema,
    tokenizer_version: z.string().min(1),
    target_tokens: z.number().int().min(5_000).max(10_000),
    overlap_tokens: z.number().int().positive(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.overlap_tokens > profile.target_tokens * 0.25) {
      context.addIssue({
        code: "custom",
        message: "overlap 不得超過 target 的 25%",
        path: ["overlap_tokens"],
      });
    }
  });

export const chunkSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    chunk_set_id: stableIdSchema,
    sequence: z.number().int().nonnegative(),
    chapter_path: z.array(z.string().min(1)).default([]),
    normalized_character_range: offsetRangeSchema,
    normalized_line_range: lineRangeSchema,
    raw_byte_range: offsetRangeSchema.optional(),
    main_range: offsetRangeSchema,
    leading_overlap_range: offsetRangeSchema.optional(),
    trailing_overlap_range: offsetRangeSchema.optional(),
    token_count: z.number().int().positive(),
    content_hash: revisionSchema,
    content: z.string(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((chunk, context) => {
    const [start, end] = chunk.normalized_character_range;
    const ranges = [
      ["main_range", chunk.main_range],
      ["leading_overlap_range", chunk.leading_overlap_range],
      ["trailing_overlap_range", chunk.trailing_overlap_range],
    ] as const;
    for (const [name, range] of ranges) {
      if (range && (range[0] < start || range[1] > end)) {
        context.addIssue({ code: "custom", message: `${name} 必須位於 chunk range 內`, path: [name] });
      }
    }
    if (chunk.leading_overlap_range && chunk.leading_overlap_range[1] > chunk.main_range[0]) {
      context.addIssue({ code: "custom", message: "leading overlap 不得進入 main range", path: ["leading_overlap_range"] });
    }
    if (chunk.trailing_overlap_range && chunk.trailing_overlap_range[0] < chunk.main_range[1]) {
      context.addIssue({ code: "custom", message: "trailing overlap 不得進入 main range", path: ["trailing_overlap_range"] });
    }
  });

export const chunkSetManifestSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    normalized_hash: revisionSchema,
    profile: chunkProfileSchema,
    chunk_ids: z.array(stableIdSchema),
    chunk_count: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.chunk_count !== manifest.chunk_ids.length) {
      context.addIssue({ code: "custom", message: "chunk_count 必須等於 chunk_ids 長度", path: ["chunk_count"] });
    }
    if (new Set(manifest.chunk_ids).size !== manifest.chunk_ids.length) {
      context.addIssue({ code: "custom", message: "chunk_ids 不得重複", path: ["chunk_ids"] });
    }
  });

export type ChunkProfile = z.infer<typeof chunkProfileSchema>;
export type Chunk = z.output<typeof chunkSchema>;
export type ChunkSetManifest = z.output<typeof chunkSetManifestSchema>;
