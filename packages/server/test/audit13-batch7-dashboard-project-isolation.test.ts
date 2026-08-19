import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { dashboard } from "../src/dashboard.js";
import {
  DASHBOARD_API_PROJECT_SAFE_JS,
  DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS,
  DASHBOARD_PROJECT_CONTEXT_JS,
} from "../src/dashboard-project-context.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    async text() { return JSON.stringify(payload); },
  };
}

function createApiContext(fetchImpl: (path: string) => Promise<unknown>) {
  const notices: string[] = [];
  const latestErrors: unknown[] = [];
  const context = {
    URLSearchParams,
    Error,
    Object,
    Array,
    JSON,
    Promise,
    String,
    Date,
    navigator: { onLine: true },
    document: {
      hidden: false,
      addEventListener() { /* no-op */ },
    },
    window: {
      location: { search: "", pathname: "/", hash: "" },
      history: { replaceState() { /* no-op */ } },
      addEventListener() { /* no-op */ },
    },
    state: {
      busy: false,
      actionBusy: {},
      sessionUnselected: true,
      projectGeneration: 1,
      currentProjectValue: "project-a",
    },
    fetch: fetchImpl,
    setTimeout() { return 1; },
    clearTimeout() { /* no-op */ },
    isRecord(value: unknown) { return value !== null && typeof value === "object" && !Array.isArray(value); },
    firstString(record: Record<string, unknown>, keys: string[]) {
      for (const key of keys) if (typeof record[key] === "string") return record[key];
      return "";
    },
    renderProjects() { /* no-op */ },
    renderStatus() { /* no-op */ },
    renderAgents() { /* no-op */ },
    renderInterview() { /* no-op */ },
    renderLatest() { /* no-op */ },
    renderLatestError(_label: string, error: unknown) { latestErrors.push(error); },
    setAreaError() { /* no-op */ },
    setNotice(_kind: string, message: string) { notices.push(message); },
    setBusy(value: boolean) { (context.state as { busy: boolean }).busy = value; },
    setActionBusy() { /* no-op */ },
    updateLastUpdated() { /* no-op */ },
    syncAllControls() { /* no-op */ },
    applySectionVisibility() { /* no-op */ },
    activeSection: "overview",
    resetProjectScopedState() { /* no-op */ },
    renderOperationList() { /* no-op */ },
    byId() { return null; },
    console,
  };
  runInNewContext(DASHBOARD_API_PROJECT_SAFE_JS, context);
  return { context, notices, latestErrors };
}

