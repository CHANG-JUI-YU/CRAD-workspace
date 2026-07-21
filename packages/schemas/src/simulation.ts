import { z } from "zod";

import { stableIdSchema } from "./ids.js";

export const tokenEntryReportSchema = z
  .object({
    entry_id: stableIdSchema,
    tokens: z.number().int().nonnegative(),
    constant: z.boolean(),
    included: z.boolean(),
    evicted: z.boolean(),
  })
  .strict();

export const tokenSimulationReportSchema = z
  .object({
    schema_version: z.literal(1),
    tokenizer: z.object({ id: z.string().min(1), version: z.string().min(1), exact: z.boolean() }).strict(),
    budget: z.number().int().positive().optional(),
    constant_tokens: z.number().int().nonnegative(),
    worst_case_tokens: z.number().int().nonnegative(),
    included_tokens: z.number().int().nonnegative(),
    over_budget: z.boolean(),
    entries: z.array(tokenEntryReportSchema),
    evicted_entry_ids: z.array(stableIdSchema),
  })
  .strict();

export const triggerTraceSchema = z
  .object({
    entry_id: stableIdSchema,
    active: z.boolean(),
    reason: z.enum(["constant", "key", "recursion", "disabled", "condition_unsupported", "not_matched", "group_evicted", "budget_evicted"]),
    matched_keys: z.array(z.string()),
    recursion_depth: z.number().int().nonnegative().optional(),
  })
  .strict();

export const triggerSimulationReportSchema = z
  .object({
    schema_version: z.literal(1),
    profile: z.string().min(1),
    generation_type: z.enum(["normal", "continue", "impersonate", "swipe", "regenerate", "quiet"]),
    active_entry_ids: z.array(stableIdSchema),
    traces: z.array(triggerTraceSchema),
  })
  .strict();

export type TokenSimulationReport = z.infer<typeof tokenSimulationReportSchema>;
export type TriggerSimulationReport = z.infer<typeof triggerSimulationReportSchema>;
