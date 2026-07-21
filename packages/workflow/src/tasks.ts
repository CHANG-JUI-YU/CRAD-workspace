import {
  taskClarificationSchema,
  workflowTaskSchema,
  type ArtifactReference,
  type TaskClarificationOption,
  type WorkflowTask,
} from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";
import { assertValidLease, leaseIsExpired, systemClock, type Clock } from "./leases.js";
import { revisionFailureStatus } from "./retry.js";

export interface ClaimTaskOptions {
  owner: string;
  leaseId: string;
  leaseDurationMs: number;
  completedTaskIds: ReadonlySet<string>;
  clock?: Clock;
}

export interface TaskSubmission {
  taskId: string;
  leaseId: string;
  owner: string;
  result: ArtifactReference;
}

export function claimTask(task: WorkflowTask, options: ClaimTaskOptions): WorkflowTask {
  const clock = options.clock ?? systemClock;
  if (task.dependencies.some((id) => !options.completedTaskIds.has(id))) workflowFail("TASK_DEPENDENCY_BLOCKED", `task ${task.id} dependencies 尚未完成`);
  const reclaim = task.status === "claimed" && leaseIsExpired(task, clock);
  if (!["pending", "retryable"].includes(task.status) && !reclaim) workflowFail("TASK_NOT_CLAIMABLE", `task ${task.id} 狀態 ${task.status} 不可 claim`);
  // Lease handoff and an expired final lease resume persisted work; neither is another failed attempt.
  const resumeWithoutAttempt = (task.status === "pending"
    && (task.resume_without_attempt === true || task.attempt >= task.max_attempts))
    || (reclaim && task.attempt >= task.max_attempts);
  if (!resumeWithoutAttempt && task.attempt >= task.max_attempts) workflowFail("TASK_ATTEMPTS_EXHAUSTED", `task ${task.id} 已達 max attempts`);
  const now = clock.now();
  return workflowTaskSchema.parse({
    ...task,
    status: "claimed",
    attempt: resumeWithoutAttempt ? task.attempt : task.attempt + 1,
    lease: {
      id: options.leaseId,
      owner: options.owner,
      claimed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + options.leaseDurationMs).toISOString(),
    },
    failure_summary: undefined,
    failure: undefined,
    resume_without_attempt: undefined,
  });
}

export interface TaskClarificationRequest {
  id: string;
  question: string;
  reason: string;
  affectedModules: string[];
  options: TaskClarificationOption[];
  requestedAt: string;
}

export function requestTaskClarification(
  task: WorkflowTask,
  owner: string,
  leaseId: string,
  request: TaskClarificationRequest,
  clock: Clock = systemClock,
): WorkflowTask {
  if (task.status !== "claimed") workflowFail("TASK_CLARIFICATION_NOT_REQUESTABLE", `task ${task.id} 未處於 claimed`);
  assertValidLease(task, leaseId, owner, clock);
  if (task.clarifications?.some((item) => item.status === "pending")) {
    workflowFail("TASK_CLARIFICATION_ALREADY_PENDING", `task ${task.id} 已有待解答問題`);
  }
  const clarification = taskClarificationSchema.parse({
    id: request.id,
    status: "pending",
    question: request.question,
    reason: request.reason,
    uncertainty: "high",
    impact: "high",
    affected_modules: request.affectedModules,
    options: request.options,
    requested_at: request.requestedAt,
  });
  return workflowTaskSchema.parse({
    ...task,
    status: "needs_user_decision",
    lease: undefined,
    clarifications: [...(task.clarifications ?? []), clarification],
  });
}

