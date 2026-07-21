import { canonicalJson, computeTextRevision, runFileTransaction } from "@card-workspace/project";
import { workflowStateSchema, type WorkflowState } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";
import { computeWorkflowEventRevision, verifyWorkflowJournal, WORKFLOW_JOURNAL_PATH, type WorkflowJournalEvent } from "./journal.js";

export const WORKFLOW_PROJECTION_PATH = "workflow.json";

export function projectWorkflowEvents(events: readonly WorkflowJournalEvent[]): WorkflowState {
  if (events.length === 0) workflowFail("WORKFLOW_JOURNAL_EMPTY", "空 journal 無法重建 workflow projection");
  let state: WorkflowState | undefined;
  for (const event of events) {
    if (event.kind === "workflow_migrated") continue;
    const next = event.payload.state;
    if (state !== undefined) {
      if (next.project_id !== state.project_id) workflowFail("WORKFLOW_PROJECT_CHANGED", "journal 中 project_id 發生變更");
      if (next.revision !== state.revision + 1) workflowFail("WORKFLOW_REVISION_SEQUENCE_INVALID", `event ${event.id} workflow revision 不連續`);
    }
    state = workflowStateSchema.parse({ ...next, journal_revision: computeWorkflowEventRevision(event) });
  }
  if (state === undefined) workflowFail("WORKFLOW_JOURNAL_EMPTY", "空 journal 無法重建 workflow projection");
  return state;
}

export function verifyWorkflowProjection(rawProjection: string, rawJournal: string): WorkflowState {
  let current: WorkflowState;
  try {
    current = workflowStateSchema.parse(JSON.parse(rawProjection));
  } catch (error) {
    workflowFail("WORKFLOW_PROJECTION_INVALID", "workflow projection 無效", error);
  }
  const journal = verifyWorkflowJournal(rawJournal);
  const stateEvents = journal.events.filter((event) => event.kind === "workflow.state_replaced");
  if (stateEvents.length === 0) {
    if (current.journal_revision !== journal.revision) workflowFail("WORKFLOW_PROJECTION_DIVERGED", "workflow projection 的 journal revision 與基線不一致");
    return current;
  }
  const rebuilt = projectWorkflowEvents(journal.events);
  if (canonicalJson(current) !== canonicalJson(rebuilt)) workflowFail("WORKFLOW_PROJECTION_DIVERGED", "workflow projection 與 journal 不一致");
  return rebuilt;
}

export async function rebuildWorkflowProjection(options: {
  root: string;
  rawProjection: string;
  rawJournal: string;
}): Promise<WorkflowState> {
  const rebuilt = projectWorkflowEvents(verifyWorkflowJournal(options.rawJournal).events);
  await runFileTransaction({
    root: options.root,
    operations: [{
      relativePath: WORKFLOW_PROJECTION_PATH,
      content: canonicalJson(rebuilt),
      expectedRawRevision: computeTextRevision(options.rawProjection),
    }],
    expectations: [{ relativePath: WORKFLOW_JOURNAL_PATH, expectedRawRevision: computeTextRevision(options.rawJournal) }],
  });
  return rebuilt;
}
