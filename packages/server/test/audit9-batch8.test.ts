import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_CSS } from "../src/dashboard-css.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";
import { DASHBOARD_PANELS_MEDIA_JS } from "../src/dashboard-panels-media.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";

type TestElement = {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  hidden: boolean;
  value: string;
  attrs: Map<string, string>;
  children: TestElement[];
  listeners: Map<string, Array<() => void>>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  appendChild: (child: TestElement) => TestElement;
  addEventListener: (type: string, handler: () => void) => void;
};

function createElement(tagName: string): TestElement {
  const attrs = new Map<string, string>();
  const children: TestElement[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const element: TestElement = {
    tagName: tagName.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    hidden: false,
    value: "",
    attrs,
    children,
    listeners,
    setAttribute: (name, value) => {
      attrs.set(name, value);
      if (name === "id") element.id = value;
      if (name === "class") element.className = value;
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    addEventListener: (type, handler) => {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
  };
  return element;
}

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const name of names) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) continue;
    let depth = 0;
    let inBody = false;
    let end = -1;
    for (let index = start + marker.length; index < source.length; index += 1) {
      const char = source[index];
      if (!inBody) {
        if (char === "{") {
          inBody = true;
          depth = 1;
        }
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end > 0) result.set(name, source.slice(start, end));
  }
  return result;
}

function execute(functions: Map<string, string>, names: string[], context: Record<string, unknown>) {
  const keys = Object.keys(context);
  const factory = new Function(...keys, `${names.map((name) => functions.get(name) ?? "").join("\n")}\nreturn { ${names.join(", ")} };`);
  return factory(...keys.map((key) => context[key])) as Record<string, any>;
}

