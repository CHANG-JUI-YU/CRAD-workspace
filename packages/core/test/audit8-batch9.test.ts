import { describe, expect, it } from "vitest";
import { contentHash, createProjectState, validateState, type ProjectState } from "@st-workspace/core";

const now = "2026-08-17T00:00:00.000Z";

describe("Audit 8 Batch 9 - URL lifecycle and evidence schema", () => {
  it("normalizes durable URL transition history and compound evidence metadata", () => {
    const state = createProjectState("batch9-core");
    const hash = contentHash("evidence");
    const raw: ProjectState = {
      ...state,
      candidates: [{
        id: "candidate-1",
        title: "Compound evidence (2 components)",
        status: "approved",
        content_size: 42,
        content_hash: hash,
        source_revision: hash,
        media_type: "application/vnd.st-workspace.compound-evidence",
        evidence_components: [{
          id: "component-url",
          type: "url",
          ordinal: 0,
          content_hash: hash,
          content_size: 42,
          media_type: "text/html",
          title: "Canonical title",
          requested_url: "https://example.com/requested",
          canonical_url: "https://example.com/canonical",
          final_url: "https://example.com/final",
        }],
      }],
      sources: [{
        id: "source-1",
        candidate_id: "candidate-1",
        title: "Compound evidence (2 components)",
        canonical_text: "text",
        original_hash: hash,
        revision: hash,
        media_type: "application/vnd.st-workspace.compound-evidence",
        content_size: 42,
        evidence_components: [{
          id: "component-url",
          type: "url",
          ordinal: 0,
          content_hash: hash,
          content_size: 42,
          media_type: "text/html",
          requested_url: "https://example.com/requested",
          canonical_url: "https://example.com/canonical",
          final_url: "https://example.com/final",
        }],
        created_at: now,
      }],
      url_ingestions: [{
        id: "ingestion-1",
        operation_id: "operation-1",
        url: "https://example.com/requested",
        requested_url: "https://example.com/requested",
        status: "ingested",
        canonical_url: "https://example.com/canonical",
        final_url: "https://example.com/final",
        title: "Canonical title",
        media_type: "text/html",
        content_size: 42,
        source_id: "source-1",
        transitions: [
          { id: "transition-1", sequence: 0, operation_id: "operation-1", status: "url_received", occurred_at: now, requested_url: "https://example.com/requested" },
          { id: "transition-2", sequence: 1, operation_id: "operation-1", status: "fetching", occurred_at: now, requested_url: "https://example.com/requested" },
          { id: "transition-3", sequence: 2, operation_id: "operation-1", status: "content_validated", occurred_at: now, requested_url: "https://example.com/requested", canonical_url: "https://example.com/canonical", final_url: "https://example.com/final" },
          { id: "transition-4", sequence: 3, operation_id: "operation-1", status: "ingested", occurred_at: now, requested_url: "https://example.com/requested", source_id: "source-1" },
        ],
        created_at: now,
        updated_at: now,
      }],
    };

    const parsed = validateState(raw);
    expect(parsed.url_ingestions[0]?.transitions?.map((item) => item.status)).toEqual([
      "url_received", "fetching", "content_validated", "ingested",
    ]);
    expect(parsed.sources[0]?.evidence_components?.[0]?.final_url).toBe("https://example.com/final");
    expect(parsed.candidates[0]?.content_size).toBe(42);
  });

  it("keeps legacy states without URL history or compound metadata readable", () => {
    const state = createProjectState("batch9-legacy");
    const legacy = { ...state } as unknown as Record<string, unknown>;
    delete legacy.url_ingestions;
    const parsed = validateState(legacy as unknown as ProjectState);
    expect(parsed.url_ingestions).toEqual([]);
    expect(parsed.schema_version).toBe(2);
  });
});
