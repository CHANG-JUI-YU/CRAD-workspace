import { z } from "zod";

import {
  jsonObjectSchema,
  revisionSchema,
  stableIdSchema,
  workflowStateSchema,
  type Revision,
  type WorkflowState,
} from "@card-workspace/schemas";
import { canonicalize, computeRevision } from "@card-workspace/project";

import { workflowFail } from "./errors.js";

export const WORKFLOW_JOURNAL_PATH = ".workflow/journal.jsonl";

const stateReplacementEventSchema = z.object({
  schema_version: z.literal(1),
  id: stableIdSchema,
  sequence: z.number().int().positive(),
  kind: z.literal("workflow.state_replaced"),
  actor: stableIdSchema,
  occurred_at: z.string().datetime({ offset: true }),
  prior_revision: revisionSchema.optional(),
  payload_hash: revisionSchema,
  payload: z.object({ state: workflowStateSchema }).strict(),
}).strict();

const migrationEventSchema = z.object({
  schema_version: z.literal(1),
  id: stableIdSchema,
  sequence: z.number().int().positive(),
  kind: z.literal("workflow_migrated"),
  actor: stableIdSchema,
  occurred_at: z.string().datetime({ offset: true }),
  payload_hash: revisionSchema,
  payload: jsonObjectSchema,
}).strict();

const journalEventSchema = z.discriminatedUnion("kind", [stateReplacementEventSchema, migrationEventSchema]);

export type WorkflowJournalEvent = z.infer<typeof journalEventSchema>;
export type WorkflowStateReplacementEvent = z.infer<typeof stateReplacementEventSchema>;

export interface WorkflowJournal {
  events: WorkflowJournalEvent[];
  rawText: string;
  revision?: Revision;
}

export interface NewWorkflowJournalEvent {
  id: string;
  actor: string;
  occurredAt: string;
  state: WorkflowState;
}

function compact(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeWorkflowEventRevision(event: WorkflowJournalEvent): Revision {
  if (event.kind === "workflow_migrated") {
    return computeRevision({ sequence: event.sequence, kind: event.kind, actor: event.actor, payload: event.payload });
  }
  return computeRevision({
    actor: event.actor,
    id: event.id,
    kind: event.kind,
    payload_hash: event.payload_hash,
    prior_revision: event.prior_revision,
  });
}

export function verifyWorkflowJournal(rawText: string): WorkflowJournal {
  const lines = rawText === "" ? [] : rawText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events: WorkflowJournalEvent[] = [];
  const ids = new Set<string>();
  let revision: Revision | undefined;
  for (const [index, line] of lines.entries()) {
    if (line === "") workflowFail("WORKFLOW_JOURNAL_TRUNCATED", `journal 第 ${index + 1} 行為空白`);
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      workflowFail("WORKFLOW_JOURNAL_TRUNCATED", `journal 第 ${index + 1} 行不是完整 JSON`, error);
    }
    const parsed = journalEventSchema.safeParse(value);
    if (!parsed.success) workflowFail("WORKFLOW_JOURNAL_EVENT_INVALID", `journal 第 ${index + 1} 行 schema 無效`, parsed.error);
    const event = parsed.data;
    // Task 3 migration predates canonical workflow event emission; all state events remain strict.
    if (event.kind !== "workflow_migrated" && line !== compact(event)) workflowFail("WORKFLOW_JOURNAL_NOT_CANONICAL", `journal 第 ${index + 1} 行不是 canonical JSON`);
    if (event.sequence !== index + 1) workflowFail("WORKFLOW_JOURNAL_SEQUENCE_INVALID", `journal sequence 應為 ${index + 1}`);
    if (ids.has(event.id)) workflowFail("WORKFLOW_JOURNAL_EVENT_DUPLICATE", `event ID 重複：${event.id}`);
    if (event.kind === "workflow_migrated" && index !== 0) workflowFail("WORKFLOW_JOURNAL_MIGRATION_POSITION_INVALID", "migration event 只能是 journal 第一筆");
    if (event.kind === "workflow.state_replaced" && event.prior_revision !== revision) workflowFail("WORKFLOW_JOURNAL_CHAIN_INVALID", `event ${event.id} prior revision 不符`);
    if (event.payload_hash !== computeRevision(event.payload)) workflowFail("WORKFLOW_JOURNAL_HASH_MISMATCH", `event ${event.id} payload hash 不符`);
    ids.add(event.id);
    events.push(event);
    revision = computeWorkflowEventRevision(event);
  }
  return revision === undefined ? { events, rawText } : { events, rawText, revision };
}

export function appendWorkflowEvent(journal: WorkflowJournal, addition: NewWorkflowJournalEvent): WorkflowJournal {
  const state = { ...addition.state };
  delete state.journal_revision;
  const payload = { state: workflowStateSchema.parse(state) };
  const existing = journal.events.find((event) => event.id === addition.id);
  if (existing !== undefined) {
    if (existing.kind === "workflow.state_replaced" && existing.actor === addition.actor && existing.payload_hash === computeRevision(payload)) return journal;
    workflowFail("WORKFLOW_EVENT_ID_CONFLICT", `event ID ${addition.id} 已用於不同 payload`);
  }
  const event = stateReplacementEventSchema.parse({
    schema_version: 1,
    id: addition.id,
    sequence: journal.events.length + 1,
    kind: "workflow.state_replaced",
    actor: addition.actor,
    occurred_at: addition.occurredAt,
    ...(journal.revision === undefined ? {} : { prior_revision: journal.revision }),
    payload_hash: computeRevision(payload),
    payload,
  });
  return verifyWorkflowJournal(`${journal.rawText}${compact(event)}\n`);
}
