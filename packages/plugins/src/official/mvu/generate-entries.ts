import type { JsonValue, MvuSource, PluginContributions } from "@card-workspace/schemas";

import { canonicalJson } from "../../canonical.js";
import { generateMvuInitialState, generateMvuZodSource } from "./generate-zod.js";
import { normalizeMvuSource, type NormalizedMvuNode } from "./paths.js";
import { validateMvuSource } from "./validate.js";

const quote = (value: string): string => JSON.stringify(value);

function yamlScalar(value: JsonValue): string {
  if (typeof value === "string") return quote(value);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return quote(canonicalJson(value));
}

function renderYaml(value: JsonValue, indent = 0): string[] {
  const prefix = " ".repeat(indent);
  if (value === null || typeof value !== "object") return [`${prefix}${yamlScalar(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`];
    return value.flatMap((item) => {
      if (item !== null && typeof item === "object") {
        const lines = renderYaml(item, indent + 2);
        return [`${prefix}- ${lines[0]!.trimStart()}`, ...lines.slice(1)];
      }
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return [`${prefix}{}`];
  return entries.flatMap(([key, child]) => {
    if (child !== null && typeof child === "object") {
      const lines = renderYaml(child, indent + 2);
      return [`${prefix}${key}:`, ...lines];
    }
    return [`${prefix}${key}: ${yamlScalar(child)}`];
  });
}

export function generateMvuInitVar(source: MvuSource): string {
  return `<initvar>\n${renderYaml(generateMvuInitialState(source)).join("\n")}\n</initvar>\n`;
}

export function generateMvuVariableList(): string {
  return "---\n<status_current_variable>\n{{format_message_variable::stat_data}}\n</status_current_variable>\n";
}

function typeHint(node: NormalizedMvuNode): string | undefined {
  switch (node.kind) {
    case "string": return "string";
    case "number": return "number";
    case "integer": return "integer";
    case "boolean": return "boolean";
    case "enum": return (node.values ?? []).map((value) => quote(value)).join("|");
    case "object": return "object";
    case "array": return "array";
  }
}

function ruleForNode(node: NormalizedMvuNode, path: string): Record<string, JsonValue> | undefined {
  if (node.update_rules.length === 0) return undefined;
  const rule: Record<string, JsonValue> = {
    path,
    check: [...node.update_rules],
  };
  const type = typeHint(node);
  if (type) rule.type = type;
  if (node.min !== undefined && node.max !== undefined) rule.range = `${node.min}~${node.max}`;
  else if (node.min !== undefined) rule.range = `>= ${node.min}`;
  else if (node.max !== undefined) rule.range = `<= ${node.max}`;
  if (node.description) rule.value = node.description;
  return rule;
}

export function generateMvuUpdateRules(source: MvuSource): string {
  const parsed = validateMvuSource(source);
  const { roots } = normalizeMvuSource(parsed);
  const rules: Record<string, JsonValue>[] = parsed.update_rules.map((rule) => ({
    path: rule.path,
    ...(rule.type ? { type: rule.type } : {}),
    ...(rule.range_min !== undefined && rule.range_max !== undefined
      ? { range: `${rule.range_min}~${rule.range_max}` }
      : rule.range_min !== undefined
        ? { range: `>= ${rule.range_min}` }
        : rule.range_max !== undefined
          ? { range: `<= ${rule.range_max}` }
          : {}),
    ...(rule.format ? { format: rule.format } : {}),
    ...(rule.value ? { value: rule.value } : {}),
    check: [...rule.check],
  }));
  const visit = (nodes: readonly NormalizedMvuNode[]): void => {
    for (const node of nodes) {
      const rule = ruleForNode(node, `/${node.path.join("/")}`);
      if (rule) rules.push(rule);
      if (node.fields) visit(node.fields);
    }
  };
  visit(roots);
  rules.sort((left, right) => {
    if (typeof left.path !== "string" || typeof right.path !== "string") {
      throw new Error("MVU update rule path 必須是字串");
    }
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
  const lines = rules.length > 0 ? renderYaml(rules as JsonValue, 4) : ["    []"];
  return [
    "---",
    "變量更新規則:",
    "  rule:",
    ...lines,
    "",
  ].join("\n");
}

export function generateMvuOutputFormat(): string {
  return [
    "---",
    "變量輸出格式:",
    "  rule:",
    "    - 必須在回覆結尾同時輸出更新分析與實際更新命令。",
    "    - 更新命令必須是有效 JSON 陣列，路徑從變量根開始，不得包含 runtime state wrapper。",
    "    - replace 替換既有值；delta 調整數字；insert 新增 object key 或 array item；remove 刪除；move 移動。",
    "  format: |-",
    "    <UpdateVariable>",
    "    <Analysis>$(IN ENGLISH, no more than 80 words)",
    "    - ${calculate time passed: ...}",
    "    - ${analyze every writable variable according to its update rule and the current reply: ...}",
    "    </Analysis>",
    "    <JSONPatch>",
    "    [",
    "      { \"op\": \"replace\", \"path\": \"${/path/to/variable}\", \"value\": ${new_value} },",
    "      { \"op\": \"delta\", \"path\": \"${/path/to/number}\", \"value\": ${positive_or_negative_delta} },",
    "      { \"op\": \"insert\", \"path\": \"${/path/to/object/new_key}\", \"value\": ${new_value} },",
    "      { \"op\": \"insert\", \"path\": \"${/path/to/array/-}\", \"value\": ${new_value} },",
    "      { \"op\": \"remove\", \"path\": \"${/path/to/object/key}\" },",
    "      { \"op\": \"move\", \"from\": \"${/path/from}\", \"to\": \"${/path/to}\" }",
    "    ]",
    "    </JSONPatch>",
    "    </UpdateVariable>",
    "",
  ].join("\n");
}

function loreExtensions(kind: string, position: number, depth?: number, role?: number): Record<string, JsonValue> {
  return {
    "card-workspace/mvu": { kind, managed: true },
    position,
    ...(depth === undefined ? {} : { depth }),
    ...(role === undefined ? {} : { role }),
    exclude_recursion: true,
    prevent_recursion: true,
  };
}

export function generateMvuLoreEntries(source: MvuSource): PluginContributions["lore_entries"] {
  const entries = [
    {
      id: "plugin.mvu-zod.initvar",
      name: "[initvar]變量初始化勿開",
      content: generateMvuInitVar(source),
      enabled: false,
      insertion_order: 14720,
      kind: "initvar",
      constant: false,
      position: "before_char" as const,
      extensions: loreExtensions("initvar", 0),
    },
    {
      id: "plugin.mvu-zod.variable-list",
      name: "變量列表",
      content: generateMvuVariableList(),
      enabled: true,
      insertion_order: 14720,
      kind: "variable-list",
      constant: true,
      position: "after_char" as const,
      extensions: loreExtensions("variable-list", 4, 0, 2),
    },
    {
      id: "plugin.mvu-zod.update-rules",
      name: "[mvu_update]變量更新規則",
      content: generateMvuUpdateRules(source),
      enabled: true,
      insertion_order: 14720,
      kind: "update-rules",
      constant: true,
      position: "after_char" as const,
      extensions: loreExtensions("update-rules", 4, 0, 2),
    },
    {
      id: "plugin.mvu-zod.output-format",
      name: "[mvu_update]變量輸出格式",
      content: generateMvuOutputFormat(),
      enabled: true,
      insertion_order: 14720,
      kind: "output-format",
      constant: true,
      position: "after_char" as const,
      extensions: loreExtensions("output-format", 4, 0, 2),
    },
  ];
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    keys: [],
    content: entry.content,
    use_regex: false,
    enabled: entry.enabled,
    insertion_order: entry.insertion_order,
    constant: entry.constant,
    position: entry.position,
    extensions: entry.extensions,
  }));
}

export function generateMvuInitialStateJson(source: MvuSource): string {
  return canonicalJson(generateMvuInitialState(source));
}

export { generateMvuZodSource };
