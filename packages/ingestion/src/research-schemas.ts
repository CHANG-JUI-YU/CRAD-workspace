import { z } from "zod";

export const researchSourceClassSchema = z.enum(["official", "encyclopedia", "wiki"]);
export type ResearchSourceClass = z.infer<typeof researchSourceClassSchema>;

export const researchQuerySchema = z.object({
  work_title: z.string().trim().min(1).max(300),
  character_names: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  aliases: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  language: z.string().trim().min(2).max(35),
  allowed_domains: z.array(z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)).max(20).default([]),
  result_count: z.number().int().min(1).max(10).default(8),
}).strict();
export type ResearchQuery = z.infer<typeof researchQuerySchema>;

export const researchCandidateSchema = z.object({
  id: z.string().regex(/^candidate-[0-9a-f]{24}$/u),
  url: z.string().url(),
  hostname: z.string().min(1),
  title: z.string().min(1).max(500),
  snippet: z.string().max(2000),
  source_class: researchSourceClassSchema,
  source_family_id: z.string().trim().min(1).max(300).optional(),
  language: z.string().trim().min(2).max(35).optional(),
  relevance_rationale: z.string().min(1).max(1000),
  status: z.enum(["pending", "approved", "rejected", "fetched"]),
  source_id: z.string().regex(/^research-[0-9a-f]{24}$/u),
  source_revision_id: z.string().regex(/^sha256:[0-9a-f]{64}$/u).optional(),
  requested_url: z.string().url().optional(),
  final_url: z.string().url().optional(),
  fetched_at: z.string().datetime({ offset: true }).optional(),
}).strict();
export type ResearchCandidate = z.infer<typeof researchCandidateSchema>;

export const researchApprovalSchema = z.object({
  decision_id: z.string().min(1).max(200),
  actor: z.string().min(1).max(200),
  decided_at: z.string().datetime({ offset: true }),
  approved_candidate_ids: z.array(z.string().regex(/^candidate-[0-9a-f]{24}$/u)).max(10),
  prior_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  single_family_fallback: z.boolean().optional(),
  single_family_fallback_reason: z.string().trim().min(1).max(2000).optional(),
}).strict();

export const researchBatchSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^research-batch-[0-9a-f]{24}$/u),
  revision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  provider: z.enum(["brave", "model_web"]),
  query: researchQuerySchema,
  candidates: z.array(researchCandidateSchema).max(10),
  approvals: z.array(researchApprovalSchema),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();
export type ResearchBatch = z.infer<typeof researchBatchSchema>;

export const researchPointerSchema = z.object({
  schema_version: z.literal(1),
  batch_id: z.string().regex(/^research-batch-[0-9a-f]{24}$/u),
  revision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  revision_path: z.string().regex(/^sources\/research\/[a-z0-9._-]+\/[a-z0-9._-]+\.json$/u),
}).strict();
