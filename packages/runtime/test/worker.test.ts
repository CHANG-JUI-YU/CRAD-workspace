import { describe, expect, it, vi } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord, type OperationRecord, type SourceRecord } from "@st-workspace/core";
import { WorkspaceRuntime, WorkspaceWorker } from "../src/index.js";

function operation(id: string, request: string, status: OperationRecord["status"] = "running", kind: OperationRecord["kind"] = "authoring"): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request, actor: "writer", status, created_at: timestamp, updated_at: timestamp, progress: [] };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("worker did not reach the expected state");
}

describe("background workspace worker", () => {
  it("recovers an unfinished operation after startup", async () => {
    const repository = new MemoryProjectRepository("demo");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      operations: [{ ...operation("op-recover", "Draft note: Create character: Resume. Personality: calm and clear."), execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "writer", created_at: timestamp } }],
    }));
    const events: string[] = [];
    const worker = new WorkspaceWorker(new WorkspaceRuntime(repository), { pollIntervalMs: 10, retryDelayMs: 1, onEvent: (event) => events.push(event.type) });
    worker.start();
    try {
      await waitFor(async () => (await repository.read()).operations[0]?.status === "completed");
      expect((await repository.read()).artifacts[0]?.name).toBe("Resume");
      expect(events).toContain("ready");
      expect(events).toContain("operation.completed");
    } finally {
      worker.stop();
    }
  });

  it("does not auto-answer a needs_input operation", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-question", "unclear", "needs_input")] }));
    const worker = new WorkspaceWorker(new WorkspaceRuntime(repository), { pollIntervalMs: 10 });
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    worker.stop();
    expect((await repository.read()).operations[0]?.status).toBe("needs_input");
  });

  it("runs queued requests without blocking the caller", async () => {
    const repository = new MemoryProjectRepository("demo");
    const worker = new WorkspaceWorker(new WorkspaceRuntime(repository), { pollIntervalMs: 10 });
    const queued = worker.enqueue({ request: "Draft note: Create character: Queued. Personality: calm and clear.", context: { actor: "writer", attachments: [] } });
    expect(queued.status).toBe("queued");
    expect(worker.status()).toMatchObject({ running: true });
    try {
      const result = await worker.wait(queued.job_id);
      expect(result.status).toBe("completed");
      expect((await repository.read()).artifacts[0]?.name).toBe("Queued");
    } finally {
      worker.stop();
    }
  });

  it("retries transient queued work and exposes lifecycle status", async () => {
    const runtime = new WorkspaceRuntime(new MemoryProjectRepository("demo"));
    const requestResult = { operation_id: "op-queued", status: "completed" as const, summary: "done", completed: [], blocked: [] };
    const request = vi.spyOn(runtime, "request")
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(requestResult);
    const events: string[] = [];
    const worker = new WorkspaceWorker(runtime, { retryDelayMs: 1, maxRetries: 2, onEvent: (event) => events.push(event.type) });
    const queued = worker.enqueue({ request: "retry me", context: { actor: "writer", attachments: [] } });
    try {
      await expect(worker.wait(queued.job_id)).resolves.toEqual(requestResult);
      expect(request).toHaveBeenCalledTimes(2);
      expect(events).toContain("operation.retry");
    } finally {
      worker.stop();
      expect(worker.status()).toMatchObject({ running: false, queued_jobs: 0 });
    }
  });

  it("resolves the current runtime dynamically after a project switch", async () => {
    const first = new MemoryProjectRepository("first");
    const second = new MemoryProjectRepository("second");
    let current = new WorkspaceRuntime(first);
    const worker = new WorkspaceWorker(() => current, { pollIntervalMs: 10, retryDelayMs: 1 });
    current = new WorkspaceRuntime(second);
    const queued = worker.enqueue({ request: "Draft note: Create character: Switched. Personality: calm and clear.", context: { actor: "writer", attachments: [] } });
    try {
      await expect(worker.wait(queued.job_id)).resolves.toMatchObject({ status: "completed" });
      expect((await first.read()).artifacts).toHaveLength(0);
      expect((await second.read()).artifacts[0]?.name).toBe("Switched");
    } finally {
      worker.stop();
    }
  });

  it("marks a persisted operation failed after retry exhaustion", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-fail", "Draft note: Create character: Fail. Personality: clear.")] }));
    const runtime = new WorkspaceRuntime(repository);
    vi.spyOn(runtime, "recoverOperation").mockRejectedValue(new Error("permanent"));
    const fail = vi.spyOn(runtime, "failOperation").mockResolvedValue();
    const events: string[] = [];
    const worker = new WorkspaceWorker(runtime, { pollIntervalMs: 10, maxRetries: 0, onEvent: (event) => events.push(event.type) });
    worker.start();
    try {
      await waitFor(async () => events.includes("operation.failed"));
      expect(fail).toHaveBeenCalledWith("op-fail", expect.any(Error), "writer", expect.objectContaining({ owner: "writer", token: expect.any(String) }));
    } finally {
      worker.stop();
    }
  });

  it("renews the operation lease while recovery is in progress", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-renew", "Draft note: Create character: Renew. Personality: calm and clear.")] }));
    const runtime = new WorkspaceRuntime(repository);
    const renew = vi.spyOn(runtime, "renewOperationLease");
    const recover = vi.spyOn(runtime, "recoverOperation").mockImplementation(async (operationId) => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await repository.commit((await repository.read()).revision, (state) => ({
        ...state,
        operations: state.operations.map((item) => item.id === operationId ? { ...item, status: "completed", updated_at: new Date().toISOString() } : item),
      }));
      return { operation_id: operationId, status: "completed", summary: "done", completed: [], blocked: [] };
    });
    const worker = new WorkspaceWorker(runtime, { pollIntervalMs: 10, leaseRenewIntervalMs: 50 });
    worker.start();
    try {
      await waitFor(async () => (await repository.read()).operations[0]?.status === "completed");
      expect(renew).toHaveBeenCalled();
      expect(renew.mock.calls[0]?.[0]).toBe("op-renew");
      expect(renew.mock.calls[0]?.[1]).toBe("writer");
      expect(renew.mock.calls[0]?.[2]).toEqual(expect.any(String));
      expect(recover).toHaveBeenCalledWith(
        "op-renew",
        expect.objectContaining({ actor: "writer", attachments: [], signal: expect.anything() }),
        expect.objectContaining({ lease: expect.objectContaining({ owner: "writer", token: expect.any(String) }) }),
      );
    } finally {
      worker.stop();
    }
  });

  it("stops quietly when the lease is lost mid-recovery", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-lost", "Draft note: Create character: Lost. Personality: calm and clear.")] }));
    const runtime = new WorkspaceRuntime(repository);
    const renew = vi.spyOn(runtime, "renewOperationLease").mockResolvedValue(false);
    const release = vi.spyOn(runtime, "releaseOperationLease");
    const fail = vi.spyOn(runtime, "failOperation").mockResolvedValue();
    const recover = vi.spyOn(runtime, "recoverOperation").mockImplementation(async (operationId) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await repository.commit((await repository.read()).revision, (state) => ({
        ...state,
        operations: state.operations.map((item) => item.id === operationId ? { ...item, status: "completed", updated_at: new Date().toISOString() } : item),
      }));
      return { operation_id: operationId, status: "completed", summary: "done", completed: [], blocked: [] };
    });
    const events: string[] = [];
    const worker = new WorkspaceWorker(runtime, { pollIntervalMs: 10, leaseRenewIntervalMs: 30, onEvent: (event) => events.push(event.type) });
    worker.start();
    try {
      await waitFor(async () => (await repository.read()).operations[0]?.status === "completed");
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(recover).toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(fail).not.toHaveBeenCalled();
      expect(events).not.toContain("operation.completed");
    } finally {
      worker.stop();
    }
  });

  it("continues every executable operation kind through the same worker seam", async () => {
    const repository = new MemoryProjectRepository("demo");
    const timestamp = new Date().toISOString();
    const sourceText = "Yukino is direct and observant.";
    const source: SourceRecord = { id: "source-1", candidate_id: "candidate-1", title: "Official", canonical_text: sourceText, original_hash: contentHash(sourceText), revision: contentHash(sourceText), media_type: "text/plain", created_at: timestamp };
    const artifactContent = JSON.stringify({ name: "Existing", description: "A complete character description for review." });
    const artifact: ArtifactRecord = { id: "artifact-1", key: "character:existing", kind: "character", name: "Existing", content: artifactContent, media_type: "application/json", content_hash: contentHash(artifactContent), revision: contentHash(artifactContent), status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "writer", operation_id: "op-seed" };
    await repository.commit(0, (state) => ({
      ...state,
      sources: [source],
      candidates: [{ id: "candidate-1", title: "Official", status: "approved", content: sourceText }],
      artifacts: [artifact],
      operations: [
        operation("op-source", "add source", "running", "source"),
        operation("op-knowledge", "Refresh knowledge", "running", "knowledge"),
        operation("op-review", "Review current character", "running", "review"),
        operation("op-build", "Preview current card", "running", "build"),
        operation("op-import", "Import character card", "running", "import"),
      ],
    }));
    const runtime = new WorkspaceRuntime(repository);
    expect((await runtime.recoverOperation("op-source", { actor: "worker", attachments: [] }, { agent: "source-researcher" })).status).toBe("completed");
    expect((await runtime.recoverOperation("op-knowledge", { actor: "worker", attachments: [] })).status).toBe("completed");
    expect((await runtime.recoverOperation("op-review", { actor: "reviewer", attachments: [] }, { agent: "character-critic" })).status).toBe("completed");
    expect((await runtime.recoverOperation("op-build", { actor: "builder", attachments: [] })).status).toBe("completed");
    expect((await runtime.recoverOperation("op-import", { actor: "importer", attachments: [{ name: "card.json", content: new TextEncoder().encode(JSON.stringify({ name: "Imported", description: "A complete imported card" })) }] })).status).toBe("completed");
    expect((await repository.read()).operations.every((item) => item.status === "completed")).toBe(true);
  });

  it("handles missing, terminal and actor-fallback recovery states safely", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-done", "already done", "completed")],
    }));
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.recoverOperation("missing-operation")).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    expect((await runtime.recoverOperation("op-done")).status).toBe("completed");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      operations: [
        { ...operation("op-fallback-actor", "Draft note: Create character: Fallback. Personality: calm."), actor: undefined, execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "writer", created_at: new Date().toISOString() } },
      ],
    }));
    expect((await runtime.recoverOperation("op-fallback-actor", { actor: "", attachments: [] })).status).toBe("completed");
  });

  it("reports a queued request failure after the retry budget is exhausted", async () => {
    const events: string[] = [];
    const worker = new WorkspaceWorker(new WorkspaceRuntime(new MemoryProjectRepository("demo")), { maxRetries: 0, onEvent: (event) => events.push(event.type) });
    const queued = worker.enqueue({ request: "", context: { actor: "writer", attachments: [] } });
    try {
      await expect(worker.wait(queued.job_id)).rejects.toMatchObject({ code: "REQUEST_EMPTY" });
      expect(events).toContain("operation.failed");
    } finally {
      worker.stop();
    }
  });

  it("claims the lease so a second worker never double-executes", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-lease", "Draft note: Create character: Lease. Personality: calm and clear.")] }));
    const runtime = new WorkspaceRuntime(repository);
    const recover = vi.spyOn(runtime, "recoverOperation").mockImplementation(async (operationId) => {
      await repository.commit((await repository.read()).revision, (state) => ({
        ...state,
        operations: state.operations.map((item) => item.id === operationId ? { ...item, status: "completed", updated_at: new Date().toISOString() } : item),
      }));
      return { operation_id: operationId, status: "completed", summary: "done", completed: [], blocked: [] };
    });
    const first = new WorkspaceWorker(runtime, { pollIntervalMs: 5, retryDelayMs: 1 });
    const second = new WorkspaceWorker(runtime, { pollIntervalMs: 5, retryDelayMs: 1 });
    first.start();
    second.start();
    try {
      await waitFor(async () => (await repository.read()).operations[0]?.status === "completed");
      expect(recover).toHaveBeenCalledTimes(1);
    } finally {
      first.stop();
      second.stop();
    }
  });

  it("refuses to claim an operation held by another live lease", async () => {
    const repository = new MemoryProjectRepository("demo");
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const leased: OperationRecord = { ...operation("op-held", "Draft note: Create character: Held. Personality: calm."), lease_owner: "owner-a", lease_token: "token-a", lease_expires_at: future };
    await repository.commit(0, (state) => ({ ...state, operations: [leased] }));
    const runtime = new WorkspaceRuntime(repository);
    expect(await runtime.claimOperation("op-held", "owner-b")).toBeUndefined();
    expect(await runtime.renewOperationLease("op-held", "owner-b", "token-a")).toBe(false);
    expect(await runtime.renewOperationLease("op-held", "owner-a", "token-a")).toBe(true);
    await runtime.releaseOperationLease("op-held", "owner-a", "token-a");
    expect((await repository.read()).operations[0]?.lease_owner).toBeUndefined();
    const claimed = await runtime.claimOperation("op-held", "owner-b");
    expect(claimed?.lease_owner).toBe("owner-b");
    expect(claimed?.attempt).toBe(1);
  });

  it("hands a stale lease to a new owner after expiry", async () => {
    const repository = new MemoryProjectRepository("demo");
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 5_000).toISOString();
    const expired: OperationRecord = { ...operation("op-stale", "Draft note: Create character: Stale. Personality: calm."), lease_owner: "dead-worker", lease_token: "stale-token", lease_expires_at: stale, execution_snapshot: { execution_agent_id: "director", execution_agent_role: "orchestrator", initiated_by: "writer", created_at: now } };
    await repository.commit(0, (state) => ({ ...state, operations: [expired] }));
    const runtime = new WorkspaceRuntime(repository);
    const claimed = await runtime.claimOperation("op-stale", "worker-2");
    expect(claimed?.lease_owner).toBe("worker-2");
    expect(await runtime.recoverOperation("op-stale", { actor: "worker-2", attachments: [] })).toMatchObject({ status: "completed" });
    await runtime.releaseOperationLease("op-stale", "worker-2", claimed?.lease_token ?? "");
    const finalOperation = (await repository.read()).operations[0];
    expect(finalOperation?.status).toBe("completed");
    expect(finalOperation?.lease_owner).toBeUndefined();
    expect(finalOperation?.lease_token).toBeUndefined();
  });

  it("BUG3-09: increments fencing_generation on claim and rejects recovery when generation mismatches", async () => {
    const repository = new MemoryProjectRepository("bug309-fencing");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-fence", "Draft note: Create character: Fence.")] }));
    const runtime = new WorkspaceRuntime(repository);

    const firstClaim = await runtime.claimOperation("op-fence", "worker-1");
    expect(firstClaim?.fencing_generation).toBe(1);

    await runtime.releaseOperationLease("op-fence", "worker-1", firstClaim!.lease_token!);

    const secondClaim = await runtime.claimOperation("op-fence", "worker-2");
    expect(secondClaim?.fencing_generation).toBe(2);

    await expect(
      runtime.recoverOperation(
        "op-fence",
        { actor: "worker-1", attachments: [] },
        { lease: { owner: "worker-1", token: firstClaim!.lease_token!, generation: firstClaim!.fencing_generation } }
      )
    ).rejects.toMatchObject({ code: "OPERATION_LEASE_LOST" });
  });
});