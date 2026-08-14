import type { WorkflowDiagnostic } from "./workflow-gate.js";

export type PublishDiagnosticAffectedKind = "artifact" | "fact" | "source" | "coverage_cell" | "review_run" | "build";

export interface PublishDiagnosticAffected {
  kind: PublishDiagnosticAffectedKind;
  id?: string;
  character_id?: string;
  requirement_id?: string;
}

export interface PublishDiagnosticTarget {
  panel: string;
  kind?: PublishDiagnosticAffectedKind;
  id?: string;
  character_id?: string;
  requirement_id?: string;
}

export interface PublishDiagnosticRow {
  code: string;
  severity: "error" | "warning";
  message: string;
  affected: PublishDiagnosticAffected[];
  next_action: string;
  targets?: PublishDiagnosticTarget[];
  target?: PublishDiagnosticTarget;
}

export interface StructuredPublishDiagnostics {
  rows: PublishDiagnosticRow[];
  has_unknown: boolean;
}

interface DiagnosticMapping {
  affectedKind: PublishDiagnosticAffectedKind;
  panel: string;
  nextAction: string;
}

const DIAGNOSTIC_MAPPING: Readonly<Record<string, DiagnosticMapping>> = {
  SOURCE_RESEARCH_NOT_INGESTED: { affectedKind: "source", panel: "sources", nextAction: "返回來源清單，選擇要研究的來源" },
  SOURCE_RESEARCH_OFFICIAL_REQUIRED: { affectedKind: "source", panel: "sources", nextAction: "在來源清單補上官方來源" },
  SOURCE_DOMAIN_NOT_ALLOWED: { affectedKind: "source", panel: "sources", nextAction: "在來源清單移除不允許的網域來源" },
  ARTIFACT_REFERENCE_MISSING: { affectedKind: "artifact", panel: "artifacts", nextAction: "在 Artifact 面板補齊遺失的產物" },
  ARTIFACT_REVIEW_REQUIRED: { affectedKind: "artifact", panel: "artifacts", nextAction: "在 Artifact 面板對受影響產物執行 Review" },
  PUBLISH_BLOCKING_ISSUES: { affectedKind: "artifact", panel: "quality", nextAction: "在 Quality 面板處理阻斷問題或覆蓋" },
  FACT_SOURCE_MISSING: { affectedKind: "fact", panel: "facts", nextAction: "在 Fact 清單補上來源引用" },
  FACT_PROVENANCE_MISSING: { affectedKind: "fact", panel: "facts", nextAction: "在 Fact 清單補上來源出處" },
  FACT_REVIEW_CONTRADICTION: { affectedKind: "fact", panel: "fact-review", nextAction: "在 Fact Review 解決矛盾裁決" },
  FACT_REVIEW_RUN_MISSING: { affectedKind: "review_run", panel: "fact-review", nextAction: "建立 Fact Review Run 並裁決候選事實" },
  FACT_REVIEW_COVERAGE_INCOMPLETE: { affectedKind: "coverage_cell", panel: "coverage", nextAction: "在 Coverage Center 補齊未覆蓋的需求" },
  FACT_REVIEW_NEEDS_EVIDENCE: { affectedKind: "fact", panel: "facts", nextAction: "在 Fact 清單補齊證據引用" },
  FACT_REVIEW_CONFLICT: { affectedKind: "fact", panel: "fact-review", nextAction: "在 Fact Review 解決衝突裁決" },
  FACT_REVIEW_RUN_INCOMPLETE: { affectedKind: "review_run", panel: "fact-review", nextAction: "完成 Fact Review Run 的全部裁決" },
  FACT_REVIEW_SOURCE_STALE: { affectedKind: "source", panel: "fact-review", nextAction: "來源已變更，重新建立 Fact Review Run" },
  FACT_REVIEW_DECISION_MISSING: { affectedKind: "fact", panel: "fact-review", nextAction: "在 Fact Review 對候選事實做出裁決" },
  FACT_COVERAGE_INCOMPLETE: { affectedKind: "coverage_cell", panel: "coverage", nextAction: "在 Coverage Center 補齊未覆蓋的需求" },
  BLUEPRINT_PRECHECK_REQUIRED: { affectedKind: "artifact", panel: "precheck", nextAction: "在 Precheck 面板確認 Blueprint 預檢" },
  INTERVIEW_REQUIRED: { affectedKind: "artifact", panel: "interview", nextAction: "完成訪談以建立 Blueprint" },
  PUBLISH_NO_CONTENT: { affectedKind: "build", panel: "readiness", nextAction: "先建立產物內容再發布" },
  BLUEPRINT_BINDING_STALE: { affectedKind: "artifact", panel: "artifacts", nextAction: "重新 authoring 受影響產物以更新 Blueprint binding" },
  ARTIFACT_DEPENDENCY_STALE: { affectedKind: "artifact", panel: "artifacts", nextAction: "重新 authoring 受影響產物以更新依賴 fingerprint" },
  COVERAGE_FACT_REVIEW_REQUIRED: { affectedKind: "review_run", panel: "fact-review", nextAction: "先完成 Fact Review 再執行覆蓋評估" },
  COVERAGE_ASSESSMENT_STALE: { affectedKind: "coverage_cell", panel: "coverage", nextAction: "重新執行 formal coverage assessment" },
  COVERAGE_RESOLUTION_REQUIRED: { affectedKind: "coverage_cell", panel: "coverage", nextAction: "在 Coverage Center 解決未完成的覆蓋需求" },
  COVERAGE_AUTHORING_BINDING_MISSING: { affectedKind: "artifact", panel: "artifacts", nextAction: "重新 authoring 受影響產物以建立 coverage binding" },
  COVERAGE_AUTHORING_BINDING_STALE: { affectedKind: "artifact", panel: "artifacts", nextAction: "重新 authoring 受影響產物以更新 coverage binding" },
  COVERAGE_AUTHORING_BINDING_DUPLICATE: { affectedKind: "artifact", panel: "artifacts", nextAction: "檢查並清理重複的 coverage binding 記錄" },
  COVERAGE_PUBLISH_SNAPSHOT_STALE: { affectedKind: "build", panel: "readiness", nextAction: "重新執行 Preview/Build 以更新 coverage snapshot" },
  MODE_SELECTION_REQUIRED: { affectedKind: "build", panel: "readiness", nextAction: "選擇打包模式（zhuji 或 palette）再檢查就緒狀態" },
};

