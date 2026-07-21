import { z } from "zod";

import { diagnosticEvidenceSchema, diagnosticFixabilitySchema, diagnosticLocationSchema, diagnosticSeveritySchema } from "./diagnostic.js";
import { policyLayerSchema } from "./policy.js";

export const auditFindingSchema = z
  .object({
    rule_id: z.string().min(1),
    layer: policyLayerSchema,
    severity: diagnosticSeveritySchema,
    message: z.string().min(1),
    location: diagnosticLocationSchema.optional(),
    hint: z.string().min(1).optional(),
    evidence: z.array(diagnosticEvidenceSchema),
    fixability: diagnosticFixabilitySchema,
    overridable: z.boolean(),
  })
  .strict();

export const auditReportSchema = z
  .object({
    schema_version: z.literal(1),
    ok: z.boolean(),
    blocked: z.boolean(),
    findings: z.array(auditFindingSchema),
    summary: z
      .object({
        errors: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        info: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type AuditFinding = z.infer<typeof auditFindingSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
