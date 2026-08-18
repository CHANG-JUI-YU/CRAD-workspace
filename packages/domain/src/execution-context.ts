import { CoreError, type ExecutionContext, type OperationRecord, type ProjectRepository } from "@st-workspace/core";

export type ExecutionActorInput = string | ExecutionContext;

export interface ResolvedExecutionActors {
  executionAgent: string;
  auditActor: string;
  context?: ExecutionContext;
}

/** Normalize the new context API while keeping the legacy string adapter thin. */
export function resolveExecutionActors(input: ExecutionActorInput | Record<string, unknown>, legacyAuditActor?: string): ResolvedExecutionActors {
  if (typeof input === "string") {
    const valid = input.trim().length > 0 ? input : "director";
    return {
      executionAgent: valid,
      auditActor: legacyAuditActor && legacyAuditActor.trim().length > 0 ? legacyAuditActor : valid,
    };
  }
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const execAgentObj = obj.executionAgent as { id?: string } | undefined;
    const agentId = typeof execAgentObj?.id === "string" && execAgentObj.id.trim().length > 0
      ? execAgentObj.id
      : (typeof obj.actor === "string" && obj.actor.trim().length > 0
        ? obj.actor
        : (typeof obj.agent_id === "string" && obj.agent_id.trim().length > 0 ? obj.agent_id : "director"));
    const auditActor = typeof obj.auditActor === "string" && obj.auditActor.trim().length > 0
      ? obj.auditActor
      : (typeof obj.actor === "string" && obj.actor.trim().length > 0 ? obj.actor : agentId);
    const contextObj = "executionAgent" in obj && "operationId" in obj ? (obj as unknown as ExecutionContext) : undefined;
    return {
      executionAgent: agentId,
      auditActor: auditActor || "director",
      ...(contextObj === undefined ? {} : { context: contextObj }),
    };
  }
  return { executionAgent: "director", auditActor: legacyAuditActor || "director" };
}

/** Fence a durable domain side effect against cancellation and the operation's current lease. */
export function assertExecutionLeaseForOperation(operation: OperationRecord | undefined, execution?: ExecutionContext): void {
  execution?.signal?.throwIfAborted();
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
  execution?.signal?.throwIfAborted();
  if (execution?.lease === undefined) return;
  const state = await repository.read();
  assertExecutionLeaseForOperation(state.operations.find((item) => item.id === execution.operationId), execution);
}
