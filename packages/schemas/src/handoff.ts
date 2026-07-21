import { z } from "zod";

import { stableIdSchema } from "./ids.js";
import { jsonObjectSchema } from "./json.js";
import { artifactReferenceSchema } from "./workflow-contracts.js";

export const handoffEvidenceSchema = z
  .object({
    summary: z.string().min(1),
    artifact: artifactReferenceSchema.optional(),
  })
  .strict();

export const handoffSchema = z
  .object({
    schema_version: z.literal(1),
    task_id: stableIdSchema,
    agent_id: stableIdSchema,
    project_id: stableIdSchema,
    workflow_revision: z.number().int().nonnegative(),
    requirements: z.array(z.string().min(1)),
    evidence: z.array(handoffEvidenceSchema).default([]),
    assumptions: z.array(z.string().min(1)).default([]),
    decision_summaries: z.array(z.string().min(1)).default([]),
    artifacts: z.array(artifactReferenceSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export type Handoff = z.infer<typeof handoffSchema>;
