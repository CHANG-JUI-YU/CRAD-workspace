import { makeTemporaryWorkspace } from "@card-workspace/testing";
import {
  canonicalJson,
  computeRevision,
  computeTextRevision,
  pluginTemplateRelativePaths,
  readPluginTemplate,
  savePluginTemplateIdempotent,
  validatePluginTemplatePair,
} from "../src/index.js";
import {
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
});
