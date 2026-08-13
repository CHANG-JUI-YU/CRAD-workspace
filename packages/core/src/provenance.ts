import { z } from "zod";
import type { CoverageSnapshot } from "./coverage.js";
import type { ProjectState } from "./project-state.js";

export interface ProvenanceCoverageRef {
  character_id?: string;
  requirement_id: string;
}

export interface ProvenanceOverrideRef {
  decision_id: string;
  action: string;
  requirement_ids: string[];
  rationale?: string;
  supersedes?: string;
}

export interface ProvenanceQualityOverrideRef {
  code: string;
  severity?: string;
  reason: string;
  by: string;
}

export interface ProvenanceCompositionSummary {
  source_backed: { refs: ProvenanceCoverageRef[]; count: number };
  user_supplement: { refs: ProvenanceCoverageRef[]; count: number };
  creative_completion: { refs: ProvenanceCoverageRef[]; count: number };
  overrides: ProvenanceOverrideRef[];
  quality_overrides: ProvenanceQualityOverrideRef[];
  assessment?: { id: string; revision: string };
  requirement_set?: { id: string; revision: string };
  fact_review_run?: { id: string; projection_revision?: string };
  fact_projection_revision?: string;
  source_revisions: Array<{ source_id: string; revision: string }>;
  resolution_ids: string[];
  authoring_binding_ids: string[];
  coverage_snapshot_hash?: string;
  build_snapshot_hash: string;
}

const provenanceCoverageRefSchema = z.object({
  character_id: z.string().min(1).optional(),
  requirement_id: z.string().min(1),
}).strict();

const provenanceOverrideRefSchema = z.object({
  decision_id: z.string().min(1),
  action: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  rationale: z.string().min(1).optional(),
  supersedes: z.string().min(1).optional(),
}).strict();

const provenanceQualityOverrideRefSchema = z.object({
  code: z.string().min(1),
  severity: z.string().min(1).optional(),
  reason: z.string().min(1),
  by: z.string().min(1),
}).strict();

export const provenanceCompositionSummarySchema = z.object({
  source_backed: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  user_supplement: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  creative_completion: z.object({ refs: z.array(provenanceCoverageRefSchema), count: z.number().int().nonnegative() }).strict(),
  overrides: z.array(provenanceOverrideRefSchema),
  quality_overrides: z.array(provenanceQualityOverrideRefSchema),
  assessment: z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict().optional(),
  requirement_set: z.object({ id: z.string().min(1), revision: z.string().min(1) }).strict().optional(),
  fact_review_run: z.object({ id: z.string().min(1), projection_revision: z.string().min(1).optional() }).strict().optional(),
  fact_projection_revision: z.string().min(1).optional(),
  source_revisions: z.array(z.object({ source_id: z.string().min(1), revision: z.string().min(1) }).strict()),
  resolution_ids: z.array(z.string().min(1)),
  authoring_binding_ids: z.array(z.string().min(1)),
  coverage_snapshot_hash: z.string().min(1).optional(),
  build_snapshot_hash: z.string().min(1),
}).strict();

function refsFrom(values: readonly { character_id?: string; requirement_id: string }[]): ProvenanceCoverageRef[] {
  return values.map((value) => (value.character_id === undefined ? { requirement_id: value.requirement_id } : { character_id: value.character_id, requirement_id: value.requirement_id }));
}

function optionalRef(values: readonly { character_id?: string; requirement_id: string }[]): { refs: ProvenanceCoverageRef[]; count: number } {
  const refs = refsFrom(values);
  return { refs, count: refs.length };
}

export function buildProvenanceCompositionSummary(state: ProjectState, coverageSnapshot: CoverageSnapshot | undefined, buildSnapshotHash: string): ProvenanceCompositionSummary {
  const qualityAudit = state.quality_profile.override_audit ?? [];
  const qualityOverrides: ProvenanceQualityOverrideRef[] = qualityAudit.length > 0
    ? qualityAudit.map((item) => ({ code: item.code, severity: item.configured_severity, reason: `quality override configured ${item.configured_severity} against effective ${item.against_effective_severity}`, by: item.actor }))
    : Object.entries(state.quality_profile.overrides).map(([code, severity]) => ({ code, severity, reason: "quality override", by: "system" }));
  return {
    source_backed: optionalRef(coverageSnapshot?.source_covered_requirements ?? []),
    user_supplement: optionalRef(coverageSnapshot?.user_supplement_requirements ?? []),
    creative_completion: optionalRef(coverageSnapshot?.creative_completion_requirements ?? []),
    overrides: state.coverage_user_decisions.map((decision) => ({
      decision_id: decision.id,
      action: decision.action,
      requirement_ids: [...decision.requirement_ids],
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
      ...(decision.supersedes === undefined ? {} : { supersedes: decision.supersedes }),
    })),
    quality_overrides: qualityOverrides,
    ...(coverageSnapshot === undefined ? {} : {
      assessment: { id: coverageSnapshot.assessment_id, revision: coverageSnapshot.assessment_revision },
      requirement_set: { id: coverageSnapshot.requirement_set_id, revision: coverageSnapshot.requirement_set_revision },
    }),
    ...(coverageSnapshot?.fact_review_run_id === undefined ? {} : {
      fact_review_run: {
        id: coverageSnapshot.fact_review_run_id,
        ...(coverageSnapshot.fact_review_projection_revision === undefined ? {} : { projection_revision: coverageSnapshot.fact_review_projection_revision }),
      },
    }),
    ...(coverageSnapshot?.fact_projection_revision === undefined ? {} : { fact_projection_revision: coverageSnapshot.fact_projection_revision }),
    source_revisions: [...(coverageSnapshot?.source_revisions ?? [])],
    resolution_ids: [...(coverageSnapshot?.resolution_ids ?? [])],
    authoring_binding_ids: [...(coverageSnapshot?.authoring_binding_ids ?? [])],
    ...(coverageSnapshot === undefined ? {} : { coverage_snapshot_hash: coverageSnapshot.snapshot_hash }),
    build_snapshot_hash: buildSnapshotHash,
  };
}
