import { internalId, type FactClassification, type FactDecision, type FactReviewRunRecord, type OperationRecord, type ProjectRepository } from "@st-workspace/core";
import type { FactReviewContext } from "@st-workspace/core";
import type { FactReviewExecutionResult, KnowledgeExecutionResult, KnowledgeService } from "@st-workspace/domain";
import { nextFactReviewer } from "./operation-recovery.js";
import { now } from "./operation-runner.js";

export interface FactReviewApplicationDeps {
  repository: ProjectRepository;
  knowledge: KnowledgeService;
}

export async function factReviewContext(
  deps: FactReviewApplicationDeps,
  options?: { cursor?: string; limit?: number; source_id?: string; classification?: FactClassification; reviewer_identity?: string },
): Promise<FactReviewContext> {
  return deps.knowledge.factReviewContext(options);
}

export async function reextract(
  deps: FactReviewApplicationDeps,
  operationId: string,
  sourceIds: readonly string[],
  actor: string,
  extractorRevision?: string,
): Promise<KnowledgeExecutionResult> {
  return deps.knowledge.reextract(operationId, sourceIds, actor, extractorRevision);
}

export async function startFactReviewRun(deps: FactReviewApplicationDeps, actor: string): Promise<FactReviewRunRecord> {
  const opId = await ensureFactReviewOperation(deps, actor);
  const reviewer = nextFactReviewer(await deps.repository.read());
  return deps.knowledge.beginFactReviewRun(opId, reviewer, undefined, actor);
}

export async function applyFactReviewBatch(
  deps: FactReviewApplicationDeps,
  decisions: FactDecision[],
  actor: string,
  reviewerIdentity?: string,
  reviewRunId?: string,
  expectedProjectionRevision?: string,
): Promise<FactReviewExecutionResult> {
  const opId = await ensureFactReviewOperation(deps, actor);
  const state = await deps.repository.read();
  const effectiveReviewer = (reviewerIdentity && reviewerIdentity.length > 0) ? reviewerIdentity : nextFactReviewer(state);
  return deps.knowledge.applyReviewBatch(opId, decisions, actor, effectiveReviewer, reviewRunId, expectedProjectionRevision);
}

export async function resolveFactConflict(
  deps: FactReviewApplicationDeps,
  decisions: FactDecision[],
  actor: string,
  reviewRunId?: string,
  expectedProjectionRevision?: string,
): Promise<FactReviewExecutionResult> {
  const opId = await ensureFactReviewOperation(deps, actor);
  return deps.knowledge.resolveFactConflict(opId, decisions, actor, "director", reviewRunId, expectedProjectionRevision);
}

async function ensureFactReviewOperation(deps: FactReviewApplicationDeps, actor: string): Promise<string> {
  const initial = await deps.repository.read();
  const existing = [...initial.operations].reverse().find((item) =>
    (item.command?.type === "fact_review" || item.kind === "knowledge" || item.kind === "review") && item.status !== "failed"
  );
  if (existing !== undefined) return existing.id;
  const opId = internalId("op");
  const newOp: OperationRecord = {
    id: opId,
    kind: "knowledge",
    request: "fact review run",
    actor,
    status: "running",
    created_at: now(),
    updated_at: now(),
    progress: [],
    command: {
      version: 1,
      type: "fact_review",
      payload: {},
    },
    execution_snapshot: {
      execution_agent_id: "fact-reviewer-1",
      execution_agent_role: "reviewer",
      created_at: now(),
    },
  };
  await deps.repository.commit(initial.revision, (current) => ({
    ...current,
    operations: [...current.operations, newOp],
  }));
  return opId;
}
