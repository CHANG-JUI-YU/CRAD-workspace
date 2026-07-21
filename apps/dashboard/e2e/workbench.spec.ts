import { expect, test, type Page, type Route } from "@playwright/test";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

interface ApiState {
  document: { revision: string; value: Record<string, unknown> };
  workflowRevision: number;
  contentApproved: boolean;
  candidatePending: boolean;
  previewCreated: boolean;
  published: boolean;
}

function createState(): ApiState {
  return {
    document: { revision: hash("a"), value: { schema_version: 1, id: "hero", display_name: "Hero", mode: "zhuji", enabled: true } },
    workflowRevision: 3,
    contentApproved: false,
    candidatePending: true,
    previewCreated: false,
    published: false,
  };
}

function workflow(state: ApiState) {
  return {
    stage: "authoring", revision: state.workflowRevision, artifacts: [],
    tasks: [{ id: "draft-hero", status: "pending", assigned_agent: "zhuji-creator", attempt: 0 }],
    gates: [
      { id: "facts", status: "approved", input_revisions: [] },
      { id: "blueprint", status: "approved", input_revisions: [] },
      { id: "content", status: state.contentApproved ? "approved" : "pending", input_revisions: [] },
      { id: "publish", status: "pending", input_revisions: [] },
    ],
    decisions: [],
  };
}

function projectDetail(state: ApiState) {
  return {
    project: { id: "demo", title: "Demo Project" }, workflow: workflow(state), blueprint: {},
    characters: [{ manifest: { id: "hero", display_name: "Hero", mode: "zhuji" }, document: {}, modules: [{ module: "appearance" }, { module: "self_introduction" }] }],
    greetings: { greetings: [] }, world: [], sources: { sources: [] }, facts: { facts: [] }, conflicts: { conflicts: [] }, diagnostics: [], revisions: {},
  };
}

const preview = {
  id: "preview-e2e", revision: hash("p"), input_revision: hash("i"), created_at: "2026-07-15T00:00:00.000Z",
  options: { strict: true, token_budget: 8000, json: true, png: false, v2_backfill: false },
  audit: { ok: true, blocked: false, findings: [], summary: { errors: 0, warnings: 0, info: 0 } },
  artifact_hashes: { "exports/demo/demo.json": hash("e") },
};

async function installApi(page: Page, state: ApiState): Promise<void> {
  await page.route("http://127.0.0.1:4174/api/**", async (route) => respond(route, state));
}

async function respond(route: Route, state: ApiState): Promise<void> {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === "/api/events") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": connected\n\n" });
  if (pathname === "/api/session/bootstrap") return success(route, { csrf_token: "c".repeat(40), expires_at: new Date().toISOString() });
  if (pathname === "/api/session") return success(route, { authenticated: true, csrf_token: "c".repeat(40) });
  if (pathname === "/api/projects") return success(route, [{ id: "demo", title: "Demo Project", stage: "authoring", workflow_revision: state.workflowRevision, valid: true, character_count: 1, pending_gates: state.contentApproved ? 1 : 2, failed_tasks: 0, diagnostics: [] }]);
  if (pathname === "/api/projects/demo") return success(route, projectDetail(state));
  if (pathname === "/api/workflow/demo") return success(route, workflow(state));
  if (pathname === "/api/documents/read") {
    const resource: unknown = request.postDataJSON();
    return success(route, { resource, format: "yaml", value: state.document.value, semantic_revision: state.document.revision, raw_revision: state.document.revision, read_only: false });
  }
  if (pathname === "/api/documents/patch") return patchDocument(route, state);
  if (pathname === "/api/workflow/gate") {
    const body = request.postDataJSON() as { gate_id: string };
    if (body.gate_id === "content") state.contentApproved = true;
    state.workflowRevision += 1;
    return success(route, { workflow: workflow(state), decision: { id: "decision-e2e" } });
  }
  if (pathname === "/api/sources/demo") return success(route, [{ id: "source-1", title: "Novel", tier: "official", current_revision_id: hash("s") }]);
  if (pathname === "/api/facts/query") return success(route, { facts: state.candidatePending ? [] : [{ fact: { id: "fact-candidate-1", subject: "hero", predicate: "role", value: "ranger", status: "accepted", fact_revision: 1 }, gate_status: "ready", conflict_ids: [] }], projection_revision: hash("f") });
  if (pathname === "/api/facts/demo/candidates") return success(route, state.candidatePending ? [{ id: "candidate-1", subject: "hero", predicate: "role", value: "ranger", classification: "source_fact", confidence: 0.93, status: "pending_review", evidence: [{ id: "evidence-1", source_id: "source-1", quote: "Hero is a ranger.", normalized_character_range: [0, 17], normalized_line_range: [4, 4] }] }] : []);
  if (pathname === "/api/facts/review") { state.candidatePending = false; return success(route, { fact: { id: "fact-candidate-1" } }); }
  if (pathname === "/api/planner/demo") return success(route, { plan: { entries: [{ id: "hero-core", insertion_order: 10, priority: 100, activation: "constant" }] } });
  if (pathname === "/api/planner/simulate") return success(route, { token: { total: 120 }, trigger: { activated: ["hero-core"] }, plan: { entries: ["hero-core"] } });
  if (pathname === "/api/builds/demo/previews") return success(route, state.previewCreated ? [{ preview, status: "reviewed", updated_at: preview.created_at }] : []);
  if (pathname === "/api/builds/demo/exports") return success(route, state.published ? [{ id: "demo.json", bytes: 2048, modified_at: "2026-07-15T00:00:00.000Z", read_only: true }] : []);
  if (pathname === "/api/builds/preview") { state.previewCreated = true; state.workflowRevision += 1; return success(route, preview); }
  if (pathname === "/api/builds/publish") { state.published = true; return success(route, { preview, result: { published: true } }); }
  return failure(route, 500, "E2E_ROUTE_MISSING", `Missing E2E route: ${pathname}`);
}

