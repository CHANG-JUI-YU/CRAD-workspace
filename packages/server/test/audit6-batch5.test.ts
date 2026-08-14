import { describe, expect, it, vi } from "vitest";
import { DASHBOARD_PANELS_PUBLISH_JS } from "../src/dashboard-panels-publish.js";

type ListenerMap = Map<string, Array<() => void>>;

class FakeElement {
  tagName: string;
  id = "";
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  title = "";
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  private attrs = new Map<string, string>();
  private listeners: ListenerMap = new Map();
  private classes = new Set<string>();
  readonly scrollIntoView = vi.fn();
  readonly focus = vi.fn();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: Array<FakeElement | { nodeType: number; textContent: string }>): void {
    for (const node of nodes) {
      if (node instanceof FakeElement) this.children.push(node);
    }
  }

  appendChild(node: FakeElement | { nodeType: number; textContent: string }): void {
    this.append(node);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  addEventListener(event: string, handler: () => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  click(): void {
    const list = this.listeners.get("click") ?? [];
    for (const handler of list) handler();
  }

  readonly classList = {
    add: (value: string): void => { this.classes.add(value); },
    remove: (value: string): void => { this.classes.delete(value); },
    contains: (value: string): boolean => this.classes.has(value),
  };
}

class FakeDocument {
  elements: FakeElement[] = [];

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(tagName);
    this.elements.push(element);
    return element;
  }

  createTextNode(text: string): { nodeType: number; textContent: string } {
    return { nodeType: 3, textContent: text };
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.find((element) => element.id === id) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const match = /^\[([a-z-]+)\]$/.exec(selector);
    if (match === null) return [];
    const attribute = match[1]!;
    return this.elements.filter((element) => element.getAttribute(attribute) !== null);
  }
}

function extractFunctions(source: string, names: string[]): string {
  const parts: string[] = [];
  for (const name of names) {
    const pattern = `function ${name}(`;
    const start = source.indexOf(pattern);
    if (start < 0) throw new Error(`Missing function ${name} in panel source`);
    const open = source.indexOf("{", start);
    if (open < 0) throw new Error(`Missing body for function ${name}`);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) throw new Error(`Unbalanced braces for function ${name}`);
    parts.push(source.slice(start, end + 1));
  }
  return parts.join("\n");
}

interface Harness {
  document: FakeDocument;
  render: (structured: unknown) => void;
  reveal: (target: unknown, code?: string) => void;
  switchPanel: (panel: string) => void;
  readinessList: FakeElement;
}

function makeHarness(): Harness {  const document = new FakeDocument();
  const readinessList = document.createElement("div");
  readinessList.id = "readiness-list";
  const readinessMessage = document.createElement("div");
  readinessMessage.id = "readiness-message";
  const byId = (id: string): FakeElement | null => document.getElementById(id);

  const code = `${extractFunctions(DASHBOARD_PANELS_PUBLISH_JS, [
    "panelAnchorId",
    "coverageCellId",
    "findDiagnosticObjectElement",
    "clearDiagnosticHighlight",
    "reducedMotion",
    "switchPanel",
    "revealDiagnosticTarget",
    "navigateDiagnosticTarget",
    "makeDiagnosticNavGroup",
    "renderPublishDiagnostics",
  ])}
      var lastDiagnosticHighlight = null;`;

  const windowStub = { matchMedia: (): { matches: boolean } => ({ matches: false }) };
  const isRecord = (value: unknown): boolean =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const firstString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) return value;
    }
    return undefined;
  };
  const statusClass = (status: string): string =>
    ["completed", "complete", "ready", "published"].includes(status) ? "ready" : "";
  const setAreaError = (): void => undefined;

  const factory = new Function(
    "document",
    "window",
    "byId",
    "isRecord",
    "firstString",
    "statusClass",
    "setAreaError",
    `${code}
      return {
        renderPublishDiagnostics: renderPublishDiagnostics,
        revealDiagnosticTarget: revealDiagnosticTarget,
        navigateDiagnosticTarget: navigateDiagnosticTarget,
        switchPanel: switchPanel,
        coverageCellId: coverageCellId
      };`,
  ) as (document: FakeDocument, window: typeof windowStub, byId: (id: string) => FakeElement | null, isRecord: (value: unknown) => boolean, firstString: (record: Record<string, unknown>, keys: string[]) => string | undefined, statusClass: (status: string) => string, setAreaError: () => void) => {
    renderPublishDiagnostics: (structured: unknown) => void;
    revealDiagnosticTarget: (target: unknown, code?: string) => void;
    navigateDiagnosticTarget: (target: unknown) => void;
    switchPanel: (panel: string) => void;
  };

  const api = factory(document, windowStub, byId, isRecord, firstString, statusClass, setAreaError);
  return {
    document,
    render: api.renderPublishDiagnostics,
    reveal: api.revealDiagnosticTarget,
    switchPanel: api.switchPanel,
    readinessList,
  };
}

