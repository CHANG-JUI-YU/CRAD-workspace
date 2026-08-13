import type { FactReviewEvidenceContext, ProjectState } from "@st-workspace/core";

export interface EvidenceContextView extends FactReviewEvidenceContext {
  stale: boolean;
  stale_reason?: string;
}

export function deriveEvidenceContextViews(state: ProjectState, contexts: readonly FactReviewEvidenceContext[]): EvidenceContextView[] {
  return contexts.map((context) => {
    const source = state.sources.find((item) => item.id === context.source_id);
    let stale = false;
    let staleReason: string | undefined;
    if (source !== undefined && context.source_revision !== source.revision) {
      stale = true;
      staleReason = `來源已更新（${context.source_revision.slice(0, 8)} → ${source.revision.slice(0, 8)}）`;
    } else if (source === undefined) {
      stale = true;
      staleReason = "來源已不存在";
    }
    if (!stale && context.chunk_id !== undefined && context.chunk_hash !== undefined) {
      const chunk = state.knowledge_chunks.find((item) => item.id === context.chunk_id);
      if (chunk !== undefined && chunk.hash !== context.chunk_hash) {
        stale = true;
        staleReason = "來源 chunk 內容已變更";
      }
    }
    return {
      ...context,
      stale,
      ...(staleReason === undefined ? {} : { stale_reason: staleReason }),
    };
  });
}

export function deriveEvidenceReferenceStale(state: ProjectState, reference: { source_id: string; source_revision_id: string; chunk_id?: string; chunk_hash?: string }): { stale: boolean; stale_reason?: string } {
  const source = state.sources.find((item) => item.id === reference.source_id);
  let stale = false;
  let staleReason: string | undefined;
  if (source !== undefined && reference.source_revision_id !== source.revision) {
    stale = true;
    staleReason = `來源已更新（${reference.source_revision_id.slice(0, 8)} → ${source.revision.slice(0, 8)}）`;
  } else if (source === undefined) {
    stale = true;
    staleReason = "來源已不存在";
  }
  if (!stale && reference.chunk_id !== undefined && reference.chunk_hash !== undefined) {
    const chunk = state.knowledge_chunks.find((item) => item.id === reference.chunk_id);
    if (chunk !== undefined && chunk.hash !== reference.chunk_hash) {
      stale = true;
      staleReason = "來源 chunk 內容已變更";
    }
  }
  return { stale, ...(staleReason === undefined ? {} : { stale_reason: staleReason }) };
}
