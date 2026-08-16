import { afterAll, describe, expect, it, vi } from "vitest";
import { DASHBOARD_API_JS } from "../src/dashboard-api.js";
import { DASHBOARD_NAV_JS } from "../src/dashboard-nav.js";
import { DASHBOARD_PANELS_CORE_JS } from "../src/dashboard-panels-core.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";

function collectText(el: unknown): string {
  const e = el as { textContent?: string; children?: unknown[] };
  let text = e.textContent ?? "";
  for (const child of e.children ?? []) text += collectText(child);
  return text;
}

function makeElement(tagName: string, id?: string) {
  const listeners = new Map<string, Array<() => void>>();
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const children: unknown[] = [];
  return {
    tagName,
    id,
    children,
    listeners,
    attrs,
    classes,
    hidden: false,
    disabled: false,
    title: "",
    textContent: "",
    value: "",
    open: false,
    role: "",
    className: "",
    style: {} as Record<string, string>,
    parent: null as unknown | null,
    childNodes: children,
    get firstChild() {
      return children[0] ?? null;
    },
    removeChild: (child: unknown) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      (child as { parent?: unknown }).parent = null;
    },
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    getAttribute: (name: string) => (attrs.has(name) ? attrs.get(name) : null),
    removeAttribute: (name: string) => attrs.delete(name),
    addEventListener: (type: string, handler: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    appendChild: (child: unknown) => {
      (child as { parent?: unknown }).parent = this;
      children.push(child);
    },
    append: (child: unknown) => {
      (child as { parent?: unknown }).parent = this;
      children.push(child);
    },
    remove: () => {
      const parent = (this as unknown as { parent: { children: unknown[] } | null }).parent;
      if (parent !== null) {
        const idx = parent.children.indexOf(this);
        if (idx >= 0) parent.children.splice(idx, 1);
      }
    },
    click: () => {
      for (const handler of listeners.get("click") ?? []) handler();
    },
    scrollIntoView: vi.fn(),
    focus: vi.fn(),
    getElementsByTagName: function (name: string) {
      const out: unknown[] = [];
      const walk = (node: unknown) => {
        const el = node as { tagName?: string; children?: unknown[] };
        if (el.tagName === name) out.push(node);
        for (const child of el.children ?? []) walk(child);
      };
      walk(this);
      return out;
    },
    findByText: (text: string) => {
      const found: unknown[] = [];
      const walk = (node: unknown) => {
        const el = node as { textContent?: string; children?: unknown[] };
        if (el.textContent !== undefined && el.textContent.includes(text)) found.push(node);
        for (const child of el.children ?? []) walk(child);
      };
      walk(this);
      return found;
    },
  };
}

function makeDocument() {
  const elements = new Map<string, unknown>();
  const byTag: Record<string, unknown[]> = {};
  return {
    elements,
    createElement: (tagName: string, id?: string) => {
      const el = makeElement(tagName, id);
      if (id !== undefined) elements.set(id, el);
      const list = byTag[tagName] ?? [];
      list.push(el);
      byTag[tagName] = list;
      return el;
    },
    getElementById: (id: string) => (elements.has(id) ? elements.get(id) : null),
    querySelectorAll: (selector: string) => {
      const match = /^\[([a-z-]+)\]$/u.exec(selector);
      if (match !== null) {
        const attr = match[1]!;
        return Array.from(elements.values()).filter((el) => {
          const e = el as { getAttribute?: (name: string) => string | null };
          return typeof e.getAttribute === "function" && e.getAttribute(attr) !== null;
        });
      }
      if (selector === "section.panel") {
        return Object.values(byTag).flat().filter((el) => {
          const e = el as { className?: string };
          return e.className !== undefined && e.className.includes("panel");
        });
      }
      return [];
    },
    createTextNode: () => ({ nodeType: 3, textContent: "" }),
    body: makeElement("body", "body"),
  };
}

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const asyncMarker = `async function ${name}(`;
    const marker = `function ${name}(`;
    const asyncStart = source.indexOf(asyncMarker);
    let start = asyncStart >= 0 ? source.indexOf(marker, asyncStart) : source.indexOf(marker);
    if (start < 0) continue;
    const bodyStart = asyncStart >= 0 ? start - 6 : start;
    let depth = 0;
    let inBody = false;
    let end = -1;
    for (let i = start + marker.length; i < source.length; i++) {
      const ch = source[i];
      if (!inBody) {
        if (ch === "{") {
          inBody = true;
          depth = 1;
        }
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > 0) out.set(name, source.slice(bodyStart, end));
  }
  return out;
}

