import {
  contentHash,
  canonicalJson,
  internalId,
  CoreError,
  type FactClassification,
  type FactEvidenceReference,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewEvidenceContext,
  type FactReviewRunRecord,
  type ProjectState,
} from "@st-workspace/core";
import { FACT_REVIEW_POLICY_REVISION, factCandidateRevision } from "./fact-policy.js";
import { candidateOccurrenceForFact, latestDecisionForOccurrence, reviewRunProjectionRevision as canonicalReviewRunProjectionRevision } from "./fact-projection.js";

export interface FactReviewContextOptions {
  cursor?: string;
  limit?: number;
  source_id?: string;
  classification?: FactClassification;
  /** Internal execution identity. Strict reviewer agents receive a stable shard. */
  reviewer_identity?: string;
}

export interface FactReviewCandidateView {
  candidate_occurrence_id: string;
  fact_id: string;
  statement: string;
  subject?: string;
  predicate?: string;
  value?: string;
  classification?: FactClassification;
  entity_refs?: string[];
  coverage?: string[];
  status: FactRecord["status"];
  source_ids: string[];
  evidence: string[];
  evidence_refs?: FactEvidenceReference[];
  evidence_context?: FactReviewEvidenceContext[];
  candidate_revision: string;
  last_decision?: FactReviewDecisionRecord["decision"];
  last_reviewer_identity?: string;
}

export interface FactReviewContextPage {
  run?: FactReviewRunRecord;
  projection_revision?: string;
  candidates: FactReviewCandidateView[];
  next_cursor?: string;
}

const FACT_REVIEW_CURSOR_VERSION = 1;

interface FactReviewCursorPayload {
  v: 1;
  run?: string;
  set: string;
  source?: string;
  classification?: string;
  reviewer?: string;
  after?: string;
}

