import { createHash } from "node:crypto";

import type { JsonValue, PluginSource, Revision } from "@card-workspace/schemas";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON 只接受 finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON 不接受 undefined 或 function");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function revisionFor(value: unknown): Revision {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function escapeGeneratedSource(value: string): string {
  return value
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("$", "\\u0024")
    .replaceAll("`", "\\u0060")
    .replaceAll("%", "\\u0025")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function safeJsString(value: string): string {
  return escapeGeneratedSource(JSON.stringify(value));
}

export function safeJsValue(value: JsonValue): string {
  return escapeGeneratedSource(canonicalJson(value));
}

export function safeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function artifactRevisionForSource(source: PluginSource): Revision {
  return revisionFor({
    canonical_source: source,
    implementation: source.implementation,
  });
}
