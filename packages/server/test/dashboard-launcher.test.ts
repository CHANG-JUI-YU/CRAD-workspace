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

function healthResponse(service = DASHBOARD_SERVICE): Response {
  return new Response(JSON.stringify({ service, status: "ready", worker: { running: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function refused(): Error {
  return Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
}

async function listeningServer(): Promise<Server> {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

describe("Dashboard launcher", () => {
  it("recognizes an existing ST Workspace service", async () => {
    const result = await probeDashboardService(vi.fn(async () => healthResponse()) as unknown as typeof fetch);
    expect(result).toEqual({ status: "available" });
  });

  it("distinguishes an absent service from a foreign service", async () => {
    const absent = await probeDashboardService(vi.fn(async () => { throw refused(); }) as unknown as typeof fetch);
    const occupied = await probeDashboardService(vi.fn(async () => healthResponse("other-service")) as unknown as typeof fetch);
    expect(absent).toEqual({ status: "absent" });
    expect(occupied).toMatchObject({ status: "occupied", detail: "health response is not ST Workspace V3" });
  });

  it("reuses an existing service without starting or owning it", async () => {
    const startServer = vi.fn();
    const openBrowser = vi.fn(async () => undefined);
    const result = await launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse()) as unknown as typeof fetch,
      startServer,
      openBrowser,
      log: vi.fn(),
    });
    expect(result).toEqual({ ownership: "reused", url: DASHBOARD_URL });
    expect(startServer).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith(DASHBOARD_URL);
  });

  it("starts one owned server and waits until health is ready", async () => {
    const server = await listeningServer();
    let probes = 0;
    const openBrowser = vi.fn(async () => undefined);
    const result = await launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => {
        probes += 1;
        if (probes === 1) throw refused();
        return healthResponse();
      }) as unknown as typeof fetch,
      startServer: vi.fn(async () => server),
      openBrowser,
      wait: vi.fn(async () => undefined),
      log: vi.fn(),
    });
    expect(result).toMatchObject({ ownership: "started", url: DASHBOARD_URL, server });
    expect(openBrowser).toHaveBeenCalledOnce();
    await closeDashboardServer(server);
    expect(server.listening).toBe(false);
  });

  it("fails closed when 8787 belongs to another service", async () => {
    await expect(launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => healthResponse("foreign")) as unknown as typeof fetch,
      startServer: vi.fn(),
      openBrowser: vi.fn(async () => undefined),
      log: vi.fn(),
    })).rejects.toMatchObject<Partial<DashboardLauncherError>>({ code: "DASHBOARD_PORT_IN_USE" });
  });

  it("closes a newly started server after health timeout", async () => {
    const server = await listeningServer();
    await expect(launchDashboard("C:/workspace", {
      fetch: vi.fn(async () => { throw refused(); }) as unknown as typeof fetch,
      startServer: vi.fn(async () => server),
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
      openBrowser: vi.fn(async () => { throw new Error("no URL handler"); }),
      log: vi.fn(),
    });
    expect(result.ownership).toBe("reused");
    expect(result.browser_warning).toContain("DASHBOARD_BROWSER_OPEN_FAILED");
  });
});
