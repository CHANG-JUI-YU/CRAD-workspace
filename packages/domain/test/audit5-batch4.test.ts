import { describe, expect, it } from "vitest";
import {
  createProjectState,
  type ProjectState,
  type ResearchBatchRecord,
  type ResearchTaskRecord,
} from "@st-workspace/core";
import {
  applyDerivedResearchBatchStatus,
  claimResearchTask,
  createResearchBatchFromAssessment,
  deriveResearchBatchStatus,
  exhaustResearchTask,
  isResearchLeaseExpired,
  reclaimExpiredResearchTasks,
  submitResearchTaskCandidates,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";
const nowMs = Date.parse(now);
const futureAt = new Date(nowMs + 60_000).toISOString();
const expiredAt = new Date(nowMs - 1_000).toISOString();

function batch(id: string, status: ResearchBatchRecord["status"], taskIds: string[]): ResearchBatchRecord {
  return {
    id,
    assessment_id: "assess-1",
    assessment_revision: "rev-1",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    status,
    task_ids: taskIds,
    created_by: "director",
    created_at: now,
  };
}

function task(id: string, batchId: string, status: ResearchTaskRecord["status"], overrides: Partial<ResearchTaskRecord> = {}): ResearchTaskRecord {
  return {
    id,
    batch_id: batchId,
    requirement_ids: ["req.appearance"],
    dimension_paths: ["appearance"],
    query_seeds: ["appearance"],
    status,
    claim_generation: status === "queued" ? 0 : 1,
    attempt: status === "queued" ? 0 : 1,
    searched_queries: [],
    source_families: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function researchState(tasks: ResearchTaskRecord[], batches: ResearchBatchRecord[]): ProjectState {
  return { ...createProjectState("research-project"), coverage_research_batches: batches, coverage_research_tasks: tasks };
}

const candidateInputs = [{ title: "Luna Wiki Page", canonical_url: "https://example.com/luna", snippet: "Luna details", target_requirement_ids: ["req.appearance"] }];

describe("Audit 5 batch 4: coverage research lifecycle", () => {
  it("#11 expired leases never occupy a concurrency slot and a fourth claim succeeds", () => {
    const tasks = [
      task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: expiredAt }),
      task("t2", "b1", "claimed", { lease_owner: "w2", lease_expires_at: expiredAt }),
      task("t3", "b1", "running", { lease_owner: "w3", lease_expires_at: expiredAt }),
      task("t4", "b1", "queued"),
    ];
    const state = researchState(tasks, [batch("b1", "open", ["t1", "t2", "t3", "t4"])]);
    const result = claimResearchTask(state, "b1", "worker-4", 60_000, nowMs);
    expect(result).toBeDefined();
    expect(result!.task.claim_generation).toBe(2);
    expect(result!.task.lease_owner).toBe("worker-4");
    const after = result!.state.coverage_research_tasks;
    expect(after.filter((item) => item.status === "claimed" || item.status === "running")).toHaveLength(1);
    expect(after.find((item) => item.id === "t2")!.status).toBe("queued");
    expect(after.find((item) => item.id === "t2")!.lease_owner).toBeUndefined();
    expect(after.find((item) => item.id === "t2")!.lease_expires_at).toBeUndefined();
  });

  it("#11 only live leases count toward the concurrency limit", () => {
    const tasks = [
      task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt }),
      task("t2", "b1", "claimed", { lease_owner: "w2", lease_expires_at: futureAt }),
      task("t3", "b1", "claimed", { lease_owner: "w3", lease_expires_at: expiredAt }),
      task("t4", "b1", "queued"),
    ];
    const state = researchState(tasks, [batch("b1", "open", ["t1", "t2", "t3", "t4"])]);
    const result = claimResearchTask(state, "b1", "worker-4", 60_000, nowMs);
    expect(result).toBeDefined();
    expect(result!.task.status).toBe("claimed");
    expect(result!.task.batch_id).toBe("b1");
  });

  it("#11 three live leases still block a fourth claim", () => {
    const tasks = [
      task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt }),
      task("t2", "b1", "claimed", { lease_owner: "w2", lease_expires_at: futureAt }),
      task("t3", "b1", "running", { lease_owner: "w3", lease_expires_at: futureAt }),
      task("t4", "b1", "queued"),
    ];
    const state = researchState(tasks, [batch("b1", "open", ["t1", "t2", "t3", "t4"])]);
    expect(() => claimResearchTask(state, "b1", "worker-4", 60_000, nowMs)).toThrowError(/maximum 3 active research claims/iu);
  });

  it("#11 takeover increments generation and attempt, writes the new owner and expiry, and fences the old worker", () => {
    const claimed = task("t1", "b1", "claimed", { claim_generation: 2, attempt: 2, lease_owner: "w1", lease_expires_at: expiredAt });
    const state = researchState([claimed, task("t2", "b1", "queued")], [batch("b1", "open", ["t1", "t2"])]);
    const result = claimResearchTask(state, "b1", "worker-2", 60_000, nowMs);
    expect(result).toBeDefined();
    expect(result!.task.id).toBe("t1");
    expect(result!.task.claim_generation).toBe(3);
    expect(result!.task.attempt).toBe(3);
    expect(result!.task.lease_owner).toBe("worker-2");
    expect(result!.task.lease_expires_at).toBe(new Date(nowMs + 60_000).toISOString());
    expect(() => submitResearchTaskCandidates(result!.state, "t1", 2, "w1", candidateInputs, "researcher-1")).toThrowError(/lease lost or generation mismatch/iu);
    const submit = submitResearchTaskCandidates(result!.state, "t1", 3, "worker-2", candidateInputs, "researcher-1", nowMs);
    expect(submit.candidates).toHaveLength(1);
  });

  it("#11 claimed tasks without valid lease metadata are reclaimed and do not occupy a slot", () => {
    const tasks = [
      task("t1", "b1", "claimed", { lease_owner: "w1" }),
      task("t2", "b1", "running", { lease_expires_at: futureAt }),
      task("t3", "b1", "claimed"),
      task("t4", "b1", "queued"),
    ];
    const state = researchState(tasks, [batch("b1", "open", ["t1", "t2", "t3", "t4"])]);
    expect(isResearchLeaseExpired(tasks[0]!, nowMs)).toBe(true);
    expect(isResearchLeaseExpired(tasks[2]!, nowMs)).toBe(true);
    const result = claimResearchTask(state, "b1", "worker-4", 60_000, nowMs);
    expect(result).toBeDefined();
    expect(result!.task.batch_id).toBe("b1");
    const after = result!.state.coverage_research_tasks;
    expect(after.find((item) => item.id === "t3")!.status).toBe("queued");
  });

  it("#11 reclaiming other batches never claims a task outside the requested batch", () => {
    const tasks = [
      task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: expiredAt }),
      task("t2", "b1", "claimed", { lease_owner: "w2", lease_expires_at: expiredAt }),
      task("t3", "b1", "claimed", { lease_owner: "w3", lease_expires_at: expiredAt }),
      task("t4", "b2", "queued"),
    ];
    const state = researchState(tasks, [batch("b1", "open", ["t1", "t2", "t3"]), batch("b2", "open", ["t4"])]);
    const result = claimResearchTask(state, "b2", "worker-4", 60_000, nowMs);
    expect(result).toBeDefined();
    expect(result!.task.id).toBe("t4");
    const after = result!.state.coverage_research_tasks;
    expect(after.find((item) => item.id === "t1")!.status).toBe("queued");
    expect(after.find((item) => item.id === "t4")!.claim_generation).toBe(1);
  });

  it("#13 completed tasks reject resubmission and leave state untouched", () => {
    const t = task("t1", "b1", "completed", { lease_owner: "w1", lease_expires_at: futureAt });
    const state = researchState([t], [batch("b1", "completed", ["t1"])]);
    expect(() => submitResearchTaskCandidates(state, "t1", 1, "w1", candidateInputs, "researcher-1")).toThrowError(/is terminal \(completed\) and cannot be modified/iu);
    expect(state.coverage_research_tasks).toEqual([t]);
    expect(state.candidates).toHaveLength(0);
    expect(state.coverage_research_lineages).toHaveLength(0);
  });

  it("#13 exhausted tasks reject resubmission and terminal tasks reject re-exhaustion", () => {
    const exhausted = task("t1", "b1", "exhausted", { lease_owner: "w1", lease_expires_at: futureAt, exhausted_reason: "no results" });
    const state = researchState([exhausted], [batch("b1", "exhausted", ["t1"])]);
    expect(() => submitResearchTaskCandidates(state, "t1", 1, "w1", candidateInputs, "researcher-1")).toThrowError(/is terminal \(exhausted\) and cannot be modified/iu);
    expect(() => exhaustResearchTask(state, "t1", 1, "w1", ["q1"], ["family"], "nothing found", "researcher-1")).toThrowError(/is terminal \(exhausted\) and cannot be modified/iu);
    expect(state.coverage_research_tasks).toEqual([exhausted]);
  });

  it("#13 replaying a submission after the task completed is rejected and never adds lineage", () => {
    const t = task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt });
    const state = researchState([t], [batch("b1", "open", ["t1"])]);
    const first = submitResearchTaskCandidates(state, "t1", 1, "w1", candidateInputs, "researcher-1", nowMs);
    expect(first.candidates).toHaveLength(1);
    expect(first.state.coverage_research_lineages).toHaveLength(1);
    expect(() => submitResearchTaskCandidates(first.state, "t1", 1, "w1", candidateInputs, "researcher-1", nowMs)).toThrowError(/is terminal \(completed\) and cannot be modified/iu);
    expect(first.state.candidates).toHaveLength(1);
    expect(first.state.coverage_research_lineages).toHaveLength(1);
  });

  it("#13 one submission never creates duplicate canonical lineage for the same task candidate", () => {
    const t = task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt });
    const state = researchState([t], [batch("b1", "open", ["t1"])]);
    const result = submitResearchTaskCandidates(state, "t1", 1, "w1", [candidateInputs[0]!, candidateInputs[0]!], "researcher-1", nowMs);
    expect(result.candidates).toHaveLength(1);
    expect(result.state.coverage_research_lineages).toHaveLength(1);
  });

  it("#12 derives batch status exclusively from child task states", () => {
    expect(deriveResearchBatchStatus(batch("b", "open", []), [])).toBe("completed");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1"]), [task("t1", "b", "queued")])).toBe("open");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1"]), [task("t1", "b", "claimed", { lease_owner: "w1", lease_expires_at: futureAt })])).toBe("open");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1"]), [task("t1", "b", "completed")])).toBe("completed");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1", "t2"]), [task("t1", "b", "completed"), task("t2", "b", "exhausted", { exhausted_reason: "nothing" })])).toBe("exhausted");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1"]), [task("t1", "b", "failed")])).toBe("failed");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1", "t2"]), [task("t1", "b", "stale"), task("t2", "b", "exhausted", { exhausted_reason: "nothing" })])).toBe("stale");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1", "t2"]), [task("t1", "b", "failed"), task("t2", "b", "stale")])).toBe("failed");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1"]), [task("t1", "b", "cancelled")])).toBe("cancelled");
    expect(deriveResearchBatchStatus(batch("b", "open", ["t1", "t2"]), [task("t1", "b", "completed"), task("t2", "b", "cancelled")])).toBe("exhausted");
  });

  it("#12 applies the derived status back to the parent batch", () => {
    const t = task("t1", "b1", "completed");
    const stale = { ...t, id: "t2", status: "exhausted" as const, exhausted_reason: "nothing" };
    const state = researchState([t, stale], [batch("b1", "open", ["t1", "t2"])]);
    const applied = applyDerivedResearchBatchStatus(state, "b1");
    expect(applied.coverage_research_batches.find((item) => item.id === "b1")!.status).toBe("exhausted");
  });

  it("#12 submitting the final task completes the parent batch and leaves unrelated batches alone", () => {
    const t1 = task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt });
    const t2 = task("t2", "b2", "claimed", { lease_owner: "w2", lease_expires_at: futureAt });
    const state = researchState([t1, t2], [batch("b1", "open", ["t1"]), batch("b2", "open", ["t2"])]);
    const result = submitResearchTaskCandidates(state, "t1", 1, "w1", candidateInputs, "researcher-1", nowMs);
    const b1 = result.state.coverage_research_batches.find((item) => item.id === "b1")!;
    const b2 = result.state.coverage_research_batches.find((item) => item.id === "b2")!;
    expect(b1.status).toBe("completed");
    expect(b2.status).toBe("open");
    expect(result.state.coverage_research_tasks.find((item) => item.id === "t2")!.status).toBe("claimed");
  });

  it("#12 exhausting the only task marks the batch exhausted", () => {
    const t = task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt });
    const state = researchState([t], [batch("b1", "open", ["t1"])]);
    const result = exhaustResearchTask(state, "t1", 1, "w1", ["luna lore"], ["official"], "search exhausted after bounded queries", "researcher-1", nowMs);
    expect(result.task.status).toBe("exhausted");
    expect(result.state.coverage_research_batches.find((item) => item.id === "b1")!.status).toBe("exhausted");
  });

  it("#12 a batch with a live child stays open after another task completes", () => {
    const t1 = task("t1", "b1", "claimed", { lease_owner: "w1", lease_expires_at: futureAt });
    const t2 = task("t2", "b1", "claimed", { lease_owner: "w2", lease_expires_at: futureAt });
    const state = researchState([t1, t2], [batch("b1", "open", ["t1", "t2"])]);
    const result = submitResearchTaskCandidates(state, "t1", 1, "w1", candidateInputs, "researcher-1", nowMs);
    expect(result.state.coverage_research_batches.find((item) => item.id === "b1")!.status).toBe("open");
  });

  it("integrated batch from an assessment completes after every task submits", () => {
    const base = createProjectState("test-proj");
    const reqSet = { id: "set-1", revision: "set-rev-1", source: "default" as const, characters: [], world_requirement_ids: [], created_by: "system", created_at: now };
    const assessment = {
      id: "assess-1",
      revision: "rev-1",
      pass: "initial" as const,
      requirement_set_id: "set-1",
      requirement_set_revision: "set-rev-1",
      input_snapshot: { source_revisions: [] as Array<{ source_id: string; revision: string }> },
      items: [
        { character_id: "char-luna", requirement_id: "req.appearance", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
        { character_id: "char-luna", requirement_id: "req.personality", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
        { character_id: "char-luna", requirement_id: "req.relationships", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
        { requirement_id: "req.world_context", status: "missing" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] },
      ],
      operation_id: "op-1",
      created_by: "system",
      created_at: now,
    };
    const state: ProjectState = { ...base, coverage_requirement_sets: [reqSet], coverage_assessments: [assessment] };
    const { batch: created, state: withBatch } = createResearchBatchFromAssessment(state, "assess-1", "director");
    let current = withBatch;
    let claimed: ReturnType<typeof claimResearchTask> = claimResearchTask(current, created.id, "worker-1", 60_000, nowMs);
    let count = 0;
    while (claimed !== undefined && count < 10) {
      current = claimed.state;
      const submitted = submitResearchTaskCandidates(current, claimed.task.id, claimed.task.claim_generation, claimed.task.lease_owner!, [{ title: `Page ${count}`, canonical_url: `https://example.com/page-${count}`, snippet: "details", target_requirement_ids: ["req.appearance"] }], "researcher-1", nowMs);
      current = submitted.state;
      claimed = claimResearchTask(current, created.id, "worker-1", 60_000, nowMs);
      count += 1;
    }
    expect(current.coverage_research_batches.find((item) => item.id === created.id)!.status).toBe("completed");
    expect(current.coverage_research_tasks.every((item) => item.status === "completed")).toBe(true);
  });
});