describe("Audit 9 Batch 8: scalable coverage/research views and Dashboard theme tokens", () => {
  it("keeps large coverage/research collections bounded and prioritizes attention items stably", () => {
    const functions = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "isCoverageCellAttention",
      "isCoverageCellActive",
      "coverageCellMatchesFilter",
      "prioritizeCoverageCells",
      "prioritizeResearchItems",
      "researchStatusCount",
    ]);
    const coverageViewState = { cellFilter: "all" };
    const coverage = execute(functions, [
      "isCoverageCellAttention",
      "isCoverageCellActive",
      "coverageCellMatchesFilter",
      "prioritizeCoverageCells",
      "prioritizeResearchItems",
      "researchStatusCount",
    ], { coverageViewState, Array });

    const cells = Array.from({ length: 1_000 }, (_, index) => ({
      requirement_id: `req-${index}`,
      status: index === 400 ? "missing" : index === 700 ? "candidate_signal" : "source_covered",
      current_research_tasks: index === 700 ? [{ status: "running" }] : [],
    }));
    const prioritized = coverage.prioritizeCoverageCells(cells);
    expect(prioritized).toHaveLength(1_000);
    expect(prioritized[0]).toBe(cells[400]);
    expect(prioritized[1]).toBe(cells[700]);
    expect(prioritized[2]).toBe(cells[0]);

    coverageViewState.cellFilter = "attention";
    expect(cells.filter((cell) => coverage.coverageCellMatchesFilter(cell))).toEqual([cells[400]]);
    coverageViewState.cellFilter = "active";
    expect(cells.filter((cell) => coverage.coverageCellMatchesFilter(cell))).toEqual([cells[700]]);
    coverageViewState.cellFilter = "covered";
    expect(cells.filter((cell) => coverage.coverageCellMatchesFilter(cell))).toHaveLength(998);

    const research = Array.from({ length: 500 }, (_, index) => ({
      id: `task-${index}`,
      status: index === 250 ? "failed" : "queued",
    }));
    const orderedResearch = coverage.prioritizeResearchItems(research, (item: { status: string }) => item.status === "failed");
    expect(orderedResearch).toHaveLength(500);
    expect(orderedResearch[0]).toBe(research[250]);
    expect(coverage.researchStatusCount([], ["queued"])).toBe(0);
    expect(coverage.researchStatusCount(research, ["queued"])).toBe(499);
  });

  it("creates coverage details lazily and exposes predictable keyboard state", () => {
    const functions = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "coverageCellKey",
      "coverageCellDisclosureLabel",
      "toggleCoverageCellDetails",
      "coverageCenterCellElement",
    ]);
    const detailFactory = vi.fn(() => createElement("div"));
    const coverageViewState = { expandedCells: {} as Record<string, boolean> };
    const document = { createElement };
    const coverage = execute(functions, [
      "coverageCellKey",
      "coverageCellDisclosureLabel",
      "toggleCoverageCellDetails",
      "coverageCenterCellElement",
    ], {
      document,
      coverageViewState,
      coverageCellId: () => "coverage-cell-id",
      coverageCellTitle: () => "世界 / req-1",
      statusClass: (status: string) => status,
      coverageCellDetailsElement: detailFactory,
    });

    const row = coverage.coverageCenterCellElement({
      requirement_id: "req-1",
      status: "missing",
      reason: "需要補件",
    }, [] as unknown[]) as TestElement;
    const disclosure = row.children.find((child) => child.tagName === "BUTTON")!;
    const details = row.children.find((child) => child.className === "coverage-cell-disclosure")!;

    expect(detailFactory).not.toHaveBeenCalled();
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.getAttribute("aria-controls")).toBe("coverage-details-world__req-1");
    expect(disclosure.getAttribute("data-coverage-focus-key")).toBe("coverage-toggle-world__req-1");
    expect(details.hidden).toBe(true);

    disclosure.listeners.get("click")![0]();
    expect(detailFactory).toHaveBeenCalledTimes(1);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(details.hidden).toBe(false);
    expect(coverageViewState.expandedCells["world__req-1"]).toBe(true);
  });

  it("paginates research tasks and presents a no-more boundary instead of rendering all rows", () => {
    const functions = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "researchTaskNeedsAttention",
      "prioritizeResearchItems",
      "renderResearchTasks",
    ]);
    const monitorRender = vi.fn();
    const coverageViewState = { visibleTaskCount: 12 };
    const document = { createElement };
    const coverage = execute(functions, [
      "researchTaskNeedsAttention",
      "prioritizeResearchItems",
      "renderResearchTasks",
    ], {
      document,
      coverageViewState,
      RESEARCH_TASK_PAGE_SIZE: 12,
      researchTaskElement: (task: { id: string }) => {
        const element = createElement("div");
        element.className = "research-task-row";
        element.textContent = task.id;
        return element;
      },
      renderResearchMonitor: monitorRender,
    });

    const tasks = Array.from({ length: 40 }, (_, index) => ({
      id: `task-${index}`,
      status: index === 30 ? "failed" : "queued",
    }));
    const section = coverage.renderResearchTasks(tasks, { tasks }) as TestElement;
    expect(section.children.filter((child) => child.className === "research-task-row")).toHaveLength(12);
    const more = section.children.find((child) => child.tagName === "BUTTON")!;
    expect(more.textContent).toBe("載入更多研究任務");
    expect(more.getAttribute("aria-label")).toContain("12 / 40");
    expect(more.getAttribute("data-coverage-focus-key")).toBe("research-task-more");

    more.listeners.get("click")![0]();
    expect(coverageViewState.visibleTaskCount).toBe(24);
    expect(monitorRender).toHaveBeenCalledTimes(1);
  });

  it("resets expanded/pagination state when a project changes and guards stale refreshes", () => {
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("requestGeneration !== coverageRequestGeneration");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("generation !== state.projectGeneration");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain("resetCoverageViewState");
    expect(DASHBOARD_PANELS_COVERAGE_JS).toContain('className = "empty-state error-state"');
  });

  it("keeps assembled Dashboard panel scripts valid for browser execution", () => {
    expect(() => new Function(DASHBOARD_PANELS_COVERAGE_JS)).not.toThrow();
    expect(() => new Function(DASHBOARD_PANELS_MEDIA_JS)).not.toThrow();
    expect(() => new Function(DASHBOARD_PANELS_PUBLISH_JS)).not.toThrow();
  });

  it("defines semantic light/dark tokens and does not leave component color literals outside the token layer", () => {
    expect(DASHBOARD_CSS).toContain("color-scheme: light dark");
    expect(DASHBOARD_CSS).toContain("@media (prefers-color-scheme: dark)");
    for (const token of [
      "--color-page",
      "--color-surface",
      "--color-surface-elevated",
      "--color-text-primary",
      "--color-text-muted",
      "--color-border",
      "--color-accent",
      "--color-focus",
      "--color-success-bg",
      "--color-warning-bg",
      "--color-error-bg",
      "--color-accent-overlay",
    ]) {
      expect(DASHBOARD_CSS).toContain(token);
    }

    const rawColorOutsideTokenLayer = DASHBOARD_CSS
      .split("\n")
      .filter((line) => /#[0-9a-f]{3,8}|rgba?\(/i.test(line))
      .filter((line) => !line.includes("--color-"));
    expect(rawColorOutsideTokenLayer).toEqual([]);

    for (const source of [DASHBOARD_PANELS_COVERAGE_JS, DASHBOARD_PANELS_MEDIA_JS, DASHBOARD_PANELS_PUBLISH_JS]) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    }
  });
});
