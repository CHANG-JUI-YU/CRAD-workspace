import type { WorkflowState, WorkflowTask } from "@card-workspace/schemas";
import type { WorkflowConfig } from "@card-workspace/workflow";

import { mcpFail } from "./errors.js";

export interface AuthorizationRequest {
  agentId: string;
  toolName: string;
  config: WorkflowConfig;
  workflow: WorkflowState;
  taskId?: string;
  leaseId?: string;
  now?: Date;
}

export interface AuthorizationGrant {
  capability: string;
  task?: WorkflowTask;
}

const workspaceToolCapabilities: Readonly<Record<string, string>> = Object.freeze({
  project_initialize: "workspace.initialize",
  project_list: "workspace.discover",
});

export function agentCanAccessTool(agentId: string, toolName: string, config: WorkflowConfig): boolean {
  const agent = config.registry.agents.find((candidate) => candidate.id === agentId);
  if (!agent) return false;
  const workspaceCapability = workspaceToolCapabilities[toolName];
  if (workspaceCapability !== undefined) {
    return agent.kind === "director" && agent.capabilities.includes(workspaceCapability);
  }
  return config.toolPolicy.rules.some((rule) =>
    rule.tools.includes(toolName) && agent.capabilities.includes(rule.capability));
}

export function authorizeWorkspaceTool(request: {
  agentId: string;
  toolName: string;
  config: WorkflowConfig;
}): AuthorizationGrant {
  const agent = request.config.registry.agents.find((candidate) => candidate.id === request.agentId);
  const capability = workspaceToolCapabilities[request.toolName];
  if (agent?.kind !== "director" || capability === undefined || !agent.capabilities.includes(capability)) {
    deny(request.toolName);
  }
  return { capability };
}

export function authorizeTool(request: AuthorizationRequest): AuthorizationGrant {
  if (request.workflow.outcome?.status === "closed" && !["workflow_status", "project_artifact_list", "project_artifact_read", "card_import_report"].includes(request.toolName)) {
    mcpFail("WORKFLOW_CLOSED", `Workflow is closed with outcome ${request.workflow.outcome.kind}`);
  }
  const agent = request.config.registry.agents.find((candidate) => candidate.id === request.agentId);
  const policy = request.config.toolPolicy.rules.find((candidate) =>
    candidate.tools.includes(request.toolName)
    && candidate.stages.includes(request.workflow.stage)
    && agent?.capabilities.includes(candidate.capability));
  if (!agent || !policy) deny(request.toolName);

  if (policy.requires_gate) {
    const gate = request.workflow.gates.find((candidate) => candidate.id === policy.requires_gate);
    if (gate?.status !== "approved") deny(request.toolName);
  }

  if (!policy.requires_task) return { capability: policy.capability };
  const task = request.workflow.tasks.find((candidate) => candidate.id === request.taskId);
  const now = request.now ?? new Date();
  const reclaimExpired = task?.status === "claimed"
    && task.lease?.owner === request.agentId
    && Date.parse(task.lease.expires_at) <= now.getTime();
  if (
    request.toolName === "task_claim"
    && task?.assigned_agent === request.agentId
    && task.capabilities.includes(policy.capability)
    && (["pending", "retryable"].includes(task.status) || reclaimExpired)
  ) return { capability: policy.capability, task };
  const lease = task?.lease;
  if (
    !task
    || task.assigned_agent !== request.agentId
    || !task.capabilities.includes(policy.capability)
    || task.status !== "claimed"
    || lease?.id !== request.leaseId
    || lease?.owner !== request.agentId
    || Date.parse(lease?.expires_at ?? "") <= now.getTime()
  ) deny(request.toolName);
  return { capability: policy.capability, task };
}

function deny(toolName: string): never {
  mcpFail("TOOL_CAPABILITY_DENIED", `Tool is not authorized in the current agent/task/stage/lease context: ${toolName}`);
}
