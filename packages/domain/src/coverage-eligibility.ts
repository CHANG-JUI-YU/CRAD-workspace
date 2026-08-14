import { type ProjectState } from "@st-workspace/core";
import { coverageAssessmentFreshness } from "./coverage-assessment.js";
import { resolveResearchTargets } from "./research-orchestration.js";

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

export interface AssessmentWideResearchProjection {
  enabled: boolean;
  target_count: number;
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

  const targetCount = resolveResearchTargets(latest, undefined).length;
  if (targetCount === 0) {
    return {
      enabled: false,
      target_count: 0,
      disabled_reason: "沒有可研究缺口：目前評估的所有需求均非 missing。",
      prerequisite: "沒有需要研究的需求；如有必要可重新執行 Formal Coverage Assessment",
    };
  }

  return { enabled: true, target_count: targetCount };
}
