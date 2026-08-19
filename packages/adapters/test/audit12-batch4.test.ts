import { describe, expect, it } from "vitest";
import { withWorkspaceAbortSignal } from "@st-workspace/core";
import { HttpSourceFetcher, type HttpTransport } from "../src/index.js";

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for transport signal");
}

describe("Audit 12 BUG12-02 source transport cancellation", () => {
  it("aborts the active HTTP transport from the operation cancellation context", async () => {
    const operationController = new AbortController();
    let transportSignal: AbortSignal | undefined;
    const transport: HttpTransport = async (_url, _pinnedAddress, signal) => {
      transportSignal = signal;
      return new Promise((_resolve, reject) => {
        const rejectFromAbort = () => reject(signal.reason ?? new Error("transport aborted"));
        if (signal.aborted) rejectFromAbort();
        else signal.addEventListener("abort", rejectFromAbort, { once: true });
      });
    };
    const fetcher = new HttpSourceFetcher({
      transport,
      lookup: async () => ["93.184.216.34"],
      timeoutMs: 60_000,
    });

    const fetchPromise = withWorkspaceAbortSignal(operationController.signal, () => fetcher.fetch("https://example.com/source"));
    await waitFor(() => transportSignal !== undefined);
    const cancellation = new Error("operation lease lost");
    operationController.abort(cancellation);

    await expect(fetchPromise).rejects.toBe(cancellation);
    expect(transportSignal?.aborted).toBe(true);
    expect(transportSignal?.reason).toBe(cancellation);
  });
});
