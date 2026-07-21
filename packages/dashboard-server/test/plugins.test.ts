import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compileMvuSource,
  materializePluginTemplate,
  officialPluginImplementationPin,
  pendingResultRevisionFor,
  proposalRevisionFor,
  revisionFor,
} from "@card-workspace/plugins";
import { buildProject } from "@card-workspace/compiler";
import { readCardFromPng } from "@card-workspace/adapters-png";
import {
  canonicalJson,
  computeTextRevision,
  savePluginTemplateIdempotent,
  initializeProject,
  loadAuthorProject,
  publishForgeArtifacts,
} from "@card-workspace/project";
import {
  pluginProposalEnvelopeSchema,
  pluginSourceSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  projectManifestSchema,
  workflowStateSchema,
  type MvuSource,
} from "@card-workspace/schemas";
import { buildCharacterCardPng, makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginPluginRevision,
  commitWorkflowMutation,
  submitPluginProposal,
} from "@card-workspace/workflow";
import { createDashboardServer } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function mvuSource(): MvuSource {
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation: officialPluginImplementationPin("official.mvu-zod"),
    variables: [{
      id: "mood",
      label: "Mood",
      kind: "string",
      default: "calm",
      writable: true,
      update_rules: ["Update mood when the scene changes."],
    }],
    update_rules: [],
  };
}

