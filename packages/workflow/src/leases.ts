import type { WorkflowTask } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function leaseIsExpired(task: WorkflowTask, clock: Clock = systemClock): boolean {
  return task.lease !== undefined && Date.parse(task.lease.expires_at) <= clock.now().getTime();
}

export function assertValidLease(task: WorkflowTask, leaseId: string, owner: string, clock: Clock = systemClock): void {
  if (task.lease?.id !== leaseId || task.lease.owner !== owner) workflowFail("TASK_LEASE_MISMATCH", `task ${task.id} lease 不符`);
  if (leaseIsExpired(task, clock)) workflowFail("TASK_LEASE_EXPIRED", `task ${task.id} lease 已過期`);
}
