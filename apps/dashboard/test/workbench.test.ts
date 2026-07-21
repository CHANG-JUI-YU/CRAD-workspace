// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Workbench } from "../src/app/Workbench";
import { apiFetch } from "../src/api/client";
import { DashboardSection } from "../src/features/sections/DashboardSection";

const project = {
  project: { id: "demo", title: "Demo" },
  workflow: {
    stage: "authoring",
    revision: 3,
    artifacts: [],
    tasks: [{ id: "draft-hero", status: "pending", assigned_agent: "zhuji-creator", attempt: 0 }],
    gates: [
      { id: "facts", status: "not_required", input_revisions: [] },
      { id: "blueprint", status: "approved", input_revisions: [] },
      { id: "content", status: "approved", input_revisions: [] },
      { id: "publish", status: "pending", input_revisions: [] },
    ],
    decisions: [{ id: "decision-1", kind: "interview", summary: "Approved direction", actor: "user" }],
  },
  blueprint: {},
  characters: [{ manifest: { id: "hero", display_name: "Hero", mode: "zhuji" }, document: {}, modules: [{ module: "self_introduction" }] }],
  greetings: { greetings: [] },
  world: [],
  sources: { sources: [] },
  facts: { facts: [] },
  conflicts: { conflicts: [{ id: "conflict-1", subject: "hero", predicate: "role", status: "open", members: [{ fact_id: "fact-1", value: "knight" }, { fact_id: "fact-2", value: "mage" }] }] },
  diagnostics: [],
  revisions: {},
};

const compilePreview = {
  id: "preview-1",
  revision: `sha256:${"a".repeat(64)}`,
  input_revision: `sha256:${"b".repeat(64)}`,
  created_at: "2026-07-14T00:00:00.000Z",
  options: { strict: true, token_budget: 8000, json: true, png: false, v2_backfill: false },
  audit: {
    ok: true, blocked: false,
    findings: [{ rule_id: "compat-warning", layer: "compatibility", severity: "warning", message: "Compatibility note", evidence: [], fixability: "manual", overridable: true }],
    summary: { errors: 0, warnings: 1, info: 0 },
  },
  artifact_hashes: { "exports/demo/demo.json": `sha256:${"c".repeat(64)}` },
};
const stalePreview = { ...compilePreview, id: "preview-stale", revision: `sha256:${"d".repeat(64)}`, options: { ...compilePreview.options, json: false, png: true, v2_backfill: true } };
const blockedPreview = { ...compilePreview, id: "preview-blocked", revision: `sha256:${"e".repeat(64)}`, audit: { ...compilePreview.audit, ok: false, blocked: true, summary: { errors: 1, warnings: 0, info: 0 }, findings: [{ rule_id: "normative-error", layer: "normative", severity: "error", message: "Blocked", hint: "Fix source", evidence: [], fixability: "manual", overridable: false }] } };

