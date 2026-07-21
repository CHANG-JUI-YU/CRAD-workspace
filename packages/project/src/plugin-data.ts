import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { isAlias, isMap, isPair, isSeq, parseAllDocuments } from "yaml";

import { ProjectError } from "./errors.js";

export const PLUGIN_DATA_MAX_BYTES = 1024 * 1024;
export const PLUGIN_DATA_MAX_DEPTH = 64;
export const PLUGIN_DATA_MAX_NODES = 50_000;

type PluginDataFormat = "json" | "yaml";

interface JsonCursor {
  index: number;
  nodes: number;
  depth: number;
}

function countNode(cursor: JsonCursor): void {
  cursor.nodes += 1;
  if (cursor.nodes > PLUGIN_DATA_MAX_NODES) fail("PLUGIN_DATA_LIMIT", "plugin-data 節點數超過上限");
}

function fail(code: string, message: string): never {
  throw new ProjectError(code, message);
}

function dangerousKey(value: string): boolean {
  return value === "__proto__" || value === "prototype" || value === "constructor";
}

function skipWhitespace(raw: string, cursor: JsonCursor): void {
  while (/\s/u.test(raw[cursor.index] ?? "")) cursor.index += 1;
}

function parseJsonString(raw: string, cursor: JsonCursor): string {
  const start = cursor.index;
  if (raw[cursor.index] !== '"') fail("PLUGIN_DATA_JSON_INVALID", "JSON 字串必須以雙引號開始");
  cursor.index += 1;
  while (cursor.index < raw.length) {
    const character = raw[cursor.index]!;
    if (character === "\\") {
      cursor.index += 2;
      continue;
    }
    cursor.index += 1;
    if (character === '"') {
      const value = JSON.parse(raw.slice(start, cursor.index)) as unknown;
      if (typeof value !== "string") fail("PLUGIN_DATA_JSON_INVALID", "JSON 字串解析失敗");
      return value;
    }
    if (character < " ") fail("PLUGIN_DATA_JSON_INVALID", "JSON 字串含有控制字元");
  }
  fail("PLUGIN_DATA_JSON_INVALID", "JSON 字串未閉合");
}

function parseJsonValue(raw: string, cursor: JsonCursor): void {
  skipWhitespace(raw, cursor);
  countNode(cursor);
  if (cursor.depth > PLUGIN_DATA_MAX_DEPTH) fail("PLUGIN_DATA_LIMIT", "plugin-data 巢狀深度超過上限");
  const character = raw[cursor.index];
  if (character === '"') {
    parseJsonString(raw, cursor);
    return;
  }
  if (character === "{") {
    cursor.index += 1;
    cursor.depth += 1;
    const keys = new Set<string>();
    skipWhitespace(raw, cursor);
    if (raw[cursor.index] === "}") {
      cursor.index += 1;
      cursor.depth -= 1;
      return;
    }
    while (cursor.index < raw.length) {
      skipWhitespace(raw, cursor);
      const key = parseJsonString(raw, cursor);
      countNode(cursor);
      if (dangerousKey(key)) fail("PLUGIN_DATA_KEY_DENIED", `JSON key ${key} 不允許`);
      if (keys.has(key)) fail("PLUGIN_DATA_DUPLICATE_KEY", `JSON key ${key} 重複`);
      keys.add(key);
      skipWhitespace(raw, cursor);
      if (raw[cursor.index] !== ":") fail("PLUGIN_DATA_JSON_INVALID", "JSON object 缺少冒號");
      cursor.index += 1;
      parseJsonValue(raw, cursor);
      skipWhitespace(raw, cursor);
      if (raw[cursor.index] === "}") {
        cursor.index += 1;
        cursor.depth -= 1;
        return;
      }
      if (raw[cursor.index] !== ",") fail("PLUGIN_DATA_JSON_INVALID", "JSON object 缺少逗號");
      cursor.index += 1;
    }
    fail("PLUGIN_DATA_JSON_INVALID", "JSON object 未閉合");
  }
  if (character === "[") {
    cursor.index += 1;
    cursor.depth += 1;
    skipWhitespace(raw, cursor);
    if (raw[cursor.index] === "]") {
      cursor.index += 1;
      cursor.depth -= 1;
      return;
    }
    while (cursor.index < raw.length) {
      parseJsonValue(raw, cursor);
      skipWhitespace(raw, cursor);
      if (raw[cursor.index] === "]") {
        cursor.index += 1;
        cursor.depth -= 1;
        return;
      }
      if (raw[cursor.index] !== ",") fail("PLUGIN_DATA_JSON_INVALID", "JSON array 缺少逗號");
      cursor.index += 1;
    }
    fail("PLUGIN_DATA_JSON_INVALID", "JSON array 未閉合");
  }
  const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(raw.slice(cursor.index));
  if (!primitive) fail("PLUGIN_DATA_JSON_INVALID", "JSON value 無效");
  cursor.index += primitive[0].length;
}

function validateJsonText(raw: string): void {
  const cursor: JsonCursor = { index: 0, nodes: 0, depth: 0 };
  parseJsonValue(raw, cursor);
  skipWhitespace(raw, cursor);
  if (cursor.index !== raw.length) fail("PLUGIN_DATA_JSON_INVALID", "JSON value 後仍有未解析內容");
}

