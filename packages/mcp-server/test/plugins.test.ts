/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
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
import { canonicalJson, computeTextRevision, initializeProject, loadAuthorProject, readPluginTemplate, savePluginSource } from "@card-workspace/project";
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

// Boundary cases for plugin tool argument and persistence guards.
describe("plugin MCP boundary matrix", () => {
  it("rejects invalid projects, callers, templates, and CAS argument pairs", async () => {
    const fixture = await setupMcpWorkspace("plugin-boundaries");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "mvu-creator" });
    const base = { trusted, projectRoot: fixture.projectRoot, workflow: undefined, args: { project_id: "plugin-boundaries" } } as never;
    await expect(pluginTools.plugin_selection_resolve({ ...base, args: { project_id: "missing-project" } })).rejects.toThrow(/ENOENT/u);
    await expect(pluginTools.plugin_revision_begin({ ...base, trusted: creator, args: { ...event, project_id: "plugin-boundaries" } })).rejects.toMatchObject({ code: "PLUGIN_REVISION_DENIED" });
    await expect(pluginTools.template_read({ ...base, args: { project_id: "plugin-boundaries", plugin_id: "official.mvu-zod", template_id: "missing" } })).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_NOT_FOUND" });
    await expect(pluginTools.template_import({ ...base, args: { project_id: "plugin-boundaries", plugin_id: "official.mvu-zod", template_id: "x", manifest: {}, payload: {}, expected_manifest_revision: `sha256:${"a".repeat(64)}` } })).rejects.toThrow();
    await expect(pluginTools.template_save_from_artifact({ ...base, args: { project_id: "plugin-boundaries", plugin_id: "official.mvu-zod", template_id: "x", artifact_id: "missing" } })).rejects.toMatchObject({ code: "PLUGIN_ARTIFACT_NOT_APPROVED" });
  });

  it("rejects proposal preview template and resolved source mismatches", async () => {
    const fixture = await setupMcpWorkspace("plugin-preview-boundaries");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "plugin-preview-boundaries");
    if (!loaded.ok || !loaded.workflow) throw new Error("plugin preview fixture failed");
    const source = pluginSourceSchema.parse({ schema_version: 1, plugin_id: "official.mvu-zod", project_kind: "character_card", template_id: "missing-template", implementation: officialPluginImplementationPin("official.mvu-zod"), variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }], update_rules: [] });
    const proposalSeed = pluginProposalEnvelopeSchema.parse({ schema_version: 1, id: "bad-preview", task_id: "create-official-mvu-zod", project_id: "plugin-preview-boundaries", owner: "mvu-creator", proposal_revision: `sha256:${"0".repeat(64)}`, base_workflow_revision: loaded.workflow.revision, value: { kind: "plugin", project_kind: "character_card", plugin_id: "official.mvu-zod", capabilities: ["mvu"], source, expected_source_revision: "absent", expected_manifest_revision: computeTextRevision(await readFile(path.join(fixture.projectRoot, "project.yaml"), "utf8")), template_id: "missing-template", resolved_source_hash: revisionFor(source) }, pending_result_revision: `sha256:${"0".repeat(64)}`, submitted_at: "2026-07-20T00:00:00.000Z" });
    const proposalWithRevision = pluginProposalEnvelopeSchema.parse({ ...proposalSeed, proposal_revision: proposalRevisionFor(proposalSeed) });
    const proposal = pluginProposalEnvelopeSchema.parse({ ...proposalWithRevision, pending_result_revision: pendingResultRevisionFor(proposalWithRevision) });
    await expect(pluginTools.plugin_proposal_preview({ trusted, projectRoot: fixture.projectRoot, workflow: loaded.workflow, args: { project_id: "plugin-preview-boundaries", proposal, template_parameters: {} } } as never)).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_NOT_FOUND" });
  });
  it("covers plugin template authorization, artifact, and optional argument guards", async () => {
    const fixture = await setupMcpWorkspace("plugin-guard-matrix");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const creator = await createTrustedContext({ ...fixture.environment, CARD_WORKSPACE_AGENT_ID: "mvu-creator" });
    const base = { trusted, projectRoot: fixture.projectRoot, workflow: undefined, args: { project_id: "plugin-guard-matrix" } } as never;
    await expect(pluginTools.template_import({
      ...base,
      trusted: creator,
      args: { ...base.args, plugin_id: "official.mvu-zod", template_id: "x", manifest: {}, payload: {} },
    })).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_IMPORT_DENIED" });
    await expect(pluginTools.template_list({ ...base, args: { project_id: "plugin-guard-matrix", plugin_id: "official.ejs" } } as never)).resolves.toEqual([]);
    await expect(pluginTools.template_save_from_artifact({
      ...base,
      args: { ...base.args, plugin_id: "official.ejs", template_id: "x", artifact_id: "missing" },
    })).rejects.toMatchObject({ code: "PLUGIN_ARTIFACT_NOT_APPROVED" });

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
    const artifactPath = path.join(fixture.projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json");
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, canonicalJson({ artifact, source, contributions: generated.contributions }) + "\n", "utf8");
    await expect(pluginTools.template_save_from_artifact({
      ...base,
      args: { ...base.args, plugin_id: "official.ejs", template_id: "x", artifact_id: artifact.id },
    })).rejects.toMatchObject({ code: "PLUGIN_ARTIFACT_NOT_APPROVED" });
    const mismatchedSource = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.ejs",
      project_kind: "character_card",
      implementation: officialPluginImplementationPin("official.ejs"),
      entries: [{ id: "entry", condition: { path: "/mood", operator: "truthy" }, content: "text" }],
      preprocessing: [],
      sections: [],
      dynamic_text: [],
    });
    await writeFile(artifactPath, canonicalJson({ artifact, source: mismatchedSource, contributions: generated.contributions }) + "\n", "utf8");
    await expect(pluginTools.template_save_from_artifact({
      ...base,
      args: { ...base.args, plugin_id: "official.mvu-zod", template_id: "x", artifact_id: artifact.id },
    })).rejects.toMatchObject({ code: "PLUGIN_ARTIFACT_INVALID" });
  });

});

