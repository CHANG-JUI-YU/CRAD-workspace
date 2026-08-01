import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  blueprintSchema,
  pluginProposalEnvelopeSchema,
  pluginSourceSchema,
  projectManifestSchema,
  workflowStateSchema,
  type PluginProposalEnvelope,
} from "@card-workspace/schemas";
import {
  computeTextRevision,
  initializeProject,
  loadAuthorProject,
} from "@card-workspace/project";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginPluginRevision,
  previewPluginRevision,
  claimTask,
  commitWorkflowMutation,
  decidePluginProposal,
  derivePluginDependencyImpact,
  submitPluginProposal,
} from "../src/index.js";
import {
  compileEjsSource,
  compileMvuSource,
  officialPluginImplementationPin,
  pendingResultRevisionFor,
  proposalResultText,
  proposalRevisionFor,
} from "@card-workspace/plugins";
import type { LoadedAuthorProject } from "@card-workspace/project";

const occurredAt = "2026-07-20T00:00:00.000Z";
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function submissionFixture(): Promise<{
  projectRoot: string;
  project: LoadedAuthorProject;
  claimed: Awaited<ReturnType<typeof commitWorkflowMutation>>;
  taskId: string;
  proposal: PluginProposalEnvelope;
}> {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectId = "plugin-submit-failure";
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: projectId,
      title: "Plugin submit failure",
      kind: "character_card",
      card: { name: "Plugin submit failure" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  const initial = await loadAuthorProject(workspace.projectsRoot, projectId);
  if (!initial.ok || !initial.workflow) throw new Error("plugin submit fixture failed to load");
  const implementation = officialPluginImplementationPin("official.mvu-zod");
  const started = beginPluginRevision({
    state: initial.workflow,
    project: initial,
    occurredAt,
    actor: "director",
    desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
    implementationPins: { "official.mvu-zod": implementation },
  });
  const startedWithPreview = workflowStateSchema.parse({ ...started, artifacts: [...started.artifacts, { id: "preview-seed", status: "draft" as const, revision: computeTextRevision("preview-seed"), updated_at: occurredAt, extensions: {} }] });
  const startedState = await commitWorkflowMutation(projectRoot, {
    expectedRevision: initial.workflow.revision,
    eventId: "plugin-submit-revision-begin",
    actor: "director",
    occurredAt,
    update: () => startedWithPreview,
  });
  const task = startedState.tasks.find((candidate) => candidate.kind === "create-plugin-mvu");
  if (!task) throw new Error("plugin submit fixture missing author task");
  const claimedTask = claimTask(task, {
    owner: "mvu-creator",
    leaseId: "plugin-submit-lease",
    leaseDurationMs: 60_000,
    completedTaskIds: new Set(),
  });
  const claimed = await commitWorkflowMutation(projectRoot, {
    expectedRevision: startedState.revision,
    eventId: "plugin-submit-task-claim",
    actor: "mvu-creator",
    occurredAt,
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      tasks: state.tasks.map((candidate) => candidate.id === task.id ? claimedTask : candidate),
    }),
  });
  const source = pluginSourceSchema.parse({
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm", writable: true, update_rules: ["Update mood"] }],
    update_rules: [],
  });
  const generated = compileMvuSource(source);
  const manifestRevision = computeTextRevision(await readFile(path.join(projectRoot, "project.yaml"), "utf8"));
  const seed = pluginProposalEnvelopeSchema.parse({
    schema_version: 1,
    id: "plugin-submit-failure-proposal",
    task_id: task.id,
    project_id: projectId,
    owner: "mvu-creator",
    proposal_revision: `sha256:${"0".repeat(64)}`,
    base_workflow_revision: claimed.revision,
    value: {
      kind: "plugin",
      project_kind: "character_card",
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source,
      expected_source_revision: "absent",
      expected_manifest_revision: manifestRevision,
      resolved_source_hash: generated.contributions.metadata.resolved_source_hash,
      template_payload_hash: `sha256:${"1".repeat(64)}`,
    },
    pending_result_revision: `sha256:${"0".repeat(64)}`,
    submitted_at: occurredAt,
  });
  const withProposalRevision = pluginProposalEnvelopeSchema.parse({
    ...seed,
    proposal_revision: proposalRevisionFor(seed),
  });
  const proposal = pluginProposalEnvelopeSchema.parse({
    ...withProposalRevision,
    pending_result_revision: pendingResultRevisionFor(withProposalRevision),
  });
  return { projectRoot, project: initial, claimed, taskId: task.id, proposal };
}

function withBaseWorkflowRevision(proposal: PluginProposalEnvelope, revision: number): PluginProposalEnvelope {
  const seed = pluginProposalEnvelopeSchema.parse({
    ...proposal,
    base_workflow_revision: revision,
    proposal_revision: `sha256:${"0".repeat(64)}`,
    pending_result_revision: `sha256:${"0".repeat(64)}`,
  });
  const withProposalRevision = pluginProposalEnvelopeSchema.parse({
    ...seed,
    proposal_revision: proposalRevisionFor(seed),
  });
  return pluginProposalEnvelopeSchema.parse({
    ...withProposalRevision,
    pending_result_revision: pendingResultRevisionFor(withProposalRevision),
  });
}

