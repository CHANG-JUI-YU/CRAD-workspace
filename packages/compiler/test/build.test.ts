import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  computeTextRevision,
  initializeProject,
  publishForgeArtifacts,
} from "@card-workspace/project";
import {
  pluginArtifactSchema,
  pluginSelectionSchema,
  pluginSelectionProjectionSchema,
  pluginSourceSchema,
  projectManifestSchema,
} from "@card-workspace/schemas";
import {
  compileMvuSource,
  generateActivePluginContributions,
  officialPluginImplementationPin,
  revisionFor,
} from "@card-workspace/plugins";
import { buildCharacterCardPng, makeTemporaryWorkspace, writeYamlFixture } from "@card-workspace/testing";
import { readCardFromPng } from "@card-workspace/adapters-png";
import { afterEach, describe, expect, it } from "vitest";

import { buildProject } from "../src/index.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

async function makeBuildProject(output: { json: boolean; png: boolean; v2_backfill: boolean }) {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  await writeFile(
    path.join(workspace.root, "package.json"),
    JSON.stringify({ name: "card-workspace" }),
    "utf8",
  );
  await initializeProject({
    projectsRoot: workspace.projectsRoot,
    manifest: projectManifestSchema.parse({
      schema_version: 1,
      id: "build-demo",
      title: "建置示範",
      kind: "character_card",
      card: { name: "Build Card" },
      characters: [{ id: "alice", display_name: "愛麗絲", mode: "zhuji", role: "primary" }],
      output,
    }),
  });
  return workspace;
}

async function setMissingFactRef(modulePath: string): Promise<void> {
  const raw = await readFile(modulePath, "utf8");
  await writeFile(
    modulePath,
    raw.replace("provenance: []", "provenance:\n  - kind: fact\n    ref: missing-fact"),
    "utf8",
  );
}

