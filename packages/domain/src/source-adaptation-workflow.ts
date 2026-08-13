import { artifactDependencyFingerprint, computeProjectProjection, type ArtifactRecord, type ProjectState } from "@st-workspace/core";
import {
  buildCoverageSnapshot,
  coverageAssessmentFreshness,
  deriveCoverageReadiness,
  projectActiveCoverageBindings,
  requirementsResolved,
} from "./coverage-assessment.js";
import { validateWorkflow } from "./workflow-gate.js";

export const SOURCE_ADAPTATION_WORKFLOW_STAGES = [
  { id: "sources", label: "Sources" },
  { id: "fact_curation", label: "Fact Curation" },
  { id: "fact_review", label: "Fact Review" },
  { id: "coverage", label: "Coverage" },
  { id: "research_resolution", label: "Research / Resolution" },
  { id: "authoring", label: "Authoring" },
  { id: "review", label: "Review" },
  { id: "preview", label: "Preview" },
  { id: "publish", label: "Publish" },
] as const;

export type SourceAdaptationWorkflowStageId = (typeof SOURCE_ADAPTATION_WORKFLOW_STAGES)[number]["id"];
export type SourceAdaptationWorkflowStageStatus = "completed" | "current" | "blocked" | "stale" | "not_applicable";

export interface WorkflowStageBlocker {
  code: string;
  message: string;
  artifact_ids?: string[];
  fact_ids?: string[];
  source_ids?: string[];
}

export interface SourceAdaptationWorkflowStage {
  id: SourceAdaptationWorkflowStageId;
  label: string;
  status: SourceAdaptationWorkflowStageStatus;
  reason?: string;
  blockers?: WorkflowStageBlocker[];
  affected_object_ids?: string[];
  revision?: string;
  next_action?: string;
  target?: string;
}

export interface SourceAdaptationWorkflowModel {
  is_source_adaptation: boolean;
  stages: SourceAdaptationWorkflowStage[];
  current_stage?: string;
  next_action?: string;
}

const CONTENT_KINDS: ReadonlySet<ArtifactRecord["kind"]> = new Set([
  "character", "relationship", "world_lore", "greeting", "zhuji", "palette", "wardrobe", "plugin",
]);

type StageBaseStatus = "completed" | "pending" | "stale" | "blocked";

function latestRecordedPrecheck(state: ProjectState) {
  return [...state.blueprint_prechecks].reverse().find((item) => item.status === "recorded");
}

function latestAuthoritativeRun(state: ProjectState) {
  return [...state.fact_review_runs].reverse().find((run) => run.status !== "superseded");
}

function latestBuild(state: ProjectState) {
  return [...state.builds].reverse().find((build) => build.status === "previewed" || build.status === "built");
}

function sameSourceRevisions(left: readonly { source_id: string; revision: string }[], right: readonly { source_id: string; revision: string }[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined || a.source_id !== b.source_id || a.revision !== b.revision) return false;
  }
  return true;
}

function artifactStaleFindings(state: ProjectState, artifact: ArtifactRecord): { code: string; reason: string }[] {
  const findings: { code: string; reason: string }[] = [];
  const precheck = latestRecordedPrecheck(state);
  if (precheck !== undefined
    && CONTENT_KINDS.has(artifact.kind)
    && (artifact.blueprint_precheck_id !== precheck.id || artifact.blueprint_precheck_revision !== precheck.candidate_blueprint_revision)) {
    findings.push({ code: "BLUEPRINT_BINDING_STALE", reason: `Authored against blueprint precheck ${artifact.blueprint_precheck_id ?? "none"}` });
  }
  if (artifact.dependency_fingerprint !== undefined) {
    if (artifactDependencyFingerprint(state, artifact) !== artifact.dependency_fingerprint) {
      findings.push({ code: "ARTIFACT_DEPENDENCY_STALE", reason: "Dependency inputs changed after authoring" });
    }
  }
  return findings;
}

