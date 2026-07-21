import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compileMvuSource,
  officialPluginImplementationPin,
  pendingResultRevisionFor,
  proposalRevisionFor,
  revisionFor,
} from "@card-workspace/plugins";
import { canonicalJson, computeTextRevision, initializeProject, loadAuthorProject, readPluginTemplate } from "@card-workspace/project";
import {
  pluginArtifactSchema,
  pluginProposalEnvelopeSchema,
  pluginSourceSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  projectManifestSchema,
  type MvuSource,
} from "@card-workspace/schemas";

import { createTrustedContext } from "../src/context.js";
import { toolRegistry } from "../src/tool-registry.js";
import { pluginTools } from "../src/tools/plugins.js";
import { setupMcpWorkspace } from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

const project = { project_id: "plugin-project" };
const event = {
  expected_workflow_revision: 3,
  event_id: "plugin-event-1",
  occurred_at: "2026-07-20T00:00:00.000Z",
};

describe("plugin MCP tool contracts", () => {
  it("registers every M10 plugin tool as a project-scoped tool", () => {
    const names = [
      "plugin_selection_resolve",
      "plugin_revision_preview",
      "plugin_revision_begin",
      "plugin_proposal_preview",
      "plugin_proposal_submit",
      "plugin_review_decide",
      "template_list",
      "template_read",
      "template_import",
      "template_save_from_artifact",
    ] as const;

    for (const name of names) {
      expect(toolRegistry[name]?.scope).toBe("project");
      expect(toolRegistry[name]?.description.length).toBeGreaterThan(0);
    }
  });

  it("keeps revision and template contracts bounded", () => {
    expect(toolRegistry.plugin_selection_resolve?.inputSchema.safeParse(project).success).toBe(true);
    expect(toolRegistry.plugin_revision_preview?.inputSchema.safeParse(project).success).toBe(true);
    expect(toolRegistry.plugin_revision_begin?.inputSchema.safeParse({ ...project, ...event }).success).toBe(true);
    expect(toolRegistry.template_list?.inputSchema.safeParse(project).success).toBe(true);
    expect(toolRegistry.template_read?.inputSchema.safeParse(project).success).toBe(false);
    expect(toolRegistry.template_import?.inputSchema.safeParse(project).success).toBe(false);
    expect(toolRegistry.template_save_from_artifact?.inputSchema.safeParse(project).success).toBe(false);
  });

  it("does not accept legacy proposal payloads or malformed decision tokens", () => {
    const legacyProposal = {
      ...project,
      proposal: { schema_version: 1, kind: "blueprint" },
    };
    expect(toolRegistry.plugin_proposal_preview?.inputSchema.safeParse(legacyProposal).success).toBe(false);
    expect(toolRegistry.plugin_proposal_submit?.inputSchema.safeParse({ ...legacyProposal, ...event, task_id: "create-plugin-mvu", lease_id: "lease-1" }).success).toBe(false);
    expect(toolRegistry.plugin_review_decide?.inputSchema.safeParse({
      ...project,
      ...event,
      proposal: legacyProposal.proposal,
      action: "approve",
      authorization_token: "not-a-token",
    }).success).toBe(false);
  });

  it("resolves an empty plugin selection without mutating the project", async () => {
    const fixture = await setupMcpWorkspace("plugin-tools");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const projectState = await pluginTools.plugin_selection_resolve({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: undefined,
      args: { project_id: "plugin-tools" },
    } as never);
    expect(projectState).toMatchObject({
      project_id: "plugin-tools",
      project_kind: "character_card",
      blueprint_selections: [],
      sources: [],
      artifacts: [],
    });

    const preview = await pluginTools.plugin_revision_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: undefined,
      args: { project_id: "plugin-tools", desired_selections: [] },
    } as never);
    expect(preview.intent).toMatchObject({
      project_id: "plugin-tools",
      selections: [],
      dependency_closure: [],
      implementation_pins: [],
    });
  });

  it("begins a real MVU revision and persists its first author task", async () => {
    const fixture = await setupMcpWorkspace("plugin-revision-begin");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "plugin-revision-begin");
    if (!loaded.ok || !loaded.workflow) throw new Error("plugin fixture workflow failed to load");

    const result = await pluginTools.plugin_revision_begin({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: {
        project_id: "plugin-revision-begin",
        expected_workflow_revision: loaded.workflow.revision,
        event_id: "plugin-revision-begin-e2e",
        occurred_at: "2026-07-20T00:00:00.000Z",
        desired_selections: [{ plugin_id: "official.mvu-zod", capabilities: ["mvu"] }],
        implementation_pins: {
          "official.mvu-zod": officialPluginImplementationPin("official.mvu-zod"),
        },
      },
    } as never);

    expect(result).toMatchObject({
      stage: "plugin_mvu_authoring",
      tasks: [{ id: "create-official-mvu-zod", kind: "create-plugin-mvu", assigned_agent: "mvu-creator" }],
    });
    const reloaded = await loadAuthorProject(fixture.workspace.projectsRoot, "plugin-revision-begin");
    expect(reloaded.ok && reloaded.workflow).toMatchObject({
      stage: "plugin_mvu_authoring",
      revision: 1,
    });
  });

  it("imports templates idempotently and requires CAS for replacement", async () => {
    const fixture = await setupMcpWorkspace("plugin-template-import");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
     const implementation = officialPluginImplementationPin("official.mvu-zod");
    const templateSource: MvuSource = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      implementation,
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
      update_rules: [],
    });
    const payload = pluginTemplatePayloadSchema.parse({
      schema_version: 1,
      template_id: "starter",
      plugin_id: "official.mvu-zod",
      parameters: {},
      payload: templateSource,
    });
    const manifest = pluginTemplateManifestSchema.parse({
      schema_version: 1,
      id: "starter",
      plugin_id: "official.mvu-zod",
      implementation,
      description: "Starter template",
      parameters: [],
      payload_revision: computeTextRevision(canonicalJson(payload)),
      source_revision: revisionFor(templateSource),
      resolved_source_hash: revisionFor(templateSource),
      provenance: { kind: "imported" },
      created_at: "2026-07-20T00:00:00.000Z",
    });
    const context = {
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: undefined,
      args: {
        project_id: "plugin-template-import",
        plugin_id: "official.mvu-zod",
        template_id: "starter",
        manifest,
        payload,
      },
    };

    await expect(pluginTools.template_import(context)).resolves.toMatchObject({ status: "created", saved: true });
    await expect(pluginTools.template_import(context)).resolves.toMatchObject({ status: "unchanged", saved: false });

    const changedSource: MvuSource = {
      ...templateSource,
      variables: [{ ...templateSource.variables[0]!, default: "focused" }],
    };
    const changedPayload = pluginTemplatePayloadSchema.parse({ ...payload, payload: changedSource });
    const changedManifest = pluginTemplateManifestSchema.parse({
      ...manifest,
      payload_revision: computeTextRevision(canonicalJson(changedPayload)),
      source_revision: revisionFor(changedSource),
      resolved_source_hash: revisionFor(changedSource),
    });
    await expect(pluginTools.template_import({
      ...context,
      args: { ...context.args, manifest: changedManifest, payload: changedPayload },
    } as never)).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_CONFLICT" });

    const current = await readPluginTemplate(fixture.projectRoot, "official.mvu-zod", "starter");
    if (!current) throw new Error("template was not persisted");
    const manifestPath = "templates/plugins/official.mvu-zod/starter/1/manifest.yaml";
    const payloadPath = "templates/plugins/official.mvu-zod/starter/1/payload.yaml";
    await expect(pluginTools.template_import({
      ...context,
      args: {
        ...context.args,
        manifest: changedManifest,
        payload: changedPayload,
        expected_manifest_revision: current.revisions[manifestPath],
        expected_payload_revision: current.revisions[payloadPath],
      },
    } as never)).resolves.toMatchObject({ status: "replaced", saved: true });
  });

  it("only saves approved artifacts as idempotent templates", async () => {
    const fixture = await setupMcpWorkspace("plugin-template-artifact");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const source: MvuSource = {
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
       implementation: officialPluginImplementationPin("official.mvu-zod"),
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
      update_rules: [],
    };
    const generated = compileMvuSource(source);
    const artifact = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: generated.artifact_revision,
      source_revision: computeTextRevision(canonicalJson(source)),
      resolved_source_hash: generated.contributions.metadata.resolved_source_hash,
      implementation: source.implementation,
      generated_at: "2026-07-20T00:00:00.000Z",
      status: "approved",
    });
    const artifactRoot = path.join(fixture.projectRoot, ".workflow", "plugin-artifacts");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      path.join(artifactRoot, "plugin-official.mvu-zod.json"),
      `${canonicalJson({ artifact, source, contributions: generated.contributions })}\n`,
      "utf8",
    );

    const context = {
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: undefined,
      args: {
        project_id: "plugin-template-artifact",
        plugin_id: "official.mvu-zod",
        template_id: "saved-from-artifact",
        artifact_id: "plugin-official.mvu-zod",
      },
    };
    await expect(pluginTools.template_save_from_artifact(context)).resolves.toMatchObject({
      status: "created",
      saved: true,
    });
    await expect(pluginTools.template_save_from_artifact(context)).resolves.toMatchObject({
      status: "unchanged",
      saved: false,
    });
  });

  it("reuses an imported template in a second project to resolve a proposal source", async () => {
    const fixture = await setupMcpWorkspace("plugin-template-source");
    cleanups.push(fixture.workspace.cleanup);
    const targetId = "plugin-template-target";
    const targetRoot = await initializeProject({
      projectsRoot: fixture.workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: targetId,
        title: "Template target",
        kind: "character_card",
        card: { name: "Template target" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
      }),
    });
    const trusted = await createTrustedContext(fixture.environment);
     const implementation = officialPluginImplementationPin("official.mvu-zod");
    const templateSource = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      template_id: "shared",
      implementation,
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
      update_rules: [],
    });
    const payload = pluginTemplatePayloadSchema.parse({
      schema_version: 1,
      template_id: "shared",
      plugin_id: "official.mvu-zod",
      parameters: { "/variables/0/default": "calm" },
      payload: templateSource,
    });
    const manifest = pluginTemplateManifestSchema.parse({
      schema_version: 1,
      id: "shared",
      plugin_id: "official.mvu-zod",
      implementation,
      description: "Shared MVU template",
      parameters: [{ pointer: "/variables/0/default", type: "string" }],
      payload_revision: computeTextRevision(canonicalJson(payload)),
      source_revision: revisionFor(templateSource),
      resolved_source_hash: revisionFor(templateSource),
      provenance: { kind: "imported" },
      created_at: "2026-07-20T00:00:00.000Z",
    });

    const importTemplate = async (projectRoot: string, projectId: string) => pluginTools.template_import({
      trusted,
      projectRoot,
      workflow: undefined,
      args: {
        project_id: projectId,
        plugin_id: "official.mvu-zod",
        template_id: "shared",
        manifest,
        payload,
      },
    } as never);
    await expect(importTemplate(fixture.projectRoot, "plugin-template-source")).resolves.toMatchObject({ status: "created" });
    await expect(importTemplate(targetRoot, targetId)).resolves.toMatchObject({ status: "created" });

    const target = await loadAuthorProject(fixture.workspace.projectsRoot, targetId);
    if (!target.ok || !target.workflow) throw new Error("template target failed to load");
    const resolvedSource = pluginSourceSchema.parse({
      ...templateSource,
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "focused" }],
    });
    const resolvedGenerated = compileMvuSource(resolvedSource);
    const proposalSeed = pluginProposalEnvelopeSchema.parse({
      schema_version: 1,
      id: "template-target-proposal",
      task_id: "create-official-mvu-zod",
      project_id: targetId,
      owner: "mvu-creator",
      proposal_revision: `sha256:${"0".repeat(64)}`,
      base_workflow_revision: target.workflow.revision,
      value: {
        kind: "plugin",
        project_kind: "character_card",
        plugin_id: "official.mvu-zod",
        capabilities: ["mvu"],
        source: resolvedSource,
        expected_source_revision: "absent",
        expected_manifest_revision: computeTextRevision(await readFile(path.join(targetRoot, "project.yaml"), "utf8")),
        template_id: "shared",
        template_payload_hash: manifest.payload_revision,
        resolved_source_hash: resolvedGenerated.contributions.metadata.resolved_source_hash,
      },
      pending_result_revision: `sha256:${"0".repeat(64)}`,
      submitted_at: "2026-07-20T00:00:00.000Z",
    });
    const proposalWithRevision = { ...proposalSeed, proposal_revision: proposalRevisionFor(proposalSeed) };
    const proposal = pluginProposalEnvelopeSchema.parse({
      ...proposalWithRevision,
      pending_result_revision: pendingResultRevisionFor(proposalWithRevision),
    });
    await expect(pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: targetRoot,
      workflow: target.workflow,
      args: {
        project_id: targetId,
        proposal,
        template_parameters: { "/variables/0/default": "focused" },
      },
    } as never)).resolves.toMatchObject({
      plugin_id: "official.mvu-zod",
      resolved_source: resolvedSource,
      template_payload_hash: manifest.payload_revision,
    });
  });
});
