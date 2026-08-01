/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  computeRevision,
  computeTextRevision,
  ensurePluginStorage,
  listPluginArtifacts,
  listPluginSourceDirectories,
  listPluginSources,
  listPluginTemplates,
  pluginArtifactRelativePath,
  pluginSourceOperation,
  pluginSelectionRelativePath,
  pluginTemplateRelativePaths,
  readPluginSelection,
  readPluginSource,
  readPluginTemplate,
  savePluginSource,
  savePluginTemplateIdempotent,
  validatePluginTemplatePair,
} from "../src/index.js";
import {
  pluginArtifactSchema,
  pluginSelectionProjectionSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
} from "@card-workspace/schemas";
import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

function templatePair(message: string) {
  const source = {
    schema_version: 1 as const,
    plugin_id: "official.mvu-zod" as const,
    project_kind: "character_card" as const,
    implementation: {
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      asset_manifest_id: "assets",
      asset_manifest_revision: `sha256:${"b".repeat(64)}`,
      asset_manifest_hash: `sha256:${"c".repeat(64)}`,
    },
    variables: [{ id: "mood", label: "Mood", kind: "string" as const, default: message }],
    update_rules: [],
  };
  const payload = pluginTemplatePayloadSchema.parse({
    schema_version: 1,
    template_id: "starter",
    plugin_id: "official.mvu-zod",
    parameters: {},
    payload: source,
  });
  const manifest = pluginTemplateManifestSchema.parse({
    schema_version: 1,
    id: "starter",
    plugin_id: "official.mvu-zod",
    implementation: {
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      asset_manifest_id: "assets",
      asset_manifest_revision: `sha256:${"b".repeat(64)}`,
      asset_manifest_hash: `sha256:${"c".repeat(64)}`,
    },
    description: "Starter template",
    parameters: [],
    payload_revision: computeTextRevision(canonicalJson(payload)),
    source_revision: computeRevision(source),
    resolved_source_hash: computeRevision(source),
    provenance: { kind: "imported" },
    created_at: "2026-07-20T00:00:00.000Z",
  });
  return { manifest, payload };
}

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
      return error.code;
    }
  }
  return undefined;
}