describe("plugin MCP optional branch matrix", () => {
  it("covers invalid project loading, direct proposals, template defaults, and optional lists", async () => {
    const broken = await setupMcpWorkspace("plugin-optional-broken");
    cleanups.push(broken.workspace.cleanup);
    await writeFile(path.join(broken.projectRoot, "project.yaml"), "not: [valid", "utf8");
    const brokenTrusted = await createTrustedContext(broken.environment);
    await expect(pluginTools.plugin_selection_resolve({
      trusted: brokenTrusted,
      projectRoot: broken.projectRoot,
      workflow: undefined,
      args: { project_id: "plugin-optional-broken" },
    } as never)).rejects.toMatchObject({ code: "PROJECT_INVALID" });

    const fixture = await setupMcpWorkspace("plugin-optional-paths");
    cleanups.push(fixture.workspace.cleanup);
    const trusted = await createTrustedContext(fixture.environment);
    const loaded = await loadAuthorProject(fixture.workspace.projectsRoot, "plugin-optional-paths");
    if (!loaded.ok || !loaded.workflow) throw new Error("optional plugin fixture failed to load");
    const implementation = officialPluginImplementationPin("official.mvu-zod");
    const source = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      template_id: "optional-template",
      implementation,
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
      update_rules: [],
    });
    const payload = pluginTemplatePayloadSchema.parse({
      schema_version: 1,
      template_id: "optional-template",
      plugin_id: "official.mvu-zod",
      parameters: {},
      payload: source,
    });
    const manifest = pluginTemplateManifestSchema.parse({
      schema_version: 1,
      id: "optional-template",
      plugin_id: "official.mvu-zod",
      implementation,
      description: "Optional template",
      parameters: [],
      payload_revision: computeTextRevision(canonicalJson(payload)),
      source_revision: revisionFor(source),
      resolved_source_hash: revisionFor(source),
      provenance: { kind: "imported" },
      created_at: "2026-07-20T00:00:00.000Z",
    });
    await expect(pluginTools.template_import({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", plugin_id: "official.mvu-zod", template_id: "optional-template", manifest, payload },
    } as never)).resolves.toMatchObject({ status: "created" });
    await expect(pluginTools.template_import({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: {
        project_id: "plugin-optional-paths",
        plugin_id: "official.mvu-zod",
        template_id: "optional-template",
        manifest,
        payload,
        expected_manifest_revision: "sha256:" + "a".repeat(64),
      },
    } as never)).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_CAS_INVALID" });

    const manifestRevision = computeTextRevision(await readFile(path.join(fixture.projectRoot, "project.yaml"), "utf8"));
    const generated = compileMvuSource(source);
    const seed = pluginProposalEnvelopeSchema.parse({
      schema_version: 1,
      id: "optional-template-proposal",
      task_id: "create-official-mvu-zod",
      project_id: "plugin-optional-paths",
      owner: "mvu-creator",
      proposal_revision: "sha256:" + "0".repeat(64),
      base_workflow_revision: loaded.workflow.revision,
      value: {
        kind: "plugin",
        project_kind: "character_card",
        plugin_id: "official.mvu-zod",
        capabilities: ["mvu"],
        source,
        expected_source_revision: "absent",
        expected_manifest_revision: manifestRevision,
        template_id: "optional-template",
        template_payload_hash: manifest.payload_revision,
        resolved_source_hash: generated.contributions.metadata.resolved_source_hash,
      },
      pending_result_revision: "sha256:" + "0".repeat(64),
      submitted_at: "2026-07-20T00:00:00.000Z",
    });
    const withRevision = pluginProposalEnvelopeSchema.parse({ ...seed, proposal_revision: proposalRevisionFor(seed) });
    const proposal = pluginProposalEnvelopeSchema.parse({ ...withRevision, pending_result_revision: pendingResultRevisionFor(withRevision) });
    await expect(pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", proposal },
    } as never)).resolves.toMatchObject({ plugin_id: "official.mvu-zod" });
    await expect(pluginTools.template_read({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", plugin_id: "official.mvu-zod", template_id: "optional-template" },
    } as never)).resolves.toMatchObject({ manifest: { id: "optional-template" } });

    const mismatchSourceValue = { ...source, variables: [{ id: "mood", label: "Mood", kind: "string", default: "focused" }] };
    const mismatchSource = pluginSourceSchema.parse(mismatchSourceValue);
    const mismatchSeed = pluginProposalEnvelopeSchema.parse({
      ...seed,
      id: "optional-template-mismatch",
      value: { ...seed.value, source: mismatchSource, resolved_source_hash: revisionFor(mismatchSource) },
      proposal_revision: "sha256:" + "0".repeat(64),
      pending_result_revision: "sha256:" + "0".repeat(64),
    });
    const mismatchWithRevision = pluginProposalEnvelopeSchema.parse({ ...mismatchSeed, proposal_revision: proposalRevisionFor(mismatchSeed) });
    const mismatchProposal = pluginProposalEnvelopeSchema.parse({ ...mismatchWithRevision, pending_result_revision: pendingResultRevisionFor(mismatchWithRevision) });
    await expect(pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", proposal: mismatchProposal },
    } as never)).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_SOURCE_MISMATCH" });

    const directSourceValue = { ...source };
    delete directSourceValue.template_id;
    const directSource = pluginSourceSchema.parse(directSourceValue);
    const directGenerated = compileMvuSource(directSource);
    const directValue = {
      ...seed.value,
      source: directSource,
      resolved_source_hash: directGenerated.contributions.metadata.resolved_source_hash,
    };
    delete directValue.template_id;
    delete directValue.template_payload_hash;
    const directSeed = pluginProposalEnvelopeSchema.parse({
      ...seed,
      id: "optional-direct-proposal",
      value: directValue,
      proposal_revision: "sha256:" + "0".repeat(64),
      pending_result_revision: "sha256:" + "0".repeat(64),
    });
    const directWithRevision = pluginProposalEnvelopeSchema.parse({ ...directSeed, proposal_revision: proposalRevisionFor(directSeed) });
    const directProposal = pluginProposalEnvelopeSchema.parse({ ...directWithRevision, pending_result_revision: pendingResultRevisionFor(directWithRevision) });
    const directPreview = await pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", proposal: directProposal },
    } as never);
    expect(directPreview).toMatchObject({ plugin_id: "official.mvu-zod" });
    expect(directPreview).not.toHaveProperty("template_payload_hash");
    const hashMismatchValue = { ...directValue, resolved_source_hash: "sha256:" + "f".repeat(64) };
    const hashMismatchSeed = pluginProposalEnvelopeSchema.parse({
      ...directSeed,
      id: "optional-hash-mismatch",
      value: hashMismatchValue,
      proposal_revision: "sha256:" + "0".repeat(64),
      pending_result_revision: "sha256:" + "0".repeat(64),
    });
    const hashMismatchWithRevision = pluginProposalEnvelopeSchema.parse({ ...hashMismatchSeed, proposal_revision: proposalRevisionFor(hashMismatchSeed) });
    const hashMismatchProposal = pluginProposalEnvelopeSchema.parse({ ...hashMismatchWithRevision, pending_result_revision: pendingResultRevisionFor(hashMismatchWithRevision) });
    await expect(pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths", proposal: hashMismatchProposal },
    } as never)).rejects.toMatchObject({ code: "PLUGIN_RESOLVED_SOURCE_MISMATCH" });

    await expect(pluginTools.template_list({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths" },
    } as never)).resolves.toHaveLength(1);
    await expect(pluginTools.plugin_revision_preview({
      trusted,
      projectRoot: fixture.projectRoot,
      workflow: loaded.workflow,
      args: { project_id: "plugin-optional-paths" },
    } as never)).resolves.toMatchObject({ intent: { selections: [] } });

    const worldbookRoot = await initializeProject({
      projectsRoot: fixture.workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: "plugin-optional-worldbook",
        title: "Plugin worldbook",
        kind: "worldbook",
        card: { name: "Plugin worldbook" },
        characters: [],
      }),
      world: { enabled: true, categories: ["geography"], scope: "shared" },
    });
    const worldbookLoaded = await loadAuthorProject(fixture.workspace.projectsRoot, "plugin-optional-worldbook");
    if (!worldbookLoaded.ok || !worldbookLoaded.workflow) throw new Error("worldbook plugin fixture failed to load");
    expect(worldbookLoaded.greetings).toBeUndefined();
    await expect(pluginTools.plugin_selection_resolve({
      trusted,
      projectRoot: worldbookRoot,
      workflow: worldbookLoaded.workflow,
      args: { project_id: "plugin-optional-worldbook" },
    } as never)).resolves.toMatchObject({ project_kind: "worldbook", sources: [], artifacts: [] });
    const worldSeed = pluginProposalEnvelopeSchema.parse({
      ...directSeed,
      id: "optional-worldbook-proposal",
      project_id: "plugin-optional-worldbook",
      base_workflow_revision: worldbookLoaded.workflow.revision,
      value: {
        ...directSeed.value,
        expected_manifest_revision: computeTextRevision(await readFile(path.join(worldbookRoot, "project.yaml"), "utf8")),
      },
      proposal_revision: "sha256:" + "0".repeat(64),
      pending_result_revision: "sha256:" + "0".repeat(64),
    });
    const worldWithRevision = pluginProposalEnvelopeSchema.parse({ ...worldSeed, proposal_revision: proposalRevisionFor(worldSeed) });
    const worldProposal = pluginProposalEnvelopeSchema.parse({ ...worldWithRevision, pending_result_revision: pendingResultRevisionFor(worldWithRevision) });
    await expect(pluginTools.plugin_proposal_preview({
      trusted,
      projectRoot: worldbookRoot,
      workflow: worldbookLoaded.workflow,
      args: { project_id: "plugin-optional-worldbook", proposal: worldProposal },
    } as never)).resolves.toMatchObject({ plugin_id: "official.mvu-zod" });

    const active = await setupMcpWorkspace("plugin-optional-active");
    cleanups.push(active.workspace.cleanup);
    const activeSourceValue = { ...source };
    delete activeSourceValue.template_id;
    const activeSource = pluginSourceSchema.parse(activeSourceValue);
    await savePluginSource(active.projectRoot, "official.mvu-zod", activeSource);
    const activeSourceRevision = computeTextRevision(await readFile(path.join(active.projectRoot, "extensions", "official.mvu-zod", "source.yaml"), "utf8"));
    const activeGenerated = compileMvuSource(activeSource);
    const activeArtifact = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: activeGenerated.artifact_revision,
      source_revision: activeSourceRevision,
      resolved_source_hash: activeGenerated.contributions.metadata.resolved_source_hash,
      implementation,
      generated_at: "2026-07-20T00:00:00.000Z",
      status: "approved",
    });
    const projectPath = path.join(active.projectRoot, "project.yaml");
    const projectRaw = await readFile(projectPath, "utf8");
    const projectWithPlugin = projectRaw.replace(/^plugins:.*$/mu, "plugins:\n  - official.mvu-zod");
    if (projectWithPlugin === projectRaw) throw new Error("plugin manifest field missing");
    await writeFile(projectPath, projectWithPlugin, "utf8");
    await writeFile(
      path.join(active.projectRoot, "greetings.yaml"),
      canonicalJson({ schema_version: 1, greetings: [{ id: "primary", kind: "primary", content: "Hello", character_ids: ["alice"] }] }) + "\n",
      "utf8",
    );
    const selection = {
      schema_version: 1,
      project_id: "plugin-optional-active",
      selections: [{
        schema_version: 1,
        plugin_id: "official.mvu-zod",
        capabilities: ["mvu"],
        source_revision: activeSourceRevision,
        implementation,
        artifact_revision: activeArtifact.revision,
      }],
      updated_at: "2026-07-20T00:00:00.000Z",
    };
    await mkdir(path.join(active.projectRoot, ".workflow"), { recursive: true });
    await writeFile(
      path.join(active.projectRoot, ".workflow", "plugin-selection.yaml"),
      canonicalJson({ ...selection, intent_revision: revisionFor({ project_id: selection.project_id, selections: selection.selections }) }) + "\n",
      "utf8",
    );
    await mkdir(path.join(active.projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
    await writeFile(
      path.join(active.projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"),
      canonicalJson({ artifact: activeArtifact, source: activeSource, contributions: activeGenerated.contributions }) + "\n",
      "utf8",
    );
    const activeLoaded = await loadAuthorProject(active.workspace.projectsRoot, "plugin-optional-active");
    if (!activeLoaded.ok || !activeLoaded.workflow) throw new Error("active plugin fixture failed to load: " + JSON.stringify(activeLoaded.diagnostics));
    const activeTrusted = await createTrustedContext(active.environment);
    await expect(pluginTools.plugin_selection_resolve({
      trusted: activeTrusted,
      projectRoot: active.projectRoot,
      workflow: activeLoaded.workflow,
      args: { project_id: "plugin-optional-active" },
    } as never)).resolves.toMatchObject({ sources: [{ plugin_id: "official.mvu-zod" }], artifacts: [activeArtifact] });
    await expect(pluginTools.template_save_from_artifact({
      trusted: activeTrusted,
      projectRoot: active.projectRoot,
      workflow: activeLoaded.workflow,
      args: {
        project_id: "plugin-optional-active",
        plugin_id: "official.mvu-zod",
        template_id: "active-artifact-template",
        artifact_id: "plugin-official.mvu-zod",
        description: "Active artifact template",
      },
    } as never)).resolves.toMatchObject({ status: "created" });

    const activeManifestRevision = computeTextRevision(await readFile(projectPath, "utf8"));
    const activeSeed = pluginProposalEnvelopeSchema.parse({
      ...directSeed,
      id: "optional-active-proposal",
      project_id: "plugin-optional-active",
      base_workflow_revision: activeLoaded.workflow.revision,
      value: {
        ...directSeed.value,
        project_kind: "character_card",
        source: activeSource,
        expected_source_revision: activeSourceRevision,
        expected_manifest_revision: activeManifestRevision,
        resolved_source_hash: activeGenerated.contributions.metadata.resolved_source_hash,
      },
      proposal_revision: "sha256:" + "0".repeat(64),
      pending_result_revision: "sha256:" + "0".repeat(64),
    });
    const activeWithRevision = pluginProposalEnvelopeSchema.parse({ ...activeSeed, proposal_revision: proposalRevisionFor(activeSeed) });
    const activeProposal = pluginProposalEnvelopeSchema.parse({ ...activeWithRevision, pending_result_revision: pendingResultRevisionFor(activeWithRevision) });
    await expect(pluginTools.plugin_proposal_preview({
      trusted: activeTrusted,
      projectRoot: active.projectRoot,
      workflow: activeLoaded.workflow,
      args: { project_id: "plugin-optional-active", proposal: activeProposal },
    } as never)).resolves.toMatchObject({ plugin_id: "official.mvu-zod" });
  });
});
