import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, computeTextRevision, initializeProject, loadAuthorProject } from "@card-workspace/project";
import {
  pluginArtifactSchema,
  pluginSelectionProjectionSchema,
  pluginSelectionSchema,
  pluginSourceSchema,
  projectManifestSchema,
  workflowStateSchema,
} from "@card-workspace/schemas";
import { readCardFromPng } from "@card-workspace/adapters-png";
import {
  generateActivePluginContributions,
  officialPluginImplementationPin,
  revisionFor,
} from "@card-workspace/plugins";
import { buildCharacterCardPng, makeTemporaryWorkspace, writeYamlFixture } from "@card-workspace/testing";
import { afterEach, describe, expect, it } from "vitest";

import { commitWorkflowMutation, createCompilePreview, publishApprovedPreview } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function setup() {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  const projectRoot = await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1, id: "preview-demo", title: "Preview", kind: "character_card",
      card: { name: "Preview" }, output: { json: true, png: false, v2_backfill: false },
      characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
    }),
  });
  await commitWorkflowMutation(projectRoot, {
    expectedRevision: 0, eventId: "gates-ready", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
    update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "compile_preview",
      artifacts: [{ id: "author-content", status: "approved", revision: `sha256:${"a".repeat(64)}`, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }], gates: [
      { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
      { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
      { id: "content", status: "approved", input_revisions: [{ id: "author-content", revision: `sha256:${"a".repeat(64)}` }], extensions: {} },
      { id: "publish", status: "pending", input_revisions: [], extensions: {} },
    ] }),
  });
  return { workspace, projectRoot };
}