describe("plugin template storage", () => {
  it("rejects mismatched identity and payload revision", () => {
    const { manifest, payload } = templatePair("calm");
    const wrongRevision = { ...manifest, payload_revision: `sha256:${"d".repeat(64)}` };
    expect(thrownCode(() => validatePluginTemplatePair("official.mvu-zod", "starter", wrongRevision, payload)))
      .toBe("PLUGIN_TEMPLATE_PAYLOAD_REVISION_MISMATCH");
    expect(thrownCode(() => validatePluginTemplatePair("official.mvu-zod", "other", manifest, payload)))
      .toBe("PLUGIN_TEMPLATE_IDENTITY_MISMATCH");
  });

  it("supports idempotent replay and explicit CAS replacement", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    const first = templatePair("calm");
    const created = await savePluginTemplateIdempotent(
      workspace.root,
      "official.mvu-zod",
      "starter",
      first.manifest,
      first.payload,
    );
    expect(created.status).toBe("created");

    const unchanged = await savePluginTemplateIdempotent(
      workspace.root,
      "official.mvu-zod",
      "starter",
      first.manifest,
      first.payload,
    );
    expect(unchanged.status).toBe("unchanged");

    const changed = templatePair("focused");
    await expect(savePluginTemplateIdempotent(
      workspace.root,
      "official.mvu-zod",
      "starter",
      changed.manifest,
      changed.payload,
    )).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_CONFLICT" });

    const current = await readPluginTemplate(workspace.root, "official.mvu-zod", "starter");
    if (!current) throw new Error("template was not persisted");
    const paths = pluginTemplateRelativePaths("official.mvu-zod", "starter");
    const replaced = await savePluginTemplateIdempotent(
      workspace.root,
      "official.mvu-zod",
      "starter",
      changed.manifest,
      changed.payload,
      {
        manifest: current.revisions[paths.manifest]!,
        payload: current.revisions[paths.payload]!,
      },
    );
    expect(replaced.status).toBe("replaced");

    await expect(savePluginTemplateIdempotent(
      workspace.root,
      "official.mvu-zod",
      "starter",
      first.manifest,
      first.payload,
      {
        manifest: current.revisions[paths.manifest]!,
        payload: current.revisions[paths.payload]!,
      },
    )).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_REVISION_CONFLICT" });
  });
  it("covers plugin source, selection, artifact, and template directory boundaries", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await ensurePluginStorage(workspace.root);
    expect(await listPluginSourceDirectories(workspace.root)).toEqual([]);
    expect(await listPluginSources(workspace.root)).toEqual([]);
    expect(await listPluginArtifacts(workspace.root)).toEqual([]);
    expect(await readPluginSource(workspace.root, "official.mvu-zod")).toBeUndefined();
    expect(await readPluginSelection(workspace.root)).toBeUndefined();

    const pair = templatePair("calm");
    const source = pair.payload.payload;
    await savePluginSource(workspace.root, "official.mvu-zod", source);
    expect(await listPluginSources(workspace.root)).toEqual(["official.mvu-zod"]);
    expect((await readPluginSource(workspace.root, "official.mvu-zod"))?.source.plugin_id).toBe("official.mvu-zod");
    const loadedSource = await readPluginSource(workspace.root, "official.mvu-zod");
    if (!loadedSource) throw new Error("source was not persisted");
    const selection = pluginSelectionProjectionSchema.parse({
      schema_version: 1,
      project_id: "project-1",
      intent_revision: computeRevision({ intent: 1 }),
      selections: [{
        schema_version: 1,
        plugin_id: "official.mvu-zod",
        capabilities: ["mvu"],
        source_revision: loadedSource.revision,
        implementation: source.implementation,
        artifact_revision: "sha256:" + "d".repeat(64),
      }],
      updated_at: "2026-07-20T00:00:00.000Z",
    });
    await mkdir(path.join(workspace.root, ".workflow"), { recursive: true });
    await writeFile(path.join(workspace.root, pluginSelectionRelativePath), JSON.stringify(selection), "utf8");
    expect((await readPluginSelection(workspace.root))?.projection.project_id).toBe("project-1");
    expect(pluginSourceOperation("official.mvu-zod", source).expectedAbsent).toBe(true);

    await mkdir(path.join(workspace.root, "extensions", "orphan"), { recursive: true });
    await writeFile(path.join(workspace.root, "extensions", "orphan", "source.yaml"), "bad", "utf8");
    await mkdir(path.join(workspace.root, "extensions", "incomplete"), { recursive: true });
    expect(await listPluginSourceDirectories(workspace.root)).toEqual(["official.mvu-zod", "orphan"]);

    const artifact = pluginArtifactSchema.parse({
      id: "plugin-official.mvu-zod",
      plugin_id: "official.mvu-zod",
      revision: `sha256:${"a".repeat(64)}`,
      source_revision: `sha256:${"b".repeat(64)}`,
      resolved_source_hash: `sha256:${"c".repeat(64)}`,
      implementation: source.implementation,
      generated_at: "2026-07-20T00:00:00.000Z",
      status: "approved",
    });
    await mkdir(path.join(workspace.root, ".workflow", "plugin-artifacts"), { recursive: true });
    await writeFile(path.join(workspace.root, pluginArtifactRelativePath(artifact.id)), JSON.stringify(artifact), "utf8");
    await writeFile(path.join(workspace.root, ".workflow", "plugin-artifacts", "ignored.txt"), "ignored", "utf8");
    expect((await listPluginArtifacts(workspace.root))[0]?.artifact.id).toBe(artifact.id);
    expect(await listPluginTemplates(workspace.root)).toEqual([]);
    expect(await listPluginTemplates(workspace.root, "official.mvu-zod")).toEqual([]);
  });
  it("rejects malformed plugin files and exercises template save preconditions", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await ensurePluginStorage(workspace.root);
    const pair = templatePair("calm");
    expect(() => validatePluginTemplatePair("official.mvu-zod", "starter", {}, pair.payload)).toThrowError();
    expect(() => validatePluginTemplatePair("official.mvu-zod", "starter", pair.manifest, { ...pair.payload, plugin_id: "official.ejs" })).toThrowError();
    await expect(savePluginTemplateIdempotent(
      workspace.root, "official.mvu-zod", "starter", pair.manifest, pair.payload,
      { manifest: `sha256:${"0".repeat(64)}`, payload: `sha256:${"0".repeat(64)}` },
    )).rejects.toMatchObject({ code: "PLUGIN_TEMPLATE_REVISION_CONFLICT" });
    const paths = pluginTemplateRelativePaths("official.mvu-zod", "starter");
    await mkdir(path.join(workspace.root, paths.directory), { recursive: true });
    await writeFile(path.join(workspace.root, paths.manifest), "bad: true\n", "utf8");
    await writeFile(path.join(workspace.root, paths.payload), "bad: true\n", "utf8");
    await expect(readPluginTemplate(workspace.root, "official.mvu-zod", "starter")).rejects.toThrow();
    await mkdir(path.join(workspace.root, ".workflow", "plugin-artifacts"), { recursive: true });
    await writeFile(path.join(workspace.root, ".workflow", "plugin-artifacts", "plugin-official.ejs.json"), "not json", "utf8");
    await expect(listPluginArtifacts(workspace.root)).rejects.toThrow();
    await writeFile(path.join(workspace.root, ".workflow", "plugin-artifacts", "junk.json"), "{}", "utf8");
    await expect(listPluginArtifacts(workspace.root)).rejects.toThrow();
  });
  it("handles absent storage roots and non-file plugin entries", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    expect(await listPluginSourceDirectories(workspace.root)).toEqual([]);
    expect(await listPluginArtifacts(workspace.root)).toEqual([]);
    expect(await listPluginTemplates(workspace.root)).toEqual([]);
    await mkdir(path.join(workspace.root, "extensions", "official.mvu-zod"), { recursive: true });
    await mkdir(path.join(workspace.root, "extensions", "official.mvu-zod", "source.yaml"), { recursive: true });
    await expect(readPluginSource(workspace.root, "official.mvu-zod")).rejects.toMatchObject({ code: "PLUGIN_FILE_TYPE_INVALID" });
  });
  it("covers template discovery and malformed selection/source fallbacks", async () => {
    const workspace = await makeTemporaryWorkspace();
    cleanups.push(workspace.cleanup);
    await ensurePluginStorage(workspace.root);
    const pair = templatePair("calm");
    const paths = pluginTemplateRelativePaths("official.mvu-zod", "starter");
    await mkdir(path.join(workspace.root, paths.directory), { recursive: true });
    await writeFile(path.join(workspace.root, paths.manifest), "placeholder: true\n", "utf8");
    expect(await listPluginTemplates(workspace.root)).toEqual([{ plugin_id: "official.mvu-zod", template_id: "starter", version: 1 }]);
    await mkdir(path.join(workspace.root, "templates/plugins/not-a-plugin/template/1"), { recursive: true });
    await writeFile(path.join(workspace.root, "templates/plugins/not-a-plugin/template/1/manifest.yaml"), "x: 1\n", "utf8");
    await mkdir(path.join(workspace.root, "templates/plugins/official.mvu-zod/not stable/1"), { recursive: true });
    await writeFile(path.join(workspace.root, "templates/plugins/official.mvu-zod/not stable/1/manifest.yaml"), "x: 1\n", "utf8");
    expect(await listPluginTemplates(workspace.root)).toHaveLength(1);
    await mkdir(path.join(workspace.root, ".workflow"), { recursive: true });
    await writeFile(path.join(workspace.root, pluginSelectionRelativePath), "invalid: true\n", "utf8");
    await expect(readPluginSelection(workspace.root)).rejects.toThrow();
    await mkdir(path.join(workspace.root, "extensions/official.mvu-zod"), { recursive: true });
    await writeFile(path.join(workspace.root, "extensions/official.mvu-zod/source.yaml"), "invalid: true\n", "utf8");
    await expect(readPluginSource(workspace.root, "official.mvu-zod")).rejects.toThrow();
    expect(pair.payload.payload.plugin_id).toBe("official.mvu-zod");
  });
});


