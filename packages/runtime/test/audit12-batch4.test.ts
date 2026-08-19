import { describe, expect, it, vi } from "vitest";
import { MemoryProjectRepository, type OperationRecord } from "@st-workspace/core";
import { WorkspaceRuntime, WorkspaceWorker } from "../src/index.js";
import { executionContextFor } from "../src/source-application.js";

function operation(id: string): OperationRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    kind: "authoring",
    request: "Draft note: Create character: Cancelled. Personality: calm and clear.",
    actor: "writer",
    status: "running",
    created_at: timestamp,
    updated_at: timestamp,
    progress: [],
    execution_snapshot: {
      execution_agent_id: "director",
      execution_agent_role: "orchestrator",
      initiated_by: "writer",
      created_at: timestamp,
    },
  };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for worker state");
}

describe("Audit 12 BUG12-02 lease-loss cancellation", () => {
  it("propagates the recovery signal into the execution context", () => {
    const controller = new AbortController();
    const execution = executionContextFor(
      operation("op-context"),
      { actor: "writer", attachments: [], signal: controller.signal },
      { id: "director", role: "orchestrator" },
    );

    expect(execution.signal).toBe(controller.signal);
  });

  it("aborts active recovery promptly when lease renewal loses ownership", async () => {
    const repository = new MemoryProjectRepository("audit12-lease-loss");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-lease-loss")] }));
    const runtime = new WorkspaceRuntime(repository);
    vi.spyOn(runtime, "renewOperationLease").mockResolvedValue(false);
    const release = vi.spyOn(runtime, "releaseOperationLease");
    const fail = vi.spyOn(runtime, "failOperation").mockResolvedValue();
    let recoverySignal: AbortSignal | undefined;
    vi.spyOn(runtime, "recoverOperation").mockImplementation(async (_operationId, context) => {
      recoverySignal = context.signal;
      if (recoverySignal === undefined) throw new Error("recovery signal missing");
      await new Promise<never>((_resolve, reject) => {
        const rejectFromAbort = () => reject(recoverySignal!.reason ?? new Error("aborted"));
        if (recoverySignal!.aborted) rejectFromAbort();
        else recoverySignal!.addEventListener("abort", rejectFromAbort, { once: true });
      });
      throw new Error("unreachable");
    });
    const events: string[] = [];
    const worker = new WorkspaceWorker(runtime, {
      pollIntervalMs: 25,
      leaseRenewIntervalMs: 50,
      onEvent: (event) => events.push(event.type),
    });

    worker.start();
    try {
      await waitFor(() => events.includes("operation.lease_lost"));
      expect(recoverySignal?.aborted).toBe(true);
      expect(release).not.toHaveBeenCalled();
      expect(fail).not.toHaveBeenCalled();
      expect(events).not.toContain("operation.completed");
      expect(events).not.toContain("operation.failed");
      expect((await repository.read()).operations[0]?.status).toBe("running");
    } finally {
      await worker.stop();
    }
  });

  it("aborts active recovery and releases its lease during worker shutdown", async () => {
    const repository = new MemoryProjectRepository("audit12-worker-stop");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-stop")] }));
    const runtime = new WorkspaceRuntime(repository);
    vi.spyOn(runtime, "renewOperationLease").mockResolvedValue(true);
    const release = vi.spyOn(runtime, "releaseOperationLease");
    const fail = vi.spyOn(runtime, "failOperation").mockResolvedValue();
    let recoverySignal: AbortSignal | undefined;
    vi.spyOn(runtime, "recoverOperation").mockImplementation(async (_operationId, context) => {
      recoverySignal = context.signal;
      if (recoverySignal === undefined) throw new Error("recovery signal missing");
      await new Promise<never>((_resolve, reject) => {
        const rejectFromAbort = () => reject(recoverySignal!.reason ?? new Error("aborted"));
        if (recoverySignal!.aborted) rejectFromAbort();
        else recoverySignal!.addEventListener("abort", rejectFromAbort, { once: true });
      });
      throw new Error("unreachable");
    });
    const events: string[] = [];
    const worker = new WorkspaceWorker(runtime, {
      pollIntervalMs: 25,
      leaseRenewIntervalMs: 500,
      onEvent: (event) => events.push(event.type),
    });

    worker.start();
    await waitFor(() => recoverySignal !== undefined);
    await Promise.race([
      worker.stop(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("worker stop did not settle after cancellation")), 1_000)),
    ]);

    expect(recoverySignal?.aborted).toBe(true);
    expect(release).toHaveBeenCalledWith("op-stop", "writer", expect.any(String));
    expect(fail).not.toHaveBeenCalled();
    expect(events).not.toContain("operation.failed");
    expect((await repository.read()).operations[0]?.lease_owner).toBeUndefined();
  });
});
