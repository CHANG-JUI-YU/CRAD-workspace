import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_API_JS } from "../src/dashboard-api.js";
import { DASHBOARD_CSS } from "../src/dashboard-css.js";
import { DASHBOARD_DRAFT_STORE_JS } from "../src/dashboard-draft-store.js";
import { DASHBOARD_NAV_JS } from "../src/dashboard-nav.js";
import { DASHBOARD_PANELS_COLLECTIONS_JS } from "../src/dashboard-panels-collections.js";
import { DASHBOARD_PANELS_CORE_JS } from "../src/dashboard-panels-core.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";
import { DASHBOARD_STATE_JS } from "../src/dashboard-state.js";

type MockElement = {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  disabled: boolean;
  hidden: boolean;
  title: string;
  open: boolean;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange?: (start: number, end: number) => void;
  focus?: () => void;
  onclick?: ((event?: unknown) => void) | null;
  children: MockElement[];
  childNodes: MockElement[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<(event?: unknown) => void>>;
  style: Record<string, string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    contains: (c: string) => boolean;
  };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, handler: (event?: unknown) => void) => void;
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  scrollIntoView?: (options?: unknown) => void;
  querySelector?: (selector: string) => MockElement | null;
  querySelectorAll?: (selector: string) => MockElement[];
};

function createMockElement(tagName: string, id = ""): MockElement {
  const listeners = new Map<string, Array<(event?: unknown) => void>>();
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const children: MockElement[] = [];

  const element: MockElement = {
    tagName: tagName.toUpperCase(),
    id,
    get className() {
      return Array.from(classes).join(" ");
    },
    set className(val: string) {
      classes.clear();
      for (const part of (val || "").split(/\s+/)) {
        if (part) classes.add(part);
      }
    },
    textContent: "",
    disabled: false,
    hidden: false,
    title: "",
    open: false,
    value: "",
    selectionStart: null,
    selectionEnd: null,
    onclick: null,
    children,
    childNodes: children,
    attrs,
    listeners,
    style: {},
    classList: {
      add: (name: string) => {
        classes.add(name);
      },
      remove: (name: string) => {
        classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
      if (name === "id") element.id = value;
      if (name === "class") {
        classes.clear();
        for (const part of value.split(/\s+/)) {
          if (part) classes.add(part);
        }
      }
      if (name === "disabled") element.disabled = true;
    },
    getAttribute: (name: string) => (attrs.has(name) ? attrs.get(name)! : null),
    removeAttribute: (name: string) => {
      attrs.delete(name);
      if (name === "disabled") element.disabled = false;
    },
    addEventListener: (type: string, handler: (event?: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    appendChild: (child: MockElement) => {
      children.push(child);
      return child;
    },
    append: (...nodes: MockElement[]) => {
      for (const n of nodes) {
        children.push(n);
      }
    },
    removeChild: (child: MockElement) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      return child;
    },
    setSelectionRange: (start: number, end: number) => {
      element.selectionStart = start;
      element.selectionEnd = end;
    },
    focus: vi.fn(),
    querySelector: (selector: string) => {
      if (selector.startsWith("#")) {
        const targetId = selector.slice(1);
        const findId = (node: MockElement): MockElement | null => {
          if (node.id === targetId) return node;
          for (const c of node.children) {
            const found = findId(c);
            if (found) return found;
          }
          return null;
        };
        return findId(element);
      }
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        const findClass = (node: MockElement): MockElement | null => {
          if (node.classList.contains(cls)) return node;
          for (const c of node.children) {
            const found = findClass(c);
            if (found) return found;
          }
          return null;
        };
        return findClass(element);
      }
      if (selector.includes("[data-operation-id=")) {
        const match = /data-operation-id="([^"]+)"/.exec(selector);
        const targetOp = match ? match[1] : "";
        const findOp = (node: MockElement): MockElement | null => {
          if (node.getAttribute("data-operation-id") === targetOp) return node;
          for (const c of node.children) {
            const found = findOp(c);
            if (found) return found;
          }
          return null;
        };
        return findOp(element);
      }
      return null;
    },
    querySelectorAll: (selector: string) => {
      const results: MockElement[] = [];
      const walk = (node: MockElement) => {
        if (selector === "input.operation-answer-input") {
          if (node.tagName === "INPUT" && node.classList.contains("operation-answer-input")) {
            results.push(node);
          }
        } else if (selector.startsWith(".")) {
          if (node.classList.contains(selector.slice(1))) results.push(node);
        } else if (selector.startsWith("[")) {
          const attr = selector.slice(1, -1).split("=")[0];
          if (node.attrs.has(attr)) results.push(node);
        }
        for (const c of node.children) walk(c);
      };
      for (const c of element.children) walk(c);
      return results;
    },
    scrollIntoView: vi.fn(),
  };

  return element;
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
  return factory(...args) as Record<string, any>;
}

