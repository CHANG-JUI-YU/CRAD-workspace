import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { WorkspaceProjectManager, WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { DASHBOARD_API_JS } from "../src/dashboard-api.js";

describe("Audit 12 dashboard operation polling", () => {
  it("keeps unselected Dashboard operation reads side-effect free", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-audit12-unselected-"));
    const manager = new WorkspaceProjectManager({
      root,
      createRuntime: (repository) => new WorkspaceRuntime(repository),
    });
    const server = createWorkspaceServer({
      projectManager: manager,
      actor: "audit12",
      autoStartWorker: false,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    const base = `http://127.0.0.1:${address.port}`;

    try {
      expect(manager.sessionSelected()).toBe(false);
      expect(await readdir(root)).toEqual([]);

      const dashboardResponse = await fetch(`${base}/`);
      expect(dashboardResponse.status).toBe(200);
      await dashboardResponse.text();
      expect(manager.sessionSelected()).toBe(false);
      expect(await readdir(root)).toEqual([]);

      const operationsResponse = await fetch(`${base}/workspace/dashboard/operations?limit=7`);
      expect(operationsResponse.status).toBe(200);
      expect(await operationsResponse.json()).toMatchObject({
        selected: false,
        items: [],
        total: 0,
        limit: 7,
      });
      expect(manager.sessionSelected()).toBe(false);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not poll while unselected and keeps operation polling single-flight", async () => {
    let fetchCalls = 0;
    let renderCalls = 0;
    let nextTimerId = 0;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    const fetchResolvers: Array<(response: { ok: boolean; status: number; statusText: string; text(): Promise<string> }) => void> = [];

    const context: Record<string, unknown> = {
      state: { sessionUnselected: true, projectGeneration: 1 },
      window: {
        location: { search: "", pathname: "/", hash: "" },
        history: { replaceState: () => undefined },
        addEventListener: () => undefined,
      },
      document: {
        hidden: false,
        addEventListener: () => undefined,
      },
      navigator: { onLine: true },
      URLSearchParams,
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++nextTimerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id: number) => {
        timers.delete(id);
      },
      fetch: () => {
        fetchCalls += 1;
        return new Promise((resolve) => {
          fetchResolvers.push(resolve);
        });
      },
      renderOperationList: () => {
        renderCalls += 1;
      },
      byId: () => null,
      updateLastUpdated: () => undefined,
    };

    runInNewContext(DASHBOARD_API_JS, context);

    expect(fetchCalls).toBe(0);
    expect([...timers.values()].map((timer) => timer.delay)).toEqual([12000]);

    (context.state as { sessionUnselected: boolean }).sessionUnselected = false;
    (context.operationMonitorWake as () => void)();
    expect(fetchCalls).toBe(1);
    expect(timers.size).toBe(0);

    (context.operationMonitorTick as () => void)();
    expect(fetchCalls).toBe(1);

    fetchResolvers.shift()?.({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ items: [{ id: "op-1", status: "running" }] }),
    });
    await flushMicrotasks();

    expect(renderCalls).toBe(1);
    expect([...timers.values()].map((timer) => timer.delay)).toEqual([3000]);

    const nextTimer = timers.entries().next().value as [number, { callback: () => void; delay: number }] | undefined;
    expect(nextTimer).toBeDefined();
    if (nextTimer === undefined) throw new Error("operation monitor did not schedule the next poll");
    timers.delete(nextTimer[0]);
    nextTimer[1].callback();
    expect(fetchCalls).toBe(2);

    (context.operationMonitorTick as () => void)();
    expect(fetchCalls).toBe(2);

    (context.state as { projectGeneration: number }).projectGeneration = 2;
    fetchResolvers.shift()?.({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ items: [] }),
    });
    await flushMicrotasks();

    expect(renderCalls).toBe(1);
    expect(timers.size).toBe(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
