import {
  COVERAGE_REQUIREMENT_CATALOG,
  type CoverageCellActionOption,
  type ProjectState,
  type ResearchTaskRecord,
} from "@st-workspace/core";
import { coverageAssessmentFreshness, currentResolutions, deriveCoverageRequirementExplanations } from "./coverage-assessment.js";
import { coverageAssessmentStaleComponents } from "./downstream-invalidation.js";
import {
  deriveAssessmentWideResearchProjection,
  deriveCoverageAssessmentEligibility,
  type AssessmentWideResearchProjection,
  type CoverageAssessmentEligibility,
} from "./coverage-eligibility.js";

export type CoverageCenterCellStatus = "missing" | "candidate_signal" | "source_covered" | "supplement" | "creative_completion" | "conflict" | "stale";

export interface CoverageCenterTaskRef {
  id: string;
  batch_id: string;
  assessment_id: string;
  assessment_revision: string;
  requirement_set_id?: string;
  requirement_set_revision?: string;
  status: string;
  claim_generation: number;
  attempt: number;
  query_seeds: string[];
  source_constraints?: string[];
  searched_queries: string[];
  source_families: string[];
  exhausted_reason?: string;
  predecessor_id?: string;
  successor_id?: string;
  is_active: boolean;
  is_exhausted: boolean;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface CoverageCenterResolutionRef {
  id: string;
  mode: string;
  status: string;
  assessment_id?: string;
  assessment_revision?: string;
  requirement_set_revision?: string;
  rationale: string;
  user_decision_id?: string;
  supersedes?: string;
  is_current: boolean;
  created_at: string;
}

export interface CoverageCenterCell {
  character_id?: string;
  requirement_id: string;
  requirement_label: string;
  dimension_path?: string;
  scope: "character" | "world";
  status: CoverageCenterCellStatus;
  assessment_id: string;
  assessment_revision: string;
  assessment_stale: boolean;
  accepted_fact_ids: string[];
  candidate_fact_ids: string[];
  evidence_source_ids: string[];
  resolution_ids: string[];
  research_task_ids: string[];
  current_research_tasks: CoverageCenterTaskRef[];
  history_research_tasks: CoverageCenterTaskRef[];
  current_resolutions: CoverageCenterResolutionRef[];
  history_resolutions: CoverageCenterResolutionRef[];
  reason?: string;
  missing_prerequisite?: string;
  actions: string[];
  typed_actions: CoverageCellActionOption[];
}

export interface CoverageCenterMatrix {
  requirement_set?: { id: string; revision: string };
  assessment?: {
    id: string;
    revision: string;
    pass: string;
    fresh: boolean;
    current: boolean;
    formal: boolean;
    requirement_set_current: boolean;
    actionable: boolean;
    eligibility_reason_code?: string;
    eligibility_reason?: string;
    prerequisite?: string;
  };
  stale_components: string[];
  assessment_eligibility: CoverageAssessmentEligibility;
  assessment_wide_research: AssessmentWideResearchProjection;
  cells: CoverageCenterCell[];
}

export interface ResearchMonitorTaskView {
  id: string;
  batch_id: string;
  character_id?: string;
  requirement_ids: string[];
  dimension_paths: string[];
  query_seeds: string[];
  source_constraints?: string[];
  status: string;
  projected_status: string;
  lease_owner?: string;
  lease_expires_at?: string;
  claim_generation: number;
  attempt: number;
  searched_queries: string[];
  source_families: string[];
  exhausted_reason?: string;
  predecessor_id?: string;
  successor_ids: string[];
  candidate_source_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ResearchMonitorBatchView {
  id: string;
  assessment_id: string;
  assessment_revision: string;
  requirement_set_id: string;
  requirement_set_revision: string;
  status: string;
  created_by: string;
  created_at: string;
  task_ids: string[];
  task_status_summary: Record<string, number>;
}

export interface ResearchMonitor {
  batches: ResearchMonitorBatchView[];
  tasks: ResearchMonitorTaskView[];
}

const CELL_STATUS_MAP: Readonly<Record<string, CoverageCenterCellStatus>> = {
  missing: "missing",
  candidate_signal: "candidate_signal",
  covered_by_source: "source_covered",
  covered_by_user_supplement: "supplement",
  creative_completion_authorized: "creative_completion",
  conflicted: "conflict",
};

export function deriveCoverageCellActions(
  cellStatus: CoverageCenterCellStatus,
  eligibility: CoverageAssessmentEligibility,
  exhausted: boolean,
  scope: { character_id?: string; requirement_id: string; assessment_id?: string; assessment_revision?: string },
): CoverageCellActionOption[] {
  const options: CoverageCellActionOption[] = [];

  if (!eligibility.actionable) {
    const reasonText = eligibility.reason ?? "Coverage Assessment 尚不具備 mutation 資格";
    const reassessLabel =
      eligibility.reason_code === "COVERAGE_ASSESSMENT_NOT_FORMAL"
        ? "前往 Fact Review／Formal Assessment"
        : eligibility.reason_code === "COVERAGE_ASSESSMENT_STALE"
          ? "重新執行 Formal Assessment"
          : "重新進行評估";
    const reassessTargetPanel =
      eligibility.reason_code === "COVERAGE_ASSESSMENT_NOT_FORMAL" ? "fact-review" : "coverage";
    options.push({
      action: "reassess",
      label: reassessLabel,
      enabled: true,
      prerequisite: { action: "reassess", target_panel: reassessTargetPanel },
      scope,
    });
    options.push({
      action: "research",
      label: "來源研究",
      enabled: false,
      disabled_reason: reasonText,
      prerequisite: { action: "reassess", target_panel: reassessTargetPanel },
      scope,
    });
    options.push({
      action: "supplement",
      label: "提供補充資料",
      enabled: false,
      disabled_reason: reasonText,
      prerequisite: { action: "reassess", target_panel: reassessTargetPanel },
      scope,
    });
    options.push({
      action: "creative_completion",
      label: "授權創作補全",
      enabled: false,
      disabled_reason: reasonText,
      prerequisite: { action: "reassess", target_panel: reassessTargetPanel },
      scope,
    });
    return options;
  }

  if (cellStatus === "source_covered" || cellStatus === "supplement" || cellStatus === "creative_completion") {
    options.push({
      action: "view_details",
      label: "檢視細節與 Provenance",
      enabled: true,
      scope,
    });
    options.push({
      action: "research",
      label: "來源研究",
      enabled: false,
      disabled_reason: "需求已解決，若要重新變更請由 Detail 面板或重新評估進程操作",
      scope,
    });
    options.push({
      action: "supplement",
      label: "提供補充資料",
      enabled: false,
      disabled_reason: "需求已解決，若要重新變更請由 Detail 面板或重新評估進程操作",
      scope,
    });
    options.push({
      action: "creative_completion",
      label: "授權創作補全",
      enabled: false,
      disabled_reason: "需求已解決，若要重新變更請由 Detail 面板或重新評估進程操作",
      scope,
    });
    return options;
  }

  if (cellStatus === "conflict") {
    options.push({
      action: "view_details",
      label: "至 Fact Review 解決衝突",
      enabled: true,
      prerequisite: { action: "resolve_conflict", target_panel: "fact-review" },
      scope,
    });
    return options;
  }

  if (exhausted) {
    options.push({ action: "revise_query", label: "修改查詢", enabled: true, scope });
    options.push({ action: "revise_constraints", label: "修改來源限制", enabled: true, scope });
    options.push({ action: "manual_url", label: "手動提供 URL", enabled: true, scope });
    options.push({ action: "supplement", label: "提供補充資料", enabled: true, scope });
    options.push({ action: "creative_completion", label: "授權創作補全", enabled: true, scope });
  } else {
    options.push({ action: "research", label: "來源研究", enabled: true, scope });
    options.push({ action: "supplement", label: "提供補充資料", enabled: true, scope });
    options.push({ action: "creative_completion", label: "授權創作補全", enabled: true, scope });
  }

  return options;
}

export function deriveCoverageCenterMatrix(state: ProjectState): CoverageCenterMatrix {
  const requirementSet = state.coverage_requirement_sets.at(-1);
  const assessment = state.coverage_assessments.at(-1);
  const eligibility = deriveCoverageAssessmentEligibility(state);
  const wideResearch = deriveAssessmentWideResearchProjection(state);
  const staleComponents = assessment === undefined ? [] : coverageAssessmentStaleComponents(state, assessment);
  const fresh = assessment !== undefined && staleComponents.length === 0;
  const explanations = deriveCoverageRequirementExplanations(state);

  const cells: CoverageCenterCell[] = (assessment?.items ?? []).map((item) => {
    const definition = COVERAGE_REQUIREMENT_CATALOG.find((entry) => entry.id === item.requirement_id);
    const matchingTasks = state.coverage_research_tasks.filter((task) => (task.character_id ?? "") === (item.character_id ?? "") && task.requirement_ids.includes(item.requirement_id));

    const currentResearchTasks: CoverageCenterTaskRef[] = [];
    const historyResearchTasks: CoverageCenterTaskRef[] = [];

    for (const task of matchingTasks) {
      const batch = state.coverage_research_batches.find((b) => b.id === task.batch_id);
      const successor = state.coverage_research_tasks.find((other) => other.predecessor_id === task.id);
      const isLineageMatch =
        batch !== undefined &&
        assessment !== undefined &&
        requirementSet !== undefined &&
        batch.assessment_id === assessment.id &&
        batch.assessment_revision === assessment.revision &&
        batch.requirement_set_id === requirementSet.id &&
        batch.requirement_set_revision === requirementSet.revision;
      const isCurrent = isLineageMatch;
      const isActive = task.status === "queued" || task.status === "claimed" || task.status === "running";
      const isExhausted = task.status === "exhausted";

      const taskRef: CoverageCenterTaskRef = {
        id: task.id,
        batch_id: task.batch_id,
        assessment_id: batch?.assessment_id ?? "",
        assessment_revision: batch?.assessment_revision ?? "",
        ...(batch?.requirement_set_id === undefined ? {} : { requirement_set_id: batch.requirement_set_id }),
        ...(batch?.requirement_set_revision === undefined ? {} : { requirement_set_revision: batch.requirement_set_revision }),
        status: task.status,
        claim_generation: task.claim_generation,
        attempt: task.attempt,
        query_seeds: [...(task.query_seeds ?? [])],
        ...(task.source_constraints === undefined ? {} : { source_constraints: [...task.source_constraints] }),
        searched_queries: [...(task.searched_queries ?? [])],
        source_families: [...(task.source_families ?? [])],
        ...(task.exhausted_reason === undefined ? {} : { exhausted_reason: task.exhausted_reason }),
        ...(task.predecessor_id === undefined ? {} : { predecessor_id: task.predecessor_id }),
        ...(successor === undefined ? {} : { successor_id: successor.id }),
        is_active: isActive,
        is_exhausted: isExhausted,
        is_current: isCurrent,
        created_at: task.created_at,
        updated_at: task.updated_at,
      };

      if (isCurrent) {
        currentResearchTasks.push(taskRef);
      } else {
        historyResearchTasks.push(taskRef);
      }
    }

    const allMatchingResolutions = state.coverage_resolutions.filter(
      (res) => res.requirement_id === item.requirement_id && (res.character_id ?? "") === (item.character_id ?? ""),
    );
    const currentResList = currentResolutions(state, {
      requirementSetRevision: requirementSet?.revision,
      requirementId: item.requirement_id,
      characterId: item.character_id,
    });
    const currentResIds = new Set(currentResList.map((r) => r.id));

    const currentResolutionRefs: CoverageCenterResolutionRef[] = [];
    const historyResolutionRefs: CoverageCenterResolutionRef[] = [];

    for (const res of allMatchingResolutions) {
      const isCurrent = currentResIds.has(res.id);
      const ref: CoverageCenterResolutionRef = {
        id: res.id,
        mode: res.mode,
        status: res.status,
        ...(res.assessment_id === undefined ? {} : { assessment_id: res.assessment_id }),
        ...(res.assessment_revision === undefined ? {} : { assessment_revision: res.assessment_revision }),
        ...(res.requirement_set_revision === undefined ? {} : { requirement_set_revision: res.requirement_set_revision }),
        rationale: res.rationale,
        ...(res.user_decision_id === undefined ? {} : { user_decision_id: res.user_decision_id }),
        ...(res.supersedes === undefined ? {} : { supersedes: res.supersedes }),
        is_current: isCurrent,
        created_at: res.created_at,
      };
      if (isCurrent) {
        currentResolutionRefs.push(ref);
      } else {
        historyResolutionRefs.push(ref);
      }
    }

    const acceptedFactIds = (item.accepted_fact_ids ?? []).filter((id) => state.facts.some((fact) => fact.id === id));
    const candidateFactIds = (item.candidate_fact_ids ?? []).filter((id) => state.facts.some((fact) => fact.id === id));
    const evidenceSourceIds = [...new Set(state.facts.filter((fact) => acceptedFactIds.includes(fact.id) || candidateFactIds.includes(fact.id)).flatMap((fact) => fact.source_ids))];

    // Only un-superseded exhausted tasks in the CURRENT lineage allow recovery actions
    const unSupersededExhausted = currentResearchTasks.some((t) => t.is_exhausted && t.successor_id === undefined);
    const baseStatus = CELL_STATUS_MAP[item.status] ?? "missing";
    const status: CoverageCenterCellStatus = fresh ? baseStatus : "stale";

    const explanation = explanations.find(
      (exp) => exp.requirement_id === item.requirement_id && exp.character_id === item.character_id,
    );

    const cellScope = {
      ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
      requirement_id: item.requirement_id,
      ...(assessment?.id === undefined ? {} : { assessment_id: assessment.id }),
      ...(assessment?.revision === undefined ? {} : { assessment_revision: assessment.revision }),
    };

    const typedActions = deriveCoverageCellActions(status, eligibility, unSupersededExhausted, cellScope);
    const enabledActions = typedActions.filter((a) => a.enabled).map((a) => a.action);

    const cellReason = explanation?.reason ?? (status === "stale" ? (staleComponents.length > 0 ? `assessment 已過期：${staleComponents.join("、")}` : "assessment 已過期") : item.reason);

    return {
      ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
      requirement_id: item.requirement_id,
      requirement_label: definition?.label ?? item.requirement_id,
      ...(definition?.dimension === undefined ? {} : { dimension_path: definition.dimension }),
      scope: item.character_id === undefined ? "world" : "character",
      status,
      assessment_id: assessment?.id ?? "",
      assessment_revision: assessment?.revision ?? "",
      assessment_stale: !fresh,
      accepted_fact_ids: acceptedFactIds,
      candidate_fact_ids: candidateFactIds,
      evidence_source_ids: evidenceSourceIds,
      resolution_ids: currentResList.map((resolution) => resolution.id),
      research_task_ids: currentResearchTasks.map((task) => task.id),
      current_research_tasks: currentResearchTasks,
      history_research_tasks: historyResearchTasks,
      current_resolutions: currentResolutionRefs,
      history_resolutions: historyResolutionRefs,
      ...(cellReason === undefined ? {} : { reason: cellReason }),
      ...(explanation?.missing_prerequisite === undefined ? {} : { missing_prerequisite: explanation.missing_prerequisite }),
      actions: enabledActions,
      typed_actions: typedActions,
    };
  });

  return {
    ...(requirementSet === undefined ? {} : { requirement_set: { id: requirementSet.id, revision: requirementSet.revision } }),
    ...(assessment === undefined
      ? {}
      : {
          assessment: {
            id: assessment.id,
            revision: assessment.revision,
            pass: assessment.pass,
            fresh,
            current: eligibility.current,
            formal: eligibility.formal,
            requirement_set_current: eligibility.requirement_set_current,
            actionable: eligibility.actionable,
            ...(eligibility.reason_code === undefined ? {} : { eligibility_reason_code: eligibility.reason_code }),
            ...(eligibility.reason === undefined ? {} : { eligibility_reason: eligibility.reason }),
            ...(eligibility.prerequisite === undefined ? {} : { prerequisite: eligibility.prerequisite }),
          },
        }),
    stale_components: staleComponents,
    assessment_eligibility: eligibility,
    assessment_wide_research: wideResearch,
    cells,
  };
}


function taskProjectedStatus(task: ResearchTaskRecord, nowIso: string): string {
  if (task.status === "queued" || task.status === "claimed" || task.status === "running") {
    if (task.lease_expires_at !== undefined && task.lease_expires_at < nowIso) return "lease_expired";
  }
  return task.status;
}

export function deriveResearchMonitor(state: ProjectState, nowIso: string): ResearchMonitor {
  const tasks: ResearchMonitorTaskView[] = state.coverage_research_tasks.map((task) => {
    const successors = state.coverage_research_tasks.filter((other) => other.predecessor_id === task.id).map((other) => other.id);
    const lineage = state.coverage_research_lineages.filter((link) => link.task_id === task.id);
    const candidateSourceIds = [...new Set(lineage.flatMap((link) => [link.candidate_id, link.source_id]).filter((id): id is string => id !== undefined))];
    return {
      id: task.id,
      batch_id: task.batch_id,
      ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
      requirement_ids: [...task.requirement_ids],
      dimension_paths: [...task.dimension_paths],
      query_seeds: [...task.query_seeds],
      ...(task.source_constraints === undefined ? {} : { source_constraints: task.source_constraints }),
      status: task.status,
      projected_status: taskProjectedStatus(task, nowIso),
      ...(task.lease_owner === undefined ? {} : { lease_owner: task.lease_owner }),
      ...(task.lease_expires_at === undefined ? {} : { lease_expires_at: task.lease_expires_at }),
      claim_generation: task.claim_generation,
      attempt: task.attempt,
      searched_queries: [...task.searched_queries],
      source_families: [...task.source_families],
      ...(task.exhausted_reason === undefined ? {} : { exhausted_reason: task.exhausted_reason }),
      ...(task.predecessor_id === undefined ? {} : { predecessor_id: task.predecessor_id }),
      successor_ids: successors,
      candidate_source_ids: candidateSourceIds,
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  });
  const batches: ResearchMonitorBatchView[] = state.coverage_research_batches.map((batch) => {
    const taskIds = state.coverage_research_tasks.filter((task) => task.batch_id === batch.id).map((task) => task.id);
    const summary: Record<string, number> = {};
    for (const task of state.coverage_research_tasks) {
      if (task.batch_id !== batch.id) continue;
      const status = taskProjectedStatus(task, nowIso);
      summary[status] = (summary[status] ?? 0) + 1;
    }
    return {
      id: batch.id,
      assessment_id: batch.assessment_id,
      assessment_revision: batch.assessment_revision,
      requirement_set_id: batch.requirement_set_id,
      requirement_set_revision: batch.requirement_set_revision,
      status: batch.status,
      created_by: batch.created_by,
      created_at: batch.created_at,
      task_ids: taskIds,
      task_status_summary: summary,
    };
  });
  return { batches, tasks };
}

export function coverageAssessmentIsFresh(state: ProjectState): boolean {
  const assessment = state.coverage_assessments.at(-1);
  if (assessment === undefined) return false;
  return coverageAssessmentFreshness(state, assessment);
}
