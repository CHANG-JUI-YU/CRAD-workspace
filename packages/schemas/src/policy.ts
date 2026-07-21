import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";

export const policyLayerSchema = z.enum(["normative", "compatibility", "workspace"]);
export const policySeveritySchema = z.enum(["error", "warning", "info", "off"]);

export const policyRuleSchema = z
  .object({
    id: stableIdSchema,
    layer: policyLayerSchema,
    severity: policySeveritySchema,
    enabled: z.boolean().default(true),
    options: jsonObjectSchema.default({}),
  })
  .strict();

export const policyProfileSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    extends: stableIdSchema.optional(),
    rules: z.array(policyRuleSchema),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((profile, context) => {
    const ids = new Set<string>();
    profile.rules.forEach((rule, index) => {
      if (ids.has(rule.id)) {
        context.addIssue({
          code: "custom",
          message: `規則 ID 重複：${rule.id}`,
          path: ["rules", index, "id"],
        });
      }
      ids.add(rule.id);
    });
  });

export type PolicyLayer = z.infer<typeof policyLayerSchema>;
export type PolicyProfile = z.infer<typeof policyProfileSchema>;
