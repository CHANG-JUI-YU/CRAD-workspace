// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Workbench } from "../src/app/Workbench";
import { DashboardSection } from "../src/features/sections/DashboardSection";
import { ResourceEditor } from "../src/features/editor/ResourceEditor";
import { FactsPanel } from "../src/features/facts/FactsPanel";

const apiFetch = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../src/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("@monaco-editor/react", () => ({
  default: (props: { value?: string; onChange?: (value: string) => void }) => React.createElement("textarea", {
    "aria-label": "Monaco editor",
    value: props.value,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(event.target.value),
  }),
}));
vi.mock("../src/features/editor/monaco", () => ({}));

const revision = `sha256:${"a".repeat(64)}`;
const project = {
  project: { id: "demo", title: "Demo" },
  workflow: {
    stage: "authoring", revision: 3, artifacts: [],
    tasks: [], decisions: [], gates: [],
  },
  blueprint: {},
  characters: [{ manifest: { id: "hero", display_name: "Hero", mode: "zhuji" }, document: {}, modules: [] }],
  greetings: { greetings: [] }, world: [], sources: { sources: [] }, facts: { facts: [] },
  conflicts: { conflicts: [] }, diagnostics: [], revisions: {},
};

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderWithClient(element: React.ReactElement) {
  return render(React.createElement(QueryClientProvider, { client: client() }, element));
}

function defaultApi(path: unknown): Promise<unknown> {
  const value = String(path);
  if (value === "/api/documents/read") return Promise.resolve({
    resource: { project_id: "demo", kind: "blueprint", id: "blueprint" }, format: "json",
    value: { schema_version: 1, id: "blueprint", title: "Demo", enabled: true },
    semantic_revision: revision, raw_revision: revision, read_only: false,
  });
  if (value === "/api/facts/query") return Promise.resolve({ facts: [], projection_revision: revision });
  if (value === "/api/facts/demo/candidates") return Promise.resolve([]);
  if (value === "/api/sources/demo") return Promise.resolve([]);
  if (value === "/api/planner/demo") return Promise.resolve({ plan: { entries: [] } });
  if (value === "/api/plugins/demo") return Promise.resolve({
    project_id: "demo", project_kind: "character_card", workflow_stage: "authoring", workflow_revision: 3,
    blueprint_selections: [], selection: { selections: [] }, sources: [], artifacts: [], pending_proposals: [], diagnostics: [],
  });
  if (value === "/api/builds/demo/previews" || value === "/api/builds/demo/exports") return Promise.resolve([]);
  if (value === "/api/projects") return Promise.resolve([{ id: "demo", title: "Demo", stage: "authoring", workflow_revision: 3, valid: true, character_count: 1, pending_gates: 0, failed_tasks: 0, diagnostics: [] }]);
  if (value === "/api/projects/demo") return Promise.resolve(project);
  if (value === "/api/projects/demo/health") return Promise.resolve({ ok: true, diagnostics: [] });
  if (value === "/api/documents/patch") return Promise.resolve({ differences: [{ path: "/title" }], value: {}, after_revision: revision, no_op: true, dry_run: true });
  return Promise.resolve({});
}

beforeEach(() => apiFetch.mockImplementation((path) => defaultApi(path)));
afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("dashboard defensive states", () => {
  it("renders every resource section, empty states, and an unknown section", async () => {
    const view = renderWithClient(<DashboardSection section="characters" projectId="demo" project={project as never} />);
    expect(await screen.findByText("TYPED DOCUMENT")).toBeTruthy();
    view.unmount();

    const world = renderWithClient(<DashboardSection section="world" projectId="demo" project={project as never} />);
    expect(world.container.textContent).toContain("AUTHOR MODEL");
    world.unmount();

    const greetings = renderWithClient(<DashboardSection section="greetings" projectId="demo" project={project as never} />);
    expect(await screen.findByText("TYPED DOCUMENT")).toBeTruthy();
    greetings.unmount();

    const plugins = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(await screen.findByText(/Plugin proposal/u)).toBeTruthy();
    plugins.unmount();

    const unknown = renderWithClient(<DashboardSection section="unknown" projectId="demo" project={project as never} />);
    expect(screen.getByText("UNKNOWN SECTION")).toBeTruthy();
    unknown.unmount();
  });

  it("shows plugin loading and query errors", async () => {
    let release: ((value: unknown) => void) | undefined;
    apiFetch.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const loading = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(loading.container.textContent).toContain("PLUGIN REVIEW");
    release?.(await defaultApi("/api/plugins/demo"));
    await waitFor(() => expect(loading.container.querySelector(".plugin-revision-controls")).toBeTruthy());
    loading.unmount();

    apiFetch.mockImplementationOnce(() => Promise.reject(new Error("plugin query failed")));
    const error = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(await screen.findByText("plugin query failed")).toBeTruthy();
    error.unmount();
  });
});

