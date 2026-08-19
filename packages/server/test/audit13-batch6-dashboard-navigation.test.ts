import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { dashboard } from "../src/dashboard.js";
import {
  DASHBOARD_NAVIGATION_REGISTRY_JS,
  DASHBOARD_PANEL_REGISTRY,
} from "../src/dashboard-navigation-registry.js";
import { DASHBOARD_NAV_JS } from "../src/dashboard-nav.js";
import { DASHBOARD_PANELS_WORKFLOW_JS } from "../src/dashboard-panels-workflow.js";

class FakeClassList {
  private readonly values = new Set<string>();

  add(value: string): void { this.values.add(value); }
  remove(value: string): void { this.values.delete(value); }
  contains(value: string): boolean { return this.values.has(value); }
}

class FakeElement {
  id = "";
  hidden = false;
  textContent = "";
  className = "";
  type = "";
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, () => void>();
  readonly attributes = new Map<string, string>();
  readonly scrollCalls: Array<{ behavior?: string; block?: string }> = [];

  constructor(id = "") { this.id = id; }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  appendChild(child: FakeElement): void { this.children.push(child); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  scrollIntoView(options: { behavior?: string; block?: string }): void { this.scrollCalls.push(options); }
}

function createNavigationContext(reducedMotion: boolean) {
  const byId = new Map<string, FakeElement>();
  const panels: FakeElement[] = [];
  const home = new FakeElement("home-panel");
  home.setAttribute("aria-labelledby", "home-heading");
  panels.push(home);
  byId.set(home.id, home);
  for (const definition of DASHBOARD_PANEL_REGISTRY) {
    const panel = new FakeElement(definition.anchor);
    panel.setAttribute("aria-labelledby", definition.heading);
    panels.push(panel);
    byId.set(panel.id, panel);
  }
  const nav = new FakeElement("section-nav");
  const notice = new FakeElement("transient-notice");
  notice.hidden = true;
  byId.set(nav.id, nav);
  byId.set(notice.id, notice);

  const rafCalls: string[] = [];
  const document = {
    getElementById(id: string) { return byId.get(id) ?? null; },
    querySelectorAll(selector: string) {
      if (selector === "section.panel") return panels;
      if (selector === "[data-dashboard-object-id]") return [];
      return [];
    },
    createElement() { return new FakeElement(); },
  };
  const window = {
    location: { hash: "" },
    history: { pushState() { /* no-op */ } },
    matchMedia() { return { matches: reducedMotion }; },
    requestAnimationFrame(callback: () => void) { rafCalls.push("raf"); callback(); },
    addEventListener() { /* no-op */ },
  };
  const context = {
    document,
    window,
    state: { sessionUnselected: false },
    console,
  };
  runInNewContext(DASHBOARD_NAVIGATION_REGISTRY_JS, context);
  runInNewContext(DASHBOARD_NAV_JS, context);
  runInNewContext(DASHBOARD_PANELS_WORKFLOW_JS, context);
  return { context, byId, rafCalls, notice };
}

describe("Audit 13 Dashboard navigation contract", () => {
  it("renders one structurally balanced production document with every canonical panel anchor", () => {
    const html = dashboard();
    expect(html.match(/<!doctype html>/giu)).toHaveLength(1);
    const scriptStart = html.indexOf("<script>");
    expect(scriptStart).toBeGreaterThan(0);
    const domMarkup = html.slice(0, scriptStart);
    expect(domMarkup.match(/<details\b/gu)?.length ?? 0).toBe(domMarkup.match(/<\/details>/gu)?.length ?? 0);

    const ids = [...domMarkup.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const definition of DASHBOARD_PANEL_REGISTRY) {
      expect(domMarkup).toContain(`id="${definition.anchor}"`);
      expect(domMarkup).toContain(`aria-labelledby="${definition.heading}"`);
    }
    expect(new Set(DASHBOARD_PANEL_REGISTRY.map((item) => item.anchor)).size).toBe(DASHBOARD_PANEL_REGISTRY.length);
  });

  it("switches section before scrolling and preserves reduced-motion behavior", () => {
    const normal = createNavigationContext(false);
    expect(runInNewContext('switchPanel("artifact")', normal.context)).toBe(true);
    expect(runInNewContext("activeSection", normal.context)).toBe("create");
    expect(normal.byId.get("artifact-panel")?.hidden).toBe(false);
    expect(normal.byId.get("request-panel")?.hidden).toBe(true);
    expect(normal.rafCalls).toEqual(["raf"]);
    expect(normal.byId.get("artifact-panel")?.scrollCalls.at(-1)).toEqual({ behavior: "smooth", block: "start" });

    const reduced = createNavigationContext(true);
    expect(runInNewContext('switchPanel("coverage")', reduced.context)).toBe(true);
    expect(runInNewContext("activeSection", reduced.context)).toBe("research");
    expect(reduced.byId.get("coverage-panel")?.scrollCalls.at(-1)).toEqual({ behavior: "auto", block: "start" });
  });

  it("resolves workflow stages through typed registry targets instead of legacy REST-like strings", () => {
    const fixture = createNavigationContext(false);
    const result = runInNewContext(
      'navigateWorkflowTarget({ id: "publish", target: "publishes", affected_object_ids: ["publish-old"] })',
      fixture.context,
    );
    expect(result).toBe(true);
    expect(runInNewContext("activeSection", fixture.context)).toBe("publish");
    expect(fixture.byId.get("readiness-panel")?.scrollCalls).toHaveLength(1);
    expect(fixture.byId.has("publishes")).toBe(false);
  });

  it("falls back visibly for unknown or deleted object targets", () => {
    const fixture = createNavigationContext(false);
    expect(runInNewContext('navigateWorkflowTarget({ id: "unknown" })', fixture.context)).toBe(false);
    expect(fixture.notice.hidden).toBe(false);
    expect(fixture.notice.textContent).toContain("沒有可用的導覽目標");

    fixture.notice.hidden = true;
    fixture.notice.textContent = "";
    expect(runInNewContext(
      'navigateDashboardTarget({ type: "object", panel: "artifact", object_id: "deleted-artifact" })',
      fixture.context,
    )).toBe(true);
    expect(fixture.notice.hidden).toBe(false);
    expect(fixture.notice.textContent).toContain("已不存在或尚未載入");
    expect(fixture.byId.get("artifact-panel")?.scrollCalls.length).toBeGreaterThan(0);
  });
});
