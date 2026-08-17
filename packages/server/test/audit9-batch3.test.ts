import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_API_JS } from "../src/dashboard-api.js";
import { DASHBOARD_MARKUP } from "../src/dashboard-markup.js";
import { DASHBOARD_PANELS_CORE_JS } from "../src/dashboard-panels-core.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";
import { DASHBOARD_LISTENERS_JS } from "../src/dashboard-listeners.js";
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
    removeChild: (child: MockElement) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      return child;
    },
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
      return null;
    },
    querySelectorAll: (selector: string) => {
      const results: MockElement[] = [];
      const walk = (node: MockElement) => {
        if (selector.startsWith(".")) {
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

function setupMockEnvironment() {
  const elementsById = new Map<string, MockElement>();
  const allElements: MockElement[] = [];

  function register(el: MockElement) {
    if (el.id) elementsById.set(el.id, el);
    allElements.push(el);
    for (const child of el.children) {
      register(child);
    }
    return el;
  }

  const documentMock = {
    createElement: (tag: string) => {
      const el = createMockElement(tag);
      allElements.push(el);
      return el;
    },
    getElementById: (id: string) => elementsById.get(id) ?? null,
    querySelector: (selector: string) => {
      if (selector.startsWith("#")) {
        return elementsById.get(selector.slice(1)) ?? null;
      }
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        return allElements.find((e) => e.classList.contains(cls)) ?? null;
      }
      return null;
    },
    querySelectorAll: (selector: string) => {
      if (selector === "button, select, textarea, input" || selector === "button, select, textarea") {
        return allElements.filter((e) => ["BUTTON", "SELECT", "TEXTAREA", "INPUT"].includes(e.tagName));
      }
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        return allElements.filter((e) => e.classList.contains(cls));
      }
      if (selector.includes("[data-action") || selector.includes("[data-action-key")) {
        return allElements.filter((e) => e.attrs.has("data-action") || e.attrs.has("data-action-key"));
      }
      if (selector === "#interview-choices button") {
        const container = elementsById.get("interview-choices");
        return (container ? container.children : []).filter((e) => e.tagName === "BUTTON");
      }
      return [];
    },
    body: createMockElement("body", "body"),
    addEventListener: vi.fn(),
    hidden: false,
  };

  const busyIndicator = register(createMockElement("div", "busy-indicator"));
  const lastUpdatedIndicator = register(createMockElement("div", "last-updated-indicator"));
  const transientNotice = register(createMockElement("div", "transient-notice"));
  const latestSummary = register(createMockElement("div", "latest-summary"));
  const latestJson = register(createMockElement("pre", "latest-json"));
  const latestDetails = register(createMockElement("details", "latest-details"));
  const latestRecovery = register(createMockElement("div", "latest-recovery"));
  const projectSelect = register(createMockElement("select", "project-select"));
  const selectProjectBtn = register(createMockElement("button", "select-project"));
  const agentSelect = register(createMockElement("select", "agent-select"));
  const submitInterviewBtn = register(createMockElement("button", "submit-interview"));
  const interviewAnswerInput = register(createMockElement("textarea", "interview-answer-input"));
  const interviewChoices = register(createMockElement("div", "interview-choices"));
  const publishPrimaryCta = register(createMockElement("button", "publish-primary-cta"));
  const confirmPublishBtn = register(createMockElement("button", "confirm-publish"));
  const provenanceConfirmMsg = register(createMockElement("div", "provenance-confirm-message"));
  const publishStepper = register(createMockElement("div", "publish-stepper"));
  const refreshBtn = register(createMockElement("button", "refresh"));
  const coverageCenter = register(createMockElement("div", "coverage-center"));
  const coverageCenterMsg = register(createMockElement("div", "coverage-center-message"));

  return {
    documentMock,
    elementsById,
    allElements,
    register,
    dom: {
      busyIndicator,
      lastUpdatedIndicator,
      transientNotice,
      latestSummary,
      latestJson,
      latestDetails,
      latestRecovery,
      projectSelect,
      selectProjectBtn,
      agentSelect,
      submitInterviewBtn,
      interviewAnswerInput,
      interviewChoices,
      publishPrimaryCta,
      confirmPublishBtn,
      provenanceConfirmMsg,
      publishStepper,
      refreshBtn,
      coverageCenter,
      coverageCenterMsg,
    },
  };
}

describe("Audit 9 Batch 3: Dashboard State, Notices, Publish CTA & Coverage Prerequisites", () => {
  describe("Issue #115: Dashboard busy state and centralized control synchronization", () => {
    it("preserves domain-disabled controls when global busy toggles true -> false", () => {
      const env = setupMockEnvironment();
      const code = [
        DASHBOARD_STATE_JS,
        "function byId(id) { return document.getElementById(id); }",
        DASHBOARD_PANELS_CORE_JS,
        "return { state, setBusy, setControlDomainDisabled, syncAllControls, syncControlDisabledState };",
      ].join("\n");
      const fn = new Function("document", "window", code);
      const { state, setBusy, setControlDomainDisabled } = fn(env.documentMock, {});

      const customDomainDisabledBtn = env.register(createMockElement("button", "custom-domain-btn"));
      setControlDomainDisabled(customDomainDisabledBtn, true, "前置條件未滿足");
      expect(customDomainDisabledBtn.disabled).toBe(true);
      expect(customDomainDisabledBtn.getAttribute("data-domain-disabled")).toBe("true");

      const customDomainEnabledBtn = env.register(createMockElement("button", "custom-enabled-btn"));
      setControlDomainDisabled(customDomainEnabledBtn, false);
      expect(customDomainEnabledBtn.disabled).toBe(false);

      setBusy(true);
      expect(state.busy).toBe(true);
      expect(customDomainDisabledBtn.disabled).toBe(true);
      expect(customDomainEnabledBtn.disabled).toBe(true);

      setBusy(false);
      expect(state.busy).toBe(false);

      expect(customDomainDisabledBtn.disabled).toBe(true);
      expect(customDomainDisabledBtn.getAttribute("data-domain-disabled")).toBe("true");
      expect(customDomainEnabledBtn.disabled).toBe(false);
    });

    it("supports per-action scoped busy without affecting unrelated controls", () => {
      const env = setupMockEnvironment();
      const code = [
        DASHBOARD_STATE_JS,
        "function byId(id) { return document.getElementById(id); }",
        DASHBOARD_PANELS_CORE_JS,
        "return { state, setActionBusy };",
      ].join("\n");
      const fn = new Function("document", "window", code);
      const { state, setActionBusy } = fn(env.documentMock, {});

      const targetActionBtn = env.register(createMockElement("button", "specific-action-btn"));
      targetActionBtn.setAttribute("data-action-key", "specific-action-key");

      const otherActionBtn = env.register(createMockElement("button", "other-action-btn"));

      expect(targetActionBtn.disabled).toBe(false);
      expect(otherActionBtn.disabled).toBe(false);

      setActionBusy("specific-action-key", true);
      expect(state.actionBusy["specific-action-key"]).toBe(true);
      expect(targetActionBtn.disabled).toBe(true);
      expect(otherActionBtn.disabled).toBe(false);

      setActionBusy("specific-action-key", false);
      expect(state.actionBusy["specific-action-key"]).toBe(false);
      expect(targetActionBtn.disabled).toBe(false);
      expect(otherActionBtn.disabled).toBe(false);
    });

    it("updates lastUpdated timestamp and indicator", () => {
      const env = setupMockEnvironment();
      const code = [
        DASHBOARD_STATE_JS,
        "function byId(id) { return document.getElementById(id); }",
        DASHBOARD_PANELS_CORE_JS,
        "return { state, updateLastUpdated };",
      ].join("\n");
      const fn = new Function("document", "window", code);
      const { state, updateLastUpdated } = fn(env.documentMock, {});

      updateLastUpdated("2026-08-17T12:00:00.000Z");
      expect(state.lastUpdated).toBe("2026-08-17T12:00:00.000Z");
      expect(env.dom.lastUpdatedIndicator.textContent).toContain("最後更新：");
    });
  });

  describe("Issue #125: Separation of transient notices and latest diagnostic summary", () => {
    it("markup contains separate DOM elements for transient notice and latest summary", () => {
      expect(DASHBOARD_MARKUP).toContain('id="transient-notice"');
      expect(DASHBOARD_MARKUP).toContain('id="latest-summary"');
      expect(DASHBOARD_MARKUP).toContain('id="last-updated-indicator"');
    });

    it("setNotice writes exclusively to transient-notice without overwriting latest-summary", () => {
      const env = setupMockEnvironment();
      const code = [
        DASHBOARD_STATE_JS,
        "function byId(id) { return document.getElementById(id); }",
        "function isRecord(v) { return v !== null && typeof v === 'object'; }",
        "function firstString(r, keys) { for (var k of keys) { if (typeof r[k] === 'string') return r[k]; } return ''; }",
        "function readableStatus(s) { return s; }",
        "function jsonText(v) { return JSON.stringify(v); }",
        "function errorText(e) { return (e && e.message) || String(e); }",
        "function errorSnapshot(e) { return { message: errorText(e) }; }",
        "function currentProjectId() { return 'proj-1'; }",
        "function refresh() {}",
        "function renderRecoveryCards() {}",
        DASHBOARD_PANELS_CORE_JS,
        "return { renderLatest, renderLatestError, setNotice };",
      ].join("\n");
      const fn = new Function("document", "window", code);
      const { renderLatest, setNotice } = fn(env.documentMock, {});

      renderLatest("自然語言操作", {
        status: "in_progress",
        summary: "正在評估覆蓋矩陣缺口",
        question: "請確認是否需要補充世界觀設定？",
      });

      expect(env.dom.latestSummary.textContent).toContain("自然語言操作；狀態：in_progress；摘要：正在評估覆蓋矩陣缺口；需要輸入：請確認是否需要補充世界觀設定？");
      expect(env.dom.latestJson.textContent).toContain("in_progress");

      setNotice("success", "自然語言操作完成。");

      expect(env.dom.transientNotice.hidden).toBe(false);
      expect(env.dom.transientNotice.textContent).toBe("自然語言操作完成。");
      expect(env.dom.transientNotice.className).toContain("success");

      expect(env.dom.latestSummary.textContent).toContain("正在評估覆蓋矩陣缺口");
      expect(env.dom.latestSummary.textContent).toContain("需要輸入：請確認是否需要補充世界觀設定？");
    });
  });

  describe("Issue #130: Publish CTA state recovery on busy rejection and unexpected errors", () => {
    it("runTask returns an explicit outcome object on busy rejection without executing task", async () => {
      const env = setupMockEnvironment();
      const coreFns = extractFunctions(DASHBOARD_PANELS_CORE_JS, [
        "setNotice",
        "updateLastUpdated",
        "setControlDomainDisabled",
        "isReadOnlySafeControl",
        "syncControlDisabledState",
        "syncAllControls",
        "setBusy",
        "setActionBusy",
        "renderLatest",
        "renderLatestError",
      ]);
      const apiFns = extractFunctions(DASHBOARD_API_JS, ["runTask", "refresh"]);
      const stateObj = { busy: false, actionBusy: {}, lastUpdated: null, projects: [], agents: [], interviewQuestion: null };

      const api = execute(
        new Map([...coreFns, ...apiFns]),
        ["runTask", "setBusy"],
        {
          state: stateObj,
          document: env.documentMock,
          window: { location: { search: "" }, addEventListener: vi.fn() },
          byId: (id: string) => env.documentMock.getElementById(id),
          setNotice: vi.fn(),
          renderLatest: vi.fn(),
          renderLatestError: vi.fn(),
          updateLastUpdated: vi.fn(),
          syncAllControls: vi.fn(),
        }
      );

      stateObj.busy = true;

      const taskFn = vi.fn();
      const outcome = await api.runTask("確認並發布", taskFn);

      expect(taskFn).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: false,
        status: "busy_rejected",
        reason: "系統忙碌中",
      });
    });

    it("triggerConfirmPublish rolls back in_flight and restores CTA on busy rejection", async () => {
      const env = setupMockEnvironment();
      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["updatePublishStepper"]);
      const listenersFns = extractFunctions(DASHBOARD_LISTENERS_JS, ["triggerConfirmPublish"]);

      const publishStepperState = {
        stage: "provenance_reviewed",
        status: "pass",
        readinessOk: true,
        previewData: null,
        staleDiff: null,
      };

      const currentProvenanceConfirmation = {
        fingerprint: "fp-12345",
        republish: false,
        in_flight: false,
        completed: false,
      };

      const listeners = execute(
        new Map([...publishFns, ...listenersFns]),
        ["triggerConfirmPublish", "updatePublishStepper"],
        {
          document: env.documentMock,
          window: {},
          byId: (id: string) => env.documentMock.getElementById(id),
          setNotice: vi.fn(),
          publishStepperState,
          currentProvenanceConfirmation,
          runTask: vi.fn(async () => ({ ok: false, status: "busy_rejected", reason: "系統忙碌中" })),
          syncAllControls: vi.fn(),
        }
      );

      listeners.updatePublishStepper("provenance_reviewed", "pass");
      expect(env.dom.publishPrimaryCta.textContent).toBe("確認此組成並發布");

      await listeners.triggerConfirmPublish();

      expect(currentProvenanceConfirmation.in_flight).toBe(false);
      expect(env.dom.publishPrimaryCta.textContent).toBe("確認此組成並發布");
      expect(env.dom.publishPrimaryCta.getAttribute("aria-busy")).toBeNull();
      expect(env.dom.provenanceConfirmMsg.textContent).toContain("系統正在執行其他操作");
    });
  });

  describe("Issue #132: Disabled coverage prerequisites accessibility and navigation", () => {
    it("renders disabled button with aria-disabled and creates an enabled remedy button", () => {
      const env = setupMockEnvironment();
      let switchedPanel: string | null = null;

      const coverageFns = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, ["renderCellActionButton"]);
      const coverage = execute(coverageFns, ["renderCellActionButton"], {
        document: env.documentMock,
        byId: (id: string) => env.documentMock.getElementById(id),
        switchPanel: (panel: string) => { switchedPanel = panel; },
        startCoverageResearch: vi.fn(),
        openRecoveryDialog: vi.fn(),
        previewCoverageResolution: vi.fn(),
      });

      const cell = {
        character_id: "char_1",
        requirement_id: "req_profile",
        missing_prerequisite: "COVERAGE_ASSESSMENT_REQUIRED",
      };

      const actionOpt = {
        action: "research",
        label: "來源研究",
        enabled: false,
        disabled_reason: "需要先完成 Blueprint 預檢與事實評估",
        prerequisite: {
          target_panel: "facts",
          label: "事實評估面板",
        },
      };

      const container = coverage.renderCellActionButton(cell, actionOpt) as MockElement;
      expect(container).toBeDefined();

      const mainBtn = container.children.find((c) => c.getAttribute("data-action") === "research")!;
      expect(mainBtn).toBeDefined();
      expect(mainBtn.disabled).toBe(true);
      expect(mainBtn.getAttribute("aria-disabled")).toBe("true");
      expect(mainBtn.getAttribute("data-domain-disabled")).toBe("true");
      expect(mainBtn.getAttribute("aria-describedby")).toBe("desc-char_1__req_profile-research");

      const descEl = container.children.find((c) => c.id === "desc-char_1__req_profile-research")!;
      expect(descEl).toBeDefined();
      expect(descEl.textContent).toContain("需要先完成 Blueprint 預檢與事實評估");

      const remedyBtn = container.children.find((c) => c.classList.contains("prerequisite-nav-btn"))!;
      expect(remedyBtn).toBeDefined();
      expect(remedyBtn.disabled).toBe(false);
      expect(remedyBtn.getAttribute("data-target-panel")).toBe("facts");
      expect(remedyBtn.getAttribute("aria-label")).toContain("事實評估面板");

      const clickHandlers = remedyBtn.listeners.get("click") ?? [];
      expect(clickHandlers.length).toBeGreaterThan(0);
      clickHandlers[0]();

      expect(switchedPanel).toBe("facts");
    });

    it("renders wideResearch with aria-disabled and aria-describedby when disabled", () => {
      const env = setupMockEnvironment();
      const coverageFns = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
        "renderCoverageCenter",
        "coverageButton",
        "setCoverageNotice",
      ]);

      const coverage = execute(coverageFns, ["renderCoverageCenter"], {
        document: env.documentMock,
        byId: (id: string) => env.documentMock.getElementById(id),
        startCoverageResearch: vi.fn(),
        statusClass: (s: string) => s,
        coverageCellId: () => "cell-1",
        coverageCellTitle: () => "Cell Title",
        coverageCenterCellElement: () => env.documentMock.createElement("div"),
        coverageButton: (label: string, handler: () => void) => {
          const btn = env.documentMock.createElement("button");
          btn.textContent = label;
          btn.addEventListener("click", handler);
          return btn;
        },
        setCoverageNotice: vi.fn(),
      });

      const payload = {
        matrix: {
          assessment_wide_research: {
            enabled: false,
            disabled_reason: "尚有未完成的事實評估前置需求",
          },
          cells: [],
        },
      };

      coverage.renderCoverageCenter(payload);

      const topBar = env.dom.coverageCenter.children[1];
      expect(topBar).toBeDefined();

      const allResearchBtn = topBar.children.find((c) => c.textContent === "全量缺口研究")!;
      expect(allResearchBtn).toBeDefined();
      expect(allResearchBtn.disabled).toBe(true);
      expect(allResearchBtn.getAttribute("aria-disabled")).toBe("true");
      expect(allResearchBtn.getAttribute("data-domain-disabled")).toBe("true");
      expect(allResearchBtn.getAttribute("aria-describedby")).toBe("wide-research-desc");

      const descSpan = topBar.children.find((c) => c.id === "wide-research-desc")!;
      expect(descSpan).toBeDefined();
      expect(descSpan.textContent).toBe("尚有未完成的事實評估前置需求");
    });

    it("handles multiple prerequisite types (assessment not current, not formal, stale)", () => {
      const env = setupMockEnvironment();
      let switchedPanel: string | null = null;

      const coverageFns = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, ["renderCellActionButton"]);
      const coverage = execute(coverageFns, ["renderCellActionButton"], {
        document: env.documentMock,
        byId: (id: string) => env.documentMock.getElementById(id),
        switchPanel: (panel: string) => { switchedPanel = panel; },
        startCoverageResearch: vi.fn(),
        openRecoveryDialog: vi.fn(),
        previewCoverageResolution: vi.fn(),
      });

      const testCases = [
        {
          code: "COVERAGE_ASSESSMENT_NOT_CURRENT",
          reason: "評估基準過期，請重新執行覆蓋矩陣評估",
          target_panel: "coverage",
        },
        {
          code: "COVERAGE_ASSESSMENT_NOT_FORMAL",
          reason: "需要先完成正式事實審核與發布檢查",
          target_panel: "review",
        },
        {
          code: "COVERAGE_ASSESSMENT_STALE",
          reason: "事實庫已發生變更，請重新評估",
          target_panel: "coverage",
        },
      ];

      for (const tc of testCases) {
        const cell = {
          character_id: "char_2",
          requirement_id: "req_dynamic",
          missing_prerequisite: tc.code,
        };
        const actionOpt = {
          action: "supplement",
          label: "補充資料",
          enabled: false,
          disabled_reason: tc.reason,
          prerequisite: {
            target_panel: tc.target_panel,
            label: tc.target_panel + "面板",
          },
        };

        const container = coverage.renderCellActionButton(cell, actionOpt) as MockElement;
        const mainBtn = container.children.find((c) => c.getAttribute("data-action") === "supplement")!;
        expect(mainBtn.disabled).toBe(true);
        expect(mainBtn.getAttribute("aria-disabled")).toBe("true");

        const remedyBtn = container.children.find((c) => c.classList.contains("prerequisite-nav-btn"))!;
        expect(remedyBtn).toBeDefined();
        expect(remedyBtn.getAttribute("data-target-panel")).toBe(tc.target_panel);

        const clickHandlers = remedyBtn.listeners.get("click") ?? [];
        clickHandlers[0]();
        expect(switchedPanel).toBe(tc.target_panel);
      }
    });
  });

  describe("Integration & Failure Modes", () => {
    it("Issue #130: triggerConfirmPublish handles CoreError (PROVENANCE_CONFIRMATION_STALE) and restores stepper to stale", async () => {
      const env = setupMockEnvironment();
      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["updatePublishStepper"]);
      const listenersFns = extractFunctions(DASHBOARD_LISTENERS_JS, ["triggerConfirmPublish"]);

      const publishStepperState = {
        stage: "provenance_reviewed",
        status: "pass",
      };

      const currentProvenanceConfirmation = {
        fingerprint: "fp-stale-99",
        republish: false,
        in_flight: false,
        completed: false,
      };

      const staleError: any = new Error("PROVENANCE_CONFIRMATION_STALE");
      staleError.code = "PROVENANCE_CONFIRMATION_STALE";
      staleError.details = { changed_inputs: [{ label: "角色設定", category: "character" }] };

      const listeners = execute(
        new Map([...publishFns, ...listenersFns]),
        ["triggerConfirmPublish", "updatePublishStepper"],
        {
          document: env.documentMock,
          window: {},
          byId: (id: string) => env.documentMock.getElementById(id),
          setNotice: vi.fn(),
          publishStepperState,
          currentProvenanceConfirmation,
          runTask: vi.fn(async (_label, task) => {
            try {
              await task();
            } catch (err) {
              return { ok: false, status: "failed", error: err };
            }
          }),
          postJson: vi.fn(async () => {
            throw staleError;
          }),
          renderStaleDiff: vi.fn(),
          syncAllControls: vi.fn(),
        }
      );

      await listeners.triggerConfirmPublish();

      // in_flight must be safely restored to false
      expect(currentProvenanceConfirmation.in_flight).toBe(false);
      // Stepper must be moved to inputs_frozen with stale status
      expect(publishStepperState.stage).toBe("inputs_frozen");
      expect(publishStepperState.status).toBe("stale");
      // Primary CTA must reflect stale recovery label
      expect(env.dom.publishPrimaryCta.textContent).toBe("重新準備發布確認");
      expect(env.dom.publishPrimaryCta.disabled).toBe(false);
    });

    it("Issue #130: prevents double invocation when publish is already in_flight", async () => {
      const env = setupMockEnvironment();
      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["updatePublishStepper"]);
      const listenersFns = extractFunctions(DASHBOARD_LISTENERS_JS, ["triggerConfirmPublish"]);

      const currentProvenanceConfirmation = {
        fingerprint: "fp-flight-1",
        republish: false,
        in_flight: true, // Already in flight!
        completed: false,
      };

      const runTaskMock = vi.fn();
      const listeners = execute(
        new Map([...publishFns, ...listenersFns]),
        ["triggerConfirmPublish"],
        {
          document: env.documentMock,
          window: {},
          byId: (id: string) => env.documentMock.getElementById(id),
          setNotice: vi.fn(),
          currentProvenanceConfirmation,
          runTask: runTaskMock,
          syncAllControls: vi.fn(),
        }
      );

      await listeners.triggerConfirmPublish();

      // Double invocation prevented; runTask was not called
      expect(runTaskMock).not.toHaveBeenCalled();
    });
  });
});

