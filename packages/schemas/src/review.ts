import { z } from "zod";

import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const reviewSeveritySchema = z.enum(["error", "warning", "info"]);

export const reviewEvidenceSchema = z
  .object({
    source: z.string().min(1),
    excerpt: z.string().min(1).optional(),
    path: z.array(z.union([z.string(), z.number().int()])).optional(),
  })
  .strict();

export const reviewFindingSchema = z
  .object({
    id: stableIdSchema,
    severity: reviewSeveritySchema,
    summary: z.string().min(1),
    evidence: z.array(reviewEvidenceSchema).min(1),
    hint: z.string().min(1).optional(),
    overridable: z.boolean(),
  })
  .strict();

export const reviewReportSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    reviewer: stableIdSchema,
    target_id: stableIdSchema,
    target_revision: revisionSchema,
    findings: z.array(reviewFindingSchema),
    summary: z.string().min(1),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = new Set<string>();
    report.findings.forEach((finding, index) => {
      if (ids.has(finding.id)) {
        context.addIssue({ code: "custom", message: `Finding ID 重複：${finding.id}`, path: ["findings", index, "id"] });
      }
      ids.add(finding.id);
    });
  });

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
