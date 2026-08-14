import {
  type CoverageAssessment,
  type CoverageAssessmentItemStatus,
  type CoverageResearchTarget,
  type ProjectState,
} from "@st-workspace/core";
import { coverageAssessmentFreshness } from "./coverage-assessment.js";
import {
  isTaskInAssessmentLineage,
  resolveResearchTargets,
  RESEARCH_IN_FLIGHT_STATUSES,
} from "./research-orchestration.js";

export type CoverageEligibilityReasonCode =
  | "COVERAGE_ASSESSMENT_REQUIRED"
  | "COVERAGE_ASSESSMENT_NOT_CURRENT"
  | "COVERAGE_ASSESSMENT_NOT_FORMAL"
  | "COVERAGE_REQUIREMENT_SET_MISMATCH"
  | "COVERAGE_ASSESSMENT_STALE";

export interface CoverageAssessmentEligibility {
  assessment?: { id: string; revision: string; pass: string };
  current: boolean;
  formal: boolean;
  requirement_set_current: boolean;
  fresh: boolean;
  actionable: boolean;
  reason_code?: CoverageEligibilityReasonCode;
  reason?: string;
  prerequisite?: string;
}

export type CoverageRequirementResearchReasonCode =
  | "ELIGIBLE"
  | "IN_FLIGHT"
  | "NOT_MISSING"
  | "COVERED_BY_SOURCE"
  | "COVERED_BY_USER_SUPPLEMENT"
  | "CREATIVE_COMPLETION_AUTHORIZED"
  | "CANDIDATE_SIGNAL"
  | "CONFLICTED"
  | "ASSESSMENT_NOT_ACTIONABLE"
  | "TARGET_NOT_FOUND";

export interface CoverageRequirementResearchEligibility {
  target: CoverageResearchTarget;
  item_status?: CoverageAssessmentItemStatus;
  eligible: boolean;
  startable: boolean;
  reason_code: CoverageRequirementResearchReasonCode;
  reason: string;
  prerequisite?: string;
  existing_in_flight_task_ids: string[];
}

export interface AssessmentWideResearchProjection {
  enabled: boolean;
  target_count: number;
  in_flight_target_count?: number;
  existing_task_ids?: string[];
  disabled_reason?: string;
  prerequisite?: string;
}

function notActionable(
  assessment: { id: string; revision: string; pass: string } | undefined,
  current: boolean,
  formal: boolean,
  requirementSetCurrent: boolean,
  fresh: boolean,
  reasonCode: CoverageEligibilityReasonCode,
  reason: string,
  prerequisite: string,
): CoverageAssessmentEligibility {
  const eligibility: CoverageAssessmentEligibility = {
    ...(assessment === undefined ? {} : { assessment }),
    current,
    formal,
    requirement_set_current: requirementSetCurrent,
    fresh,
    actionable: false,
    reason_code: reasonCode,
    reason,
    prerequisite,
  };
  return eligibility;
}

