import {
  pluginSourceSchema,
  pluginTemplateManifestSchema,
  pluginTemplatePayloadSchema,
  type JsonValue,
  type PluginSource,
  type PluginTemplateManifest,
  type PluginTemplatePayload,
  type Revision,
} from "@card-workspace/schemas";

import { canonicalJson, revisionFor } from "./canonical.js";

export type TemplateScalar = string | number | boolean | null;
export type TemplateParameterValue = TemplateScalar | TemplateScalar[];

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const forbiddenTemplateFieldNames = new Set([
  "schema_version",
  "plugin_id",
  "project_kind",
  "implementation",
  "template_id",
  "id",
  "name",
  "path",
  "operator",
  "kind",
  "code",
  "markup",
  "css",
  "url",
]);
const parameterizableLeafNames = new Set([
  "default",
  "description",
  "label",
  "max",
  "max_items",
  "max_length",
  "min",
  "min_items",
  "min_length",
  "value",
  "values",
]);

function decodePointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerTokens(pointer: string): string[] {
  if (!pointer.startsWith("/") || pointer.includes("#")) {
    throw new TypeError(`不是 RFC6901 JSON Pointer: ${pointer}`);
  }
  const tokens = pointer.slice(1).split("/").map(decodePointerToken);
  if (tokens.some((token) => token.length === 0 || forbiddenKeys.has(token))) {
    throw new TypeError(`template pointer 含有禁止的 object key: ${pointer}`);
  }
  return tokens;
}

function isScalar(value: JsonValue): value is TemplateScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTemplateParameterValue(value: JsonValue): value is TemplateParameterValue {
  return isScalar(value) || (Array.isArray(value) && value.every(isScalar));
}

function escapePointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectOfficialTemplatePointers(value: JsonValue, pointer = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectOfficialTemplatePointers(item, `${pointer}/${index}`));
  }
  if (value === null || typeof value !== "object") return [];

  const pointers: string[] = [];
  for (const key of Object.keys(value).sort()) {
    if (forbiddenKeys.has(key) || forbiddenTemplateFieldNames.has(key)) continue;
    const child = value[key];
    if (child === undefined) continue;
    const childPointer = `${pointer}/${escapePointerToken(key)}`;
    if (parameterizableLeafNames.has(key) && isScalar(child)) pointers.push(childPointer);
    else if (parameterizableLeafNames.has(key) && Array.isArray(child) && child.every(isScalar)) pointers.push(childPointer);
    else pointers.push(...collectOfficialTemplatePointers(child, childPointer));
  }
  return pointers;
}

export function officialTemplateParameterPointers(source: PluginSource): string[] {
  return collectOfficialTemplatePointers(pluginSourceSchema.parse(source) as unknown as JsonValue).sort();
}

export function applyTypedTemplateParameters<T extends Record<string, JsonValue>>(
  source: T,
  parameters: Readonly<Record<string, TemplateParameterValue>>,
  allowedPointers: readonly string[],
): T {
  const allowed = new Set(allowedPointers);
  if (allowed.size !== allowedPointers.length) throw new TypeError("template allowed pointers 不可重複");
  const sorted = [...allowed].sort();
  sorted.forEach((pointer, index) => {
    pointerTokens(pointer);
    const next = sorted[index + 1];
    if (next && next.startsWith(`${pointer}/`)) throw new TypeError("template pointers 不可有祖先重疊");
  });

  const result = structuredClone(source);
  for (const [pointer, value] of Object.entries(parameters)) {
    if (!allowed.has(pointer)) throw new TypeError(`template parameter pointer 未經 plugin contract allowlist: ${pointer}`);
    if (!isTemplateParameterValue(value as JsonValue)) throw new TypeError(`template parameter 必須是 scalar 或 scalar-array: ${pointer}`);
    const tokens = pointerTokens(pointer);
    let target: JsonValue = result;
    for (const token of tokens.slice(0, -1)) {
      if (Array.isArray(target)) {
        if (!/^\d+$/u.test(token)) throw new TypeError(`template parameter array index 無效: ${pointer}`);
        const index = Number(token);
        if (!Number.isSafeInteger(index) || index >= target.length) throw new TypeError(`template parameter array index 不存在: ${pointer}`);
        target = target[index]!;
        continue;
      }
      if (target === null || typeof target !== "object") throw new TypeError(`template parameter parent 不是 object: ${pointer}`);
      const child = target[token];
      if (child === null || typeof child !== "object") throw new TypeError(`template parameter parent 不是 object: ${pointer}`);
      target = child;
    }
    const leaf = tokens.at(-1);
    if (!leaf) throw new TypeError(`template parameter pointer 不可指向 root: ${pointer}`);
    if (Array.isArray(target)) {
      if (!/^\d+$/u.test(leaf)) throw new TypeError(`template parameter array index 無效: ${pointer}`);
      const index = Number(leaf);
      if (!Number.isSafeInteger(index) || index >= target.length) throw new TypeError(`template parameter array index 不存在: ${pointer}`);
      target[index] = structuredClone(value) as JsonValue;
    } else {
      if (target === null || typeof target !== "object") throw new TypeError(`template parameter target 不是 object: ${pointer}`);
      target[leaf] = structuredClone(value) as JsonValue;
    }
  }
  return result;
}