function coverageReadinessBlockers(state: ProjectState): WorkflowStageBlocker[] {
  const readiness = deriveCoverageReadiness(state);
  return readiness.blockers.map((blocker) => ({
    code: blocker.code,
    message: blocker.message,
    ...(blocker.fact_ids === undefined ? {} : { fact_ids: blocker.fact_ids }),
    ...(blocker.source_ids === undefined ? {} : { source_ids: blocker.source_ids }),
  }));
}

function stageBaseStatus(state: ProjectState, stageId: SourceAdaptationWorkflowStageId): StageBaseStatus {
  switch (stageId) {
    case "sources": {
      if (state.sources.length > 0) return "completed";
      return "pending";
    }
    case "fact_curation": {
      if (state.facts.length > 0) return "completed";
      return "pending";
    }
    case "fact_review": {
      const run = latestAuthoritativeRun(state);
      if (run === undefined) return "pending";
      const currentSources = state.sources.map((source) => ({ source_id: source.id, revision: source.revision }));
      if (!sameSourceRevisions(run.source_revisions, currentSources)) return "stale";
      const allDecided = state.facts.every((fact) => fact.decision_id !== undefined || fact.status !== "candidate" || fact.accepted_fact_revision !== undefined);
      if (run.status === "completed" && allDecided) return "completed";
      return "pending";
    }
    case "coverage": {
      const assessment = state.coverage_assessments.at(-1);
      if (assessment === undefined) return "pending";
      if (!coverageAssessmentFreshness(state, assessment)) return "stale";
      if (assessment.pass === "formal") return "completed";
      return "pending";
    }
    case "research_resolution": {
      const assessment = state.coverage_assessments.at(-1);
      if (assessment === undefined) return "pending";
      if (!coverageAssessmentFreshness(state, assessment)) return "pending";
      const resolved = requirementsResolved(state);
      if (resolved.resolved) return "completed";
      const hasOpenResearch = state.coverage_research_batches.some((batch) => batch.status === "open" || batch.status === "completed")
        || state.coverage_research_tasks.some((task) => task.status === "queued" || task.status === "claimed" || task.status === "running" || task.status === "completed");
      const hasPendingResolution = state.coverage_resolutions.some((resolution) => resolution.status === "authorized" || resolution.status === "pending");
      if (hasOpenResearch || hasPendingResolution) return "pending";
      return "blocked";
    }
    case "authoring": {
      const projection = computeProjectProjection(state);
      const plan = projection.publishPlan();
      if (plan.entries.length === 0) return "pending";
      const artifactById = new Map(projection.currentArtifacts.map((artifact) => [artifact.id, artifact]));
      if (plan.entries.some((entry) => !artifactById.has(entry.artifact_id))) return "pending";
      const bindings = projectActiveCoverageBindings(state, plan);
      for (const entry of plan.entries) {
        const artifact = artifactById.get(entry.artifact_id);
        if (artifact === undefined) continue;
        const binding = bindings.find((projected) => projected.artifact.id === entry.artifact_id);
        if (binding !== undefined && binding.status !== "current") return "pending";
        if (artifactStaleFindings(state, artifact).length > 0) return "stale";
      }
      return "completed";
    }
    case "review": {
      const projection = computeProjectProjection(state);
      const plan = projection.publishPlan();
      const contentEntries = plan.entries.filter((entry) => CONTENT_KINDS.has(entry.kind));
      if (contentEntries.length === 0) return "pending";
      const artifactById = new Map(projection.currentArtifacts.map((artifact) => [artifact.id, artifact]));
      const allReviewed = contentEntries.every((entry) => {
        const artifact = artifactById.get(entry.artifact_id);
        if (artifact === undefined) return false;
        return state.reviews.some((review) => review.artifact_id === entry.artifact_id && review.artifact_revision === entry.revision && (review.status === "passed" || review.status === "partial"));
      });
      return allReviewed ? "completed" : "pending";
    }
    case "preview": {
      const build = latestBuild(state);
      if (build === undefined) return "pending";
      if (build.coverage_snapshot === undefined) return "completed";
      const assessment = state.coverage_assessments.at(-1);
      if (assessment === undefined) return "pending";
      const expected = buildCoverageSnapshot(state, assessment, computeProjectProjection(state).publishPlan());
      if (build.coverage_snapshot.snapshot_hash !== expected.snapshot_hash) return "stale";
      return "completed";
    }
    case "publish": {
      if (state.publishes.length > 0) return "completed";
      const gate = validateWorkflow(state, "publish");
      if (gate.ok) return "pending";
      return "blocked";
    }
  }
}

