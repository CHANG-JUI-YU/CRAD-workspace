import type {
  Conflict,
  CandidateIdentityBinding,
  Fact,
  FactCandidate,
  FactClassification,
  JsonObject,
  ResolutionDecision,
  ReviewDecision,
  Revision,
} from "@card-workspace/schemas";
import { candidateIdentityBindingSchema, reviewDecisionSchema } from "@card-workspace/schemas";
import {
  canonicalYaml,
  canonicalize,
  computeTextRevision,
  runFileTransaction,
} from "@card-workspace/project";

import { readActiveCandidateIndex, resolveActiveCandidate } from "./active-candidates.js";
import { evaluateFactCandidate } from "./deduplicate.js";
import { diagnoseFactCandidateQuality } from "./fact-quality.js";
import { validateResolutionDecision, validateReviewDecision } from "./decisions.js";
import {
  appendJournalEvents,
  FACT_DECISIONS_PATH,
  readFactJournal,
  type JournalVerification,
  type NewJournalEvent,
} from "./journal.js";
import {
  CONFLICT_REGISTER_PATH,
  FACT_REGISTER_PATH,
  projectFactEvents,
  readHistoricalCandidateIndex,
  readFactProjection,
} from "./projector.js";
import { readSourceManifest } from "./source-manifest.js";
import { IngestionError } from "./types.js";

type FactPatch = Partial<Pick<Fact,
  | "subject" | "predicate" | "value" | "classification" | "confidence"
  | "scope" | "valid_time" | "evidence" | "source_tiers" | "supersedes" | "superseded_by" | "extensions"
>>;

export interface ReviewCandidateInput {
  decision: unknown;
  expectedProjectionRevision: Revision;
  expectedFactRevision?: number;
  patch?: FactPatch;
}

export interface ResolveConflictInput {
  decision: unknown;
  expectedProjectionRevision: Revision;
  expectedFactRevisions?: Readonly<Record<string, number>>;
}

export interface MigrateCandidateIdentityInput {
  decisionId: string;
  expectedProjectionRevision: Revision;
  actor: string;
  occurredAt: string;
}

export interface QueryFactsFilter {
  status?: Fact["status"];
  subject?: string;
  predicate?: string;
  classification?: FactClassification;
  sourceId?: string;
  gateStatus?: "clear" | "blocked_unresolved_conflict";
}

export interface QueryFactsResult {
  projection_revision: Revision;
  facts: Array<{ fact: Fact; gate_status: "clear" | "blocked_unresolved_conflict"; conflict_ids: string[] }>;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new IngestionError(code, message, cause);
}

function asPayload(value: unknown): JsonObject {
  const canonical = canonicalize(value);
  if (canonical === null || Array.isArray(canonical) || typeof canonical !== "object") {
    throw new TypeError("journal payload 必須是 object");
  }
  return canonical;
}

function assertProjectionExpectation(actual: Revision, expected: Revision): void {
  if (actual !== expected) {
    fail("FACT_PROJECTION_STALE", `fact projection revision 衝突：預期 ${expected}，實際 ${actual}`);
  }
}

async function commitEvents(
  projectRoot: string,
  current: Awaited<ReturnType<typeof readFactProjection>>,
  journal: JournalVerification,
  additions: NewJournalEvent[],
): Promise<ReturnType<typeof projectFactEvents>> {
  const candidates = await readHistoricalCandidateIndex(projectRoot);
  const appended = appendJournalEvents(journal, additions);
  const projected = projectFactEvents(appended.events, candidates);
  await runFileTransaction({
    root: projectRoot,
    operations: [
      {
        relativePath: FACT_DECISIONS_PATH,
        content: appended.rawText,
        expectedRawRevision: computeTextRevision(journal.rawText),
      },
      {
        relativePath: FACT_REGISTER_PATH,
        content: canonicalYaml(projected.register),
        expectedRawRevision: computeTextRevision(current.registerText),
      },
      {
        relativePath: CONFLICT_REGISTER_PATH,
        content: canonicalYaml(projected.conflicts),
        expectedRawRevision: computeTextRevision(current.conflictsText),
      },
    ],
  });
  return projected;
}

