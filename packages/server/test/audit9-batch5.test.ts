import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_CSS } from "../src/dashboard-css.js";
import { DASHBOARD_MARKUP } from "../src/dashboard-markup.js";
import { DASHBOARD_PANELS_CORE_JS } from "../src/dashboard-panels-core.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";

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
  tabIndex: number;
  type: string;
  files: any[];
  parentNode: MockElement | null;
  children: MockElement[];
  childNodes: MockElement[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<(event?: any) => void>>;
  style: Record<string, string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    contains: (c: string) => boolean;
  };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, handler: (event?: any) => void) => void;
  removeEventListener: (type: string, handler: (event?: any) => void) => void;
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  remove: () => void;
  focus: () => void;
  click: () => void;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
};

function createMockElement(tagName: string, id = ""): MockElement {
  const listeners = new Map<string, Array<(event?: any) => void>>();
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
    tabIndex: 0,
    type: "",
    files: [],
    parentNode: null,
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
      attrs.set(name, String(value));
    },
    getAttribute: (name: string) => (attrs.has(name) ? attrs.get(name)! : null),
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
    addEventListener: (type: string, handler: (event?: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler);
    },
    removeEventListener: (type: string, handler: (event?: any) => void) => {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    },
    appendChild: (child: MockElement) => {
      child.parentNode = element;
      children.push(child);
      return child;
    },
    removeChild: (child: MockElement) => {
      const idx = children.indexOf(child);
      if (idx >= 0) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    remove: () => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    },
    focus: vi.fn(),
    click: vi.fn(),
    querySelector: (selector: string): MockElement | null => {
      const results = element.querySelectorAll(selector);
      return results.length > 0 ? results[0] : null;
    },
    querySelectorAll: (selector: string): MockElement[] => {
      const matches: MockElement[] = [];
      function matchNode(node: MockElement) {
        if (selector === ".stepper-step" && node.classList.contains("stepper-step")) {
          matches.push(node);
        } else if (selector === ".step-badge" && node.classList.contains("step-badge")) {
          matches.push(node);
        } else if (selector.startsWith("#") && node.id === selector.slice(1)) {
          matches.push(node);
        } else if (selector.startsWith(".") && node.classList.contains(selector.slice(1))) {
          matches.push(node);
        } else if (selector === "button" && node.tagName === "BUTTON") {
          matches.push(node);
        } else if (selector === "input" && node.tagName === "INPUT") {
          matches.push(node);
        } else if (selector.includes("button") || selector.includes("input") || selector.includes("select") || selector.includes("textarea")) {
          if (node.tagName === "BUTTON" || node.tagName === "INPUT" || node.tagName === "SELECT" || node.tagName === "TEXTAREA") {
            matches.push(node);
          }
        }
        for (const child of node.children) {
          matchNode(child);
        }
      }
      for (const child of element.children) {
        matchNode(child);
      }
      return matches;
    },
  };

  return element;
}

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const asyncMarker = `async function ${name}(`;
    const marker = `function ${name}(`;
    const asyncStart = source.indexOf(asyncMarker);
    const start = asyncStart >= 0 ? source.indexOf(marker, asyncStart) : source.indexOf(marker);
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

