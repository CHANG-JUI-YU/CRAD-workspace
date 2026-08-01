import { describe, expect, it } from "vitest";

import {
  pluginArtifactSchema,
  pluginBuildTraceSchema,
  pluginProposalEnvelopeSchema,
  pluginRuntimeAssetSchema,
  pluginSelectionProjectionSchema,
  pluginTemplateParameterSchema,
  pluginTemplateProvenanceSchema,
  pluginUserAuthorizationEnvelopeSchema,
  type PluginImplementationPin,
} from "../src/index.js";

const rev = (letter: string) => `sha256:${letter.repeat(64)}`;
const implementation: PluginImplementationPin = {
  version: "1.0.0",
  digest: rev("a"),
  asset_manifest_id: "assets",
  asset_manifest_revision: rev("b"),
  asset_manifest_hash: rev("c"),
};

describe("plugin contract edge matrix", () => {
  it("validates typed template parameter defaults and provenance", () => {
    expect(pluginTemplateParameterSchema.parse({ pointer: "/value", type: "string" }).required).toBe(false);
    for (const parameter of [
      { pointer: "/value", type: "string", default: "ok" },
      { pointer: "/value", type: "number", default: 1 },
      { pointer: "/value", type: "boolean", default: true },
      { pointer: "/value", type: "null" },
      { pointer: "/value", type: "scalar_array", default: ["ok", 1, true, null] },
    ]) expect(pluginTemplateParameterSchema.safeParse(parameter).success).toBe(true);
    for (const parameter of [
      { pointer: "/value", type: "string", required: true, default: "bad" },
      { pointer: "/value", type: "scalar_array", default: "bad" },
      { pointer: "/value", type: "string", default: ["bad"] },
      { pointer: "/value", type: "number", default: "bad" },
      { pointer: "/value", type: "boolean", default: 1 },
      { pointer: "/value", type: "null", default: 1 },
    ]) expect(pluginTemplateParameterSchema.safeParse(parameter).success).toBe(false);
    expect(pluginTemplateProvenanceSchema.safeParse({ kind: "imported" }).success).toBe(true);
    expect(pluginTemplateProvenanceSchema.safeParse({ kind: "approved_source", artifact_id: "artifact-1" }).success).toBe(true);
    expect(pluginTemplateProvenanceSchema.safeParse({ kind: "approved_source" }).success).toBe(false);
    expect(pluginTemplateProvenanceSchema.safeParse({ kind: "imported", artifact_id: "artifact-1" }).success).toBe(false);
  });

  it("enforces proposal capability, identity and CAS contracts", () => {
    const source = {
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      project_kind: "character_card",
      implementation,
      variables: [{ name: "mood", type: "string", default: "calm" }],
    } as const;
    const value = {
      kind: "plugin",
      project_kind: "character_card",
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source,
      expected_source_revision: "absent",
      expected_manifest_revision: rev("d"),
      resolved_source_hash: rev("e"),
    } as const;
    const envelope = {
      schema_version: 1,
      id: "proposal-1",
      task_id: "task-1",
      project_id: "demo",
      owner: "mvu-creator",
      proposal_revision: rev("f"),
      base_workflow_revision: 1,
      value,
      pending_result_revision: rev("0"),
      submitted_at: "2026-07-20T00:00:00.000Z",
    };
    expect(pluginProposalEnvelopeSchema.safeParse(envelope).success).toBe(true);
    for (const invalid of [
      { ...envelope, value: { ...value, plugin_id: "official.ejs" } },
      { ...envelope, value: { ...value, source: { ...source, template_id: "template" } } },
      { ...envelope, value: { ...value, expected_manifest_revision: "absent" } },
      { ...envelope, value: { ...value, capabilities: ["ejs"] } },
      { ...envelope, value: { ...value, capabilities: ["mvu", "ejs"] } },
    ]) expect(pluginProposalEnvelopeSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates selection projections, artifact identity, build traces and runtime assets", () => {
    const selection = {
      schema_version: 1,
      plugin_id: "official.mvu-zod",
      capabilities: ["mvu"],
      source_revision: rev("a"),
      implementation,
      artifact_revision: rev("b"),
    } as const;
    const projection = { schema_version: 1, project_id: "demo", intent_revision: rev("c"), selections: [selection], updated_at: "2026-07-20T00:00:00.000Z" };
    expect(pluginSelectionProjectionSchema.safeParse(projection).success).toBe(true);
    expect(pluginSelectionProjectionSchema.safeParse({ ...projection, selections: [selection, selection] }).success).toBe(false);
    const artifact = { id: "plugin-official.mvu-zod", plugin_id: "official.mvu-zod", revision: rev("d"), source_revision: rev("e"), resolved_source_hash: rev("f"), implementation, generated_at: "2026-07-20T00:00:00.000Z", status: "approved" };
    expect(pluginArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(pluginArtifactSchema.safeParse({ ...artifact, id: "plugin-official.ejs" }).success).toBe(false);
    const trace = { schema_version: 1, project_id: "demo", input_revision: rev("a"), plugins: [artifact], compatibility_profile: "st", compatibility_profile_revision: rev("b"), selection_revision: "absent", contribution_hashes: {}, diagnostics_summary: { errors: 0, warnings: 1, info: 2 }, timings_ms: { total: 1 }, generated_at: "2026-07-20T00:00:00.000Z" };
    expect(pluginBuildTraceSchema.safeParse(trace).success).toBe(true);
    expect(pluginBuildTraceSchema.safeParse({ ...trace, diagnostics_summary: { errors: -1, warnings: 0, info: 0 } }).success).toBe(false);
    expect(pluginRuntimeAssetSchema.safeParse({ id: "asset", url: "https://example.test/a.js", content_hash: rev("a"), allowed_use: "mvu_runtime", redirect_policy: "same_url_only" }).success).toBe(true);
    expect(pluginRuntimeAssetSchema.safeParse({ id: "asset", url: "not-url", content_hash: rev("a"), allowed_use: "mvu_runtime", redirect_policy: "same_url_only" }).success).toBe(false);
    const authorization = { schema_version: 1, token_hash: "a".repeat(64), project_id: "demo", proposal_id: "proposal-1", proposal_revision: rev("b"), decision: "approve", workflow_revision: 1, session_id: "s".repeat(32), nonce: "b".repeat(64), expires_at: "2099-07-20T00:00:00.000Z" };
    expect(pluginUserAuthorizationEnvelopeSchema.safeParse(authorization).success).toBe(true);
    expect(pluginUserAuthorizationEnvelopeSchema.safeParse({ ...authorization, session_id: "short" }).success).toBe(false);
  });
});
