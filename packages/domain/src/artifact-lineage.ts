import { computeProjectProjection, coverageFactProjectionRevision, type ProjectState } from "@st-workspace/core";
import { projectActiveCoverageBindings } from "./coverage-assessment.js";

export type ArtifactBindingState = "current" | "stale" | "missing";

export interface ArtifactCoverageLineage {
  artifact: { id: string; key: string; kind: string; revision: string };
  state: ArtifactBindingState;
  reason?: string;
  binding?: {
    id: string;
    artifact_revision: string;
    assessment_id: string;
    assessment_revision: string;
    requirement_set_revision: string;
    fact_projection_revision: string;
    fact_review_run_id?: string;
    resolution_ids: string[];
    input_snapshot_hash: string;
  };
  assessment?: { id: string; revision: string; fresh: boolean };
  requirement_set?: { id: string; revision: string };
  fact_review_run?: { id: string; projection_revision?: string };
  fact_projection_revision?: string;
  resolution_ids: string[];
  input_snapshot_hash?: string;
}

export function deriveArtifactCoverageLineage(state: ProjectState, artifactId: string): ArtifactCoverageLineage | undefined {
  const projection = computeProjectProjection(state);
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (artifact === undefined) return undefined;
  const plan = projection.publishPlan();
  const projected = projectActiveCoverageBindings(state, plan).find((item) => item.entry.artifact_id === artifactId);
  if (projected === undefined) return undefined;
  const latestAssessment = state.coverage_assessments.at(-1);
  const latestRun = [...state.fact_review_runs].reverse().find((run) => run.status !== "superseded");
  const binding = projected.binding;
  const requirementSet = binding === undefined ? undefined : state.coverage_requirement_sets.find((set) => set.revision === binding.requirement_set_revision);
  const stateValue: ArtifactBindingState = projected.status === "current" ? "current" : projected.status === "duplicate" ? "stale" : projected.status;
  return {
    artifact: { id: artifact.id, key: artifact.key, kind: artifact.kind, revision: artifact.revision },
    state: stateValue,
    ...(projected.reason === undefined
      ? stateValue === "missing"
        ? { reason: "此 artifact 尚未綁定正式覆蓋評估。" }
        : {}
      : { reason: projected.reason }),
    ...(binding === undefined ? {} : {
      binding: {
        id: binding.id,
        artifact_revision: binding.artifact_revision,
        assessment_id: binding.assessment_id,
        assessment_revision: binding.assessment_revision,
        requirement_set_revision: binding.requirement_set_revision,
        fact_projection_revision: binding.fact_projection_revision,
        ...(binding.fact_review_run_id === undefined ? {} : { fact_review_run_id: binding.fact_review_run_id }),
        resolution_ids: [...binding.resolution_ids],
        input_snapshot_hash: binding.input_snapshot_hash,
      },
    }),
    ...(latestAssessment === undefined ? {} : { assessment: { id: latestAssessment.id, revision: latestAssessment.revision, fresh: stateValue === "current" } }),
    ...(requirementSet === undefined ? {} : { requirement_set: { id: requirementSet.id, revision: requirementSet.revision } }),
    ...(latestRun === undefined ? {} : {
      fact_review_run: {
        id: latestRun.id,
        ...(latestRun.candidate_set_revision === undefined ? {} : { projection_revision: latestRun.candidate_set_revision }),
      },
    }),
    fact_projection_revision: coverageFactProjectionRevision(state),
    resolution_ids: [...state.coverage_resolutions.filter((resolution) => resolution.assessment_id === latestAssessment?.id).map((resolution) => resolution.id)],
    ...(binding === undefined ? {} : { input_snapshot_hash: binding.input_snapshot_hash }),
  };
}
