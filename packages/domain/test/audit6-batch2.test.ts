import { describe, expect, it } from "vitest";
import { createProjectState, type ProjectState } from "@st-workspace/core";
import {
  createUserSupplementSource,
  deriveResearchBatchStatus,
  submitResearchTaskCandidates,
} from "../src/index.js";

describe("Audit 6 Batch 2 - Domain Layer", () => {
  it("#42: createUserSupplementSource persists SourceCandidate in state.candidates with lineage link", () => {
    const initialState = createProjectState("proj-1");
    const { candidate, source, state } = createUserSupplementSource(
      initialState,
      "Test user supplement content.",
      "user-actor",
      "op-1",
      "text/plain",
      "Evidence.txt",
    );

    expect(source.candidate_id).toBe(candidate.id);
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]!.id).toBe(candidate.id);
    expect(state.candidates[0]!.status).toBe("approved");
    expect(source.provenance_kind).toBe("user_supplement");
  });

  it("#45: deriveResearchBatchStatus correctly projects status across tasks", () => {
    const batch = {
      id: "batch-1",
      assessment_id: "ass-1",
      assessment_revision: "rev-1",
      requirement_set_id: "reqset-1",
      requirement_set_revision: "rev-1",
      status: "open" as const,
      task_ids: ["t1", "t2"],
      created_by: "actor",
      created_at: "2026-08-14T00:00:00Z",
    };

    const tasksOpen = [
      { id: "t1", batch_id: "batch-1", requirement_ids: ["req1"], dimension_paths: ["path1"], query_seeds: ["q1"], status: "completed" as const, claim_generation: 1, attempt: 1, searched_queries: [], source_families: [], created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z" },
      { id: "t2", batch_id: "batch-1", requirement_ids: ["req2"], dimension_paths: ["path2"], query_seeds: ["q2"], status: "queued" as const, claim_generation: 0, attempt: 0, searched_queries: [], source_families: [], created_at: "2026-08-14T00:00:00Z", updated_at: "2026-08-14T00:00:00Z" },
    ];

    expect(deriveResearchBatchStatus(batch, tasksOpen)).toBe("open");

    const tasksCompleted = [
      { ...tasksOpen[0]!, status: "completed" as const },
      { ...tasksOpen[1]!, status: "completed" as const },
    ];
    expect(deriveResearchBatchStatus(batch, tasksCompleted)).toBe("completed");

    const tasksExhausted = [
      { ...tasksOpen[0]!, status: "completed" as const },
      { ...tasksOpen[1]!, status: "exhausted" as const },
    ];
    expect(deriveResearchBatchStatus(batch, tasksExhausted)).toBe("exhausted");
  });
});
