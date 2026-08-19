import type { Server } from "node:http";
import { CoreError } from "@st-workspace/core";
import type { WorkspaceRuntime, WorkspaceWorker } from "@st-workspace/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboard } from "../src/dashboard.js";
import { createWorkspaceServer } from "../src/index.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startContractServer() {
  const calls: Array<Record<string, unknown>> = [];
  const publishProvenanceConfirm = vi.fn(async (input: Record<string, unknown>) => {
    calls.push(input);
    if (input.fingerprint === "stale-fingerprint") {
      throw new CoreError("PROVENANCE_CONFIRMATION_STALE", "stale confirmation", true);
    }
    const republished = input.republish === true;
    return {
      operation_id: republished ? "op-republish" : "op-replay",
      publish_id: republished ? "publish-republish" : "publish-replay",
      status: "completed",
      summary: republished ? "republished" : "replayed",
      completed: [],
      blocked: [],
      execution_kind: republished ? "republished" : "replayed",
      idempotent_replay: !republished,
    };
  });
  const runtime = { publishProvenanceConfirm } as unknown as WorkspaceRuntime;
  const worker = {
    stop: vi.fn(async () => undefined),
    status: vi.fn(() => ({ running: false })),
  } as unknown as WorkspaceWorker;
  const server = createWorkspaceServer({ runtime, worker, actor: "audit13", autoStartWorker: false });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected server address");
  return { url: `http://127.0.0.1:${address.port}`, calls, publishProvenanceConfirm };
}

async function confirm(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${url}/workspace/publish/provenance/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Confirm": "publish",
    },
    body: JSON.stringify(body),
  });
}

function extractFunction(source: string, name: string): string {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`function not found: ${name}`);
  let bodyStarted = false;
  let depth = 0;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const char = source[index];
    if (!bodyStarted) {
      if (char === "{") {
        bodyStarted = true;
        depth = 1;
      }
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

type Control = {
  disabled: boolean;
  textContent: string;
  attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
};

function control(): Control {
  const attrs = new Map<string, string>();
  return {
    disabled: false,
    textContent: "",
    attrs,
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
  };
}

async function executePublishUi(postJson: (...args: any[]) => Promise<any>) {
  const confirmButton = control();
  const primaryCta = control();
  const message = control();
  const controls = new Map<string, Control>([
    ["confirm-publish", confirmButton],
    ["publish-primary-cta", primaryCta],
    ["provenance-confirm-message", message],
  ]);
  const confirmation = {
    fingerprint: "fingerprint-1",
    republish: false,
    in_flight: false,
    completed: false,
    result: null as unknown,
  };
  const publishStepperState = { stage: "provenance_reviewed", status: "current" };
  const updatePublishStepper = vi.fn();
  const syncAllControls = vi.fn();
  const renderStaleDiff = vi.fn();
  const loadPublishCompletion = vi.fn();
  const source = extractFunction(dashboard(), "triggerConfirmPublish");
  const factory = new Function(
    "currentProvenanceConfirmation",
    "setNotice",
    "byId",
    "runTask",
    "postJson",
    "loadDashboardData",
    "loadProvenanceHistory",
    "loadPublishCompletion",
    "renderStaleDiff",
    "document",
    "updatePublishStepper",
    "publishStepperState",
    "syncAllControls",
    `${source}; return triggerConfirmPublish;`,
  );
  const trigger = factory(
    confirmation,
    vi.fn(),
    (id: string) => controls.get(id),
    async (_label: string, task: () => Promise<unknown>) => task(),
    postJson,
    vi.fn(async () => ({})),
    vi.fn(async () => ({})),
    loadPublishCompletion,
    renderStaleDiff,
    { querySelector: vi.fn(() => null) },
    updatePublishStepper,
    publishStepperState,
    syncAllControls,
  ) as () => Promise<unknown>;
  return { trigger, confirmation, confirmButton, primaryCta, message, updatePublishStepper, syncAllControls, renderStaleDiff };
}

describe("Audit 13 #203 publish confirmation REST contract", () => {
  it("accepts omitted, false, and true republish values and preserves them to Runtime", async () => {
    const server = await startContractServer();

    const omitted = await confirm(server.url, { fingerprint: "fp-omitted" });
    expect(omitted.status).toBe(200);
    expect(await omitted.json()).toMatchObject({ execution_kind: "replayed" });
    expect(server.calls[0]).not.toHaveProperty("republish");

    const explicitFalse = await confirm(server.url, { fingerprint: "fp-false", republish: false });
    expect(explicitFalse.status).toBe(200);
    expect(await explicitFalse.json()).toMatchObject({ execution_kind: "replayed" });
    expect(server.calls[1]).toMatchObject({ fingerprint: "fp-false", republish: false });

    const explicitTrue = await confirm(server.url, { fingerprint: "fp-true", republish: true });
    expect(explicitTrue.status).toBe(200);
    expect(await explicitTrue.json()).toMatchObject({ execution_kind: "republished" });
    expect(server.calls[2]).toMatchObject({ fingerprint: "fp-true", republish: true });
  });

  it("keeps the confirmation schema strict and reports stale fingerprints", async () => {
    const server = await startContractServer();

    const unknown = await confirm(server.url, { fingerprint: "fp", republish: false, unknown_field: true });
    expect(unknown.status).toBe(400);
    expect(server.publishProvenanceConfirm).not.toHaveBeenCalled();

    const stale = await confirm(server.url, { fingerprint: "stale-fingerprint", republish: false });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "PROVENANCE_CONFIRMATION_STALE" });
  });
});

describe("Audit 13 #203 Dashboard publish loading-state recovery", () => {
  it.each([
    ["HTTP 400", Object.assign(new Error("bad request"), { code: "PROVENANCE_CONFIRMATION_REQUIRED" })],
    ["HTTP 409", Object.assign(new Error("conflict"), { code: "IDEMPOTENCY_CONFLICT" })],
    ["network", new Error("network unavailable")],
  ])("restores controls after %s failure", async (_label, error) => {
    const ui = await executePublishUi(async () => { throw error; });
    await expect(ui.trigger()).rejects.toBe(error);
    expect(ui.confirmation.in_flight).toBe(false);
    expect(ui.confirmButton.disabled).toBe(false);
    expect(ui.primaryCta.disabled).toBe(false);
    expect(ui.primaryCta.getAttribute("aria-busy")).toBeNull();
    expect(ui.syncAllControls).toHaveBeenCalled();
  });

  it("restores controls and marks successful publish complete", async () => {
    const ui = await executePublishUi(async () => ({
      status: "completed",
      execution_kind: "republished",
      publish_id: "publish-2",
      build_id: "build-2",
      published_at: "2026-08-19T08:00:00.000Z",
    }));
    await expect(ui.trigger()).resolves.toMatchObject({ status: "completed", execution_kind: "republished" });
    expect(ui.confirmation.in_flight).toBe(false);
    expect(ui.confirmation.completed).toBe(true);
    expect(ui.confirmButton.disabled).toBe(false);
    expect(ui.primaryCta.disabled).toBe(false);
    expect(ui.primaryCta.getAttribute("aria-busy")).toBeNull();
    expect(ui.updatePublishStepper).toHaveBeenCalledWith("published", "pass");
    expect(ui.syncAllControls).toHaveBeenCalled();
  });
});
