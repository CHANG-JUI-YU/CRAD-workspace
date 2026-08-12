import {
  CoreError,
  executionContextFromOperation,
  internalId,
  validateFactReferences,
  type AdaptationDecision,
  type ArtifactKind,
  type ExecutionContext,
  type ExecutionLeaseContext,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type RequestResult,
  type WorkspaceContext,
} from "@st-workspace/core";
import type { SourceSelectionDecision, SourceService } from "@st-workspace/domain";
import { now } from "./operation-runner.js";

export interface SourceApplicationDeps {
  repository: ProjectRepository;
  sources: SourceService;
}

export function resolveExecutionContext(operation: OperationRecord, optionalAgent?: string): { agent_id: string; agent_role: string } {
  const snapshotAgent = operation.execution_snapshot?.execution_agent_id;
  const snapshotRole = operation.execution_snapshot?.execution_agent_role;
  if (snapshotAgent !== undefined && snapshotAgent.trim().length > 0) {
    return { agent_id: snapshotAgent.trim(), agent_role: snapshotRole ?? "specialist" };
  }
  if (optionalAgent !== undefined && optionalAgent.trim().length > 0) {
    return { agent_id: optionalAgent.trim(), agent_role: "specialist" };
  }
  switch (operation.kind) {
    case "authoring":
      return { agent_id: "director", agent_role: "orchestrator" };
    case "review":
      return { agent_id: "fact-reviewer-1", agent_role: "fact_reviewer" };
    case "knowledge":
      return { agent_id: "fact-curator", agent_role: "fact_curator" };
    case "source":
      return { agent_id: "source-researcher", agent_role: "source_researcher" };
    default:
      return { agent_id: "director", agent_role: "orchestrator" };
  }
}

export function executionContextFor(
  operation: OperationRecord,
  workspace: WorkspaceContext,
  identity?: { id: string; role: string },
  options: { lease?: ExecutionLeaseContext; target?: { artifactId: string; artifactKind?: ArtifactKind }; capabilities?: readonly string[] } = {},
): ExecutionContext {
  const resolvedLegacy = resolveExecutionContext(operation);
  const resolved = identity ?? { id: resolvedLegacy.agent_id, role: resolvedLegacy.agent_role };
  const auditActor = workspace.actor.trim().length > 0 ? workspace.actor.trim() : operation.actor ?? "worker";
  return executionContextFromOperation(operation, {
    auditActor,
    executionAgent: resolved,
    ...(options.lease === undefined ? {} : { lease: options.lease }),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
  });
}

export async function sourceCandidates(deps: SourceApplicationDeps): Promise<ProjectState["candidates"][number][]> {
  return (await deps.repository.read()).candidates;
}

export async function selectSourceCandidates(deps: SourceApplicationDeps, decisions: SourceSelectionDecision[], context: WorkspaceContext): Promise<RequestResult> {
  if (decisions.length === 0) throw new CoreError("SOURCE_SELECTION_EMPTY", "至少要選擇一個候選來源。", true);
  const initial = await deps.repository.read();
  const operation: OperationRecord = {
    id: internalId("operation"),
    kind: "source",
    request: "select source candidates",
    actor: context.actor,
    status: "running",
    created_at: now(),
    updated_at: now(),
    progress: [],
    command: { version: 1, type: "source_select", payload: { decisions } },
    execution_snapshot: {
      execution_agent_id: "source-researcher",
      execution_agent_role: "researcher",
      initiated_by: context.actor,
      route_kind: "source",
      created_at: now(),
    },
  };
  await deps.repository.commit(initial.revision, (current) => ({
    ...current,
    operations: [...current.operations, operation],
    audit: [...current.audit, {
      id: internalId("audit"),
      operation_id: operation.id,
      event: "operation.created",
      actor: context.actor,
      occurred_at: now(),
      project_revision: current.revision + 1,
      details: { kind: "source_selection", candidate_ids: decisions.map((decision) => decision.candidate_id) },
    }],
  }));
  const execution = executionContextFor(operation, context, { id: "source-researcher", role: "researcher" });
  const result = await deps.sources.selectCandidates(operation.id, decisions, execution);
  return {
    operation_id: operation.id,
    status: result.status,
    summary: result.summary,
    completed: [...result.approved, ...result.rejected],
    blocked: [],
  };
}

export async function createAdaptationDecision(
  deps: SourceApplicationDeps,
  input: Omit<AdaptationDecision, "id" | "created_at" | "created_by">,
  context: WorkspaceContext,
): Promise<RequestResult> {
  const initial = await deps.repository.read();
  const factFindings = validateFactReferences({ fact_refs: input.fact_refs ?? [] }, initial.facts, initial.sources);
  if (factFindings.length > 0) throw new CoreError("ADAPTATION_DECISION_FACT_INVALID", "Adaptation decision refers to unusable facts.", true, factFindings);
  const decision: AdaptationDecision = { ...input, id: internalId("adaptation_decision"), created_at: now(), created_by: context.actor };
  const operation: OperationRecord = {
    id: internalId("operation"),
    kind: "authoring",
    request: `adaptation decision ${decision.topic}`,
    actor: context.actor,
    status: "completed",
    created_at: now(),
    updated_at: now(),
    progress: [{ item_id: decision.id, status: "completed", message: "Adaptation decision saved." }],
    result_summary: "Adaptation decision saved.",
  };
  await deps.repository.commit(initial.revision, (current) => ({
    ...current,
    adaptation_decisions: [...current.adaptation_decisions, decision],
    operations: [...current.operations, operation],
    audit: [...current.audit, {
      id: internalId("audit"),
      operation_id: operation.id,
      event: "adaptation.decision.created",
      actor: context.actor,
      occurred_at: now(),
      project_revision: current.revision + 1,
      details: { decision_id: decision.id, topic: decision.topic, choice: decision.choice, fact_refs: decision.fact_refs ?? [] },
    }],
  }));
  return { operation_id: operation.id, status: "completed", summary: "Adaptation decision saved.", completed: [decision.id], blocked: [] };
}