function reviewedFact(
  candidate: FactCandidate,
  decision: ReviewDecision,
  previous: Fact | undefined,
  sourceTiers: Fact["source_tiers"],
  patch: FactPatch | undefined,
): Fact {
  const base = previous ?? {
    schema_version: 1 as const,
    id: decision.fact_id,
    subject: candidate.subject,
    predicate: candidate.predicate,
    value: candidate.value,
    classification: candidate.classification,
    confidence: candidate.confidence,
    scope: candidate.scope,
    valid_time: candidate.valid_time,
    evidence: candidate.evidence,
    source_tiers: sourceTiers,
    created_by: candidate.created_by,
    created_at: candidate.created_at,
    supersedes: [],
    extensions: {},
  };
  return {
    ...base,
    ...patch,
    id: decision.fact_id,
    status: decision.type,
    fact_revision: (previous?.fact_revision ?? 0) + 1,
    decision_id: decision.id,
    decision_ids: [...(previous?.decision_ids ?? []), decision.id],
  };
}

export async function reviewCandidate(projectRoot: string, input: ReviewCandidateInput) {
  const callerDecision = validateReviewDecision(input.decision);
  const [current, journal, candidates, historicalCandidates, manifest] = await Promise.all([
    readFactProjection(projectRoot),
    readFactJournal(projectRoot),
    readActiveCandidateIndex(projectRoot),
    readHistoricalCandidateIndex(projectRoot),
    readSourceManifest(projectRoot),
  ]);
  assertProjectionExpectation(current.register.revision, input.expectedProjectionRevision);
  const candidate = resolveActiveCandidate(candidates.candidates, callerDecision.candidate_id);
  const usesLegacyRawId = !candidates.candidates.has(callerDecision.candidate_id);
  if (candidate === undefined || (usesLegacyRawId && !historicalCandidates.has(callerDecision.candidate_id))) {
    fail("FACT_CANDIDATE_NOT_ACTIVE", `candidate 不屬於 active curation：${callerDecision.candidate_id}`);
  }
  const decision = reviewDecisionSchema.parse({ ...callerDecision, candidate_id: candidate.id });
  if (decision.type !== "rejected" && diagnoseFactCandidateQuality(candidate).length > 0) {
    fail("FACT_CANDIDATE_QUALITY_DENIED", `不合格 candidate 只能被 rejected：${decision.candidate_id}`);
  }
  const previous = current.register.facts.find((fact) => fact.id === decision.fact_id);
  if (previous !== undefined) {
    if (input.expectedFactRevision === undefined || input.expectedFactRevision !== previous.fact_revision) {
      fail("FACT_REVISION_STALE", `fact revision 衝突：${decision.fact_id}`);
    }
  } else if (input.expectedFactRevision !== undefined) {
    fail("FACT_REVISION_STALE", `新 fact 不接受 expected fact revision：${decision.fact_id}`);
  }
  if (previous?.status === "accepted" && input.patch !== undefined && input.expectedFactRevision === undefined) {
    fail("FACT_ACCEPTED_PATCH_REQUIRES_REVISION", `accepted fact 修改需要 expected fact revision：${decision.fact_id}`);
  }
  const tiers = [...new Set(candidate.evidence.map((item) =>
    manifest.sources.find((source) => source.id === item.source_id)?.tier ?? "unknown"))];
  const fact = reviewedFact(candidate, decision, previous, tiers.length > 0 ? tiers : ["unknown"], input.patch);
  const additions: NewJournalEvent[] = [{
    id: decision.id,
    kind: `fact.${decision.type}`,
    aggregate_id: fact.id,
    actor: decision.actor,
    timestamp: decision.decided_at,
    payload: asPayload({ decision, fact }),
  }];

  if (decision.type === "accepted" && previous === undefined) {
    const evaluation = evaluateFactCandidate({
      candidate,
      register: current.register,
      conflicts: current.conflicts,
    });
    if (evaluation.proposal.kind === "create_conflict" || evaluation.proposal.kind === "update_conflict") {
      const conflict: Conflict = {
        ...evaluation.proposal.conflict,
        members: evaluation.proposal.conflict.members.map((member) =>
          member.candidate_id === candidate.id
            ? { fact_id: fact.id, source_id: member.source_id, source_revision_id: member.source_revision_id, value: member.value }
            : member),
      };
      additions.push({
        id: `${decision.id}-conflict`,
        kind: "conflict.opened",
        aggregate_id: conflict.id,
        actor: decision.actor,
        timestamp: decision.decided_at,
        payload: asPayload({ conflict }),
      });
    }
  }
  const projection = await commitEvents(projectRoot, current, journal, additions);
  return { fact: projection.register.facts.find((item) => item.id === fact.id)!, projection };
}

