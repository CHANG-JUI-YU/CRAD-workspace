import { workflowTaskSchema, type TaskFailureCategory, type WorkflowTask } from "@card-workspace/schemas";

export const MAX_AUTOMATIC_REVISIONS = 2;

export function revisionFailureStatus(completedRevisions: number): "retryable" | "needs_user_decision" {
  return completedRevisions >= MAX_AUTOMATIC_REVISIONS ? "needs_user_decision" : "retryable";
}

export function markTaskFailed(
  task: WorkflowTask,
  summary: string,
  category: TaskFailureCategory,
  failedAt: string,
  failedBy: string,
): WorkflowTask {
  const exhausted = task.attempt >= task.max_attempts;
  const recoveryExhausted = exhausted && task.extensions.recovery_generation === 1;
  return workflowTaskSchema.parse({
    ...task,
    status: recoveryExhausted ? "needs_user_decision" : exhausted ? "failed" : "retryable",
    failure_summary: summary,
    failure: { category, summary, failed_at: failedAt, failed_by: failedBy, attempt: task.attempt },
    lease: undefined,
    extensions: recoveryExhausted ? { ...task.extensions, recovery_exhausted: true } : task.extensions,
  });
}
