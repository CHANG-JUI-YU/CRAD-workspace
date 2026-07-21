import {
  mvuSourceSchema,
  type JsonValue,
  type MvuSource,
} from "@card-workspace/schemas";

import { buildMvuPathRegistry, flattenMvuNodes, normalizeMvuSource, type NormalizedMvuNode } from "./paths.js";

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

function assertSafeObject(value: Record<string, JsonValue>, path: string): void {
  for (const key of Object.keys(value)) {
    if (dangerousKeys.has(key)) throw new Error(`MVU default 含有禁止 key: ${path}/${key}`);
  }
}

function assertDefault(node: NormalizedMvuNode, value: JsonValue, path: string): void {
  switch (node.kind) {
    case "string":
      if (typeof value !== "string") throw new Error(`MVU default 型別錯誤: ${path}`);
      if (node.min_length !== undefined && value.length < node.min_length) throw new Error(`MVU string default 太短: ${path}`);
      if (node.max_length !== undefined && value.length > node.max_length) throw new Error(`MVU string default 太長: ${path}`);
      return;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`MVU numeric default 型別錯誤: ${path}`);
      if (node.kind === "integer" && !Number.isInteger(value)) throw new Error(`MVU integer default 必須是整數: ${path}`);
      if (node.min !== undefined && value < node.min) throw new Error(`MVU default 小於 min: ${path}`);
      if (node.max !== undefined && value > node.max) throw new Error(`MVU default 大於 max: ${path}`);
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`MVU boolean default 型別錯誤: ${path}`);
      return;
    case "enum":
      if (typeof value !== "string" || !node.values?.includes(value)) throw new Error(`MVU enum default 不合法: ${path}`);
      return;
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`MVU object default 型別錯誤: ${path}`);
      const objectValue = value as Record<string, JsonValue>;
      assertSafeObject(objectValue, path);
      const fields = node.fields ?? [];
      const fieldIds = new Set(fields.map((field) => field.id));
      for (const key of Object.keys(objectValue)) {
        if (!fieldIds.has(key)) throw new Error(`MVU object default 含有未知 field: ${path}/${key}`);
      }
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, field.id)) {
          throw new Error(`MVU object default 缺少 field: ${path}/${field.id}`);
        }
        assertDefault(field, objectValue[field.id]!, `${path}/${field.id}`);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) throw new Error(`MVU array default 型別錯誤: ${path}`);
      if (node.min_items !== undefined && value.length < node.min_items) throw new Error(`MVU array default 太短: ${path}`);
      if (node.max_items !== undefined && value.length > node.max_items) throw new Error(`MVU array default 太長: ${path}`);
      if (node.items) value.forEach((item, index) => assertDefault(node.items!, item, `${path}/${index}`));
      return;
    }
  }
}

function assertNodeConstraints(nodes: readonly NormalizedMvuNode[]): void {
  for (const node of nodes) {
    if (node.min !== undefined && node.max !== undefined && node.min > node.max) {
      throw new Error(`MVU constraint min 不可大於 max: ${node.id}`);
    }
    if (node.min_length !== undefined && node.max_length !== undefined && node.min_length > node.max_length) {
      throw new Error(`MVU string constraint min_length 不可大於 max_length: ${node.id}`);
    }
    if (node.min_items !== undefined && node.max_items !== undefined && node.min_items > node.max_items) {
      throw new Error(`MVU array constraint min_items 不可大於 max_items: ${node.id}`);
    }
    if (node.fields) assertNodeConstraints(node.fields);
    if (node.items) assertNodeConstraints([node.items]);
  }
}

function assertUpdateRuleCompatibility(
  rule: MvuSource["update_rules"][number],
  node: NormalizedMvuNode,
): void {
  if (rule.type !== undefined) {
    const acceptedTypes = node.kind === "enum" ? ["enum", "string"] : [node.kind];
    if (!acceptedTypes.includes(rule.type)) {
      throw new Error(`MVU update rule type 與 variable 不一致: ${rule.path}`);
    }
  }
  const hasRange = rule.range_min !== undefined || rule.range_max !== undefined;
  if (hasRange && node.kind !== "number" && node.kind !== "integer") {
    throw new Error(`MVU 非 numeric variable 不可使用 range: ${rule.path}`);
  }
  if (node.kind === "integer" && ((rule.range_min !== undefined && !Number.isInteger(rule.range_min))
    || (rule.range_max !== undefined && !Number.isInteger(rule.range_max)))) {
    throw new Error(`MVU integer update rule range 必須是整數: ${rule.path}`);
  }
  if (rule.range_min !== undefined && node.min !== undefined && rule.range_min < node.min) {
    throw new Error(`MVU update rule range 小於 schema min: ${rule.path}`);
  }
  if (rule.range_max !== undefined && node.max !== undefined && rule.range_max > node.max) {
    throw new Error(`MVU update rule range 大於 schema max: ${rule.path}`);
  }
}

export function validateMvuSource(source: MvuSource): MvuSource {
  const parsed = mvuSourceSchema.parse(source);
  const { roots } = normalizeMvuSource(parsed);
  assertNodeConstraints(roots);
  for (const root of roots) assertDefault(root, root.default, `/${root.id}`);

  const registry = buildMvuPathRegistry(roots);
  const explicitRulePaths = new Set(parsed.update_rules.map((rule) => rule.path));
  for (const rule of parsed.update_rules) {
    const binding = registry.paths[rule.path];
    if (!binding) throw new Error(`MVU update rule path 不存在: ${rule.path}`);
    const node = flattenMvuNodes(roots).find((candidate) => candidate.id === binding.id);
    if (!node) throw new Error(`MVU update rule node 不存在: ${rule.path}`);
    assertUpdateRuleCompatibility(rule, node);
  }
  for (const node of flattenMvuNodes(roots)) {
    const nodePath = registry.by_id[node.id];
    if (!nodePath) {
      if (node.path.includes("*")) {
        if (node.writable || node.update_rules.length > 0) {
          throw new Error(`MVU array item schema 不可直接 writable 或宣告 update rule: ${node.id}`);
        }
        continue;
      }
      throw new Error(`MVU node 缺少 path: ${node.id}`);
    }
    if (node.update_rules.length > 0) explicitRulePaths.add(nodePath);
    if (!node.legacy && node.writable && node.update_rules.length === 0 && !explicitRulePaths.has(nodePath)) {
      throw new Error(`可寫入的 MVU variable 缺少 update rule: ${nodePath}`);
    }
  }
  return parsed;
}
