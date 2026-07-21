import { createHash } from "node:crypto";

import {
  journalEventEnvelopeSchema,
  type JournalEventEnvelope,
  type JsonObject,
  type Revision,
} from "@card-workspace/schemas";
import { canonicalize, computeRevision } from "@card-workspace/project";

export interface CreateSourceRevisionEventOptions {
  sourceId: string;
  priorRevision?: Revision;
  actor: string;
  timestamp: string;
  sequence: number;
  payload: JsonObject;
}

export interface CreateSourceEventOptions extends CreateSourceRevisionEventOptions {
  kind: "source.revision_added" | "source.chunk_set_created" | "source.job_updated";
}

export function compactCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createSourceEvent(options: CreateSourceEventOptions): JournalEventEnvelope {
  const payloadHash = computeRevision(options.payload);
  const identity = canonicalize({
    aggregate_id: options.sourceId,
    kind: options.kind,
    payload_hash: payloadHash,
    prior_revision: options.priorRevision ?? null,
  });
  const digest = createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
  return journalEventEnvelopeSchema.parse({
    schema_version: 1,
    id: `event-${digest}`,
    sequence: options.sequence,
    kind: options.kind,
    aggregate_id: options.sourceId,
    ...(options.priorRevision ? { prior_revision: options.priorRevision } : {}),
    actor: options.actor,
    timestamp: options.timestamp,
    payload_hash: payloadHash,
    payload: options.payload,
  });
}

export function createSourceRevisionEvent(
  options: CreateSourceRevisionEventOptions,
): JournalEventEnvelope {
  return createSourceEvent({ ...options, kind: "source.revision_added" });
}

export function eventSemanticRevision(event: JournalEventEnvelope): Revision {
  const identity = canonicalize({
    aggregate_id: event.aggregate_id,
    kind: event.kind,
    payload_hash: event.payload_hash,
    prior_revision: event.prior_revision ?? null,
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex")}`;
}

export function appendCanonicalEvent(journal: string, event: JournalEventEnvelope): string {
  const prefix = journal.length === 0 || journal.endsWith("\n") ? journal : `${journal}\n`;
  return `${prefix}${compactCanonicalJson(event)}\n`;
}
