import {
  canonicalJson,
  contentHash,
  CoreError,
  internalId,
  type FactClaim,
  type FactDecision,
  type FactEvidenceReference,
  type FactRecord,
  type FactClassification,
  type FactReviewDecisionStatus,
  type FactReviewDecisionRecord,
  type FactReviewPassRecord,
  type FactReviewRunRecord,
  type KnowledgeChunk,
  type OperationRecord,
  type ProjectRepository,
  type SourceRecord,
} from "@st-workspace/core";
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
  assertStrictFactQuality as assertPipelineFactQuality,
  contradictingAcceptedFacts as pipelineContradictingAcceptedFacts,
  evidenceRevision,
  evidenceText as pipelineEvidenceText,
  factCandidateRevision as pipelineFactCandidateRevision,
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
import { buildFactReviewContext, prepareFactReviewRun, reviewProjectionRevision, type FactReviewContextOptions } from "./fact-review-service.js";
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
  status: "completed" | "needs_input";
  summary: string;
}

export interface FactReviewRunExecutionResult {
  run: FactReviewRunRecord;
  status: "completed" | "needs_input";
  summary: string;
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

function factCandidateRevision(fact: FactRecord, sources: readonly SourceRecord[]): string {
  return contentHash(canonicalJson({
    candidate_occurrence_id: candidateOccurrenceForFact(fact),
    statement: fact.statement,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    classification: fact.classification,
    coverage: fact.coverage,
    source_ids: fact.source_ids,
    source_revisions: sources.filter((source) => fact.source_ids.includes(source.id)).map((source) => ({ id: source.id, revision: source.revision })),
    evidence: fact.evidence,
  }));
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

export class KnowledgeService {
  constructor(private readonly repository: ProjectRepository) {}

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
      return run.source_revisions.every((sourceRevision) => initial.sources.some((source) => source.id === sourceRevision.source_id && source.revision === sourceRevision.revision));
    });
    if (openRun !== undefined) return openRun;
    if (pending.length === 0) throw new CoreError("FACT_REVIEW_NO_CANDIDATES", "No fact candidates are available for review.", true);
    const candidateSetRevision = contentHash(canonicalJson({
      curation_run_id: inferredCurationRunId,
      candidates: pending.map((fact) => ({ id: candidateOccurrenceForFact(fact), revision: factCandidateRevision(fact, initial.sources) })).sort((left, right) => left.id.localeCompare(right.id)),
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

  async factReviewContext(options: { cursor?: string; limit?: number; source_id?: string; classification?: FactClassification } = {}): Promise<{
    run?: FactReviewRunRecord;
    projection_revision?: string;
    candidates: Array<{ candidate_occurrence_id: string; fact_id: string; statement: string; subject?: string; predicate?: string; value?: string; classification?: FactClassification; coverage?: string[]; status: FactRecord["status"]; source_ids: string[]; evidence: string[]; evidence_refs?: FactEvidenceReference[]; candidate_revision: string; last_decision?: FactReviewDecisionRecord["decision"]; last_reviewer_identity?: string }>;
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
        candidate_revision: factCandidateRevision(fact, state.sources),
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
      return this.applyReviewBatch(operationId, decisions, actorInput, reviewerIdentity, run.id, expectedProjectionRevision);
    }
    if (run.status === "completed" || run.status === "superseded") throw new CoreError("FACT_REVIEW_RUN_CLOSED", `Fact review run ${run.id} is no longer open.`, true);
    const actualProjectionRevision = reviewProjectionRevision(initial, run.id);
    if (expectedProjectionRevision !== undefined && expectedProjectionRevision !== actualProjectionRevision) {
      throw new CoreError("FACT_PROJECTION_STALE", `Fact review projection is stale; expected ${expectedProjectionRevision}, found ${actualProjectionRevision}.`, true);
    }
    if (decisions.length === 0) throw new CoreError("FACT_REVIEW_BATCH_EMPTY", "At least one fact review decision is required.", true);
    const targetIds: string[] = [];
    const records: FactReviewDecisionRecord[] = [];
    const updates = new Map<string, { decision: FactDecision; evidence: FactEvidenceReference[]; record: FactReviewDecisionRecord; coverage: string[] }>();
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
      const currentCandidateRevision = factCandidateRevision(target, initial.sources);
      if (targetIds.includes(target.id)) throw new CoreError("FACT_REVIEW_TARGET_DUPLICATE", `Fact ${target.id} appears more than once in this review.`, true);
      const previousDecision = latestDecisionForOccurrence(initial.fact_review_decisions, run.id, targetOccurrenceId);
      if (previousDecision?.decision === "accepted" || previousDecision?.decision === "rejected") {
        skippedCount += 1;
        continue;
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
      const effectiveCoverage = [...new Set([...(target.coverage ?? []), ...(decision.coverage ?? [])])];
      const effectiveFact: FactRecord = effectiveCoverage.length > 0 ? { ...target, coverage: effectiveCoverage } : target;
      if (decision.decision === "accept") assertStrictFactQuality(effectiveFact);
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
        reason: finalReason,
        evidence,
        candidate_revision: currentCandidateRevision,
        expected_projection_revision: actualProjectionRevision,
        resulting_fact_revision: (target.fact_revision ?? 0) + 1,
        created_at: now(),
      };
      records.push(record);
      updates.set(target.id, { decision, evidence, record, coverage: effectiveCoverage });
    }
    const summary = skippedCount > 0
      ? `Adjudicated ${targetIds.length} fact candidates in review run ${run.id}; skipped ${skippedCount} already-adjudicated candidates.`
      : `Adjudicated ${targetIds.length} fact candidates in review run ${run.id}.`;
    try {
      await this.repository.commit(initial.revision, (current) => {
        assertExecutionLeaseForOperation(current.operations.find((item) => item.id === operationId), execution);
        const decisionsForRun = [...current.fact_review_decisions, ...records];
        const latestByOccurrence = new Map<string, FactReviewDecisionRecord>();
        for (const item of decisionsForRun) {
          if (item.review_run_id === run!.id) latestByOccurrence.set(item.candidate_occurrence_id, item);
        }
        const complete = run!.candidate_occurrence_ids.every((id) => latestByOccurrence.has(id));
        const blocked = [...latestByOccurrence.values()].some((item) => item.decision === "needs_evidence" || item.decision === "conflict");
        const updatedRun: FactReviewRunRecord = {
          ...run!,
          status: complete ? (blocked ? "blocked" : "completed") : "open",
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
              evidence: [...new Set([...fact.evidence, ...addedEvidence])],
              evidence_refs: [...(fact.evidence_refs ?? []), ...update.evidence],
              ...(update.coverage.length > 0 ? { coverage: update.coverage } : {}),
              fact_revision: (fact.fact_revision ?? 0) + 1,
              candidate_occurrence_id: candidateOccurrenceForFact(fact),
              review_run_id: run!.id,
              decision_id: update.record.id,
              updated_at: now(),
            };
            const withEvidenceRevision: FactRecord = { ...nextFact, evidence_revision: evidenceRevision(nextFact, current.sources) };
            if (update.record.decision === "accepted") return { ...withEvidenceRevision, accepted_fact_revision: acceptedFactRevision(withEvidenceRevision) };
            const { accepted_fact_revision: _acceptedRevision, ...withoutAcceptedRevision } = withEvidenceRevision;
            return withoutAcceptedRevision;
          }),
          fact_review_runs: current.fact_review_runs.map((item) => item.id === run!.id ? updatedRun : item),
          fact_review_decisions: decisionsForRun,
          operations: current.operations.map((item) => item.id === operationId
            ? updateOperation(item, { status: blocked ? "needs_input" : "completed", progress: [...item.progress, ...targetIds.map((id) => ({ item_id: id, status: "completed" as const, message: "Fact review decision applied." }))], result_summary: summary })
            : item),
          audit: [...current.audit, {
            id: internalId("audit"), operation_id: operationId, event: "fact.review.batch.applied", actor, occurred_at: now(), project_revision: current.revision + 1,
            details: { review_run_id: run!.id, reviewer_identity: reviewerIdentity, agent_id: reviewerIdentity, candidate_occurrence_ids: records.map((record) => record.candidate_occurrence_id), decisions: records.map((record) => ({ id: record.id, fact_id: record.fact_id, decision: record.decision, reason: record.reason })), expected_projection_revision: actualProjectionRevision },
          }],
        };
      });
    } catch (error) {
      if (error instanceof CoreError && error.code === "REVISION_CONFLICT") {
        throw new CoreError("FACT_PROJECTION_STALE", "Another reviewer updated the fact projection; reload unreviewed candidates and retry.", true);
      }
      throw error;
    }
    const needsInput = records.some((record) => record.decision === "needs_evidence" || record.decision === "conflict");
    return { fact_ids: targetIds, status: needsInput ? "needs_input" : "completed", summary };
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
    return applyLegacyFactReview(this.repository, operationId, decisions, actor, reviewPass);
    /* Legacy implementation retained only as a migration reference; all new
       review traffic uses FactReviewRun/FactReviewDecision above.
    const initial = await this.repository.read();
    const operation = initial.operations.find((item) => item.id === operationId);
    if (operation === undefined) throw new CoreError("OPERATION_NOT_FOUND", `Operation ${operationId} does not exist`);
    const targetIds: string[] = [];
    for (const decision of decisions) {
      const candidates = decision.fact_id !== undefined
        ? initial.facts.filter((fact) => fact.id === decision.fact_id)
        : initial.facts.filter((fact) => normalize(fact.statement) === normalize(decision.claim) || normalize([fact.subject, fact.predicate, fact.value].filter((item): item is string => item !== undefined).join(" ")) === normalize(decision.claim));
      if (candidates.length !== 1) {
        const reason = candidates.length === 0 ? "no matching fact" : "ambiguous fact claim";
        throw new CoreError("FACT_REVIEW_TARGET_INVALID", `Fact review target is ${reason}: ${decision.fact_id ?? decision.claim}`, true);
      }
      const target = candidates[0]!;
      const targetId = target.id;
      if (targetIds.includes(targetId)) throw new CoreError("FACT_REVIEW_TARGET_DUPLICATE", `Fact ${targetId} appears more than once in this review`, true);
      targetIds.push(targetId);
    }
    const byId = new Map(decisions.map((decision, index) => [targetIds[index], decision]));
    const summary = `Adjudicated ${targetIds.length} fact candidates.`;
    const inferredPass = reviewPass ?? (/[-_ ]([123])$/u.exec(actor)?.[1] as "1" | "2" | "3" | undefined);
    const pass: 1 | 2 | 3 = inferredPass === "2" ? 2 : inferredPass === "3" ? 3 : 1;
    const decisionsHash = contentHash(canonicalJson(decisions));
    const passRecord: FactReviewPassRecord = {
      id: internalId("fact_review_pass"),
      operation_id: operationId,
      reviewer: actor,
      pass,
      fact_ids: targetIds,
      decisions_hash: decisionsHash,
      created_at: now(),
    };
    const legacyDecisionRecords: FactReviewDecisionRecord[] = decisions.map((decision, index) => ({
      schema_version: 1,
      id: internalId("fact_review_decision"),
      operation_id: operationId,
      review_run_id: "legacy",
      candidate_occurrence_id: candidateOccurrenceForFact(initial.facts.find((fact) => fact.id === targetIds[index])!),
      ...(targetIds[index] === undefined ? {} : { fact_id: targetIds[index] }),
      reviewer_identity: actor,
      decision: decision.decision === "accept" ? "accepted" : decision.decision === "reject" ? "rejected" : decision.decision === "conflict" ? "conflict" : "needs_evidence",
      reason: decision.reason,
      evidence: [],
      candidate_revision: factCandidateRevision(initial.facts.find((fact) => fact.id === targetIds[index])!, initial.sources),
      expected_projection_revision: contentHash(canonicalJson({ legacy: true, operation_id: operationId, fact_ids: targetIds })),
      created_at: now(),
    }));
    await this.repository.commit(initial.revision, (current) => ({
      ...current,
      ...(current.project_status === "published" ? { project_status: "ready" as const } : {}),
      facts: current.facts.map((fact) => {
        const decision = byId.get(fact.id);
        if (decision === undefined) return fact;
        const status = decision.decision === "accept" ? "accepted" : decision.decision === "reject" ? "rejected" : decision.decision === "conflict" ? "conflict" : "candidate";
        const addedEvidence = decision.evidence.map(evidenceText);
        const decisionId = legacyDecisionRecords.find((record) => record.fact_id === fact.id)?.id;
        return { ...fact, status, evidence: [...new Set([...fact.evidence, ...addedEvidence])], fact_revision: (fact.fact_revision ?? 0) + 1, ...(decisionId === undefined ? {} : { decision_id: decisionId }), updated_at: now() };
      }),
      operations: current.operations.map((item) => item.id === operationId
        ? updateOperation(item, { status: "completed", progress: [...item.progress, ...targetIds.map((id) => ({ item_id: id, status: "completed" as const, message: "Fact review decision applied." }))], result_summary: summary })
        : item),
      audit: [...current.audit, {
        id: internalId("audit"), operation_id: operationId, event: "fact.review.applied", actor, occurred_at: now(), project_revision: current.revision + 1,
        details: { fact_ids: targetIds, decisions: decisions.map((decision) => ({ fact_id: decision.fact_id, claim: decision.claim, decision: decision.decision })), review_pass: pass, decisions_hash: decisionsHash },
      }],
      fact_review_passes: [...current.fact_review_passes, passRecord],
      fact_review_decisions: [...current.fact_review_decisions, ...legacyDecisionRecords],
    }));
    return { fact_ids: targetIds, status: "completed", summary }; */
  }
}
