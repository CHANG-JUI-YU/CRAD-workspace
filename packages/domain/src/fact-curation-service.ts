import {
  type FactClaim,
  type FactRecord,
  type KnowledgeChunk,
  type ProjectState,
} from "@st-workspace/core";
import { chunkSource, KNOWLEDGE_EXTRACTOR_REVISION } from "./source-chunking.js";
import { evidenceRevision, sourceMatches } from "./fact-policy.js";
import { mergeFactCandidates, claimToFact } from "./fact-candidate-store.js";

export interface CurationCandidateBatch {
  readonly chunks: KnowledgeChunk[];
  readonly facts: FactRecord[];
  readonly mergedFacts: Map<string, FactRecord>;
  readonly mergedCount: number;
}

/**
 * Build the durable input for a curation run without mutating ProjectState.
 * The operation id is the curation-run identity for the current persisted
 * schema; review runs retain it so successor reviews can be traced back to
 * the exact curation operation.
 */
export function buildCurationCandidateBatch(state: ProjectState, claims: readonly FactClaim[], actor: string, curationRunId: string): CurationCandidateBatch {
  const knownChunkSourceIds = new Set(state.knowledge_chunks.map((chunk) => chunk.source_id));
  const curationSources = state.sources.filter((source) => claims.some((claim) => claim.evidence.some((evidence) => sourceMatches(source, evidence.source))));
  const chunks = curationSources.flatMap((source) => knownChunkSourceIds.has(source.id) ? [] : chunkSource(source, KNOWLEDGE_EXTRACTOR_REVISION));
  const availableChunks = [...state.knowledge_chunks, ...chunks];
  const candidates = claims.map((claim) => {
    const fact = claimToFact(claim, state.sources, actor, curationRunId);
    const evidenceRefs = claim.evidence.flatMap((evidence) => {
      if (evidence.quote === undefined) return [];
      const source = state.sources.find((candidate) => sourceMatches(candidate, evidence.source));
      if (source === undefined) return [];
      const chunk = availableChunks.find((candidate) => candidate.source_id === source.id && candidate.text.includes(evidence.quote!));
      if (chunk === undefined) return [];
      return [{ source_id: source.id, source_revision_id: source.revision, chunk_id: chunk.id, chunk_hash: chunk.hash, quote: evidence.quote, ...(evidence.locator === undefined ? {} : { locator: evidence.locator }) }];
    });
    return evidenceRefs.length === 0 ? fact : { ...fact, evidence_refs: evidenceRefs };
  });
  const mergedCandidates = candidates.map((candidate) => ({ ...candidate, evidence_revision: evidenceRevision(candidate, state.sources) }));
  const merged = mergeFactCandidates(state.facts, mergedCandidates, state.sources);
  return { chunks, facts: merged.facts, mergedFacts: merged.mergedFacts, mergedCount: merged.mergedCount };
}

/** A stable operation-to-curation identity adapter for older ProjectState. */
export function curationRunIdForOperation(operationId: string): string {
  return operationId;
}