describe("Audit 9 Batch 4: Dashboard State Consistency & Hardening", () => {
  describe("Issue #126: Project switching state consistency and stale response prevention", () => {
    it("resets all project-scoped state immediately when switching project context", async () => {
      const elementsById = new Map<string, MockElement>();
      const register = (el: MockElement) => {
        elementsById.set(el.id, el);
        return el;
      };

      const docMock = {
        getElementById: (id: string) => elementsById.get(id) ?? null,
        querySelectorAll: () => [],
      };

      const precheckMatrix = register(createMockElement("div", "precheck-matrix"));
      precheckMatrix.textContent = "Old Project Prechecks";
      const provSummary = register(createMockElement("div", "provenance-summary"));
      provSummary.textContent = "Old Project Summary";
      const opList = register(createMockElement("div", "operation-list"));
      opList.textContent = "Old Project Operations";

      const coreFns = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["resetProjectScopedState"]);
      const stateObj = {
        status: { project_id: "proj-A" },
        interviewQuestion: { id: "q1" },
        currentProjectValue: "proj-A",
        projectGeneration: 1,
        interviewRevision: 2,
        amendQuestionId: "q1",
        amendPreview: "preview",
        amendInFlight: true,
      };

      const currentProvenanceConfirmation = { fingerprint: "fp-A", republish: false, in_flight: false, completed: true };
      const publishStepperState = { stage: "published", status: "pass", readinessOk: true, previewData: null, staleDiff: null };

      const core = execute(coreFns, ["resetProjectScopedState"], {
        state: stateObj,
        byId: (id: string) => docMock.getElementById(id),
        currentProvenanceConfirmation,
        publishStepperState,
        updatePublishStepper: vi.fn(),
      });

      core.resetProjectScopedState();

      expect(stateObj.status).toBeNull();
      expect(stateObj.interviewQuestion).toBeNull();
      expect(stateObj.interviewRevision).toBe(0);
      expect(stateObj.amendQuestionId).toBeNull();
      expect(stateObj.amendInFlight).toBe(false);
      expect(precheckMatrix.textContent).toBe("");
      expect(provSummary.textContent).toBe("");
      expect(opList.textContent).toBe("");
    });

    it("discards stale in-flight response when project is switched before response resolves", async () => {
      let renderStatusCalls: any[] = [];
      const stateObj = {
        projectGeneration: 1,
        status: null,
      };

      let delayedResolve: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        delayedResolve = resolve;
      });

      const apiFns = extractFunctions(DASHBOARD_API_JS, ["loadStatus"]);
      const api = execute(apiFns, ["loadStatus"], {
        state: stateObj,
        requestJson: vi.fn(() => delayedPromise),
        renderStatus: (p: any) => { renderStatusCalls.push(p); },
        setAreaError: vi.fn(),
      });

      // Project A starts loading status at generation 1
      const loadPromise = api.loadStatus();

      // Project is switched to B, incrementing generation to 2
      stateObj.projectGeneration = 2;

      // Project A delayed response arrives
      delayedResolve!({ project_id: "proj-A", summary: "Project A data" });
      await loadPromise;

      // Stale response from Project A must not be rendered into UI!
      expect(renderStatusCalls.length).toBe(0);
    });
  });

  describe("Issue #123: Dashboard section navigation and active section preservation", () => {
    it("CSS includes explicit grid-column placement for .section-nav", () => {
      expect(DASHBOARD_CSS).toContain("grid-column: 1 / -1;");
      expect(DASHBOARD_CSS).toContain(".section-nav");
    });

    it("initializes section navigation and handles invalid section fallbacks", () => {
      const buttons: MockElement[] = [];
      const panels: MockElement[] = [
        createMockElement("section", "project-panel"),
        createMockElement("section", "request-panel"),
        createMockElement("section", "readiness-panel"),
      ];
      panels[0].setAttribute("id", "project-panel");
      panels[1].setAttribute("id", "request-panel");
      panels[2].setAttribute("id", "readiness-panel");

      const navContainer = createMockElement("nav", "section-nav");

      const docMock = {
        getElementById: (id: string) => {
          if (id === "section-nav") return navContainer;
          if (id.startsWith("section-nav-")) {
            return buttons.find((b) => b.id === id) ?? null;
          }
          return panels.find((p) => p.id === id) ?? null;
        },
        querySelectorAll: (sel: string) => {
          if (sel === "section.panel") return panels;
          return [];
        },
        createElement: (tag: string) => {
          const el = createMockElement(tag);
          buttons.push(el);
          return el;
        },
      };

      const code = [
        DASHBOARD_NAV_JS,
        "return { updateSectionNav, switchSection, applySectionVisibility, getActiveSection: () => activeSection };",
      ].join("\n");

      const fn = new Function("document", "window", code);
      const nav = fn(docMock, {
        location: { hash: "" },
        history: { pushState: vi.fn() },
        addEventListener: vi.fn(),
      });

      nav.updateSectionNav();

      // Buttons for 6 sections created
      expect(navContainer.children.length).toBe(6);
      expect(nav.getActiveSection()).toBe("overview");

      // Switch to define section
      nav.switchSection("define");
      expect(nav.getActiveSection()).toBe("define");
      expect(panels[0].hidden).toBe(true); // project-panel in overview
      expect(panels[1].hidden).toBe(false); // request-panel in define
      expect(panels[2].hidden).toBe(true); // readiness-panel in publish

      // Fallback for invalid section
      nav.switchSection("non_existent_section");
      expect(nav.getActiveSection()).toBe("overview");
      expect(panels[0].hidden).toBe(false); // project-panel visible in overview
    });
  });

  describe("Issue #134: Preserve operation answers across polling refreshes", () => {
    it("preserves unsent answers and input focus when polling re-renders the operation list", () => {
      const listContainer = createMockElement("div", "operation-list");
      const msgContainer = createMockElement("div", "operation-message");
      const filterEl = createMockElement("select", "operation-filter");
      filterEl.value = "all";

      const docMock = {
        getElementById: (id: string) => {
          if (id === "operation-list") return listContainer;
          if (id === "operation-message") return msgContainer;
          if (id === "operation-filter") return filterEl;
          return null;
        },
        createElement: (tag: string) => createMockElement(tag),
        activeElement: null as MockElement | null,
      };

      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, [
        "renderOperationList",
        "operationMatchesFilter",
        "statusClass",
        "firstString",
        "isRecord",
        "confirmCancel",
        "answerNeedsInput",
        "retryOperation",
      ]);

      const publish = execute(publishFns, ["renderOperationList", "operationMatchesFilter"], {
        document: docMock,
        byId: (id: string) => docMock.getElementById(id),
        operationDraftAnswers: {},
        OPERATION_FILTERS: { all: "" },
        statusClass: (s: string) => s,
        firstString: (obj: any, keys: string[]) => {
          for (const k of keys) {
            if (obj && typeof obj[k] === "string" && obj[k]) return obj[k];
          }
          return "";
        },
        isRecord: (v: unknown) => typeof v === "object" && v !== null,
        confirmCancel: vi.fn(),
        answerNeedsInput: vi.fn(),
        retryOperation: vi.fn(),
        openReuploadModal: vi.fn(),
      });

      const initialOperations = [
        {
          id: "op-1",
          status: "needs_input",
          kind: "interview",
          question: "請提供設定名稱",
        },
      ];

      // Initial render
      publish.renderOperationList(initialOperations);
      expect(listContainer.children.length).toBe(1);

      // User types into the input field
      const inputEl = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-1"]')!;
      expect(inputEl).toBeDefined();
      inputEl.value = "這是我尚未送出的世界觀答案";
      const inputHandler = inputEl.listeners.get("input")![0];
      inputHandler();

      // Simulate input focus
      docMock.activeElement = inputEl;

      // Background polling arrives with updated operation list (e.g. attempt count updated)
      const updatedOperations = [
        {
          id: "op-1",
          status: "needs_input",
          kind: "interview",
          question: "請提供設定名稱",
          attempt: 2,
        },
      ];

      publish.renderOperationList(updatedOperations);

      // Verify the unsent answer was not wiped out by background polling!
      const reRenderedInput = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-1"]')!;
      expect(reRenderedInput).toBeDefined();
      expect(reRenderedInput.value).toBe("這是我尚未送出的世界觀答案");
    });

    it("handles multiple operations with reordering, submission cleanup and completion cleanup", () => {
      const listContainer = createMockElement("div", "operation-list");
      const msgContainer = createMockElement("div", "operation-message");
      const filterEl = createMockElement("select", "operation-filter");
      filterEl.value = "all";

      const docMock = {
        getElementById: (id: string) => {
          if (id === "operation-list") return listContainer;
          if (id === "operation-message") return msgContainer;
          if (id === "operation-filter") return filterEl;
          return null;
        },
        createElement: (tag: string) => createMockElement(tag),
        activeElement: null as MockElement | null,
      };

      const operationDraftMap: Record<string, string> = {};

      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, [
        "renderOperationList",
        "operationMatchesFilter",
        "statusClass",
        "firstString",
        "isRecord",
        "confirmCancel",
        "answerNeedsInput",
        "retryOperation",
      ]);

      const publish = execute(publishFns, ["renderOperationList", "operationMatchesFilter"], {
        document: docMock,
        byId: (id: string) => docMock.getElementById(id),
        operationDraftAnswers: operationDraftMap,
        OPERATION_FILTERS: { all: "" },
        statusClass: (s: string) => s,
        firstString: (obj: any, keys: string[]) => {
          for (const k of keys) {
            if (obj && typeof obj[k] === "string" && obj[k]) return obj[k];
          }
          return "";
        },
        isRecord: (v: unknown) => typeof v === "object" && v !== null,
        confirmCancel: vi.fn(),
        answerNeedsInput: vi.fn(),
        retryOperation: vi.fn(),
        openReuploadModal: vi.fn(),
      });

      // 1. Initial render with op-1 and op-2
      publish.renderOperationList([
        { id: "op-1", status: "needs_input", question: "問題 1" },
        { id: "op-2", status: "needs_input", question: "問題 2" },
      ]);

      const op1Input = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-1"]')!;
      const op2Input = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-2"]')!;

      op1Input.value = "答案 1";
      op1Input.listeners.get("input")![0]();

      op2Input.value = "答案 2";
      op2Input.listeners.get("input")![0]();

      // 2. Background polling arrives with op-2 reordered before op-1, and a new completed op-3 added
      publish.renderOperationList([
        { id: "op-2", status: "needs_input", question: "問題 2" },
        { id: "op-3", status: "completed", question: "已完成" },
        { id: "op-1", status: "needs_input", question: "問題 1" },
      ]);

      const reOp1Input = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-1"]')!;
      const reOp2Input = listContainer.querySelector('input.operation-answer-input[data-operation-id="op-2"]')!;

      // Answers stay bound to their respective operations despite reordering!
      expect(reOp1Input.value).toBe("答案 1");
      expect(reOp2Input.value).toBe("答案 2");

      // 3. op-1 completes on server (status changes to completed), op-2 remains needs_input
      publish.renderOperationList([
        { id: "op-1", status: "completed", question: "問題 1" },
        { id: "op-2", status: "needs_input", question: "問題 2" },
      ]);

      // op-1 draft is automatically cleaned up; op-2 draft preserved
      expect(operationDraftMap["op-1"]).toBeUndefined();
      expect(operationDraftMap["op-2"]).toBe("答案 2");
    });
  });

  describe("Issue #133: Prevent duplicate collection load-more listeners across renders", () => {
    it("binds click listener idempotently so repeated renders do not duplicate requests", async () => {
      const moreBtn = createMockElement("button", "load-more-btn");
      const countEl = createMockElement("span", "count-span");

      const docMock = {
        getElementById: (id: string) => {
          if (id === "load-more-btn") return moreBtn;
          if (id === "count-span") return countEl;
          return null;
        },
      };

      const collFns = extractFunctions(DASHBOARD_PANELS_COLLECTIONS_JS, [
        "collectionController",
        "collectionMoreButton",
        "collectionFetch",
        "collectionCountText",
      ]);

      let fetchCount = 0;
      const requestJsonMock = vi.fn(async () => {
        fetchCount += 1;
        return { items: [{ id: "item-1" }], total: 10, next_cursor: "cursor-2" };
      });

      const coll = execute(collFns, ["collectionController", "collectionMoreButton", "collectionFetch"], {
        byId: (id: string) => docMock.getElementById(id),
        requestJson: requestJsonMock,
        collectionCountText: () => "1 / 10",
      });

      const controller = coll.collectionController();
      controller.total = 10;
      controller.end = false;

      // Render 5 times in succession
      for (let i = 0; i < 5; i++) {
        coll.collectionMoreButton(controller, "/workspace/items", vi.fn(), "load-more-btn", "count-span");
      }

      // User clicks "Load More" ONCE
      expect(moreBtn.onclick).toBeDefined();
      await moreBtn.onclick!();

      // Exactly ONE request must be triggered
      expect(fetchCount).toBe(1);
    });

    it("prevents concurrent fetch while loading is true", async () => {
      const collFns = extractFunctions(DASHBOARD_PANELS_COLLECTIONS_JS, ["collectionController", "collectionFetch"]);

      let fetchCount = 0;
      const requestJsonMock = vi.fn(async () => {
        fetchCount += 1;
        return { items: [], total: 0 };
      });

      const coll = execute(collFns, ["collectionController", "collectionFetch"], {
        requestJson: requestJsonMock,
      });

      const controller = coll.collectionController();
      controller.loading = true; // Already in-flight

      await coll.collectionFetch(controller, "/workspace/items", vi.fn());

      // Concurrent fetch rejected
      expect(fetchCount).toBe(0);
    });
  });

  describe("Issue #135: Harden draft storage enumeration and expiry", () => {
    it("handles storage exceptions gracefully when sessionStorage is blocked", () => {
      const blockedWindow = {
        get sessionStorage() {
          throw new Error("SecurityError: Access is denied");
        },
      };

      const code = [
        DASHBOARD_STATE_JS,
        "function isRecord(v) { return v !== null && typeof v === 'object'; }",
        DASHBOARD_DRAFT_STORE_JS,
        "return { cradDraftStore, state };",
      ].join("\n");

      const fn = new Function("window", code);
      const { cradDraftStore, state } = fn(blockedWindow);
      state.status = { project_id: "test-proj" };

      // Should not throw, returns false or empty list
      expect(cradDraftStore.saveDraft("interview", "test draft")).toBe(false);
      expect(cradDraftStore.loadDraft("interview")).toBeNull();
      expect(cradDraftStore.scanDrafts()).toEqual([]);
      expect(() => cradDraftStore.clearProjectDrafts()).not.toThrow();
    });

    it("uses snapshotting to delete all adjacent matching project drafts without index shifting", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        get length() {
          return storageMap.size;
        },
        key(index: number) {
          const keys = Array.from(storageMap.keys());
          return keys[index] ?? null;
        },
        getItem(key: string) {
          return storageMap.get(key) ?? null;
        },
        setItem(key: string, val: string) {
          storageMap.set(key, val);
        },
        removeItem(key: string) {
          storageMap.delete(key);
        },
      };

      const code = [
        DASHBOARD_STATE_JS,
        "function isRecord(v) { return v !== null && typeof v === 'object'; }",
        DASHBOARD_DRAFT_STORE_JS,
        "return { cradDraftStore, state };",
      ].join("\n");

      const fn = new Function("window", code);
      const { cradDraftStore, state } = fn({ sessionStorage: mockStorage });
      state.status = { project_id: "project-1" };

      // Save multiple drafts for project-1
      cradDraftStore.saveDraft("interview", "interview draft 1");
      cradDraftStore.saveDraft("request", "request draft 1");
      cradDraftStore.saveDraft("quality_reason", "quality draft 1");

      // Save an unrelated draft for project-2
      storageMap.set(
        "crad:draft:v1:project-2:interview",
        JSON.stringify({
          schema_version: 1,
          form_key: "interview",
          project_id: "project-2",
          value: "p2 draft",
          saved_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 100000).toISOString(),
        })
      );

      // Save an external unrelated key
      storageMap.set("some_unrelated_key", "unrelated data");

      expect(storageMap.size).toBe(5);

      // Clear drafts for project-1
      cradDraftStore.clearProjectDrafts();

      // All 3 drafts of project-1 removed without skipping
      expect(storageMap.has("crad:draft:v1:project-1:interview")).toBe(false);
      expect(storageMap.has("crad:draft:v1:project-1:request")).toBe(false);
      expect(storageMap.has("crad:draft:v1:project-1:quality_reason")).toBe(false);

      // Project 2 draft and external keys preserved!
      expect(storageMap.has("crad:draft:v1:project-2:interview")).toBe(true);
      expect(storageMap.has("some_unrelated_key")).toBe(true);
    });

    it("expires drafts with invalid timestamps or corrupt JSON", () => {
      const storageMap = new Map<string, string>();
      const mockStorage = {
        get length() {
          return storageMap.size;
        },
        key(index: number) {
          return Array.from(storageMap.keys())[index] ?? null;
        },
        getItem(key: string) {
          return storageMap.get(key) ?? null;
        },
        setItem(key: string, val: string) {
          storageMap.set(key, val);
        },
        removeItem(key: string) {
          storageMap.delete(key);
        },
      };

      const code = [
        DASHBOARD_STATE_JS,
        "function isRecord(v) { return v !== null && typeof v === 'object'; }",
        DASHBOARD_DRAFT_STORE_JS,
        "return { cradDraftStore, state };",
      ].join("\n");

      const fn = new Function("window", code);
      const { cradDraftStore, state } = fn({ sessionStorage: mockStorage });
      state.status = { project_id: "proj-test" };

      // 1. Invalid timestamp (NaN)
      storageMap.set(
        "crad:draft:v1:proj-test:interview",
        JSON.stringify({
          schema_version: 1,
          form_key: "interview",
          project_id: "proj-test",
          value: "invalid date draft",
          saved_at: "not-a-date",
          expires_at: "invalid-date",
        })
      );

      // 2. Corrupt JSON
      storageMap.set("crad:draft:v1:proj-test:request", "{ corrupted json syntax");

      // 3. Valid draft
      storageMap.set(
        "crad:draft:v1:proj-test:quality_reason",
        JSON.stringify({
          schema_version: 1,
          form_key: "quality_reason",
          project_id: "proj-test",
          value: "valid quality draft",
          saved_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        })
      );

      // scanDrafts cleans up the corrupt and invalid timestamp entries while preserving the valid draft
      const drafts = cradDraftStore.scanDrafts();
      expect(drafts.length).toBe(1);
      expect(drafts[0].value).toBe("valid quality draft");
      expect(storageMap.has("crad:draft:v1:proj-test:interview")).toBe(false);
      expect(storageMap.has("crad:draft:v1:proj-test:request")).toBe(false);
    });
  });
});
