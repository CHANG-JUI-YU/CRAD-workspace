// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResourceEditor } from "../src/features/editor/ResourceEditor";
import { GateActions } from "../src/features/gates/GateActions";

const apiFetch = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../src/api/client", () => ({ apiFetch: (...args: unknown[]): Promise<unknown> => apiFetch(...args) }));
vi.mock("@monaco-editor/react", () => ({ default: () => React.createElement("div", null, "Monaco") }));
vi.mock("../src/features/editor/monaco", () => ({}));

afterEach(() => {
  apiFetch.mockReset();
  vi.restoreAllMocks();
});

function renderWithClient(element: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(React.createElement(QueryClientProvider, { client }, element));
}

function requestBody(path: string, index = 0): Record<string, unknown> {
  const call = apiFetch.mock.calls.filter(([candidate]) => candidate === path)[index];
  const init = call?.[1];
  if (typeof init !== "object" || init === null || !("body" in init) || typeof init.body !== "string") {
    throw new Error(`Missing JSON body for ${path} call ${index}`);
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("ResourceEditor", () => {
  it("dry-runs a typed change before applying the same revision-locked patch", async () => {
    let patchCount = 0;
    apiFetch.mockImplementation((path) => {
      if (path === "/api/documents/read") return Promise.resolve({ resource: { project_id: "demo", kind: "blueprint", id: "blueprint" }, format: "yaml", value: { schema_version: 1, purpose: "Old" }, semantic_revision: "sha256:12345678901234567890", raw_revision: "sha256:raw", read_only: false });
      if (path === "/api/documents/patch") {
        patchCount += 1;
        return Promise.resolve({ differences: [{ path: "/purpose" }], value: { schema_version: 1, purpose: "New" }, after_revision: "sha256:new", no_op: false, dry_run: patchCount === 1 });
      }
      return Promise.reject(new Error(`Unexpected API path: ${String(path)}`));
    });

    renderWithClient(React.createElement(ResourceEditor, { label: "Blueprint", resource: { project_id: "demo", kind: "blueprint", id: "blueprint" } }));
    const purpose = await screen.findByDisplayValue("Old");
    fireEvent.change(purpose, { target: { value: "New" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run" }));
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "確認儲存" });
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => path === "/api/documents/patch")).toHaveLength(2));
    expect(requestBody("/api/documents/patch", 0)).toMatchObject({ expected_revision: "sha256:12345678901234567890", dry_run: true });
    expect(requestBody("/api/documents/patch", 1)).toMatchObject({ expected_revision: "sha256:12345678901234567890", dry_run: false });
  });
});

describe("GateActions", () => {
  it("submits the exact gate inputs through the workflow API", async () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    apiFetch.mockResolvedValue({ workflow: { revision: 4 } });
    renderWithClient(React.createElement(GateActions, {
      projectId: "demo",
      workflow: {
        stage: "content_review",
        revision: 3,
        artifacts: [],
        tasks: [],
        decisions: [],
        gates: [{ id: "content", status: "pending", input_revisions: [{ id: "character", revision: "sha256:character" }] }],
      } as never,
    }));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(requestBody("/api/workflow/gate")).toMatchObject({
      project_id: "demo",
      expected_workflow_revision: 3,
      gate_id: "content",
      action: "approve",
      input_revisions: [{ id: "character", revision: "sha256:character" }],
    });
  });
});