describe("workbench defensive states", () => {
  it("renders the no-project welcome state and disabled actions", async () => {
    const view = renderWithClient(<MemoryRouter><Workbench connection="retrying" /></MemoryRouter>);
    expect(await screen.findByText("LOCAL AUTHORING SYSTEM")).toBeTruthy();
    expect([...view.container.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });

  it("reports both failed and successful project health checks", async () => {
    let healthChecks = 0;
    apiFetch.mockImplementation((path) => {
      if (path === "/api/projects/demo/health") {
        healthChecks += 1;
        return healthChecks === 1 ? Promise.resolve({ ok: false, diagnostics: [{}] }) : Promise.reject(new Error("health failed"));
      }
      return defaultApi(path);
    });
    const view = renderWithClient(<MemoryRouter initialEntries={["/projects/demo/overview"]}><Routes><Route path="/projects/:projectId/:section" element={<Workbench connection="live" />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Demo" })).toBeTruthy();
    const verify = view.container.querySelector("button.action.secondary");
    if (!(verify instanceof HTMLButtonElement)) throw new Error("verify button missing");
    fireEvent.click(verify);
    expect(await screen.findByText("1 findings")).toBeTruthy();
    fireEvent.click(verify);
    expect(await screen.findByText("health failed")).toBeTruthy();
  });
});

describe("editor and facts defensive states", () => {
  it("handles advanced parse failures and patch failures", async () => {
    const view = renderWithClient(<ResourceEditor label="Blueprint" resource={{ project_id: "demo", kind: "blueprint", id: "blueprint" }} />);
    expect(await screen.findByText("TYPED DOCUMENT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const editor = await screen.findByRole("textbox", { name: "Monaco editor" });
    fireEvent.change(editor, { target: { value: "{" } });
    expect(screen.getByText(/JSON/u)).toBeTruthy();
    fireEvent.change(editor, { target: { value: '{"title":"new"}' } });
    apiFetch.mockImplementationOnce(() => Promise.reject(new Error("patch failed")));
    fireEvent.click(screen.getByRole("button", { name: "Dry-run" }));
    expect(await screen.findByText("patch failed")).toBeTruthy();
    view.unmount();

    apiFetch.mockImplementationOnce(() => Promise.resolve({
      resource: { project_id: "demo", kind: "blueprint", id: "blueprint" }, format: "json", value: [],
      semantic_revision: revision, raw_revision: revision, read_only: false,
    }));
    const primitive = renderWithClient(<ResourceEditor label="Array" resource={{ project_id: "demo", kind: "blueprint", id: "array" }} />);
    expect(await screen.findByText(/Advanced editor/u)).toBeTruthy();
    primitive.unmount();
  });

  it("shows empty facts and query errors", async () => {
    const empty = renderWithClient(<FactsPanel projectId="demo" project={project as never} />);
    expect(await screen.findByText("FACT REGISTER")).toBeTruthy();
    expect(empty.container.querySelectorAll(".empty").length).toBeGreaterThan(0);
    empty.unmount();

    apiFetch.mockImplementationOnce(() => Promise.reject(new Error("facts query failed")));
    const error = renderWithClient(<FactsPanel projectId="demo" project={project as never} />);
    await waitFor(() => expect(error.container.textContent).toContain("FACT REGISTER"));
    error.unmount();
  });
});
describe("dashboard plugin branch matrix", () => {
  const proposal = {
    id: "proposal-extra", task_id: "task-extra", project_id: "demo", owner: "plugin-creator",
    proposal_revision: revision, base_workflow_revision: 3,
    value: { plugin_id: "official.ejs", capabilities: ["ejs"], template_id: "template-extra", resolved_source_hash: revision },
  };

  it("covers selection normalization and preview/review mutation errors", async () => {
    let rejectBegin: ((error: Error) => void) | undefined;
    let rejectReview: ((error: Error) => void) | undefined;
    apiFetch.mockImplementation((path) => {
      if (path === "/api/plugins/demo") return Promise.resolve({
        project_id: "demo", workflow_stage: "authoring", workflow_revision: 3, selection: { selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }, { plugin_id: "official.ejs", capabilities: ["html.status_bar"] }] }, sources: [], artifacts: [], diagnostics: [], pending_proposals: [proposal],
      });
      if (path === "/api/plugins/demo/revision-preview") return Promise.resolve({ workflow_revision: 3, intent: {
        schema_version: 1, project_id: "demo", revision, project_kind: "character_card", base_selection_revision: "absent",
        selections: [], dependency_closure: [], implementation_pins: [],
      } });
      if (path === "/api/plugins/demo/revision-begin") return new Promise((_, reject) => { rejectBegin = reject; });
      if (path === "/api/plugins/demo/decision-token") return Promise.resolve({ token: "t".repeat(43) });
      if (path === "/api/plugins/demo/review") return new Promise((_, reject) => { rejectReview = reject; });
      return defaultApi(path);
    });
    const view = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(await screen.findByText("template-extra")).toBeTruthy();
    const mvu = screen.getByLabelText("MVU / Zod");
    fireEvent.click(mvu);
    fireEvent.click(mvu);
    fireEvent.click(screen.getByLabelText("EJS"));
    const controls = view.container.querySelector(".plugin-revision-controls");
    if (!(controls instanceof HTMLElement)) throw new Error("plugin controls missing");
    const previewButton = controls.querySelector("button.action.secondary");
    if (!(previewButton instanceof HTMLButtonElement)) throw new Error("preview button missing");
    fireEvent.click(previewButton);
    expect(await screen.findByText("none")).toBeTruthy();
    const beginButton = controls.querySelector("button.action:not(.secondary)");
    if (!(beginButton instanceof HTMLButtonElement)) throw new Error("begin button missing");
    fireEvent.click(beginButton);
    await waitFor(() => expect(beginButton.disabled).toBe(true));
    rejectBegin?.(new Error("revision begin failed"));
    expect(await screen.findByText("revision begin failed")).toBeTruthy();

    const proposalCard = [...view.container.querySelectorAll("article")].find((item) => item.textContent?.includes("task-extra"));
    const approve = proposalCard?.querySelector("button.action");
    if (!(approve instanceof HTMLButtonElement)) throw new Error("proposal action missing");
    fireEvent.click(approve);
    const confirm = view.container.querySelector(".plugin-review-confirm button.action:not(.secondary)");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("confirmation action missing");
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    rejectReview?.(new Error("review failed"));
    expect(await screen.findByText("review failed")).toBeTruthy();
  });

  it("reports unavailable workflow revision before issuing a token", async () => {
    apiFetch.mockImplementation((path) => {
      if (path === "/api/plugins/demo") return Promise.resolve({ project_id: "demo", selection: { selections: [] }, sources: [], artifacts: [], diagnostics: [], pending_proposals: [proposal] });
      return defaultApi(path);
    });
    const view = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(await screen.findByText("template-extra")).toBeTruthy();
    const proposalCard = [...view.container.querySelectorAll("article")].find((item) => item.textContent?.includes("task-extra"));
    const approve = proposalCard?.querySelector("button.action");
    if (!(approve instanceof HTMLButtonElement)) throw new Error("proposal action missing");
    fireEvent.click(approve);
    const confirm = view.container.querySelector(".plugin-review-confirm button.action:not(.secondary)");
    if (!(confirm instanceof HTMLButtonElement)) throw new Error("confirmation action missing");
    fireEvent.click(confirm);
    expect(await screen.findByText("Workflow revision unavailable")).toBeTruthy();
  });

  it("formats heterogeneous source rows and handles sparse plugin payloads", async () => {
    apiFetch.mockImplementation((path) => {
      if (path === "/api/sources/demo") return Promise.resolve([
        { id: 42, title: { nested: true }, tier: null, current_revision_id: true },
        { id: "source-2", title: "Title", tier: 7, current_revision_id: BigInt(2) },
        { tier: false, current_revision_id: Symbol("opaque") },
      ]);
      if (path === "/api/plugins/demo") return Promise.resolve({ project_id: "demo", blueprint_selections: [], diagnostics: [{}] });
      return defaultApi(path);
    });
    const sources = renderWithClient(<DashboardSection section="sources" projectId="demo" project={project as never} />);
    expect(await screen.findByText('{"nested":true}')).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
    sources.unmount();

    const emptyCharacters = renderWithClient(<DashboardSection section="characters" projectId="demo" project={{ ...project, characters: [] } as never} />);
    expect(emptyCharacters.container.querySelectorAll(".empty").length).toBeGreaterThan(0);
    emptyCharacters.unmount();

    const plugins = renderWithClient(<DashboardSection section="plugins" projectId="demo" project={project as never} />);
    expect(await screen.findByText("-- · revision --")).toBeTruthy();
    const controls = plugins.container.querySelector(".plugin-revision-controls");
    if (!(controls instanceof HTMLElement)) throw new Error("plugin controls missing");
    const preview = controls.querySelector("button.action.secondary");
    if (!(preview instanceof HTMLButtonElement)) throw new Error("preview button missing");
    fireEvent.click(preview);
    expect(await screen.findByText("Workflow revision unavailable")).toBeTruthy();
  });});
