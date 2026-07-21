import { createHash } from "node:crypto";

import type { JsonValue, Revision } from "@card-workspace/schemas";
import { stringify as stringifyYaml } from "yaml";

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON 不接受非有限數字");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  throw new TypeError(`Canonical JSON 不接受 ${typeof value}`);
}

function normalizeInSourceOrder(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Ordered YAML 不接受非有限數字");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeInSourceOrder);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizeInSourceOrder(item)]),
    );
  }
  throw new TypeError(`Ordered YAML 不接受 ${typeof value}`);
}

export function canonicalize(value: unknown): JsonValue {
  return normalize(value);
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function canonicalYaml(value: unknown): string {
  return stringifyYaml(canonicalize(value), {
    lineWidth: 0,
    sortMapEntries: true,
  });
}

// Author module schemas define a semantic reading order that must remain visible in YAML.
export function orderedYaml(value: unknown): string {
  return stringifyYaml(normalizeInSourceOrder(value), {
    lineWidth: 0,
    sortMapEntries: false,
  });
}

export function computeRevision(value: unknown): Revision {
  const digest = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${digest}`;
}

export function computeTextRevision(value: string | Buffer): Revision {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}
