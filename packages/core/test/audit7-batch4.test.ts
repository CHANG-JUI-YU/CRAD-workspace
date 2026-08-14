import { describe, expect, it } from "vitest";
import {
  COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES,
  coverageSupplementLifecycleAttemptSchema,
  coverageSupplementLifecycleProjectionSchema,
  coverageCellActionOptionSchema,
} from "../src/coverage.js";

describe("Audit 7 Batch 4 - Core Types & Schemas", () => {
  it("validates coverage supplement lifecycle stages list", () => {
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("authorized");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("evidence_received");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("source_chunks_ready");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("fact_review");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("accepted_facts");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("resolution_fulfilled");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("reassessment_required");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("reassessed");
    expect(COVERAGE_SUPPLEMENT_LIFECYCLE_STAGES).toContain("failed");
  });

  it("parses valid CoverageSupplementLifecycleAttempt", () => {
    const validAttempt = {
      attempt_id: "op-123",
      operation_id: "op-123",
      status: "completed",
      stage: "resolution_fulfilled",
      stage_status: "completed",
      authorization_saved: true,
      decision_id: "dec-1",
      current_resolution_id: "res-2",
      fulfilled_resolution_id: "res-3",
      source_refs: [{ source_id: "src-1", revision: "rev-1" }],
      chunk_ids: ["chunk-1", "chunk-2"],
      review_run_ids: ["run-1"],
      fact_refs: [{ fact_id: "fact-1", fact_revision: "1", decision_id: "dec-f1" }],
      created_at: "2026-08-14T00:00:00Z",
      updated_at: "2026-08-14T00:01:00Z",
    };

    const parsed = coverageSupplementLifecycleAttemptSchema.parse(validAttempt);
    expect(parsed.attempt_id).toBe("op-123");
    expect(parsed.stage).toBe("resolution_fulfilled");
    expect(parsed.source_refs).toHaveLength(1);
    expect(parsed.fact_refs).toHaveLength(1);
  });

  it("parses valid CoverageSupplementLifecycleProjection with historical attempts", () => {
    const validProjection = {
      requirement_id: "req.world_context",
      scope: "world",
      stage: "fact_review",
      stage_status: "in_progress",
      next_action: "至 Fact Review 進行事實裁決",
      requires_attention: false,
      authorization_saved: true,
      decision_id: "dec-root",
      authorization_resolution_id: "res-auth",
      current_resolution_id: "res-bound",
      operation_ids: ["op-attempt-1", "op-attempt-2"],
      source_refs: [{ source_id: "src-1", revision: "1" }],
      review_run_ids: ["run-1"],
      fact_refs: [],
      current_attempt: {
        attempt_id: "op-attempt-2",
        operation_id: "op-attempt-2",
        status: "running",
        stage: "fact_review",
        stage_status: "in_progress",
        authorization_saved: true,
        source_refs: [{ source_id: "src-1", revision: "1" }],
        chunk_ids: ["chunk-1"],
        review_run_ids: ["run-1"],
        fact_refs: [],
        created_at: "2026-08-14T01:00:00Z",
        updated_at: "2026-08-14T01:00:00Z",
      },
      historical_attempts: [
        {
          attempt_id: "op-attempt-1",
          operation_id: "op-attempt-1",
          status: "failed",
          stage: "failed",
          stage_status: "failed",
          authorization_saved: true,
          source_refs: [],
          chunk_ids: [],
          review_run_ids: [],
          fact_refs: [],
          failure_message: "Network timeout during ingestion.",
          created_at: "2026-08-14T00:50:00Z",
          updated_at: "2026-08-14T00:50:00Z",
        },
      ],
    };

    const parsed = coverageSupplementLifecycleProjectionSchema.parse(validProjection);
    expect(parsed.stage).toBe("fact_review");
    expect(parsed.current_attempt?.attempt_id).toBe("op-attempt-2");
    expect(parsed.historical_attempts).toHaveLength(1);
    expect(parsed.historical_attempts[0]?.failure_message).toBe("Network timeout during ingestion.");
  });

  it("validates CoverageCellActionOption with continue_supplement and target_resolution_id", () => {
    const actionOpt = {
      action: "supplement",
      label: "繼續補件",
      enabled: true,
      target_resolution_id: "res-pending-123",
      scope: {
        requirement_id: "req.world_context",
        assessment_id: "asm-1",
        assessment_revision: "rev-1",
      },
    };

    const parsed = coverageCellActionOptionSchema.parse(actionOpt);
    expect(parsed.label).toBe("繼續補件");
    expect(parsed.target_resolution_id).toBe("res-pending-123");
  });
});
