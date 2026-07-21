import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  claimTask,
  commitWorkflowMutation,
  derivePluginDependencyImpact,
  submitPluginProposal,
} from "../src/index.js";
import {
  compileMvuSource,
  officialPluginImplementationPin,
  pendingResultRevisionFor,
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
  const startedState = await commitWorkflowMutation(projectRoot, {
    expectedRevision: initial.workflow.revision,
    eventId: "plugin-submit-revision-begin",
    actor: "director",
    occurredAt,
    update: () => started,
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
});
