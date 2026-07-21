import { afterEach, describe, expect, it } from "vitest";

import { initializeProject } from "@card-workspace/project";
import { projectManifestSchema, workflowStateSchema } from "@card-workspace/schemas";
import { makeTemporaryWorkspace, type TemporaryWorkspace } from "@card-workspace/testing";
import { commitWorkflowMutation } from "@card-workspace/workflow";

import { createDashboardServer } from "../src/index.js";

const bootstrap = "d".repeat(48);
const host = "127.0.0.1:4317";
const origin = `http://${host}`;
let workspace: TemporaryWorkspace | undefined;

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function setup() {
  workspace = await makeTemporaryWorkspace();
  await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1, id: "dashboard-demo", title: "Dashboard Demo", kind: "character_card",
      characters: [{ id: "hero", display_name: "Hero", mode: "zhuji", role: "primary" }],
      card: { name: "Hero" },
    }),
  });
  const created = createDashboardServer({
    context: { workspaceRoot: workspace.root, projectsRoot: workspace.projectsRoot, exportsRoot: workspace.exportsRoot },
    bootstrapToken: bootstrap,
  });
  const authenticated = await created.app.inject({ method: "POST", url: "/api/session/bootstrap", headers: { host, origin }, payload: { token: bootstrap } });
  return {
    ...created,
    cookie: firstHeader(authenticated.headers["set-cookie"]).split(";")[0] ?? "",
    csrf: authenticated.json<{ data: { csrf_token: string } }>().data.csrf_token,
  };
}

afterEach(async () => { await workspace?.cleanup(); workspace = undefined; });

