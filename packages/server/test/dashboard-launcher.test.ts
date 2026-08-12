import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  closeDashboardServer,
  DASHBOARD_SERVICE,
  DASHBOARD_URL,
  DashboardLauncherError,
  launchDashboard,
  probeDashboardService,
} from "../src/dashboard-launcher.js";

const TEST_REVISION = `sha256:${"a".repeat(64)}`;

function healthResponse(service = DASHBOARD_SERVICE, runtimeRevision: string | null = TEST_REVISION): Response {
  return new Response(JSON.stringify({
    service,
    status: "ready",
    ...(runtimeRevision === null ? {} : { runtime_revision: runtimeRevision }),
    worker: { running: true },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function refused(): Error {
  return Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
}

function revisionDependency(revision = TEST_REVISION): () => Promise<string> {
  return vi.fn(async () => revision);
}

async function listeningServer(): Promise<Server> {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

describe("Dashboard launcher", () => {
  it("recognizes an existing ST Workspace service and its revision", async () => {
    const result = await probeDashboardService(vi.fn(async () => healthResponse()) as unknown as typeof fetch);
    expect(result).toEqual({ status: "available", runtime_revision: TEST_REVISION });
  });

  it("distinguishes an absent service from a foreign service", async () => {
    const absent = await probeDashboardService(vi.fn(async () => { throw refused(); }) as unknown as typeof fetch);
    const occupied = await probeDashboardService(vi.fn(async () => healthResponse("other-service")) as unknown as typeof fetch);
    expect(absent).toEqual({ status: "absent" });
    expect(occupied).toMatchObject({ status: "occupied", detail: "health response is not ST Workspace V3" });
  });

  it("reuses an existing service only when the runtime revision matches", async () => {
    const startServer = vi.fn();
    const openBrowser = vi.fn(async () => undefined);
    const result = await launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse()) as unknown as typeof fetch,
      startServer,
      computeRuntimeRevision: revisionDependency(),
      openBrowser,
      log: vi.fn(),
    });
    expect(result).toEqual({ ownership: "reused", url: DASHBOARD_URL, runtime_revision: TEST_REVISION });
    expect(startServer).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith(DASHBOARD_URL);
  });

  it.each([
    ["missing", null],
    ["different", `sha256:${"b".repeat(64)}`],
  ])("rejects a healthy but %s service as stale without starting or opening it", async (_label, observedRevision) => {
    const startServer = vi.fn();
    const openBrowser = vi.fn(async () => undefined);
    await expect(launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse(DASHBOARD_SERVICE, observedRevision)) as unknown as typeof fetch,
      startServer,
      computeRuntimeRevision: revisionDependency(),
      openBrowser,
      log: vi.fn(),
    })).rejects.toMatchObject<Partial<DashboardLauncherError>>({ code: "DASHBOARD_SERVICE_STALE" });
    expect(startServer).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("starts one owned server with the expected revision and waits until health is ready", async () => {
    const server = await listeningServer();
    let probes = 0;
    const openBrowser = vi.fn(async () => undefined);
    const startServer = vi.fn(async () => server);
    const result = await launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => {
        probes += 1;
        if (probes === 1) throw refused();
        return healthResponse();
      }) as unknown as typeof fetch,
      startServer,
      computeRuntimeRevision: revisionDependency(),
      openBrowser,
      wait: vi.fn(async () => undefined),
      log: vi.fn(),
    });
    expect(result).toMatchObject({ ownership: "started", url: DASHBOARD_URL, runtime_revision: TEST_REVISION, server });
    expect(startServer).toHaveBeenCalledWith(expect.objectContaining({ runtimeRevision: TEST_REVISION, workspaceRoot: "C:/workspace" }));
    expect(openBrowser).toHaveBeenCalledOnce();
    await closeDashboardServer(server);
    expect(server.listening).toBe(false);
  });

  it("fails closed when 8787 belongs to another service", async () => {
    await expect(launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse("foreign")) as unknown as typeof fetch,
      startServer: vi.fn(),
      computeRuntimeRevision: revisionDependency(),
      openBrowser: vi.fn(async () => undefined),
      log: vi.fn(),
    })).rejects.toMatchObject<Partial<DashboardLauncherError>>({ code: "DASHBOARD_PORT_IN_USE" });
  });

  it("closes a newly started server after health timeout", async () => {
    const server = await listeningServer();
    await expect(launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => { throw refused(); }) as unknown as typeof fetch,
      startServer: vi.fn(async () => server),
      computeRuntimeRevision: revisionDependency(),
      openBrowser: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
      log: vi.fn(),
    }, { healthAttempts: 2, healthDelayMs: 0 })).rejects.toMatchObject<Partial<DashboardLauncherError>>({ code: "DASHBOARD_HEALTH_TIMEOUT" });
    expect(server.listening).toBe(false);
  });

  it("keeps a healthy service available when the browser cannot be opened", async () => {
    const result = await launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse()) as unknown as typeof fetch,
      startServer: vi.fn(),
      computeRuntimeRevision: revisionDependency(),
      openBrowser: vi.fn(async () => { throw new Error("no URL handler"); }),
      log: vi.fn(),
    });
    expect(result.ownership).toBe("reused");
    expect(result.browser_warning).toContain("DASHBOARD_BROWSER_OPEN_FAILED");
  });
});
