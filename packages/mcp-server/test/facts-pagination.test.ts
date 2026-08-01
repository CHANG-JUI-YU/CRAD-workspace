/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { computeRevision } from "@card-workspace/project";
import { factCandidateSchema } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { paginateCandidateIds, reviewPageItem } from "../src/tools/facts.js";
import { factTools } from "../src/tools/facts.js";

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

  it("covers reviewed filters, terminal pages, and malformed cursors", () => {
    const candidateIds = Array.from({ length: 4 }, (_, index) => occurrence(1000 + index)).sort();
    const reviewed = new Set([candidateIds[1]!]);
    const active = computeRevision({ curation: 11 });
    expect(paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "reviewed", limit: 10,
    })).toMatchObject({ filteredCount: 1, pageIds: [candidateIds[1]], nextCursor: undefined });
    expect(paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "unreviewed", limit: 10,
    })).toMatchObject({ filteredCount: 3, pageIds: [candidateIds[0], candidateIds[2], candidateIds[3]], nextCursor: undefined });
    const paged = paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "all", limit: 2,
    });
    expect(paged.pageIds).toHaveLength(2);
    expect(paged.nextCursor).toBeDefined();
    expect(thrownCode(() => paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "all", limit: 1, cursor: "not-base64",
    }))).toBe("FACTS_REVIEW_CURSOR_INVALID");
    const malformedEnvelope = Buffer.from(JSON.stringify({ payload: "{}", checksum: "sha256:bad" }), "utf8").toString("base64url");
    expect(thrownCode(() => paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "all", limit: 1, cursor: malformedEnvelope,
    }))).toBe("FACTS_REVIEW_CURSOR_INVALID");
    const validCursor = paged.nextCursor!;
    const envelope = JSON.parse(Buffer.from(validCursor, "base64url").toString("utf8")) as { payload: string; checksum: string };
    const tampered = Buffer.from(JSON.stringify({ ...envelope, checksum: envelope.checksum.slice(0, -1) + (envelope.checksum.endsWith("0") ? "1" : "0") }), "utf8").toString("base64url");
    expect(thrownCode(() => paginateCandidateIds({
      candidateIds, reviewed, activeCurationRevision: active, reviewState: "all", limit: 1, cursor: tampered,
    }))).toBe("FACTS_REVIEW_CURSOR_INVALID");
  });
  it("covers review item optional projections and invalid cursor identity", () => {
    const id = occurrence(900);
    const candidate = factCandidateSchema.parse({
      schema_version: 1, id, subject: "alice", predicate: "appearance.hair", value: "silver",
      classification: "source_fact", confidence: 0.8,
      scope: { world: "city", timeline: "present", location: "tower", character_ids: ["alice"] },
      valid_time: { start: "2026-01-01", end: "2026-12-31", label: "current" },
      evidence: [{ id: "e", source_id: "novel", source_revision_id: `sha256:${"a".repeat(64)}`, chunk_set_id: "set", chunk_id: "chunk", chunk_hash: `sha256:${"b".repeat(64)}`, quote: "silver", normalized_character_range: [0, 6], normalized_line_range: [1, 1], chapter: "Chapter 1" }],
      rationale: "supported", status: "submitted", created_by: "curator", created_at: "2026-07-19T00:00:00.000Z",
    });
    const item = reviewPageItem(candidate, true, [{ candidate_id: id, code: "QUALITY", path: ["value"], value: "silver" }]);
    expect(item).toMatchObject({ review_state: "reviewed", scope: { world: "city", timeline: "present", location: "tower" }, valid_time: { start: "2026-01-01", end: "2026-12-31", label: "current" }, rationale: "supported" });
    expect(item.evidence[0]).toMatchObject({ chapter: "Chapter 1" });
    expect(item.quality_diagnostics).toHaveLength(1);
    const empty = factCandidateSchema.parse({ ...candidate, id: occurrence(901), scope: { character_ids: [] }, valid_time: {}, evidence: [{ ...candidate.evidence[0], chapter: undefined }], rationale: undefined, coverage_dimensions: undefined });
    expect(reviewPageItem(empty, false, [{ candidate_id: id, code: "OTHER", path: [], value: null }])).toMatchObject({ review_state: "unreviewed", scope: { character_ids: [] }, valid_time: {} });
    const first = paginateCandidateIds({ candidateIds: [id, occurrence(902)], reviewed: new Set(), activeCurationRevision: computeRevision({ curation: 8 }), reviewState: "all", limit: 1 });
    expect(thrownCode(() => paginateCandidateIds({ candidateIds: [occurrence(902)], reviewed: new Set(), activeCurationRevision: computeRevision({ curation: 8 }), reviewState: "all", limit: 1, cursor: first.nextCursor! }))).toBe("FACTS_REVIEW_CURSOR_INVALID");
  });

  it("covers Facts tool authorization and task binding guards", async () => {
    const context = {
      trusted: { agentId: "zhuji-creator", config: { registry: { agents: [] } }, workspaceRoot: "." },
      workflow: { tasks: [] },
      projectRoot: ".",
      args: { task_id: "missing" },
    } as never;
    await expect(factTools.fact_submit_candidates(context)).rejects.toMatchObject({ code: "CURATE_FACTS_TASK_INVALID" });
    await expect(factTools.fact_finalize_curation(context)).rejects.toMatchObject({ code: "CURATE_FACTS_TASK_INVALID" });
    await expect(factTools.facts_review_status(context)).rejects.toMatchObject({ code: "FACTS_REVIEW_STATUS_DENIED" });
    await expect(Promise.resolve().then(() => factTools.facts_candidate_identity_migrate(context))).rejects.toMatchObject({ code: "FACTS_CANDIDATE_IDENTITY_MIGRATION_DENIED" });
    await expect(factTools.fact_review({
      ...context,
      args: { decision: { candidate_id: "candidate-occurrence-" + "a".repeat(64) }, expected_projection_revision: "sha256:" + "a".repeat(64) },
    })).rejects.toBeDefined();
    await expect(factTools.provenance_trace({ ...context, args: { id: "missing" } })).rejects.toBeDefined();
  });
});


it("covers Facts status without an active curation and optional review inputs", async () => {
  const { setupMcpWorkspace } = await import("./helpers.js");
  const { createTrustedContext } = await import("../src/context.js");
  const { loadAuthorProject } = await import("@card-workspace/project");
  const fixture = await setupMcpWorkspace("facts-empty-status");
  const trusted = await createTrustedContext(fixture.environment);
  const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "facts-empty-status");
  const status = await factTools.facts_review_status({
    trusted,
    workflow: loaded.workflow!,
    projectRoot: fixture.projectRoot,
    args: { limit: 10, review_state: "all" },
  });
  expect(status.overview.curation).toBeUndefined();
  expect(status.page.items).toEqual([]);
  const occurrenceId = occurrence(903);
  await expect(factTools.fact_review({
    trusted,
    workflow: loaded.workflow!,
    projectRoot: fixture.projectRoot,
    args: {
      decision: { candidate_id: occurrenceId },
      expected_projection_revision: "sha256:" + "a".repeat(64),
      expected_fact_revision: 2,
      patch: { value: "patched" },
    },
  })).rejects.toBeDefined();
  await expect(factTools.facts_candidate_identity_migrate({
    trusted,
    workflow: loaded.workflow!,
    projectRoot: fixture.projectRoot,
    args: {
      decision_id: "decision-1",
      expected_projection_revision: "sha256:" + "a".repeat(64),
      occurred_at: "2026-07-24T00:00:00.000Z",
    },
  })).rejects.toBeDefined();
  await fixture.workspace.cleanup();
});
