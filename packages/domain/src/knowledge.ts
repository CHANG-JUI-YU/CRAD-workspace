import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  coverageRequirementById,
  type FactClaim,
  type FactDecision,
  type FactEvidenceReference,
  type FactRecord,
  type FactClassification,
  type FactReviewDecisionStatus,
  type FactReviewDecisionRecord,
  type FactReviewEvidenceContext,
  type FactReviewPassRecord,
  type FactReviewRunRecord,
  type FactReviewRunStatus,
  type KnowledgeChunk,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type ResearchTaskRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { computeProjectProjection, createEntityMatcher } from "@st-workspace/core";
import { assertExecutionLease, assertExecutionLeaseForOperation, resolveExecutionActors, type ExecutionActorInput } from "./execution-context.js";
import {
  KNOWLEDGE_EXTRACTOR_REVISION as PIPELINE_EXTRACTOR_REVISION,
  chunkSource,
  sentenceCandidates as pipelineSentenceCandidates,
  splitIntoChunks as pipelineSplitIntoChunks,
} from "./source-chunking.js";
import {
  FACT_REVIEW_POLICY_REVISION as PIPELINE_FACT_REVIEW_POLICY_REVISION,
  GENERIC_PREDICATES as PIPELINE_GENERIC_PREDICATES,
  acceptedFactRevision,
  assertCoverageTargetsValid,
  assertStrictFactQuality as assertPipelineFactQuality,
  contradictingAcceptedFacts as pipelineContradictingAcceptedFacts,
  evidenceRevision,
  evidenceText as pipelineEvidenceText,
  factCandidateRevision as pipelineFactCandidateRevision,
  normalizeFactEntityRefs,
  strictEvidenceReferences as pipelineStrictEvidenceReferences,
} from "./fact-policy.js";
import {
  candidateOccurrenceForFact as pipelineCandidateOccurrenceForFact,
  factKey as pipelineFactKey,
  latestDecisionForOccurrence as pipelineLatestDecisionForOccurrence,
  mergeFactEvidence as pipelineMergeFactEvidence,
  reviewRunProjectionRevision as pipelineReviewRunProjectionRevision,
} from "./fact-projection.js";
import {
  claimToFact as pipelineClaimToFact,
  factFromSentence as pipelineFactFromSentence,
  mergeFactCandidates,
} from "./fact-candidate-store.js";
import { buildCurationCandidateBatch, curationRunIdForOperation } from "./fact-curation-service.js";
import { buildFactReviewContext, prepareFactReviewRun, reviewProjectionRevision, unresolvedRevisionMismatch, type FactReviewContextOptions } from "./fact-review-service.js";
import { applyLegacyFactReview } from "./fact-review-legacy-adapter.js";

export interface KnowledgeExecutionResult {
  chunks: string[];
  facts: string[];
  status: "completed" | "needs_input";
  summary: string;
}

/** Compatibility export; extraction implementation lives in source-chunking.ts. */
export const KNOWLEDGE_EXTRACTOR_REVISION = PIPELINE_EXTRACTOR_REVISION;

export interface FactReviewExecutionResult {
  fact_ids: string[];
  applied: number;
  skipped: number;
  conflicts: number;
  status: "completed" | "needs_input";
  summary: string;
}

export interface FactReviewRunExecutionResult {
  run: FactReviewRunRecord;
  status: "completed" | "needs_input";
  summary: string;
}

export function deriveReviewRunStatusAndResponse(
  state: ProjectState,
  runId: string,
  operationId: string,
  batchStats: { applied: number; skipped: number; conflicts: number },
  _targetIds: string[] = [],
  batchHasBlocker = false,
): { runStatus: FactReviewRunStatus; operationStatus: "needs_input" | "completed"; responseStatus: "needs_input" | "completed"; summary: string } {
  const run = state.fact_review_runs.find((r) => r.id === runId);
  if (run === undefined) {
    return {
      runStatus: "open",
      operationStatus: "needs_input",
      responseStatus: "needs_input",
      summary: `Fact review run ${runId} not found.`,
    };
  }
  const decisionsForRun = state.fact_review_decisions.filter((d) => d.review_run_id === run.id);
  const latestByOccurrence = new Map<string, FactReviewDecisionRecord>();
  for (const item of decisionsForRun) {
    latestByOccurrence.set(item.candidate_occurrence_id, item);
  }
  const complete = run.candidate_occurrence_ids.length > 0 && run.candidate_occurrence_ids.every((id) => latestByOccurrence.has(id));
  const hasBlocker = [...latestByOccurrence.values()].some((item) => item.decision === "needs_evidence" || item.decision === "conflict");

  let runStatus: FactReviewRunStatus;
  if (run.status === "superseded") {
    runStatus = "superseded";
  } else if (hasBlocker) {
    runStatus = "blocked";
  } else if (complete) {
    runStatus = "completed";
  } else {
    runStatus = "open";
  }

  const operationStatus = runStatus === "completed" ? "completed" : "needs_input";
  const responseStatus = batchHasBlocker ? "needs_input" : "completed";

  const statusText = runStatus === "completed" ? "completed" : runStatus === "blocked" ? "blocked (needs evidence or conflict resolution)" : "open (pending candidate decisions)";
  const summary = `Fact review run ${run.id}: applied=${batchStats.applied}, skipped=${batchStats.skipped}, conflict=${batchStats.conflicts}.${batchStats.skipped > 0 ? ` skipped ${batchStats.skipped} already-adjudicated candidates.` : ""} Run overall status: ${statusText}.`;

  return { runStatus, operationStatus, responseStatus, summary };
}

const FACT_REVIEW_POLICY_REVISION = PIPELINE_FACT_REVIEW_POLICY_REVISION;

function now(): string {
  return new Date().toISOString();
}

function updateOperation(operation: OperationRecord, patch: Partial<OperationRecord>): OperationRecord {
  return { ...operation, ...patch, updated_at: now() };
}

