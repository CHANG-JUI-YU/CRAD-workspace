import { CoreError, type ExecutionContext, type OperationRecord, type ProjectRepository } from "@st-workspace/core";

export type ExecutionActorInput = string | ExecutionContext;

export interface ResolvedExecutionActors {
  executionAgent: string;
  auditActor: string;
  context?: ExecutionContext;
}

/** Normalize the new context API while keeping the legacy string adapter thin. */
export function resolveExecutionActors(input: ExecutionActorInput, legacyAuditActor?: string): ResolvedExecutionActors {
  if (typeof input === "string") {
    return {
      executionAgent: input,
      auditActor: legacyAuditActor ?? input,
    };
  }
  return {
    executionAgent: input.executionAgent.id,
    auditActor: input.auditActor,
    context: input,
  };
}

/** Fence a durable domain side effect against the operation's current lease. */
export function assertExecutionLeaseForOperation(operation: OperationRecord | undefined, execution?: ExecutionContext): void {
  if (execution?.lease === undefined) return;
  if (operation === undefined
    || operation.lease_owner !== execution.lease.owner
    || operation.lease_token !== execution.lease.token
    || (execution.lease.generation !== undefined && operation.fencing_generation !== execution.lease.generation)
    || (operation.lease_expires_at !== undefined && Date.parse(operation.lease_expires_at) <= Date.now())) {
    throw new CoreError("OPERATION_LEASE_LOST", `Operation ${execution.operationId} no longer owns the supplied execution lease.`, true);
  }
}

export async function assertExecutionLease(repository: ProjectRepository, execution?: ExecutionContext): Promise<void> {
  if (execution?.lease === undefined) return;
  const state = await repository.read();
  assertExecutionLeaseForOperation(state.operations.find((item) => item.id === execution.operationId), execution);
}
