import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const provenanceNodeKindSchema = z.enum([
  "fragment",
  "fact",
  "evidence",
  "chunk",
  "source_revision",
  "snapshot",
]);

export const provenanceNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: provenanceNodeKindSchema,
    revision: revisionSchema.optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const provenanceEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const provenanceIndexSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    revision: revisionSchema,
    nodes: z.array(provenanceNodeSchema),
    edges: z.array(provenanceEdgeSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const provenanceTraceSchema = z
  .object({
    schema_version: z.literal(1),
    query_id: z.string().min(1),
    nodes: z.array(provenanceNodeSchema),
    edges: z.array(provenanceEdgeSchema),
    complete: z.boolean(),
    diagnostics: z.array(stableIdSchema).default([]),
  })
  .strict();

export type ProvenanceNode = z.output<typeof provenanceNodeSchema>;
export type ProvenanceEdge = z.infer<typeof provenanceEdgeSchema>;
export type ProvenanceIndex = z.output<typeof provenanceIndexSchema>;
export type ProvenanceTrace = z.output<typeof provenanceTraceSchema>;