vi.mock("../src/api/client", () => ({
  apiFetch: vi.fn((path: string) => Promise.resolve((() => {
    if (path === "/api/projects") return [{ id: "demo", title: "Demo", stage: "authoring", workflow_revision: 3, valid: true, character_count: 1, pending_gates: 1, failed_tasks: 0, diagnostics: [] }];
    if (path === "/api/projects/demo") return project;
    if (path === "/api/plugins/demo") return {
      project_id: "demo",
      project_kind: "character_card",
      workflow_stage: "plugin_mvu_review",
      workflow_revision: 7,
      blueprint_selections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
      selection: { selections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }] },
      selection_revision: "sha256:selection",
      sources: [{ plugin_id: "official.mvu-zod" }],
      artifacts: [{ id: "plugin-official.mvu-zod", status: "approved" }],
      pending_proposals: [{
        id: "proposal-mvu-1",
        task_id: "create-plugin-mvu",
        project_id: "demo",
        owner: "mvu-creator",
        proposal_revision: "sha256:proposal",
        base_workflow_revision: 6,
        value: { plugin_id: "official.mvu-zod", capabilities: ["mvu"], resolved_source_hash: "sha256:source" },
      }],
       diagnostics: [],
     };
    if (path === "/api/plugins/demo/revision-preview") return {
      workflow_revision: 7,
      intent: {
        schema_version: 1,
        project_id: "demo",
        revision: "sha256:intent",
        project_kind: "character_card",
        base_selection_revision: "sha256:selection",
        selections: [
          { plugin_id: "official.ejs", capabilities: ["ejs"] },
          { plugin_id: "official.html", capabilities: ["html.status_bar"] },
          { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
        ],
        dependency_closure: ["official.ejs", "official.html", "official.mvu-zod"],
        implementation_pins: [
          { plugin_id: "official.ejs", implementation: { version: "1.0.0", digest: "sha256:ejs", asset_manifest_id: "assets", asset_manifest_revision: "sha256:asset", asset_manifest_hash: "sha256:asset" } },
          { plugin_id: "official.html", implementation: { version: "1.0.0", digest: "sha256:html", asset_manifest_id: "assets", asset_manifest_revision: "sha256:asset", asset_manifest_hash: "sha256:asset" } },
          { plugin_id: "official.mvu-zod", implementation: { version: "1.0.0", digest: "sha256:mvu", asset_manifest_id: "assets", asset_manifest_revision: "sha256:asset", asset_manifest_hash: "sha256:asset" } },
        ],
      },
    };
    if (path === "/api/plugins/demo/revision-begin") return { workflow: { stage: "plugin_mvu_authoring", revision: 8 }, intent: { revision: "sha256:intent" } };
    if (path === "/api/plugins/demo/decision-token") return { token: "t".repeat(43) };
    if (path === "/api/plugins/demo/review") return { stage: "content_review", revision: 8 };
    if (path === "/api/sources/demo") return [{ id: "source-1", title: "Source", tier: "official", current_revision_id: "sha256:a" }];
    if (path === "/api/facts/query") return { facts: [
      { fact: { id: "fact-1", subject: "hero", predicate: "role", value: "knight", status: "accepted", fact_revision: 2 }, gate_status: "blocked_unresolved_conflict", conflict_ids: ["conflict-1"] },
      { fact: { id: "fact-2", subject: "hero", predicate: "role", value: "mage", status: "accepted", fact_revision: 1 }, gate_status: "blocked_unresolved_conflict", conflict_ids: ["conflict-1"] },
    ], projection_revision: "sha256:facts" };
    if (path === "/api/facts/demo/candidates") return [{ id: "candidate-1", subject: "hero", predicate: "role", value: "ranger", classification: "source_fact", confidence: 0.9, status: "pending_review", evidence: [{ id: "evidence-1", source_id: "novel", quote: "Hero is a ranger", normalized_character_range: [0, 16], normalized_line_range: [4, 4] }] }];
    if (path === "/api/facts/review") return { fact: { id: "fact-candidate-1" } };
    if (path === "/api/facts/conflict/resolve") return { conflict: { id: "conflict-1", status: "resolved" } };
    if (path === "/api/planner/demo") return { plan: { entries: [] } };
    if (path === "/api/planner/simulate") return { token: {}, trigger: {}, plan: {} };
    if (path === "/api/workflow/demo") return project.workflow;
    if (path === "/api/builds/demo/previews") return [
      { preview: compilePreview, status: "reviewed", updated_at: "2026-07-14T00:00:00.000Z" },
      { preview: stalePreview, status: "stale", updated_at: "2026-07-13T00:00:00.000Z" },
      { preview: blockedPreview, status: "reviewed", updated_at: "2026-07-12T00:00:00.000Z" },
    ];
    if (path === "/api/builds/demo/exports") return [{ id: "demo.json", bytes: 100, modified_at: "2026-07-14T00:00:00.000Z", read_only: true }, { id: "demo.png", bytes: 2048, modified_at: "2026-07-14T00:00:00.000Z", read_only: true }];
    if (path === "/api/builds/preview") return compilePreview;
    if (path === "/api/workflow/gate") return { workflow: { ...project.workflow, revision: 4 }, decision: { id: "publish-1" } };
    if (path === "/api/builds/publish") return { preview: compilePreview, result: { published: true } };
    if (path === "/api/builds/roundtrip") return { envelope: { format: "json", source_revision: "sha256:test", card: { data: { name: "Hero" } } }, report: { status: "equivalent", differences: [] } };
    throw new Error(`Unexpected API path: ${path}`);
  })())),
}));

afterEach(() => vi.clearAllMocks());

