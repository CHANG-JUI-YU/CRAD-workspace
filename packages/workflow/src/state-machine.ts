import { workflowStateSchema, type WorkflowStage, type WorkflowState } from "@card-workspace/schemas";

import { artifactsRequiredBeforeStage, gateRequiredBeforeStage, getNextStage } from "./definitions.js";
import { workflowFail } from "./errors.js";

export interface TransitionDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  overridable?: boolean;
}

export interface AdvanceStageEvent {
  kind: "stage.advance";
  expectedRevision: number;
  target: WorkflowStage;
  actor: string;
  actorCapabilities: readonly string[];
  diagnostics?: readonly TransitionDiagnostic[];
}

const unfinishedTaskStatuses = new Set(["pending", "claimed", "failed", "retryable", "needs_user_decision"]);

export function advanceWorkflow(state: WorkflowState, event: AdvanceStageEvent): WorkflowState {
  if (event.expectedRevision !== state.revision) {
    workflowFail("WORKFLOW_REVISION_CONFLICT", `預期 workflow revision ${event.expectedRevision}，實際 ${state.revision}`);
  }
  const nextStage = getNextStage(state.stage);
  if (nextStage === undefined) workflowFail("WORKFLOW_ALREADY_PUBLISHED", "published workflow 不可再次推進");
  if (event.target !== nextStage) workflowFail("WORKFLOW_STAGE_ORDER_INVALID", `只能從 ${state.stage} 推進至 ${nextStage}`);
  if (!event.actorCapabilities.includes("workflow.advance")) {
    workflowFail("WORKFLOW_CAPABILITY_DENIED", `${event.actor} 不具 workflow.advance capability`);
  }
  const unfinished = state.tasks.find((task) => unfinishedTaskStatuses.has(task.status));
  if (unfinished !== undefined) workflowFail("WORKFLOW_TASKS_INCOMPLETE", `task ${unfinished.id} 尚未完成或 supersede`);

  const gateId = gateRequiredBeforeStage(event.target);
  if (gateId !== undefined) {
    const gate = state.gates.find((candidate) => candidate.id === gateId);
    if (gate === undefined || !["approved", "not_required"].includes(gate.status)) {
      workflowFail("WORKFLOW_GATE_BLOCKED", `${gateId} gate 尚未通過`);
    }
  }
  for (const artifactId of artifactsRequiredBeforeStage(event.target)) {
    const artifact = state.artifacts.find((candidate) => candidate.id === artifactId);
    if (artifact?.revision === undefined || ["missing", "stale"].includes(artifact.status)) {
      workflowFail("WORKFLOW_ARTIFACT_MISSING", `缺少有效 artifact：${artifactId}`);
    }
  }
  const blocking = event.diagnostics?.find((diagnostic) => diagnostic.severity === "error" && diagnostic.overridable !== true);
  if (blocking !== undefined) workflowFail("WORKFLOW_DIAGNOSTIC_BLOCKED", `不可覆寫 diagnostic：${blocking.code}`);

  return workflowStateSchema.parse({ ...state, stage: event.target, revision: state.revision + 1 });
}