function encodeFactReviewCursor(payload: FactReviewCursorPayload): string {
  return `fr:${FACT_REVIEW_CURSOR_VERSION}:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function decodeFactReviewCursor(raw: string): FactReviewCursorPayload | undefined {
  const parts = raw.split(":");
  if (parts.length !== 3 || parts[0] !== "fr" || parts[1] !== `${FACT_REVIEW_CURSOR_VERSION}`) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[2] ?? "", "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    if (record.v !== FACT_REVIEW_CURSOR_VERSION || typeof record.set !== "string" || record.set.length === 0) return undefined;
    if (record.run !== undefined && typeof record.run !== "string") return undefined;
    if (record.source !== undefined && typeof record.source !== "string") return undefined;
    if (record.classification !== undefined && typeof record.classification !== "string") return undefined;
    if (record.reviewer !== undefined && typeof record.reviewer !== "string") return undefined;
    if (record.after !== undefined && typeof record.after !== "string") return undefined;
    return {
      v: FACT_REVIEW_CURSOR_VERSION,
      set: record.set,
      ...(record.run === undefined ? {} : { run: record.run }),
      ...(record.source === undefined ? {} : { source: record.source }),
      ...(record.classification === undefined ? {} : { classification: record.classification }),
      ...(record.reviewer === undefined ? {} : { reviewer: record.reviewer }),
      ...(record.after === undefined ? {} : { after: record.after }),
    };
  } catch {
    return undefined;
  }
}

function reviewerShard(reviewerIdentity: string | undefined): number | undefined {
  const match = reviewerIdentity?.match(/^fact-reviewer-([123])$/u);
  return match?.[1] === undefined ? undefined : Number(match[1]) - 1;
}

function occurrenceShard(occurrenceId: string): number {
  return Number.parseInt(contentHash(occurrenceId).slice(0, 8), 16) % 3;
}

function hasTerminalDecision(state: ProjectState, run: FactReviewRunRecord, occurrenceId: string): boolean {
  const decision = latestDecisionForOccurrence(state.fact_review_decisions, run.id, occurrenceId);
  return decision?.decision === "accepted" || decision?.decision === "rejected";
}

/**
 * Occurrence ids whose candidate content no longer matches the revision
 * snapshot captured when the run was created. Already settled occurrences
 * (accepted/rejected) are intentionally excluded: their resulting fact
 * revision change must not stale the whole run.
 */
export function unresolvedRevisionMismatch(state: ProjectState, run: FactReviewRunRecord): string[] {
  const mismatched: string[] = [];
  for (const occurrenceId of run.candidate_occurrence_ids) {
    if (hasTerminalDecision(state, run, occurrenceId)) continue;
    if (latestDecisionForOccurrence(state.fact_review_decisions, run.id, occurrenceId) !== undefined) continue;
    const fact = state.facts.find((item) => candidateOccurrenceForFact(item) === occurrenceId);
    if (fact === undefined) {
      mismatched.push(occurrenceId);
      continue;
    }
    const snapshot = run.candidate_revisions?.[occurrenceId];
    if (snapshot === undefined || snapshot !== factCandidateRevision(fact, state.sources)) mismatched.push(occurrenceId);
  }
  return mismatched;
}

function sourceUrl(state: ProjectState, sourceId: string): string | undefined {
  const source = state.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) return undefined;
  const candidate = state.candidates.find((item) => item.id === source.candidate_id);
  return source.canonical_url ?? source.final_url ?? candidate?.canonical_url ?? candidate?.final_url ?? candidate?.url;
}

function headingText(line: string): string | undefined {
  const value = line.trim();
  if (value.length === 0) return undefined;
  const markdown = value.match(/^#{1,6}\s+(.+)$/u);
  if (markdown?.[1] !== undefined) return markdown[1].trim();
  if (value.length > 120 || /[。！？!?；;:：,.，]/u.test(value)) return undefined;
  if (/^(?:https?:\/\/|www\.)/iu.test(value)) return undefined;
  return value;
}

function boundedSourceContext(state: ProjectState, sourceId: string, reference: FactEvidenceReference, fallbackQuote?: string): FactReviewEvidenceContext | undefined {
  const source = state.sources.find((candidate) => candidate.id === sourceId);
  if (source === undefined) return undefined;
  const quote = reference.quote.trim() || fallbackQuote?.trim() || "";
  const chunk = reference.chunk_id === undefined
    ? state.knowledge_chunks.find((candidate) => candidate.source_id === source.id && quote.length > 0 && candidate.text.includes(quote))
    : state.knowledge_chunks.find((candidate) => candidate.id === reference.chunk_id && candidate.source_id === source.id);
  const sourceText = source.canonical_text;
  const chunkStart = chunk === undefined ? -1 : sourceText.indexOf(chunk.text);
  const quoteInChunk = chunk === undefined || chunkStart < 0 || quote.length === 0 ? -1 : chunk.text.indexOf(quote);
  const quoteStart = quoteInChunk >= 0 ? chunkStart + quoteInChunk : quote.length === 0 ? -1 : sourceText.indexOf(quote);
  const lines = sourceText.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let lineIndex = -1;
  if (quoteStart >= 0) {
    for (let index = 0; index < starts.length; index += 1) {
      if ((starts[index] ?? Number.POSITIVE_INFINITY) > quoteStart) break;
      lineIndex = index;
    }
  }
  const paragraphStart = lineIndex < 0 ? undefined : starts[lineIndex];
  const paragraphEnd = lineIndex < 0 ? undefined : paragraphStart! + (lines[lineIndex]?.length ?? 0);
  const previous = lineIndex > 0 ? lines.slice(0, lineIndex).reverse().find((line) => line.trim().length > 0)?.trim() : undefined;
  const following = lineIndex >= 0 ? lines.slice(lineIndex + 1).find((line) => line.trim().length > 0)?.trim() : undefined;
  let sectionHeading: string | undefined;
  if (lineIndex >= 0) {
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
      const heading = headingText(lines[index] ?? "");
      if (heading !== undefined) { sectionHeading = heading; break; }
    }
  }
  const url = sourceUrl(state, source.id);
  return {
    source_id: source.id,
    source_title: source.title,
    ...(url === undefined ? {} : { source_url: url }),
    source_revision: source.revision,
    ...(chunk === undefined ? {} : { chunk_id: chunk.id, chunk_hash: chunk.hash }),
    ...(sectionHeading === undefined ? {} : { section_heading: sectionHeading }),
    ...(paragraphStart === undefined || paragraphEnd === undefined ? {} : { paragraph: sourceText.slice(paragraphStart, paragraphEnd).trim() }),
    ...(previous === undefined ? {} : { preceding_context: previous }),
    ...(following === undefined ? {} : { following_context: following }),
    ...(quoteStart < 0 ? {} : { evidence_span: { start: quoteStart, end: quoteStart + quote.length, quote } }),
  };
}

function evidenceContextForFact(state: ProjectState, fact: FactRecord): FactReviewEvidenceContext[] {
  const references = fact.evidence_refs ?? [];
  const fallbackReferences = references.length > 0
    ? references
    : fact.source_ids.map((sourceId, index) => ({
      source_id: sourceId,
      source_revision_id: state.sources.find((source) => source.id === sourceId)?.revision ?? "unknown",
      quote: fact.evidence[index] ?? fact.statement,
    }));
  const contexts = fallbackReferences.flatMap((reference) => {
    const context = boundedSourceContext(state, reference.source_id, reference, fact.statement);
    return context === undefined ? [] : [context];
  });
  const unique = new Map<string, FactReviewEvidenceContext>();
  for (const context of contexts) unique.set(`${context.source_id}:${context.evidence_span?.start ?? -1}:${context.chunk_id ?? ""}`, context);
  return [...unique.values()];
}

export function buildFactReviewContext(state: ProjectState, options: FactReviewContextOptions = {}): FactReviewContextPage {
  const run = [...state.fact_review_runs].reverse().find((candidate) => candidate.status === "open" || candidate.status === "blocked");
  if (run !== undefined && unresolvedRevisionMismatch(state, run).length > 0) {
    throw new CoreError("FACT_REVIEW_RUN_STALE", `Review run ${run.id} no longer matches the current fact candidates; start a new review run.`, true);
  }
  const occurrenceShardId = reviewerShard(options.reviewer_identity);
  const occurrenceBase = (run?.candidate_occurrence_ids ?? state.facts.filter((fact) => fact.status === "candidate").map(candidateOccurrenceForFact).sort())
    .filter((occurrenceId) => occurrenceShardId === undefined || occurrenceShard(occurrenceId) === occurrenceShardId);
  const cursor = options.cursor === undefined ? undefined : decodeFactReviewCursor(options.cursor);
  if (options.cursor !== undefined && cursor === undefined) {
    throw new CoreError("FACT_REVIEW_CURSOR_INVALID", "The review cursor is not a valid opaque cursor; discard it and start from the first page.", true);
  }
  if (cursor !== undefined) {
    if (cursor.run !== run?.id) {
      throw new CoreError("FACT_REVIEW_CURSOR_STALE", "The review cursor belongs to a different or superseded review run; discard it and start from the first page.", true);
    }
    if (cursor.set !== (run?.candidate_set_revision ?? "none")) {
      throw new CoreError("FACT_REVIEW_CURSOR_STALE", "The review cursor was issued against a different candidate set; discard it and start from the first page.", true);
    }
    if (cursor.source !== options.source_id || cursor.classification !== options.classification || cursor.reviewer !== options.reviewer_identity) {
      throw new CoreError("FACT_REVIEW_CURSOR_INVALID", "The review cursor does not match the requested filters; discard it and start from the first page.", true);
    }
  }
  let startIndex = 0;
  if (cursor?.after !== undefined) {
    const afterIndex = occurrenceBase.indexOf(cursor.after);
    if (afterIndex < 0) {
      throw new CoreError("FACT_REVIEW_CURSOR_STALE", "The review cursor points past the current candidate set; discard it and start from the first page.", true);
    }
    startIndex = afterIndex + 1;
  }
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const page: FactReviewCandidateView[] = [];
  let lastScanned: string | undefined = cursor?.after;
  for (let index = startIndex; index < occurrenceBase.length && page.length < limit; index += 1) {
    const occurrenceId = occurrenceBase[index]!;
    lastScanned = occurrenceId;
    const fact = state.facts.find((item) => candidateOccurrenceForFact(item) === occurrenceId);
    if (fact === undefined) continue;
    if (options.source_id !== undefined && !fact.source_ids.includes(options.source_id)) continue;
    if (options.classification !== undefined && fact.classification !== options.classification) continue;
    const lastDecision = run === undefined ? undefined : latestDecisionForOccurrence(state.fact_review_decisions, run.id, occurrenceId);
    if (lastDecision?.decision === "accepted" || lastDecision?.decision === "rejected") continue;
    const evidenceRefs = (fact.evidence_refs ?? []).map((reference) => {
      if (reference.chunk_id !== undefined) return reference;
      const chunk = state.knowledge_chunks.find((candidate) => candidate.source_id === reference.source_id && candidate.text.includes(reference.quote));
      return chunk === undefined ? reference : { ...reference, chunk_id: chunk.id, chunk_hash: chunk.hash };
    });
    const evidenceContext = evidenceContextForFact(state, fact);
    page.push({
      candidate_occurrence_id: occurrenceId,
      fact_id: fact.id,
      statement: fact.statement,
      ...(fact.subject === undefined ? {} : { subject: fact.subject }),
      ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
      ...(fact.value === undefined ? {} : { value: fact.value }),
      ...(fact.classification === undefined ? {} : { classification: fact.classification }),
      ...(fact.entity_refs === undefined ? {} : { entity_refs: fact.entity_refs }),
      ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
      status: fact.status,
      source_ids: fact.source_ids,
      evidence: fact.evidence,
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
      ...(evidenceContext.length === 0 ? {} : { evidence_context: evidenceContext }),
      candidate_revision: factCandidateRevision(fact, state.sources),
      ...(lastDecision === undefined ? {} : { last_decision: lastDecision.decision, last_reviewer_identity: lastDecision.reviewer_identity }),
    });
  }
  const hasMore = lastScanned !== undefined && occurrenceBase.indexOf(lastScanned) + 1 < occurrenceBase.length;
  const base: FactReviewContextPage = run === undefined
    ? { candidates: page }
    : { run, projection_revision: reviewProjectionRevision(state, run.id), candidates: page };
  if (!hasMore) return base;
  return {
    ...base,
    next_cursor: encodeFactReviewCursor({
      v: FACT_REVIEW_CURSOR_VERSION,
      ...(run === undefined ? {} : { run: run.id }),
      set: run?.candidate_set_revision ?? "none",
      ...(options.source_id === undefined ? {} : { source: options.source_id }),
      ...(options.classification === undefined ? {} : { classification: options.classification }),
      ...(options.reviewer_identity === undefined ? {} : { reviewer: options.reviewer_identity }),
      ...(lastScanned === undefined ? {} : { after: lastScanned }),
    }),
  };
}

export function reviewProjectionRevision(state: ProjectState, runId: string): string {
  return canonicalReviewRunProjectionRevision(state, runId);
}

export interface FactReviewRunPlan {
  readonly run?: FactReviewRunRecord;
  readonly supersede_run_ids: string[];
  readonly inferred_curation_run_id?: string;
}

export function prepareFactReviewRun(state: ProjectState, actor: string, curationRunId?: string): FactReviewRunPlan {
  const pending = state.facts.filter((fact) => fact.status === "candidate");
  const inferredCurationRunId = curationRunId ?? [...state.audit].reverse().find((event) => event.event === "fact.curation.applied" || event.event === "knowledge.refreshed")?.operation_id;
  const sourceRevisions: FactReviewRunRecord["source_revisions"] = state.sources
    .filter((source) => pending.some((fact) => fact.source_ids.includes(source.id)))
    .map((source) => ({ source_id: source.id, revision: source.revision }))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  const candidateOccurrenceIds = pending.map(candidateOccurrenceForFact).sort();
  const pendingOccurrenceSet = new Set(candidateOccurrenceIds);
  const activeRuns = [...state.fact_review_runs].reverse().filter((run) => {
    if (run.status !== "open" && run.status !== "blocked") return false;
    if (inferredCurationRunId !== undefined && run.curation_run_id !== inferredCurationRunId) return false;
    return true;
  });
  const openRun = activeRuns.find((run) => {
    if (run.candidate_occurrence_ids.some((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId))) {
      const settled = run.candidate_occurrence_ids.filter((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId));
      const settledDecisions = state.fact_review_decisions.filter((decision) => decision.review_run_id === run.id && settled.includes(decision.candidate_occurrence_id));
      if (settledDecisions.length === 0) return false;
    }
    if (!candidateOccurrenceIds.every((occurrenceId) => run.candidate_occurrence_ids.includes(occurrenceId))) return false;
    if (unresolvedRevisionMismatch(state, run).length > 0) return false;
    return run.source_revisions.every((sourceRevision) => state.sources.some((source) => source.id === sourceRevision.source_id && source.revision === sourceRevision.revision));
  });
  if (openRun !== undefined) return { run: openRun, supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  if (pending.length === 0) return { supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  const candidateSetRevision = contentHash(canonicalJson({
    curation_run_id: inferredCurationRunId,
    candidates: pending.map((fact) => ({ id: candidateOccurrenceForFact(fact), revision: factCandidateRevision(fact, state.sources) })).sort((left, right) => left.id.localeCompare(right.id)),
    source_revisions: sourceRevisions,
  }));
  const existing = state.fact_review_runs.find((run) => run.candidate_set_revision === candidateSetRevision && (inferredCurationRunId === undefined || run.curation_run_id === inferredCurationRunId) && run.status !== "superseded");
  if (existing !== undefined) return { run: existing, supersede_run_ids: [], ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }) };
  const run: FactReviewRunRecord = {
    schema_version: 1,
    id: internalId("fact_review_run"),
    ...(inferredCurationRunId === undefined ? {} : { curation_run_id: inferredCurationRunId }),
    candidate_set_revision: candidateSetRevision,
    candidate_occurrence_ids: candidateOccurrenceIds,
    source_revisions: sourceRevisions,
    candidate_revisions: Object.fromEntries(pending.map((fact) => [candidateOccurrenceForFact(fact), factCandidateRevision(fact, state.sources)] as const)),
    policy_revision: FACT_REVIEW_POLICY_REVISION,
    status: "open",
    created_by: actor,
    created_at: new Date().toISOString(),
  };
  return {
    run,
    supersede_run_ids: activeRuns.map((active) => active.id),
    ...(inferredCurationRunId === undefined ? {} : { inferred_curation_run_id: inferredCurationRunId }),
  };
}
