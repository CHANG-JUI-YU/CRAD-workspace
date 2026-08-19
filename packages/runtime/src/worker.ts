import { CoreError, internalId, withWorkspaceAbortSignal, type RequestResult, type WorkspaceContext } from "@st-workspace/core";
import type { WorkspaceRuntime } from "./index.js";

export interface WorkspaceWorkerOptions {
  readonly pollIntervalMs?: number;
  readonly retryDelayMs?: number;
  readonly maxRetries?: number;
  readonly leaseRenewIntervalMs?: number;
  readonly actor?: string;
  readonly onEvent?: (event: WorkspaceWorkerEvent) => void;
}

export type WorkspaceRuntimeProvider = WorkspaceRuntime | (() => WorkspaceRuntime | Promise<WorkspaceRuntime> | undefined);

export type WorkspaceWorkerEvent =
  | { type: "ready" }
  | { type: "operation.started"; operation_id: string; attempt: number }
  | { type: "operation.completed"; operation_id: string; result: RequestResult }
  | { type: "operation.retry"; operation_id: string; attempt: number; error: string }
  | { type: "operation.failed"; operation_id: string; error: string }
  | { type: "operation.lease_lost"; operation_id: string; error: string }
  | { type: "job.queued"; job_id: string }
  | { type: "worker.error"; error: string };

export interface WorkspaceWorkerStatus {
  readonly running: boolean;
  readonly active_operation_id?: string;
  readonly queued_jobs: number;
  readonly last_error?: string;
}

interface WorkerJob {
  readonly id: string;
  readonly request: string;
  readonly context: WorkspaceContext;
  readonly agent?: string;
  attempts: number;
  resolve: (result: RequestResult) => void;
  reject: (error: unknown) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Operation aborted", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Keeps the workspace moving independently from the HTTP/MCP request lifecycle.
 * It recovers only persisted operations that are still executable; `needs_input`
 * and terminal operations remain untouched until a user supplies more information.
 */
export class WorkspaceWorker {
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly leaseRenewIntervalMs: number;
  private readonly actor: string;
  private readonly onEvent: (event: WorkspaceWorkerEvent) => void;
  private readonly jobs: WorkerJob[] = [];
  private readonly results = new Map<string, Promise<RequestResult>>();
  private readonly attempts = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private pumping = false;
  private currentPump: Promise<void> | undefined;
  private activeOperationId: string | undefined;
  private activeAbortController: AbortController | undefined;
  private lastError: string | undefined;

  private readonly runtimeProvider: () => WorkspaceRuntime | Promise<WorkspaceRuntime> | undefined;

