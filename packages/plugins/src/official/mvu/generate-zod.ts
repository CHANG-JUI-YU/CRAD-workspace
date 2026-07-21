import type { JsonValue, MvuSource } from "@card-workspace/schemas";

import { safeJsValue } from "../../canonical.js";
import { officialMvuRuntimeUrl } from "../assets.js";
import { normalizeMvuSource, type NormalizedMvuNode } from "./paths.js";
import { validateGeneratedTypeScript, emitTypeScriptStringLiteral } from "./typescript-literal.js";
import { validateMvuSource } from "./validate.js";

function chain(expression: string, method: string, args: readonly string[]): string {
  return `${expression}.${method}(${args.join(", ")})`;
}

function clampExpression(value: string, min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `_.clamp(${value}, ${safeJsValue(min)}, ${safeJsValue(max)})`;
  if (min !== undefined) return `Math.max(${value}, ${safeJsValue(min)})`;
  if (max !== undefined) return `Math.min(${value}, ${safeJsValue(max)})`;
  return value;
}

function numberSchema(node: NormalizedMvuNode): string {
  let result = "z.coerce.number()";
  if (node.kind === "integer") result = chain(result, "transform", [`v => Math.trunc(v)`]);
  if (node.clamp && (node.min !== undefined || node.max !== undefined)) {
    result = chain(result, "transform", [`v => ${clampExpression("v", node.min, node.max)}`]);
  }
  return result;
}

function schemaForNode(node: NormalizedMvuNode): string {
  let result: string;
  switch (node.kind) {
    case "string":
      result = "z.string()";
      if (node.min_length !== undefined) {
        result = chain(result, "min", [safeJsValue(node.min_length)]);
      }
      if (node.max_length !== undefined) {
        result = chain(result, "transform", [`v => v.slice(0, ${safeJsValue(node.max_length)})`]);
      }
      break;
    case "number":
    case "integer":
      result = numberSchema(node);
      break;
    case "boolean":
      result = "z.boolean()";
      break;
    case "enum":
      result = `z.enum([${(node.values ?? []).map(emitTypeScriptStringLiteral).join(", ")}])`;
      break;
    case "object":
      result = `z.object({${(node.fields ?? []).map((field) => `\n  ${emitTypeScriptStringLiteral(field.id)}: ${schemaForNode(field)}`).join(",")}\n})`;
      break;
    case "array":
      result = `z.array(${schemaForNode(node.items!)})`;
      if (node.min_items !== undefined) {
        result = chain(result, "min", [safeJsValue(node.min_items)]);
      }
      if (node.max_items !== undefined) {
        result = chain(result, "max", [safeJsValue(node.max_items)]);
      }
      break;
  }
  result = chain(result, "prefault", [safeJsValue(node.default)]);
  if (node.description) result = chain(result, "describe", [emitTypeScriptStringLiteral(node.description)]);
  else if (node.label !== node.id) result = chain(result, "describe", [emitTypeScriptStringLiteral(node.label)]);
  return result;
}

function rootSchema(roots: readonly NormalizedMvuNode[]): string {
  const shape = `z.object({${roots.map((root) => `\n  ${emitTypeScriptStringLiteral(root.id)}: ${schemaForNode(root)}`).join(",")}\n})`;
  return chain(shape, "prefault", [safeJsValue(Object.fromEntries(roots.map((root) => [root.id, root.default])))]);
}

export function generateMvuZodSource(source: MvuSource): string {
  const parsed = validateMvuSource(source);
  const { roots } = normalizeMvuSource(parsed);
  const generated = [
    `import { registerMvuSchema } from ${emitTypeScriptStringLiteral(officialMvuRuntimeUrl)};`,
    "",
    `export const Schema = ${rootSchema(roots)};`,
    "",
    "$(() => {",
    "  registerMvuSchema(Schema);",
    "});",
    "",
  ].join("\n");
  return validateGeneratedTypeScript(generated);
}

export function generateMvuInitialState(source: MvuSource): JsonValue {
  const { roots } = normalizeMvuSource(validateMvuSource(source));
  return Object.fromEntries(roots.map((root) => [root.id, root.default])) as JsonValue;
}