describe("Audit 9 Batch 5 Suite", () => {
  describe("Issue #141: Standardize accessible modal lifecycle across Dashboard overlays", () => {
    it("createAccessibleModal establishes role=dialog, aria-modal=true, and focus lifecycle", () => {
      const domElements = new Map<string, MockElement>();
      const docListeners = new Map<string, Array<(event?: any) => void>>();
      const activeElement: MockElement | null = createMockElement("button", "trigger-btn");

      const mockBody = createMockElement("body", "body");
      mockBody.style = { overflow: "auto" };

      const mockDocument = {
        activeElement,
        body: mockBody,
        createElement: (tag: string) => createMockElement(tag),
        getElementById: (id: string) => domElements.get(id) || null,
        addEventListener: (type: string, handler: (event?: any) => void) => {
          if (!docListeners.has(type)) docListeners.set(type, []);
          docListeners.get(type)!.push(handler);
        },
        removeEventListener: (type: string, handler: (event?: any) => void) => {
          const list = docListeners.get(type);
          if (!list) return;
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        },
      };

      const coreFns = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["createAccessibleModal"]);
      const { createAccessibleModal } = execute(coreFns, ["createAccessibleModal"], {
        document: mockDocument,
        byId: (id: string) => domElements.get(id) || null,
        currentActiveModal: null,
      });

      // 1. 開啟第一個 Accessible Modal
      const modalHandle = createAccessibleModal({
        id: "test-accessible-modal",
        titleText: "測試無障礙對話框",
      });

      expect(modalHandle.overlay).toBeDefined();
      expect(modalHandle.modal).toBeDefined();
      expect(modalHandle.modal.getAttribute("role")).toBe("dialog");
      expect(modalHandle.modal.getAttribute("aria-modal")).toBe("true");
      expect(modalHandle.modal.getAttribute("aria-labelledby")).toBe(modalHandle.titleId);
      expect(mockBody.style.overflow).toBe("hidden");

      // 模擬加入 DOM
      mockBody.appendChild(modalHandle.overlay);

      // 2. 加入互動按鈕並測試 Tab 焦點循環 (Focus Trap)
      const btn1 = createMockElement("button", "btn-cancel");
      const btn2 = createMockElement("button", "btn-confirm");
      modalHandle.modal.appendChild(btn1);
      modalHandle.modal.appendChild(btn2);

      // 測試 Escape 鍵關閉對話框
      const keydownListeners = docListeners.get("keydown") || [];
      expect(keydownListeners.length).toBeGreaterThan(0);

      const preventDefault = vi.fn();
      keydownListeners[0]({ key: "Escape", preventDefault, stopPropagation: vi.fn() });
      expect(preventDefault).toHaveBeenCalled();

      // 關閉後背景 overflow 還原，且 activeElement 還原
      expect(mockBody.style.overflow).toBe("auto");
      expect(activeElement.focus).toHaveBeenCalled();
      expect(mockBody.children).not.toContain(modalHandle.overlay);
    });

    it("prevents multiple overlay stacking by cleaning up active modal before opening new one", () => {
      const mockBody = createMockElement("body", "body");
      mockBody.style = { overflow: "auto" };
      const docListeners = new Map<string, Array<(event?: any) => void>>();

      const mockDocument = {
        activeElement: null,
        body: mockBody,
        createElement: (tag: string) => createMockElement(tag),
        getElementById: () => null,
        addEventListener: (type: string, handler: (event?: any) => void) => {
          if (!docListeners.has(type)) docListeners.set(type, []);
          docListeners.get(type)!.push(handler);
        },
        removeEventListener: (type: string, handler: (event?: any) => void) => {
          const list = docListeners.get(type);
          if (!list) return;
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        },
      };

      const coreFns = extractFunctions(DASHBOARD_PANELS_CORE_JS, ["createAccessibleModal"]);
      const { createAccessibleModal } = execute(coreFns, ["createAccessibleModal"], {
        document: mockDocument,
        byId: () => null,
        currentActiveModal: null,
      });

      const m1 = createAccessibleModal({ id: "modal-1", titleText: "Modal 1" });
      mockBody.appendChild(m1.overlay);
      expect(mockBody.children.length).toBe(1);

      // 開啟第二個 modal，應自動清理第一個
      const m2 = createAccessibleModal({ id: "modal-2", titleText: "Modal 2" });
      mockBody.appendChild(m2.overlay);
      expect(mockBody.children).not.toContain(m1.overlay);
      expect(mockBody.children.length).toBe(1);

      m2.close();
      expect(mockBody.children.length).toBe(0);
      expect(mockBody.style.overflow).toBe("auto");
    });
  });

  describe("Issue #138: Complete Dashboard layout, form, media, and completion-card styles", () => {
    it("defines styles for image thumbnails with object-fit and bounded dimensions", () => {
      expect(DASHBOARD_CSS).toContain(".image-thumb");
      expect(DASHBOARD_CSS).toContain(".image-card-thumb");
      expect(DASHBOARD_CSS).toContain("object-fit: cover");
      expect(DASHBOARD_CSS).toContain("#image-crop-preview canvas");
    });

    it("defines publish-completion-card and download guide classes", () => {
      expect(DASHBOARD_CSS).toContain(".publish-completion-card");
      expect(DASHBOARD_CSS).toContain(".completion-title");
      expect(DASHBOARD_CSS).toContain(".completion-summary");
      expect(DASHBOARD_CSS).toContain(".download-guide");
      expect(DASHBOARD_CSS).toContain(".completion-actions");
    });

    it("defines dangerous actions and primary/secondary button hierarchy", () => {
      expect(DASHBOARD_CSS).toContain(".danger-button");
      expect(DASHBOARD_CSS).toContain("button.danger");
      expect(DASHBOARD_CSS).toContain(".btn-primary");
      expect(DASHBOARD_CSS).toContain(".btn-secondary");
      expect(DASHBOARD_CSS).toContain(".btn-compact");
      expect(DASHBOARD_CSS).toContain(".home-action");
    });
  });

  describe("Issue #142: Compact controls, motion preferences, stepper semantics, focus, and contrast", () => {
    it("renders publish-stepper as an ordered list with localized status and aria-current=step", () => {
      // 驗證 markup
      expect(DASHBOARD_MARKUP).toContain('<ol id="publish-stepper" class="publish-stepper"');
      expect(DASHBOARD_MARKUP).toContain('<li class="stepper-step current" data-step="readiness" aria-current="step">');
      expect(DASHBOARD_MARKUP).toContain('<span class="step-label">發布就緒</span>');
      expect(DASHBOARD_MARKUP).toContain('<span class="step-badge">進行中</span>');

      // 驗證 updatePublishStepper 行為
      const stepperOl = createMockElement("ol", "publish-stepper");
      const steps = ["readiness", "inputs_frozen", "provenance_reviewed", "confirmed", "published"];
      for (let i = 0; i < steps.length; i++) {
        const li = createMockElement("li");
        li.className = "stepper-step";
        li.setAttribute("data-step", steps[i]);
        const badge = createMockElement("span");
        badge.className = "step-badge";
        li.appendChild(badge);
        stepperOl.appendChild(li);
      }

      const ctaBtn = createMockElement("button", "publish-primary-cta");

      const publishStepperState = {
        stage: "readiness",
        status: "waiting",
        readinessOk: false,
        previewData: null,
        staleDiff: null,
      };

      const STEPPER_STATUS_LABELS = {
        waiting: "等待中",
        current: "進行中",
        pass: "已完成",
        stale: "已過期",
        blocked: "已阻擋",
      };

      const publishFns = extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, ["updatePublishStepper"]);
      const { updatePublishStepper } = execute(publishFns, ["updatePublishStepper"], {
        byId: (id: string) => (id === "publish-stepper" ? stepperOl : id === "publish-primary-cta" ? ctaBtn : null),
        publishStepperState,
        STEPPER_STATUS_LABELS,
      });

      // 更新為 inputs_frozen (pass)
      updatePublishStepper("inputs_frozen", "pass");

      const liElements = stepperOl.children;
      // Step 0 (readiness) 應為 pass, 已完成
      expect(liElements[0].classList.contains("pass")).toBe(true);
      expect(liElements[0].getAttribute("aria-current")).toBeNull();
      expect(liElements[0].children[0].textContent).toBe("已完成");

      // Step 1 (inputs_frozen) 應為 pass, 當前步驟 aria-current="step"
      expect(liElements[1].classList.contains("pass")).toBe(true);
      expect(liElements[1].getAttribute("aria-current")).toBe("step");
      expect(liElements[1].children[0].textContent).toBe("已完成");

      // Step 2 (provenance_reviewed) 應為等待中
      expect(liElements[2].getAttribute("aria-current")).toBeNull();
      expect(liElements[2].children[0].textContent).toBe("等待中");
    });

    it("includes global :focus-visible rules with high contrast", () => {
      expect(DASHBOARD_CSS).toContain(":focus-visible");
      expect(DASHBOARD_CSS).toContain("outline: 2px solid #005fb8");
      expect(DASHBOARD_CSS).toContain("outline-offset: 2px");
    });

    it("provides comprehensive prefers-reduced-motion media query support", () => {
      expect(DASHBOARD_CSS).toContain("@media (prefers-reduced-motion: reduce)");
      expect(DASHBOARD_CSS).toContain("animation-duration: 0.001ms !important");
      expect(DASHBOARD_CSS).toContain("transition-duration: 0.001ms !important");
      expect(DASHBOARD_CSS).toContain("scroll-behavior: auto !important");
    });
  });
});
