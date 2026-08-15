import {
  COVERAGE_REQUIREMENT_CATALOG,
  type CoverageCellActionOption,
  type CoverageSupplementLifecycleAttempt,
  type CoverageSupplementLifecycleProjection,
  type CoverageSupplementLifecycleStage,
  type CoverageSupplementStageStatus,
  type ProjectState,
  type ResearchTaskRecord,
} from "@st-workspace/core";
import { coverageAssessmentFreshness, currentResolutions, deriveCoverageRequirementExplanations, isCurrentResolution } from "./coverage-assessment.js";
import { coverageAssessmentStaleComponents } from "./downstream-invalidation.js";
import {
  deriveAssessmentWideResearchProjection,
  deriveCoverageAssessmentEligibility,
  deriveRequirementResearchEligibility,
  type AssessmentWideResearchProjection,
  type CoverageAssessmentEligibility,
  type CoverageRequirementResearchEligibility,
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
  supplement_lifecycle?: CoverageSupplementLifecycleProjection;
  reason?: string;
  missing_prerequisite?: string;
  research_eligibility?: CoverageRequirementResearchEligibility;
  existing_in_flight_task_ids?: string[];
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

export type ResearchTaskOriginKind = "newly_created" | "reused_existing" | "successor_recovery" | "legacy_unknown";

export interface ResearchLineageTaskNode {
  id: string;
  batch_id: string;
  character_id?: string;
  requirement_ids: string[];
  dimension_paths: string[];
  status: string;
  projected_status: string;
  attempt: number;
  claim_generation: number;
  is_in_flight: boolean;
  is_terminal: boolean;
  origin_kind: ResearchTaskOriginKind;
  predecessor_id?: string;
  successor_ids: string[];
  exhausted_reason?: string;
  recovery_action?: string;
  recovery_operation_id?: string;
  candidate_source_ids: string[];
  operation_ids: string[];
  audit_event_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ResearchLineageChain {
  root_task_id: string;
  nodes: ResearchLineageTaskNode[];
}

export interface ResearchRequirementLineage {
  batch_id: string;
  scope: "character" | "world";
  character_id?: string;
  requirement_id: string;
  requirement_label: string;
  chains: ResearchLineageChain[];
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
  is_in_flight: boolean;
  is_terminal: boolean;
  origin_kind: ResearchTaskOriginKind;
  recovery_action?: string;
  recovery_operation_id?: string;
  operation_ids: string[];
  audit_event_ids: string[];
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
  lineages: ResearchRequirementLineage[];
}

const CELL_STATUS_MAP: Readonly<Record<string, CoverageCenterCellStatus>> = {
  missing: "missing",
  candidate_signal: "candidate_signal",
  covered_by_source: "source_covered",
  covered_by_user_supplement: "supplement",
  creative_completion_authorized: "creative_completion",
  conflicted: "conflict",
};

export function deriveSupplementLifecycleProjection(
  state: ProjectState,
  requirementId: string,
  characterId?: string,
): CoverageSupplementLifecycleProjection | undefined {
  const reqSet = state.coverage_requirement_sets.at(-1);
  const currentReqSetRevision = reqSet?.revision;
  const assessment = state.coverage_assessments.at(-1);

  const allResolutions = state.coverage_resolutions.filter(
    (r) => r.requirement_id === requirementId && (r.character_id ?? undefined) === (characterId ?? undefined) && r.mode === "user_supplement",
  );

  const relatedOps = state.operations.filter((op) => {
    if (op.command?.type === "coverage_supplement") {
      const p = op.command.payload as Record<string, unknown> | undefined;
      if (p?.requirement_id === requirementId && (p?.character_id ?? undefined) === (characterId ?? undefined)) {
        return true;
      }
    }
    return false;
  });

  if (allResolutions.length === 0 && relatedOps.length === 0) {
    return undefined;
  }

  const currentResList = currentResolutions(state, {
    requirementSetRevision: currentReqSetRevision,
    requirementId,
    characterId,
  }).filter((r) => r.mode === "user_supplement");

  const currentRes = currentResList.at(-1);
  const isFulfilled = currentRes?.status === "fulfilled";
  const hasPending = currentRes?.status === "pending";

  const attempts: CoverageSupplementLifecycleAttempt[] = [];

  for (const op of relatedOps) {
    const opAudit = state.audit.filter((a) => a.operation_id === op.id);
    const opSourceId = (opAudit.find((a) => a.event === "coverage.supplement.provided" || a.event === "coverage.supplement.ingested")?.details?.source_id as string | undefined);
    const opSource = opSourceId ? state.sources.find((s) => s.id === opSourceId) : undefined;
    const opSourceRefs = opSource ? [{ source_id: opSource.id, revision: opSource.revision }] : [];
    const opChunks = opSourceId ? state.knowledge_chunks.filter((c) => c.source_id === opSourceId).map((c) => c.id) : [];
    const opRes = allResolutions.find((r) => r.operation_id === op.id || (r.source_refs ?? []).some((sr) => sr.source_id === opSourceId));

    let attStage: CoverageSupplementLifecycleStage = "failed";
    let attStageStatus: CoverageSupplementStageStatus = "failed";

    if (op.status === "failed") {
      attStage = "failed";
      attStageStatus = "failed";
    } else if (opRes?.status === "fulfilled") {
      attStage = "resolution_fulfilled";
      attStageStatus = "completed";
    } else if (opChunks.length > 0) {
      attStage = "source_chunks_ready";
      attStageStatus = "completed";
    } else if (opSource !== undefined) {
      attStage = "evidence_received";
      attStageStatus = "completed";
    } else if (opRes?.status === "pending") {
      attStage = "authorized";
      attStageStatus = "completed";
    }

    const reviewRunIds = [...new Set(state.facts.filter((f) => opSourceId && f.source_ids.includes(opSourceId) && f.review_run_id).map((f) => f.review_run_id!))];
    const factRefs = (opRes?.fact_refs ?? []);

    attempts.push({
      attempt_id: op.id,
      operation_id: op.id,
      status: op.status,
      stage: attStage,
      stage_status: attStageStatus,
      authorization_saved: opRes !== undefined || (op.status === "failed" && allResolutions.some((r) => r.requirement_id === requirementId && isCurrentResolution(state, r, currentReqSetRevision))),
      ...(opRes?.user_decision_id === undefined ? {} : { decision_id: opRes.user_decision_id }),
      ...(opRes?.status === "pending" ? { current_resolution_id: opRes.id } : {}),
      ...(opRes?.status === "fulfilled" ? { fulfilled_resolution_id: opRes.id } : {}),
      source_refs: opSourceRefs.length > 0 ? opSourceRefs : (opRes?.source_refs ?? []),
      chunk_ids: opChunks,
      review_run_ids: reviewRunIds,
      fact_refs: factRefs,
      ...(op.status === "failed" ? { failure_message: op.result_summary ?? "補件操作失敗" } : {}),
      created_at: op.created_at,
      updated_at: op.updated_at,
    });
  }

  const latestOp = relatedOps.at(-1);
  const currentAttempt = attempts.find((a) => a.operation_id === latestOp?.id) ?? attempts.at(-1);
  const historicalAttempts = attempts.filter((a) => a.attempt_id !== currentAttempt?.attempt_id);

  let stage: CoverageSupplementLifecycleStage = "authorized";
  let stageStatus: CoverageSupplementStageStatus = "in_progress";
  let nextAction = "提供補充資料";
  let requiresAttention = false;

  const assessmentItem = assessment?.items.find((it) => it.requirement_id === requirementId && (it.character_id ?? undefined) === (characterId ?? undefined));

  const authResolution = allResolutions.find((r) => isCurrentResolution(state, r, currentReqSetRevision) && (!r.supersedes || state.coverage_user_decisions.some((d) => d.id === r.user_decision_id)));
  const authSaved = authResolution !== undefined || allResolutions.some((r) => isCurrentResolution(state, r, currentReqSetRevision));

  const boundSources = (currentRes?.source_refs ?? []);
  const boundSourceIds = boundSources.map((s) => s.source_id);
  const boundChunks = state.knowledge_chunks.filter((c) => boundSourceIds.includes(c.source_id));
  const candidateFacts = state.facts.filter((f) => f.source_ids.some((id) => boundSourceIds.includes(id)) && (f.suggested_coverage_targets ?? []).includes(requirementId));
  const acceptedFacts = state.facts.filter((f) => f.source_ids.some((id) => boundSourceIds.includes(id)) && f.status === "accepted" && (f.coverage_targets ?? []).includes(requirementId));
  const reviewRuns = state.fact_review_runs.filter((r) => r.source_revisions.some((sr) => boundSourceIds.includes(sr.source_id)));

  const latestFailedOp = relatedOps.slice().reverse().find((op) => op.status === "failed");
  const isFailed = latestFailedOp !== undefined && (latestOp?.id === latestFailedOp.id || !currentRes);

  if (isFulfilled) {
    if (assessmentItem?.status === "covered_by_user_supplement" && (assessmentItem.resolution_ids ?? []).includes(currentRes.id)) {
      stage = "reassessed";
      stageStatus = "completed";
      nextAction = "檢視細節與 Provenance";
      requiresAttention = false;
    } else {
      stage = "reassessment_required";
      stageStatus = "completed";
      nextAction = "重新執行 Formal Assessment";
      requiresAttention = true;
    }
  } else if (isFailed) {
    stage = "failed";
    stageStatus = "failed";
    requiresAttention = true;
    nextAction = authSaved ? "繼續補件（重新提交證據）" : "重新提供補充資料";
  } else if (acceptedFacts.length > 0) {
    stage = "accepted_facts";
    stageStatus = "in_progress";
    nextAction = "等待 Fact Review 結案自動 fulfillment";
    requiresAttention = false;
  } else if (reviewRuns.length > 0 || candidateFacts.length > 0) {
    stage = "fact_review";
    stageStatus = "in_progress";
    nextAction = "至 Fact Review 進行事實裁決";
    requiresAttention = false;
  } else if (boundChunks.length > 0) {
    stage = "source_chunks_ready";
    stageStatus = "completed";
    nextAction = "至 Fact Curation / Fact Review 觀看分片並進行事實提煉";
    requiresAttention = false;
  } else if (boundSources.length > 0) {
    stage = "evidence_received";
    stageStatus = "completed";
    nextAction = "準備來源分片";
    requiresAttention = false;
  } else if (hasPending) {
    stage = "authorized";
    stageStatus = "in_progress";
    nextAction = "繼續補件（上傳補充資料證據）";
    requiresAttention = true;
  }

  const allOpIds = [...new Set(relatedOps.map((op) => op.id))];
  const allSourceRefs = currentRes?.source_refs ?? (boundSources.length > 0 ? boundSources : []);
  const allReviewRunIds = [...new Set(reviewRuns.map((r) => r.id))];
  const allFactRefs = currentRes?.fact_refs ?? [];

  return {
    requirement_id: requirementId,
    ...(characterId === undefined ? {} : { character_id: characterId }),
    scope: characterId === undefined ? "world" : "character",
    stage,
    stage_status: stageStatus,
    next_action: nextAction,
    requires_attention: requiresAttention,
    authorization_saved: authSaved,
    ...(currentRes?.user_decision_id === undefined ? {} : { decision_id: currentRes.user_decision_id }),
    ...(authResolution?.id === undefined ? {} : { authorization_resolution_id: authResolution.id }),
    ...(currentRes?.id === undefined ? {} : { current_resolution_id: currentRes.id }),
    ...(isFulfilled ? { fulfilled_resolution_id: currentRes.id } : {}),
    operation_ids: allOpIds,
    source_refs: allSourceRefs,
    review_run_ids: allReviewRunIds,
    fact_refs: allFactRefs,
    ...(isFailed && latestFailedOp ? { failure_message: latestFailedOp.result_summary ?? "補件操作失敗" } : {}),
    ...(currentAttempt === undefined ? {} : { current_attempt: currentAttempt }),
    historical_attempts: historicalAttempts,
  };
}

export function deriveCoverageCellActions(
  cellStatus: CoverageCenterCellStatus,
  eligibility: CoverageAssessmentEligibility,
  exhausted: boolean,
  scope: { character_id?: string; requirement_id: string; assessment_id?: string; assessment_revision?: string },
  inFlightTaskIds: string[] = [],
  supplementLifecycle?: CoverageSupplementLifecycleProjection,
): CoverageCellActionOption[] {
  const options: CoverageCellActionOption[] = [];

  const hasPendingSupplement = supplementLifecycle !== undefined && supplementLifecycle.current_resolution_id !== undefined && (
    supplementLifecycle.stage !== "reassessed" &&
    supplementLifecycle.stage !== "reassessment_required" &&
    supplementLifecycle.stage !== "resolution_fulfilled"
  );
  const supplementLabel = hasPendingSupplement ? "繼續補件" : "提供補充資料";
  const supplementResolutionId = supplementLifecycle?.current_resolution_id;

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
      label: supplementLabel,
      enabled: false,
      disabled_reason: reasonText,
      ...(supplementResolutionId === undefined ? {} : { target_resolution_id: supplementResolutionId }),
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
      label: supplementLabel,
      enabled: false,
      disabled_reason: "需求已解決，若要重新變更請由 Detail 面板或重新評估進程操作",
      ...(supplementResolutionId === undefined ? {} : { target_resolution_id: supplementResolutionId }),
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

  if (supplementLifecycle?.stage === "reassessment_required") {
    options.push({
      action: "reassess",
      label: "重新執行 Formal Assessment",
      enabled: true,
      prerequisite: { action: "reassess", target_panel: "coverage" },
      scope,
    });
    options.push({
      action: "supplement",
      label: "已完成補件 (待重新評估)",
      enabled: false,
      disabled_reason: "已完成補充資料 fulfillment，請重新執行 Formal Assessment",
      scope,
    });
    return options;
  }

  if (inFlightTaskIds.length > 0) {
    const primaryTaskId = inFlightTaskIds[0]!;
    options.push({
      action: "view_research_task",
      label: "查看進行中研究",
      enabled: true,
      target_task_id: primaryTaskId,
      prerequisite: { action: "view_task", target_panel: "research-monitor", target_id: primaryTaskId },
      scope,
    });
    options.push({ action: "supplement", label: supplementLabel, enabled: true, ...(supplementResolutionId === undefined ? {} : { target_resolution_id: supplementResolutionId }), scope });
    options.push({ action: "creative_completion", label: "授權創作補全", enabled: true, scope });
    return options;
  }

  if (exhausted) {
    options.push({ action: "revise_query", label: "修改查詢", enabled: true, scope });
    options.push({ action: "revise_constraints", label: "修改來源限制", enabled: true, scope });
    options.push({ action: "manual_url", label: "手動提供 URL", enabled: true, scope });
    options.push({ action: "supplement", label: supplementLabel, enabled: true, ...(supplementResolutionId === undefined ? {} : { target_resolution_id: supplementResolutionId }), scope });
    options.push({ action: "creative_completion", label: "授權創作補全", enabled: true, scope });
  } else {
    options.push({ action: "research", label: "來源研究", enabled: true, scope });
    options.push({ action: "supplement", label: supplementLabel, enabled: true, ...(supplementResolutionId === undefined ? {} : { target_resolution_id: supplementResolutionId }), scope });
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

    const inFlightTasks = currentResearchTasks.filter((t) => t.is_active);
    const inFlightTaskIds = inFlightTasks.map((t) => t.id);

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

    const supplementLifecycle = deriveSupplementLifecycleProjection(state, item.requirement_id, item.character_id);
    const typedActions = deriveCoverageCellActions(status, eligibility, unSupersededExhausted, cellScope, inFlightTaskIds, supplementLifecycle);
    const enabledActions = typedActions.filter((a) => a.enabled).map((a) => a.action);

    const researchEligibility =
      assessment === undefined
        ? undefined
        : deriveRequirementResearchEligibility(state, assessment, {
            requirement_id: item.requirement_id,
            ...(item.character_id === undefined ? {} : { character_id: item.character_id }),
          });

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
      ...(supplementLifecycle === undefined ? {} : { supplement_lifecycle: supplementLifecycle }),
      ...(cellReason === undefined ? {} : { reason: cellReason }),
      ...(explanation?.missing_prerequisite === undefined ? {} : { missing_prerequisite: explanation.missing_prerequisite }),
      ...(researchEligibility === undefined ? {} : { research_eligibility: researchEligibility }),
      existing_in_flight_task_ids: inFlightTaskIds,
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
  const startedAudits = state.audit.filter((a) => a.event === "coverage.research.started");
  const recoveredAudits = state.audit.filter((a) => a.event === "coverage.research.recovered");

  const taskRecoveryInfoMap = new Map<string, { action?: string; successor_id?: string; predecessor_id?: string; operation_id?: string }>();
  for (const a of recoveredAudits) {
    const d = a.details as Record<string, unknown> | undefined;
    const predTaskId = typeof d?.task_id === "string" ? d.task_id : undefined;
    const succTaskId = typeof d?.successor_task_id === "string" ? d.successor_task_id : undefined;
    const action = typeof d?.action === "string" ? d.action : undefined;
    const opId = a.operation_id;

    if (predTaskId !== undefined) {
      taskRecoveryInfoMap.set(predTaskId, {
        ...(action === undefined ? {} : { action }),
        ...(succTaskId === undefined ? {} : { successor_id: succTaskId }),
        ...(opId === undefined ? {} : { operation_id: opId }),
      });
    }
    if (succTaskId !== undefined) {
      taskRecoveryInfoMap.set(succTaskId, {
        ...(action === undefined ? {} : { action }),
        ...(predTaskId === undefined ? {} : { predecessor_id: predTaskId }),
        ...(opId === undefined ? {} : { operation_id: opId }),
      });
    }
  }

  const tasks: ResearchMonitorTaskView[] = state.coverage_research_tasks.map((task) => {
    const successors = state.coverage_research_tasks.filter((other) => other.predecessor_id === task.id).map((other) => other.id);
    const lineage = state.coverage_research_lineages.filter((link) => link.task_id === task.id);
    const candidateSourceIds = [...new Set(lineage.flatMap((link) => [link.candidate_id, link.source_id]).filter((id): id is string => id !== undefined))];

    const projected = taskProjectedStatus(task, nowIso);

    // Terminal status: completed, exhausted, failed, stale, cancelled, or superseded by a successor
    const isTerminal =
      task.status === "completed" ||
      task.status === "exhausted" ||
      task.status === "failed" ||
      task.status === "stale" ||
      task.status === "cancelled" ||
      successors.length > 0;

    const isInFlight = !isTerminal && (
      task.status === "queued" ||
      task.status === "claimed" ||
      task.status === "running" ||
      projected === "lease_expired"
    );

    // Origin kind derived from audit evidence
    let originKind: ResearchTaskOriginKind = "legacy_unknown";
    const recInfo = taskRecoveryInfoMap.get(task.id);
    const hasRecoveredAudit = recoveredAudits.some((a) => {
      const d = a.details as Record<string, unknown> | undefined;
      return d?.successor_task_id === task.id || (task.predecessor_id !== undefined && d?.task_id === task.predecessor_id);
    });

    if (hasRecoveredAudit || (task.predecessor_id !== undefined && recInfo?.action !== undefined)) {
      originKind = "successor_recovery";
    } else {
      let matchedStarted = false;
      for (const a of startedAudits) {
        const d = a.details as Record<string, unknown> | undefined;
        const taskIds = Array.isArray(d?.task_ids) ? (d?.task_ids as string[]) : [];
        const existingTaskIds = Array.isArray(d?.existing_task_ids) ? (d?.existing_task_ids as string[]) : [];
        const isReused = d?.reused === true;

        if (existingTaskIds.includes(task.id) || (isReused && taskIds.includes(task.id))) {
          originKind = "reused_existing";
          matchedStarted = true;
          break;
        } else if (taskIds.includes(task.id)) {
          originKind = "newly_created";
          matchedStarted = true;
          break;
        }
      }
      if (!matchedStarted) {
        originKind = "legacy_unknown";
      }
    }

    const opIds = new Set<string>();
    const auditIds = new Set<string>();

    for (const a of state.audit) {
      const d = a.details as Record<string, unknown> | undefined;
      const isRelated =
        d?.task_id === task.id ||
        d?.successor_task_id === task.id ||
        (Array.isArray(d?.task_ids) && (d.task_ids as string[]).includes(task.id)) ||
        (Array.isArray(d?.existing_task_ids) && (d.existing_task_ids as string[]).includes(task.id));

      if (isRelated) {
        if (a.id) auditIds.add(a.id);
        if (a.operation_id) opIds.add(a.operation_id);
      }
    }

    for (const op of state.operations) {
      const p = op.command?.payload as Record<string, unknown> | undefined;
      if (p?.task_id === task.id || p?.successor_task_id === task.id || (Array.isArray(p?.task_ids) && (p.task_ids as string[]).includes(task.id))) {
        opIds.add(op.id);
      }
    }

    const recoveryAction = recInfo?.action;
    const recoveryOpId = recInfo?.operation_id;

    return {
      id: task.id,
      batch_id: task.batch_id,
      ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
      requirement_ids: [...task.requirement_ids],
      dimension_paths: [...task.dimension_paths],
      query_seeds: [...task.query_seeds],
      ...(task.source_constraints === undefined ? {} : { source_constraints: task.source_constraints }),
      status: task.status,
      projected_status: projected,
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
      is_in_flight: isInFlight,
      is_terminal: isTerminal,
      origin_kind: originKind,
      ...(recoveryAction === undefined ? {} : { recovery_action: recoveryAction }),
      ...(recoveryOpId === undefined ? {} : { recovery_operation_id: recoveryOpId }),
      operation_ids: [...opIds],
      audit_event_ids: [...auditIds],
      created_at: task.created_at,
      updated_at: task.updated_at,
    };
  });

  const taskMap = new Map<string, ResearchMonitorTaskView>();
  for (const t of tasks) taskMap.set(t.id, t);

  const requirementCatalogMap = new Map<string, string>();
  for (const def of COVERAGE_REQUIREMENT_CATALOG) {
    requirementCatalogMap.set(def.id, def.label);
  }

  const lineageMap = new Map<string, {
    batch_id: string;
    scope: "character" | "world";
    character_id?: string;
    requirement_id: string;
    requirement_label: string;
    tasks: ResearchMonitorTaskView[];
  }>();

  for (const task of tasks) {
    const scope = task.character_id ? "character" : "world";
    for (const reqId of task.requirement_ids) {
      const key = `${task.batch_id}__${task.character_id ?? "world"}__${reqId}`;
      let entry = lineageMap.get(key);
      if (entry === undefined) {
        entry = {
          batch_id: task.batch_id,
          scope,
          ...(task.character_id === undefined ? {} : { character_id: task.character_id }),
          requirement_id: reqId,
          requirement_label: requirementCatalogMap.get(reqId) ?? reqId,
          tasks: [],
        };
        lineageMap.set(key, entry);
      }
      entry.tasks.push(task);
    }
  }

  const lineages: ResearchRequirementLineage[] = Array.from(lineageMap.values()).map((entry) => {
    const entryTaskIds = new Set(entry.tasks.map((t) => t.id));
    const rootTasks = entry.tasks.filter((t) => !t.predecessor_id || !entryTaskIds.has(t.predecessor_id));

    const chains: ResearchLineageChain[] = rootTasks.map((root) => {
      const chainNodes: ResearchLineageTaskNode[] = [];
      const visited = new Set<string>();
      let current: ResearchMonitorTaskView | undefined = root;

      while (current !== undefined && !visited.has(current.id)) {
        visited.add(current.id);
        const node: ResearchLineageTaskNode = {
          id: current.id,
          batch_id: current.batch_id,
          ...(current.character_id === undefined ? {} : { character_id: current.character_id }),
          requirement_ids: current.requirement_ids,
          dimension_paths: current.dimension_paths,
          status: current.status,
          projected_status: current.projected_status,
          attempt: current.attempt,
          claim_generation: current.claim_generation,
          is_in_flight: current.is_in_flight,
          is_terminal: current.is_terminal,
          origin_kind: current.origin_kind,
          ...(current.predecessor_id === undefined ? {} : { predecessor_id: current.predecessor_id }),
          successor_ids: current.successor_ids,
          ...(current.exhausted_reason === undefined ? {} : { exhausted_reason: current.exhausted_reason }),
          ...(current.recovery_action === undefined ? {} : { recovery_action: current.recovery_action }),
          ...(current.recovery_operation_id === undefined ? {} : { recovery_operation_id: current.recovery_operation_id }),
          candidate_source_ids: current.candidate_source_ids,
          operation_ids: current.operation_ids,
          audit_event_ids: current.audit_event_ids,
          created_at: current.created_at,
          updated_at: current.updated_at,
        };
        chainNodes.push(node);

        const nextId: string | undefined = current.successor_ids.find((succId) => entryTaskIds.has(succId));
        current = nextId !== undefined ? taskMap.get(nextId) : undefined;
      }

      return {
        root_task_id: root.id,
        nodes: chainNodes,
      };
    });

    return {
      batch_id: entry.batch_id,
      scope: entry.scope,
      ...(entry.character_id === undefined ? {} : { character_id: entry.character_id }),
      requirement_id: entry.requirement_id,
      requirement_label: entry.requirement_label,
      chains,
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

  return { batches, tasks, lineages };
}

export function coverageAssessmentIsFresh(state: ProjectState): boolean {
  const assessment = state.coverage_assessments.at(-1);
  if (assessment === undefined) return false;
  return coverageAssessmentFreshness(state, assessment);
}