function parseCandidateIdentityBinding(event: JournalVerification["events"][number]): CandidateIdentityBinding | undefined {
  if (event.kind !== "candidate.identity_bound") return undefined;
  const parsed = candidateIdentityBindingSchema.safeParse(event.payload.binding);
  if (!parsed.success) fail("FACT_CANDIDATE_BINDING_INVALID", `candidate identity binding payload 無效：${event.id}`, parsed.error);
  return parsed.data;
}

export async function migrateCandidateIdentity(projectRoot: string, input: MigrateCandidateIdentityInput) {
  const [current, journal, candidates] = await Promise.all([
    readFactProjection(projectRoot),
    readFactJournal(projectRoot),
    readHistoricalCandidateIndex(projectRoot),
  ]);
  assertProjectionExpectation(current.register.revision, input.expectedProjectionRevision);
  const existing = journal.events.map(parseCandidateIdentityBinding).find((binding) => binding?.decision_id === input.decisionId);
  if (existing !== undefined) {
    projectFactEvents(journal.events, candidates);
    return { binding: existing, projection: current, idempotent: true };
  }
  const decisionEvent = journal.events.find((event) => event.id === input.decisionId && event.kind.startsWith("fact."));
  const decisionResult = reviewDecisionSchema.safeParse(decisionEvent?.payload.decision);
  if (!decisionResult.success) fail("FACT_CANDIDATE_BINDING_DECISION_NOT_FOUND", `找不到 legacy fact decision：${input.decisionId}`);
  const decision = decisionResult.data;
  if (candidates.get(decision.candidate_id)?.id === decision.candidate_id) {
    fail("FACT_CANDIDATE_IDENTITY_ALREADY_CANONICAL", `decision 已使用 exact candidate occurrence：${input.decisionId}`);
  }
  const matches = [...new Map([...candidates.values()].map((candidate) => [candidate.id, candidate])).values()].filter((candidate) =>
    candidate.id === candidate.extensions.source_candidate_id
      ? false
      : candidate.extensions.source_candidate_id === decision.candidate_id);
  if (matches.length !== 1) {
    fail("FACT_CANDIDATE_BINDING_AMBIGUOUS", `legacy candidate identity 無法唯一綁定：${decision.candidate_id}`);
  }
  const candidate = matches[0]!;
  const sourceBatchId = candidate.extensions.source_batch_id;
  if (typeof sourceBatchId !== "string") fail("FACT_CANDIDATE_BINDING_INVALID", `candidate 缺少 source batch lineage：${candidate.id}`);
  const binding = candidateIdentityBindingSchema.parse({
    schema_version: 1,
    decision_id: decision.id,
    raw_candidate_id: decision.candidate_id,
    candidate_occurrence_id: candidate.id,
    source_batch_id: sourceBatchId,
  });
  const projection = await commitEvents(projectRoot, current, journal, [{
    id: `candidate-identity-binding-${decision.id}`,
    kind: "candidate.identity_bound",
    aggregate_id: decision.id,
    actor: input.actor,
    timestamp: input.occurredAt,
    payload: asPayload({ binding }),
  }]);
  return { binding, projection, idempotent: false };
}

function resolutionFact(previous: Fact, decision: ResolutionDecision): Fact {
  let status = previous.status;
  if (decision.rejected_fact_ids.includes(previous.id)) {
    status = decision.type === "supersede" ? "superseded" : "rejected";
  } else if (decision.accepted_fact_ids.includes(previous.id)
    || decision.temporal_assignments.some((item) => item.fact_id === previous.id)
    || decision.scope_assignments.some((item) => item.fact_id === previous.id)) {
    status = "accepted";
  }
  const supersedes = decision.type === "supersede" && decision.accepted_fact_ids.includes(previous.id)
    ? [...new Set([...previous.supersedes, ...decision.rejected_fact_ids])]
    : previous.supersedes;
  return {
    ...previous,
    status,
    valid_time: decision.temporal_assignments.find((item) => item.fact_id === previous.id)?.valid_time ?? previous.valid_time,
    scope: decision.scope_assignments.find((item) => item.fact_id === previous.id)?.scope ?? previous.scope,
    fact_revision: previous.fact_revision + 1,
    decision_id: decision.id,
    decision_ids: [...previous.decision_ids, decision.id],
    supersedes,
    ...(decision.type === "supersede" && decision.rejected_fact_ids.includes(previous.id)
      ? { superseded_by: decision.accepted_fact_ids[0] }
      : {}),
  };
}

