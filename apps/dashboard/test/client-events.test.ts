// @vitest-environment jsdom

import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeEventSource {
  static instance: FakeEventSource | undefined;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, EventListener>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instance = this;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  FakeEventSource.instance = undefined;
  window.history.replaceState(null, "", "/");
});

describe("Dashboard API client", () => {
  it("exchanges a fragment token, clears it, and adds CSRF only to mutations", async () => {
    window.history.replaceState(null, "", "/#bootstrap=one-time-token");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { csrf_token: "csrf-token" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { saved: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch, bootstrapSession } = await import("../src/api/client");

    await bootstrapSession();
    expect(window.location.hash).toBe("");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/bootstrap");
    await expect(apiFetch<{ saved: boolean }>("/api/save", { method: "POST" })).resolves.toEqual({ saved: true });
    const headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(headers.get("x-csrf-token")).toBe("csrf-token");
  });

  it("resumes an existing session and surfaces stable API errors", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { authenticated: true, csrf_token: "resumed" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { code: "DASHBOARD_DENIED", message: "Denied" } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch, bootstrapSession } = await import("../src/api/client");

    await bootstrapSession();
    await expect(apiFetch("/api/denied")).rejects.toEqual(expect.objectContaining({ code: "DASHBOARD_DENIED", message: "Denied" }));
  });
});

describe("Dashboard events", () => {
  it("tracks connection state, invalidates project caches, and disconnects cleanly", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const states: string[] = [];
    const { connectDashboardEvents } = await import("../src/api/events");
    const disconnect = connectDashboardEvents(client, (state) => states.push(state));
    const source = FakeEventSource.instance;
    expect(source?.url).toBe("/api/events");

    source?.onopen?.();
    source?.onerror?.();
    source?.listeners.get("project.changed")?.(new MessageEvent("project.changed", { data: JSON.stringify({ project_id: "demo" }) }));
    expect(states).toEqual(["live", "retrying"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["project", "demo"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] });

    disconnect();
    expect(source?.listeners.size).toBe(0);
    expect(source?.closed).toBe(true);
  });
});
