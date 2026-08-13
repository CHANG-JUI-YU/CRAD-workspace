import { computeProjectProjection, type ProjectState } from "@st-workspace/core";
import { coverageAssessmentFreshness, projectActiveCoverageBindings, requirementsResolved } from "./coverage-assessment.js";

export interface SummaryKPIs {
  unresolved_requirements: number;
  conflicts: number;
  pending_supplements: number;
  active_research_tasks: number;
  stale_assessments: number;
  missing_bindings: number;
  stale_bindings: number;
  source_backed_percent: number | null;
  creative_completion_percent: number | null;
}

export function deriveSummaryKPIs(state: ProjectState): SummaryKPIs {
  const assessment = state.coverage_assessments.at(-1);
  const items = assessment?.items ?? [];
  const unresolved = requirementsResolved(state);
  const conflicts = items.filter((item) => item.status === "conflicted").length;
  const pendingSupplements = state.coverage_resolutions.filter((resolution) => resolution.mode === "user_supplement" && (resolution.status === "authorized" || resolution.status === "pending")).length;
  const activeTasks = state.coverage_research_tasks.filter((task) => task.status === "queued" || task.status === "claimed" || task.status === "running").length;
  const staleAssessments = assessment !== undefined && !coverageAssessmentFreshness(state, assessment) ? 1 : 0;
  const plan = computeProjectProjection(state).publishPlan();
  const bindings = projectActiveCoverageBindings(state, plan);
  const missingBindings = bindings.filter((projected) => projected.status === "missing").length;
  const staleBindings = bindings.filter((projected) => projected.status === "stale" || projected.status === "duplicate").length;
  const sourceBacked = items.filter((item) => item.status === "covered_by_source").length;
  const creativeCompletion = items.filter((item) => item.status === "creative_completion_authorized").length;
  return {
    unresolved_requirements: unresolved.missing.length,
    conflicts,
    pending_supplements: pendingSupplements,
    active_research_tasks: activeTasks,
    stale_assessments: staleAssessments,
    missing_bindings: missingBindings,
    stale_bindings: staleBindings,
    source_backed_percent: items.length === 0 ? null : Math.round((sourceBacked / items.length) * 100),
    creative_completion_percent: items.length === 0 ? null : Math.round((creativeCompletion / items.length) * 100),
  };
}
