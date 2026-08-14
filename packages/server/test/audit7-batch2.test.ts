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
  const state = createProjectState(projectId, "Batch7-2 Server");
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

async function startServer(projectId = "batch7-2-server") {
  const repository = new MemoryProjectRepository(projectId, readyState(projectId));
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { runtime, repository, server, baseUrl };
}

describe("Audit 7 Batch 2 - Server REST API Verification", () => {
  let server: ReturnType<typeof createWorkspaceServer>;
  let baseUrl: string;
  let runtime: WorkspaceRuntime;
  let repository: MemoryProjectRepository;

  beforeAll(async () => {
    const started = await startServer();
    server = started.server;
    baseUrl = started.baseUrl;
    runtime = started.runtime;
    repository = started.repository;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("POST /workspace/coverage/research/start rejects non-missing explicit requirement scope", async () => {
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const response = await fetch(`${baseUrl}/workspace/coverage/research/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        scope: {
          kind: "requirements",
          targets: [{ requirement_id: "req.personality", character_id: "alpha" }],
        },
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("COVERAGE_RESEARCH_TARGET_INELIGIBLE");
  });

  it("POST /workspace/coverage/resolution/confirm rejects duplicate confirmation", async () => {
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };
    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    const firstRes = await fetch(`${baseUrl}/workspace/coverage/resolution/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        requirement_id: missingItem!.requirement_id,
        character_id: "alpha",
        action: "user_supplement",
        choice: "提供補充資料",
        rationale: "理由",
        operation_id: "op-rest-confirm-1",
      }),
    });
    expect(firstRes.status).toBe(200);

    // Duplicate call with new operation_id
    const dupRes = await fetch(`${baseUrl}/workspace/coverage/resolution/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        requirement_id: missingItem!.requirement_id,
        character_id: "alpha",
        action: "user_supplement",
        choice: "重複提供補充資料",
        rationale: "理由二",
        operation_id: "op-rest-confirm-2",
      }),
    });
    expect(dupRes.status).toBeGreaterThanOrEqual(400);
    const dupBody = (await dupRes.json()) as { code?: string };
    expect(dupBody.code).toBe("COVERAGE_RESOLUTION_DUPLICATE");
  });

  it("GET /workspace/dashboard/coverage-center exposes view_research_task for in-flight tasks", async () => {
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };
    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    // Start research on the missing requirement
    await fetch(`${baseUrl}/workspace/coverage/research/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        scope: {
          kind: "requirements",
          targets: [{ requirement_id: missingItem!.requirement_id, character_id: "alpha" }],
        },
      }),
    });

    const response = await fetch(`${baseUrl}/workspace/dashboard/coverage-center`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matrix: {
        cells: Array<{
          requirement_id: string;
          character_id?: string;
          existing_in_flight_task_ids?: string[];
          typed_actions: Array<{ action: string; label: string; enabled: boolean; target_task_id?: string }>;
        }>;
      };
    };

    const cell = body.matrix.cells.find((c) => c.requirement_id === missingItem!.requirement_id);
    expect(cell).toBeDefined();
    expect(cell?.existing_in_flight_task_ids?.length).toBeGreaterThan(0);
    const viewTaskAction = cell?.typed_actions.find((a) => a.action === "view_research_task");
    expect(viewTaskAction).toBeDefined();
    expect(viewTaskAction?.enabled).toBe(true);
    expect(viewTaskAction?.label).toContain("查看進行中研究");
    expect(viewTaskAction?.target_task_id).toBeTruthy();
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
  id = "";
  className = "";
  type = "";
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
    if (name === "id") this.id = value;
  }

  getAttribute(name: string): string | null {
    if (name === "id" && this.id) return this.id;
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

describe("Audit 7 Batch 2 - Dashboard UI DOM & Safe textContent", () => {
  it("renders researchTaskElement with id and data-task-id", () => {
    const code = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "researchTaskElement",
    ]);

    const documentStub = {
      createElement: (tag: string) => new FakeElement(tag),
    };
    const statusClassStub = () => "running";

    const fn = new Function(
      "document",
      "statusClass",
      code + "\nreturn { researchTaskElement };",
    ) as (document: unknown, sc: unknown) => { researchTaskElement: (task: unknown) => FakeElement };

    const api = fn(documentStub, statusClassStub);

    const taskElement = api.researchTaskElement({
      id: "task-test-123",
      status: "running",
      requirement_ids: ["req.personality"],
      dimension_paths: ["personality"],
      query_seeds: ["Alpha"],
      claim_generation: 1,
      attempt: 1,
    });

    expect(taskElement.getAttribute("id")).toBe("research-task-task-test-123");
    expect(taskElement.getAttribute("data-task-id")).toBe("task-test-123");
    expect(taskElement.textContent).not.toContain("<script>");
  });

  it("renderCellActionButton handles view_research_task action and triggers navigation", () => {
    const code = extractFunctions(DASHBOARD_PANELS_COVERAGE_JS, [
      "renderCellActionButton",
      "coverageCellTitle",
    ]);

    let switchedPanel = "";
    const switchPanelStub = (p: string) => {
      switchedPanel = p;
    };
    const documentStub = {
      createElement: (tag: string) => new FakeElement(tag),
      querySelector: () => null,
    };
    const byIdStub = () => null;

    const fn = new Function(
      "document",
      "byId",
      "switchPanel",
      code + "\nreturn { renderCellActionButton };",
    ) as (document: unknown, byId: unknown, sp: unknown) => {
      renderCellActionButton: (cell: unknown, actionOpt: unknown) => FakeElement;
    };

    const api = fn(documentStub, byIdStub, switchPanelStub);

    const btn = api.renderCellActionButton(
      { requirement_id: "req.personality", character_id: "alpha" },
      {
        action: "view_research_task",
        label: "查看進行中研究",
        enabled: true,
        target_task_id: "task-123",
        prerequisite: { action: "view_task", target_panel: "research-monitor", target_id: "task-123" },
      },
    );

    expect(btn.textContent).toBe("查看進行中研究");
    btn.click();
    expect(switchedPanel).toBe("research-monitor");
  });
});