export function resolveTaskClarification(task: WorkflowTask, input: {
  clarificationId: string;
  answer: string;
  selectedOption?: string;
  resolvedAt: string;
}): WorkflowTask {
  const clarifications = task.clarifications ?? [];
  const target = clarifications.find((item) => item.id === input.clarificationId);
  if (task.status !== "needs_user_decision" || target?.status !== "pending") {
    workflowFail("TASK_CLARIFICATION_NOT_PENDING", `task ${task.id} 沒有指定的待解答問題`);
  }
  return workflowTaskSchema.parse({
    ...task,
    status: "pending",
    lease: undefined,
    clarifications: clarifications.map((item) => item.id === input.clarificationId ? {
      ...item,
      status: "resolved",
      resolved_at: input.resolvedAt,
      answer: input.answer,
      ...(input.selectedOption === undefined ? {} : { selected_option: input.selectedOption }),
    } : item),
    resume_without_attempt: true,
  });
}

export function submitTask(task: WorkflowTask, submission: TaskSubmission, clock: Clock = systemClock): TaskSubmission {
  if (task.status === "completed" && task.result?.id === submission.result.id && task.result.revision === submission.result.revision) return submission;
  if (task.status !== "claimed" || submission.taskId !== task.id) workflowFail("TASK_RESULT_STALE", `task ${task.id} 不接受此 result`);
  assertValidLease(task, submission.leaseId, submission.owner, clock);
  if (task.result !== undefined) {
    if (task.result.id === submission.result.id && task.result.revision === submission.result.revision) return submission;
    workflowFail("TASK_RESULT_CONFLICT", `task ${task.id} 已有不同 result`);
  }
  return submission;
}

export function acceptTask(task: WorkflowTask, submission: TaskSubmission, clock: Clock = systemClock): WorkflowTask {
  if (task.status === "completed" && task.result?.id === submission.result.id && task.result.revision === submission.result.revision) return task;
  submitTask(task, submission, clock);
  return workflowTaskSchema.parse({ ...task, status: "completed", result: submission.result, lease: undefined });
}

export function completeCurateFactsTask(task: WorkflowTask, submission: TaskSubmission, clock: Clock = systemClock): WorkflowTask {
  if (task.kind !== "curate-facts") workflowFail("CURATE_FACTS_TASK_KIND_REQUIRED", `task ${task.id} is not a curate-facts task`);
  if (task.output_contract !== "facts-curation-summary@1" || submission.result.contract !== task.output_contract) {
    workflowFail("TASK_OUTPUT_CONTRACT_MISMATCH", `task ${task.id} requires facts-curation-summary@1`);
  }
  return acceptTask(task, submission, clock);
}

export function rejectTask(task: WorkflowTask, submission: TaskSubmission, summary: string, completedRevisions: number, clock: Clock = systemClock): WorkflowTask {
  submitTask(task, submission, clock);
  return workflowTaskSchema.parse({
    ...task,
    status: revisionFailureStatus(completedRevisions),
    result: submission.result,
    failure_summary: summary,
    lease: undefined,
  });
}

export function supersedeTask(task: WorkflowTask): WorkflowTask {
  if (task.status === "completed") workflowFail("TASK_ALREADY_COMPLETED", `completed task ${task.id} 不可 supersede`);
  return workflowTaskSchema.parse({ ...task, status: "superseded", lease: undefined });
}

export interface SuccessorTaskSpec {
  id: string;
  kind: string;
  assignedAgent: string;
  capabilities: string[];
  inputArtifacts: ArtifactReference[];
  outputContract: string;
  dependencies: string[];
  maxAttempts: number;
  extensions?: Record<string, unknown>;
}

export function createSuccessorTask(spec: SuccessorTaskSpec, actor: "engine"): WorkflowTask {
  if (actor !== "engine") workflowFail("TASK_CREATION_DENIED", "只有 workflow engine 可建立後繼 task");
  return workflowTaskSchema.parse({
    id: spec.id,
    kind: spec.kind,
    status: "pending",
    assigned_agent: spec.assignedAgent,
    capabilities: spec.capabilities,
    input_artifacts: spec.inputArtifacts,
    output_contract: spec.outputContract,
    dependencies: spec.dependencies,
    attempt: 0,
    max_attempts: spec.maxAttempts,
    extensions: spec.extensions ?? {},
  });
}