describe("Audit 13 Dashboard project isolation", () => {
  it("drops an old-project success response before any loader can render it", async () => {
    const pending = deferred<unknown>();
    const fixture = createApiContext(async () => pending.promise);
    const request = runInNewContext('requestJson("/workspace/dashboard/data")', fixture.context) as Promise<unknown>;

    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).projectGeneration = 2;
    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).currentProjectValue = "project-b";
    pending.resolve(response({ project: "project-a" }));

    await expect(request).rejects.toMatchObject({ code: "DASHBOARD_STALE_PROJECT_CONTEXT", staleProjectContext: true });
  });

  it("classifies an old-project network failure as stale instead of rendering it as a current-project error", async () => {
    const pending = deferred<unknown>();
    const fixture = createApiContext(async () => pending.promise);
    const request = runInNewContext('requestJson("/workspace/dashboard/workflow")', fixture.context) as Promise<unknown>;

    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).projectGeneration = 2;
    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).currentProjectValue = "project-b";
    pending.reject(new Error("late project-a failure"));

    await expect(request).rejects.toMatchObject({ code: "DASHBOARD_STALE_PROJECT_CONTEXT" });
  });

  it("keeps the project list control-plane request usable across a project transition", async () => {
    const pending = deferred<unknown>();
    const fixture = createApiContext(async () => pending.promise);
    const request = runInNewContext('requestJson("/workspace/projects")', fixture.context) as Promise<unknown>;

    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).projectGeneration = 2;
    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).currentProjectValue = "project-b";
    pending.resolve(response({ projects: ["project-a", "project-b"] }));

    await expect(request).resolves.toEqual({ projects: ["project-a", "project-b"] });
  });

  it("suppresses stale runTask error rendering after a context change", async () => {
    const pending = deferred<unknown>();
    const fixture = createApiContext(async () => pending.promise);
    const task = runInNewContext(
      'runTask("old action", function () { return requestJson("/workspace/dashboard/issues"); })',
      fixture.context,
    ) as Promise<unknown>;

    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).projectGeneration = 2;
    (fixture.context.state as { projectGeneration: number; currentProjectValue: string }).currentProjectValue = "project-b";
    pending.resolve(response({ items: [{ id: "old" }] }));

    await expect(task).resolves.toMatchObject({ status: "stale_project_context" });
    expect(fixture.latestErrors).toEqual([]);
    expect(fixture.notices.filter((message) => message.includes("失敗"))).toEqual([]);
  });

  it("resets project-scoped models, rows, summaries and draft controls immediately", () => {
    const nodes = new Map<string, { textContent: string; hidden: boolean; value: string }>();
    for (const id of [
      "workflow-stages", "workflow-invalidations", "source-list", "fact-list", "artifact-list",
      "fact-review-evidence", "quality-issues", "provenance-history", "operation-list", "coverage-center",
      "request-input", "interview-answer-input", "amend-answer-input", "amend-area", "external-change-notice",
    ]) {
      nodes.set(id, { textContent: "old-project", hidden: false, value: "old-project" });
    }
    const context = {
      state: {
        status: { project: "a" }, interviewQuestion: { id: "q" }, interviewRevision: 7,
        amendQuestionId: "q", amendPreview: {}, amendInFlight: true, actionBusy: { old: true },
      },
      currentWorkflow: { project: "a" },
      currentInvalidations: { project: "a" },
      currentLatestReviewRun: { id: "run-a" },
      currentProvenanceConfirmation: { fingerprint: "old" },
      cachedOperations: [{ id: "op-a" }],
      currentOverrides: { OLD: true },
      repairPlanHash: "old-hash",
      resetProjectScopedState() { /* base reset */ },
      setAreaError() { /* no-op */ },
      renderLatestError() { /* no-op */ },
      isStaleProjectContextError() { return false; },
      byId(id: string) { return nodes.get(id) ?? null; },
    };
    runInNewContext(DASHBOARD_PROJECT_CONTEXT_JS, context);
    runInNewContext("resetProjectScopedState()", context);

    expect(context.state.status).toBeNull();
    expect(context.state.interviewQuestion).toBeNull();
    expect(context.state.actionBusy).toEqual({});
    expect(runInNewContext("currentWorkflow", context)).toBeNull();
    expect(runInNewContext("currentProvenanceConfirmation", context)).toBeNull();
    expect(nodes.get("workflow-stages")?.textContent).toBe("");
    expect(nodes.get("artifact-list")?.textContent).toBe("");
    expect(nodes.get("request-input")?.value).toBe("");
    expect(nodes.get("amend-area")?.hidden).toBe(true);
    expect(nodes.get("external-change-notice")?.hidden).toBe(true);
  });

  it("removes nested workflow/provenance refreshes and centralizes the transition load set", () => {
    expect(DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS).not.toContain("void refreshWorkflowViews();");
    expect(DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS).not.toContain("void loadProvenanceHistory();");
    expect(DASHBOARD_API_PROJECT_SAFE_JS).toContain('typeof loadWorkflowData === "function" ? loadWorkflowData()');
    expect(DASHBOARD_API_PROJECT_SAFE_JS).toContain('typeof loadProvenanceHistory === "function" ? loadProvenanceHistory()');
  });

  it("protects the project-scoped endpoint families required by the audit", () => {
    const html = dashboard();
    for (const endpoint of [
      "/workspace/dashboard/data",
      "/workspace/dashboard/workflow",
      "/workspace/dashboard/invalidations",
      "/workspace/dashboard/provenance",
      "/workspace/dashboard/artifacts",
      "/workspace/dashboard/sources",
      "/workspace/dashboard/facts",
      "/workspace/dashboard/candidates",
      "/workspace/dashboard/issues",
      "/workspace/dashboard/operations",
      "/workspace/dashboard/coverage",
    ]) {
      expect(html).toContain(endpoint);
    }
    expect(html).toContain("DASHBOARD_STALE_PROJECT_CONTEXT");
    expect(html).toContain("projectContextMatches(requestContext)");
  });
});
