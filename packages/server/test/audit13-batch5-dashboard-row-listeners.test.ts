import { describe, expect, it, vi } from "vitest";
import { dashboard } from "../src/dashboard.js";
import { scopeDashboardRowBindings } from "../src/dashboard-row-scope.js";

type TestElement = {
  [key: string]: any;
  tagName: string;
  className: string;
  textContent: string;
  value: string;
  hidden: boolean;
  children: TestElement[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<(...args: any[]) => any>>;
  append: (...children: TestElement[]) => void;
  appendChild: (child: TestElement) => TestElement;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, handler: (...args: any[]) => any) => void;
};

function createElement(tagName: string): TestElement {
  const children: TestElement[] = [];
  const attrs = new Map<string, string>();
  const listeners = new Map<string, Array<(...args: any[]) => any>>();
  const element: TestElement = {
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    value: "",
    hidden: false,
    children,
    attrs,
    listeners,
    append: (...nodes) => {
      children.push(...nodes);
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    setAttribute: (name, value) => {
      attrs.set(name, value);
      if (name === "class") element.className = value;
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    addEventListener: (type, handler) => {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
  };
  return element;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown, keys: string[]): string {
  if (!isRecord(value)) return "";
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return "";
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
  const factory = new Function(
    ...keys,
    `${names.map((name) => functions.get(name) ?? "").join("\n")}\nreturn { ${names.join(", ")} };`,
  );
  return factory(...keys.map((key) => context[key])) as Record<string, any>;
}

function button(row: TestElement, label: string): TestElement {
  const found = row.children.find((child) => child.tagName === "BUTTON" && child.textContent === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

function click(element: TestElement): unknown {
  const handler = element.listeners.get("click")?.[0];
  if (!handler) throw new Error(`click listener missing: ${element.textContent}`);
  return handler();
}

describe("Audit 13 #206 Dashboard row listener identity", () => {
  it("keeps image select and remove actions bound to the clicked row", async () => {
    const source = dashboard();
    const functions = extractFunctions(source, ["removeImage", "renderImageList"]);
    const target = createElement("div");
    const elements = new Map([["image-list", target]]);
    const postJson = vi.fn(async () => ({}));
    const loadDashboardData = vi.fn(async () => ({}));
    const postImageRemove = vi.fn();
    const pending: Promise<unknown>[] = [];
    const runTask = vi.fn((_label: string, task: () => Promise<unknown>) => {
      const promise = Promise.resolve(task());
      pending.push(promise);
      return promise;
    });

    const api = execute(functions, ["removeImage", "renderImageList"], {
      document: { createElement },
      window: { setTimeout: vi.fn() },
      byId: (id: string) => elements.get(id),
      isRecord,
      firstString,
      renderImageUploadOptions: vi.fn(),
      coverReasonText: vi.fn(),
      setProtectedImageSource: vi.fn(),
      runTask,
      postJson,
      loadDashboardData,
      postImageRemove,
    });

    api.renderImageList([
      { id: "image-001", width: 100, height: 100, source: "src-1", license: "lic-1" },
      { id: "image-002", width: 200, height: 200, source: "src-2", license: "lic-2" },
    ], [], undefined, undefined);

    expect(target.children).toHaveLength(2);
    const firstRow = target.children[0];
    click(button(firstRow, "設為目前封面"));
    await Promise.all(pending);
    expect(postJson).toHaveBeenCalledWith("/workspace/cover/select", { image_id: "image-001" });
    expect(postJson).not.toHaveBeenCalledWith("/workspace/cover/select", { image_id: "image-002" });

    const remove = button(firstRow, "移除");
    click(remove);
    click(remove);
    expect(postImageRemove).toHaveBeenCalledWith("image-001");
    expect(postImageRemove).not.toHaveBeenCalledWith("image-002");
  });

  it("keeps all five artifact actions bound to their row and revision set", () => {
    const source = dashboard();
    const functions = extractFunctions(source, ["renderArtifactList", "makeActionButton"]);
    const artifactList = createElement("div");
    const artifactMessage = createElement("div");
    const blueprintJson = createElement("pre");
    const elements = new Map<string, TestElement>([
      ["artifact-list", artifactList],
      ["artifact-message", artifactMessage],
      ["blueprint-json", blueprintJson],
    ]);
    const toggleArtifactRaw = vi.fn();
    const toggleArtifactDiff = vi.fn();
    const submitArtifactForReview = vi.fn();
    const downloadArtifact = vi.fn();
    const toggleArtifactLineage = vi.fn();

    const api = execute(functions, ["renderArtifactList", "makeActionButton"], {
      document: { createElement },
      byId: (id: string) => elements.get(id),
      isRecord,
      firstString,
      statusClass: (status: string) => status,
      jsonText: JSON.stringify,
      toggleArtifactRaw,
      toggleArtifactDiff,
      submitArtifactForReview,
      downloadArtifact,
      toggleArtifactLineage,
    });

    const previousOne = { id: "artifact-001-old", name: "artifact-one", revision: "rev-001-old", kind: "text", status: "ready" };
    const currentOne = { id: "artifact-001", name: "artifact-one", revision: "rev-001", kind: "text", status: "ready" };
    const currentTwo = { id: "artifact-002", name: "artifact-two", revision: "rev-002", kind: "text", status: "ready" };
    const revisionsOne = [previousOne, currentOne];
    const revisionsTwo = [currentTwo];

    api.renderArtifactList({
      artifact_groups: [
        { key: "one", current: currentOne, revisions: revisionsOne },
        { key: "two", current: currentTwo, revisions: revisionsTwo },
      ],
      reviews: [],
      total: 3,
    });

    expect(artifactList.children).toHaveLength(2);
    const firstRow = artifactList.children[0];
    const actions = firstRow.children.find((child) => child.className === "artifact-actions");
    expect(actions).toBeDefined();
    const actionButtons = actions!.children;
    expect(actionButtons.map((item) => item.textContent)).toEqual([
      "原始內容",
      "與前一版差異",
      "送審",
      "下載",
      "覆蓋關聯",
    ]);
    for (const action of actionButtons) click(action);

    expect(toggleArtifactRaw).toHaveBeenCalledWith(firstRow, currentOne);
    expect(toggleArtifactDiff).toHaveBeenCalledWith(firstRow, currentOne, revisionsOne);
    expect(submitArtifactForReview).toHaveBeenCalledWith("artifact-one");
    expect(downloadArtifact).toHaveBeenCalledWith(currentOne);
    expect(toggleArtifactLineage).toHaveBeenCalledWith(firstRow, currentOne);
    expect(downloadArtifact).not.toHaveBeenCalledWith(currentTwo);
  });

  it("keeps Fact Review candidate identity and controls bound to the clicked row", () => {
    const source = dashboard();
    const functions = extractFunctions(source, ["renderEvidence"]);
    const evidenceList = createElement("div");
    const evidenceMessage = createElement("div");
    const elements = new Map<string, TestElement>([
      ["evidence-list", evidenceList],
      ["evidence-message", evidenceMessage],
    ]);
    const submitFactDecision = vi.fn();
    const run = { id: "run-001" };

    const api = execute(functions, ["renderEvidence"], {
      document: { createElement },
      byId: (id: string) => elements.get(id),
      isRecord,
      firstString,
      evidenceContextBlock: vi.fn(),
      submitFactDecision,
    });

    api.renderEvidence({
      run,
      projection_revision: "projection-001",
      candidates: [
        { candidate_occurrence_id: "occ-001", statement: "statement one", evidence_context: [] },
        { candidate_occurrence_id: "occ-002", statement: "statement two", evidence_context: [] },
      ],
    });

    expect(evidenceList.children).toHaveLength(2);
    const firstRow = evidenceList.children[0];
    const firstSelect = firstRow.children.find((child) => child.tagName === "SELECT")!;
    const firstReason = firstRow.children.find((child) => child.tagName === "INPUT")!;
    const firstSubmit = firstRow.children.find((child) => child.tagName === "BUTTON")!;
    firstSelect.value = "reject";
    firstReason.value = "first-row reason";
    click(firstSubmit);

    expect(submitFactDecision).toHaveBeenCalledWith(
      run,
      "occ-001",
      "statement one",
      firstSelect,
      firstReason,
      "/workspace/fact/review/batch",
    );
    expect(firstSelect.value).toBe("reject");
    expect(firstReason.value).toBe("first-row reason");
    expect(submitFactDecision).not.toHaveBeenCalledWith(
      expect.anything(),
      "occ-002",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("fails closed when a guarded row binding silently drifts", () => {
    const source = `      function renderImageList() {\n        var imageId = "first";\n      }\n\n      function after() {}`;
    expect(scopeDashboardRowBindings(source, [
      { functionName: "renderImageList", bindings: ["imageId"] },
    ])).toContain('let imageId = "first"');
    expect(() => scopeDashboardRowBindings(source, [
      { functionName: "renderImageList", bindings: ["missing"] },
    ])).toThrow(/expected once, found 0/);
  });
});