describe("dashboard domain routes", () => {
  it("lists projects and reads typed documents without accepting paths", async () => {
    const { app, cookie, csrf } = await setup();
    const headers = { host, cookie };
    const list = await app.inject({ method: "GET", url: "/api/projects", headers });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ data: Array<Record<string, unknown>> }>().data[0]).toMatchObject({ id: "dashboard-demo", valid: true, character_count: 1 });
    const document = await app.inject({
      method: "POST", url: "/api/documents/read", headers: { ...headers, origin, "x-csrf-token": csrf },
      payload: { project_id: "dashboard-demo", kind: "blueprint", id: "blueprint" },
    });
    expect(document.statusCode).toBe(200);
    const pathAttempt = await app.inject({
      method: "POST", url: "/api/documents/read", headers: { ...headers, origin, "x-csrf-token": csrf },
      payload: { project_id: "dashboard-demo", kind: "blueprint", id: "blueprint", file_path: "../../secret" },
    });
    expect(pathAttempt.statusCode).toBe(400);
    await app.close();
  });

  it("dry-runs then applies a revision-locked patch", async () => {
    const { app, cookie, csrf } = await setup();
    const headers = { host, origin, cookie, "x-csrf-token": csrf };
    const resource = { project_id: "dashboard-demo", kind: "blueprint", id: "blueprint" };
    const read = await app.inject({ method: "POST", url: "/api/documents/read", headers, payload: resource });
    const revision = read.json<{ data: { semantic_revision: string } }>().data.semantic_revision;
    const payload = { resource, expected_revision: revision, operations: [{ op: "replace", path: "/purpose", value: "Dashboard edited" }], dry_run: true };
    const preview = await app.inject({ method: "POST", url: "/api/documents/patch", headers, payload });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ data: { dry_run: boolean } }>().data.dry_run).toBe(true);
    const applied = await app.inject({ method: "POST", url: "/api/documents/patch", headers, payload: { ...payload, dry_run: false } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json<{ data: { value: { purpose: string } } }>().data.value.purpose).toBe("Dashboard edited");
    const stale = await app.inject({ method: "POST", url: "/api/documents/patch", headers, payload: { ...payload, dry_run: false } });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("serves workflow, ingestion, provenance, planner, and simulation from domain APIs", async () => {
    const { app, cookie, csrf } = await setup();
    const getHeaders = { host, cookie };
    const postHeaders = { host, origin, cookie, "x-csrf-token": csrf };

    for (const url of [
      "/api/projects/dashboard-demo",
      "/api/projects/dashboard-demo/health",
      "/api/workflow/dashboard-demo",
      "/api/sources/dashboard-demo",
      "/api/facts/dashboard-demo/candidates",
      "/api/provenance/dashboard-demo/verify",
      "/api/planner/dashboard-demo",
    ]) {
      const response = await app.inject({ method: "GET", url, headers: getHeaders });
      expect(response.statusCode, url).toBe(200);
      expect(response.json<{ ok: boolean }>().ok, url).toBe(true);
    }

    const facts = await app.inject({
      method: "POST",
      url: "/api/facts/query",
      headers: postHeaders,
      payload: { project_id: "dashboard-demo", filter: {} },
    });
    expect(facts.statusCode).toBe(200);
    expect(facts.json<{ data: { facts: unknown[] } }>().data.facts).toEqual([]);
    const candidates = await app.inject({ method: "GET", url: "/api/facts/dashboard-demo/candidates", headers: getHeaders });
    expect(candidates.json<{ data: unknown[] }>().data).toEqual([]);

    const simulation = await app.inject({
      method: "POST",
      url: "/api/planner/simulate",
      headers: postHeaders,
      payload: { project_id: "dashboard-demo", conversation: ["Hero enters."], token_budget: 8000, strict: false },
    });
    expect(simulation.statusCode).toBe(200);
    const simulationData = simulation.json<{ data: { token: unknown; trigger: unknown; plan: unknown } }>().data;
    expect(simulationData.token).toBeDefined();
    expect(simulationData.trigger).toBeDefined();
    expect(simulationData.plan).toBeDefined();

    await app.close();
  });

  it("lists exact previews, derives publish findings, publishes, downloads, and analyzes round-trips", async () => {
    const { app, cookie, csrf } = await setup();
    if (!workspace) throw new Error("workspace unavailable");
    const getHeaders = { host, cookie };
    const postHeaders = { host, origin, cookie, "x-csrf-token": csrf };
    await commitWorkflowMutation(`${workspace.projectsRoot}/dashboard-demo`, {
      expectedRevision: 0, eventId: "ready-for-preview", actor: "engine", occurredAt: "2026-07-15T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "compile_preview",
        artifacts: [{ id: "author-content", status: "approved", revision: `sha256:${"a".repeat(64)}`, updated_at: "2026-07-15T00:00:00.000Z", extensions: {} }], gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [{ id: "author-content", revision: `sha256:${"a".repeat(64)}` }], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ] }),
    });

    const created = await app.inject({
      method: "POST", url: "/api/builds/preview", headers: postHeaders,
      payload: { project_id: "dashboard-demo", preview_id: "preview-dashboard", event_id: "create-preview", strict: true, token_budget: 8000, json: true, png: false, v2_backfill: false },
    });
    expect(created.statusCode).toBe(200);
    const preview = created.json<{ data: { id: string; revision: string; audit: { findings: unknown[] } } }>().data;
    const listed = await app.inject({ method: "GET", url: "/api/builds/dashboard-demo/previews", headers: getHeaders });
    expect(listed.json<{ data: Array<{ preview: { id: string }; status: string }> }>().data).toMatchObject([{ preview: { id: "preview-dashboard" }, status: "reviewed" }]);

    const staleGate = await app.inject({
      method: "POST", url: "/api/workflow/gate", headers: postHeaders,
      payload: { project_id: "dashboard-demo", expected_workflow_revision: 2, event_id: "stale-gate", decision_id: "stale-publish", gate_id: "publish", action: "approve", summary: "stale", input_revisions: [{ id: preview.id, revision: `sha256:${"0".repeat(64)}` }], findings: [] },
    });
    expect(staleGate.statusCode).toBe(409);
    expect(staleGate.json<{ error: { code: string } }>().error.code).toBe("DASHBOARD_PUBLISH_INPUT_STALE");

    const approved = await app.inject({
      method: "POST", url: "/api/workflow/gate", headers: postHeaders,
      payload: { project_id: "dashboard-demo", expected_workflow_revision: 2, event_id: "approve-gate", decision_id: "approve-publish", gate_id: "publish", action: "approve", summary: "approved exact preview", input_revisions: [{ id: preview.id, revision: preview.revision }], findings: [] },
    });
    expect(approved.statusCode).toBe(200);
    const published = await app.inject({ method: "POST", url: "/api/builds/publish", headers: postHeaders, payload: { project_id: "dashboard-demo", preview_id: preview.id, event_id: "publish-dashboard-preview" } });
    expect(published.statusCode).toBe(200);
    expect(published.json<{ data: { result: { published: boolean } } }>().data.result.published).toBe(true);

    const exportsList = await app.inject({ method: "GET", url: "/api/builds/dashboard-demo/exports", headers: getHeaders });
    expect(exportsList.json<{ data: Array<{ id: string; read_only: boolean }> }>().data).toMatchObject([{ id: "dashboard-demo.json", read_only: true }]);
    const download = await app.inject({ method: "GET", url: "/api/builds/dashboard-demo/export/dashboard-demo.json", headers: getHeaders });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain("dashboard-demo.json");
    expect(download.body).toContain("chara_card_v3");
    const invalidDownload = await app.inject({ method: "GET", url: "/api/builds/dashboard-demo/export/secret.exe", headers: getHeaders });
    expect(invalidDownload.statusCode).toBe(400);

    const card = {
      spec: "chara_card_v3", spec_version: "3.0",
      data: { name: "Round Trip", description: "", personality: "", scenario: "", first_mes: "Hello", mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "", alternate_greetings: [], group_only_greetings: [], tags: [], creator: "", character_version: "1", extensions: {} },
    };
    const roundTrip = await app.inject({ method: "POST", url: "/api/builds/roundtrip", headers: postHeaders, payload: { bytes_base64: Buffer.from(JSON.stringify(card)).toString("base64") } });
    expect(roundTrip.statusCode).toBe(200);
    expect(roundTrip.json<{ data: { report: { status: string } } }>().data.report.status).toBe("equivalent");
    await app.close();
  });
});