interface YamlNodeLike {
  type?: string;
  value?: unknown;
  items?: unknown[];
  key?: unknown;
  anchor?: string;
  tag?: string;
}

function yamlScalarValue(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  return (node as YamlNodeLike).value;
}

function inspectYamlNode(node: unknown, state: { depth: number; nodes: number }): void {
  state.nodes += 1;
  if (state.nodes > PLUGIN_DATA_MAX_NODES) fail("PLUGIN_DATA_LIMIT", "plugin-data 節點數超過上限");
  if (state.depth > PLUGIN_DATA_MAX_DEPTH) fail("PLUGIN_DATA_LIMIT", "plugin-data 巢狀深度超過上限");
  if (node === null || typeof node !== "object") return;
  if (isAlias(node)) fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML alias 不允許");
  const value = node as YamlNodeLike;
  if (value.type === "ALIAS" || value.anchor !== undefined) fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML alias/anchor 不允許");
  if (value.tag !== undefined) fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML custom tag 不允許");
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair)) fail("PLUGIN_DATA_YAML_INVALID", "YAML map pair 無效");
      const keyNode = pair.key;
      const keyValue = yamlScalarValue(keyNode);
      if (keyNode !== null && typeof keyNode === "object" && (Array.isArray((keyNode as YamlNodeLike).items) || ["MAP", "SEQ"].includes((keyNode as YamlNodeLike).type ?? ""))) {
        fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML complex key 不允許");
      }
      if (keyValue === "<<") {
        fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML merge key 不允許");
      }
      if (typeof keyValue === "string" && dangerousKey(keyValue)) {
        fail("PLUGIN_DATA_KEY_DENIED", `YAML key ${keyValue} 不允許`);
      }
      state.depth += 1;
      inspectYamlNode(keyNode, state);
      inspectYamlNode(pair.value, state);
      state.depth -= 1;
    }
    return;
  }
  if (isSeq(node)) {
    state.depth += 1;
    for (const item of node.items) inspectYamlNode(item, state);
    state.depth -= 1;
  }
}

function validateYamlText(raw: string): unknown {
  if (/^\s*%/mu.test(raw)) fail("PLUGIN_DATA_YAML_FEATURE_DENIED", "YAML directive 不允許");
  const documents = parseAllDocuments(raw, {
    prettyErrors: false,
    uniqueKeys: true,
    version: "1.2",
  });
  if (documents.length !== 1) fail("PLUGIN_DATA_YAML_INVALID", "YAML 必須包含單一 document");
  const document = documents[0]!;
  if (document.errors.length > 0) fail("PLUGIN_DATA_YAML_INVALID", document.errors[0]!.message);
  if (document.contents === undefined || document.contents === null) fail("PLUGIN_DATA_YAML_INVALID", "YAML 必須包含內容");
  inspectYamlNode(document.contents, { depth: 0, nodes: 0 });
  const value: unknown = document.toJS() as unknown;
  inspectMaterializedValue(value, { depth: 0, nodes: 0 });
  return value;
}

function inspectMaterializedValue(value: unknown, state: { depth: number; nodes: number }): void {
  state.nodes += 1;
  if (state.nodes > PLUGIN_DATA_MAX_NODES) fail("PLUGIN_DATA_LIMIT", "plugin-data 節點數超過上限");
  if (state.depth > PLUGIN_DATA_MAX_DEPTH) fail("PLUGIN_DATA_LIMIT", "plugin-data 巢狀深度超過上限");
  if (Array.isArray(value)) {
    state.depth += 1;
    value.forEach((item) => inspectMaterializedValue(item, state));
    state.depth -= 1;
    return;
  }
  if (value !== null && typeof value === "object") {
    state.depth += 1;
    for (const [key, child] of Object.entries(value)) {
      if (dangerousKey(key)) fail("PLUGIN_DATA_KEY_DENIED", `YAML key ${key} 不允許`);
      inspectMaterializedValue(child, state);
    }
    state.depth -= 1;
  }
}

export function parsePluginDataText(raw: string, format: PluginDataFormat): unknown {
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > PLUGIN_DATA_MAX_BYTES) fail("PLUGIN_DATA_LIMIT", "plugin-data 超過 1 MiB");
  if (format === "json") {
    validateJsonText(raw);
    return JSON.parse(raw) as unknown;
  }
  return validateYamlText(raw);
}

export async function parsePluginDataFile(filePath: string, format?: PluginDataFormat): Promise<{ raw: string; data: unknown }> {
  const metadata = await stat(filePath);
  if (metadata.size > PLUGIN_DATA_MAX_BYTES) fail("PLUGIN_DATA_LIMIT", `${path.basename(filePath)} 超過 1 MiB`);
  const buffer = await readFile(filePath);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail("PLUGIN_DATA_ENCODING_INVALID", `${path.basename(filePath)} 不是有效 UTF-8`);
  }
  if (Buffer.byteLength(raw, "utf8") > PLUGIN_DATA_MAX_BYTES) {
    fail("PLUGIN_DATA_LIMIT", `${path.basename(filePath)} 超過 1 MiB`);
  }
  const resolvedFormat = format ?? (path.extname(filePath).toLowerCase() === ".json" ? "json" : "yaml");
  return { raw, data: parsePluginDataText(raw, resolvedFormat) };
}
