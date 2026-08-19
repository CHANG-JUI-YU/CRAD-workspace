import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_NAV_JS } from "../src/dashboard-nav.js";
import { resolveWorkspaceServerEndpoint, startWorkspaceServer, workspaceServerStartupMessage } from "../src/index.js";

interface PanelStub {
  id: string;
  className: string;
  hidden: boolean;
  scrollIntoView: ReturnType<typeof vi.fn>;
  getAttribute: (name: string) => string | null;
}

function panel(id: string): PanelStub {
  return {
    id,
    className: "panel",
    hidden: false,
    scrollIntoView: vi.fn(),
    getAttribute: () => null,
  };
}

function dashboardNavigationHarness() {
  const overview = panel("project-panel");
  const target = panel("request-panel");
  const elements = new Map<string, unknown>([
    [overview.id, overview],
    [target.id, target],
  ]);
  const frames: Array<() => void> = [];
  const history = { pushState: vi.fn() };
  let reduceMotion = false;
  const documentStub = {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: (selector: string) => selector === "section.panel" ? [overview, target] : [],
  };
  const windowStub = {
    location: { hash: "" },
    history,
    addEventListener: vi.fn(),
    requestAnimationFrame: vi.fn((callback: () => void) => {
      frames.push(callback);
      return frames.length;
    }),
    matchMedia: vi.fn(() => ({ matches: reduceMotion })),
  };
  const factory = new Function("document", "window", "state", `${DASHBOARD_NAV_JS}\nreturn { switchPanel, switchSection };`);
  const api = factory(documentStub, windowStub, { sessionUnselected: false }) as {
    switchPanel: (panelName: string) => void;
    switchSection: (sectionName: string, options?: Record<string, unknown>) => void;
  };
  api.switchSection("overview", { force: true, pushHistory: false });
  return {
    api,
    overview,
    target,
    frames,
    history,
    setReducedMotion: (value: boolean) => { reduceMotion = value; },
  };
}

function serverWithAddress(address: AddressInfo | string | null): Pick<Server, "address"> {
  return { address: () => address } as Pick<Server, "address">;
}

describe("Audit 12 Batch 7 - UX12-01 and UX12-02", () => {
  it("#190 makes a hidden cross-section panel visible before scrolling without adding history", () => {
    const harness = dashboardNavigationHarness();
    expect(harness.target.hidden).toBe(true);

    harness.api.switchPanel("request");

    expect(harness.target.hidden).toBe(false);
    expect(harness.overview.hidden).toBe(true);
    expect(harness.history.pushState).not.toHaveBeenCalled();
    expect(harness.target.scrollIntoView).not.toHaveBeenCalled();
    expect(harness.frames).toHaveLength(1);

    harness.frames[0]!();
    expect(harness.target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    harness.setReducedMotion(true);
    harness.api.switchPanel("request");
    expect(harness.frames).toHaveLength(1);
    expect(harness.target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
  });

  it("#191 formats loopback, IPv6 and wildcard bound endpoints truthfully", () => {
    const ipv4 = serverWithAddress({ address: "127.0.0.1", family: "IPv4", port: 8787 });
    expect(resolveWorkspaceServerEndpoint(ipv4)).toEqual({ kind: "url", value: "http://127.0.0.1:8787" });
    expect(workspaceServerStartupMessage(ipv4)).toBe("ST Workspace server listening on http://127.0.0.1:8787");

    const localhost = serverWithAddress({ address: "localhost", family: "IPv4", port: 9191 });
    expect(resolveWorkspaceServerEndpoint(localhost)).toEqual({ kind: "url", value: "http://localhost:9191" });

    const ipv6 = serverWithAddress({ address: "::1", family: "IPv6", port: 4321 });
    expect(resolveWorkspaceServerEndpoint(ipv6)).toEqual({ kind: "url", value: "http://[::1]:4321" });

    const wildcard = serverWithAddress({ address: "0.0.0.0", family: "IPv4", port: 9000 });
    expect(resolveWorkspaceServerEndpoint(wildcard)).toEqual({ kind: "bind", value: "0.0.0.0:9000" });
    expect(workspaceServerStartupMessage(wildcard)).toBe("ST Workspace server bound to 0.0.0.0:9000");
  });

  it("#191 reports the actual OS-assigned port when startup requests port zero", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-audit12-endpoint-"));
    const server = await startWorkspaceServer({
      port: 0,
      host: "127.0.0.1",
      projectRoot: root,
      projectId: "endpoint-test",
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("server did not bind to a TCP address");
      expect(address.port).toBeGreaterThan(0);
      expect(workspaceServerStartupMessage(server)).toBe(`ST Workspace server listening on http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      await rm(root, { recursive: true, force: true });
    }
  });
});