it("covers plugin storage directory and CAS branch edges", async () => {
  const workspace = await makeTemporaryWorkspace();
  cleanups.push(workspace.cleanup);
  await mkdir(path.join(workspace.root, "extensions"), { recursive: true });
  await writeFile(path.join(workspace.root, "extensions", "note.txt"), "ignored", "utf8");
  await mkdir(path.join(workspace.root, "extensions", "incomplete"), { recursive: true });
  await mkdir(path.join(workspace.root, "extensions", "directory-source", "source.yaml"), { recursive: true });
  expect(await listPluginSourceDirectories(workspace.root)).toEqual([]);
  await mkdir(path.join(workspace.root, ".workflow", "plugin-artifacts"), { recursive: true });
  await mkdir(path.join(workspace.root, ".workflow", "plugin-artifacts", "plugin-official.mvu-zod.json"), { recursive: true });
  await writeFile(path.join(workspace.root, ".workflow", "plugin-artifacts", "not-an-artifact.json"), "ignored", "utf8");
  await writeFile(path.join(workspace.root, ".workflow", "plugin-artifacts", "ignored.txt"), "ignored", "utf8");
  expect(await listPluginArtifacts(workspace.root)).toEqual([]);
  expect(pluginSourceOperation("official.mvu-zod", templatePair("cas").payload.payload, "sha256:" + "a".repeat(64))).toMatchObject({
    expectedRawRevision: "sha256:" + "a".repeat(64),
  });
  expect(await listPluginTemplates(workspace.root, "official.mvu-zod")).toEqual([]);
  expect(await listPluginTemplates(workspace.root, "official.ejs")).toEqual([]);
});
