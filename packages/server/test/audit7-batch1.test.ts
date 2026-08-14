import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkspaceServer } from "../src/index.js";
import { DASHBOARD_PANELS_COVERAGE_JS } from "../src/dashboard-panels-coverage.js";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type OperationRecord,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";

const now = "2026-08-14T00:00:00.000Z";

function sourceRecord(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `candidate-${id}`,
    title: id,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: now,
  };
}

function precheck(projectId: string): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      title: "Test Blueprint",
      source_adaptation: true,
      characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }],
      primary_character_id: "alpha",
      world: { enabled: false },
      relationships: { enabled: false },
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    status: "recorded",
    checks: [
      { subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({ schema_version: 1, title: "Test Blueprint", source_adaptation: true }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function characterArtifact(): ArtifactRecord {
  return {
    id: "character-alpha",
    key: "character:alpha",
    kind: "character",
    name: "Alpha",
    content: JSON.stringify({ document: { schema_version: 1, id: "alpha", title: "Alpha", text: "Alpha is calm." } }),
    media_type: "text/markdown",
    content_hash: contentHash("character-alpha"),
    revision: contentHash("character-alpha"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(): FactRecord {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    status: "accepted",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "director",
  };
}

function reviewRun(): FactReviewRunRecord {
  return {
    id: "run-1",
    schema_version: 1,
    status: "completed",
    candidate_occurrence_ids: ["occ-1"],
    candidate_set_revision: "cset-1",
    policy_revision: "policy-1",
    created_by: "reviewer",
    created_at: now,
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
  };
}

function decision(): FactReviewDecisionRecord {
  return {
    id: "dec-1",
    schema_version: 1,
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted",
    resulting_fact_revision: 1,
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    candidate_revision: "cand-1",
    expected_projection_revision: contentHash("projection-1"),
    created_at: now,
  };
}

function operation(id: string, kind: string): OperationRecord {
  return {
    id,
    kind,
    request: kind,
    actor: "director",
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  } as OperationRecord;
}

function readyState(projectId: string): ProjectState {
  const state = createProjectState(projectId, "Batch7 Server");
  return {
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact()],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  };
}

async function startServer(projectId = "batch7-server") {
  const repository = new MemoryProjectRepository(projectId, readyState(projectId));
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { runtime, repository, server, baseUrl };
}

describe("Audit 7 Batch 1 - Server Coverage Center Eligibility", () => {
  let server: ReturnType<typeof createWorkspaceServer>;
  let baseUrl: string;
  let runtime: WorkspaceRuntime;
  let repository: MemoryProjectRepository;

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("serves an actionable formal assessment with an enabled wide-research CTA", async () => {
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
    runtime = started.runtime;
    repository = started.repository;
    await runtime.coverageAssessment("formal");

    const response = await fetch(`${baseUrl}/workspace/dashboard/coverage-center`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matrix: {
        assessment: { id: string; revision: string; pass: string; formal: boolean; current: boolean; fresh: boolean; actionable: boolean };
        assessment_eligibility: { actionable: boolean; formal: boolean; fresh: boolean; current: boolean };
        assessment_wide_research: { enabled: boolean; target_count: number };
      };
    };
    expect(body.matrix.assessment.actionable).toBe(true);
    expect(body.matrix.assessment.formal).toBe(true);
    expect(body.matrix.assessment.current).toBe(true);
    expect(body.matrix.assessment.fresh).toBe(true);
    expect(body.matrix.assessment_eligibility.actionable).toBe(true);
    expect(body.matrix.assessment_wide_research.enabled).toBe(true);
    expect(body.matrix.assessment_wide_research.target_count).toBeGreaterThan(0);
  });

  it("marks a fresh initial assessment as non-actionable with a stable reason", async () => {
    const started = await startServer("batch7-server-initial");
    server = started.server;
    baseUrl = started.baseUrl;
    runtime = started.runtime;
    repository = started.repository;
    await runtime.coverageAssessment("initial");

    const response = await fetch(`${baseUrl}/workspace/dashboard/coverage-center`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matrix: {
        assessment: { pass: string; fresh: boolean; actionable: boolean; formal: boolean; eligibility_reason_code?: string };
        assessment_eligibility: { fresh: boolean; formal: boolean; actionable: boolean; reason_code?: string };
        assessment_wide_research: { enabled: boolean; target_count: number; disabled_reason?: string };
      };
    };
    expect(body.matrix.assessment.pass).toBe("initial");
    expect(body.matrix.assessment.fresh).toBe(true);
    expect(body.matrix.assessment.formal).toBe(false);
    expect(body.matrix.assessment.actionable).toBe(false);
    expect(body.matrix.assessment.eligibility_reason_code).toBe("COVERAGE_ASSESSMENT_NOT_FORMAL");
    expect(body.matrix.assessment_eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_NOT_FORMAL");
    expect(body.matrix.assessment_wide_research.enabled).toBe(false);
    expect(body.matrix.assessment_wide_research.target_count).toBe(0);
    expect(body.matrix.assessment_wide_research.disabled_reason).toBeTruthy();
  });

  it("disables the wide-research CTA for a stale assessment", async () => {
    const started = await startServer("batch7-server-stale");
    server = started.server;
    baseUrl = started.baseUrl;
    runtime = started.runtime;
    repository = started.repository;
    await runtime.coverageAssessment("formal");

    const state = await repository.read();
    const changedSource = sourceRecord("source-1", "Alpha is serene and calm.");
    await repository.commit(state.revision, (current) => ({ ...current, sources: [changedSource] }));

    const response = await fetch(`${baseUrl}/workspace/dashboard/coverage-center`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matrix: {
        assessment_eligibility: { fresh: boolean; actionable: boolean; reason_code?: string };
        assessment_wide_research: { enabled: boolean; target_count: number; disabled_reason?: string };
      };
    };
    expect(body.matrix.assessment_eligibility.fresh).toBe(false);
    expect(body.matrix.assessment_eligibility.actionable).toBe(false);
    expect(body.matrix.assessment_eligibility.reason_code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(body.matrix.assessment_wide_research.enabled).toBe(false);
    expect(body.matrix.assessment_wide_research.target_count).toBe(0);
    expect(body.matrix.assessment_wide_research.disabled_reason).toBeTruthy();
  });

  it("includes the Coverage Center UI with safe DOM usage and no regression", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("全量缺口研究");
    expect(html).toContain("/workspace/dashboard/coverage-center");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("/workspace/dashboard/coverage");
  });
});

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<() => void>>();
  classes = new Set<string>();
  disabled = false;
  title = "";
  style: Record<string, string> = {};
  textContent = "";
  parent: FakeElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };

  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attrs.delete(name);
  }

  addEventListener(name: string, handler: () => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(handler);
    this.listeners.set(name, list);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]) {
    nodes.forEach((node) => this.appendChild(node));
  }

  remove() {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this);
      if (idx >= 0) this.parent.children.splice(idx, 1);
    }
  }

  click() {
    (this.listeners.get("click") ?? []).forEach((handler) => handler());
  }

  scrollIntoView() {}
  focus() {}

  getElementsByTagName(tagName: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      if (node.tagName === tagName) out.push(node);
      node.children.forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }

  findByText(text: string): FakeElement | undefined {
    let found: FakeElement | undefined;
    const walk = (node: FakeElement) => {
      if (found) return;
      if (node.textContent.includes(text)) {
        found = node;
        return;
      }
      node.children.forEach(walk);
    };
    this.children.forEach(walk);
    return found;
  }
}