async function patchDocument(route: Route, state: ApiState): Promise<void> {
  const body = route.request().postDataJSON() as { expected_revision: string; dry_run: boolean; operations: Array<{ path: string; value?: unknown }> };
  if (body.expected_revision !== state.document.revision) return failure(route, 409, "REVISION_CONFLICT", "revision conflict");
  const next = { ...state.document.value };
  for (const operation of body.operations) {
    if (operation.path === "/display_name") next.display_name = operation.value;
  }
  if (!body.dry_run) state.document = { revision: hash("b"), value: next };
  return success(route, { differences: body.operations, value: next, after_revision: hash("b"), no_op: body.operations.length === 0, dry_run: body.dry_run });
}

function success(route: Route, data: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
}

function failure(route: Route, status: number, code: string, message: string) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code, message, retryable: false, diagnostics: [], next_actions: [] } }) });
}

async function openProject(page: Page): Promise<void> {
  await page.goto("/#bootstrap=" + "b".repeat(48));
  await expect(page).toHaveTitle("Card Workspace");
  await page.getByLabel("目前專案").selectOption("demo");
  await expect(page.getByRole("heading", { name: "Demo Project" })).toBeVisible();
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`desktop authoring journeys ${viewport.width}x${viewport.height}`, async ({ browser, page }) => {
    const state = createState();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(`page:${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") failures.push(`console:${message.text()}`); });
    page.on("requestfailed", (request) => failures.push(`request:${request.url()}:${request.failure()?.errorText ?? "failed"}`));
    await page.setViewportSize(viewport);
    await installApi(page, state);
    await openProject(page);

    await page.getByRole("link", { name: "角色" }).click();
    await page.getByRole("button", { name: "Hero／身份" }).click();
    await page.getByLabel("display_name").fill("Hero Edited");
    await page.getByRole("button", { name: "Dry-run" }).click();
    await expect(page.getByText("1 semantic changes")).toBeVisible();
    await page.getByRole("button", { name: "確認儲存" }).click();
    await expect(page.getByLabel("display_name")).toHaveValue("Hero Edited");

    await page.getByRole("link", { name: "工作流" }).click();
    const contentGate = page.locator(".gate-list article").filter({ hasText: "content" });
    await contentGate.getByRole("button", { name: "Approve" }).click();
    await expect(contentGate.getByText("approved")).toBeVisible();

    await page.getByRole("link", { name: "來源" }).click();
    await expect(page.getByText("source-1")).toBeVisible();
    await page.getByRole("link", { name: "事實" }).click();
    await expect(page.getByText("Hero is a ranger.")).toBeVisible();
    await page.getByRole("button", { name: "Accept Candidate" }).click();
    await expect(page.getByText("fact-candidate-1")).toBeVisible();

    await page.getByRole("link", { name: "規劃模擬" }).click();
    await page.getByPlaceholder("每行一則測試訊息").fill("Hero enters");
    await page.getByRole("button", { name: "執行模擬" }).click();
    await expect(page.getByText(/"total": 120/)).toBeVisible();
    await page.getByRole("link", { name: "編譯輸出" }).click();
    await page.getByRole("button", { name: "建立Exact Preview" }).click();
    await expect(page.getByText("preview-e2e").first()).toBeVisible();
    await page.getByRole("button", { name: "Approve Exact Preview & Publish" }).click();
    await expect(page.getByText("發布完成，Exports 已更新。")).toBeVisible();
    await expect(page.getByText("demo.json")).toBeVisible();

    state.document = { revision: hash("c"), value: { ...state.document.value, display_name: "Shared Base" } };
    const firstContext = await browser.newContext({ viewport });
    const secondContext = await browser.newContext({ viewport });
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    await installApi(first, state);
    await installApi(second, state);
    await Promise.all([openProject(first), openProject(second)]);
    await Promise.all([first.getByRole("link", { name: "角色" }).click(), second.getByRole("link", { name: "角色" }).click()]);
    await Promise.all([first.getByRole("button", { name: "Hero／身份" }).click(), second.getByRole("button", { name: "Hero／身份" }).click()]);
    await Promise.all([expect(first.getByLabel("display_name")).toHaveValue("Shared Base"), expect(second.getByLabel("display_name")).toHaveValue("Shared Base")]);
    await first.getByLabel("display_name").fill("First Writer");
    await first.getByRole("button", { name: "Dry-run" }).click();
    await first.getByRole("button", { name: "確認儲存" }).click();
    await second.getByLabel("display_name").fill("Stale Writer");
    await second.getByRole("button", { name: "Dry-run" }).click();
    await expect(second.getByText("revision conflict")).toBeVisible();
    await firstContext.close();
    await secondContext.close();

    expect(failures).toEqual([]);
  });
}