export function deriveCoverageAssessmentEligibility(
  state: ProjectState,
  assessmentId?: string,
  assessmentRevision?: string,
): CoverageAssessmentEligibility {
  const latest = state.coverage_assessments.at(-1);

  if (latest === undefined) {
    return notActionable(
      undefined,
      false,
      false,
      false,
      false,
      "COVERAGE_ASSESSMENT_REQUIRED",
      "尚未建立 Coverage Assessment；需要先完成 Fact Review 並執行 Formal Coverage Assessment。",
      "先完成 Fact Review 並執行 Formal Coverage Assessment",
    );
  }

  if (assessmentId !== undefined && latest.id !== assessmentId) {
    return notActionable(
      { id: latest.id, revision: latest.revision, pass: latest.pass },
      false,
      false,
      false,
      false,
      "COVERAGE_ASSESSMENT_NOT_CURRENT",
      "指定的 Coverage Assessment 不是目前的評估；請重新載入 Coverage Center 取得目前評估。",
      "重新載入 Coverage Center 取得目前評估",
    );
  }

  if (assessmentRevision !== undefined && latest.revision !== assessmentRevision) {
    return notActionable(
      { id: latest.id, revision: latest.revision, pass: latest.pass },
      false,
      false,
      false,
      false,
      "COVERAGE_ASSESSMENT_NOT_CURRENT",
      "指定的 Coverage Assessment revision 與目前評估不符；請重新載入 Coverage Center 取得目前評估。",
      "重新載入 Coverage Center 取得目前評估",
    );
  }

  const current = true;
  const formal = latest.pass === "formal";
  const currentReqSet = state.coverage_requirement_sets.at(-1);
  const requirementSetCurrent =
    currentReqSet !== undefined &&
    currentReqSet.id === latest.requirement_set_id &&
    currentReqSet.revision === latest.requirement_set_revision;
  const fresh = coverageAssessmentFreshness(state, latest);

  if (!formal) {
    return notActionable(
      { id: latest.id, revision: latest.revision, pass: latest.pass },
      current,
      false,
      requirementSetCurrent,
      fresh,
      "COVERAGE_ASSESSMENT_NOT_FORMAL",
      "Coverage Assessment 為 initial pass，尚不具備 mutation 資格；需要先完成 Fact Review 並執行 Formal Coverage Assessment。",
      "先完成 Fact Review 並執行 Formal Coverage Assessment",
    );
  }

  if (!requirementSetCurrent) {
    return notActionable(
      { id: latest.id, revision: latest.revision, pass: latest.pass },
      current,
      true,
      false,
      fresh,
      "COVERAGE_REQUIREMENT_SET_MISMATCH",
      "目前 requirement set 與評估使用的版本不一致；需要重新執行 Formal Coverage Assessment。",
      "重新執行 Formal Coverage Assessment",
    );
  }

  if (!fresh) {
    return notActionable(
      { id: latest.id, revision: latest.revision, pass: latest.pass },
      current,
      true,
      true,
      false,
      "COVERAGE_ASSESSMENT_STALE",
      "Coverage Assessment 已過期（輸入：blueprint、sources、facts 或 review run 已變更）；需要重新執行 Formal Coverage Assessment。",
      "重新執行 Formal Coverage Assessment",
    );
  }

  return {
    assessment: { id: latest.id, revision: latest.revision, pass: latest.pass },
    current: true,
    formal: true,
    requirement_set_current: true,
    fresh: true,
    actionable: true,
  };
}

/**
 * Authoritative single requirement research eligibility derivation.
 * Handles missing, candidate_signal, covered_by_source, covered_by_user_supplement,
 * creative_completion_authorized, conflicted, and in-flight research task statuses.
 */
