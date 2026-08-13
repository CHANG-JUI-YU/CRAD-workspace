import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, type OperationRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";
import { deriveReviewRunStatusAndResponse } from "@st-workspace/domain";

describe("Audit 5 Batch 1 Implementations", () => {
  describe("Issue #28: Explicit target_operation_id resume & multi-pending contract", () => {
    it("returns structured pending_operations when multiple operations are in needs_input status without target_operation_id", async () => {
      const repository = new MemoryProjectRepository("multi-pending");
      await repository.commit(0, (current) => ({
        ...current,
        operations: [
          {
            id: "op-1",
            kind: "authoring",
            request: "建立角色A",
            actor: "user",
            status: "needs_input",
            question: "請提供角色A個性？",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
          {
            id: "op-2",
            kind: "authoring",
            request: "建立角色B",
            actor: "user",
            status: "needs_input",
            question: "請提供角色B背景？",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
        ] as OperationRecord[],
      }));
      const runtime = new WorkspaceRuntime(repository);
      const res = await runtime.request("這是一般回答", { actor: "user", attachments: [] });
      expect(res.status).toBe("needs_input");
      expect(res.pending_operations).toHaveLength(2);
      expect(res.pending_operations).toEqual([
        { operation_id: "op-1", kind: "authoring", question: "請提供角色A個性？", request: "建立角色A" },
        { operation_id: "op-2", kind: "authoring", question: "請提供角色B背景？", request: "建立角色B" },
      ]);
    });

    it("resumes specific operation when target_operation_id is specified", async () => {
      const repository = new MemoryProjectRepository("target-resume");
      await repository.commit(0, (current) => ({
        ...current,
        operations: [
          {
            id: "op-1",
            kind: "authoring",
            request: "建立角色A",
            actor: "user",
            status: "needs_input",
            question: "請提供角色A個性？",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
          {
            id: "op-2",
            kind: "authoring",
            request: "建立角色B",
            actor: "user",
            status: "needs_input",
            question: "請提供角色B背景？",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
        ] as OperationRecord[],
      }));
      const runtime = new WorkspaceRuntime(repository);
      const res = await runtime.request("角色B冷酷無情", { actor: "user", attachments: [] }, { target_operation_id: "op-2" });
      expect(res.operation_id).toBe("op-2");
    });

    it("throws OPERATION_NOT_FOUND if target_operation_id does not exist", async () => {
      const repository = new MemoryProjectRepository("target-not-found");
      const runtime = new WorkspaceRuntime(repository);
      await expect(
        runtime.request("回答", { actor: "user", attachments: [] }, { target_operation_id: "non-existent" }),
      ).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    });

    it("throws OPERATION_NOT_RESUMABLE if target operation is not in needs_input status", async () => {
      const repository = new MemoryProjectRepository("target-completed");
      await repository.commit(0, (current) => ({
        ...current,
        operations: [
          {
            id: "op-done",
            kind: "authoring",
            request: "已完成的工作",
            actor: "user",
            status: "completed",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
        ] as OperationRecord[],
      }));
      const runtime = new WorkspaceRuntime(repository);
      await expect(
        runtime.request("回答", { actor: "user", attachments: [] }, { target_operation_id: "op-done" }),
      ).rejects.toMatchObject({ code: "OPERATION_NOT_RESUMABLE" });
    });
  });

  describe("Issue #16: Persisting cancelled operations & audit event", () => {
    it("persists cancelled status, clears lease and emits operation.cancelled event", async () => {
      const repository = new MemoryProjectRepository("cancel-persistence");
      await repository.commit(0, (current) => ({
        ...current,
        operations: [
          {
            id: "op-cancel-target",
            kind: "authoring",
            request: "正在執行的工作",
            actor: "user",
            status: "running",
            lease_owner: "worker-1",
            lease_token: "token-1",
            lease_expires_at: new Date(Date.now() + 60000).toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            progress: [],
          },
        ] as OperationRecord[],
      }));
      const runtime = new WorkspaceRuntime(repository);
      const res = await runtime.cancelOperation("op-cancel-target", "admin");
      expect(res.status).toBe("cancelled");

      const state = await repository.read();
      const op = state.operations.find((o) => o.id === "op-cancel-target");
      expect(op?.status).toBe("cancelled");
      expect(op?.lease_owner).toBeUndefined();
      expect(op?.lease_token).toBeUndefined();
      expect(op?.lease_expires_at).toBeUndefined();

      const audit = state.audit.find((a) => a.operation_id === "op-cancel-target");
      expect(audit?.event).toBe("operation.cancelled");
      expect(audit?.details.cancellation_actor).toBe("admin");
      expect(audit?.details.previous_status).toBe("running");
    });
  });

  describe("Issue #17: Fact review response strictly reflects authoritative state", () => {
    it("derives response status as blocked/needs_input when run has unadjudicated candidates or blockers", () => {
      const mockState: any = {
        fact_review_runs: [
          {
            id: "run-1",
            status: "open",
            candidate_occurrence_ids: ["occ-1", "occ-2"],
          },
        ],
        fact_review_decisions: [
          {
            review_run_id: "run-1",
            candidate_occurrence_id: "occ-1",
            decision: "accepted",
          },
        ],
      };
      const derived = deriveReviewRunStatusAndResponse(mockState, "run-1", "op-fact", { applied: 1, skipped: 0, conflicts: 0 });
      expect(derived.runStatus).toBe("open");
      expect(derived.operationStatus).toBe("needs_input");
      expect(derived.responseStatus).toBe("needs_input");
    });

    it("derives response status as completed when all candidates in run are adjudicated cleanly", () => {
      const mockState: any = {
        fact_review_runs: [
          {
            id: "run-1",
            status: "open",
            candidate_occurrence_ids: ["occ-1", "occ-2"],
          },
        ],
        fact_review_decisions: [
          {
            review_run_id: "run-1",
            candidate_occurrence_id: "occ-1",
            decision: "accepted",
          },
          {
            review_run_id: "run-1",
            candidate_occurrence_id: "occ-2",
            decision: "rejected",
          },
        ],
      };
      const derived = deriveReviewRunStatusAndResponse(mockState, "run-1", "op-fact", { applied: 1, skipped: 0, conflicts: 0 });
      expect(derived.runStatus).toBe("completed");
      expect(derived.operationStatus).toBe("completed");
      expect(derived.responseStatus).toBe("completed");
    });
  });
});
