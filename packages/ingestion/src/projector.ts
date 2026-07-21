import { readFile, readdir } from "node:fs/promises";

import {
  candidateBatchSchema,
  candidateIdentityBindingSchema,
  conflictRegisterSchema,
  conflictSchema,
  factRegisterSchema,
  factSchema,
  reviewDecisionSchema,
  resolutionDecisionSchema,
  type Conflict,
  type CandidateIdentityBinding,
  type ConflictRegister,
  type Fact,
  type FactCandidate,
  type FactRegister,
  type JournalEventEnvelope,
  type Revision,
} from "@card-workspace/schemas";
import {
  canonicalJson,
  canonicalYaml,
  computeRevision,
  computeTextRevision,
  resolveExistingWithin,
  resolveWithin,
  runFileTransaction,
} from "@card-workspace/project";
import { parse as parseYaml } from "yaml";

import { readFactJournal, type JournalVerification } from "./journal.js";
import { createCandidateOccurrence } from "./candidate-occurrence.js";
import { IngestionError } from "./types.js";

export const FACT_REGISTER_PATH = "facts/register.yaml";
export const CONFLICT_REGISTER_PATH = "facts/conflicts.yaml";

export interface FactProjection {
  register: FactRegister;
  conflicts: ConflictRegister;
}

interface RawProjection extends FactProjection {
  registerText: string;
  conflictsText: string;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new IngestionError(code, message, cause);
}

function revisionForRegister(register: Omit<FactRegister, "revision">): Revision {
  return computeRevision(register);
}

function revisionForConflicts(conflicts: Omit<ConflictRegister, "revision">): Revision {
  return computeRevision(conflicts);
}

function finalizeProjection(facts: Fact[], conflicts: Conflict[]): FactProjection {
  const factState = {
    schema_version: 1 as const,
    facts: [...facts].sort((left, right) => left.id.localeCompare(right.id)),
    extensions: {},
  };
  const conflictState = {
    schema_version: 1 as const,
    conflicts: [...conflicts].sort((left, right) => left.id.localeCompare(right.id)),
    extensions: {},
  };
  return {
    register: factRegisterSchema.parse({ ...factState, revision: revisionForRegister(factState) }),
    conflicts: conflictRegisterSchema.parse({ ...conflictState, revision: revisionForConflicts(conflictState) }),
  };
}

export async function readHistoricalCandidateIndex(projectRoot: string): Promise<Map<string, FactCandidate>> {
  const directory = await resolveWithin(projectRoot, "facts/candidates");
  let names: string[];
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const occurrences = new Map<string, FactCandidate>();
  const rawOccurrences = new Map<string, FactCandidate[]>();
  for (const name of names) {
    try {
      const batch = candidateBatchSchema.parse(JSON.parse(await readFile(await resolveExistingWithin(
        projectRoot,
        `facts/candidates/${name}`,
      ), "utf8")));
      const content = {
        schema_version: batch.schema_version,
        source_id: batch.source_id,
        source_revision_id: batch.source_revision_id,
        chunk_set_id: batch.chunk_set_id,
        chunk_id: batch.chunk_id,
        chunk_hash: batch.chunk_hash,
        job_id: batch.job_id,
        input_revision: batch.input_revision,
        candidates: batch.candidates,
        created_by: batch.created_by,
        created_at: batch.created_at,
        extensions: batch.extensions,
      };
      if (batch.content_hash !== computeRevision(content)) {
        fail("FACT_CANDIDATE_BATCH_HASH_MISMATCH", `candidate batch hash 不符：${batch.id}`);
      }
      for (const candidate of batch.candidates) {
        const occurrence = createCandidateOccurrence(batch.id, candidate);
        if (occurrences.has(occurrence.id)) {
          fail("FACT_CANDIDATE_DUPLICATE", `candidate occurrence ID 重複：${occurrence.id}`);
        }
        occurrences.set(occurrence.id, occurrence);
        rawOccurrences.set(candidate.id, [...(rawOccurrences.get(candidate.id) ?? []), occurrence]);
      }
    } catch (error) {
      if (error instanceof IngestionError) throw error;
      fail("FACT_CANDIDATE_BATCH_INVALID", `candidate batch 無效：${name}`, error);
    }
  }
  for (const [rawId, matches] of rawOccurrences) {
    if (matches.length === 1 && !occurrences.has(rawId)) occurrences.set(rawId, matches[0]!);
  }
  return occurrences;
}

/** @deprecated Use readActiveCandidateIndex for review/readiness operations. */
export const readCandidateIndex = readHistoricalCandidateIndex;