const STAGE_NEXT_ACTIONS: Record<SourceAdaptationWorkflowStageId, string> = {
  sources: "Select and confirm the source materials.",
  fact_curation: "Extract facts from the confirmed sources.",
  fact_review: "Run Fact Review and confirm the review decisions.",
  coverage: "Run the formal coverage assessment.",
  research_resolution: "Research and resolve the uncovered requirements.",
  authoring: "Author the character setting artifacts.",
  review: "Review the authored artifacts.",
  preview: "Run a build preview.",
  publish: "Publish the project.",
};

const STAGE_STALE_ACTIONS: Record<SourceAdaptationWorkflowStageId, string> = {
  sources: "Source materials changed; re-run the source workflow.",
  fact_curation: "Inputs changed; re-extract facts from the current sources.",
  fact_review: "Sources changed; re-run Fact Review against the current source revisions.",
  coverage: "Inputs changed; re-run the formal coverage assessment.",
  research_resolution: "Coverage changed; re-evaluate the uncovered requirements.",
  authoring: "Inputs changed; re-author the affected artifacts.",
  review: "Artifacts changed; re-run the reviews.",
  preview: "Inputs changed; re-run the build preview.",
  publish: "Inputs changed; re-run the publish workflow.",
};

const STAGE_TARGETS: Record<SourceAdaptationWorkflowStageId, string> = {
  sources: "sources",
  fact_curation: "facts",
  fact_review: "fact-review/runs",
  coverage: "coverage",
  research_resolution: "coverage",
  authoring: "artifacts",
  review: "reviews",
  preview: "builds",
  publish: "publishes",
};

function stageDetails(state: ProjectState, stageId: SourceAdaptationWorkflowStageId): { affected_object_ids: string[]; revision?: string | undefined } {
  switch (stageId) {
    case "sources":
      return { affected_object_ids: state.sources.map((source) => source.id), revision: state.sources.at(-1)?.revision };
    case "fact_curation":
      return { affected_object_ids: state.facts.map((fact) => fact.id) };
    case "fact_review": {
      const run = latestAuthoritativeRun(state);
      return {
        affected_object_ids: [...(run === undefined ? [] : [run.id]), ...state.facts.map((fact) => fact.id)],
        revision: run === undefined ? undefined : `${run.candidate_set_revision.slice(0, 12)}`,
      };
    }
    case "coverage": {
      const assessment = state.coverage_assessments.at(-1);
      return {
        affected_object_ids: [...state.coverage_requirement_sets.map((set) => set.id), ...state.coverage_assessments.map((item) => item.id)],
        revision: assessment?.revision,
      };
    }
    case "research_resolution":
      return {
        affected_object_ids: [
          ...state.coverage_research_batches.map((batch) => batch.id),
          ...state.coverage_resolutions.map((resolution) => resolution.id),
        ],
        revision: state.coverage_resolutions.at(-1)?.id,
      };
    case "authoring": {
      const artifacts = computeProjectProjection(state).currentArtifacts;
      return { affected_object_ids: artifacts.map((artifact) => artifact.id), revision: artifacts.at(-1)?.revision };
    }
    case "review":
      return { affected_object_ids: state.reviews.map((review) => review.id) };
    case "preview": {
      const build = latestBuild(state);
      return { affected_object_ids: build === undefined ? [] : [build.id], revision: build?.id };
    }
    case "publish":
      return { affected_object_ids: state.publishes.map((publish) => publish.id), revision: state.publishes.at(-1)?.id };
  }
}

