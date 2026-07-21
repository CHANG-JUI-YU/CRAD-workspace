import { z } from "zod";

import { characterCardV3Schema } from "./ccv3.js";
import { auditReportSchema } from "./audit.js";
import { diagnosticSchema } from "./diagnostic.js";
import { revisionSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const importLossSchema = z
  .object({
    path: z.string(),
    reason: z.string(),
  })
  .strict();

export const importedCardEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    source_format: z.enum(["v1", "v2", "v3"]),
    source_version: z.string(),
    raw_revision: revisionSchema,
    card: characterCardV3Schema,
    passthrough: jsonObjectSchema,
    diagnostics: z.array(diagnosticSchema),
    losses: z.array(importLossSchema),
  })
  .strict();

export const roundTripDifferenceSchema = z
  .object({
    path: z.string(),
    classification: z.enum(["expected_loss", "unexpected_loss"]),
    reason: z.string().min(1),
  })
  .strict();

export const roundTripReportSchema = z
  .object({
    schema_version: z.literal(1),
    status: z.enum(["equivalent", "expected_loss", "unexpected_loss"]),
    differences: z.array(roundTripDifferenceSchema),
  })
  .strict();

export const cardInspectionReportSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.literal("card-inspection"),
    source: z.object({
      source_id: z.string().min(1),
      revision: revisionSchema,
      snapshot_revision: revisionSchema,
      original_name: z.string().min(1),
      media_type: z.enum(["image/png", "application/json", "application/yaml"]),
      byte_size: z.number().int().nonnegative(),
    }).strict(),
    envelope: importedCardEnvelopeSchema,
    canonical_passthrough: jsonObjectSchema,
    audit: auditReportSchema,
    roundtrip: roundTripReportSchema,
    supported_dispositions: z.tuple([
      z.literal("retain_report"),
      z.literal("corrected_copy"),
      z.literal("full_rebuild"),
      z.literal("cancel"),
    ]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type ImportLoss = z.infer<typeof importLossSchema>;
export type ImportedCardEnvelope = z.infer<typeof importedCardEnvelopeSchema>;
export type CardInspectionReport = z.infer<typeof cardInspectionReportSchema>;