function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

describe("Dashboard workbench", () => {
  it("navigates from project overview to persisted workflow state", async () => {
    render(React.createElement(QueryClientProvider, { client: queryClient() },
      React.createElement(MemoryRouter, { initialEntries: ["/projects/demo/overview"] },
        React.createElement(Routes, null,
          React.createElement(Route, { path: "/projects/:projectId/:section", element: React.createElement(Workbench, { connection: "live" }) }),
        ),
      ),
    ));

    expect(await screen.findByRole("heading", { name: "Demo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "工作流" }));
    expect(await screen.findByText("draft-hero")).toBeTruthy();
    expect(screen.getByText("Approved direction")).toBeTruthy();
  });

  it("renders source, fact, planner, and build adapters and runs mutations", async () => {
    const client = queryClient();
    const renderSection = (section: string) => render(React.createElement(QueryClientProvider, { client },
      React.createElement(DashboardSection, { section, projectId: "demo", project: project as never }),
    ));

    const sources = renderSection("sources");
    expect(await screen.findByText("source-1")).toBeTruthy();
    sources.unmount();

    const facts = renderSection("facts");
    const factsView = within(facts.container);
    expect(await factsView.findByText("conflict-1")).toBeTruthy();
    expect(factsView.getAllByRole("option")).toHaveLength(6);
    expect(await factsView.findByRole("button", { name: /candidate-1/u })).toBeTruthy();
    fireEvent.click(factsView.getByRole("button", { name: "Accept Candidate" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/facts/review")).toBe(true));
    const reviewCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/facts/review");
    const reviewBody = reviewCall?.[1]?.body;
    if (typeof reviewBody !== "string") throw new Error("review request body missing");
    expect(JSON.parse(reviewBody)).toMatchObject({
      expected_projection_revision: "sha256:facts",
      decision: { candidate_id: "candidate-1", fact_id: "fact-candidate-1", type: "accepted" },
    });
    fireEvent.change(factsView.getByLabelText("Fact ID"), { target: { value: "fact-1" } });
    fireEvent.click(factsView.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/review")).toHaveLength(2));
    const rejectCall = vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/review")[1];
    const rejectBody = rejectCall?.[1]?.body;
    if (typeof rejectBody !== "string") throw new Error("reject request body missing");
    expect(JSON.parse(rejectBody)).toMatchObject({ expected_fact_revision: 2, decision: { type: "rejected", fact_id: "fact-1" } });

    fireEvent.click(factsView.getByRole("button", { name: /conflict-1/u }));
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/facts/conflict/resolve")).toBe(true));
    const resolveCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/facts/conflict/resolve");
    const resolveBody = resolveCall?.[1]?.body;
    if (typeof resolveBody !== "string") throw new Error("resolve request body missing");
    expect(JSON.parse(resolveBody)).toMatchObject({
      expected_projection_revision: "sha256:facts",
      expected_fact_revisions: { "fact-1": 2, "fact-2": 1 },
      decision: { conflict_id: "conflict-1", type: "choose_one", accepted_fact_ids: ["fact-1"], rejected_fact_ids: ["fact-2"] },
    });
    const resolution = factsView.getByLabelText("Resolution");
    const acceptedFacts = factsView.getByLabelText("Accepted fact IDs");
    const rejectedFacts = factsView.getByLabelText("Rejected fact IDs");

    fireEvent.change(resolution, { target: { value: "coexist" } });
    fireEvent.change(acceptedFacts, { target: { value: "" } });
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/conflict/resolve")).toHaveLength(2));
    fireEvent.change(resolution, { target: { value: "unresolved" } });
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/conflict/resolve")).toHaveLength(3));

    fireEvent.change(resolution, { target: { value: "temporal" } });
    fireEvent.change(factsView.getByLabelText("Temporal assignments JSON"), { target: { value: '[{"fact_id":"fact-1","valid_time":{"extensions":{}}},{"fact_id":"fact-2","valid_time":{"extensions":{}}}]' } });
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/conflict/resolve")).toHaveLength(4));

    fireEvent.change(resolution, { target: { value: "scope_split" } });
    fireEvent.change(factsView.getByLabelText("Scope assignments JSON"), { target: { value: '[{"fact_id":"fact-1","scope":{"character_ids":["hero"],"extensions":{}}},{"fact_id":"fact-2","scope":{"character_ids":[],"extensions":{}}}]' } });
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/conflict/resolve")).toHaveLength(5));

    fireEvent.change(resolution, { target: { value: "supersede" } });
    fireEvent.change(acceptedFacts, { target: { value: "" } });
    fireEvent.change(rejectedFacts, { target: { value: "" } });
    fireEvent.click(factsView.getByRole("button", { name: "Record Resolution" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/api/facts/conflict/resolve")).toHaveLength(6));
    facts.unmount();

    const planner = renderSection("planner");
    fireEvent.change(screen.getByPlaceholderText("每行一則測試訊息"), { target: { value: "Hero enters" } });
    fireEvent.click(screen.getByRole("button", { name: "執行模擬" }));
    await waitFor(() => expect(screen.getByText(/"token"/u)).toBeTruthy());
    planner.unmount();

    renderSection("builds");
    expect(await screen.findByText("demo.json")).toBeTruthy();
    expect(await screen.findAllByText("preview-1")).not.toHaveLength(0);
    fireEvent.click(screen.getByText("Strict"));
    fireEvent.click(screen.getByText("PNG"));
    fireEvent.click(screen.getByText("V2 Backfill"));
    fireEvent.click(screen.getByRole("button", { name: "建立Exact Preview" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/builds/preview")).toBe(true));
    const previewCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/builds/preview");
    const previewBody = previewCall?.[1]?.body;
    if (typeof previewBody !== "string") throw new Error("preview request body missing");
    expect(JSON.parse(previewBody)).toMatchObject({ strict: false, json: true, png: true, v2_backfill: true });
    expect(JSON.parse(previewBody)).not.toHaveProperty("token_budget");
    fireEvent.click(screen.getByRole("button", { name: "Approve Exact Preview & Publish" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/builds/publish")).toBe(true));
    const gateCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/workflow/gate");
    const gateBody = gateCall?.[1]?.body;
    if (typeof gateBody !== "string") throw new Error("publish gate request body missing");
    expect(JSON.parse(gateBody)).toMatchObject({
      expected_workflow_revision: 3,
      gate_id: "publish",
      action: "approve",
      input_revisions: [{ id: "preview-1", revision: compilePreview.revision }],
      findings: [{ id: "compat-warning", category: "schema", severity: "warning", overridable: true }],
    });
    fireEvent.click(screen.getByRole("button", { name: /preview-stale/u }));
    expect(screen.getByRole("button", { name: "Approve Exact Preview & Publish" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /preview-blocked/u }));
    expect(screen.getByText("Fix source")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve Exact Preview & Publish" }).hasAttribute("disabled")).toBe(true);

    const file = new File([JSON.stringify({})], "card.json", { type: "application/json" });
    Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(new TextEncoder().encode("{}").buffer) });
    fireEvent.change(screen.getByLabelText("Round-trip card"), { target: { files: [file] } });
    expect(await screen.findByText("Hero / equivalent")).toBeTruthy();
    expect(screen.getByText("Equivalent：未偵測到 loss。")).toBeTruthy();
  });

  it("renders plugin state and requires explicit confirmation before review", async () => {
    const view = render(React.createElement(QueryClientProvider, { client: queryClient() },
      React.createElement(DashboardSection, { section: "plugins", projectId: "demo", project: project as never }),
    ));

    expect(await screen.findByRole("heading", { name: "官方擴充審查" })).toBeTruthy();
    expect(screen.getByText("official.mvu-zod")).toBeTruthy();
    expect(screen.getByText("Dashboard session · CSRF protected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "核准" }));
    expect(screen.getByRole("dialog", { name: "確認 Plugin 審查決策" })).toBeTruthy();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/decision-token")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "確認核准" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/review")).toBe(true));
    const tokenCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/decision-token");
    const tokenBody = tokenCall?.[1]?.body;
    if (typeof tokenBody !== "string") throw new Error("decision token request body missing");
    expect(JSON.parse(tokenBody)).toMatchObject({
      proposal_id: "proposal-mvu-1",
      decision: "approve",
      workflow_revision: 7,
    });
    const reviewCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/review");
    const reviewBody = reviewCall?.[1]?.body;
    if (typeof reviewBody !== "string") throw new Error("plugin review request body missing");
    expect(JSON.parse(reviewBody)).toMatchObject({ action: "approve", authorization_token: "t".repeat(43) });
    expect(screen.queryByRole("dialog", { name: "確認 Plugin 審查決策" })).toBeNull();
    view.unmount();
  });

  it("supports cancellation and explicit rejection without issuing a token early", async () => {
    const view = render(React.createElement(QueryClientProvider, { client: queryClient() },
      React.createElement(DashboardSection, { section: "plugins", projectId: "demo", project: project as never }),
    ));

    expect(await screen.findByRole("heading", { name: "官方擴充審查" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "拒絕" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "確認 Plugin 審查決策" })).toBeNull();
    expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/decision-token")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "拒絕" }));
    fireEvent.click(screen.getByRole("button", { name: "確認拒絕" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/review")).toBe(true));
    const tokenCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/decision-token");
    const tokenBody = tokenCall?.[1]?.body;
    if (typeof tokenBody !== "string") throw new Error("decision token request body missing");
    expect(JSON.parse(tokenBody)).toMatchObject({ decision: "reject", proposal_id: "proposal-mvu-1", workflow_revision: 7 });
    const reviewCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/review");
    const reviewBody = reviewCall?.[1]?.body;
    if (typeof reviewBody !== "string") throw new Error("plugin review request body missing");
    expect(JSON.parse(reviewBody)).toMatchObject({ action: "reject", authorization_token: "t".repeat(43) });
    view.unmount();
  });

  it("保留確認視窗並顯示 token 發行錯誤", async () => {
    const view = render(React.createElement(QueryClientProvider, { client: queryClient() },
      React.createElement(DashboardSection, { section: "plugins", projectId: "demo", project: project as never }),
    ));

    expect(await screen.findByRole("heading", { name: "官方擴充審查" })).toBeTruthy();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("session expired"));
    fireEvent.click(screen.getByRole("button", { name: "核准" }));
    fireEvent.click(screen.getByRole("button", { name: "確認核准" }));
    expect(await screen.findByText("session expired")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "確認 Plugin 審查決策" })).toBeTruthy();
    view.unmount();
  });

  it("previews dependency closure and begins a server-pinned plugin revision", async () => {
    const view = render(React.createElement(QueryClientProvider, { client: queryClient() },
      React.createElement(DashboardSection, { section: "plugins", projectId: "demo", project: project as never }),
    ));

    expect(await screen.findByRole("heading", { name: "官方擴充審查" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("EJS"));
    fireEvent.click(screen.getByLabelText("HTML 狀態欄"));
    fireEvent.click(screen.getByRole("button", { name: "預覽 Plugin 修訂" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/revision-preview")).toBe(true));
    const previewCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/revision-preview");
    const previewBody = previewCall?.[1]?.body;
    if (typeof previewBody !== "string") throw new Error("revision preview request body missing");
    expect(JSON.parse(previewBody)).toMatchObject({
      expected_workflow_revision: 7,
      desired_selections: [
        { plugin_id: "official.ejs", capabilities: ["ejs"] },
        { plugin_id: "official.html", capabilities: ["html.status_bar"] },
        { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
      ],
    });
    expect(await screen.findByText("official.ejs, official.html, official.mvu-zod")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "開始 Plugin 修訂" }));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path === "/api/plugins/demo/revision-begin")).toBe(true));
    const beginCall = vi.mocked(apiFetch).mock.calls.find(([path]) => path === "/api/plugins/demo/revision-begin");
    const beginBody = beginCall?.[1]?.body;
    if (typeof beginBody !== "string") throw new Error("revision begin request body missing");
    expect(JSON.parse(beginBody)).toMatchObject({
      expected_workflow_revision: 7,
      desired_selections: [
        { plugin_id: "official.ejs", capabilities: ["ejs"] },
        { plugin_id: "official.html", capabilities: ["html.status_bar"] },
        { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
      ],
    });
    const parsedBegin = JSON.parse(beginBody) as { event_id?: unknown };
    if (typeof parsedBegin.event_id !== "string") throw new Error("revision begin event_id missing");
    expect(parsedBegin.event_id).toMatch(/^plugin-revision-begin-\d+$/u);
    view.unmount();
  });
});