export function deriveStructuredPublishDiagnostics(diagnostics: readonly WorkflowDiagnostic[]): StructuredPublishDiagnostics {
  const rows: PublishDiagnosticRow[] = [];
  let hasUnknown = false;
  for (const diagnostic of diagnostics) {
    const mapping = DIAGNOSTIC_MAPPING[diagnostic.code];
    if (mapping === undefined) {
      hasUnknown = true;
      rows.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        affected: [],
        next_action: "在 Readiness 面板檢視診斷",
        targets: [{ panel: "readiness" }],
        target: { panel: "readiness" },
      });
      continue;
    }
    const coverageRefs = diagnostic.coverage_refs ?? [];
    if (coverageRefs.length > 0) {
      const affected: PublishDiagnosticAffected[] = coverageRefs.map((ref) => (
        ref.character_id === undefined
          ? { kind: "coverage_cell", requirement_id: ref.requirement_id }
          : { kind: "coverage_cell", character_id: ref.character_id, requirement_id: ref.requirement_id }
      ));
      const targets: PublishDiagnosticTarget[] = coverageRefs.map((ref) => (
        ref.character_id === undefined
          ? { panel: mapping.panel, kind: "coverage_cell", requirement_id: ref.requirement_id }
          : { panel: mapping.panel, kind: "coverage_cell", character_id: ref.character_id, requirement_id: ref.requirement_id }
      ));
      rows.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        affected,
        next_action: mapping.nextAction,
        targets,
        ...(targets[0] === undefined ? {} : { target: targets[0] }),
      });
      continue;
    }
    const ids = diagnostic.artifact_ids ?? diagnostic.fact_ids ?? diagnostic.source_ids ?? [];
    const objectKind: PublishDiagnosticAffectedKind = mapping.affectedKind === "coverage_cell" ? "fact" : mapping.affectedKind;
    const affected: PublishDiagnosticAffected[] = ids.map((id) => ({ kind: objectKind, id }));
    const targets: PublishDiagnosticTarget[] = ids.map((id) => ({ panel: mapping.panel, kind: objectKind, id }));
    rows.push({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      affected,
      next_action: mapping.nextAction,
      ...(targets.length === 0
        ? { targets: [{ panel: mapping.panel }] }
        : { targets }),
      ...(targets[0] === undefined ? { target: { panel: mapping.panel } } : { target: targets[0] }),
    });
  }
  return { rows, has_unknown: hasUnknown };
}