describe("buildProject", () => {
  it("編譯 JSON-only standalone worldbook 並產生 publish plan", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: "worldbook-build",
        title: "Worldbook Build",
        kind: "worldbook",
        card: { name: "Standalone World" },
        characters: [],
        output: { json: false, png: true, v2_backfill: true },
      }),
    });
    await writeYamlFixture(path.join(workspace.projectsRoot, "worldbook-build/world/concepts/magic.yaml"), {
      schema_version: 1,
      id: "magic",
      category: "concepts",
      title: "魔法",
      content: "魔法來自星辰。",
    });

    const result = await buildProject({ workspaceRoot: workspace.root, projectId: "worldbook-build" });
    expect(result.output.kind).toBe("worldbook");
    expect(result).not.toHaveProperty("card");
    expect(result).not.toHaveProperty("png");
    expect(result.audit.ok).toBe(true);
    expect(result.publishPlan.operations.map((item) => item.relativePath)).toContain(
      "exports/worldbook-build/worldbook-build.worldbook.json",
    );
    await expect(readFile(path.join(workspace.exportsRoot, "worldbook-build/worldbook-build.worldbook.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("純記憶體 build 不修改 build 或 exports", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    const result = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo" });
    expect(result.published).toBe(false);
    expect(result.card).toMatchObject({ spec: "chara_card_v3", data: { name: "建置示範", description: "" } });
    await expect(readFile(path.join(workspace.exportsRoot, "build-demo", "build-demo.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("正式 build 只回傳 build/export operations 與 CAS expectations", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    const result = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo" });
    expect(result.published).toBe(false);
    expect(result.publishPlan.operations.map((item) => item.relativePath)).toEqual(expect.arrayContaining([
      "projects/build-demo/.build/manifest.json",
      "projects/build-demo/.build/provenance-index.json",
      "exports/build-demo/build-demo.json",
    ]));
    expect(result.publishPlan.expectations.map((item) => item.relativePath)).toContain("projects/build-demo/project.yaml");
    await expect(readFile(path.join(workspace.exportsRoot, "build-demo", "build-demo.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("無插件建置保持 deterministic 且不產生 plugin trace", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    const first = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo" });
    const second = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo" });

    expect(first.manifest.plugin_artifacts).toBeUndefined();
    expect(first.publishPlan.operations.map((item) => item.relativePath)).not.toContain(
      "projects/build-demo/.build/plugin-build-trace.json",
    );
    expect(first.inputRevision).toBe(second.inputRevision);
    expect(first.card).toEqual(second.card);
  });

  it("approved MVU plugin 產生 deterministic JSON/PNG full-stack build 並可發布", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "approved-plugin-build";
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: "Approved Plugin Build",
        kind: "character_card",
        card: { name: "Approved Plugin Build" },
        characters: [{ id: "alice", display_name: "Alice", mode: "zhuji", role: "primary" }],
        plugins: ["official.mvu-zod"],
        output: { json: true, png: true, v2_backfill: false },
      }),
    });
    await mkdir(path.join(projectRoot, "assets"), { recursive: true });
    await writeFile(path.join(projectRoot, "assets", "avatar.png"), buildCharacterCardPng());

    const source = pluginSourceSchema.parse({
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      implementation: officialPluginImplementationPin("official.mvu-zod"),
      variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm", writable: true, update_rules: ["Update mood"] }],
      update_rules: [],
    });
    const sourcePath = path.join(projectRoot, "extensions", "official.mvu-zod", "source.yaml");
    await writeYamlFixture(sourcePath, source);
    const sourceRevision = computeTextRevision(await readFile(sourcePath, "utf8"));
    const generated = compileMvuSource(source);
    const selection = pluginSelectionProjectionSchema.parse({
      schema_version: 1,
      project_id: projectId,
      intent_revision: revisionFor({ project_id: projectId, plugin_id: "official.mvu-zod" }),
      selections: [{
        schema_version: 1,
        plugin_id: "official.mvu-zod",
        capabilities: ["mvu"],
        source_revision: sourceRevision,
        implementation: source.implementation,
        artifact_revision: generated.artifact_revision,
      }],
      updated_at: "2026-07-20T00:00:00.000Z",
    });
    await writeYamlFixture(path.join(projectRoot, ".workflow", "plugin-selection.yaml"), selection);
    const artifact = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: generated.artifact_revision,
      source_revision: sourceRevision,
      resolved_source_hash: generated.contributions.metadata.resolved_source_hash,
      implementation: source.implementation,
      generated_at: "2026-07-20T00:00:00.000Z",
      status: "approved",
    });
    await mkdir(path.join(projectRoot, ".workflow", "plugin-artifacts"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"),
      `${canonicalJson({ artifact, source, contributions: generated.contributions })}\n`,
      "utf8",
    );

    const first = await buildProject({ workspaceRoot: workspace.root, projectId, json: true, png: true });
    const second = await buildProject({ workspaceRoot: workspace.root, projectId, json: true, png: true });
    expect(first.inputRevision).toBe(second.inputRevision);
    expect(first.card).toEqual(second.card);
    expect(Buffer.compare(first.png!, second.png!)).toBe(0);
    expect(first.manifest.plugin_artifacts).toHaveLength(1);
    expect(readCardFromPng(first.png!).card).toEqual(first.card);

    const buildFiles = first.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith(`projects/${projectId}/.build/`))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    const exportFiles = first.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith(`exports/${projectId}/`))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId,
      buildFiles,
      exportFiles,
      sourceRevisions: Object.fromEntries(first.publishPlan.expectations.map((expectation) => [
        expectation.relativePath,
        expectation.expectedRawRevision,
      ])),
    });
    const publishedJson = JSON.parse(await readFile(path.join(workspace.exportsRoot, projectId, `${projectId}.json`), "utf8")) as unknown;
    expect(publishedJson).toEqual(first.card);
    const publishedPng = await readFile(path.join(workspace.exportsRoot, projectId, `${projectId}.png`));
    expect(readCardFromPng(publishedPng).card).toEqual(first.card);
  });

  it("三個官方 plugin 的 persisted selection 可 deterministic 編譯 JSON/PNG 並產生完整 trace", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const projectId = "multi-plugin-build";
    const projectRoot = await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: projectId,
        title: "Multi Plugin Build",
        kind: "character_card",
        card: { name: "Multi Plugin Build" },
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
      const source = sources.find((item) => item.plugin_id === contribution.plugin_id);
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
      const source = sources.find((item) => item.plugin_id === contribution.plugin_id);
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

    const first = await buildProject({ workspaceRoot: workspace.root, projectId, json: true, png: true });
    const second = await buildProject({ workspaceRoot: workspace.root, projectId, json: true, png: true });
    expect(first.manifest.plugin_artifacts).toHaveLength(3);
    expect(first.inputRevision).toBe(second.inputRevision);
    expect(first.card).toEqual(second.card);
    expect(Buffer.compare(first.png!, second.png!)).toBe(0);
    expect(readCardFromPng(first.png!).card).toEqual(first.card);
    const trace = first.publishPlan.operations.find((operation) => operation.relativePath.endsWith("plugin-build-trace.json"));
    if (!trace) throw new Error("plugin build trace missing");
    const traceValue = JSON.parse(trace.content) as { plugins?: unknown[] };
    expect(traceValue.plugins).toHaveLength(3);
  });

  it("character card JSON 與 PNG 使用同一 full-stack build 輸出並可原子發布", async () => {
    const workspace = await makeBuildProject({ json: true, png: true, v2_backfill: true });
    await mkdir(path.join(workspace.projectsRoot, "build-demo", "assets"), { recursive: true });
    await writeFile(
      path.join(workspace.projectsRoot, "build-demo", "assets", "avatar.png"),
      buildCharacterCardPng(),
    );
    const first = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", json: true, png: true, v2Backfill: true });
    const second = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", json: true, png: true, v2Backfill: true });

    expect(first.card).toEqual(second.card);
    expect(first.png).toBeDefined();
    expect(second.png).toBeDefined();
    expect(Buffer.compare(first.png!, second.png!)).toBe(0);
    expect(readCardFromPng(first.png!).card).toEqual(first.card);
    expect(first.manifest.artifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining([
      "exports/build-demo/build-demo.json",
      "exports/build-demo/build-demo.png",
    ]));

    const buildFiles = first.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith("projects/build-demo/.build/"))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    const exportFiles = first.publishPlan.operations
      .filter((operation) => operation.relativePath.startsWith("exports/build-demo/") && !operation.relativePath.includes("/old/"))
      .map((operation) => ({ fileName: path.basename(operation.relativePath), content: operation.content }));
    await publishForgeArtifacts({
      workspaceRoot: workspace.root,
      projectId: "build-demo",
      buildFiles,
      exportFiles,
      sourceRevisions: Object.fromEntries(first.publishPlan.expectations.map((expectation) => [
        expectation.relativePath,
        expectation.expectedRawRevision,
      ])),
    });
    const publishedJson = JSON.parse(await readFile(path.join(workspace.exportsRoot, "build-demo", "build-demo.json"), "utf8")) as unknown;
    expect(publishedJson).toEqual(first.card);
    const publishedPng = await readFile(path.join(workspace.exportsRoot, "build-demo", "build-demo.png"));
    expect(readCardFromPng(publishedPng).card).toEqual(first.card);
  });

  it("worldbook 啟用官方 plugin 時在 build 前 fail closed", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await initializeProject({
      projectsRoot: workspace.projectsRoot,
      manifest: projectManifestSchema.parse({
        schema_version: 1,
        id: "worldbook-plugin-build",
        title: "Worldbook Plugin Build",
        kind: "worldbook",
        card: { name: "Worldbook Plugin Build" },
        characters: [],
        plugins: ["official.mvu-zod"],
      }),
      world: { enabled: true, categories: ["geography"], scope: "群島世界" },
    });

    await expect(buildProject({
      workspaceRoot: workspace.root,
      projectId: "worldbook-plugin-build",
    })).rejects.toMatchObject({ code: "BUILD_AUTHOR_INVALID" });
  });

  it("拒絕 direct compiler publish，要求由 workflow 執行", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    await expect(buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", publish: true }))
      .rejects.toMatchObject({ code: "PUBLISH_WORKFLOW_REQUIRED" });
  });

  it("strict audit 或 PNG 失敗時不改正式 exports", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    const appearancePath = path.join(
      workspace.projectsRoot,
      "build-demo",
      "characters",
      "alice",
      "zhuji",
      "01-appearance.yaml",
    );
    const appearance = await readFile(appearancePath, "utf8");
    await writeFile(
      appearancePath,
      appearance.replace("activation:\n    type: default", "activation:\n    type: constant"),
      "utf8",
    );
    const exportPath = path.join(workspace.exportsRoot, "build-demo", "build-demo.json");
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(exportPath, "old", "utf8");
    await expect(
      buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", tokenBudget: 1 }),
    ).rejects.toMatchObject({
      code: "BUILD_AUDIT_BLOCKED",
      diagnostics: [
        expect.objectContaining({
          code: "workspace.token.constant-budget",
          details: { layer: "workspace", overridable: true },
        }),
      ],
    });
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old");

    await expect(
      buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", png: true }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old");
  });

  it("strict provenance gate 在 emit/publish 前阻斷且 exports 不變", async () => {
    const workspace = await makeBuildProject({ json: true, png: false, v2_backfill: false });
    const projectRoot = path.join(workspace.projectsRoot, "build-demo");
    const modulePath = path.join(projectRoot, "characters", "alice", "zhuji", "01-appearance.yaml");
    await setMissingFactRef(modulePath);
    const exportPath = path.join(workspace.exportsRoot, "build-demo", "build-demo.json");
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(exportPath, "old", "utf8");

    await expect(buildProject({
      workspaceRoot: workspace.root,
      projectId: "build-demo",
      strict: true,
    })).rejects.toMatchObject({
      code: "BUILD_PROVENANCE_BLOCKED",
      diagnostics: [expect.objectContaining({ code: "workspace.provenance.invalid-fact-ref" })],
    });
    await expect(readFile(exportPath, "utf8")).resolves.toBe("old");
  });

  it("非 strict 將 provenance finding 合併至單一 workspace audit", async () => {
    const workspace = await makeBuildProject({ json: false, png: false, v2_backfill: false });
    const modulePath = path.join(
      workspace.projectsRoot, "build-demo", "characters", "alice", "zhuji", "01-appearance.yaml",
    );
    await setMissingFactRef(modulePath);
    const result = await buildProject({ workspaceRoot: workspace.root, projectId: "build-demo", strict: false });
    expect(result.audit.blocked).toBe(false);
    expect(result.audit.findings).toContainEqual(expect.objectContaining({
      rule_id: "workspace.provenance.invalid-fact-ref",
      layer: "workspace",
    }));
  });
});
