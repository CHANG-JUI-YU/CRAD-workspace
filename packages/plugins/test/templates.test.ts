import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  materializePluginTemplate,
  officialMvuAssetPin,
  revisionFor,
} from "../src/index.js";
import {
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  pluginSourceSchema,
  type MvuSource,
} from "@card-workspace/schemas";

function template() {
  const source: MvuSource = pluginSourceSchema.parse({
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    template_id: "starter",
    implementation: officialMvuAssetPin({ version: "1.0.0", digest: `sha256:${"a".repeat(64)}` }),
    variables: [{ id: "mood", label: "Mood", kind: "string", default: "calm" }],
    update_rules: [],
  });
  const payload = pluginTemplatePayloadSchema.parse({
    schema_version: 1,
    template_id: "starter",
    plugin_id: "official.mvu-zod",
    parameters: { "/variables/0/default": "calm" },
    payload: source,
  });
  const manifest = pluginTemplateManifestSchema.parse({
    schema_version: 1,
    id: "starter",
    plugin_id: "official.mvu-zod",
    implementation: source.implementation,
    description: "Starter MVU source",
    parameters: [{ pointer: "/variables/0/default", type: "string" }],
    payload_revision: revisionFor(payload),
    source_revision: revisionFor(source),
    resolved_source_hash: revisionFor(source),
    provenance: { kind: "imported" },
    created_at: "2026-07-20T00:00:00.000Z",
  });
  return { manifest, payload, source };
}

describe("official plugin template materialization", () => {
  it("resolves typed parameters structurally and records deterministic hashes", () => {
    const { manifest, payload, source } = template();
    const resolved = materializePluginTemplate(manifest, payload);
    expect(resolved.source).toEqual(source);
    expect(resolved.template_payload_hash).toBe(manifest.payload_revision);
    expect(resolved.resolved_source_hash).toBe(revisionFor(source));

    const overridden = materializePluginTemplate(manifest, payload, {
      "/variables/0/default": "<% not executable %> ${data}",
    });
    expect(overridden.source).toMatchObject({ variables: [{ default: "<% not executable %> ${data}" }] });
    expect(canonicalJson(overridden.source)).not.toContain("<%= ");
    expect(overridden.resolved_source_hash).not.toBe(resolved.resolved_source_hash);
  });

  it("rejects pointers outside the official contract and implementation drift", () => {
    const { manifest, payload, source } = template();
    expect(() => materializePluginTemplate({
      ...manifest,
      parameters: [{ pointer: "/variables/0/id", type: "string" }],
    }, payload)).toThrow("allowlist");
    expect(() => materializePluginTemplate({
      ...manifest,
      implementation: { ...manifest.implementation, digest: `sha256:${"b".repeat(64)}` },
    }, payload)).toThrow("implementation");
    expect(() => materializePluginTemplate(manifest, {
      ...payload,
      parameters: { "/variables/0/default": "changed", "/variables/0/id": "mood" },
    })).toThrow("未在 manifest 宣告");
    expect(source.template_id).toBe("starter");
  });
});