function buttonsIn(element: FakeElement): FakeElement[] {
  const result: FakeElement[] = [];
  for (const child of element.children) {
    if (child.tagName === "button") result.push(child);
    result.push(...buttonsIn(child));
  }
  return result;
}

function navIn(element: FakeElement): { prev: FakeElement; next: FakeElement; count: FakeElement } {
  const group = element.children.find((child) => child.className === "diagnostic-nav");
  if (group === undefined) throw new Error("diagnostic-nav group not found");
  const buttons = group.children.filter((child) => child.tagName === "button");
  const count = group.children.find((child) => child.className === "diagnostic-nav-count");
  if (buttons.length < 2 || count === undefined) throw new Error("nav group incomplete");
  return { prev: buttons[0]!, next: buttons[1]!, count };
}

function highlighted(document: FakeDocument): FakeElement[] {
  return document.elements.filter((element) => element.classList.contains("diagnostic-highlight"));
}

describe("Audit 6 Batch 5 - Server Publish Diagnostics Navigation", () => {
  it("#47 three diagnostic rows navigate to their own targets (no final-row closure)", () => {
    const harness = makeHarness();
    const source = harness.document.createElement("div");
    source.setAttribute("data-object-kind", "source");
    source.setAttribute("data-object-id", "source-1");
    const fact = harness.document.createElement("div");
    fact.setAttribute("data-object-kind", "fact");
    fact.setAttribute("data-object-id", "fact-1");
    const artifact = harness.document.createElement("div");
    artifact.setAttribute("data-object-kind", "artifact");
    artifact.setAttribute("data-object-id", "character-alpha");

    harness.render({
      has_unknown: false,
      rows: [
        { code: "SOURCE_RESEARCH_NOT_INGESTED", severity: "error", message: "m1", affected: [], next_action: "a", targets: [{ panel: "sources", kind: "source", id: "source-1" }] },
        { code: "FACT_REVIEW_NEEDS_EVIDENCE", severity: "error", message: "m2", affected: [], next_action: "b", targets: [{ panel: "facts", kind: "fact", id: "fact-1" }] },
        { code: "ARTIFACT_REVIEW_REQUIRED", severity: "error", message: "m3", affected: [], next_action: "c", targets: [{ panel: "artifacts", kind: "artifact", id: "character-alpha" }] },
      ],
    });

    const buttons = buttonsIn(harness.readinessList);
    expect(buttons).toHaveLength(3);
    buttons[0]!.click();
    expect(source.classList.contains("diagnostic-highlight")).toBe(true);
    expect(source.getAttribute("data-diagnostic-code")).toBe("SOURCE_RESEARCH_NOT_INGESTED");
    buttons[1]!.click();
    expect(fact.classList.contains("diagnostic-highlight")).toBe(true);
    expect(source.classList.contains("diagnostic-highlight")).toBe(false);
    buttons[2]!.click();
    expect(artifact.classList.contains("diagnostic-highlight")).toBe(true);
    expect(fact.classList.contains("diagnostic-highlight")).toBe(false);
  });

  it("navigates through three affected objects with counting and wraps around", () => {
    const harness = makeHarness();
    const cells = ["req.identity", "req.personality", "req.values"].map((req) => {
      const cell = harness.document.createElement("div");
      cell.id = `coverage-cell-alpha-${req.split(".").join("-")}`;
      return cell;
    });
    harness.render({
      has_unknown: false,
      rows: [
        {
          code: "COVERAGE_RESOLUTION_REQUIRED",
          severity: "error",
          message: "m",
          affected: [],
          next_action: "a",
          targets: cells.map((_, index) => ({
            panel: "coverage",
            kind: "coverage_cell",
            character_id: "alpha",
            requirement_id: ["req.identity", "req.personality", "req.values"][index],
          })),
        },
      ],
    });

    const nav = navIn(harness.readinessList.children.find((child) => child.className === "readiness-row")!);
    expect(nav.count.textContent).toBe("1 / 3");
    nav.next.click();
    expect(nav.count.textContent).toBe("2 / 3");
    expect(cells[1]!.classList.contains("diagnostic-highlight")).toBe(true);
    expect(cells[0]!.classList.contains("diagnostic-highlight")).toBe(false);
    nav.next.click();
    expect(nav.count.textContent).toBe("3 / 3");
    expect(cells[2]!.classList.contains("diagnostic-highlight")).toBe(true);
    nav.next.click();
    expect(nav.count.textContent).toBe("1 / 3");
    expect(cells[0]!.classList.contains("diagnostic-highlight")).toBe(true);
    nav.prev.click();
    expect(nav.count.textContent).toBe("3 / 3");
    expect(cells[2]!.classList.contains("diagnostic-highlight")).toBe(true);
  });

  it("navigation indexes of two diagnostic rows are independent", () => {
    const harness = makeHarness();
    const alphaCell = harness.document.createElement("div");
    alphaCell.id = "coverage-cell-alpha-req-identity";
    const betaCell = harness.document.createElement("div");
    betaCell.id = "coverage-cell-beta-req-identity";
    const worldCell = harness.document.createElement("div");
    worldCell.id = "coverage-cell-world-req-world_context";

    harness.render({
      has_unknown: false,
      rows: [
        {
          code: "COVERAGE_RESOLUTION_REQUIRED",
          severity: "error",
          message: "m1",
          affected: [],
          next_action: "a",
          targets: [
            { panel: "coverage", kind: "coverage_cell", character_id: "alpha", requirement_id: "req.identity" },
            { panel: "coverage", kind: "coverage_cell", character_id: "beta", requirement_id: "req.identity" },
          ],
        },
        {
          code: "COVERAGE_RESOLUTION_REQUIRED",
          severity: "error",
          message: "m2",
          affected: [],
          next_action: "b",
          targets: [
            { panel: "coverage", kind: "coverage_cell", requirement_id: "req.world_context" },
            { panel: "coverage", kind: "coverage_cell", character_id: "alpha", requirement_id: "req.identity" },
          ],
        },
      ],
    });

    const rows = harness.readinessList.children.filter((child) => child.className === "readiness-row");
    expect(rows).toHaveLength(2);
    const row1 = navIn(rows[0]!);
    const row2 = navIn(rows[1]!);
    expect(row1.count.textContent).toBe("1 / 2");
    expect(row2.count.textContent).toBe("1 / 2");
    row1.next.click();
    expect(row1.count.textContent).toBe("2 / 2");
    expect(row2.count.textContent).toBe("1 / 2");
    expect(betaCell.classList.contains("diagnostic-highlight")).toBe(true);
    row2.next.click();
    expect(row2.count.textContent).toBe("2 / 2");
    expect(row1.count.textContent).toBe("2 / 2");
    expect(alphaCell.classList.contains("diagnostic-highlight")).toBe(true);
    expect(betaCell.classList.contains("diagnostic-highlight")).toBe(false);
  });

  it("locates character and world coverage cells by cell identity", () => {
    const harness = makeHarness();
    const alphaCell = harness.document.createElement("div");
    alphaCell.id = "coverage-cell-alpha-req-identity";
    alphaCell.setAttribute("data-cell-id", "alpha__req.identity");
    const worldCell = harness.document.createElement("div");
    worldCell.id = "coverage-cell-world-req-world_context";
    worldCell.setAttribute("data-cell-id", "world__req.world_context");

    harness.reveal({ panel: "coverage", kind: "coverage_cell", character_id: "alpha", requirement_id: "req.identity" }, "COVERAGE_RESOLUTION_REQUIRED");
    expect(alphaCell.classList.contains("diagnostic-highlight")).toBe(true);
    expect(alphaCell.getAttribute("data-diagnostic-code")).toBe("COVERAGE_RESOLUTION_REQUIRED");
    harness.reveal({ panel: "coverage", kind: "coverage_cell", requirement_id: "req.world_context" }, "COVERAGE_RESOLUTION_REQUIRED");
    expect(worldCell.classList.contains("diagnostic-highlight")).toBe(true);
    expect(alphaCell.classList.contains("diagnostic-highlight")).toBe(false);
    expect(worldCell.scrollIntoView).toHaveBeenCalled();
    expect(worldCell.focus).toHaveBeenCalled();
  });

  it("locates source, fact and artifact objects by stable data attributes", () => {
    const harness = makeHarness();
    const sourceRow = harness.document.createElement("div");
    sourceRow.setAttribute("data-object-kind", "source");
    sourceRow.setAttribute("data-object-id", "source-42");
    const factRow = harness.document.createElement("div");
    factRow.setAttribute("data-object-kind", "fact");
    factRow.setAttribute("data-object-id", "fact-77");
    const artifactRow = harness.document.createElement("div");
    artifactRow.setAttribute("data-object-kind", "artifact");
    artifactRow.setAttribute("data-object-id", "character-alpha");

    harness.reveal({ panel: "sources", kind: "source", id: "source-42" }, "SOURCE_RESEARCH_NOT_INGESTED");
    expect(sourceRow.classList.contains("diagnostic-highlight")).toBe(true);
    harness.reveal({ panel: "facts", kind: "fact", id: "fact-77" }, "FACT_REVIEW_NEEDS_EVIDENCE");
    expect(factRow.classList.contains("diagnostic-highlight")).toBe(true);
    expect(sourceRow.classList.contains("diagnostic-highlight")).toBe(false);
    harness.reveal({ panel: "artifacts", kind: "artifact", id: "character-alpha" }, "ARTIFACT_REVIEW_REQUIRED");
    expect(artifactRow.classList.contains("diagnostic-highlight")).toBe(true);
  });

  it("ids with dots, slashes, colons and spaces are matched safely", () => {
    const harness = makeHarness();
    const tricky = harness.document.createElement("div");
    tricky.setAttribute("data-object-kind", "artifact");
    tricky.setAttribute("data-object-id", "角色/主線:卷1.x 完整");
    harness.reveal({ panel: "artifacts", kind: "artifact", id: "角色/主線:卷1.x 完整" }, "BLUEPRINT_BINDING_STALE");
    expect(tricky.classList.contains("diagnostic-highlight")).toBe(true);
    expect(tricky.getAttribute("data-diagnostic-code")).toBe("BLUEPRINT_BINDING_STALE");
  });

  it("falls back to the target panel when the exact object does not exist", () => {
    const harness = makeHarness();
    const factList = harness.document.createElement("div");
    factList.id = "fact-list";
    harness.reveal({ panel: "facts", kind: "fact", id: "ghost-fact" }, "FACT_REVIEW_NEEDS_EVIDENCE");
    expect(factList.classList.contains("diagnostic-highlight")).toBe(true);
    expect(factList.scrollIntoView).toHaveBeenCalled();
  });

  it("falls back to readiness-list when panel is unknown and never throws", () => {
    const harness = makeHarness();
    expect(() => harness.reveal({ panel: "mystery-panel" }, "MYSTERY_CODE")).not.toThrow();
    expect(harness.readinessList.classList.contains("diagnostic-highlight")).toBe(true);
    expect(harness.readinessList.getAttribute("data-diagnostic-code")).toBe("MYSTERY_CODE");
  });

  it("unknown diagnostic rows render a readiness target button that navigates without throwing", () => {
    const harness = makeHarness();
    expect(() => {
      harness.render({
        has_unknown: true,
        rows: [{ code: "MYSTERY_CODE", severity: "error", message: "mystery", affected: [], next_action: "在 Readiness 面板檢視診斷", targets: [{ panel: "readiness" }], target: { panel: "readiness" } }],
      });
    }).not.toThrow();
    const buttons = buttonsIn(harness.readinessList);
    expect(buttons.length).toBeGreaterThan(0);
    expect(() => buttons[0]!.click()).not.toThrow();
    expect(harness.readinessList.classList.contains("diagnostic-highlight")).toBe(true);
  });

  it("keeps data-object identity attributes on rendered rows for future navigation", () => {
    expect(DASHBOARD_PANELS_PUBLISH_JS).toContain('setAttribute("data-object-kind", "artifact")');
    expect(DASHBOARD_PANELS_PUBLISH_JS).toContain('setAttribute("data-object-id", artifactId)');
    expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("makeDiagnosticNavGroup");
    expect(DASHBOARD_PANELS_PUBLISH_JS).toContain("revealDiagnosticTarget");
    expect(DASHBOARD_PANELS_PUBLISH_JS).not.toContain("go.addEventListener(\"click\", function () { navigateDiagnosticTarget(row.target); });");
  });
});