function assertFactEvent(
  event: JournalEventEnvelope,
  candidates: Map<string, FactCandidate>,
  facts: Map<string, Fact>,
  bindings: ReadonlyMap<string, CandidateIdentityBinding>,
): void {
  const decisionResult = reviewDecisionSchema.safeParse(event.payload.decision);
  const resolutionResult = resolutionDecisionSchema.safeParse(event.payload.resolution_decision);
  const factResult = factSchema.safeParse(event.payload.fact);
  if ((!decisionResult.success && !resolutionResult.success) || !factResult.success) {
    fail("FACT_EVENT_PAYLOAD_INVALID", `fact event payload 無效：${event.id}`);
  }
  const fact = factResult.data;
  let decisionId: string;
  let decisionActor: string;
  if (decisionResult.success) {
    decisionId = decisionResult.data.id;
    decisionActor = decisionResult.data.actor;
  } else {
    if (!resolutionResult.success) fail("FACT_EVENT_PAYLOAD_INVALID", `fact event payload 無效：${event.id}`);
    decisionId = resolutionResult.data.id;
    decisionActor = resolutionResult.data.actor;
  }
  const expectedKind = `fact.${fact.status}`;
  if (event.kind !== expectedKind || event.aggregate_id !== fact.id
    || (decisionResult.success && decisionResult.data.fact_id !== fact.id)) {
    fail("FACT_EVENT_IDENTITY_MISMATCH", `fact event 身份不符：${event.id}`);
  }
  const boundCandidateId = decisionResult.success
    ? bindings.get(decisionResult.data.id)?.candidate_occurrence_id ?? decisionResult.data.candidate_id
    : undefined;
  if (event.actor !== decisionActor
    || (decisionResult.success && !candidates.has(boundCandidateId!))) {
    fail("FACT_EVENT_DECISION_INVALID", `fact event decision/candidate 無效：${event.id}`);
  }
  const previous = facts.get(fact.id);
  if (fact.fact_revision !== (previous?.fact_revision ?? 0) + 1) {
    fail("FACT_REVISION_SEQUENCE_INVALID", `fact revision 不連續：${fact.id}`);
  }
  if (previous !== undefined) {
    const expectedIds = [...previous.decision_ids, decisionId];
    if (canonicalJson(fact.decision_ids) !== canonicalJson(expectedIds)) {
      fail("FACT_DECISION_HISTORY_INVALID", `fact decision history 不連續：${fact.id}`);
    }
  } else if (fact.decision_ids.length !== 1 || fact.decision_ids[0] !== decisionId || !decisionResult.success) {
    fail("FACT_DECISION_HISTORY_INVALID", `初始 fact decision history 無效：${fact.id}`);
  }
  if (fact.decision_id !== decisionId || (decisionResult.success && fact.status !== decisionResult.data.type)) {
    fail("FACT_DECISION_STATE_MISMATCH", `fact 狀態未由 decision 驅動：${fact.id}`);
  }
  facts.set(fact.id, fact);
}

function candidateIdentityBindings(
  events: readonly JournalEventEnvelope[],
  candidates: ReadonlyMap<string, FactCandidate>,
): Map<string, CandidateIdentityBinding> {
  const decisions = new Map(events.filter((event) => event.kind.startsWith("fact."))
    .map((event) => [event.id, event]));
  const bindings = new Map<string, CandidateIdentityBinding>();
  for (const event of events) {
    if (event.kind !== "candidate.identity_bound") continue;
    const parsed = candidateIdentityBindingSchema.safeParse(event.payload.binding);
    if (!parsed.success) fail("FACT_CANDIDATE_BINDING_INVALID", `candidate identity binding payload 無效：${event.id}`, parsed.error);
    const binding = parsed.data;
    const decisionEvent = decisions.get(binding.decision_id);
    const decision = reviewDecisionSchema.safeParse(decisionEvent?.payload.decision);
    const occurrence = candidates.get(binding.candidate_occurrence_id);
    if (event.id !== `candidate-identity-binding-${binding.decision_id}`
      || event.aggregate_id !== binding.decision_id
      || decisionEvent === undefined
      || decisionEvent.sequence >= event.sequence
      || !decision.success
      || decision.data.candidate_id !== binding.raw_candidate_id
      || occurrence === undefined
      || occurrence.id !== binding.candidate_occurrence_id
      || occurrence.extensions.source_candidate_id !== binding.raw_candidate_id
      || occurrence.extensions.source_batch_id !== binding.source_batch_id
      || bindings.has(binding.decision_id)) {
      fail("FACT_CANDIDATE_BINDING_INVALID", `candidate identity binding lineage 無效：${event.id}`);
    }
    bindings.set(binding.decision_id, binding);
  }
  return bindings;
}