  constructor(runtime: WorkspaceRuntimeProvider, options: WorkspaceWorkerOptions = {}) {
    this.runtimeProvider = typeof runtime === "function" ? runtime : () => runtime;
    this.pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 100);
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.leaseRenewIntervalMs = Math.max(50, options.leaseRenewIntervalMs ?? 20_000);
    this.actor = options.actor ?? "worker";
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => { void this.pump(); }, this.pollIntervalMs);
    const timer = this.timer as unknown as { unref?: () => void };
    timer.unref?.();
    this.onEvent({ type: "ready" });
    void this.pump();
  }

  /** Stop polling, cancel active recovery, and wait until the pump has settled. */
  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.activeAbortController?.abort(new Error("Workspace worker stopped"));
    await this.currentPump;
  }

  status(): WorkspaceWorkerStatus {
    return {
      running: this.timer !== undefined,
      ...(this.activeOperationId === undefined ? {} : { active_operation_id: this.activeOperationId }),
      queued_jobs: this.jobs.length,
      ...(this.lastError === undefined ? {} : { last_error: this.lastError }),
    };
  }

  /** Queue a new natural-language request without blocking the caller. */
  enqueue(input: { request: string; context: WorkspaceContext; agent?: string }): { job_id: string; status: "queued" } {
    const jobId = internalId("job");
    const result = new Promise<RequestResult>((resolve, reject) => {
      this.jobs.push({ id: jobId, request: input.request, context: input.context, ...(input.agent === undefined ? {} : { agent: input.agent }), attempts: 0, resolve, reject });
    });
    this.results.set(jobId, result);
    void result.then(() => this.results.delete(jobId), () => this.results.delete(jobId));
    void result.catch(() => undefined);
    this.onEvent({ type: "job.queued", job_id: jobId });
    if (this.timer === undefined) this.start();
    void this.pump();
    return { job_id: jobId, status: "queued" };
  }

  /** Wait for a job created by enqueue; useful for adapters that want async semantics. */
  async wait(jobId: string): Promise<RequestResult> {
    const result = this.results.get(jobId);
    if (result === undefined) throw new Error(`Unknown worker job ${jobId}`);
    return result;
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.timer === undefined) return;
    this.pumping = true;
    const run = (async () => {
      try {
        await this.pumpImpl();
      } catch (error) {
        this.lastError = errorMessage(error);
        this.onEvent({ type: "worker.error", error: this.lastError });
      }
    })().finally(() => {
      this.pumping = false;
      this.currentPump = undefined;
    });
    this.currentPump = run;
    await run;
  }

  private async pumpImpl(): Promise<void> {
    const job = this.jobs.shift();
    if (job !== undefined) {
      await this.runJob(job);
      return;
    }
    const runtime = await this.runtimeProvider();
    if (runtime === undefined) return;
    const recoverable = await runtime.recoverableOperations();
    for (const operation of recoverable) {
      if (this.activeOperationId !== undefined) break;
      await this.runOperation(operation.id, operation.actor ?? this.actor);
    }
  }

  private recoverableError(error: unknown): boolean {
    return !(error instanceof CoreError && error.recoverable === false);
  }

  private async runJob(job: WorkerJob): Promise<void> {
    while (job.attempts <= this.maxRetries) {
      job.attempts += 1;
      try {
        const runtime = await this.runtimeProvider();
        if (runtime === undefined) {
          this.jobs.unshift(job);
          return;
        }
        const result = await runtime.request(job.request, job.context, job.agent === undefined ? {} : { agent: job.agent });
        job.resolve(result);
        this.lastError = undefined;
        return;
      } catch (error) {
        if (!this.recoverableError(error) || job.attempts > this.maxRetries) {
          job.reject(error);
          this.lastError = errorMessage(error);
          this.onEvent({ type: "operation.failed", operation_id: job.id, error: this.lastError });
          return;
        }
        this.onEvent({ type: "operation.retry", operation_id: job.id, attempt: job.attempts, error: errorMessage(error) });
        await delay(this.retryDelayMs * job.attempts);
      }
    }
  }

  private async runOperation(operationId: string, actor: string): Promise<void> {
    const runtime = await this.runtimeProvider();
    if (runtime === undefined) return;
    const claimed = await runtime.claimOperation(operationId, actor);
    if (claimed === undefined) return;
    const token = claimed.lease_token ?? "";
    const attempt = claimed.attempt ?? 1;
    const lease: Readonly<{ owner: string; token: string; generation?: number }> = {
      owner: actor,
      token,
      ...(claimed.fencing_generation === undefined ? {} : { generation: claimed.fencing_generation }),
    };
    this.attempts.set(operationId, attempt);
    this.activeOperationId = operationId;
    this.onEvent({ type: "operation.started", operation_id: operationId, attempt });
    let leaseLost = false;
    let leaseLostEventEmitted = false;
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    const abortForLeaseLoss = () => {
      if (leaseLost) return;
      leaseLost = true;
      abortController.abort(new CoreError("OPERATION_LEASE_LOST", `Operation ${operationId} lost its lease during execution.`, true));
    };
    const emitLeaseLost = () => {
      if (leaseLostEventEmitted) return;
      leaseLostEventEmitted = true;
      this.onEvent({ type: "operation.lease_lost", operation_id: operationId, error: `Operation ${operationId} lost its lease during execution.` });
    };
    const renewer = setInterval(() => {
      runtime.renewOperationLease(operationId, actor, token)
        .then((renewed) => {
          if (!renewed) abortForLeaseLoss();
        })
        .catch(() => abortForLeaseLoss());
    }, this.leaseRenewIntervalMs);
    try {
      const context: WorkspaceContext = { actor, attachments: [], signal: abortController.signal };
      const recovery = withWorkspaceAbortSignal(abortController.signal, () => runtime.recoverOperation(operationId, context, { lease }));
      const result = await abortable(recovery, abortController.signal);
      if (leaseLost) {
        emitLeaseLost();
        return;
      }
      await runtime.releaseOperationLease(operationId, actor, token);
      this.attempts.delete(operationId);
      this.lastError = undefined;
      this.onEvent({ type: "operation.completed", operation_id: operationId, result });
    } catch (error) {
      if (leaseLost) {
        emitLeaseLost();
        return;
      }
      if (abortController.signal.aborted && this.timer === undefined) {
        await runtime.releaseOperationLease(operationId, actor, token);
        this.attempts.delete(operationId);
        return;
      }
      const message = errorMessage(error);
      if (this.recoverableError(error) && attempt <= this.maxRetries) {
        await runtime.releaseOperationLease(operationId, actor, token);
        this.onEvent({ type: "operation.retry", operation_id: operationId, attempt, error: message });
        await delay(this.retryDelayMs * attempt);
      } else {
        await runtime.failOperation(operationId, error, actor, lease);
        this.attempts.delete(operationId);
        this.lastError = message;
        this.onEvent({ type: "operation.failed", operation_id: operationId, error: message });
      }
    } finally {
      clearInterval(renewer);
      if (this.activeAbortController === abortController) this.activeAbortController = undefined;
      this.activeOperationId = undefined;
    }
  }
}
