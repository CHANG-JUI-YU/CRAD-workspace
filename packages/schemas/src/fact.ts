import { z } from "zod";

import { lineRangeSchema, offsetRangeSchema } from "./chunk.js";
import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema, jsonValueSchema } from "./json.js";

export const factClassificationSchema = z.enum([
  "source_fact",
  "reasonable_inference",
  "creative_completion",
]);
export const factCoverageDimensionSchema = z.enum([
  "identity",
  "appearance",
  "personality",
  "speech",
  "habits",
  "background",
  "relationships",
  "goals",
  "abilities",
  "world_context",
]);
export const candidateStatusSchema = z.enum([
  "submitted",
  "validated",
  "pending_review",
  "accepted",
  "rejected",
  "superseded",
  "withdrawn",
]);
export const factStatusSchema = z.enum(["accepted", "rejected", "superseded", "withdrawn"]);
export const reviewDecisionTypeSchema = z.enum(["accepted", "rejected", "superseded", "withdrawn"]);

function refineFactCandidate(
  candidate: {
    classification: z.infer<typeof factClassificationSchema>;
    evidence: readonly unknown[];
    rationale?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (candidate.classification !== "creative_completion" && candidate.evidence.length === 0) {
    context.addIssue({
      code: "custom",
      message: `${candidate.classification} 至少需要一項 evidence`,
      path: ["evidence"],
    });
  }
  if (candidate.classification === "creative_completion" && candidate.rationale === undefined) {
    context.addIssue({
      code: "custom",
      message: "creative_completion 需要 rationale",
      path: ["rationale"],
    });
  }
}

export const factScopeSchema = z
  .object({
    world: stableIdSchema.optional(),
    timeline: stableIdSchema.optional(),
    location: stableIdSchema.optional(),
    character_ids: z.array(stableIdSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const factValidTimeSchema = z
  .object({
    start: z.string().min(1).optional(),
    end: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const factEvidenceSchema = z
  .object({
    id: stableIdSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    chunk_set_id: stableIdSchema,
    chunk_id: stableIdSchema,
    chunk_hash: revisionSchema,
    quote: z.string().min(1),
    normalized_character_range: offsetRangeSchema,
    normalized_line_range: lineRangeSchema,
    raw_byte_range: offsetRangeSchema.optional(),
    chapter: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const evidenceLocatorSchema = z
  .object({
    id: stableIdSchema,
    quote: z.string().min(1),
    occurrence: z.number().int().nonnegative().optional(),
    chapter: z.string().min(1).optional(),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const factCandidateSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    subject: stableIdSchema,
    predicate: stableIdSchema,
    value: jsonValueSchema,
    classification: factClassificationSchema,
    confidence: z.number().min(0).max(1),
    coverage_dimensions: z.array(factCoverageDimensionSchema).min(1).optional(),
    scope: factScopeSchema.default({ character_ids: [], extensions: {} }),
    valid_time: factValidTimeSchema.default({ extensions: {} }),
    evidence: z.array(factEvidenceSchema).default([]),
    rationale: z.string().min(1).optional(),
    status: candidateStatusSchema,
    created_by: stableIdSchema,
    created_at: z.string().datetime({ offset: true }),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine(refineFactCandidate);

export const factCandidateSubmissionDraftSchema = z.object({
  schema_version: factCandidateSchema.shape.schema_version,
  subject: factCandidateSchema.shape.subject,
  predicate: factCandidateSchema.shape.predicate,
  value: factCandidateSchema.shape.value,
  classification: factCandidateSchema.shape.classification,
  confidence: factCandidateSchema.shape.confidence,
  coverage_dimensions: factCandidateSchema.shape.coverage_dimensions,
  scope: factCandidateSchema.shape.scope,
  valid_time: factCandidateSchema.shape.valid_time,
  evidence: z.array(evidenceLocatorSchema).default([]),
  rationale: factCandidateSchema.shape.rationale,
  status: factCandidateSchema.shape.status,
  extensions: factCandidateSchema.shape.extensions,
}).strict().superRefine(refineFactCandidate);

export const candidateBatchSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    chunk_set_id: stableIdSchema,
    chunk_id: stableIdSchema,
    chunk_hash: revisionSchema,
    job_id: stableIdSchema,
    input_revision: revisionSchema,
    candidates: z.array(factCandidateSchema),
    created_by: stableIdSchema,
    created_at: z.string().datetime({ offset: true }),
    content_hash: revisionSchema,
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const candidateBatchSubmissionDraftSchema = z.object({
  ...candidateBatchSchema.shape,
  candidates: z.array(factCandidateSubmissionDraftSchema),
}).strict().omit({ id: true, content_hash: true, created_by: true });

export const factsCurationSummarySchema = z.object({
  schema_version: z.literal(1),
  id: stableIdSchema,
  task_id: stableIdSchema,
  jobs: z.array(z.object({
    job_id: stableIdSchema,
    input_revision: revisionSchema,
    source_id: stableIdSchema,
    source_revision_id: revisionSchema,
    chunk_set_id: stableIdSchema,
    results: z.array(z.object({
      chunk_id: stableIdSchema,
      chunk_hash: revisionSchema,
      batch_id: stableIdSchema,
      batch_hash: revisionSchema,
    }).strict()),
  }).strict()).min(1),
  created_by: stableIdSchema,
  created_at: z.string().datetime({ offset: true }),
  extensions: jsonObjectSchema.default({}),
}).strict();

export const factSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    subject: stableIdSchema,
    predicate: stableIdSchema,
    value: jsonValueSchema,
    classification: factClassificationSchema,
    confidence: z.number().min(0).max(1),
    scope: factScopeSchema.default({ character_ids: [], extensions: {} }),
    valid_time: factValidTimeSchema.default({ extensions: {} }),
    evidence: z.array(factEvidenceSchema),
    source_tiers: z.array(z.enum(["official", "common_fanon", "single_author_fanon", "user_original", "unknown"])).min(1),
    status: factStatusSchema,
    fact_revision: z.number().int().positive(),
    decision_id: stableIdSchema,
    created_by: stableIdSchema,
    created_at: z.string().datetime({ offset: true }),
    supersedes: z.array(stableIdSchema).default([]),
    superseded_by: stableIdSchema.optional(),
    decision_ids: z.array(stableIdSchema).min(1),
    extensions: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.status === "accepted" && fact.evidence.length === 0 && fact.classification !== "creative_completion") {
      context.addIssue({ code: "custom", message: "accepted source-derived fact 需要 evidence", path: ["evidence"] });
    }
    if (!fact.decision_ids.includes(fact.decision_id)) {
      context.addIssue({ code: "custom", message: "decision_id 必須存在於 decision_ids", path: ["decision_id"] });
    }
  });

export const factRegisterSchema = z
  .object({
    schema_version: z.literal(1),
    revision: revisionSchema,
    facts: z.array(factSchema).default([]),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const reviewDecisionSchema = z
  .object({
    schema_version: z.literal(1),
    id: stableIdSchema,
    candidate_id: stableIdSchema,
    fact_id: stableIdSchema,
    type: reviewDecisionTypeSchema,
    rationale: z.string().min(1),
    actor: stableIdSchema,
    decided_at: z.string().datetime({ offset: true }),
    extensions: jsonObjectSchema.default({}),
  })
  .strict();

export const candidateIdentityBindingSchema = z.object({
  schema_version: z.literal(1),
  decision_id: stableIdSchema,
  raw_candidate_id: stableIdSchema,
  candidate_occurrence_id: stableIdSchema,
  source_batch_id: stableIdSchema,
}).strict();

export type FactClassification = z.infer<typeof factClassificationSchema>;
export type FactCoverageDimension = z.infer<typeof factCoverageDimensionSchema>;
export type FactScope = z.output<typeof factScopeSchema>;
export type FactValidTime = z.output<typeof factValidTimeSchema>;
export type FactEvidence = z.output<typeof factEvidenceSchema>;
export type EvidenceLocator = z.output<typeof evidenceLocatorSchema>;
export type FactCandidate = z.output<typeof factCandidateSchema>;
export type FactCandidateSubmissionDraft = z.output<typeof factCandidateSubmissionDraftSchema>;
export type CandidateBatch = z.output<typeof candidateBatchSchema>;
export type CandidateBatchSubmissionDraft = z.output<typeof candidateBatchSubmissionDraftSchema>;
export type FactsCurationSummary = z.output<typeof factsCurationSummarySchema>;
export type Fact = z.output<typeof factSchema>;
export type FactRegister = z.output<typeof factRegisterSchema>;
export type ReviewDecision = z.output<typeof reviewDecisionSchema>;
export type CandidateIdentityBinding = z.output<typeof candidateIdentityBindingSchema>;