export function projectFactEvents(
  events: readonly JournalEventEnvelope[],
  candidates: Map<string, FactCandidate>,
): FactProjection {
  const facts = new Map<string, Fact>();
  const conflicts = new Map<string, Conflict>();
  const bindings = candidateIdentityBindings(events, candidates);
  for (const event of events) {
    if (event.kind.startsWith("fact.")) {
      assertFactEvent(event, candidates, facts, bindings);
      continue;
    }
    if (event.kind === "candidate.identity_bound") continue;
    if (event.kind === "conflict.opened") {
      const parsed = conflictSchema.safeParse(event.payload.conflict);
      if (!parsed.success || parsed.data.id !== event.aggregate_id || parsed.data.status !== "open") {
        fail("CONFLICT_EVENT_PAYLOAD_INVALID", `conflict.opened payload 無效：${event.id}`, parsed.success ? undefined : parsed.error);
      }
      conflicts.set(parsed.data.id, parsed.data);
      continue;
    }
    if (event.kind === "conflict.resolved") {
      const decision = resolutionDecisionSchema.safeParse(event.payload.decision);
      const conflict = conflictSchema.safeParse(event.payload.conflict);
      if (!decision.success || !conflict.success
        || decision.data.id !== event.id
        || decision.data.conflict_id !== event.aggregate_id
        || conflict.data.id !== event.aggregate_id
        || conflict.data.resolution_decision_id !== decision.data.id
        || (decision.data.type === "unresolved" ? conflict.data.status !== "open" : conflict.data.status !== "resolved")) {
        fail("CONFLICT_RESOLUTION_EVENT_INVALID", `conflict.resolved payload 無效：${event.id}`);
      }
      if (!conflicts.has(conflict.data.id)) fail("CONFLICT_NOT_OPEN", `resolution 找不到已開啟 conflict：${conflict.data.id}`);
      conflicts.set(conflict.data.id, conflict.data);
      continue;
    }
    if (event.kind.startsWith("candidate.")) {
      if (!candidates.has(event.aggregate_id)) {
        fail("FACT_JOURNAL_AGGREGATE_UNKNOWN", `candidate event aggregate 不存在：${event.aggregate_id}`);
      }
      continue;
    }
    fail("FACT_JOURNAL_EVENT_UNSUPPORTED", `decision journal 不支援 event：${event.kind}`);
  }
  return finalizeProjection([...facts.values()], [...conflicts.values()]);
}

export async function readFactProjection(projectRoot: string): Promise<RawProjection> {
  try {
    const [registerText, conflictsText] = await Promise.all([
      readFile(await resolveExistingWithin(projectRoot, FACT_REGISTER_PATH), "utf8"),
      readFile(await resolveExistingWithin(projectRoot, CONFLICT_REGISTER_PATH), "utf8"),
    ]);
    return {
      registerText,
      conflictsText,
      register: factRegisterSchema.parse(parseYaml(registerText)),
      conflicts: conflictRegisterSchema.parse(parseYaml(conflictsText)),
    };
  } catch (error) {
    fail("FACT_PROJECTION_INVALID", "無法讀取 fact projection", error);
  }
}

function assertProjectionRevision(projection: FactProjection): void {
  const factState = {
    schema_version: projection.register.schema_version,
    facts: projection.register.facts,
    extensions: projection.register.extensions,
  };
  const conflictState = {
    schema_version: projection.conflicts.schema_version,
    conflicts: projection.conflicts.conflicts,
    extensions: projection.conflicts.extensions,
  };
  if (projection.register.revision !== revisionForRegister(factState)) {
    fail("FACT_PROJECTION_REVISION_MISMATCH", "fact register semantic revision 不符");
  }
  if (projection.conflicts.revision !== revisionForConflicts(conflictState)) {
    fail("CONFLICT_PROJECTION_REVISION_MISMATCH", "conflict register semantic revision 不符");
  }
}

async function rebuildInMemory(projectRoot: string, journal?: JournalVerification): Promise<FactProjection> {
  const [candidates, verifiedJournal] = await Promise.all([
    readHistoricalCandidateIndex(projectRoot),
    journal === undefined ? readFactJournal(projectRoot) : Promise.resolve(journal),
  ]);
  const projection = projectFactEvents(verifiedJournal.events, candidates);
  assertProjectionRevision(projection);
  return projection;
}

export async function verifyFactProjection(projectRoot: string): Promise<FactProjection> {
  const [current, rebuilt] = await Promise.all([readFactProjection(projectRoot), rebuildInMemory(projectRoot)]);
  assertProjectionRevision(current);
  if (canonicalJson(current.register) !== canonicalJson(rebuilt.register)
    || canonicalJson(current.conflicts) !== canonicalJson(rebuilt.conflicts)) {
    fail("FACT_PROJECTION_DIVERGED", "fact projection 與 immutable batches/decisions 重建結果不同");
  }
  return { register: current.register, conflicts: current.conflicts };
}

export async function rebuildFactProjection(projectRoot: string): Promise<FactProjection> {
  const [current, journal] = await Promise.all([readFactProjection(projectRoot), readFactJournal(projectRoot)]);
  const staged = await rebuildInMemory(projectRoot, journal);
  await runFileTransaction({
    root: projectRoot,
    operations: [
      {
        relativePath: FACT_REGISTER_PATH,
        content: canonicalYaml(staged.register),
        expectedRawRevision: computeTextRevision(current.registerText),
      },
      {
        relativePath: CONFLICT_REGISTER_PATH,
        content: canonicalYaml(staged.conflicts),
        expectedRawRevision: computeTextRevision(current.conflictsText),
      },
    ],
    expectations: [{ relativePath: "facts/decisions.jsonl", expectedRawRevision: computeTextRevision(journal.rawText) }],
  });
  return staged;
}
