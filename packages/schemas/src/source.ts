import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const sourceTierSchema = z.enum([
  "official",
  "common_fanon",
  "single_author_fanon",
  "user_original",
  "unknown",
]);

export const sourceOriginSchema = z
  .object({
    kind: z.enum(["local", "retrieved"]),
    uri: z.string().min(1),
    requested_url: z.url().optional(),
    canonical_url: z.url().optional(),
    fetched_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((origin, context) => {
    if (origin.kind === "retrieved") {
      for (const key of ["requested_url", "canonical_url", "fetched_at"] as const) {
        if (origin[key] === undefined) {
          context.addIssue({ code: "custom", message: `retrieved source 需要 ${key}`, path: [key] });
        }
      }
    }
  });

export const snapshotDescriptorSchema = z
  .object({
    path: z.string().min(1),
    byte_size: z.number().int().nonnegative(),
    raw_hash: revisionSchema,
  })
  .strict();

export const sourceRevisionSchema = z
  .object({
    schema_version: z.literal(1),
    source_id: stableIdSchema,
    id: revisionSchema,
    media_type: z.string().min(1),
    original_extension: z.string().regex(/^\.[a-z0-9]+$/).optional(),
    raw_hash: revisionSchema,
    normalized_hash: revisionSchema,
    projection_hash: revisionSchema.optional(),
    title: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    acquired_at: z.string().datetime({ offset: true }),
    tier: sourceTierSchema,
    origin: sourceOriginSchema,
    snapshot: snapshotDescriptorSchema,
    adapter_id: stableIdSchema,
    adapter_version: z.string().min(1),
    normalizer_id: stableIdSchema,
    normalizer_version: z.string().min(1),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((revision, context) => {
    if (revision.id !== revision.raw_hash) {
      context.addIssue({
        code: "custom",
        message: "source revision ID 必須等於 raw bytes SHA-256",
        path: ["id"],
      });
    }
    if (revision.snapshot.raw_hash !== revision.raw_hash) {
      context.addIssue({
        code: "custom",
        message: "snapshot raw hash 必須與 source revision 一致",
        path: ["snapshot", "raw_hash"],
      });
    }
  });

export const sourceRecordSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().min(1),
    tier: sourceTierSchema,
    current_revision_id: revisionSchema.optional(),
    current_chunk_set: z
      .object({
        source_revision_id: revisionSchema,
        chunk_set_id: stableIdSchema,
      })
      .strict()
      .optional(),
    revision_ids: z.array(revisionSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((source, context) => {
    if (
      source.current_revision_id !== undefined &&
      !source.revision_ids.includes(source.current_revision_id)
    ) {
      context.addIssue({
        code: "custom",
        message: "current revision 必須存在於 revision_ids",
        path: ["current_revision_id"],
      });
    }
    if (
      source.current_chunk_set !== undefined &&
      !source.revision_ids.includes(source.current_chunk_set.source_revision_id)
    ) {
      context.addIssue({
        code: "custom",
        message: "current chunk set 的 source revision 必須存在於 revision_ids",
        path: ["current_chunk_set", "source_revision_id"],
      });
    }
  });

export const sourceManifestSchema = z
  .object({
    schema_version: z.literal(1),
    revision: revisionSchema,
    sources: z.array(sourceRecordSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const projectionRangeMappingSchema = z
  .object({
    evidence_kind: z.enum(["raw_snapshot", "field_projection"]).optional(),
    normalized_character_range: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    raw_byte_range: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
    normalized_line_range: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .optional(),
    field_path: z.array(z.union([z.string(), z.number().int().nonnegative()])).optional(),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (mapping.normalized_character_range[1] < mapping.normalized_character_range[0]) {
      context.addIssue({ code: "custom", message: "character range end 不得小於 start" });
    }
    if (mapping.raw_byte_range && mapping.raw_byte_range[1] < mapping.raw_byte_range[0]) {
      context.addIssue({ code: "custom", message: "raw byte range end 不得小於 start" });
    }
    if (mapping.evidence_kind === "field_projection" && mapping.raw_byte_range !== undefined) {
      context.addIssue({
        code: "custom",
        message: "field projection 不得宣稱 raw snapshot byte range",
        path: ["raw_byte_range"],
      });
    }
  });

export const textLineMapEntrySchema = z
  .object({
    normalized_line: z.number().int().positive(),
    normalized_character_range: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    source_character_range: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    source_byte_range: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    line_ending: z.enum(["none", "lf", "crlf", "cr"]),
    source_line_ending_character_range: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
    source_line_ending_byte_range: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    for (const [name, range] of [
      ["normalized_character_range", entry.normalized_character_range],
      ["source_character_range", entry.source_character_range],
      ["source_byte_range", entry.source_byte_range],
    ] as const) {
      if (range[1] < range[0]) {
        context.addIssue({ code: "custom", message: `${name} end 不得小於 start`, path: [name] });
      }
    }
    const hasEnding = entry.line_ending !== "none";
    if (hasEnding !== (entry.source_line_ending_character_range !== undefined)
      || hasEnding !== (entry.source_line_ending_byte_range !== undefined)) {
      context.addIssue({ code: "custom", message: "line ending range 必須與 line_ending 一致" });
    }
  });

export const textLineMapSchema = z
  .object({
    schema_version: z.literal(1),
    coordinate_space: z.enum(["raw_snapshot", "extracted_projection"]),
    source_byte_size: z.number().int().nonnegative(),
    source_character_count: z.number().int().nonnegative(),
    normalized_character_count: z.number().int().nonnegative(),
    removed_leading_bom: z.boolean(),
    lines: z.array(textLineMapEntrySchema).min(1),
  })
  .strict();

export const extractedTextProjectionSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    text: z.string(),
    normalized_hash: revisionSchema,
    adapter_id: stableIdSchema,
    adapter_version: z.string().min(1),
    normalizer_id: stableIdSchema,
    normalizer_version: z.string().min(1),
    line_map: textLineMapSchema.optional(),
    mappings: z.array(projectionRangeMappingSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type SourceTier = z.infer<typeof sourceTierSchema>;
export type SourceRevision = z.output<typeof sourceRevisionSchema>;
export type SourceRecord = z.output<typeof sourceRecordSchema>;
export type SourceManifest = z.output<typeof sourceManifestSchema>;
export type ExtractedTextProjection = z.output<typeof extractedTextProjectionSchema>;
export type TextLineMap = z.output<typeof textLineMapSchema>;
export type TextLineMapEntry = z.output<typeof textLineMapEntrySchema>;