function extractFunctions(source: string, names: string[]): string {
  const chunks: string[] = [];
  for (const name of names) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`function ${name} not found`);
    let depth = 0;
    let end = -1;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    chunks.push(source.slice(start, end));
  }
  return chunks.join("\n");
}

describe("Audit 7 Batch 1 - Coverage Center CTA rendering behavior", () => {
  it("renders an enabled wide-research button with the authoritative count", () => {
    const code = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "renderCoverageCenter",
      "coverageButton",
      "setCoverageNotice",
      "coverageCenterCellElement",
      "renderCellActionButton",
      "coverageCellTitle",
    ]);

    const coverageCenter = new FakeElement("div");
    const documentStub = {
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const el = new FakeElement("span");
        el.textContent = text;
        return el;
      },
    };
    const byIdStub = (id: string) => (id === "coverage-center" ? coverageCenter : null);
    const startCoverageResearch = () => {};
    const statusClassStub = () => "ready";
    const coverageCellIdStub = () => "coverage-cell-w";
    const switchPanelStub = () => {};

    const fn = new Function(
      "document",
      "byId",
      "startCoverageResearch",
      "statusClass",
      "coverageCellId",
      "switchPanel",
      code + "\nreturn { renderCoverageCenter };",
    ) as (document: unknown, byId: unknown, s: unknown, c: unknown, cid: unknown, sp: unknown) => { renderCoverageCenter: (payload: unknown) => void };

    const api = fn(documentStub, byIdStub, startCoverageResearch, statusClassStub, coverageCellIdStub, switchPanelStub);

    api.renderCoverageCenter({
      matrix: {
        assessment: { id: "assess-1", revision: "r1", pass: "formal", fresh: true, current: true, formal: true, actionable: true },
        requirement_set: { id: "set-1", revision: "set-rev-1" },
        stale_components: [],
        cells: [],
        assessment_eligibility: { actionable: true },
        assessment_wide_research: { enabled: true, target_count: 3 },
      },
      monitor: { tasks: [] },
    });

    const button = coverageCenter.children[1]?.children[0];
    expect(button).toBeDefined();
    expect(button?.textContent).toContain("(3");
    expect(button?.disabled).toBe(false);
  });

  it("renders a disabled wide-research button with the typed reason", () => {
    const code = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "renderCoverageCenter",
      "coverageButton",
      "setCoverageNotice",
      "coverageCenterCellElement",
      "renderCellActionButton",
      "coverageCellTitle",
    ]);

    const coverageCenter = new FakeElement("div");
    const documentStub = {
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => {
        const el = new FakeElement("span");
        el.textContent = text;
        return el;
      },
    };
    const byIdStub = (id: string) => (id === "coverage-center" ? coverageCenter : null);
    const startCoverageResearch = () => {};
    const statusClassStub = () => "ready";
    const coverageCellIdStub = () => "coverage-cell-w";
    const switchPanelStub = () => {};

    const fn = new Function(
      "document",
      "byId",
      "startCoverageResearch",
      "statusClass",
      "coverageCellId",
      "switchPanel",
      code + "\nreturn { renderCoverageCenter };",
    ) as (document: unknown, byId: unknown, s: unknown, c: unknown, cid: unknown, sp: unknown) => { renderCoverageCenter: (payload: unknown) => void };

    const api = fn(documentStub, byIdStub, startCoverageResearch, statusClassStub, coverageCellIdStub, switchPanelStub);

    api.renderCoverageCenter({
      matrix: {
        assessment: { id: "assess-1", revision: "r1", pass: "initial", fresh: true, current: true, formal: false, actionable: false },
        requirement_set: { id: "set-1", revision: "set-rev-1" },
        stale_components: [],
        cells: [],
        assessment_eligibility: { actionable: false, reason_code: "COVERAGE_ASSESSMENT_NOT_FORMAL" },
        assessment_wide_research: { enabled: false, target_count: 0, disabled_reason: "尚未具備 formal mutation 資格" },
      },
      monitor: { tasks: [] },
    });

    const button = coverageCenter.children[1]?.children[0];
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(true);
    expect(button?.title).toContain("尚未具備 formal mutation 資格");
    const reasonSpan = coverageCenter.children[1]?.children[1];
    expect(reasonSpan?.textContent).toContain("尚未具備 formal mutation 資格");
  });
});