export function deriveRequirementResearchEligibility(
  state: ProjectState,
  assessment: CoverageAssessment,
  target: CoverageResearchTarget,
): CoverageRequirementResearchEligibility {
  const item = assessment.items.find(
    (candidate) =>
      candidate.requirement_id === target.requirement_id &&
      (candidate.character_id ?? "") === (target.character_id ?? ""),
  );

  if (item === undefined) {
    return {
      target,
      eligible: false,
      startable: false,
      reason_code: "TARGET_NOT_FOUND",
      reason: `需求「${target.requirement_id}」不存在於指定評估中。`,
      existing_in_flight_task_ids: [],
    };
  }

  const assessmentEligibility = deriveCoverageAssessmentEligibility(state, assessment.id, assessment.revision);
  if (!assessmentEligibility.actionable) {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "ASSESSMENT_NOT_ACTIONABLE",
      reason: assessmentEligibility.reason ?? "Coverage Assessment 尚不具備研究資格。",
      ...(assessmentEligibility.prerequisite === undefined ? {} : { prerequisite: assessmentEligibility.prerequisite }),
      existing_in_flight_task_ids: [],
    };
  }

  if (item.status === "candidate_signal") {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "CANDIDATE_SIGNAL",
      reason: "需求已有候選事實，應先至 Fact Review 完成事實審查並重新評估。",
      prerequisite: "先完成 Fact Review 並執行 Formal Coverage Assessment",
      existing_in_flight_task_ids: [],
    };
  }

  if (item.status === "covered_by_source") {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "COVERED_BY_SOURCE",
      reason: "需求已由來源事實覆蓋，不需發起研究。",
      existing_in_flight_task_ids: [],
    };
  }

  if (item.status === "covered_by_user_supplement") {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "COVERED_BY_USER_SUPPLEMENT",
      reason: "需求已由使用者補充資料覆蓋，不需發起研究。",
      existing_in_flight_task_ids: [],
    };
  }

  if (item.status === "creative_completion_authorized") {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "CREATIVE_COMPLETION_AUTHORIZED",
      reason: "需求已授權創作補全，不需發起研究。",
      existing_in_flight_task_ids: [],
    };
  }

  if (item.status === "conflicted") {
    return {
      target,
      item_status: item.status,
      eligible: false,
      startable: false,
      reason_code: "CONFLICTED",
      reason: "需求相關事實存在衝突，應先至 Fact Review 解決衝突。",
      prerequisite: "先至 Fact Review 解決事實衝突",
      existing_in_flight_task_ids: [],
    };
  }

  // item.status === "missing"
  const matchingInFlightTasks = state.coverage_research_tasks.filter((task) => {
    if (!RESEARCH_IN_FLIGHT_STATUSES.has(task.status)) return false;
    if ((task.character_id ?? "") !== (target.character_id ?? "")) return false;
    if (!task.requirement_ids.includes(target.requirement_id)) return false;
    const batch = state.coverage_research_batches.find((b) => b.id === task.batch_id);
    return isTaskInAssessmentLineage(task, batch, assessment);
  });

  if (matchingInFlightTasks.length > 0) {
    return {
      target,
      item_status: item.status,
      eligible: true,
      startable: false,
      reason_code: "IN_FLIGHT",
      reason: "需求已有進行中的研究任務，請至 Research Monitor 查看進度。",
      prerequisite: "至 Research Monitor 查看進行中研究任務",
      existing_in_flight_task_ids: matchingInFlightTasks.map((t) => t.id),
    };
  }

  return {
    target,
    item_status: item.status,
    eligible: true,
    startable: true,
    reason_code: "ELIGIBLE",
    reason: "需求尚未覆蓋，可啟動來源研究。",
    existing_in_flight_task_ids: [],
  };
}

export function deriveAssessmentWideResearchProjection(state: ProjectState): AssessmentWideResearchProjection {
  const latest = state.coverage_assessments.at(-1);
  const eligibility = deriveCoverageAssessmentEligibility(state);

  if (!eligibility.actionable || latest === undefined) {
    return {
      enabled: false,
      target_count: 0,
      ...(eligibility.reason === undefined ? {} : { disabled_reason: eligibility.reason }),
      ...(eligibility.prerequisite === undefined ? {} : { prerequisite: eligibility.prerequisite }),
    };
  }

  const missingTargets = resolveResearchTargets(latest, undefined);
  if (missingTargets.length === 0) {
    return {
      enabled: false,
      target_count: 0,
      disabled_reason: "沒有可研究缺口：目前評估的所有需求均非 missing。",
      prerequisite: "沒有需要研究的需求；如有必要可重新執行 Formal Coverage Assessment",
    };
  }

  const inFlightTaskIds: string[] = [];
  let startableCount = 0;
  let inFlightCount = 0;

  for (const target of missingTargets) {
    const targetEligibility = deriveRequirementResearchEligibility(state, latest, target);
    if (targetEligibility.startable) {
      startableCount += 1;
    } else if (targetEligibility.reason_code === "IN_FLIGHT") {
      inFlightCount += 1;
      for (const taskId of targetEligibility.existing_in_flight_task_ids) {
        if (!inFlightTaskIds.includes(taskId)) inFlightTaskIds.push(taskId);
      }
    }
  }

  if (startableCount === 0) {
    return {
      enabled: false,
      target_count: 0,
      in_flight_target_count: inFlightCount,
      existing_task_ids: inFlightTaskIds,
      disabled_reason: "所有缺口項目均已有正在執行的研究任務，確認後將直接重用既有工作。",
      prerequisite: "至 Research Monitor 查看進行中研究任務",
    };
  }

  return {
    enabled: true,
    target_count: startableCount,
    in_flight_target_count: inFlightCount,
    existing_task_ids: inFlightTaskIds,
  };
}