export function deriveSourceAdaptationWorkflow(state: ProjectState): SourceAdaptationWorkflowModel {
  const projection = computeProjectProjection(state);
  if (!projection.intent.is_source_adaptation) {
    return {
      is_source_adaptation: false,
      stages: SOURCE_ADAPTATION_WORKFLOW_STAGES.map((definition) => ({
        id: definition.id,
        label: definition.label,
        status: "not_applicable" as const,
        reason: "This project is not a source-adaptation workflow.",
      })),
    };
  }

  const blockedByUpstream = new Set<SourceAdaptationWorkflowStageId>();
  let currentAssigned = false;
  let staleFound = false;
  const stages: SourceAdaptationWorkflowStage[] = [];
  for (const definition of SOURCE_ADAPTATION_WORKFLOW_STAGES) {
    const base = stageBaseStatus(state, definition.id);
    let status: SourceAdaptationWorkflowStageStatus;
    if (staleFound) {
      status = "blocked";
      blockedByUpstream.add(definition.id);
    } else if (base === "completed") {
      status = "completed";
    } else if (base === "stale") {
      status = "stale";
      staleFound = true;
      currentAssigned = true;
    } else if (base === "blocked") {
      status = "blocked";
      currentAssigned = true;
    } else if (currentAssigned) {
      status = "blocked";
      blockedByUpstream.add(definition.id);
    } else {
      status = "current";
      currentAssigned = true;
    }
    const details = stageDetails(state, definition.id);
    const stage: SourceAdaptationWorkflowStage = {
      id: definition.id,
      label: definition.label,
      status,
      affected_object_ids: details.affected_object_ids,
      target: STAGE_TARGETS[definition.id],
      ...(details.revision === undefined ? {} : { revision: details.revision }),
    };
    if (status === "current") {
      stage.next_action = STAGE_NEXT_ACTIONS[definition.id];
    } else if (status === "stale") {
      stage.next_action = STAGE_STALE_ACTIONS[definition.id];
      stage.reason = "This stage was completed, but its inputs, revisions, bindings, or snapshots have since been invalidated.";
    } else if (status === "blocked") {
      stage.reason = staleFound
        ? "An earlier stage was invalidated; re-run the stale stage first."
        : "Earlier stages must complete before this stage can run.";
    }
    if (status === "blocked" || status === "current") {
      stage.blockers = stageBlockers(state, definition.id);
    }
    stages.push(stage);
  }

  const currentStage = stages.find((stage) => stage.status === "current" || stage.status === "stale");
  return {
    is_source_adaptation: true,
    stages,
    ...(currentStage === undefined ? {} : { current_stage: currentStage.id, next_action: currentStage.next_action }),
  };
}

function stageBlockers(state: ProjectState, stageId: SourceAdaptationWorkflowStageId): WorkflowStageBlocker[] {
  switch (stageId) {
    case "coverage":
      return coverageReadinessBlockers(state);
    case "research_resolution": {
      const resolved = requirementsResolved(state);
      return resolved.missing.map((ref) => ({
        code: "COVERAGE_RESOLUTION_REQUIRED",
        message: `Unresolved coverage requirement: ${ref.character_id ?? "world"}/${ref.requirement_id}.`,
      }));
    }
    case "review": {
      return validateWorkflow(state, "publish").diagnostics
        .filter((diagnostic) => diagnostic.code === "ARTIFACT_REVIEW_REQUIRED")
        .map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          ...(diagnostic.artifact_ids === undefined ? {} : { artifact_ids: diagnostic.artifact_ids }),
        }));
    }
    case "publish": {
      return validateWorkflow(state, "publish").diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          ...(diagnostic.artifact_ids === undefined ? {} : { artifact_ids: diagnostic.artifact_ids }),
          ...(diagnostic.fact_ids === undefined ? {} : { fact_ids: diagnostic.fact_ids }),
          ...(diagnostic.source_ids === undefined ? {} : { source_ids: diagnostic.source_ids }),
        }));
    }
    default:
      return [];
  }
}
