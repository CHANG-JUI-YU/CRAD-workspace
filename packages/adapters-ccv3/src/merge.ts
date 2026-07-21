import type { JsonObject, JsonValue } from "@card-workspace/schemas";

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMergeJson(base: JsonObject, generated: JsonObject): JsonObject {
  const result: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(generated)) {
    const existing = result[key];
    result[key] = isObject(existing) && isObject(value) ? deepMergeJson(existing, value) : structuredClone(value);
  }
  return result;
}
