import { describe, expect, it } from "vitest";

import {
  applyTypedTemplateParameters,
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

  it("covers typed pointer guards and parameter contract branches", () => {
    const source = { nested: { value: "old" }, list: [{ value: "x" }], scalar: "s" };
    expect(() => applyTypedTemplateParameters(source, {}, ["nested"])).toThrow("RFC6901");
    expect(() => applyTypedTemplateParameters(source, {}, ["/__proto__"])).toThrow("object key");
    expect(() => applyTypedTemplateParameters(source, {}, ["/nested", "/nested/value"])).toThrow("pointers");
    expect(() => applyTypedTemplateParameters(source, { "/unknown": "x" }, ["/known"])).toThrow("allowlist");
    expect(() => applyTypedTemplateParameters(source, { "/scalar": { bad: true } as never }, ["/scalar"])).toThrow("scalar");
    expect(() => applyTypedTemplateParameters(source, { "/scalar": ["ok", { bad: true } as never] as never }, ["/scalar"])).toThrow("scalar");
    expect(() => applyTypedTemplateParameters(source, { "/list/foo/value": "x" }, ["/list/foo/value"])).toThrow("array index");
    expect(() => applyTypedTemplateParameters(source, { "/list/9/value": "x" }, ["/list/9/value"])).toThrow("array index");
    expect(() => applyTypedTemplateParameters(source, { "/scalar/value/leaf": "x" }, ["/scalar/value/leaf"])).toThrow("parent");
    expect(() => applyTypedTemplateParameters({ list: [null] }, { "/list/0/value": "x" }, ["/list/0/value"])).toThrow("target");
    expect(() => applyTypedTemplateParameters(source, { "/list/foo": "x" }, ["/list/foo"])).toThrow("array index");
    expect(() => applyTypedTemplateParameters(source, { "/list/9": "x" }, ["/list/9"])).toThrow("array index");
    expect(() => applyTypedTemplateParameters(source, { "/list/99999999999999999999": "x" }, ["/list/99999999999999999999"])).toThrow("array index");
    expect(() => applyTypedTemplateParameters(source, {}, ["/scalar", "/scalar"])).toThrow("allowed pointers");
    expect(applyTypedTemplateParameters(source, { "/list/0/value": "new" }, ["/list/0/value"]).list[0]?.value).toBe("new");
  });

  it("rejects materialization identity, revision, and typed-parameter edge cases", () => {
    const { manifest, payload, source } = template();
    expect(() => materializePluginTemplate({ ...manifest, id: "other" }, payload)).toThrow("identity");
    expect(() => materializePluginTemplate(manifest, { ...payload, payload: { ...source, template_id: "other" } })).toThrow("template_id");
    expect(() => materializePluginTemplate({ ...manifest, source_revision: revisionFor({ ...source, variables: [{ ...source.variables[0]!, default: "changed" }] }) }, payload)).toThrow("source_revision");
    expect(() => materializePluginTemplate({ ...manifest, resolved_source_hash: revisionFor({ ...source, variables: [{ ...source.variables[0]!, default: "changed" }] }) }, payload)).toThrow("resolved_source_hash");
    expect(() => materializePluginTemplate(manifest, payload, { "/unknown": "x" })).toThrow("override");

    expect(() => materializePluginTemplate({ ...manifest, parameters: [{ ...manifest.parameters[0]!, type: "scalar_array" }] }, payload, { "/variables/0/default": ["a", "b"] })).toThrow();
    expect(() => materializePluginTemplate({ ...manifest, parameters: [{ ...manifest.parameters[0]!, type: "number" }] }, payload, { "/variables/0/default": Number.NaN })).toThrow("parameter");
    expect(() => materializePluginTemplate({ ...manifest, parameters: [{ ...manifest.parameters[0]!, type: "null" }] }, payload, { "/variables/0/default": null })).toThrow();
    for (const [type, value] of [["scalar_array", "bad"], ["null", "bad"], ["number", "bad"], ["boolean", "bad"], ["string", 42]] as const) {
      expect(() => materializePluginTemplate({ ...manifest, parameters: [{ ...manifest.parameters[0]!, type }] }, payload, { "/variables/0/default": value as never })).toThrow("parameter");
    }
    const required = { ...manifest, parameters: [{ ...manifest.parameters[0]!, required: true }] };
    expect(() => materializePluginTemplate(required, { ...payload, parameters: {} })).toThrow("required");
    const optional = materializePluginTemplate({ ...manifest, parameters: [{ ...manifest.parameters[0]!, required: false }] }, { ...payload, parameters: {} });
    expect(optional.parameters).toEqual({});
  });
});