function splitIntoChunks(text: string, size = 800): string[] {
  const normalized = text.trim();
  if (normalized.length <= size) return normalized.length === 0 ? [] : [normalized];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    let end = Math.min(offset + size, normalized.length);
    if (end < normalized.length) {
      while (end > offset && normalized.charCodeAt(end - 1) >= 0xd800 && normalized.charCodeAt(end - 1) <= 0xdbff) end -= 1;
      const window = normalized.slice(offset, end);
      const boundary = Math.max(window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"), window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"), window.lastIndexOf("\n"));
      if (boundary > size * 0.5) end = offset + boundary + 1;
    }
    const chunk = normalized.slice(offset, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

function sentenceCandidates(text: string): string[] {
  return text
    .split(/(?:[.!?。！？]\s*|\n+)/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function factKey(fact: Pick<FactRecord, "statement" | "subject" | "predicate" | "value">): string {
  const structured = [fact.subject, fact.predicate, fact.value].filter((value): value is string => value !== undefined).join("|");
  return normalize(structured.length > 0 ? structured : fact.statement);
}

function mergeFactEvidence(target: FactRecord, extra: FactRecord): FactRecord {
  const sourceIds = [...new Set([...(target.source_ids ?? []), ...(extra.source_ids ?? [])])];
  const evidence = [...new Set([...(target.evidence ?? []), ...(extra.evidence ?? [])])];
  const refsByKey = new Map<string, FactEvidenceReference>();
  for (const reference of [...(target.evidence_refs ?? []), ...(extra.evidence_refs ?? [])]) {
    refsByKey.set(`${reference.source_id}:${reference.quote}`, reference);
  }
  return {
    ...target,
    source_ids: sourceIds,
    evidence,
    ...(refsByKey.size > 0 ? { evidence_refs: [...refsByKey.values()] } : {}),
  };
}

/** Coverage dimensions inferred from the auto-extraction classification. */
export function coverageForClassification(classification: FactClassification): string[] {
  switch (classification) {
    case "identity":
      return ["identity"];
    case "trait":
      return ["personality"];
    case "relationship":
      return ["relationships"];
    case "event":
      return ["background"];
    case "world":
      return ["world_context"];
    default:
      return [];
  }
}

/** Generic linking verbs and copulas that do not describe a contested attribute. */
const GENERIC_PREDICATES = new Set([
  "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had",
  "是", "為", "为", "係", "系",
]);

/**
 * Detect accepted facts that contradict each other on the same subject and
 * predicate but different values. Returns pairs that require Director review.
 * Generic linking predicates are skipped because they carry no contested
 * attribute (e.g. "X is direct" vs "X is observant" both describe traits).
 */
export function contradictingAcceptedFacts(facts: readonly FactRecord[]): Array<{ left: FactRecord; right: FactRecord }> {
  const accepted = facts.filter((fact) => fact.status === "accepted" && fact.subject !== undefined && fact.predicate !== undefined && fact.value !== undefined);
  const pairs: Array<{ left: FactRecord; right: FactRecord }> = [];
  for (let i = 0; i < accepted.length; i += 1) {
    for (let j = i + 1; j < accepted.length; j += 1) {
      const left = accepted[i]!;
      const right = accepted[j]!;
      const leftPredicate = normalize(left.predicate!);
      if (GENERIC_PREDICATES.has(leftPredicate)) continue;
      if (normalize(left.subject!) === normalize(right.subject!) && leftPredicate === normalize(right.predicate!) && normalize(left.value!) !== normalize(right.value!)) {
        pairs.push({ left, right });
      }
    }
  }
  return pairs;
}

function inferClassification(predicate: string): FactClassification {
  const normalized = predicate.toLocaleLowerCase();
  if (/name|identity|叫|名/u.test(normalized)) return "identity";
  if (/trait|personality|性格|特徵|特征|喜歡|喜欢|has/u.test(normalized)) return "trait";
  if (/relationship|friend|enemy|關係|关系|belongs/u.test(normalized)) return "relationship";
  if (/event|born|died|happened|comes from|發生|发生|來自|来自/u.test(normalized)) return "event";
  if (/world|location|place|located|lives in|世界|地點|地点|位於|位于/u.test(normalized)) return "world";
  return "other";
}

function structureSentence(sourceTitle: string, statement: string): Pick<FactRecord, "subject" | "predicate" | "value" | "classification"> {
  const english = statement.match(/^(.{1,120}?)\s+(is|are|has|have|likes|comes from|belongs to|born|died|located in|lives in)\s+(.+)$/iu);
  const chinese = statement.match(/^(.{1,120}?)(是|為|为|有|喜歡|喜欢|來自|来自|屬於|属于)(.+)$/u);
  const match = english ?? chinese;
  if (match !== null) {
    const subject = match[1]?.trim() || sourceTitle;
    const verb = match[2]?.trim() || "described_by";
    const value = match[3]?.trim() || statement;
    const predicate = verb.toLocaleLowerCase() === "is" || verb === "是" || verb === "為" || verb === "为" ? "has_property" : verb;
    return { subject, predicate, value, classification: inferClassification(predicate) };
  }
  return { subject: sourceTitle, predicate: "described_by", value: statement, classification: "other" };
}

function sourceMatches(source: SourceRecord, reference: string): boolean {
  const value = reference.trim().toLocaleLowerCase();
  return [source.id, source.candidate_id, source.title, source.original_name].filter((item): item is string => item !== undefined)
    .some((item) => item.toLocaleLowerCase() === value);
}

function evidenceText(evidence: { source: string; quote?: string | undefined; locator?: string | undefined }): string {
  return [evidence.source, evidence.quote, evidence.locator].filter((item): item is string => item !== undefined && item.trim().length > 0).join(" — ");
}

function candidateOccurrenceForFact(fact: FactRecord): string {
  return fact.candidate_occurrence_id ?? fact.id;
}

function sourceRevisionFor(source: SourceRecord): FactEvidenceReference {
  return { source_id: source.id, source_revision_id: source.revision, quote: source.title };
}

export function reviewRunProjectionRevision(state: { facts: readonly FactRecord[]; fact_review_decisions: readonly FactReviewDecisionRecord[]; fact_review_runs?: readonly FactReviewRunRecord[] }, runId: string): string {
  return pipelineReviewRunProjectionRevision(state, runId);
}

function latestDecisionForOccurrence(
  decisions: readonly FactReviewDecisionRecord[],
  runId: string,
  occurrenceId: string,
): FactReviewDecisionRecord | undefined {
  return [...decisions].reverse().find((decision) => decision.review_run_id === runId && decision.candidate_occurrence_id === occurrenceId);
}

function sourceForReference(sourceRecords: readonly SourceRecord[], reference: string): SourceRecord | undefined {
  return sourceRecords.find((source) => sourceMatches(source, reference));
}

function strictEvidenceReferences(
  decision: FactDecision,
  fact: FactRecord,
  sources: readonly SourceRecord[],
  chunks: readonly KnowledgeChunk[],
  strict: boolean,
): FactEvidenceReference[] {
  const explicit = ((decision as unknown as { evidence_refs?: FactEvidenceReference[] }).evidence_refs ?? []);
  const references: FactEvidenceReference[] = explicit.length > 0
    ? explicit.map((item) => ({
      ...(item.id === undefined ? {} : { id: item.id }),
      source_id: item.source_id,
      source_revision_id: item.source_revision_id,
      ...(item.chunk_set_id === undefined ? {} : { chunk_set_id: item.chunk_set_id }),
      ...(item.chunk_id === undefined ? {} : { chunk_id: item.chunk_id }),
      ...(item.chunk_hash === undefined ? {} : { chunk_hash: item.chunk_hash }),
      quote: item.quote,
      ...(item.character_range === undefined ? {} : { character_range: item.character_range }),
      ...(item.line_range === undefined ? {} : { line_range: item.line_range }),
      ...(item.locator === undefined ? {} : { locator: item.locator }),
    }))
    : decision.evidence.flatMap((item) => {
      const source = sourceForReference(sources, item.source);
      if (source === undefined || item.quote === undefined) return [];
      const chunk = chunks.find((candidate) => candidate.source_id === source.id && candidate.text.includes(item.quote!));
      if (chunk === undefined) return [];
      return [{ source_id: source.id, source_revision_id: source.revision, chunk_id: chunk.id, chunk_hash: chunk.hash, quote: item.quote, ...(item.locator === undefined ? {} : { locator: item.locator }) }];
    });
  const valid = references.filter((reference) => {
    const source = sources.find((candidate) => candidate.id === reference.source_id);
    if (source === undefined || source.revision !== reference.source_revision_id || !fact.source_ids.includes(source.id)) return false;
    if (reference.quote.trim().length === 0 || !source.canonical_text.includes(reference.quote)) return false;
    if (reference.chunk_id === undefined) return !strict;
    const chunk = chunks.find((candidate) => candidate.id === reference.chunk_id);
    return chunk !== undefined && chunk.source_id === source.id && (reference.chunk_hash === undefined || chunk.hash === reference.chunk_hash) && chunk.text.includes(reference.quote);
  });
  if (strict && (valid.length === 0 || valid.length !== references.length)) {
    throw new CoreError("FACT_REVIEW_EVIDENCE_INVALID", `Accepted fact ${fact.id} requires evidence that matches the current source and chunk revision.`, true);
  }
  return valid;
}

function assertStrictFactQuality(fact: FactRecord): void {
  if (fact.subject === undefined || fact.predicate === undefined || fact.value === undefined || fact.classification === undefined) {
    throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} must have subject, predicate, value and classification.`, true);
  }
  if ((fact.coverage ?? []).length === 0) {
    throw new CoreError("FACT_REVIEW_COVERAGE_MISSING", `Accepted fact ${fact.id} must declare at least one coverage dimension.`, true);
  }
  if (/(?:placeholder|dummy|fixture|lorem ipsum|test fact)/iu.test(fact.statement)) {
    throw new CoreError("FACT_REVIEW_QUALITY_INVALID", `Accepted fact ${fact.id} contains placeholder or test content.`, true);
  }
}

function claimToFact(claim: FactClaim, sourceRecords: SourceRecord[], actor: string): FactRecord {
  const statement = `${claim.subject} ${claim.predicate} ${claim.value}`.trim();
  const sourceIds = [...new Set(claim.evidence.flatMap((item) => sourceRecords.filter((source) => sourceMatches(source, item.source)).map((source) => source.id)))];
  return {
    id: internalId("fact"),
    candidate_occurrence_id: internalId("candidate_occurrence"),
    statement,
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.value,
    classification: claim.classification,
    coverage: claim.coverage,
    status: "candidate",
    confidence: claim.confidence,
    source_ids: sourceIds,
    evidence: claim.evidence.map(evidenceText),
    fact_revision: 1,
    created_at: now(),
    updated_at: now(),
    created_by: actor,
  };
}

function factFromSentence(source: SourceRecord, statement: string, actor: string): FactRecord {
  const structured = structureSentence(source.title, statement);
  return {
    id: internalId("fact"),
    candidate_occurrence_id: internalId("candidate_occurrence"),
    statement,
    ...structured,
    coverage: coverageForClassification(structured?.classification ?? "other"),
    status: "candidate",
    confidence: 0.7,
    source_ids: [source.id],
    evidence: [statement],
    evidence_refs: [{ source_id: source.id, source_revision_id: source.revision, quote: statement }],
    fact_revision: 1,
    created_at: now(),
    updated_at: now(),
    created_by: actor,
  };
}

export interface TaskBoundChunksAndHintsResult {
  task: ResearchTaskRecord;
  requirement_hints: Array<{
    id: string;
    path: string;
    label: string;
    query_terms: string[];
  }>;
  chunks: KnowledgeChunk[];
}

export function getTaskBoundChunksAndHints(state: ProjectState, taskId: string): TaskBoundChunksAndHintsResult {
  const task = state.coverage_research_tasks.find((t) => t.id === taskId);
  if (task === undefined) {
    throw new CoreError("COVERAGE_RESEARCH_TASK_STALE", `Research task "${taskId}" not found.`, true);
  }

  const requirementHints = task.requirement_ids.flatMap((id) => {
    const def = coverageRequirementById(id);
    return def === undefined ? [] : [{ id: def.id, path: def.path, label: def.label, query_terms: def.query_terms }];
  });

  const taskLineages = state.coverage_research_lineages.filter((l) => l.task_id === taskId);
  const candidateIds = new Set(taskLineages.map((l) => l.candidate_id).filter((id): id is string => id !== undefined));
  const sourceIds = new Set(state.sources.filter((s) => candidateIds.has(s.candidate_id)).map((s) => s.id));

  const chunks = sourceIds.size > 0
    ? state.knowledge_chunks.filter((c) => sourceIds.has(c.source_id))
    : state.knowledge_chunks;

  return { task, requirement_hints: requirementHints, chunks };
}

export class KnowledgeService {
  constructor(private readonly repository: ProjectRepository) {}

  /**
   * Source-adaptation natural requests only prepare clean chunks. Semantic
   * fact creation is reserved for typed fact_curation claims.
   */
  async prepareSourceAdaptationChunks(operationId: string, request: string, actorInput: ExecutionActorInput): Promise<KnowledgeExecutionResult> {
    const { executionAgent: actor, auditActor, context: execution } = resolveExecutionActors(actorInput);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    let committedChunks: string[] = [];
    let committedSummary = "";
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      const knownSourceIds = new Set(current.knowledge_chunks.map((chunk) => chunk.source_id));
      const sources = current.sources.filter((source) => !knownSourceIds.has(source.id));
      const chunks = sources.flatMap((source) => chunkSource(source, KNOWLEDGE_EXTRACTOR_REVISION));
      committedChunks = chunks.map((chunk) => chunk.id);
      committedSummary = chunks.length > 0
        ? `Prepared ${chunks.length} cleaned knowledge chunks; submit a typed fact_curation proposal to create fact candidates.`
        : "Clean knowledge chunks are already prepared; submit a typed fact_curation proposal to create fact candidates.";
      return {
        ...current,
        knowledge_chunks: [...current.knowledge_chunks, ...chunks],
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            status: "needs_input",
            question: "已準備乾淨來源分片。下一步請 Fact Curator 讀取 chunks 並提交 typed fact_curation；自然語言要求不會自動建立事實。",
            progress: [...item.progress, ...chunks.map((chunk) => ({ item_id: chunk.id, status: "completed" as const, message: "Clean source chunk prepared.", source_id: chunk.source_id }))],
            result_summary: committedSummary,
          })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "knowledge.chunks.prepared",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { request, source_ids: sources.map((source) => source.id), chunk_count: chunks.length, fact_count: 0, agent_id: actor },
        }],
      };
    });
    return { chunks: committedChunks, facts: [], status: "needs_input", summary: committedSummary };
  }

  async refresh(operationId: string, request: string, actorInput: ExecutionActorInput): Promise<KnowledgeExecutionResult> {
    const { executionAgent: actor, auditActor, context: execution } = resolveExecutionActors(actorInput);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const summary = "Extracted 0 knowledge chunks and 0 structured fact candidates.";
    let needsInput = false;
    let committedSummary = summary;
    let committedChunks: string[] = [];
    let committedFacts: string[] = [];
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      const currentKnownSourceIds = new Set(current.knowledge_chunks.map((chunk) => chunk.source_id));
      const currentSources = current.sources.filter((source) => !currentKnownSourceIds.has(source.id));
      if (currentSources.length === 0) {
        needsInput = true;
        committedSummary = "No new sources are available for knowledge refresh.";
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: "needs_input", question: "請先加入至少一個來源，再重新整理知識。", result_summary: committedSummary })
            : item),
        };
      }
      const chunks: KnowledgeChunk[] = currentSources.flatMap((source) => chunkSource(source));
      const existingFactsByKey = new Map(current.facts.map((fact) => [factKey(fact), fact]));
      const newFactsByKey = new Map<string, FactRecord>();
      const mergedFacts = new Map<string, FactRecord>();
      let mergedCount = 0;
      for (const source of currentSources) {
        for (const [sentenceIndex, statement] of sentenceCandidates(source.canonical_text).entries()) {
          const candidate = pipelineFactFromSentence(source, statement, actor, sentenceIndex, operationId);
          const key = factKey(candidate);
          const existing = existingFactsByKey.get(key);
          if (existing !== undefined) {
            const currentTarget = mergedFacts.get(existing.id) ?? existing;
            const merged = pipelineMergeFactEvidence(currentTarget, candidate, current.sources);
            const hasNewEvidence = merged.source_ids.length > currentTarget.source_ids.length
              || merged.evidence.length > currentTarget.evidence.length
              || (merged.evidence_refs?.length ?? 0) > (currentTarget.evidence_refs?.length ?? 0)
              || merged.evidence_revision !== currentTarget.evidence_revision;
            if (hasNewEvidence) {
              const wasAccepted = existing.status === "accepted";
              mergedFacts.set(existing.id, {
                ...merged,
                fact_revision: (currentTarget.fact_revision ?? 1) + 1,
                updated_at: now(),
                ...(wasAccepted ? { status: "candidate" as const } : {}),
              });
              mergedCount += 1;
            }
            continue;
          }
          const existingInBatch = newFactsByKey.get(key);
          if (existingInBatch !== undefined) {
            const merged = pipelineMergeFactEvidence(existingInBatch, candidate, current.sources);
            newFactsByKey.set(key, { ...merged, updated_at: now() });
            continue;
          }
          newFactsByKey.set(key, candidate);
        }
      }
      const facts = [...newFactsByKey.values()];
      const batchSummary = `Extracted ${chunks.length} knowledge chunks and ${facts.length} structured fact candidates${mergedCount > 0 ? `; merged ${mergedCount} corroborating evidence into existing facts.` : "."}`;
      committedSummary = batchSummary;
      committedChunks = chunks.map((chunk) => chunk.id);
      committedFacts = facts.map((fact) => fact.id);
      return {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        knowledge_chunks: [...current.knowledge_chunks, ...chunks],
        facts: current.facts.map((fact) => mergedFacts.get(fact.id) ?? fact).concat(facts),
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            status: "completed",
            progress: [
              ...item.progress,
              ...chunks.map((chunk) => ({ item_id: chunk.id, status: "completed" as const, message: "Knowledge chunk created.", source_id: chunk.source_id })),
              ...facts.map((fact) => ({ item_id: fact.id, status: "completed" as const, message: "Structured fact candidate created." })),
              ...[...mergedFacts.entries()].map(([factId]) => ({ item_id: factId, status: "completed" as const, message: "Corroborating evidence merged into existing fact." })),
            ],
            result_summary: batchSummary,
          })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "knowledge.refreshed",
          actor: auditActor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { source_ids: currentSources.map((source) => source.id), chunk_count: chunks.length, fact_count: facts.length, structured: true, ...(mergedCount > 0 ? { merged_count: mergedCount } : {}) },
        }],
      };
    });
    return { chunks: needsInput ? [] : committedChunks, facts: needsInput ? [] : committedFacts, status: needsInput ? "needs_input" : "completed", summary: committedSummary };
  }

  /**
   * Re-extracts chunks and fact candidates from already-known sources,
   * versioning every new chunk with the extractor revision so downstream
   * review runs can distinguish regenerated content.
   */
  async reextract(operationId: string, sourceIds: readonly string[], actor: string, extractorRevision: string = KNOWLEDGE_EXTRACTOR_REVISION): Promise<KnowledgeExecutionResult> {
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new CoreError("SOURCE_IDS_REQUIRED", "At least one source id is required for re-extraction.", true);
    }
    const missing = sourceIds.filter((id) => !initial.sources.some((source) => source.id === id));
    if (missing.length > 0) {
      throw new CoreError("SOURCE_NOT_FOUND", `Source ${missing[0]} does not exist.`, true);
    }
    let committedSummary = "Re-extracted 0 knowledge chunks and 0 structured fact candidates.";
    let committedChunks: string[] = [];
    let committedFacts: string[] = [];
    await this.repository.commit(initial.revision, (current) => {
      const chunks: KnowledgeChunk[] = sourceIds.flatMap((sourceId) => {
        const source = current.sources.find((candidate) => candidate.id === sourceId);
        return source === undefined ? [] : chunkSource(source, extractorRevision);
      });
      const existingFactsByKey = new Map(current.facts.map((fact) => [factKey(fact), fact]));
      const newFactsByKey = new Map<string, FactRecord>();
      const mergedFacts = new Map<string, FactRecord>();
      let mergedCount = 0;
      for (const sourceId of sourceIds) {
        const source = current.sources.find((candidate) => candidate.id === sourceId);
        if (source === undefined) continue;
        for (const [sentenceIndex, statement] of sentenceCandidates(source.canonical_text).entries()) {
          const candidate = pipelineFactFromSentence(source, statement, actor, sentenceIndex, operationId);
          const key = factKey(candidate);
          const existing = existingFactsByKey.get(key);
          if (existing !== undefined) {
            const currentTarget = mergedFacts.get(existing.id) ?? existing;
            const merged = pipelineMergeFactEvidence(currentTarget, candidate, current.sources);
            const hasNewEvidence = merged.source_ids.length > currentTarget.source_ids.length
              || merged.evidence.length > currentTarget.evidence.length
              || (merged.evidence_refs?.length ?? 0) > (currentTarget.evidence_refs?.length ?? 0)
              || merged.evidence_revision !== currentTarget.evidence_revision;
            if (hasNewEvidence) {
              mergedFacts.set(existing.id, {
                ...merged,
                fact_revision: (currentTarget.fact_revision ?? 1) + 1,
                updated_at: now(),
                ...(existing.status === "accepted" ? { status: "candidate" as const } : {}),
              });
              mergedCount += 1;
            }
            continue;
          }
          const existingInBatch = newFactsByKey.get(key);
          if (existingInBatch !== undefined) {
            const merged = pipelineMergeFactEvidence(existingInBatch, candidate, current.sources);
            newFactsByKey.set(key, { ...merged, updated_at: now() });
            continue;
          }
          newFactsByKey.set(key, candidate);
        }
      }
      const facts = [...newFactsByKey.values()];
      const batchSummary = `Re-extracted ${chunks.length} knowledge chunks and ${facts.length} structured fact candidates${mergedCount > 0 ? `; merged ${mergedCount} corroborating evidence into existing facts.` : "."}`;
      committedSummary = batchSummary;
      committedChunks = chunks.map((chunk) => chunk.id);
      committedFacts = facts.map((fact) => fact.id);
      return {
        ...current,
        ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
        knowledge_chunks: [...current.knowledge_chunks, ...chunks],
        facts: current.facts.map((fact) => mergedFacts.get(fact.id) ?? fact).concat(facts),
        operations: current.operations.map((item) => item.id === operationId
          ? updateOperation(item, {
            status: "completed",
            progress: [
              ...item.progress,
              ...chunks.map((chunk) => ({ item_id: chunk.id, status: "completed" as const, message: "Knowledge chunk re-extracted.", source_id: chunk.source_id })),
              ...facts.map((fact) => ({ item_id: fact.id, status: "completed" as const, message: "Structured fact candidate created." })),
              ...[...mergedFacts.entries()].map(([factId]) => ({ item_id: factId, status: "completed" as const, message: "Corroborating evidence merged into existing fact." })),
            ],
            result_summary: batchSummary,
          })
          : item),
        audit: [...current.audit, {
          id: internalId("audit"),
          operation_id: operationId,
          event: "knowledge.reextracted",
          actor,
          occurred_at: now(),
          project_revision: current.revision + 1,
          details: { source_ids: [...sourceIds], chunk_count: chunks.length, fact_count: facts.length, extractor_revision: extractorRevision, ...(mergedCount > 0 ? { merged_count: mergedCount } : {}) },
        }],
      };
    });
    return { chunks: committedChunks, facts: committedFacts, status: "completed", summary: committedSummary };
  }

  async applyCuration(operationId: string, claims: FactClaim[], actorInput: ExecutionActorInput, legacyAuditActor?: string): Promise<KnowledgeExecutionResult> {
    const { executionAgent: actor, auditActor, context: execution } = resolveExecutionActors(actorInput, legacyAuditActor);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const curationBatch = buildCurationCandidateBatch(initial, claims, actor, curationRunIdForOperation(operationId));
    const { chunks, facts, mergedFacts, mergedCount } = curationBatch;
    const summary = `Applied ${facts.length} structured fact candidates from curation${mergedCount > 0 ? `; merged ${mergedCount} corroborating evidence into existing facts.` : "."}`;
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
      knowledge_chunks: [...current.knowledge_chunks, ...chunks],
      facts: current.facts.map((fact) => mergedFacts.get(fact.id) ?? fact).concat(facts),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, ...facts.map((fact) => ({ item_id: fact.id, status: "completed" as const, message: "Fact curation applied." })), ...[...mergedFacts.entries()].map(([factId]) => ({ item_id: factId, status: "completed" as const, message: "Corroborating evidence merged into existing fact." }))], result_summary: summary })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"), operation_id: operationId, event: "fact.curation.applied", actor: auditActor, occurred_at: now(), project_revision: current.revision + 1,
        details: { fact_ids: facts.map((fact) => fact.id), claim_count: claims.length, agent_id: actor, ...(mergedCount > 0 ? { merged_count: mergedCount } : {}) },
      }],
      };
    });
    return { chunks: chunks.map((chunk) => chunk.id), facts: facts.map((fact) => fact.id), status: "completed", summary };
  }

  async beginFactReviewRun(operationId: string, actorInput: ExecutionActorInput, curationRunId?: string, legacyAuditActor?: string): Promise<FactReviewRunRecord> {
    const { executionAgent: actor, auditActor, context: execution } = resolveExecutionActors(actorInput, legacyAuditActor);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const pending = initial.facts.filter((fact) => fact.status === "candidate");
    const inferredCurationRunId = curationRunId ?? [...initial.audit].reverse().find((event) => event.event === "fact.curation.applied" || event.event === "knowledge.refreshed")?.operation_id;
    const sourceRevisions: FactReviewRunRecord["source_revisions"] = initial.sources
      .filter((source) => pending.some((fact) => fact.source_ids.includes(source.id)))
      .map((source) => ({ source_id: source.id, revision: source.revision }))
      .sort((left, right) => left.source_id.localeCompare(right.source_id));
    const candidateOccurrenceIds = pending.map(candidateOccurrenceForFact).sort();
    const pendingOccurrenceSet = new Set(candidateOccurrenceIds);
    const openRun = [...initial.fact_review_runs].reverse().find((run) => {
      if (run.status !== "open" && run.status !== "blocked") return false;
      if (inferredCurationRunId !== undefined && run.curation_run_id !== inferredCurationRunId) return false;
      if (run.candidate_occurrence_ids.some((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId))) {
        // A partially completed run is allowed to contain already settled
        // occurrences; new candidates are the only reason to start a successor.
        const settled = run.candidate_occurrence_ids.filter((occurrenceId) => !pendingOccurrenceSet.has(occurrenceId));
        const settledDecisions = initial.fact_review_decisions.filter((decision) => decision.review_run_id === run.id && settled.includes(decision.candidate_occurrence_id));
        if (settledDecisions.length === 0) return false;
      }
      if (!candidateOccurrenceIds.every((occurrenceId) => run.candidate_occurrence_ids.includes(occurrenceId))) return false;
      if (unresolvedRevisionMismatch(initial, run).length > 0) return false;
      return run.source_revisions.every((sourceRevision) => initial.sources.some((source) => source.id === sourceRevision.source_id && source.revision === sourceRevision.revision));
    });
    if (openRun !== undefined) return openRun;
    if (pending.length === 0) throw new CoreError("FACT_REVIEW_NO_CANDIDATES", "No fact candidates are available for review.", true);
    const candidateSetRevision = contentHash(canonicalJson({
      curation_run_id: inferredCurationRunId,
      candidates: pending.map((fact) => ({ id: candidateOccurrenceForFact(fact), revision: pipelineFactCandidateRevision(fact, initial.sources) })).sort((left, right) => left.id.localeCompare(right.id)),
      source_revisions: sourceRevisions,
    }));
    const existing = initial.fact_review_runs.find((run) =>
      run.candidate_set_revision === candidateSetRevision
      && (inferredCurationRunId === undefined || run.curation_run_id === inferredCurationRunId)
      && run.status !== "superseded");
    if (existing !== undefined) return existing;
    const run: FactReviewRunRecord = {
      schema_version: 1,
      id: internalId("fact_review_run"),
      ...(inferredCurationRunId === undefined ? {} : { curation_run_id: inferredCurationRunId }),
      candidate_set_revision: candidateSetRevision,
      candidate_occurrence_ids: candidateOccurrenceIds,
      source_revisions: sourceRevisions,
      candidate_revisions: Object.fromEntries(pending.map((fact) => [candidateOccurrenceForFact(fact), pipelineFactCandidateRevision(fact, initial.sources)] as const)),
      policy_revision: FACT_REVIEW_POLICY_REVISION,
      status: "open",
      created_by: actor,
      created_at: now(),
    };
    const successorOf = initial.fact_review_runs
      .filter((candidate) => (candidate.status === "open" || candidate.status === "blocked") && (inferredCurationRunId === undefined || candidate.curation_run_id === inferredCurationRunId))
      .map((candidate) => candidate.id);
    await this.repository.commit(initial.revision, (current) => {
      assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
      return {
      ...current,
      fact_review_runs: [
        ...current.fact_review_runs.map((candidate) => successorOf.includes(candidate.id) ? { ...candidate, status: "superseded" as const, successor_run_id: run.id } : candidate),
        run,
      ],
      audit: [...current.audit, {
        id: internalId("audit"),
        operation_id: operationId,
        event: "fact.review.run.created",
        actor: auditActor,
        occurred_at: now(),
        project_revision: current.revision + 1,
        details: { review_run_id: run.id, candidate_set_revision: run.candidate_set_revision, candidate_count: run.candidate_occurrence_ids.length, source_revisions: run.source_revisions, agent_id: actor },
      }],
      };
    });
    return run;
  }

  async factReviewContext(options: { cursor?: string; limit?: number; source_id?: string; classification?: FactClassification; reviewer_identity?: string } = {}): Promise<{
    run?: FactReviewRunRecord;
    projection_revision?: string;
    candidates: Array<{ candidate_occurrence_id: string; fact_id: string; statement: string; subject?: string; predicate?: string; value?: string; classification?: FactClassification; entity_refs?: string[]; coverage?: string[]; status: FactRecord["status"]; source_ids: string[]; evidence: string[]; evidence_refs?: FactEvidenceReference[]; evidence_context?: FactReviewEvidenceContext[]; candidate_revision: string; last_decision?: FactReviewDecisionRecord["decision"]; last_reviewer_identity?: string }>;
    next_cursor?: string;
  }> {
    return buildFactReviewContext(await this.repository.read(), options ?? {} satisfies FactReviewContextOptions);
    /* Legacy implementation retained in this comment only for migration review.
    const state = await this.repository.read();
    const run = [...state.fact_review_runs].reverse().find((candidate) => candidate.status === "open" || candidate.status === "blocked");
    const occurrenceIds = run?.candidate_occurrence_ids ?? state.facts.filter((fact) => fact.status === "candidate").map(candidateOccurrenceForFact);
    const candidates = occurrenceIds.flatMap((occurrenceId) => {
      const fact = state.facts.find((item) => candidateOccurrenceForFact(item) === occurrenceId);
      if (fact === undefined) return [];
      if (options?.source_id !== undefined && !fact.source_ids.includes(options.source_id)) return [];
      if (options?.classification !== undefined && fact.classification !== options.classification) return [];
      const lastDecision = run === undefined ? undefined : latestDecisionForOccurrence(state.fact_review_decisions, run.id, occurrenceId);
      // A successful decision is final for this run.  Blocked runs expose only
      // unresolved candidates so a reviewer can supply missing evidence; the
      // complete historical decision stream remains available in the register.
      if (lastDecision?.decision === "accepted" || lastDecision?.decision === "rejected") return [];
      const evidenceRefs = (fact.evidence_refs ?? []).map((reference) => {
        if (reference.chunk_id !== undefined) return reference;
        const chunk = state.knowledge_chunks.find((candidate) => candidate.source_id === reference.source_id && candidate.text.includes(reference.quote));
        return chunk === undefined ? reference : { ...reference, chunk_id: chunk.id, chunk_hash: chunk.hash };
      });
      return [{
        candidate_occurrence_id: occurrenceId,
        fact_id: fact.id,
        statement: fact.statement,
        ...(fact.subject === undefined ? {} : { subject: fact.subject }),
        ...(fact.predicate === undefined ? {} : { predicate: fact.predicate }),
        ...(fact.value === undefined ? {} : { value: fact.value }),
        ...(fact.classification === undefined ? {} : { classification: fact.classification }),
        ...(fact.coverage === undefined ? {} : { coverage: fact.coverage }),
        status: fact.status,
        source_ids: fact.source_ids,
        evidence: fact.evidence,
        ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
        candidate_revision: pipelineFactCandidateRevision(fact, state.sources),
        ...(lastDecision === undefined ? {} : { last_decision: lastDecision.decision, last_reviewer_identity: lastDecision.reviewer_identity }),
      }];
    });
    const cursorIndex = options?.cursor === undefined ? 0 : Number.parseInt(options.cursor.replace(/^index:/u, ""), 10);
    const effectiveCursor = Number.isFinite(cursorIndex) && cursorIndex >= 0 ? cursorIndex : 0;
    const limit = Math.min(options?.limit ?? 50, 200);
    const page = candidates.slice(effectiveCursor, effectiveCursor + limit);
    const nextCursor = effectiveCursor + page.length < candidates.length ? `index:${effectiveCursor + page.length}` : undefined;
    const base = run === undefined ? { candidates: page } : { run, projection_revision: reviewProjectionRevision(state, run.id), candidates: page };
    return nextCursor === undefined ? base : { ...base, next_cursor: nextCursor }; */
  }

  async applyReviewBatch(
    operationId: string,
    decisions: FactDecision[],
    actorInput: ExecutionActorInput,
    reviewerIdentity: string,
    reviewRunId?: string,
    expectedProjectionRevision?: string,
  ): Promise<FactReviewExecutionResult> {
    return this.applyReviewBatchAttempt(operationId, decisions, actorInput, reviewerIdentity, reviewRunId, expectedProjectionRevision, 0);
  }

  private async applyReviewBatchAttempt(
    operationId: string,
    decisions: FactDecision[],
    actorInput: ExecutionActorInput,
    reviewerIdentity: string,
    reviewRunId: string | undefined,
    expectedProjectionRevision: string | undefined,
    attempt: number,
  ): Promise<FactReviewExecutionResult> {
    const { auditActor: actor, context: execution } = resolveExecutionActors(actorInput);
    await assertExecutionLease(this.repository, execution);
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    if (!/^fact-reviewer-[123]$/u.test(reviewerIdentity) && reviewerIdentity !== "director") {
      throw new CoreError("FACT_REVIEWER_IDENTITY_INVALID", `Reviewer identity ${reviewerIdentity} is not trusted for the strict Review Run.`, true);
    }
    let run = reviewRunId === undefined
      ? [...initial.fact_review_runs].reverse().find((candidate) => candidate.status === "open" || candidate.status === "blocked")
      : initial.fact_review_runs.find((candidate) => candidate.id === reviewRunId);
    if (run === undefined) {
      run = await this.beginFactReviewRun(operationId, execution ?? reviewerIdentity, undefined, actor);
      return this.applyReviewBatchAttempt(operationId, decisions, actorInput, reviewerIdentity, run.id, expectedProjectionRevision, attempt);
    }
    if (decisions.length === 0) throw new CoreError("FACT_REVIEW_BATCH_EMPTY", "At least one fact review decision is required.", true);
    if (run.status === "completed" || run.status === "superseded") {
      const alreadySettled = decisions.every((decision) => {
        const occurrenceId = decision.candidate_occurrence_id
          ?? initial.facts.find((fact) => fact.id === decision.fact_id)?.candidate_occurrence_id
          ?? decision.fact_id;
        if (occurrenceId === undefined) return false;
        const previous = pipelineLatestDecisionForOccurrence(initial.fact_review_decisions, run!.id, occurrenceId);
        return previous?.decision === "accepted" || previous?.decision === "rejected";
      });
      if (alreadySettled) {
        const derived = deriveReviewRunStatusAndResponse(initial, run.id, operationId, { applied: 0, skipped: decisions.length, conflicts: 0 });
        return { fact_ids: [], applied: 0, skipped: decisions.length, conflicts: 0, status: derived.responseStatus, summary: derived.summary };
      }
      throw new CoreError("FACT_REVIEW_RUN_CLOSED", `Fact review run ${run.id} is no longer open.`, true);
    }
    const actualProjectionRevision = reviewProjectionRevision(initial, run.id);
    if (expectedProjectionRevision !== undefined && expectedProjectionRevision !== actualProjectionRevision) {
      throw new CoreError("FACT_PROJECTION_STALE", `Fact review projection is stale; expected ${expectedProjectionRevision}, found ${actualProjectionRevision}.`, true);
    }
    const targetIds: string[] = [];
    const records: FactReviewDecisionRecord[] = [];
    const updates = new Map<string, { decision: FactDecision; evidence: FactEvidenceReference[]; record: FactReviewDecisionRecord; entity_refs: string[]; coverage: string[]; coverage_targets?: string[] }>();
    const matcher = createEntityMatcher(initial);
    const strictFactPolicy = initial.interview.flow === "source_adaptation" || computeProjectProjection(initial).intent.is_source_adaptation || matcher.entities.length > 0;
    let skippedCount = 0;
    const acceptedPool = initial.facts.filter((fact) => fact.status === "accepted");
    for (const decision of decisions) {
      if (decision.candidate_occurrence_id === undefined && decision.fact_id === undefined) {
        throw new CoreError("FACT_CANDIDATE_OCCURRENCE_REQUIRED", "Strict fact review decisions must identify the candidate occurrence or fact id from context.", true);
      }
      const occurrenceId = decision.candidate_occurrence_id ?? decision.fact_id;
      const target = occurrenceId === undefined
        ? undefined
        : initial.facts.find((fact) => candidateOccurrenceForFact(fact) === occurrenceId || fact.id === occurrenceId);
      if (target === undefined || !run.candidate_occurrence_ids.includes(candidateOccurrenceForFact(target))) {
        throw new CoreError("FACT_CANDIDATE_NOT_ACTIVE", `Candidate ${occurrenceId ?? decision.claim} is not active in review run ${run.id}.`, true);
      }
      const targetOccurrenceId = candidateOccurrenceForFact(target);
      const currentCandidateRevision = pipelineFactCandidateRevision(target, initial.sources);
      if (targetIds.includes(target.id)) throw new CoreError("FACT_REVIEW_TARGET_DUPLICATE", `Fact ${target.id} appears more than once in this review.`, true);
      const previousDecision = latestDecisionForOccurrence(initial.fact_review_decisions, run.id, targetOccurrenceId);
      if (previousDecision?.decision === "accepted" || previousDecision?.decision === "rejected") {
        skippedCount += 1;
        continue;
      }
      const snapshotRevision = run.candidate_revisions?.[targetOccurrenceId];
      if (previousDecision === undefined && (snapshotRevision === undefined || snapshotRevision !== currentCandidateRevision)) {
        throw new CoreError("FACT_REVIEW_CANDIDATE_STALE", `Candidate ${targetOccurrenceId} changed since review run ${run.id} was created; reload the candidate and retry.`, true);
      }
      if (previousDecision?.decision === "conflict" && reviewerIdentity !== "director") {
        throw new CoreError("FACT_REVIEW_CONFLICT_DIRECTOR_REQUIRED", `Candidate ${targetOccurrenceId} is in conflict and requires Director resolution.`, true);
      }
      targetIds.push(target.id);
      const status = decision.decision === "accept" ? "accepted" : decision.decision === "reject" ? "rejected" : decision.decision === "conflict" ? "conflict" : "needs_evidence";
      const structuredEvidenceCount = ((decision as unknown as { evidence_refs?: FactEvidenceReference[] }).evidence_refs?.length ?? 0);
      const evidence = decision.decision === "accept" || decision.evidence.length > 0 || structuredEvidenceCount > 0
        ? strictEvidenceReferences(decision, target, initial.sources, initial.knowledge_chunks, decision.decision === "accept")
        : [];
      const effectiveEntityRefs = normalizeFactEntityRefs(initial, decision.accepted_entity_refs ?? decision.entity_refs ?? target.entity_refs ?? [], target.subject, target.classification);
      const effectiveCoverage = (decision.coverage ?? []).length > 0 ? [...new Set(decision.coverage ?? [])] : [...(target.coverage ?? [])];
      assertCoverageTargetsValid(decision.accepted_coverage_targets, "accepted_coverage_targets");
      const effectiveCoverageTargets = decision.accepted_coverage_targets ?? target.suggested_coverage_targets;
      const effectiveFact: FactRecord = {
        ...target,
        entity_refs: effectiveEntityRefs,
        coverage: effectiveCoverage,
        ...(effectiveCoverageTargets === undefined ? {} : { coverage_targets: [...effectiveCoverageTargets] }),
      };
      if (decision.decision === "accept") assertPipelineFactQuality(effectiveFact, { matcher, strictEntity: strictFactPolicy, strictCoverage: strictFactPolicy, strictQuality: strictFactPolicy });
      let finalStatus: FactReviewDecisionStatus = status;
      let finalReason = decision.reason;
      if (status === "accepted" && reviewerIdentity !== "director") {
        const targetPredicate = normalize(target.predicate ?? "");
        if (!GENERIC_PREDICATES.has(targetPredicate)) {
          const contradicting = acceptedPool.find((accepted) => {
            if (accepted.id === target.id || accepted.subject === undefined || accepted.predicate === undefined || accepted.value === undefined || target.subject === undefined || target.predicate === undefined || target.value === undefined) return false;
            return normalize(accepted.subject) === normalize(target.subject) && normalize(accepted.predicate) === normalize(target.predicate) && normalize(accepted.value) !== normalize(target.value);
          });
          if (contradicting !== undefined) {
            finalStatus = "conflict";
            finalReason = `${decision.reason} Conflict with accepted fact ${contradicting.id}: ${contradicting.statement}`.trim();
          } else {
            acceptedPool.push(effectiveFact);
          }
        }
      }
      const record: FactReviewDecisionRecord = {
        schema_version: 1,
        id: internalId("fact_review_decision"),
        operation_id: operationId,
        review_run_id: run.id,
        candidate_occurrence_id: targetOccurrenceId,
        fact_id: target.id,
        reviewer_identity: reviewerIdentity,
        decision: finalStatus,
        entity_refs: effectiveEntityRefs,
        reason: finalReason,
        evidence,
        candidate_revision: currentCandidateRevision,
        expected_projection_revision: actualProjectionRevision,
        resulting_fact_revision: (target.fact_revision ?? 0) + 1,
        created_at: now(),
      };
      records.push(record);
        updates.set(target.id, {
          decision,
          evidence,
          record,
          entity_refs: effectiveEntityRefs,
          coverage: effectiveCoverage,
          ...(status === "accepted" && effectiveCoverageTargets !== undefined ? { coverage_targets: [...effectiveCoverageTargets] } : {}),
        });
    }
    const conflictCount = records.filter((record) => record.decision === "conflict").length;
    if (records.length === 0) {
      const derivedEmpty = deriveReviewRunStatusAndResponse(initial, run.id, operationId, { applied: 0, skipped: skippedCount, conflicts: 0 });
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        return {
          ...current,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: derivedEmpty.operationStatus, result_summary: derivedEmpty.summary })
            : item),
        };
      });
      return { fact_ids: [], applied: 0, skipped: skippedCount, conflicts: 0, status: derivedEmpty.responseStatus, summary: derivedEmpty.summary };
    }
    const initiallyUndecided = new Set(records
      .filter((record) => pipelineLatestDecisionForOccurrence(initial.fact_review_decisions, run!.id, record.candidate_occurrence_id) === undefined)
      .map((record) => record.candidate_occurrence_id));
    try {
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        const concurrentlyDecided = reviewerIdentity === "director" || run!.status === "blocked" ? undefined : records.find((record) => initiallyUndecided.has(record.candidate_occurrence_id) && pipelineLatestDecisionForOccurrence(current.fact_review_decisions, run!.id, record.candidate_occurrence_id) !== undefined);
        if (concurrentlyDecided !== undefined) {
          throw new CoreError("FACT_REVIEW_CONCURRENT_UPDATE", `Candidate ${concurrentlyDecided.candidate_occurrence_id} was adjudicated by another reviewer.`, true);
        }
        const decisionsForRun = [...current.fact_review_decisions, ...records];
        const tempState: ProjectState = { ...current, fact_review_decisions: decisionsForRun };
        const batchHasBlocker = records.some((record) => record.decision === "needs_evidence" || record.decision === "conflict");
        const derivedCommit = deriveReviewRunStatusAndResponse(tempState, run!.id, operationId, { applied: records.length, skipped: skippedCount, conflicts: conflictCount }, targetIds, batchHasBlocker);
        const complete = run!.candidate_occurrence_ids.length > 0 && run!.candidate_occurrence_ids.every((id) => decisionsForRun.some((d) => d.review_run_id === run!.id && d.candidate_occurrence_id === id));
        const updatedRun: FactReviewRunRecord = {
          ...run!,
          status: derivedCommit.runStatus,
          ...(complete ? { completed_at: now() } : {}),
        };
        return {
          ...current,
          ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
          facts: current.facts.map((fact) => {
            const update = updates.get(fact.id);
            if (update === undefined) return fact;
            const addedEvidence = update.decision.evidence.map(evidenceText);
            const nextFact: FactRecord = {
              ...fact,
              status: update.record.decision === "accepted" ? "accepted" : update.record.decision === "rejected" ? "rejected" : update.record.decision === "conflict" ? "conflict" : "candidate",
              entity_refs: update.entity_refs,
              ...(update.coverage_targets === undefined ? {} : { coverage_targets: update.coverage_targets }),
              evidence: [...new Set([...fact.evidence, ...addedEvidence])],
              ...(update.evidence.length > 0 ? { evidence_refs: [...(fact.evidence_refs ?? []), ...update.evidence] } : {}),
              ...(update.coverage.length > 0 ? { coverage: update.coverage } : {}),
              fact_revision: (fact.fact_revision ?? 0) + 1,
              candidate_occurrence_id: candidateOccurrenceForFact(fact),
              review_run_id: run!.id,
              decision_id: update.record.id,
              updated_at: now(),
            };
            const withEvidenceRevision: FactRecord = addedEvidence.length > 0 || update.evidence.length > 0
              ? { ...nextFact, evidence_revision: evidenceRevision(nextFact, current.sources) }
              : nextFact;
            if (update.record.decision === "accepted") return { ...withEvidenceRevision, accepted_fact_revision: acceptedFactRevision(withEvidenceRevision) };
            const { accepted_fact_revision: _acceptedRevision, ...withoutAcceptedRevision } = withEvidenceRevision;
            return withoutAcceptedRevision;
          }),
          fact_review_runs: current.fact_review_runs.map((item) => item.id === run!.id ? updatedRun : item),
          fact_review_decisions: decisionsForRun,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: derivedCommit.operationStatus, progress: [...item.progress, ...targetIds.map((id) => ({ item_id: id, status: "completed" as const, message: "Fact review decision applied." }))], result_summary: derivedCommit.summary })
            : item),
          audit: [...current.audit, {
            id: internalId("audit"), operation_id: operationId, event: "fact.review.batch.applied", actor, occurred_at: now(), project_revision: current.revision + 1,
            details: { review_run_id: run!.id, reviewer_identity: reviewerIdentity, agent_id: reviewerIdentity, candidate_occurrence_ids: records.map((record) => record.candidate_occurrence_id), decisions: records.map((record) => ({ id: record.id, fact_id: record.fact_id, decision: record.decision, reason: record.reason })), applied: records.length, skipped: skippedCount, conflict: conflictCount, expected_projection_revision: actualProjectionRevision },
          }],
        };
      });
    } catch (error) {
      if (error instanceof CoreError && (error.code === "REVISION_CONFLICT" || error.code === "FACT_REVIEW_CONCURRENT_UPDATE")) {
        if (attempt < 2) {
          return this.applyReviewBatchAttempt(operationId, decisions, actorInput, reviewerIdentity, run.id, undefined, attempt + 1);
        }
        throw new CoreError("FACT_PROJECTION_STALE", "Another reviewer updated the fact projection; reload unreviewed candidates and retry.", true);
      }
      throw error;
    }
    const finalState = await this.repository.read();
    const batchHasBlocker = records.some((record) => record.decision === "needs_evidence" || record.decision === "conflict");
    const finalDerived = deriveReviewRunStatusAndResponse(finalState, run.id, operationId, { applied: records.length, skipped: skippedCount, conflicts: conflictCount }, targetIds, batchHasBlocker);
    return { fact_ids: targetIds, applied: records.length, skipped: skippedCount, conflicts: conflictCount, status: finalDerived.responseStatus, summary: finalDerived.summary };
  }

  /** Director-only resolution entry that may overwrite conflict decisions. */
  async resolveFactConflict(
    operationId: string,
    decisions: FactDecision[],
    actor: string,
    reviewerIdentity: string,
    reviewRunId?: string,
    expectedProjectionRevision?: string,
  ): Promise<FactReviewExecutionResult> {
    if (reviewerIdentity !== "director") {
      throw new CoreError("FACT_REVIEW_CONFLICT_DIRECTOR_REQUIRED", "Conflict resolution requires the Director.", true);
    }
    return this.applyReviewBatch(operationId, decisions, actor, reviewerIdentity, reviewRunId, expectedProjectionRevision);
  }

  async applyReview(operationId: string, decisions: FactDecision[], actor: string, reviewPass?: 1 | 2 | 3): Promise<FactReviewExecutionResult> {
    // Legacy v2 review path. The implementation lives in the compatibility
    // adapter (fact-review-legacy-adapter.ts) and must not be re-expanded here;
    // all new review traffic uses FactReviewRun/FactReviewDecision.
    return applyLegacyFactReview(this.repository, operationId, decisions, actor, reviewPass);
  }
}