describe("preview/publish lock", () => {
  it("worldbook compile preview、批准與 publish 輸出 standalone JSON", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1, id: "worldbook-preview", title: "Worldbook", kind: "worldbook",
        card: { name: "Worldbook" }, characters: [],
      }),
    });
    await writeYamlFixture(path.join(projectRoot, "world/concepts/magic.yaml"), {
      schema_version: 1, id: "magic", category: "concepts", title: "魔法", content: "星辰魔法。",
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 0, eventId: "worldbook-gates-ready", actor: "engine", occurredAt: "2026-07-14T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 1, stage: "compile_preview",
        artifacts: [{ id: "author-content", status: "approved", revision: `sha256:${"a".repeat(64)}`, updated_at: "2026-07-14T00:00:00.000Z", extensions: {} }], gates: [
        { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
        { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
        { id: "content", status: "approved", input_revisions: [{ id: "author-content", revision: `sha256:${"a".repeat(64)}` }], extensions: {} },
        { id: "publish", status: "pending", input_revisions: [], extensions: {} },
      ] }),
    });
    const preview = await createCompilePreview({
      workspaceRoot: workspace.root, projectId: "worldbook-preview", previewId: "preview-world",
      eventId: "preview-world-created", actor: "director", occurredAt: "2026-07-14T00:00:00.000Z",
      build: { png: true, v2Backfill: true },
    });
    expect(preview.options.token_budget).toBeUndefined();
    expect(preview).toMatchObject({ output_kind: "worldbook", options: { json: true, png: false, v2_backfill: false } });
    expect(preview.artifact_hashes).toHaveProperty("exports/worldbook-preview/worldbook-preview.worldbook.json");
    expect(preview.artifact_hashes).not.toHaveProperty("exports/worldbook-preview/worldbook-preview.json");
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 2, eventId: "worldbook-publish-approved", actor: "user", occurredAt: "2026-07-14T00:01:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 3, stage: "publish_review", gates: state.gates.map((gate) =>
        gate.id === "publish" ? { ...gate, status: "approved", input_revisions: [{ id: preview.id, revision: preview.revision }] } : gate),
      }),
    });
    const published = await publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "worldbook-preview", previewId: preview.id,
      eventId: "worldbook-published", actor: "director", occurredAt: "2026-07-14T00:02:00.000Z",
    });
    expect(published.result.output.kind).toBe("worldbook");
    expect(published.workflow.stage).toBe("published");
    await expect(readFile(path.join(workspace.exportsRoot, "worldbook-preview/worldbook-preview.worldbook.json"), "utf8"))
      .resolves.toContain('"spec": "lorebook_v3"');
  });

  it("只發布 Publish Gate 批准的 exact input/options/artifact hashes", async () => {
    const { workspace, projectRoot } = await setup();
    const preview = await createCompilePreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: "preview-1",
      eventId: "preview-created", actor: "user", occurredAt: "2026-07-14T00:01:00.000Z",
      build: { png: false },
    });
    await expect(readFile(path.join(workspace.exportsRoot, "preview-demo/preview-demo.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 2, eventId: "publish-review-entered", actor: "director", occurredAt: "2026-07-14T00:01:15.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 3, stage: "publish_review" }),
    });
    await expect(publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: preview.id,
      eventId: "publish-before-approval", actor: "director", occurredAt: "2026-07-14T00:01:30.000Z",
    })).rejects.toMatchObject({ code: "PUBLISH_PREVIEW_NOT_APPROVED" });

    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 3, eventId: "publish-approved", actor: "user", occurredAt: "2026-07-14T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 4, stage: "publish_review", gates: state.gates.map((gate) =>
        gate.id === "publish" ? { ...gate, status: "approved", input_revisions: [{ id: preview.id, revision: preview.revision }] } : gate),
      }),
    });
    const published = await publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: preview.id,
      eventId: "preview-published", actor: "director", occurredAt: "2026-07-14T00:03:00.000Z",
    });
    expect(published.result.published).toBe(true);
    expect(published.workflow.stage).toBe("published");
    expect(published.workflow.artifacts.find((item) => item.id === preview.id)?.status).toBe("approved");
    await expect(readFile(path.join(projectRoot, `.workflow/publish-receipts/${published.receipt.id}.json`), "utf8"))
      .resolves.toContain(preview.revision);
    const exportPath = path.join(workspace.exportsRoot, "preview-demo/preview-demo.json");
    const oldExport = await readFile(exportPath);

    const modulePath = path.join(projectRoot, "characters/alice/zhuji/01-appearance.yaml");
    const raw = await readFile(modulePath, "utf8");
    await writeFile(modulePath, raw.replace("[待填寫]", "輸入已變更"), "utf8");
    await expect(publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: preview.id,
      eventId: "stale-preview-publish", actor: "director", occurredAt: "2026-07-14T00:04:00.000Z",
    })).rejects.toMatchObject({ code: "BUILD_PREVIEW_INPUT_STALE" });
    await expect(readFile(exportPath)).resolves.toEqual(oldExport);
    const stale = await loadAuthorProject(workspace.projectsRoot, "preview-demo");
    expect(stale.workflow?.artifacts.find((item) => item.id === preview.id)?.status).toBe("stale");
    expect(stale.workflow?.gates.find((item) => item.id === "publish")?.status).toBe("superseded");
  });

  it("exports 完成後、workflow 寫入前故障會回滾 build、archive、exports、receipt 與 workflow", async () => {
    const { workspace, projectRoot } = await setup();
    const preview = await createCompilePreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: "preview-fault",
      eventId: "preview-fault-created", actor: "user", occurredAt: "2026-07-14T00:01:00.000Z",
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 2, eventId: "fault-approved", actor: "user", occurredAt: "2026-07-14T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 3, stage: "publish_review", gates: state.gates.map((gate) =>
        gate.id === "publish" ? { ...gate, status: "approved", input_revisions: [{ id: preview.id, revision: preview.revision }] } : gate),
      }),
    });
    const rawWorkflow = await readFile(path.join(projectRoot, "workflow.json"));
    const rawJournal = await readFile(path.join(projectRoot, ".workflow/journal.jsonl"));
    await expect(publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: preview.id,
      eventId: "fault-published", actor: "director", occurredAt: "2026-07-14T00:03:00.000Z",
      beforePublish: (_index, operation) => {
        if (operation.relativePath.endsWith("/workflow.json")) throw new Error("after exports");
      },
    })).rejects.toThrow("after exports");
    await expect(readFile(path.join(workspace.exportsRoot, "preview-demo/preview-demo.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, ".build/manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, ".workflow/publish-receipts/fault-published.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(projectRoot, "workflow.json"))).resolves.toEqual(rawWorkflow);
    await expect(readFile(path.join(projectRoot, ".workflow/journal.jsonl"))).resolves.toEqual(rawJournal);
  });

  it("已發布專案可建立全新 preview 並受控重開重新打包流程", async () => {
    const { workspace, projectRoot } = await setup();
    const original = await createCompilePreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: "preview-original",
      eventId: "preview-original-created", actor: "director", occurredAt: "2026-07-14T00:01:00.000Z",
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 2, eventId: "original-approved", actor: "user", occurredAt: "2026-07-14T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 3, stage: "publish_review", gates: state.gates.map((gate) =>
        gate.id === "publish" ? { ...gate, status: "approved", input_revisions: [{ id: original.id, revision: original.revision }] } : gate),
      }),
    });
    await publishApprovedPreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: original.id,
      eventId: "original-published", actor: "director", occurredAt: "2026-07-14T00:03:00.000Z",
    });
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 4, eventId: "repackage-opened", actor: "director", occurredAt: "2026-07-14T00:03:30.000Z",
      update: (state) => workflowStateSchema.parse({ ...state, revision: 5, stage: "compile_preview" }),
    });

    const replacement = await createCompilePreview({
      workspaceRoot: workspace.root, projectId: "preview-demo", previewId: "preview-repackaged",
      eventId: "repackage-preview-created", actor: "director", occurredAt: "2026-07-14T00:04:00.000Z",
    });
    const reopened = await loadAuthorProject(workspace.projectsRoot, "preview-demo");
    expect(reopened.workflow?.stage).toBe("publish_review");
    expect(reopened.workflow?.artifacts.find((item) => item.id === original.id)?.status).toBe("stale");
    expect(reopened.workflow?.artifacts.find((item) => item.id === replacement.id)?.status).toBe("reviewed");
    expect(reopened.workflow?.gates.find((item) => item.id === "publish")?.status).toBe("superseded");
  });

  it("plugin evidence drift 會在建立 preview 前原子失效既有 gate", async () => {
    const { workspace, projectRoot } = await setup();
    const pluginRevision = `sha256:${"c".repeat(64)}`;
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: 1,
      eventId: "plugin-evidence-approved",
      actor: "dashboard-user",
      occurredAt: "2026-07-14T00:00:30.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        artifacts: [
          ...state.artifacts,
          { id: "plugin-official.mvu-zod", status: "approved", revision: pluginRevision, updated_at: "2026-07-14T00:00:30.000Z", contract: "plugin-artifact@1", extensions: {} },
        ],
      }),
    });

    await expect(createCompilePreview({
      workspaceRoot: workspace.root,
      projectId: "preview-demo",
      previewId: "preview-plugin-drift",
      eventId: "preview-plugin-drift",
      actor: "director",
      occurredAt: "2026-07-14T00:01:00.000Z",
    })).rejects.toMatchObject({ code: "PREVIEW_PLUGIN_INPUT_STALE" });

    const refreshed = await loadAuthorProject(workspace.projectsRoot, "preview-demo");
    expect(refreshed.workflow?.artifacts.find((item) => item.id === "plugin-official.mvu-zod")?.status).toBe("stale");
    expect(refreshed.workflow?.gates.find((gate) => gate.id === "content")?.status).toBe("superseded");
    expect(refreshed.workflow?.revision).toBe(3);
  });

  it("三個 persisted plugin 可通過 exact preview、PNG publish 與 plugin trace", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "preview-multi-plugin";
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: "Preview multi plugin",
        kind: "character_card",
        card: { name: "Preview multi plugin" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
        plugins: ["official.mvu-zod", "official.ejs", "official.html"],
        output: { json: true, png: true, v2_backfill: false },
      }),
    });
    await mkdir(path.join(projectRoot, "assets"), { recursive: true });
    await writeFile(path.join(projectRoot, "assets", "avatar.png"), buildCharacterCardPng());

    const sources = [
      pluginSourceSchema.parse({
        schema_version: 1,
        plugin_id: "official.mvu-zod",
        project_kind: "character_card",
        implementation: officialPluginImplementationPin("official.mvu-zod"),
        variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm", writable: true, update_rules: ["Update mood"] }],
        update_rules: [],
      }),
      pluginSourceSchema.parse({
        schema_version: 1,
        plugin_id: "official.ejs",
        project_kind: "character_card",
        implementation: officialPluginImplementationPin("official.ejs"),
        entries: [{ id: "mood-entry", condition: { path: "/mood", operator: "truthy" }, content: "Mood is active" }],
        preprocessing: [{ id: "mood-alias", path: "/mood" }],
        sections: [],
        dynamic_text: [],
      }),
      pluginSourceSchema.parse({
        schema_version: 1,
        plugin_id: "official.html",
        project_kind: "character_card",
        implementation: officialPluginImplementationPin("official.html"),
        features: ["status_bar", "message_presentation"],
        components: [
          { id: "status", feature: "status_bar", tag: "section", label: "Status", text: [{ kind: "text", value: "Mood" }], binding_paths: ["/mood"] },
          { id: "message", feature: "message_presentation", tag: "div", label: "Message", text: [{ kind: "text", value: "Message" }], binding_paths: [] },
        ],
      }),
    ];
    const sourceRevisions = new Map<string, string>();
    for (const source of sources) {
      const sourcePath = path.join(projectRoot, "extensions", source.plugin_id, "source.yaml");
      await writeYamlFixture(sourcePath, source);
      sourceRevisions.set(source.plugin_id, computeTextRevision(await readFile(sourcePath, "utf8")));
    }

    const contributions = generateActivePluginContributions(sources);
    const selections = contributions.map((contribution) => {
      const source = sources.find((candidate) => candidate.plugin_id === contribution.plugin_id);
      if (!source) throw new Error(`source missing for ${contribution.plugin_id}`);
      const capabilities = source.plugin_id === "official.mvu-zod"
        ? ["mvu"] as const
        : source.plugin_id === "official.ejs"
          ? ["ejs"] as const
          : source.features.map((feature) => `html.${feature}` as const);
      return pluginSelectionSchema.parse({
        schema_version: 1,
        plugin_id: contribution.plugin_id,
        capabilities,
        source_revision: sourceRevisions.get(source.plugin_id),
        implementation: source.implementation,
        artifact_revision: contribution.artifact_revision,
      });
    });
    await writeYamlFixture(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), pluginSelectionProjectionSchema.parse({
      schema_version: 1,
      project_id: projectId,
      intent_revision: revisionFor({ project_id: projectId, selections }),
      selections,
      updated_at: "2026-07-20T00:00:00.000Z",
    }));
    await mkdir(path.join(projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
    for (const contribution of contributions) {
      const source = sources.find((candidate) => candidate.plugin_id === contribution.plugin_id);
      if (!source) throw new Error(`source missing for ${contribution.plugin_id}`);
      const artifact = pluginArtifactSchema.parse({
        id: `plugin-${contribution.plugin_id}`,
        plugin_id: contribution.plugin_id,
        revision: contribution.artifact_revision,
        source_revision: sourceRevisions.get(source.plugin_id),
        resolved_source_hash: contribution.metadata.resolved_source_hash,
        implementation: source.implementation,
        generated_at: "2026-07-20T00:00:00.000Z",
        status: "approved",
      });
      await writeFile(
        path.join(projectRoot, ".workflow", "plugin-artifacts", `${artifact.id}.json`),
        `${canonicalJson({ artifact, source, contributions: contribution })}\n`,
        "utf8",
      );
    }

    const prepared = await loadAuthorProject(workspace.projectsRoot, projectId);
    if (!prepared.workflow || !prepared.pluginArtifacts || prepared.pluginArtifacts.length !== 3 || prepared.pluginSelectionRevision === undefined) {
      throw new Error("multi-plugin preview fixture failed to load");
    }
    const authorRevision = `sha256:${"a".repeat(64)}`;
    const pluginArtifactReferences = prepared.pluginArtifacts.map((artifact) => ({
      id: `plugin-${artifact.plugin_id}`,
      revision: artifact.revision,
      contract: "plugin-artifact@1",
    }));
    const contentReferences = [
      { id: "author-content", revision: authorRevision },
      ...pluginArtifactReferences,
    ].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: prepared.workflow.revision,
      eventId: "multi-plugin-preview-ready",
      actor: "engine",
      occurredAt: "2026-07-20T00:00:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        stage: "compile_preview",
        artifacts: [
          { id: "author-content", status: "approved", revision: authorRevision, updated_at: "2026-07-20T00:00:00.000Z", extensions: {} },
          ...pluginArtifactReferences.map((reference) => ({ id: reference.id, status: "approved" as const, revision: reference.revision, updated_at: "2026-07-20T00:00:00.000Z", contract: reference.contract, extensions: {} })),
        ],
        gates: [
          { id: "facts", status: "not_required", input_revisions: [], extensions: {} },
          { id: "blueprint", status: "approved", input_revisions: [], extensions: {} },
          { id: "content", status: "approved", input_revisions: contentReferences, extensions: {} },
          { id: "publish", status: "pending", input_revisions: [], extensions: {} },
        ],
        extensions: { ...state.extensions, plugin_selection_revision: prepared.pluginSelectionRevision },
      }),
    });

    const preview = await createCompilePreview({
      workspaceRoot: workspace.root,
      projectId,
      previewId: "preview-multi-plugin",
      eventId: "preview-multi-plugin-created",
      actor: "director",
      occurredAt: "2026-07-20T00:01:00.000Z",
      build: { json: true, png: true },
    });
    expect(preview.artifact_hashes).toHaveProperty(`exports/${projectId}/${projectId}.json`);
    expect(preview.artifact_hashes).toHaveProperty(`exports/${projectId}/${projectId}.png`);
    expect(preview.artifact_hashes).not.toHaveProperty(`projects/${projectId}/.build/plugin-build-trace.json`);

    const beforePublishApproval = await loadAuthorProject(workspace.projectsRoot, projectId);
    if (!beforePublishApproval.workflow) throw new Error("multi-plugin preview did not persist workflow");
    await commitWorkflowMutation(projectRoot, {
      expectedRevision: beforePublishApproval.workflow.revision,
      eventId: "multi-plugin-publish-approved",
      actor: "user",
      occurredAt: "2026-07-20T00:02:00.000Z",
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        stage: "publish_review",
        gates: state.gates.map((gate) => gate.id === "publish"
          ? { ...gate, status: "approved" as const, input_revisions: [{ id: preview.id, revision: preview.revision }] }
          : gate),
      }),
    });

    const published = await publishApprovedPreview({
      workspaceRoot: workspace.root,
      projectId,
      previewId: preview.id,
      eventId: "multi-plugin-published",
      actor: "director",
      occurredAt: "2026-07-20T00:03:00.000Z",
    });
    expect(published.result.published).toBe(true);
    const trace = JSON.parse(await readFile(path.join(projectRoot, ".build", "plugin-build-trace.json"))) as { plugins?: unknown[] };
    expect(trace.plugins).toHaveLength(3);
    await expect(readFile(path.join(workspace.exportsRoot, projectId, `${projectId}.json`), "utf8")).resolves.toContain("chara_card_v3");
    const publishedPng = await readFile(path.join(workspace.exportsRoot, projectId, `${projectId}.png`));
    const publishedCard = readCardFromPng(publishedPng).card;
    expect(publishedCard.data.name).toBe("Preview multi plugin");
  });
});