describe("plugin revision lifecycle", () => {
  it("只讓 MVU 變更使 EJS 與 HTML status bar evidence 失效", () => {
    const selections = [
      { schema_version: 1 as const, plugin_id: "official.ejs" as const, capabilities: ["ejs" as const], source_revision: `sha256:${"a".repeat(64)}`, implementation: officialPluginImplementationPin("official.ejs"), artifact_revision: `sha256:${"b".repeat(64)}` },
      { schema_version: 1 as const, plugin_id: "official.html" as const, capabilities: ["html.message_presentation" as const, "html.status_bar" as const], source_revision: `sha256:${"c".repeat(64)}`, implementation: officialPluginImplementationPin("official.html"), artifact_revision: `sha256:${"d".repeat(64)}` },
    ];

    expect(derivePluginDependencyImpact("official.mvu-zod", selections)).toEqual([
      "plugin-official.ejs",
      "plugin-official.html",
    ]);
    expect(derivePluginDependencyImpact("official.ejs", selections)).toEqual([]);
  });

  it("stores desired selections, base selection revision, dependency closure, and exact pins", () => {
    const manifest = projectManifestSchema.parse({
      schema_version: 1,
      id: "plugin-demo",
      title: "Plugin demo",
      kind: "character_card",
      card: { name: "Plugin demo" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1,
      project_id: "plugin-demo",
      entry_kind: "original",
      purpose: "Plugin lifecycle",
      characters: [],
      world: { enabled: true, categories: [] },
      greetings: { enabled: false, character_ids: [] },
      plugins: [],
    });
    const project = {
      ok: true,
      projectRoot: "C:\\temporary-plugin-demo",
      manifest,
      blueprint,
      characters: [],
      world: [],
      sourceRevisions: {},
      pluginSources: [],
      pluginSelectionRevision: `sha256:${"d".repeat(64)}`,
      diagnostics: [],
    } satisfies LoadedAuthorProject;
    const state = workflowStateSchema.parse({
      schema_version: 2,
      project_id: "plugin-demo",
      workflow_definition_id: "original-v1",
      entry_kind: "original",
      stage: "content_review",
      revision: 7,
      artifacts: [],
      gates: [],
      tasks: [],
      decisions: [],
      extensions: {},
    });

    const next = beginPluginRevision({
      state,
      project,
      occurredAt,
      actor: "director",
      desiredSelections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }],
      implementationPins: {
        "official.ejs": officialPluginImplementationPin("official.ejs"),
        "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod"),
      },
    });
    const intent = next.extensions.plugin_revision_intent as Record<string, unknown>;
    expect(next.stage).toBe("plugin_mvu_authoring");
    expect(next.tasks).toMatchObject([{
      id: "create-official-mvu-zod",
      kind: "create-plugin-mvu",
      assigned_agent: "mvu-creator",
      status: "pending",
      output_contract: "plugin-proposal@1",
    }]);
    expect(intent).toMatchObject({
      base_selection_revision: `sha256:${"d".repeat(64)}`,
      selections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }],
      dependency_closure: ["official.ejs", "official.mvu-zod"],
    });
    expect(intent.implementation_pins).toMatchObject([
      { plugin_id: "official.ejs", implementation: officialPluginImplementationPin("official.ejs") },
      { plugin_id: "official.mvu-zod", implementation: officialPluginImplementationPin("official.mvu-zod") },
    ]);

    expect(() => beginPluginRevision({
      state,
      project,
      occurredAt,
      actor: "director",
      desiredSelections: [{ plugin_id: "official.ejs", capabilities: ["ejs"] }],
      implementationPins: { "official.ejs": officialPluginImplementationPin("official.ejs") },
    })).toThrow("缺少 official.mvu-zod");
    expect(() => beginPluginRevision({
      state,
      project,
      occurredAt,
      actor: "director",
      desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
      implementationPins: {
        "official.mvu-zod": {
          ...officialPluginImplementationPin("official.mvu-zod"),
          digest: `sha256:${"f".repeat(64)}`,
        },
      },
    })).toThrow("未被目前 registry 精確註冊");
  });

  it("starts HTML-only revisions at the HTML author task without enabling MVU", () => {
    const manifest = projectManifestSchema.parse({
      schema_version: 1,
      id: "html-only-demo",
      title: "HTML only",
      kind: "character_card",
      card: { name: "HTML only" },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    });
    const blueprint = blueprintSchema.parse({
      schema_version: 1,
      project_id: "html-only-demo",
      entry_kind: "original",
      purpose: "HTML only",
      characters: [],
      world: { enabled: true, categories: [] },
      greetings: { enabled: false, character_ids: [] },
      plugins: [],
    });
    const project = {
      ok: true,
      projectRoot: "C:\\temporary-html-only-demo",
      manifest,
      blueprint,
      characters: [],
      world: [],
      sourceRevisions: {},
      pluginSources: [],
      diagnostics: [],
    } satisfies LoadedAuthorProject;
    const state = workflowStateSchema.parse({
      schema_version: 2,
      project_id: "html-only-demo",
      workflow_definition_id: "original-v1",
      entry_kind: "original",
      stage: "content_review",
      revision: 2,
      artifacts: [],
      gates: [],
      tasks: [],
      decisions: [],
      extensions: {},
    });

    const next = beginPluginRevision({
      state,
      project,
      occurredAt,
      actor: "director",
      desiredSelections: [{ plugin_id: "official.html", capabilities: ["html.message_presentation"] }],
        implementationPins: { "official.html": officialPluginImplementationPin("official.html") },
    });

    expect(next.stage).toBe("plugin_html_authoring");
    expect(next.tasks).toMatchObject([{
      id: "create-official-html",
      kind: "create-plugin-html",
      assigned_agent: "html-creator",
      status: "pending",
    }]);
    expect((next.extensions.plugin_revision_intent as { dependency_closure: string[] }).dependency_closure)
      .toEqual(["official.html"]);
  });

  it("rejects invalid owner, task, stale workflow, and source CAS during proposal submit", async () => {
    const fixture = await submissionFixture();
    await expect(submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: "not-a-plugin-task",
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    })).rejects.toMatchObject({ code: "PLUGIN_TASK_INVALID" });

    await expect(submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "wrong-agent",
      proposal: fixture.proposal,
      occurredAt,
    })).rejects.toMatchObject({ code: "PLUGIN_TASK_LEASE_INVALID" });

    await expect(submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: withBaseWorkflowRevision(fixture.proposal, fixture.claimed.revision - 1),
      occurredAt,
    })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_WORKFLOW_STALE" });

    const sourcePath = path.join(fixture.projectRoot, "extensions", "official.mvu-zod", "source.yaml");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "drifted", "utf8");
    await expect(submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    })).rejects.toMatchObject({ code: "PLUGIN_SOURCE_CAS_CONFLICT" });
  });
  it("covers plugin revision selection and proposal validation guards", async () => {
    const fixture = await submissionFixture();
    const rebuild = (patch: Record<string, unknown> = {}) => {
      const seed = pluginProposalEnvelopeSchema.parse({ ...fixture.proposal, ...patch, proposal_revision: `sha256:${"0".repeat(64)}`, pending_result_revision: `sha256:${"0".repeat(64)}` });
      const revised = pluginProposalEnvelopeSchema.parse({ ...seed, proposal_revision: proposalRevisionFor(seed) });
      return pluginProposalEnvelopeSchema.parse({ ...revised, pending_result_revision: pendingResultRevisionFor(revised) });
    };
    expect(derivePluginDependencyImpact("official.mvu-zod", [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"], source_revision: `sha256:${"a".repeat(64)}`, implementation: officialPluginImplementationPin("official.mvu-zod"), artifact_revision: `sha256:${"b".repeat(64)}` }])).toEqual([]);
    expect(() => beginPluginRevision({ state: fixture.claimed, project: { ...fixture.project, blueprint: undefined } as LoadedAuthorProject, occurredAt, actor: "director" })).toThrow("plugin revision project");
    expect(() => beginPluginRevision({ state: fixture.claimed, project: { ...fixture.project, manifest: { ...fixture.project.manifest!, kind: "worldbook", characters: [] } } as LoadedAuthorProject, occurredAt, actor: "director" })).toThrow("worldbook");
    expect(() => beginPluginRevision({ state: fixture.claimed, project: fixture.project, occurredAt, actor: "director" })).toThrow("active task");
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: rebuild({ task_id: "other-task" }), occurredAt })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_TASK_INVALID" });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: rebuild({ project_id: "other-project" }), occurredAt })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_OWNER_INVALID" });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: { ...fixture.proposal, proposal_revision: `sha256:${"0".repeat(64)}` }, occurredAt })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_REVISION_INVALID" });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: { ...fixture.proposal, pending_result_revision: `sha256:${"0".repeat(64)}` }, occurredAt })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_HASH_INVALID" });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: rebuild({ value: { ...fixture.proposal.value, expected_manifest_revision: `sha256:${"f".repeat(64)}` } }), occurredAt })).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_CAS_CONFLICT" });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: rebuild({ value: { ...fixture.proposal.value, expected_source_revision: `sha256:${"f".repeat(64)}` } }), occurredAt })).rejects.toMatchObject({ code: "PLUGIN_SOURCE_CAS_CONFLICT" });
    const expired = workflowStateSchema.parse({ ...fixture.claimed, tasks: fixture.claimed.tasks.map((task) => task.id === fixture.taskId ? { ...task, lease: { ...task.lease!, expires_at: "2020-01-01T00:00:00.000Z" } } : task) });
    await expect(submitPluginProposal({ projectRoot: fixture.projectRoot, state: expired, taskId: fixture.taskId, owner: "mvu-creator", proposal: fixture.proposal, occurredAt })).rejects.toMatchObject({ code: "PLUGIN_TASK_LEASE_EXPIRED" });
  });

  it("covers user authorization guards and rejection lifecycle", async () => {
    const fixture = await submissionFixture();
    await expect(decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: fixture.claimed,
      proposal: fixture.proposal,
      action: "reject",
      occurredAt,
      authorizationToken: "invalid",
    })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });

    const token = "a".repeat(43);
    await expect(decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: fixture.claimed,
      proposal: fixture.proposal,
      action: "reject",
      occurredAt,
      authorizationToken: token,
    })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_MISSING" });

    const submitted = await submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    });
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenRelativePath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenRelativePath), { recursive: true });
    await writeFile(tokenRelativePath, `${JSON.stringify({
      schema_version: 1,
      token_hash: tokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision,
      decision: "reject",
      workflow_revision: submitted.revision,
      session_id: "s".repeat(32),
      nonce: "b".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    })}\n`, "utf8");
    const rejected = await decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: submitted,
      proposal: fixture.proposal,
      action: "reject",
      occurredAt,
      authorizationToken: token,
      authenticatedSessionId: "s".repeat(32),
    });
    expect(rejected.revision).toBe(submitted.revision + 1);
    expect(rejected.decisions.at(-1)).toMatchObject({ kind: "plugin.review.rejected" });
  });
  it("covers approved plugin proposal materialization and selection projection", async () => {
    const fixture = await submissionFixture();
    const submitted = await submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    });
    const token = "b".repeat(43);
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify({
      schema_version: 1,
      token_hash: tokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision,
      decision: "approve",
      workflow_revision: submitted.revision,
      session_id: "u".repeat(32),
      nonce: "c".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    })}\n`, "utf8");
    const approved = await decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: submitted,
      proposal: fixture.proposal,
      action: "approve",
      occurredAt,
      authorizationToken: token,
      authenticatedSessionId: "u".repeat(32),
    });
    expect(approved.revision).toBe(submitted.revision + 1);
    expect(approved.decisions.at(-1)).toMatchObject({ kind: "plugin.review.approved" });
    expect(approved.artifacts).toContainEqual(expect.objectContaining({ id: "plugin-official.mvu-zod", status: "approved" }));
    await expect(readFile(path.join(fixture.projectRoot, "project.yaml"), "utf8")).resolves.toContain("official.mvu-zod");
    await expect(readFile(path.join(fixture.projectRoot, ".workflow", "plugin-selection.yaml"), "utf8")).resolves.toContain("official.mvu-zod");
  });

  it("covers authorization envelope parsing and binding failures", async () => {
    const fixture = await submissionFixture();
    const submitted = await submitPluginProposal({ projectRoot: fixture.projectRoot, state: fixture.claimed, taskId: fixture.taskId, owner: "mvu-creator", proposal: fixture.proposal, occurredAt });
    const token = "c".repeat(43);
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    const base = {
      schema_version: 1,
      token_hash: tokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision,
      decision: "reject",
      workflow_revision: submitted.revision,
      session_id: "v".repeat(32),
      nonce: "d".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    };
    const writeToken = async (value: Record<string, unknown> | string) => {
      await mkdir(path.dirname(tokenPath), { recursive: true });
      await writeFile(tokenPath, typeof value === "string" ? value : `${JSON.stringify(value)}\n`, "utf8");
    };
    await writeToken("not-json");
    await expect(decidePluginProposal({ projectRoot: fixture.projectRoot, project: fixture.project, state: submitted, proposal: fixture.proposal, action: "reject", occurredAt, authorizationToken: token })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });
    await writeToken({ ...base, token_hash: "f".repeat(64) });
    await expect(decidePluginProposal({ projectRoot: fixture.projectRoot, project: fixture.project, state: submitted, proposal: fixture.proposal, action: "reject", occurredAt, authorizationToken: token })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });
    for (const patch of [
      { project_id: "different-project" },
      { proposal_id: "different-proposal" },
      { proposal_revision: `sha256:${"e".repeat(64)}` },
      { workflow_revision: submitted.revision - 1 },
      { decision: "approve" },
    ]) {
      await writeToken({ ...base, ...patch });
      await expect(decidePluginProposal({ projectRoot: fixture.projectRoot, project: fixture.project, state: submitted, proposal: fixture.proposal, action: "reject", occurredAt, authorizationToken: token })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });
    }
    await writeToken(base);
    await expect(decidePluginProposal({ projectRoot: fixture.projectRoot, project: fixture.project, state: submitted, proposal: fixture.proposal, action: "reject", occurredAt, authorizationToken: token, authenticatedSessionId: "wrong-session" })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });
    await writeToken({ ...base, expires_at: "2020-01-01T00:00:00.000Z" });
    await expect(decidePluginProposal({ projectRoot: fixture.projectRoot, project: fixture.project, state: submitted, proposal: fixture.proposal, action: "reject", occurredAt, authorizationToken: token })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_EXPIRED" });
  });

  it("covers empty plugin revisions, preview validation, and dependency selection", async () => {
    const fixture = await submissionFixture();
    const idle = workflowStateSchema.parse({ ...fixture.claimed, tasks: [] });
    const noPlugins = beginPluginRevision({ state: idle, project: fixture.project, occurredAt, actor: "director", desiredSelections: [] });
    expect(noPlugins.stage).toBe("content_review");
    expect(noPlugins.tasks).toEqual([]);
    expect(previewPluginRevision({ project: fixture.project, desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }], implementationPins: { "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod") } }).dependency_closure).toEqual(["official.mvu-zod"]);
    await expect(Promise.resolve().then(() => previewPluginRevision({ project: { ...fixture.project, manifest: undefined } as LoadedAuthorProject }))).rejects.toMatchObject({ code: "PLUGIN_PROJECT_INVALID" });
    await expect(Promise.resolve().then(() => previewPluginRevision({ project: { ...fixture.project, manifest: { ...fixture.project.manifest!, kind: "worldbook", characters: [] } } as LoadedAuthorProject }))).rejects.toMatchObject({ code: "PLUGIN_PROJECT_KIND_DENIED" });
    expect(derivePluginDependencyImpact("official.mvu-zod", [
      { plugin_id: "official.html", capabilities: ["html.message_presentation"], source_revision: `sha256:${"a".repeat(64)}`, implementation: officialPluginImplementationPin("official.html"), artifact_revision: `sha256:${"b".repeat(64)}` },
      { plugin_id: "official.html", capabilities: ["html.status_bar"], source_revision: `sha256:${"a".repeat(64)}`, implementation: officialPluginImplementationPin("official.html"), artifact_revision: `sha256:${"b".repeat(64)}` },
    ])).toEqual(["plugin-official.html"]);
  });  it("covers plugin revision fallback and project guard branches", async () => {
    const fixture = await submissionFixture();
    const implementation = officialPluginImplementationPin("official.mvu-zod");
    const emptyState = workflowStateSchema.parse({ ...fixture.claimed, stage: "content_review", tasks: [] });
    expect(derivePluginDependencyImpact("official.mvu-zod", [
      { plugin_id: "official.html", capabilities: ["html.status_bar"] },
      { plugin_id: "official.ejs", capabilities: ["ejs"] },
      { plugin_id: "official.html", capabilities: ["html.status_bar"] },
    ])).toEqual(["plugin-official.ejs", "plugin-official.html"]);
    expect(derivePluginDependencyImpact("official.html", [])).toEqual([]);
    expect(beginPluginRevision({
      state: emptyState, project: fixture.project, occurredAt, actor: "director",
      desiredSelections: [], implementationPins: { "official.mvu-zod": implementation },
    }).stage).toBe("content_review");
    await expect(Promise.resolve().then(() => beginPluginRevision({
      state: fixture.claimed, project: fixture.project, occurredAt, actor: "director",
    }))).rejects.toThrow("active task");
    expect(() => beginPluginRevision({
      state: emptyState, project: { ...fixture.project, manifest: undefined } as LoadedAuthorProject, occurredAt, actor: "director",
    })).toThrow();
    expect(() => previewPluginRevision({ project: { ...fixture.project, manifest: undefined } as LoadedAuthorProject })).toThrow();
    expect(() => beginPluginRevision({
      state: emptyState,
      project: { ...fixture.project, manifest: { ...fixture.project.manifest!, kind: "worldbook" } } as LoadedAuthorProject,
      occurredAt, actor: "director",
    })).toThrow();
    expect(() => beginPluginRevision({
      state: emptyState, project: { ...fixture.project, blueprint: undefined } as LoadedAuthorProject, occurredAt, actor: "director",
    })).toThrow();
  });

  it("approves an EJS proposal against the active MVU dependency and selection projection", async () => {
    const fixture = await submissionFixture();
    const submittedMvu = await submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    });
    const mvuToken = "g".repeat(43);
    const mvuTokenHash = createHash("sha256").update(mvuToken, "utf8").digest("hex");
    const mvuTokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", mvuTokenHash + ".json");
    await mkdir(path.dirname(mvuTokenPath), { recursive: true });
    await writeFile(mvuTokenPath, JSON.stringify({
      schema_version: 1,
      token_hash: mvuTokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision,
      decision: "approve",
      workflow_revision: submittedMvu.revision,
      session_id: "g".repeat(32),
      nonce: "2".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    }) + String.fromCharCode(10), "utf8");
    const mvuApproved = await decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: submittedMvu,
      proposal: fixture.proposal,
      action: "approve",
      occurredAt,
      authorizationToken: mvuToken,
      authenticatedSessionId: "g".repeat(32),
    });
    const ejsSource = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.ejs",
      project_kind: "character_card",
      implementation: officialPluginImplementationPin("official.ejs"),
      entries: [{
        id: "show-mood",
        condition: { path: "/mood", operator: "equals", value: "calm" },
        content: "Mood is calm",
      }],
      preprocessing: [{ id: "mood-alias", path: "/mood" }],
      sections: [],
      dynamic_text: [],
    });
    const mvuCompilation = compileMvuSource(fixture.proposal.value.source as Parameters<typeof compileMvuSource>[0]);
    const ejsCompilation = compileEjsSource(ejsSource as Parameters<typeof compileEjsSource>[0], mvuCompilation.path_registry);
    const ejsTask = workflowStateSchema.parse({
      ...mvuApproved,
      revision: mvuApproved.revision + 1,
      stage: "plugin_ejs_authoring",
      tasks: [{
        id: "create-official-ejs",
        kind: "create-plugin-ejs",
        status: "claimed",
        assigned_agent: "ejs-creator",
        capabilities: ["task.execute", "plugin.ejs.propose", "task.clarify"],
        input_artifacts: [],
        output_contract: "plugin-proposal@1",
        dependencies: ["review-official-mvu-zod"],
        attempt: 1,
        max_attempts: 3,
        lease: { id: "ejs-lease", owner: "ejs-creator", claimed_at: occurredAt, expires_at: "2099-07-20T00:00:00.000Z" },
        extensions: { stage: "plugin_ejs_authoring", plugin_id: "official.ejs", plugin_kind: "plugin_ejs", requires_immutable_proposal: false },
      }],
    });
    const prepared = await commitWorkflowMutation(fixture.projectRoot, {
      expectedRevision: mvuApproved.revision,
      eventId: "ejs-task-prepare",
      actor: "director",
      occurredAt,
      update: () => ejsTask,
    });
    const manifestRevision = computeTextRevision(await readFile(path.join(fixture.projectRoot, "project.yaml"), "utf8"));
    const ejsSeed = pluginProposalEnvelopeSchema.parse({
      schema_version: 1,
      id: "ejs-proposal-1",
      task_id: "create-official-ejs",
      project_id: fixture.project.manifest!.id,
      owner: "ejs-creator",
      proposal_revision: "sha256:" + "0".repeat(64),
      base_workflow_revision: prepared.revision,
      value: {
        kind: "plugin",
        project_kind: "character_card",
        plugin_id: "official.ejs",
        capabilities: ["ejs"],
        source: ejsSource,
        expected_source_revision: "absent",
        expected_manifest_revision: manifestRevision,
        resolved_source_hash: ejsCompilation.contributions.metadata.resolved_source_hash,
      },
      pending_result_revision: "sha256:" + "0".repeat(64),
      submitted_at: occurredAt,
    });
    const ejsProposalWithRevision = pluginProposalEnvelopeSchema.parse({
      ...ejsSeed,
      proposal_revision: proposalRevisionFor(ejsSeed),
    });
    const ejsProposal = pluginProposalEnvelopeSchema.parse({
      ...ejsProposalWithRevision,
      pending_result_revision: pendingResultRevisionFor(ejsProposalWithRevision),
    });
    const submittedEjs = await submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: prepared,
      taskId: "create-official-ejs",
      owner: "ejs-creator",
      proposal: ejsProposal,
      occurredAt,
    });
    const ejsToken = "h".repeat(43);
    const ejsTokenHash = createHash("sha256").update(ejsToken, "utf8").digest("hex");
    const ejsTokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", ejsTokenHash + ".json");
    await mkdir(path.dirname(ejsTokenPath), { recursive: true });
    await writeFile(ejsTokenPath, JSON.stringify({
      schema_version: 1,
      token_hash: ejsTokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: ejsProposal.id,
      proposal_revision: ejsProposal.proposal_revision,
      decision: "approve",
      workflow_revision: submittedEjs.revision,
      session_id: "h".repeat(32),
      nonce: "3".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    }) + String.fromCharCode(10), "utf8");
    const loaded = await loadAuthorProject(path.dirname(fixture.projectRoot), fixture.project.manifest!.id);
    const ejsApproved = await decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: loaded,
      state: submittedEjs,
      proposal: ejsProposal,
      action: "approve",
      occurredAt,
      authorizationToken: ejsToken,
      authenticatedSessionId: "h".repeat(32),
    });
    expect(ejsApproved.artifacts).toContainEqual(expect.objectContaining({ id: "plugin-official.ejs", status: "approved" }));
    expect(ejsApproved.extensions.plugin_dependency_impact).toEqual([]);
  });

});
// Additional branch matrices for lifecycle guards.
describe("plugin lifecycle branch matrix", () => {
  it("covers selection normalization fallbacks and malformed pending bytes", async () => {
    const fixture = await submissionFixture();
    const idle = workflowStateSchema.parse({ ...fixture.claimed, tasks: [] });
    const started = beginPluginRevision({
      state: idle,
      project: fixture.project,
      occurredAt,
      actor: "director",
      desiredSelections: [
        { plugin_id: "official.html", capabilities: ["html.status_bar", "html.message_presentation"] },
        { plugin_id: "official.ejs", capabilities: ["ejs"] },
      ],
      implementationPins: {
        "official.html": officialPluginImplementationPin("official.html"),
        "official.ejs": officialPluginImplementationPin("official.ejs"),
        "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod"),
      },
    });
    expect(started.stage).toBe("plugin_mvu_authoring");

    const submitted = await submitPluginProposal({
      projectRoot: fixture.projectRoot,
      state: fixture.claimed,
      taskId: fixture.taskId,
      owner: "mvu-creator",
      proposal: fixture.proposal,
      occurredAt,
    });
    const pendingPath = path.join(fixture.projectRoot, ".workflow", "results", fixture.taskId, `${fixture.proposal.id}.json`);
    await writeFile(pendingPath, "not-json\n", "utf8");
    const token = "d".repeat(43);
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify({
      schema_version: 1,
      token_hash: tokenHash,
      project_id: fixture.project.manifest!.id,
      proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision,
      decision: "reject",
      workflow_revision: submitted.revision,
      session_id: "w".repeat(32),
      nonce: "e".repeat(64),
      expires_at: "2099-07-20T00:00:00.000Z",
    })}\n`, "utf8");
    await expect(decidePluginProposal({
      projectRoot: fixture.projectRoot,
      project: fixture.project,
      state: submitted,
      proposal: fixture.proposal,
      action: "reject",
      occurredAt,
      authorizationToken: token,
    })).rejects.toMatchObject({ code: "PLUGIN_PENDING_RESULT_STALE" });
  });

  it("covers malformed persisted source, manifest, and selection approval guards", async () => {
    const sourceFixture = await submissionFixture();
    const sourcePath = path.join(sourceFixture.projectRoot, "extensions", "official.mvu-zod", "source.yaml");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "not: [valid", "utf8");
    const sourceRevision = computeTextRevision(await readFile(sourcePath, "utf8"));
    const sourceSeed = pluginProposalEnvelopeSchema.parse({
      ...sourceFixture.proposal,
      value: { ...sourceFixture.proposal.value, expected_source_revision: sourceRevision },
      proposal_revision: `sha256:${"0".repeat(64)}`,
      pending_result_revision: `sha256:${"0".repeat(64)}`,
    });
    const sourceProposal = pluginProposalEnvelopeSchema.parse({
      ...sourceSeed,
      proposal_revision: proposalRevisionFor(sourceSeed),
    });
    const finalSourceProposal = pluginProposalEnvelopeSchema.parse({
      ...sourceProposal,
      pending_result_revision: pendingResultRevisionFor(sourceProposal),
    });
    await expect(submitPluginProposal({
      projectRoot: sourceFixture.projectRoot,
      state: sourceFixture.claimed,
      taskId: sourceFixture.taskId,
      owner: "mvu-creator",
      proposal: finalSourceProposal,
      occurredAt,
    })).rejects.toMatchObject({ code: "PLUGIN_SOURCE_INVALID" });

    const manifestFixture = await submissionFixture();
    const manifestSubmitted = await submitPluginProposal({ projectRoot: manifestFixture.projectRoot, state: manifestFixture.claimed, taskId: manifestFixture.taskId, owner: "mvu-creator", proposal: manifestFixture.proposal, occurredAt });
    await writeFile(path.join(manifestFixture.projectRoot, "project.yaml"), "not: [valid", "utf8");
    const token = "e".repeat(43);
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(manifestFixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify({ schema_version: 1, token_hash: tokenHash, project_id: manifestFixture.project.manifest!.id, proposal_id: manifestFixture.proposal.id, proposal_revision: manifestFixture.proposal.proposal_revision, decision: "approve", workflow_revision: manifestSubmitted.revision, session_id: "x".repeat(32), nonce: "f".repeat(64), expires_at: "2099-07-20T00:00:00.000Z" })}\n`, "utf8");
    await expect(decidePluginProposal({ projectRoot: manifestFixture.projectRoot, project: manifestFixture.project, state: manifestSubmitted, proposal: manifestFixture.proposal, action: "approve", occurredAt, authorizationToken: token })).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" });

    const selectionFixture = await submissionFixture();
    const selectionSubmitted = await submitPluginProposal({ projectRoot: selectionFixture.projectRoot, state: selectionFixture.claimed, taskId: selectionFixture.taskId, owner: "mvu-creator", proposal: selectionFixture.proposal, occurredAt });
    const selectionPath = path.join(selectionFixture.projectRoot, ".workflow", "plugin-selection.yaml");
    await mkdir(path.dirname(selectionPath), { recursive: true });
    await writeFile(selectionPath, "schema_version: 1\nproject_id: other\nselections: []\nintent_revision: sha256:" + "a".repeat(64) + "\nupdated_at: 2026-07-20T00:00:00.000Z\n", "utf8");
    const selectionToken = "f".repeat(43);
    const selectionHash = createHash("sha256").update(selectionToken, "utf8").digest("hex");
    const selectionTokenPath = path.join(selectionFixture.projectRoot, ".workflow", "plugin-review-tokens", `${selectionHash}.json`);
    await mkdir(path.dirname(selectionTokenPath), { recursive: true });
    await writeFile(selectionTokenPath, `${JSON.stringify({ schema_version: 1, token_hash: selectionHash, project_id: selectionFixture.project.manifest!.id, proposal_id: selectionFixture.proposal.id, proposal_revision: selectionFixture.proposal.proposal_revision, decision: "approve", workflow_revision: selectionSubmitted.revision, session_id: "y".repeat(32), nonce: "1".repeat(64), expires_at: "2099-07-20T00:00:00.000Z" })}\n`, "utf8");
    await expect(decidePluginProposal({ projectRoot: selectionFixture.projectRoot, project: selectionFixture.project, state: selectionSubmitted, proposal: selectionFixture.proposal, action: "approve", occurredAt, authorizationToken: selectionToken })).rejects.toMatchObject({ code: "PLUGIN_SELECTION_PROJECT_MISMATCH" });
  });
  it("covers plugin intent source-pin fallback, artifact filtering, and ordering", async () => {
    const fixture = await submissionFixture();
    const reversed = [
      { plugin_id: "official.html" as const, capabilities: ["html.status_bar" as const] },
      { plugin_id: "official.ejs" as const, capabilities: ["ejs" as const] },
    ];
    expect(derivePluginDependencyImpact("official.mvu-zod", reversed as never)).toEqual([
      "plugin-official.ejs", "plugin-official.html",
    ]);
    const idle = workflowStateSchema.parse({
      ...fixture.claimed,
      stage: "content_review",
      tasks: [],
      artifacts: [
        ...fixture.claimed.artifacts,
        { id: "preview-stale", status: "draft" as const, revision: computeTextRevision("preview"), updated_at: occurredAt, extensions: {} },
      ],
    });
    const next = beginPluginRevision({
      state: idle,
      project: { ...fixture.project, pluginSources: [fixture.proposal.value.source], pluginSelectionRevision: undefined },
      occurredAt,
      actor: "director",
      desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
    });
    expect(next.stage).toBe("plugin_mvu_authoring");
    expect(next.tasks[0]?.kind).toBe("create-plugin-mvu");
    expect(next.artifacts.some((artifact) => artifact.id === "preview-stale")).toBe(false);
  });



  it("covers plugin revision preview guards, dependency sort branches, and source-pin fallbacks", async () => {
    const fixture = await submissionFixture();
    const html = { plugin_id: "official.html" as const, capabilities: ["html.status_bar" as const] };
    const ejs = { plugin_id: "official.ejs" as const, capabilities: ["ejs" as const] };
    expect(derivePluginDependencyImpact("official.mvu-zod", [html, ejs] as never)).toEqual([
      "plugin-official.ejs", "plugin-official.html",
    ]);
    expect(() => previewPluginRevision({ project: { ...fixture.project, blueprint: undefined } })).toThrow(/plugin revision/u);
    expect(() => previewPluginRevision({ project: { ...fixture.project, manifest: projectManifestSchema.parse({ ...fixture.project.manifest!, kind: "worldbook", characters: [] }) } })).toThrow();
    expect(() => beginPluginRevision({ state: fixture.claimed, project: { ...fixture.project, manifest: undefined }, occurredAt, actor: "director" })).toThrow();
    const worldbook = projectManifestSchema.parse({ ...fixture.project.manifest!, kind: "worldbook", characters: [] });
    expect(() => beginPluginRevision({ state: fixture.claimed, project: { ...fixture.project, manifest: worldbook }, occurredAt, actor: "director" })).toThrow();
    const source = fixture.proposal.value.source;
    const fallback = beginPluginRevision({
      state: workflowStateSchema.parse({ ...fixture.claimed, tasks: [] }),
      project: { ...fixture.project, pluginSources: [source], pluginSelectionRevision: undefined },
      occurredAt, actor: "director", desiredSelections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
    });
    expect(fallback.stage).toBe("plugin_mvu_authoring");
  });
});
it("covers remaining plugin guard branches", async () => {
  const fixture = await submissionFixture();
  const idle = workflowStateSchema.parse({ ...fixture.claimed, stage: "content_review", tasks: [] });
  const fallback = beginPluginRevision({
    state: idle,
    project: { ...fixture.project, pluginSources: undefined, pluginSelectionRevision: undefined },
    occurredAt,
    actor: "director",
  });
  expect(fallback.stage).toBe("content_review");
  expect(previewPluginRevision({ project: fixture.project }).project_id).toBe(fixture.project.manifest!.id);

  const submitted = await submitPluginProposal({
    projectRoot: fixture.projectRoot,
    state: fixture.claimed,
    taskId: fixture.taskId,
    owner: "mvu-creator",
    proposal: fixture.proposal,
    occurredAt,
  });
  const staleState = workflowStateSchema.parse({ ...submitted, revision: submitted.revision + 1 });
  const token = "z".repeat(43);
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const tokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
  await mkdir(path.dirname(tokenPath), { recursive: true });
  const tokenValue = {
    schema_version: 1,
    token_hash: tokenHash,
    project_id: fixture.project.manifest!.id,
    proposal_id: fixture.proposal.id,
    proposal_revision: fixture.proposal.proposal_revision,
    decision: "reject",
    workflow_revision: staleState.revision,
    session_id: "z".repeat(32),
    nonce: "z".repeat(64),
    expires_at: "2099-07-20T00:00:00.000Z",
  };
  await writeFile(tokenPath, `${JSON.stringify(tokenValue)}\n`, "utf8");
  await expect(decidePluginProposal({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    state: staleState,
    proposal: fixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: token,
  })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });

  const invalidResultState = workflowStateSchema.parse({
    ...submitted,
    tasks: submitted.tasks.map((task) => task.id === fixture.taskId ? { ...task, result: { id: "wrong", revision: fixture.proposal.pending_result_revision } } : task),
  });
  const invalidToken = "y".repeat(43);
  const invalidHash = createHash("sha256").update(invalidToken, "utf8").digest("hex");
  const invalidPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${invalidHash}.json`);
  await writeFile(invalidPath, `${JSON.stringify({ ...tokenValue, token_hash: invalidHash, workflow_revision: invalidResultState.revision })}\n`, "utf8");
  await expect(decidePluginProposal({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    state: invalidResultState,
    proposal: fixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: invalidToken,
  })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });
  await expect(decidePluginProposal({
    projectRoot: fixture.projectRoot,
    project: { ...fixture.project, manifest: undefined },
    state: submitted,
    proposal: fixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: invalidToken,
  })).rejects.toMatchObject({ code: "PLUGIN_PROJECT_INVALID" });

  const staleProposal = withBaseWorkflowRevision(fixture.proposal, submitted.revision - 1);
  const staleProposalToken = "x".repeat(43);
  const staleProposalHash = createHash("sha256").update(staleProposalToken, "utf8").digest("hex");
  const staleProposalTokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${staleProposalHash}.json`);
  await writeFile(staleProposalTokenPath, `${JSON.stringify({ ...tokenValue, token_hash: staleProposalHash, proposal_revision: staleProposal.proposal_revision, workflow_revision: submitted.revision })}\n`, "utf8");
  await expect(decidePluginProposal({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    state: submitted,
    proposal: staleProposal,
    action: "reject",
    occurredAt,
    authorizationToken: staleProposalToken,
  })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_INVALID" });

  const directoryToken = "w".repeat(43);
  const directoryHash = createHash("sha256").update(directoryToken, "utf8").digest("hex");
  const directoryPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${directoryHash}.json`);
  await mkdir(directoryPath, { recursive: true });
  await expect(decidePluginProposal({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    state: submitted,
    proposal: fixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: directoryToken,
  })).rejects.toBeDefined();
});
it("covers plugin approval CAS, dependency, and projection fallback branches", async () => {
  const rebuild = (base: PluginProposalEnvelope, patch: Record<string, unknown> = {}) => {
    const seed = pluginProposalEnvelopeSchema.parse({ ...base, ...patch, proposal_revision: `sha256:${"0".repeat(64)}`, pending_result_revision: `sha256:${"0".repeat(64)}` });
    const revised = pluginProposalEnvelopeSchema.parse({ ...seed, proposal_revision: proposalRevisionFor(seed) });
    return pluginProposalEnvelopeSchema.parse({ ...revised, pending_result_revision: pendingResultRevisionFor(revised) });
  };
  const writeToken = async (fixture: Awaited<ReturnType<typeof submissionFixture>>, submitted: Awaited<ReturnType<typeof submitPluginProposal>>, token: string, decision: "approve" | "reject" = "approve", patch: Record<string, unknown> = {}) => {
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(fixture.projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify({
      schema_version: 1, token_hash: tokenHash, project_id: fixture.project.manifest!.id, proposal_id: fixture.proposal.id,
      proposal_revision: fixture.proposal.proposal_revision, decision, workflow_revision: submitted.revision,
      session_id: "q".repeat(32), nonce: "a".repeat(64), expires_at: "2099-07-20T00:00:00.000Z", ...patch,
    })}\n`, "utf8");
  };

  const scopeFixture = await submissionFixture();
  const scopeState = workflowStateSchema.parse({ ...scopeFixture.claimed, tasks: scopeFixture.claimed.tasks.map((task) => task.id === scopeFixture.taskId ? { ...task, extensions: { ...task.extensions, plugin_id: "official.ejs" } } : task) });
  await expect(submitPluginProposal({ projectRoot: scopeFixture.projectRoot, state: scopeState, taskId: scopeFixture.taskId, owner: "mvu-creator", proposal: scopeFixture.proposal, occurredAt })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_SCOPE_INVALID" });

  const consumedFixture = await submissionFixture();
  const consumedSubmitted = await submitPluginProposal({ projectRoot: consumedFixture.projectRoot, state: consumedFixture.claimed, taskId: consumedFixture.taskId, owner: "mvu-creator", proposal: consumedFixture.proposal, occurredAt });
  const consumedToken = "q".repeat(43);
  await writeToken(consumedFixture, consumedSubmitted, consumedToken, "reject", { consumed_at: occurredAt });
  await expect(decidePluginProposal({ projectRoot: consumedFixture.projectRoot, project: consumedFixture.project, state: consumedSubmitted, proposal: consumedFixture.proposal, action: "reject", occurredAt, authorizationToken: consumedToken })).rejects.toMatchObject({ code: "PLUGIN_USER_AUTHORIZATION_EXPIRED" });
  const invalidPendingFixture = await submissionFixture();
  const invalidPendingSubmitted = await submitPluginProposal({ projectRoot: invalidPendingFixture.projectRoot, state: invalidPendingFixture.claimed, taskId: invalidPendingFixture.taskId, owner: "mvu-creator", proposal: invalidPendingFixture.proposal, occurredAt });
  const invalidPendingState = workflowStateSchema.parse({
    ...invalidPendingSubmitted,
    tasks: invalidPendingSubmitted.tasks.map((task) => task.id === invalidPendingFixture.taskId
      ? { ...task, result: { id: "wrong-pending-result", revision: task.result!.revision } }
      : task),
  });
  const invalidPendingToken = "p".repeat(43);
  await writeToken(invalidPendingFixture, invalidPendingSubmitted, invalidPendingToken, "reject");
  await expect(decidePluginProposal({
    projectRoot: invalidPendingFixture.projectRoot,
    project: invalidPendingFixture.project,
    state: invalidPendingState,
    proposal: invalidPendingFixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: invalidPendingToken,
  })).rejects.toMatchObject({ code: "PLUGIN_PENDING_RESULT_INVALID" });

  const missingManifest = await submissionFixture();
  const missingSubmitted = await submitPluginProposal({ projectRoot: missingManifest.projectRoot, state: missingManifest.claimed, taskId: missingManifest.taskId, owner: "mvu-creator", proposal: missingManifest.proposal, occurredAt });
  await rm(path.join(missingManifest.projectRoot, "project.yaml"));
  const missingToken = "r".repeat(43);
  await writeToken(missingManifest, missingSubmitted, missingToken);
  await expect(decidePluginProposal({ projectRoot: missingManifest.projectRoot, project: missingManifest.project, state: missingSubmitted, proposal: missingManifest.proposal, action: "approve", occurredAt, authorizationToken: missingToken })).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" });

  const kindFixture = await submissionFixture();
  const kindSubmitted = await submitPluginProposal({ projectRoot: kindFixture.projectRoot, state: kindFixture.claimed, taskId: kindFixture.taskId, owner: "mvu-creator", proposal: kindFixture.proposal, occurredAt });
  await writeFile(path.join(kindFixture.projectRoot, "project.yaml"), JSON.stringify({ ...kindFixture.project.manifest, kind: "worldbook", characters: [] }), "utf8");
  const kindToken = "s".repeat(43);
  await writeToken(kindFixture, kindSubmitted, kindToken);
  await expect(decidePluginProposal({ projectRoot: kindFixture.projectRoot, project: kindFixture.project, state: kindSubmitted, proposal: kindFixture.proposal, action: "approve", occurredAt, authorizationToken: kindToken })).rejects.toMatchObject({ code: "PLUGIN_PROJECT_KIND_DENIED" });

  const sourceCas = await submissionFixture();
  const sourceCasSubmitted = await submitPluginProposal({ projectRoot: sourceCas.projectRoot, state: sourceCas.claimed, taskId: sourceCas.taskId, owner: "mvu-creator", proposal: sourceCas.proposal, occurredAt });
  await mkdir(path.join(sourceCas.projectRoot, "extensions", "official.mvu-zod"), { recursive: true });
  await writeFile(path.join(sourceCas.projectRoot, "extensions", "official.mvu-zod", "source.yaml"), "{}", "utf8");
  const sourceCasToken = "t".repeat(43);
  await writeToken(sourceCas, sourceCasSubmitted, sourceCasToken);
  await expect(decidePluginProposal({ projectRoot: sourceCas.projectRoot, project: sourceCas.project, state: sourceCasSubmitted, proposal: sourceCas.proposal, action: "approve", occurredAt, authorizationToken: sourceCasToken })).rejects.toMatchObject({ code: "PLUGIN_SOURCE_CAS_CONFLICT" });

  const manifestCas = await submissionFixture();
  const manifestCasSubmitted = await submitPluginProposal({ projectRoot: manifestCas.projectRoot, state: manifestCas.claimed, taskId: manifestCas.taskId, owner: "mvu-creator", proposal: manifestCas.proposal, occurredAt });
  await writeFile(path.join(manifestCas.projectRoot, "project.yaml"), JSON.stringify({ ...manifestCas.project.manifest, title: "Changed" }), "utf8");
  const manifestCasToken = "u".repeat(43);
  await writeToken(manifestCas, manifestCasSubmitted, manifestCasToken);
  await expect(decidePluginProposal({ projectRoot: manifestCas.projectRoot, project: manifestCas.project, state: manifestCasSubmitted, proposal: manifestCas.proposal, action: "approve", occurredAt, authorizationToken: manifestCasToken })).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_CAS_CONFLICT" });

  const resolvedFixture = await submissionFixture();
  const resolvedProposal = rebuild(resolvedFixture.proposal, { value: { ...resolvedFixture.proposal.value, resolved_source_hash: `sha256:${"f".repeat(64)}` } });
  const resolvedSubmitted = await submitPluginProposal({ projectRoot: resolvedFixture.projectRoot, state: resolvedFixture.claimed, taskId: resolvedFixture.taskId, owner: "mvu-creator", proposal: resolvedProposal, occurredAt });
  const resolvedToken = "v".repeat(43);
  await writeToken({ ...resolvedFixture, proposal: resolvedProposal }, resolvedSubmitted, resolvedToken);
  await expect(decidePluginProposal({ projectRoot: resolvedFixture.projectRoot, project: resolvedFixture.project, state: resolvedSubmitted, proposal: resolvedProposal, action: "approve", occurredAt, authorizationToken: resolvedToken })).rejects.toMatchObject({ code: "PLUGIN_RESOLVED_SOURCE_MISMATCH" });

  const selectionFixture = await submissionFixture();
  const selectionSubmitted = await submitPluginProposal({ projectRoot: selectionFixture.projectRoot, state: selectionFixture.claimed, taskId: selectionFixture.taskId, owner: "mvu-creator", proposal: selectionFixture.proposal, occurredAt });
  await mkdir(path.join(selectionFixture.projectRoot, ".workflow"), { recursive: true });
  await writeFile(path.join(selectionFixture.projectRoot, ".workflow", "plugin-selection.yaml"), "not: [valid", "utf8");
  const selectionToken = "y".repeat(43);
  await writeToken(selectionFixture, selectionSubmitted, selectionToken);
  await expect(decidePluginProposal({ projectRoot: selectionFixture.projectRoot, project: selectionFixture.project, state: selectionSubmitted, proposal: selectionFixture.proposal, action: "approve", occurredAt, authorizationToken: selectionToken })).rejects.toMatchObject({ code: "PLUGIN_SELECTION_INVALID" });

  const sourcePresent = await submissionFixture();
  const sourceContent = JSON.stringify(sourcePresent.proposal.value.source);
  const sourcePresentPath = path.join(sourcePresent.projectRoot, "extensions", "official.mvu-zod", "source.yaml");
  await mkdir(path.dirname(sourcePresentPath), { recursive: true });
  await writeFile(sourcePresentPath, sourceContent, "utf8");
  const sourcePresentRevision = computeTextRevision(sourceContent);
  const sourcePresentProposal = rebuild(sourcePresent.proposal, { value: { ...sourcePresent.proposal.value, expected_source_revision: sourcePresentRevision } });
  const sourcePresentSubmitted = await submitPluginProposal({ projectRoot: sourcePresent.projectRoot, state: sourcePresent.claimed, taskId: sourcePresent.taskId, owner: "mvu-creator", proposal: sourcePresentProposal, occurredAt });
  await mkdir(path.join(sourcePresent.projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
  await writeFile(path.join(sourcePresent.projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"), "old-artifact", "utf8");
  const sourcePresentToken = "k".repeat(43);
  await writeToken({ ...sourcePresent, proposal: sourcePresentProposal }, sourcePresentSubmitted, sourcePresentToken);
  const sourcePresentState = workflowStateSchema.parse({ ...sourcePresentSubmitted, artifacts: [...sourcePresentSubmitted.artifacts, { id: "preview-old", status: "draft" as const, revision: computeTextRevision("preview-old"), updated_at: occurredAt, extensions: {} }], extensions: { ...sourcePresentSubmitted.extensions, plugin_revision_intent: { revision: null } } });
  const sourcePresentProject = { ...sourcePresent.project, greetings: { greetings: [] } } as LoadedAuthorProject;
  const approved = await decidePluginProposal({ projectRoot: sourcePresent.projectRoot, project: sourcePresentProject, state: sourcePresentState, proposal: sourcePresentProposal, action: "approve", occurredAt, authorizationToken: sourcePresentToken });
  expect(approved.artifacts).toContainEqual(expect.objectContaining({ id: "plugin-official.mvu-zod", status: "approved" }));
});
it("covers plugin preview project guards and empty selection stage", async () => {
  const fixture = await submissionFixture();
  const emptyIntent = previewPluginRevision({ project: fixture.project, desiredSelections: [] });
  expect(emptyIntent.dependency_closure).toEqual([]);
  expect(emptyIntent.selections).toEqual([]);
  const withoutBlueprint = { ...fixture.project, blueprint: undefined } as LoadedAuthorProject;
  expect(() => previewPluginRevision({ project: withoutBlueprint })).toThrow();

  const worldWorkspace = await makeTemporaryWorkspace();
  cleanups.push(worldWorkspace.cleanup);
  await initializeProject({
    projectsRoot: worldWorkspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "plugin-worldbook",
      title: "Plugin worldbook",
      kind: "worldbook",
      card: { name: "Plugin worldbook" },
      characters: [],
    }),
    world: { enabled: true, categories: ["geography"] },
  });
  const worldProject = await loadAuthorProject(worldWorkspace.projectsRoot, "plugin-worldbook");
  expect(() => previewPluginRevision({ project: worldProject })).toThrow();
});
it("covers duplicate selection ordering and pending proposal integrity branches", async () => {
  const fixture = await submissionFixture();
  expect(() => previewPluginRevision({
    project: fixture.project,
    desiredSelections: [
      { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
      { plugin_id: "official.mvu-zod", capabilities: ["mvu"] },
    ],
    implementationPins: { "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod") },
  })).toThrow("重複的 plugin selection");
  const sortedPreview = previewPluginRevision({
    project: { ...fixture.project, pluginSources: [] },
    desiredSelections: [
      { plugin_id: "official.ejs", capabilities: ["ejs"] },
      { plugin_id: "official.html", capabilities: ["html.message_presentation"] },
    ],
    implementationPins: {
      "official.ejs": officialPluginImplementationPin("official.ejs"),
      "official.html": officialPluginImplementationPin("official.html"),
      "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod"),
    },
  });
  expect(sortedPreview.selections.map((selection) => selection.plugin_id)).toEqual(["official.ejs", "official.html"]);
  expect(previewPluginRevision({ project: { ...fixture.project, pluginSources: undefined }, desiredSelections: [], implementationPins: {} }).dependency_closure).toEqual([]);

  const extraTaskState = workflowStateSchema.parse({
    ...fixture.claimed,
    revision: fixture.claimed.revision + 1,
    tasks: [...fixture.claimed.tasks, { ...fixture.claimed.tasks[0]!, id: "other-plugin-task", status: "completed" as const }],
  });
  const persistedExtra = await commitWorkflowMutation(fixture.projectRoot, {
    expectedRevision: fixture.claimed.revision,
    eventId: "plugin-extra-task",
    actor: "engine",
    occurredAt,
    update: () => extraTaskState,
  });
  const rebuilt = withBaseWorkflowRevision(fixture.proposal, persistedExtra.revision);
  const extraSubmitted = await submitPluginProposal({
    projectRoot: fixture.projectRoot,
    state: persistedExtra,
    taskId: fixture.taskId,
    owner: "mvu-creator",
    proposal: rebuilt,
    occurredAt,
  });
  expect(extraSubmitted.tasks.find((task) => task.id === "other-plugin-task")?.status).toBe("completed");

  const malformedFixture = await submissionFixture();
  const malformedSubmitted = await submitPluginProposal({
    projectRoot: malformedFixture.projectRoot,
    state: malformedFixture.claimed,
    taskId: malformedFixture.taskId,
    owner: "mvu-creator",
    proposal: malformedFixture.proposal,
    occurredAt,
  });
  const malformedRaw = "not-json\n";
  const malformedState = workflowStateSchema.parse({
    ...malformedSubmitted,
    tasks: malformedSubmitted.tasks.map((task) => task.id === malformedFixture.taskId
      ? { ...task, result: { ...task.result!, revision: computeTextRevision(malformedRaw) } }
      : task),
  });
  const writeAuthorization = async (projectRoot: string, projectId: string, proposal: PluginProposalEnvelope, state: typeof malformedState, token: string, decision: "approve" | "reject" = "reject") => {
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const tokenPath = path.join(projectRoot, ".workflow", "plugin-review-tokens", `${tokenHash}.json`);
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify({
      schema_version: 1, token_hash: tokenHash, project_id: projectId, proposal_id: proposal.id,
      proposal_revision: proposal.proposal_revision, decision, workflow_revision: state.revision,
      session_id: "p".repeat(32), nonce: "a".repeat(64), expires_at: "2099-07-20T00:00:00.000Z",
    })}\n`, "utf8");
  };
  const malformedPendingPath = path.join(malformedFixture.projectRoot, ".workflow", "results", malformedFixture.taskId, `${malformedFixture.proposal.id}.json`);
  await writeFile(malformedPendingPath, malformedRaw, "utf8");
  const malformedToken = "p".repeat(43);
  await writeAuthorization(malformedFixture.projectRoot, malformedFixture.project.manifest!.id, malformedFixture.proposal, malformedState, malformedToken);
  await expect(decidePluginProposal({
    projectRoot: malformedFixture.projectRoot,
    project: malformedFixture.project,
    state: malformedState,
    proposal: malformedFixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: malformedToken,
  })).rejects.toMatchObject({ code: "PLUGIN_PENDING_RESULT_INVALID" });

  const staleFixture = await submissionFixture();
  const staleSubmitted = await submitPluginProposal({ projectRoot: staleFixture.projectRoot, state: staleFixture.claimed, taskId: staleFixture.taskId, owner: "mvu-creator", proposal: staleFixture.proposal, occurredAt });
  const otherSeed = pluginProposalEnvelopeSchema.parse({
    ...staleFixture.proposal,
    id: "different-pending-proposal",
    proposal_revision: `sha256:${"0".repeat(64)}`,
    pending_result_revision: `sha256:${"0".repeat(64)}`,
  });
  const otherWithRevision = pluginProposalEnvelopeSchema.parse({ ...otherSeed, proposal_revision: proposalRevisionFor(otherSeed) });
  const otherProposal = pluginProposalEnvelopeSchema.parse({ ...otherWithRevision, pending_result_revision: pendingResultRevisionFor(otherWithRevision) });
  const otherRaw = proposalResultText(otherProposal);
  await writeFile(path.join(staleFixture.projectRoot, ".workflow", "results", staleFixture.taskId, `${staleFixture.proposal.id}.json`), otherRaw, "utf8");
  const staleState = workflowStateSchema.parse({
    ...staleSubmitted,
    tasks: staleSubmitted.tasks.map((task) => task.id === staleFixture.taskId
      ? { ...task, result: { ...task.result!, revision: computeTextRevision(otherRaw) } }
      : task),
  });
  const staleToken = "o".repeat(43);
  await writeAuthorization(staleFixture.projectRoot, staleFixture.project.manifest!.id, staleFixture.proposal, staleState, staleToken);
  await expect(decidePluginProposal({
    projectRoot: staleFixture.projectRoot,
    project: staleFixture.project,
    state: staleState,
    proposal: staleFixture.proposal,
    action: "reject",
    occurredAt,
    authorizationToken: staleToken,
  })).rejects.toMatchObject({ code: "PLUGIN_PENDING_RESULT_STALE" });

  const workflowStaleFixture = await submissionFixture();
  const workflowSubmitted = await submitPluginProposal({ projectRoot: workflowStaleFixture.projectRoot, state: workflowStaleFixture.claimed, taskId: workflowStaleFixture.taskId, owner: "mvu-creator", proposal: workflowStaleFixture.proposal, occurredAt });
  const workflowStaleProposal = withBaseWorkflowRevision(workflowStaleFixture.proposal, workflowSubmitted.revision);
  const workflowStaleToken = "n".repeat(43);
  await writeAuthorization(workflowStaleFixture.projectRoot, workflowStaleFixture.project.manifest!.id, workflowStaleProposal, workflowSubmitted, workflowStaleToken);
  await expect(decidePluginProposal({
    projectRoot: workflowStaleFixture.projectRoot,
    project: workflowStaleFixture.project,
    state: workflowSubmitted,
    proposal: workflowStaleProposal,
    action: "reject",
    occurredAt,
    authorizationToken: workflowStaleToken,
  })).rejects.toMatchObject({ code: "PLUGIN_PROPOSAL_WORKFLOW_STALE" });
});