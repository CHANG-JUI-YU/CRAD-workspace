import { z } from "zod";

import { factScopeSchema, factValidTimeSchema } from "./fact.js";
import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema, jsonValueSchema } from "./json.js";

export const conflictStatusSchema = z.enum(["open", "resolved"]);
export const resolutionTypeSchema = z.enum([
  "choose_one",
  "coexist",
  "temporal",
  "scope_split",
  "unresolved",
  "supersede",
]);

export const conflictMemberSchema = z
  .object({
    fact_id: stableIdSchema.optional(),
    candidate_id: stableIdSchema.optional(),
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    value: jsonValueSchema,
  })
  .strict()
  .superRefine((member, context) => {
    if ((member.fact_id === undefined) === (member.candidate_id === undefined)) {
      context.addIssue({
        code: "custom",
        message: "conflict member 必須恰有一個 fact_id 或 candidate_id",
        path: ["fact_id"],
      });
    }
  });

export const temporalAssignmentSchema = z
  .object({ fact_id: stableIdSchema, valid_time: factValidTimeSchema })
  .strict();

export const scopeAssignmentSchema = z
  .object({ fact_id: stableIdSchema, scope: factScopeSchema })
  .strict();

export const resolutionDecisionSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    conflict_id: stableIdSchema,
    type: resolutionTypeSchema,
    accepted_fact_ids: z.array(stableIdSchema).default([]),
    rejected_fact_ids: z.array(stableIdSchema).default([]),
    temporal_assignments: z.array(temporalAssignmentSchema).default([]),
    scope_assignments: z.array(scopeAssignmentSchema).default([]),
    rationale: z.string().min(1),
    actor: stableIdSchema,
    decided_at: z.string().datetime({ offset: true }),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((decision, context) => {
    if (["choose_one", "supersede"].includes(decision.type)) {
      if (decision.accepted_fact_ids.length === 0 || decision.rejected_fact_ids.length === 0) {
        context.addIssue({ code: "custom", message: `${decision.type} 需要採納與未採納 fact IDs` });
      }
    }
    if (decision.type === "temporal" && decision.temporal_assignments.length < 2) {
      context.addIssue({ code: "custom", message: "temporal resolution 至少需要兩項時間配置", path: ["temporal_assignments"] });
    }
    if (decision.type === "scope_split" && decision.scope_assignments.length < 2) {
      context.addIssue({ code: "custom", message: "scope_split resolution 至少需要兩項 scope 配置", path: ["scope_assignments"] });
    }
    if (decision.type === "coexist" && decision.accepted_fact_ids.length < 2) {
      context.addIssue({ code: "custom", message: "coexist resolution 至少需要兩個採納 fact IDs", path: ["accepted_fact_ids"] });
    }
    const accepted = new Set(decision.accepted_fact_ids);
    if (accepted.size !== decision.accepted_fact_ids.length
      || new Set(decision.rejected_fact_ids).size !== decision.rejected_fact_ids.length
      || decision.rejected_fact_ids.some((id) => accepted.has(id))) {
      context.addIssue({ code: "custom", message: "resolution fact IDs 必須唯一且採納/未採納不得重疊" });
    }
    const hasAssignments = decision.temporal_assignments.length > 0 || decision.scope_assignments.length > 0;
    if (decision.type === "unresolved" && (accepted.size > 0 || decision.rejected_fact_ids.length > 0 || hasAssignments)) {
      context.addIssue({ code: "custom", message: "unresolved 不得包含裁決或 assignments" });
    }
    if (decision.type !== "temporal" && decision.temporal_assignments.length > 0) {
      context.addIssue({ code: "custom", message: `${decision.type} 不得包含 temporal assignments` });
    }
    if (decision.type !== "scope_split" && decision.scope_assignments.length > 0) {
      context.addIssue({ code: "custom", message: `${decision.type} 不得包含 scope assignments` });
    }
  });

export const conflictSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    subject: stableIdSchema,
    predicate: stableIdSchema,
    scope: factScopeSchema,
    valid_time: factValidTimeSchema,
    members: z.array(conflictMemberSchema).min(2),
    status: conflictStatusSchema,
    resolution_decision_id: stableIdSchema.optional(),
    opened_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((conflict, context) => {
    if (conflict.status === "resolved" && conflict.resolution_decision_id === undefined) {
      context.addIssue({ code: "custom", message: "resolved conflict 需要 resolution decision", path: ["resolution_decision_id"] });
    }
  });

export const conflictRegisterSchema = z
  .object({
    schema_version: z.literal(1),
    revision: revisionSchema,
    conflicts: z.array(conflictSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const journalEventKindSchema = z.enum([
  "source.created",
  "source.revision_added",
  "source.chunk_set_created",
  "source.job_updated",
  "candidate.submitted",
  "candidate.validated",
  "fact.accepted",
  "fact.rejected",
  "fact.superseded",
  "fact.withdrawn",
  "conflict.opened",
  "conflict.resolved",
  "candidate.identity_bound",
]);

export const journalEventEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    sequence: z.number().int().positive(),
    kind: journalEventKindSchema,
    aggregate_id: stableIdSchema,
    prior_revision: revisionSchema.optional(),
    actor: stableIdSchema,
    timestamp: z.string().datetime({ offset: true }),
    payload_hash: revisionSchema,
    payload: jsonObjectSchema,
  })
  .strict();

export type ResolutionType = z.infer<typeof resolutionTypeSchema>;
export type ConflictMember = z.output<typeof conflictMemberSchema>;
export type ResolutionDecision = z.output<typeof resolutionDecisionSchema>;
export type Conflict = z.output<typeof conflictSchema>;
export type ConflictRegister = z.output<typeof conflictRegisterSchema>;
export type JournalEventEnvelope = z.infer<typeof journalEventEnvelopeSchema>;
