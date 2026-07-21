import { workflowTaskSchema } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import { acceptTask, claimTask, createSuccessorTask, markTaskFailed, rejectTask, requestTaskClarification, resolveTaskClarification, submitTask, supersedeTask } from "../src/index.js";
import { REVISION_A } from "./helpers.js";

const clock = (iso: string) => ({ now: () => new Date(iso) });
const baseTask = () => workflowTaskSchema.parse({
  id: "task-a", kind: "create", status: "pending", assigned_agent: "creator", capabilities: ["proposal.submit"], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 0, max_attempts: 4, extensions: {},
});

describe("task queue, lease and retry", () => {
  it("claim、submit、accept 且 result retry idempotent", () => {
    const claimed = claimTask(baseTask(), { owner: "creator", leaseId: "lease-a", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:00.000Z") });
    const submission = { taskId: "task-a", leaseId: "lease-a", owner: "creator", result: { id: "result-a", revision: REVISION_A } };
    expect(submitTask(claimed, submission, clock("2026-07-14T00:00:00.500Z"))).toEqual(submission);
    expect(acceptTask(claimed, submission, clock("2026-07-14T00:00:00.500Z"))).toMatchObject({ status: "completed", result: submission.result });
    expect(submitTask({ ...claimed, result: submission.result }, submission, clock("2026-07-14T00:00:00.500Z"))).toEqual(submission);
  });

  it("未過期不可搶占；過期可 reclaim；late result 拒絕", () => {
    const claimed = claimTask(baseTask(), { owner: "creator", leaseId: "lease-a", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:00.000Z") });
    expect(() => claimTask(claimed, { owner: "other", leaseId: "lease-b", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:00.500Z") })).toThrow(/不可 claim/u);
    const reclaimed = claimTask(claimed, { owner: "other", leaseId: "lease-b", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:02.000Z") });
    expect(reclaimed).toMatchObject({ attempt: 2, lease: { id: "lease-b", owner: "other" } });
    expect(() => submitTask(reclaimed, { taskId: "task-a", leaseId: "lease-a", owner: "creator", result: { id: "result-a", revision: REVISION_A } }, clock("2026-07-14T00:00:02.100Z"))).toThrow(/lease/u);
  });

  it("released task 可免費 resume，並相容已達 max attempts 的舊 pending state", () => {
    const options = { owner: "creator", leaseId: "lease-resume", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:00.000Z") };
    expect(claimTask(workflowTaskSchema.parse({
      ...baseTask(), attempt: 4, max_attempts: 4, resume_without_attempt: true,
    }), options)).toMatchObject({ status: "claimed", attempt: 4 });
    expect(claimTask(workflowTaskSchema.parse({
      ...baseTask(), attempt: 4, max_attempts: 4,
    }), options)).toMatchObject({ status: "claimed", attempt: 4 });

    const expiredFinalLease = workflowTaskSchema.parse({
      ...baseTask(), status: "claimed", attempt: 4, max_attempts: 4,
      lease: { id: "lease-expired", owner: "creator", claimed_at: "2026-07-13T23:59:00.000Z", expires_at: "2026-07-13T23:59:30.000Z" },
    });
    expect(claimTask(expiredFinalLease, options)).toMatchObject({
      status: "claimed", attempt: 4, lease: { id: "lease-resume" },
    });
  });

  it("dependencies、attempt 與兩次修訂後 needs_user_decision", () => {
    const dependencyTask = workflowTaskSchema.parse({ ...baseTask(), dependencies: ["task-prior"] });
    const fixedClock = clock("2026-07-14T00:00:00.000Z");
    expect(() => claimTask(dependencyTask, { owner: "creator", leaseId: "lease-a", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: fixedClock })).toThrow(/dependencies/u);
    const claimed = claimTask(baseTask(), { owner: "creator", leaseId: "lease-a", leaseDurationMs: 1000, completedTaskIds: new Set(), clock: fixedClock });
    const submission = { taskId: "task-a", leaseId: "lease-a", owner: "creator", result: { id: "result-a", revision: REVISION_A } };
    expect(rejectTask(claimed, submission, "revise", 1, fixedClock)).toMatchObject({ status: "retryable" });
    expect(rejectTask(claimed, submission, "revise", 2, fixedClock)).toMatchObject({ status: "needs_user_decision" });
  });

  it("只有 engine 建立後繼 task，superseded task 不接受 result", () => {
    const successor = createSuccessorTask({ id: "task-b", kind: "revise", assignedAgent: "creator", capabilities: [], inputArtifacts: [], outputContract: "proposal@1", dependencies: ["task-a"], maxAttempts: 3 }, "engine");
    expect(successor).toMatchObject({ id: "task-b", status: "pending", attempt: 0 });
    const superseded = supersedeTask(baseTask());
    expect(() => submitTask(superseded, { taskId: "task-a", leaseId: "lease-a", owner: "creator", result: { id: "result-a", revision: REVISION_A } })).toThrow(/不接受/u);
  });

  it("持久化 typed failure，普通耗盡為 failed，recovery 耗盡要求使用者決策", () => {
    const retryable = markTaskFailed(
      workflowTaskSchema.parse({ ...baseTask(), status: "claimed", attempt: 1 }),
      "Provider timed out", "provider_timeout", "2026-07-18T00:00:00.000Z", "creator",
    );
    expect(retryable).toMatchObject({
      status: "retryable", failure_summary: "Provider timed out",
      failure: { category: "provider_timeout", summary: "Provider timed out", failed_by: "creator", attempt: 1 },
    });
    const reclaimed = claimTask(retryable, {
      owner: "creator", leaseId: "lease-retry", leaseDurationMs: 1000, completedTaskIds: new Set(),
      clock: clock("2026-07-18T00:00:01.000Z"),
    });
    expect(reclaimed.failure).toBeUndefined();

    const exhausted = markTaskFailed(
      workflowTaskSchema.parse({ ...baseTask(), status: "claimed", attempt: 4 }),
      "Tool unavailable", "temporary_unavailable", "2026-07-18T00:00:00.000Z", "creator",
    );
    expect(exhausted.status).toBe("failed");

    const recoveryExhausted = markTaskFailed(
      workflowTaskSchema.parse({ ...baseTask(), status: "claimed", attempt: 1, max_attempts: 1, extensions: { recovery_of: "original", recovery_generation: 1 } }),
      "Interrupted again", "session_interruption", "2026-07-18T00:00:00.000Z", "creator",
    );
    expect(recoveryExhausted).toMatchObject({ status: "needs_user_decision", extensions: { recovery_exhausted: true } });
  });

  it("clarification 清除 lease，resolve 後免費 resume 一次", () => {
    const claimed = claimTask(baseTask(), { owner: "creator", leaseId: "lease-a", leaseDurationMs: 60_000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:00:00.000Z") });
    const waiting = requestTaskClarification(claimed, "creator", "lease-a", {
      id: "clarification-a",
      question: "關係核心採哪一種？",
      reason: "不同答案會改變後續全部模組",
      affectedModules: ["extension", "scene-dialogue"],
      options: [
        { id: "rivals", label: "宿敵", consequence: "互動以競爭為主" },
        { id: "partners", label: "搭檔", consequence: "互動以合作為主" },
      ],
      requestedAt: "2026-07-14T00:00:01.000Z",
    }, clock("2026-07-14T00:00:01.000Z"));
    expect(waiting).toMatchObject({ status: "needs_user_decision", attempt: 1, lease: undefined });
    const pending = resolveTaskClarification(waiting, {
      clarificationId: "clarification-a", answer: "選宿敵", selectedOption: "rivals", resolvedAt: "2026-07-14T00:01:00.000Z",
    });
    expect(pending).toMatchObject({ status: "pending", attempt: 1, resume_without_attempt: true });
    const resumed = claimTask(pending, { owner: "creator", leaseId: "lease-b", leaseDurationMs: 60_000, completedTaskIds: new Set(), clock: clock("2026-07-14T00:01:01.000Z") });
    expect(resumed).toMatchObject({ status: "claimed", attempt: 1, lease: { id: "lease-b" } });
    expect(resumed.resume_without_attempt).toBeUndefined();
    expect(() => resolveTaskClarification(workflowTaskSchema.parse({ ...baseTask(), status: "needs_user_decision" }), {
      clarificationId: "missing", answer: "x", resolvedAt: "2026-07-14T00:01:00.000Z",
    })).toThrow(/待解答/u);
  });
});
