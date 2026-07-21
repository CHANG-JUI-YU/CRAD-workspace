import { computeRevision } from "@card-workspace/project";
import { factCandidateSchema } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { paginateCandidateIds, reviewPageItem } from "../src/tools/facts.js";

function occurrence(index: number): string {
  return `candidate-occurrence-${computeRevision({ index }).slice("sha256:".length)}`;
}

function thrownCode(callback: () => unknown): string | undefined {
  try {
    callback();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("facts review pagination", () => {
  it("visits 140 candidates exactly once and continues after accepting the first item", () => {
    const candidateIds = Array.from({ length: 140 }, (_, index) => occurrence(index)).sort();
    const reviewed = new Set<string>();
    const activeCurationRevision = computeRevision({ curation: 1 });
    const visited: string[] = [];
    let cursor: string | undefined;

    do {
      const page = paginateCandidateIds({
        candidateIds,
        reviewed,
        activeCurationRevision,
        reviewState: "unreviewed",
        limit: 20,
        ...(cursor === undefined ? {} : { cursor }),
      });
      visited.push(...page.pageIds);
      if (visited.length === 20) reviewed.add(page.pageIds[0]!);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(visited).toEqual(candidateIds);
    expect(new Set(visited).size).toBe(140);
  });

  it("binds cursors to the active curation and review filter", () => {
    const candidateIds = Array.from({ length: 3 }, (_, index) => occurrence(index)).sort();
    const first = paginateCandidateIds({
      candidateIds,
      reviewed: new Set(),
      activeCurationRevision: computeRevision({ curation: 1 }),
      reviewState: "all",
      limit: 1,
    });
    expect(first.nextCursor).toBeDefined();
    expect(thrownCode(() => paginateCandidateIds({
      candidateIds,
      reviewed: new Set(),
      activeCurationRevision: computeRevision({ curation: 2 }),
      reviewState: "all",
      limit: 1,
      cursor: first.nextCursor!,
    }))).toBe("FACTS_REVIEW_CURSOR_STALE");
    expect(thrownCode(() => paginateCandidateIds({
      candidateIds,
      reviewed: new Set(),
      activeCurationRevision: computeRevision({ curation: 1 }),
      reviewState: "reviewed",
      limit: 1,
      cursor: first.nextCursor!,
    }))).toBe("FACTS_REVIEW_CURSOR_STALE");
  });

  it("keeps a 50-item review page under 64KB without exposing internal identity or extensions", () => {
    const items = Array.from({ length: 50 }, (_, index) => reviewPageItem(factCandidateSchema.parse({
      schema_version: 1,
      id: occurrence(index),
      subject: "alice",
      predicate: `profile.detail-${index}`,
      value: `Exact semantic value ${index}`,
      classification: "source_fact",
      confidence: 0.9,
      coverage_dimensions: ["identity", "personality"],
      scope: { character_ids: ["alice"], extensions: { internal: true } },
      valid_time: { label: "current", extensions: { internal: true } },
      evidence: [{
        id: `evidence-${index}`,
        source_id: "novel",
        source_revision_id: `sha256:${"a".repeat(64)}`,
        chunk_set_id: "chunk-set-1",
        chunk_id: "chunk-1",
        chunk_hash: `sha256:${"b".repeat(64)}`,
        quote: `Exact quote ${index}`,
        normalized_character_range: [0, 20],
        normalized_line_range: [1, 1],
        raw_byte_range: [0, 20],
        extensions: { internal: true },
      }],
      rationale: "Directly supported by the source.",
      status: "submitted",
      created_by: "fact-curator",
      created_at: "2026-07-19T00:00:00.000Z",
      extensions: { source_candidate_id: `raw-${index}`, source_batch_id: "batch-1" },
    }), false, []));
    const serialized = JSON.stringify({ overview: { counts: { total: 140 } }, page: { items } });

    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(64 * 1024);
    expect(serialized).not.toContain("source_candidate_id");
    expect(serialized).not.toContain("source_batch_id");
    expect(serialized).not.toContain("created_by");
    expect(items[0]!.candidate_id).toMatch(/^candidate-occurrence-[a-f0-9]{64}$/u);
    expect(items[0]!.evidence[0]).toMatchObject({ quote: "Exact quote 0", source_id: "novel", chunk_id: "chunk-1" });
    expect(Object.keys(items[0]!).filter((key) => key.endsWith("_id"))).toEqual(["candidate_id"]);
  });
});
