import { describe, expect, it } from "vitest";
import { contentHash, createProjectState, MemoryProjectRepository, type ArtifactRecord, type FactRecord } from "@st-workspace/core";
import {
  dashboardArtifactDetail,
  dashboardQuerySchema,
  parseDashboardQuery,
  queryDashboardArtifactHistory,
  queryDashboardArtifacts,
  queryDashboardFacts,
  readDashboardSummary,
} from "../src/index.js";

function artifact(id: string, key: string, content: string, updatedAt: string): ArtifactRecord {
  return {
    id,
    key,
    kind: "character",
    name: id,
    content,
    media_type: "text/plain",
    content_hash: contentHash(content),
    revision: contentHash(`${id}:${content}`),
    status: "draft",
    created_at: updatedAt,
    updated_at: updatedAt,
    created_by: "test",
    operation_id: "seed",
  };
}

function fact(id: string, status: FactRecord["status"], subject: string): FactRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    statement: `${subject} is calm`,
    subject,
    predicate: "has_trait",
    value: "calm",
    classification: "trait",
    status,
    confidence: 0.9,
    source_ids: [],
    evidence: [],
    created_at: timestamp,
    updated_at: timestamp,
    created_by: "test",
  };
}

describe("dashboard read model", () => {
  it("parses opaque cursor, limit and JSON scalar filters", () => {
    const query = parseDashboardQuery({ limit: "2", filter: JSON.stringify({ status: "accepted", official: true }) });
    expect(query.limit).toBe(2);
    expect(query.filter).toEqual({ status: "accepted", official: true });
    expect(() => dashboardQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it("pages current artifacts by default and keeps content out of list/detail separate", async () => {
    const repository = new MemoryProjectRepository("read-model-artifacts");
    const first = artifact("artifact-old", "character:alpha", "old", "2026-01-01T00:00:00.000Z");
    const second = artifact("artifact-current", "character:alpha", "current", "2026-01-02T00:00:00.000Z");
    const other = artifact("artifact-other", "character:beta", "other", "2026-01-03T00:00:00.000Z");
    await repository.commit(0, (state) => ({ ...state, artifacts: [first, second, other] }));
    const state = await repository.read();
    const page = queryDashboardArtifacts(state, { query: { limit: 1 }, filter: { current_only: false } });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("content");
    expect(page.next_cursor).toBeDefined();
    const detail = dashboardArtifactDetail(state, "artifact-current");
    expect(detail?.content).toBe("current");
    const history = queryDashboardArtifactHistory(state, "character:alpha", { limit: 10 });
    expect(history.items).toHaveLength(2);
  });

  it("filters facts and makes dashboard summary count-only", async () => {
    const repository = new MemoryProjectRepository("read-model-summary");
    await repository.commit(0, (state) => ({ ...state, facts: [fact("fact-1", "accepted", "alpha"), fact("fact-2", "candidate", "beta")] }));
    const state = await repository.read();
    const facts = queryDashboardFacts(state, { query: { limit: 10 }, filter: { status: "accepted", subject: "alpha" } });
    expect(facts.items).toHaveLength(1);
    expect(facts.items[0]?.subject).toBe("alpha");
    const summary = await readDashboardSummary(repository);
    expect(summary.counts.facts).toBe(2);
    expect(summary).not.toHaveProperty("facts");
    expect(summary).not.toHaveProperty("artifacts");
    expect(summary).not.toHaveProperty("audit");
  });
});
