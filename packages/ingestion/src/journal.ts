import { readFile } from "node:fs/promises";

import {
  journalEventEnvelopeSchema,
  type JournalEventEnvelope,
  type Revision,
} from "@card-workspace/schemas";
import {
  canonicalize,
  computeRevision,
  resolveExistingWithin,
} from "@card-workspace/project";

import { IngestionError } from "./types.js";

export const FACT_DECISIONS_PATH = "facts/decisions.jsonl";

export interface JournalVerification {
  events: JournalEventEnvelope[];
  aggregateRevisions: Map<string, Revision>;
  rawText: string;
}

export type NewJournalEvent = Omit<
  JournalEventEnvelope,
  "schema_version" | "sequence" | "prior_revision" | "payload_hash"
>;

export function canonicalCompactJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeJournalEventRevision(event: JournalEventEnvelope): Revision {
  return computeRevision({
    aggregate_id: event.aggregate_id,
    actor: event.actor,
    id: event.id,
    kind: event.kind,
    payload_hash: event.payload_hash,
    prior_revision: event.prior_revision,
  });
}

export function verifyJournalText(rawText: string): JournalVerification {
  const lines = rawText === "" ? [] : rawText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events: JournalEventEnvelope[] = [];
  const ids = new Set<string>();
  const aggregateRevisions = new Map<string, Revision>();

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new IngestionError("FACT_JOURNAL_LINE_INVALID", `decision journal 第 ${index + 1} 行為空白`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new IngestionError("FACT_JOURNAL_LINE_INVALID", `decision journal 第 ${index + 1} 行不是 JSON`, error);
    }
    const result = journalEventEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      throw new IngestionError("FACT_JOURNAL_EVENT_INVALID", `decision journal 第 ${index + 1} 行 schema 無效`, result.error);
    }
    const event = result.data;
    if (line !== canonicalCompactJson(event)) {
      throw new IngestionError("FACT_JOURNAL_NOT_CANONICAL", `decision journal 第 ${index + 1} 行不是 canonical compact JSON`);
    }
    if (event.sequence !== index + 1) {
      throw new IngestionError("FACT_JOURNAL_SEQUENCE_INVALID", `decision journal sequence 中斷：預期 ${index + 1}，實際 ${event.sequence}`);
    }
    if (ids.has(event.id)) {
      throw new IngestionError("FACT_JOURNAL_EVENT_DUPLICATE", `decision journal event ID 重複：${event.id}`);
    }
    ids.add(event.id);
    if (event.payload_hash !== computeRevision(event.payload)) {
      throw new IngestionError("FACT_JOURNAL_PAYLOAD_HASH_MISMATCH", `decision journal payload hash 不符：${event.id}`);
    }
    const expectedPrior = aggregateRevisions.get(event.aggregate_id);
    if (event.prior_revision !== expectedPrior) {
      throw new IngestionError(
        "FACT_JOURNAL_PRIOR_REVISION_MISMATCH",
        `decision journal prior revision 不符：${event.id}`,
      );
    }
    aggregateRevisions.set(event.aggregate_id, computeJournalEventRevision(event));
    events.push(event);
  }
  return { events, aggregateRevisions, rawText };
}

export async function readFactJournal(projectRoot: string): Promise<JournalVerification> {
  try {
    const path = await resolveExistingWithin(projectRoot, FACT_DECISIONS_PATH);
    return verifyJournalText(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("FACT_JOURNAL_INVALID", "無法讀取 decision journal", error);
  }
}

export function appendJournalEvents(
  journal: JournalVerification,
  additions: readonly NewJournalEvent[],
): JournalVerification {
  let text = journal.rawText;
  const aggregateRevisions = new Map(journal.aggregateRevisions);
  let sequence = journal.events.length;
  for (const addition of additions) {
    sequence += 1;
    const priorRevision = aggregateRevisions.get(addition.aggregate_id);
    const event = journalEventEnvelopeSchema.parse({
      schema_version: 1,
      ...addition,
      sequence,
      ...(priorRevision === undefined ? {} : { prior_revision: priorRevision }),
      payload_hash: computeRevision(addition.payload),
    });
    text += `${canonicalCompactJson(event)}\n`;
    aggregateRevisions.set(event.aggregate_id, computeJournalEventRevision(event));
  }
  return verifyJournalText(text);
}