export async function resolveConflict(projectRoot: string, input: ResolveConflictInput) {
  const [current, journal] = await Promise.all([readFactProjection(projectRoot), readFactJournal(projectRoot)]);
  assertProjectionExpectation(current.register.revision, input.expectedProjectionRevision);
  const rawDecision = input.decision as { conflict_id?: string };
  const conflict = current.conflicts.conflicts.find((item) => item.id === rawDecision.conflict_id);
  if (conflict === undefined) fail("CONFLICT_NOT_FOUND", `找不到 conflict：${rawDecision.conflict_id ?? "unknown"}`);
  if (conflict.status !== "open") fail("CONFLICT_ALREADY_RESOLVED", `conflict 已裁決：${conflict.id}`);
  const decision = validateResolutionDecision(input.decision, conflict);
  const affectedIds = new Set([
    ...decision.accepted_fact_ids,
    ...decision.rejected_fact_ids,
    ...decision.temporal_assignments.map((item) => item.fact_id),
    ...decision.scope_assignments.map((item) => item.fact_id),
  ]);
  const facts = [...affectedIds].map((id) => {
    const previous = current.register.facts.find((fact) => fact.id === id);
    if (previous === undefined) fail("CONFLICT_FACT_NOT_FOUND", `conflict resolution 找不到 fact：${id}`);
    if (input.expectedFactRevisions?.[id] !== previous.fact_revision) {
      fail("FACT_REVISION_STALE", `conflict resolution fact revision 衝突：${id}`);
    }
    return resolutionFact(previous, decision);
  });
  const resolved: Conflict = {
    ...conflict,
    status: decision.type === "unresolved" ? "open" : "resolved",
    resolution_decision_id: decision.id,
    updated_at: decision.decided_at,
  };
  const additions: NewJournalEvent[] = facts.map((fact) => ({
    id: `${decision.id}-${fact.id}`,
    kind: `fact.${fact.status}`,
    aggregate_id: fact.id,
    actor: decision.actor,
    timestamp: decision.decided_at,
    payload: asPayload({ resolution_decision: decision, fact }),
  }));
  additions.push({
    id: decision.id,
    kind: "conflict.resolved",
    aggregate_id: conflict.id,
    actor: decision.actor,
    timestamp: decision.decided_at,
    payload: asPayload({ decision, conflict: resolved }),
  });
  const projection = await commitEvents(projectRoot, current, journal, additions);
  return { conflict: projection.conflicts.conflicts.find((item) => item.id === conflict.id)!, projection };
}

export async function queryFacts(projectRoot: string, filter: QueryFactsFilter = {}): Promise<QueryFactsResult> {
  const projection = await readFactProjection(projectRoot);
  const rows = projection.register.facts.map((fact) => {
    const conflictIds = projection.conflicts.conflicts
      .filter((conflict) => conflict.status === "open" && conflict.members.some((member) => member.fact_id === fact.id))
      .map((conflict) => conflict.id)
      .sort();
    return {
      fact,
      gate_status: conflictIds.length > 0 ? "blocked_unresolved_conflict" as const : "clear" as const,
      conflict_ids: conflictIds,
    };
  }).filter((row) =>
    (filter.status === undefined || row.fact.status === filter.status)
    && (filter.subject === undefined || row.fact.subject === filter.subject)
    && (filter.predicate === undefined || row.fact.predicate === filter.predicate)
    && (filter.classification === undefined || row.fact.classification === filter.classification)
    && (filter.sourceId === undefined || row.fact.evidence.some((item) => item.source_id === filter.sourceId))
    && (filter.gateStatus === undefined || row.gate_status === filter.gateStatus));
  return { projection_revision: projection.register.revision, facts: rows };
}