function parameterValueMatches(type: PluginTemplateManifest["parameters"][number]["type"], value: TemplateParameterValue): boolean {
  if (type === "scalar_array") return Array.isArray(value) && value.every(isScalar);
  if (type === "null") return value === null;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

function templateParameterValues(
  manifest: PluginTemplateManifest,
  payload: PluginTemplatePayload,
  overrides: Readonly<Record<string, TemplateParameterValue>>,
): Record<string, TemplateParameterValue> {
  const definitions = new Map(manifest.parameters.map((parameter) => [parameter.pointer, parameter]));
  for (const pointer of Object.keys(payload.parameters)) {
    if (!definitions.has(pointer)) throw new TypeError(`template payload parameter 未在 manifest 宣告: ${pointer}`);
  }
  for (const pointer of Object.keys(overrides)) {
    if (!definitions.has(pointer)) throw new TypeError(`template override parameter 未在 manifest 宣告: ${pointer}`);
  }

  const values: Record<string, TemplateParameterValue> = {};
  for (const parameter of manifest.parameters) {
    const value = overrides[parameter.pointer] ?? payload.parameters[parameter.pointer] ?? parameter.default;
    if (value === undefined) {
      if (parameter.required) throw new TypeError(`缺少 required template parameter: ${parameter.pointer}`);
      continue;
    }
    if (!parameterValueMatches(parameter.type, value)) throw new TypeError(`template parameter 型別不符: ${parameter.pointer}`);
    values[parameter.pointer] = value;
  }
  return values;
}

export interface MaterializedPluginTemplate {
  source: PluginSource;
  template_payload_hash: Revision;
  resolved_source_hash: Revision;
  parameters: Record<string, TemplateParameterValue>;
}

export function materializePluginTemplate(
  manifestInput: unknown,
  payloadInput: unknown,
  overrides: Readonly<Record<string, TemplateParameterValue>> = {},
): MaterializedPluginTemplate {
  const manifest = pluginTemplateManifestSchema.parse(manifestInput);
  const payload = pluginTemplatePayloadSchema.parse(payloadInput);
  if (manifest.id !== payload.template_id || manifest.plugin_id !== payload.plugin_id) {
    throw new TypeError("template manifest/payload identity 不一致");
  }
  const templateSource = pluginSourceSchema.parse(payload.payload);
  if (templateSource.plugin_id !== manifest.plugin_id || canonicalJson(templateSource.implementation) !== canonicalJson(manifest.implementation)) {
    throw new TypeError("template source plugin 或 implementation pin 不一致");
  }
  if (templateSource.template_id !== undefined && templateSource.template_id !== manifest.id) {
    throw new TypeError("template source template_id 不一致");
  }
  if (manifest.source_revision !== revisionFor(templateSource)) {
    throw new TypeError("template source_revision 不符合 source payload");
  }

  const allowedPointers = officialTemplateParameterPointers(templateSource);
  for (const parameter of manifest.parameters) {
    if (!allowedPointers.includes(parameter.pointer)) throw new TypeError(`template pointer 不在 official plugin allowlist: ${parameter.pointer}`);
  }
  const values = templateParameterValues(manifest, payload, overrides);
  const applied = applyTypedTemplateParameters(
    templateSource as unknown as Record<string, JsonValue>,
    values,
    allowedPointers,
  );
  const source = pluginSourceSchema.parse(applied);
  const resolvedSourceHash = revisionFor(source);
  if (Object.keys(overrides).length === 0 && manifest.resolved_source_hash !== resolvedSourceHash) {
    throw new TypeError("template resolved_source_hash 不符合套用結果");
  }
  return {
    source,
    template_payload_hash: manifest.payload_revision,
    resolved_source_hash: resolvedSourceHash,
    parameters: values,
  };
}