describe("plugin approval lifecycle", () => {
  it("persists revision, proposal, server token approval, and replay rejection", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "plugin-approval-e2e";
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: "Plugin approval E2E",
        kind: "character_card",
        card: { name: "Plugin approval E2E" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    await mkdir(path.join(projectRoot, "assets"), { recursive: true });
    await writeFile(path.join(projectRoot, "assets", "avatar.png"), buildCharacterCardPng());

    const initial = await loadAuthorProject(workspace.projectsRoot, projectId);
    if (!initial.ok || !initial.workflow) throw new Error("initial plugin project failed to load");
    const implementation = mvuSource().implementation;
    const started = beginPluginRevision({
      state: initial.workflow,
      project: initial,
      occurredAt: new Date().toISOString(),
      actor: "director",
      desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
      implementationPins: { "official.mvu-zod": implementation },
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: initial.workflow.revision,
      eventId: "plugin-approval-revision-begin",
      actor: "director",
      occurredAt: new Date().toISOString(),
      update: () => started,
    });

    const afterBegin = await loadAuthorProject(workspace.projectsRoot, projectId);
    if (!afterBegin.ok || !afterBegin.workflow) throw new Error("revision begin was not persisted");
    const authorTask = afterBegin.workflow.tasks.find((task) => task.kind === "create-plugin-mvu");
    if (!authorTask) throw new Error("MVU author task was not materialized");
    const claimedTask = {
      ...authorTask,
      status: "claimed" as const,
      lease: {
        id: "plugin-mvu-lease",
        owner: "mvu-creator",
        claimed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    };
    const claimed = await commitWorkflowMutation(projectRoot, {
      expectedRevision: afterBegin.workflow.revision,
      eventId: "plugin-approval-task-claim",
      actor: "mvu-creator",
      occurredAt: new Date().toISOString(),
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        tasks: state.tasks.map((task) => task.id === authorTask.id ? claimedTask : task),
      }),
    });

    const templateSource = pluginSourceSchema.parse({ ...mvuSource(), template_id: "approval-template" });
    const templatePayload = pluginTemplatePayloadSchema.parse({
      schema_version: 1,
      template_id: "approval-template",
      plugin_id: "official.mvu-zod",
      parameters: { "/variables/0/default": "calm" },
      payload: templateSource,
    });
    const templateManifest = pluginTemplateManifestSchema.parse({
      schema_version: 1,
      id: "approval-template",
      plugin_id: "official.mvu-zod",
      implementation: templateSource.implementation,
      description: "Approval lifecycle template",
      parameters: [{ pointer: "/variables/0/default", type: "string" }],
      payload_revision: computeTextRevision(canonicalJson(templatePayload)),
      source_revision: revisionFor(templateSource),
      resolved_source_hash: revisionFor(templateSource),
      provenance: { kind: "imported" },
      created_at: "2026-07-20T00:00:00.000Z",
    });
    await savePluginTemplateIdempotent(
      projectRoot,
      "official.mvu-zod",
      "approval-template",
      templateManifest,
      templatePayload,
    );
    const resolved = materializePluginTemplate(templateManifest, templatePayload, {
      "/variables/0/default": "focused",
    });
    const source = resolved.source;
    const generated = compileMvuSource(source);
    const manifestRaw = await readFile(path.join(projectRoot, "project.yaml"), "utf8");
    const proposalSeed = {
      schema_version: 1 as const,
      id: "plugin-approval-proposal",
      task_id: authorTask.id,
      project_id: projectId,
      owner: "mvu-creator",
      proposal_revision: `sha256:${"0".repeat(64)}`,
      base_workflow_revision: claimed.revision,
      value: {
        kind: "plugin" as const,
        project_kind: "character_card" as const,
        plugin_id: "official.mvu-zod" as const,
        capabilities: ["mvu" as const],
        source,
         expected_source_revision: "absent" as const,
         expected_manifest_revision: computeTextRevision(manifestRaw),
         template_id: "approval-template",
         template_payload_hash: templateManifest.payload_revision,
         resolved_source_hash: generated.contributions.metadata.resolved_source_hash as `sha256:${string}`,
      },
      pending_result_revision: `sha256:${"0".repeat(64)}`,
      submitted_at: new Date().toISOString(),
    };
    const parsedProposalSeed = pluginProposalEnvelopeSchema.parse(proposalSeed);
    const proposalWithRevision = {
      ...parsedProposalSeed,
      proposal_revision: proposalRevisionFor(parsedProposalSeed),
    };
    const proposal = pluginProposalEnvelopeSchema.parse({
      ...proposalWithRevision,
      pending_result_revision: pendingResultRevisionFor(proposalWithRevision),
    });
    const pending = await submitPluginProposal({
      projectRoot,
      state: claimed,
      taskId: authorTask.id,
      owner: "mvu-creator",
      proposal,
      occurredAt: new Date().toISOString(),
    });
    expect(pending.tasks.find((task) => task.id === authorTask.id)).toMatchObject({ status: "completed" });

    const now = Date.now();
    const dashboard = createDashboardServer({
      context: {
        workspaceRoot: workspace.root,
        projectsRoot: workspace.projectsRoot,
        exportsRoot: workspace.exportsRoot,
      },
      bootstrapToken: "b".repeat(48),
    });
    const requestHeaders = { host: "127.0.0.1:4319", origin: "http://127.0.0.1:4319" };
    const bootstrap = await dashboard.app.inject({
      method: "POST",
      url: "/api/session/bootstrap",
      headers: requestHeaders,
      payload: { token: "b".repeat(48) },
    });
    expect(bootstrap.statusCode).toBe(200);
    const cookieHeader = bootstrap.headers["set-cookie"];
    const cookie = `${Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader}`.split(";")[0] ?? "";
    const csrf = bootstrap.json<{ data: { csrf_token: string } }>().data.csrf_token;
    const authenticatedHeaders = { ...requestHeaders, cookie, "x-csrf-token": csrf };
    const pendingPath = path.join(projectRoot, ".workflow", "results", authorTask.id, `${proposal.id}.json`);
    const pendingBytes = await readFile(pendingPath, "utf8");
    await writeFile(pendingPath, "tampered-pending-proposal\n", "utf8");
    const driftTokenResponse = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/decision-token`,
      headers: authenticatedHeaders,
      payload: {
        proposal_id: proposal.id,
        proposal_revision: proposal.proposal_revision,
        decision: "approve",
        workflow_revision: pending.revision,
      },
    });
    expect(driftTokenResponse.statusCode).toBe(200);
    const driftToken = driftTokenResponse.json<{ data: { token: string } }>().data.token;
    const driftReview = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/review`,
      headers: authenticatedHeaders,
      payload: {
        expected_workflow_revision: pending.revision,
        proposal,
        action: "approve",
        authorization_token: driftToken,
        occurred_at: new Date(now + 500).toISOString(),
      },
    });
    expect(driftReview.statusCode).toBeGreaterThanOrEqual(400);
    await writeFile(pendingPath, pendingBytes, "utf8");
    const tokenResponse = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/decision-token`,
      headers: authenticatedHeaders,
      payload: {
        proposal_id: proposal.id,
        proposal_revision: proposal.proposal_revision,
        decision: "approve",
        workflow_revision: pending.revision,
      },
    });
    expect(tokenResponse.statusCode).toBe(200);
    const issued = tokenResponse.json<{ data: { token: string } }>().data;
    const reviewResponse = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/review`,
      headers: authenticatedHeaders,
      payload: {
        expected_workflow_revision: pending.revision,
        proposal,
        action: "approve",
        authorization_token: issued.token,
        occurred_at: new Date(now + 1_000).toISOString(),
      },
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json<{ data: { decisions: Array<{ kind: string; actor: string }> } }>().data.decisions.at(-1))
      .toMatchObject({ kind: "plugin.review.approved", actor: "dashboard-user" });

    const reloaded = await loadAuthorProject(workspace.projectsRoot, projectId);
    expect(reloaded.ok).toBe(true);
    expect(reloaded.diagnostics).toEqual([]);
    expect(reloaded.pluginSources?.map((item) => item.plugin_id)).toEqual(["official.mvu-zod"]);
    expect(reloaded.pluginSelection?.selections).toHaveLength(1);
    expect(reloaded.pluginArtifacts?.[0]).toMatchObject({ id: "plugin-official.mvu-zod", status: "approved" });

    const build = await buildProject({
      workspaceRoot: workspace.root,
      projectId,
      json: true,
      png: true,
    });
    expect(build.manifest.plugin_artifacts).toHaveLength(1);
    expect(build.png).toBeDefined();
    expect(readCardFromPng(build.png!).card).toEqual(build.card);
    expect(build.publishPlan.operations.map((operation) => operation.relativePath)).toContain(
      `projects/${projectId}/.build/plugin-build-trace.json`,
    );
    const buildFiles = build.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith(`projects/${projectId}/.build/`))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    const exportFiles = build.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith(`exports/${projectId}/`))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId,
      buildFiles,
      exportFiles,
      sourceRevisions: Object.fromEntries(build.publishPlan.expectations.map((expectation) => [expectation.relativePath, expectation.expectedRawRevision])),
    });
    await expect(readFile(path.join(projectRoot, ".build", "plugin-build-trace.json"), "utf8"))
      .resolves.toContain("plugin-official.mvu-zod");
    const publishedPng = await readFile(path.join(workspace.exportsRoot, projectId, `${projectId}.png`));
    expect(readCardFromPng(publishedPng).card).toEqual(build.card);
    const replay = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/review`,
      headers: authenticatedHeaders,
      payload: {
        expected_workflow_revision: reloaded.workflow?.revision,
        proposal,
        action: "approve",
        authorization_token: issued.token,
        occurred_at: new Date(now + 2_000).toISOString(),
      },
    });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
    await dashboard.app.close();
  });

  it("previews and begins a dependency-closed revision with server-owned pins", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "plugin-revision-route";
    await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: "Plugin revision route",
        kind: "character_card",
        card: { name: "Plugin revision route" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    const initial = await loadAuthorProject(workspace.projectsRoot, projectId);
    if (!initial.ok || !initial.workflow) throw new Error("revision route fixture failed to load");

    const dashboard = createDashboardServer({
      context: { workspaceRoot: workspace.root, projectsRoot: workspace.projectsRoot, exportsRoot: workspace.exportsRoot },
      bootstrapToken: "r".repeat(48),
    });
    const requestHeaders = { host: "127.0.0.1:4320", origin: "http://127.0.0.1:4320" };
    const bootstrap = await dashboard.app.inject({ method: "POST", url: "/api/session/bootstrap", headers: requestHeaders, payload: { token: "r".repeat(48) } });
    expect(bootstrap.statusCode).toBe(200);
    const cookieHeader = bootstrap.headers["set-cookie"];
    const cookie = `${Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader}`.split(";")[0] ?? "";
    const csrf = bootstrap.json<{ data: { csrf_token: string } }>().data.csrf_token;
    const authenticatedHeaders = { ...requestHeaders, cookie, "x-csrf-token": csrf };
    const selections = [
      { plugin_id: "official.ejs", capabilities: ["ejs"] },
      { plugin_id: "official.html", capabilities: ["html.status_bar"] },
    ];
    const preview = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/revision-preview`,
      headers: authenticatedHeaders,
      payload: { expected_workflow_revision: initial.workflow.revision, desired_selections: selections },
    });
    expect(preview.statusCode).toBe(200);
    const previewData = preview.json<{ data: { intent: { dependency_closure: string[]; implementation_pins: Array<{ plugin_id: string; implementation: unknown }> } } }>().data.intent;
    expect(previewData.dependency_closure).toEqual(["official.ejs", "official.html", "official.mvu-zod"]);
    expect(previewData.implementation_pins.map((pin) => pin.plugin_id)).toEqual(["official.ejs", "official.html", "official.mvu-zod"]);
    expect(previewData.implementation_pins.find((pin) => pin.plugin_id === "official.mvu-zod")?.implementation)
      .toEqual(officialPluginImplementationPin("official.mvu-zod"));

    const begin = await dashboard.app.inject({
      method: "POST",
      url: `/api/plugins/${projectId}/revision-begin`,
      headers: authenticatedHeaders,
      payload: {
        expected_workflow_revision: initial.workflow.revision,
        desired_selections: selections,
        event_id: "plugin-revision-route-begin",
        occurred_at: "2026-07-20T00:00:00.000Z",
      },
    });
    expect(begin.statusCode).toBe(200);
    expect(begin.json<{ data: { workflow: { stage: string; revision: number; tasks: Array<{ id: string }> } } }>().data.workflow)
      .toMatchObject({ stage: "plugin_mvu_authoring", revision: initial.workflow.revision + 1, tasks: [{ id: "create-official-mvu-zod" }] });
    await dashboard.app.close();
  });
});
