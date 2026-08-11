import type { FactEvidenceReference, FactRecord, FactReviewRunRecord, SourceRecord } from "./index.js";

export interface SourceAdaptationIntent {
  subject_name: string;
  source_medium?: string;
  source_identifiers?: string[];
  adaptation_intent: string;
  canon_policy?: "reference_only" | "canon_inspired" | "canon_faithful";
  /** Per-character source attribution for multi-character adaptation cards. */
  subjects?: Array<{
    character_id: string;
    subject_name: string;
    source_medium?: string;
    source_identifiers?: string[];
  }>;
}

export interface FactProvenanceRef {
  kind: "fact";
  ref: string;
  requires_single_value?: boolean;
  note?: string;
}

export interface AdaptationDecision {
  id: string;
  topic: string;
  choice: "keep_blueprint" | "adopt_fact" | "blend" | "defer";
  blueprint_refs?: string[];
  fact_refs?: string[];
  rationale: string;
  created_at: string;
  created_by: string;
}

export interface AuthoringSourceContext {
  id: string;
  title: string;
  url?: string;
  status: string;
  revision?: string;
}

export interface FactReviewCandidateContext {
  candidate_occurrence_id: string;
  fact_id: string;
  statement: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: string;
  coverage?: string[];
  status: string;
  source_ids: string[];
  evidence: string[];
  evidence_refs?: FactEvidenceReference[];
  candidate_revision: string;
  last_decision?: "accepted" | "rejected" | "needs_evidence" | "conflict";
  last_reviewer_identity?: string;
}

export interface FactReviewContext {
  run?: FactReviewRunRecord;
  projection_revision?: string;
  candidates: FactReviewCandidateContext[];
  next_cursor?: string;
}

export interface AuthoringKnowledgeContext {
  blueprint?: Record<string, unknown>;
  source_adaptation?: SourceAdaptationIntent;
  accepted_facts: FactRecord[];
  unresolved_facts: FactRecord[];
  sources: AuthoringSourceContext[];
  fact_register_revision: string;
  adaptation_decisions: AdaptationDecision[];
  fact_review?: FactReviewContext;
}

export const AUTHORING_KNOWLEDGE_RULES = [
  "Treat Blueprint as the user's creative intent and do not silently overwrite it with source facts.",
  "Use accepted_facts as optional creative evidence; unresolved_facts are not confirmed canon.",
  "When a Fact shapes authored content, record its id in provenance or fact_refs.",
  "When authored content intentionally differs from a Fact or Blueprint, preserve an adaptation decision.",
] as const;

export type AuthoringKnowledgeSource = Pick<AuthoringKnowledgeContext, "blueprint" | "source_adaptation" | "accepted_facts" | "unresolved_facts" | "sources" | "fact_register_revision" | "adaptation_decisions" | "fact_review">;

export function sourceContextFromRecord(source: SourceRecord, candidate?: { url?: string; status?: string }): AuthoringSourceContext {
  return {
    id: source.id,
    title: source.title,
    ...(candidate?.url === undefined ? {} : { url: candidate.url }),
    status: candidate?.status ?? "ingested",
    revision: source.revision,
  };
}
