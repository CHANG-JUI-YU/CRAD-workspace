import { z } from "zod";

import { jsonValueSchema } from "./json.js";

export const diagnosticSeveritySchema = z.enum(["error", "warning", "info"]);
export const diagnosticFixabilitySchema = z.enum(["automatic", "manual", "none"]);

export const diagnosticEvidenceSchema = z
  .object({
    source: z.string().min(1),
    excerpt: z.string().optional(),
    revision: z.string().optional(),
  })
  .strict();

export const diagnosticLocationSchema = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    path: z.array(z.union([z.string(), z.number().int()])).optional(),
  })
  .strict();

export const diagnosticSchema = z
  .object({
    code: z.string().min(1),
    severity: diagnosticSeveritySchema,
    message: z.string().min(1),
    location: diagnosticLocationSchema.optional(),
    hint: z.string().min(1).optional(),
    details: jsonValueSchema.optional(),
    evidence: z.array(diagnosticEvidenceSchema).default([]),
    fixability: diagnosticFixabilitySchema.default("none"),
  })
  .strict();

export const diagnosticReportSchema = z
  .object({
    ok: z.boolean(),
    diagnostics: z.array(diagnosticSchema),
  })
  .strict();

export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;
export type DiagnosticFixability = z.infer<typeof diagnosticFixabilitySchema>;
export type DiagnosticLocation = z.infer<typeof diagnosticLocationSchema>;
export type Diagnostic = z.output<typeof diagnosticSchema>;
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