function execute(functions: Map<string, string>, names: string[], context: Record<string, unknown>) {
  const keys = Object.keys(context);
  const args = keys.map((key) => context[key]);
  const body = names.map((name) => functions.get(name) ?? "").join("\n");
  const factory = new Function(...keys, `${body}\nreturn { ${names.join(", ")} };`);
  return factory(...args) as Record<string, () => unknown>;
}

const server = describe("Audit 8 Batch 5 - Dashboard error boundary & task navigation", () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("#107 structured error through the request boundary", () => {
    it("preserves details, impact, next_actions and operation_id on apiError", async () => {
      const body = {
        code: "PROVENANCE_CONFIRMATION_STALE",
        message: "composition changed",
        impact: "the confirmed output no longer matches",
        next_actions: ["重新準備發布確認"],
        operation_id: "op-confirm-1",
        details: {
          changed_inputs: [
            { label: "封面圖片", category: "image", before_summary: "img-a", after_summary: "img-b", target_panel: "artifacts" },
          ],
        },
      };
      const fetchStub = vi.fn(async () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        text: async () => JSON.stringify(body),
      }));
      const functions = extractFunctions(DASHBOARD_API_JS, ["requestJson"]);
      const api = execute(functions, ["requestJson"], {
        fetch: fetchStub,
        dashboardAuthToken: null, firstString: (obj, keys) => { for (const k of keys) { const v = obj?.[k]; if (typeof v === "string" && v.length > 0) return v; } return ""; },
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        apiError: undefined,
      });
      let caught: unknown = null;
      try {
        await (api.requestJson as (path: string, options?: unknown) => Promise<unknown>)("/workspace/dashboard/data", {});
      } catch (error) {
        caught = error;
      }
      expect(caught).not.toBeNull();
      const err = caught as { code?: string; details?: { changed_inputs?: unknown[] }; impact?: string; next_actions?: string[]; operation_id?: string; payload?: Record<string, unknown> };
      expect(err.code).toBe("PROVENANCE_CONFIRMATION_STALE");
      expect(Array.isArray(err.details?.changed_inputs)).toBe(true);
      expect(err.details?.changed_inputs?.length).toBe(1);
      expect(err.impact).toBe(body.impact);
      expect(err.next_actions).toEqual(body.next_actions);
      expect(err.operation_id).toBe("op-confirm-1");
      expect(err.payload?.details).toEqual(body.details);
    });

    it("falls back safely for unknown payload shapes", async () => {
      const fetchStub = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => JSON.stringify({ weird: true }),
      }));
      const functions = extractFunctions(DASHBOARD_API_JS, ["requestJson"]);
      const api = execute(functions, ["requestJson"], {
        fetch: fetchStub,
        dashboardAuthToken: null, firstString: (obj, keys) => { for (const k of keys) { const v = obj?.[k]; if (typeof v === "string" && v.length > 0) return v; } return ""; },
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
      });
      let caught: unknown = null;
      try {
        await (api.requestJson as (path: string, options?: unknown) => Promise<unknown>)("/workspace/dashboard/data", {});
      } catch (error) {
        caught = error;
      }
      const err = caught as { code?: string; details?: unknown; impact?: unknown; next_actions?: unknown };
      expect(err.code).toBe("HTTP_ERROR");
      expect(err.details).toBeUndefined();
      expect(err.impact).toBeUndefined();
      expect(err.next_actions).toBeUndefined();
    });

    it("renders stale diff rows and navigates to the exact diagnostic target", () => {
      const document = makeDocument();
      const staleDiff = document.createElement("div", "provenance-stale-diff");
      const navigateTarget = vi.fn();
      const switchPanel = vi.fn();
      const functions = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["renderStaleDiff"]);
      const ctx = execute(functions, ["renderStaleDiff"], {
        document,
        byId: (id: string) => document.getElementById(id),
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        navigateDiagnosticTarget: navigateTarget,
        switchPanel,
        firstString: (obj: unknown, keys: string[]) => {
          const record = obj as Record<string, unknown>;
          for (const key of keys) {
            if (record !== undefined && typeof record[key] === "string") return record[key];
          }
          return "";
        },
      });
      const items = [
        {
          label: "封面圖片",
          category: "image",
          before_summary: "img-a",
          after_summary: "img-b",
          target_panel: "artifacts",
          target_id: "character-alpha",
          target: { panel: "artifacts", id: "character-alpha" },
        },
      ];
      (ctx.renderStaleDiff as (items: unknown[]) => void)(items);
      expect(staleDiff.hidden).toBe(false);
      expect(staleDiff.children.length).toBeGreaterThan(0);
      const buttons = (staleDiff as unknown as { getElementsByTagName: (name: string) => unknown[] }).getElementsByTagName("button");
      expect(buttons.length).toBe(1);
      (buttons[0] as { click: () => void }).click();
      expect(navigateTarget).toHaveBeenCalledWith({ panel: "artifacts", id: "character-alpha" });
      expect(switchPanel).not.toHaveBeenCalled();
    });

    it("clears the stale diff for empty input", () => {
      const document = makeDocument();
      const staleDiff = document.createElement("div", "provenance-stale-diff");
      const functions = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["renderStaleDiff"]);
      const ctx = execute(functions, ["renderStaleDiff"], {
        document,
        byId: (id: string) => document.getElementById(id),
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        navigateDiagnosticTarget: vi.fn(),
        switchPanel: vi.fn(),
        firstString: (obj: unknown, keys: string[]) => {
          const record = obj as Record<string, unknown>;
          for (const key of keys) {
            if (record !== undefined && typeof record[key] === "string") return record[key];
          }
          return "";
        },
      });
      (ctx.renderStaleDiff as (items: unknown[]) => void)([]);
      expect(staleDiff.style.display).toBe("none");
    });
  });

  describe("#113 section navigation", () => {
    it("switches section visibility and updates the hash", () => {
      const document = makeDocument();
      const panels = ["project", "status", "request", "interview", "precheck", "source-fact", "artifact"];
      for (const key of panels) {
        const el = document.createElement("section");
        el.className = "panel";
        if (key === "project") el.id = "project-panel";
        else el.setAttribute("aria-labelledby", `${key}-heading`);
        document.elements.set(`${key}-panel`, el);
      }
      const nav = document.createElement("nav", "section-nav");
      const location = { hash: "", assign: vi.fn(), replace: vi.fn() };
      const history = { pushState: vi.fn(), replaceState: vi.fn() };
      const windowStub = { location: { hash: "" }, addEventListener: vi.fn(), history };
      const functions = extractFunctions(DASHBOARD_NAV_JS, ["switchSection", "applySectionVisibility", "parseSectionHash", "sectionOfPanel", "sectionLabel", "syncSectionForPanel", "updateSectionNav"]);
      const ctx = execute(functions, ["switchSection", "applySectionVisibility", "parseSectionHash", "sectionOfPanel", "sectionLabel", "syncSectionForPanel", "updateSectionNav"], {
        document,
        byId: (id: string) => document.getElementById(id),
        location,
        history,
        window: windowStub,
        addEventListener: vi.fn(),
        activeSection: "",
        sectionHistoryGuard: false,
        DASHBOARD_SECTIONS: [
          { id: "overview", label: "總覽" },
          { id: "define", label: "定義" },
          { id: "research", label: "研究與證據" },
          { id: "create", label: "創作與審查" },
          { id: "publish", label: "發布" },
          { id: "operations", label: "作業與修復" },
        ],
        SECTION_PANEL_MAP: {
          project: "overview",
          status: "overview",
          request: "define",
          interview: "define",
          precheck: "define",
          "source-fact": "research",
          artifact: "create",
        },
      });
      const parse = ctx.parseSectionHash as () => string | null;
      windowStub.location.hash = "#section:define";
      expect(parse()).toBe("define");
      windowStub.location.hash = "#section:bogus";
      expect(parse()).toBeUndefined();
      windowStub.location.hash = "";
      expect(parse()).toBeUndefined();
      (ctx.switchSection as (section: string) => void)("define");
      expect(history.pushState).toHaveBeenCalled();
      const requestPanel = document.getElementById("request-panel") as { hidden: boolean };
      const projectPanel = document.getElementById("project-panel") as { hidden: boolean };
      const artifactPanel = document.getElementById("artifact-panel") as { hidden: boolean };
      expect(requestPanel.hidden).toBe(false);
      expect(projectPanel.hidden).toBe(true);
      expect(artifactPanel.hidden).toBe(true);
    });
  });

  describe("#122 recovery cards", () => {
    it("renders cause, impact, correlation, actions and dismiss", () => {
      const document = makeDocument();
      const container = document.createElement("div", "latest-recovery");
      const projectSelect = document.createElement("select", "project-select");
      projectSelect.value = "batch8-nav";
      const session = new Map<string, string>();
      const sessionStorageStub = {
        getItem: (key: string) => (session.has(key) ? session.get(key) : null),
        setItem: (key: string, value: string) => session.set(key, value),
        removeItem: (key: string) => session.delete(key),
      };
      const functions = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["renderRecoveryCards", "recoveryErrorInfo", "recoveryCardDismissed", "recoveryCardDismiss"]);
      const ctx = execute(functions, ["renderRecoveryCards", "recoveryErrorInfo", "recoveryCardDismissed", "recoveryCardDismiss"], {
        document,
        byId: (id: string) => document.getElementById(id),
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        sessionStorage: sessionStorageStub,
        window: { sessionStorage: sessionStorageStub },
        jsonText: (v: unknown) => JSON.stringify(v),
        errorSnapshot: (error: unknown) => error,
        refresh: vi.fn(),
        setNotice: vi.fn(),
        setBusy: vi.fn(),
        firstString: (obj: unknown, keys: string[]) => {
          const record = obj as Record<string, unknown>;
          for (const key of keys) {
            if (record !== undefined && typeof record[key] === "string") return record[key];
          }
          return "";
        },
      });
      const error = {
        code: "PROVENANCE_CONFIRMATION_STALE",
        status: 409,
        message: "composition changed",
        details: { changed_inputs: [{ label: "封面圖片", category: "image", before_summary: "a", after_summary: "b" }] },
        impact: "confirmed output no longer matches",
        next_actions: ["重新準備發布確認"],
        operation_id: "op-confirm-9",
      };
      (ctx.renderRecoveryCards as (container: unknown, error: unknown, context: unknown) => void)(container, error, {
        projectId: "batch8-nav",
        onRetry: vi.fn(),
      });
      expect(container.children.length).toBe(1);
      const card = container.children[0] as { children: unknown[] };
      const cardText = collectText(card);
      expect(cardText).toContain("復原建議");
      expect(cardText).toContain("composition changed");
      expect(cardText).toContain("confirmed output no longer matches");
      expect(cardText).toContain("op-confirm-9");
      const buttons = (card as unknown as { getElementsByTagName: (name: string) => unknown[] }).getElementsByTagName("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it("skips rendering for dismissed codes", () => {
      const document = makeDocument();
      const container = document.createElement("div", "latest-recovery");
      const projectSelect = document.createElement("select", "project-select");
      projectSelect.value = "batch8-nav";
      const session = new Map<string, string>();
      session.set("recovery-dismissed:v1:batch8-nav", JSON.stringify(["PROVENANCE_CONFIRMATION_STALE"]));
      const sessionStorageStub = {
        getItem: (key: string) => (session.has(key) ? session.get(key) : null),
        setItem: (key: string, value: string) => session.set(key, value),
        removeItem: (key: string) => session.delete(key),
      };
      const functions = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["renderRecoveryCards", "recoveryErrorInfo", "recoveryCardDismissed", "recoveryCardDismiss"]);
      const ctx = execute(functions, ["renderRecoveryCards", "recoveryErrorInfo", "recoveryCardDismissed", "recoveryCardDismiss"], {
        document,
        byId: (id: string) => document.getElementById(id),
        isRecord: (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v),
        sessionStorage: sessionStorageStub,
        window: { sessionStorage: sessionStorageStub },
        jsonText: (v: unknown) => JSON.stringify(v),
        errorSnapshot: (error: unknown) => error,
        refresh: vi.fn(),
        setNotice: vi.fn(),
        setBusy: vi.fn(),
        firstString: (obj: unknown, keys: string[]) => {
          const record = obj as Record<string, unknown>;
          for (const key of keys) {
            if (record !== undefined && typeof record[key] === "string") return record[key];
          }
          return "";
        },
      });
      (ctx.renderRecoveryCards as (container: unknown, error: unknown, context: unknown) => void)(container, {
        code: "PROVENANCE_CONFIRMATION_STALE",
        message: "x",
      }, { projectId: "batch8-nav", onRetry: vi.fn() });
      expect(container.children.length).toBe(0);
    });
  });
});

export { server };
