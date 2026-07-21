import { readFile } from "node:fs/promises";

import {
  canonicalJson,
  computeTextRevision,
  resolveExistingWithin,
  runFileTransaction,
  type TransactionExpectation,
  type TransactionOperation,
} from "@card-workspace/project";
import type { WorkflowState } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";
import { appendWorkflowEvent, verifyWorkflowJournal, WORKFLOW_JOURNAL_PATH } from "./journal.js";
import { projectWorkflowEvents, verifyWorkflowProjection, WORKFLOW_PROJECTION_PATH } from "./projector.js";

export interface WorkflowMutation {
  expectedRevision: number;
  eventId: string;
  actor: string;
  occurredAt: string;
  update: (current: WorkflowState) => WorkflowState;
  operations?: TransactionOperation[];
  expectations?: TransactionExpectation[];
  workspaceTransaction?: {
    root: string;
    projectPrefix: string;
    operations: TransactionOperation[];
    expectations?: TransactionExpectation[];
  };
  beforePublish?: (index: number, operation: TransactionOperation) => void | Promise<void>;
}

export async function commitWorkflowMutation(root: string, mutation: WorkflowMutation): Promise<WorkflowState> {
  const [projectionPath, journalPath] = await Promise.all([
    resolveExistingWithin(root, WORKFLOW_PROJECTION_PATH),
    resolveExistingWithin(root, WORKFLOW_JOURNAL_PATH),
  ]);
  const [rawProjection, rawJournal] = await Promise.all([
    readFile(projectionPath, "utf8"),
    readFile(journalPath, "utf8"),
  ]);
  const current = verifyWorkflowProjection(rawProjection, rawJournal);
  const journal = verifyWorkflowJournal(rawJournal);
  const existing = journal.events.find((event) => event.id === mutation.eventId);
  if (existing !== undefined) {
    if (existing.kind !== "workflow.state_replaced") workflowFail("WORKFLOW_EVENT_ID_CONFLICT", `event ID ${mutation.eventId} 已保留給 migration`);
    const preceding = journal.events.slice(0, existing.sequence - 1);
    const base = preceding.some((event) => event.kind === "workflow.state_replaced")
      ? projectWorkflowEvents(preceding)
      : { ...current, revision: existing.payload.state.revision - 1, journal_revision: existing.prior_revision };
    if (base.revision !== mutation.expectedRevision) workflowFail("WORKFLOW_EVENT_ID_CONFLICT", `event ID ${mutation.eventId} 的 expected revision 不同`);
    appendWorkflowEvent(journal, {
      id: mutation.eventId,
      actor: mutation.actor,
      occurredAt: mutation.occurredAt,
      state: mutation.update(base),
    });
    return projectWorkflowEvents(journal.events.slice(0, existing.sequence));
  }
  if (current.revision !== mutation.expectedRevision) {
    workflowFail("WORKFLOW_REVISION_CONFLICT", `預期 workflow revision ${mutation.expectedRevision}，實際 ${current.revision}`);
  }
  const proposed = mutation.update(current);
  if (proposed.revision !== current.revision + 1) workflowFail("WORKFLOW_REVISION_INVALID", "mutation 必須將 workflow revision 恰好增加 1");
  if (proposed.project_id !== current.project_id) workflowFail("WORKFLOW_PROJECT_CHANGED", "mutation 不可變更 project_id");
  const appended = appendWorkflowEvent(journal, {
    id: mutation.eventId,
    actor: mutation.actor,
    occurredAt: mutation.occurredAt,
    state: proposed,
  });
  const next = projectWorkflowEvents(appended.events);
  const transactionRoot = mutation.workspaceTransaction?.root ?? root;
  const prefix = (operation: TransactionOperation): TransactionOperation => mutation.workspaceTransaction
    ? { ...operation, relativePath: `${mutation.workspaceTransaction.projectPrefix}/${operation.relativePath}` }
    : operation;
  await runFileTransaction({
    root: transactionRoot,
    operations: [
      ...(mutation.workspaceTransaction?.operations ?? []),
      ...(mutation.operations ?? []).map(prefix),
      {
        relativePath: prefix({ relativePath: WORKFLOW_PROJECTION_PATH, content: "" }).relativePath,
        content: canonicalJson(next),
        expectedRawRevision: computeTextRevision(rawProjection),
      },
      {
        relativePath: prefix({ relativePath: WORKFLOW_JOURNAL_PATH, content: "" }).relativePath,
        content: appended.rawText,
        expectedRawRevision: computeTextRevision(rawJournal),
      },
    ],
    expectations: [
      ...(mutation.workspaceTransaction?.expectations ?? []),
      ...(mutation.expectations ?? []).map((expectation) => ({
        ...expectation,
        relativePath: prefix({ ...expectation, content: "" }).relativePath,
      })),
    ],
    ...(mutation.workspaceTransaction ? { lockRoots: [root] } : {}),
    ...(mutation.beforePublish ? { beforePublish: mutation.beforePublish } : {}),
  });
  return next;
}
