import type {
  EjsExpression,
  EjsWhen,
  JsonValue,
} from "@card-workspace/schemas";

import { safeJsString } from "../../canonical.js";
import type { MvuPathBinding, MvuPathRegistry } from "../mvu/paths.js";
import { emitEjsJsonLiteral } from "./ejs-literal.js";

export type EjsValueType = "string" | "number" | "integer" | "boolean" | "enum" | "object" | "array" | "null";

export interface EjsExpressionContext {
  readonly mvuPathRegistry: MvuPathRegistry;
  readonly aliasesByPath: ReadonlyMap<string, string>;
}

export interface CompiledEjsExpression {
  readonly code: string;
  readonly type: EjsValueType;
  readonly binding?: MvuPathBinding;
}

type EjsLegacyCondition = {
  readonly path: string;
  readonly operator: "equals" | "not_equals" | "greater_than" | "less_than" | "truthy" | "falsy";
  readonly value?: string | number | boolean | undefined;
};

function isLegacyCondition(value: EjsWhen): value is EjsLegacyCondition {
  return "path" in value && "operator" in value && !("kind" in value);
}

function bindingFor(path: string, context: EjsExpressionContext): MvuPathBinding {
  const binding = context.mvuPathRegistry.paths[path];
  if (!binding) throw new Error(`EJS path 未在 MVU path registry 宣告: ${path}`);
  return binding;
}

function valueType(value: JsonValue): EjsValueType {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  return "object";
}

function bindingType(binding: MvuPathBinding): EjsValueType {
  return binding.kind;
}

function isNumeric(type: EjsValueType): boolean {
  return type === "number" || type === "integer";
}

function comparable(left: EjsValueType, right: EjsValueType): boolean {
  if (isNumeric(left) && isNumeric(right)) return true;
  if (left === "enum" && right === "string") return true;
  if (right === "enum" && left === "string") return true;
  return left === right;
}

function expressionForBinding(binding: MvuPathBinding, context: EjsExpressionContext): string {
  const alias = context.aliasesByPath.get(binding.path);
  if (alias) return alias;
  return `getvar(${safeJsString(binding.read_path)}, { defaults: ${emitEjsJsonLiteral(binding.default)} })`;
}

function compileLegacyCondition(condition: EjsLegacyCondition, context: EjsExpressionContext): CompiledEjsExpression {
  const binding = bindingFor(condition.path, context);
  const value = condition.value as JsonValue | undefined;
  const pathExpression = expressionForBinding(binding, context);
  switch (condition.operator) {
    case "truthy":
      return { code: `Boolean(${pathExpression})`, type: "boolean", binding };
    case "falsy":
      return { code: `!Boolean(${pathExpression})`, type: "boolean", binding };
    case "equals":
    case "not_equals": {
      if (value === undefined || !comparable(bindingType(binding), valueType(value))) {
        throw new Error(`EJS legacy condition literal 型別不符: ${condition.path}`);
      }
      return {
        code: `${pathExpression} ${condition.operator === "equals" ? "===" : "!=="} ${emitEjsJsonLiteral(value)}`,
        type: "boolean",
        binding,
      };
    }
    case "greater_than":
    case "less_than": {
      if (value === undefined || !isNumeric(bindingType(binding)) || !isNumeric(valueType(value))) {
        throw new Error(`EJS legacy numeric condition 型別不符: ${condition.path}`);
      }
      return {
        code: `${pathExpression} ${condition.operator === "greater_than" ? ">" : "<"} ${emitEjsJsonLiteral(value)}`,
        type: "boolean",
        binding,
      };
    }
  }
}

function compileExpression(expression: EjsExpression, context: EjsExpressionContext): CompiledEjsExpression {
  switch (expression.kind) {
    case "variable": {
      const binding = bindingFor(expression.path, context);
      return { code: expressionForBinding(binding, context), type: bindingType(binding), binding };
    }
    case "literal":
      return { code: emitEjsJsonLiteral(expression.value), type: valueType(expression.value) };
    case "compare": {
      const left = compileExpression(expression.left, context);
      const right = compileExpression(expression.right, context);
      if (!comparable(left.type, right.type)) throw new Error("EJS compare expression 型別不相容");
      if (["greater_than", "less_than"].includes(expression.operator) && (!isNumeric(left.type) || !isNumeric(right.type))) {
        throw new Error("EJS greater/less expression 必須使用 numeric values");
      }
      const operator = expression.operator === "equals" ? "==="
        : expression.operator === "not_equals" ? "!=="
          : expression.operator === "greater_than" ? ">" : "<";
      return { code: `${left.code} ${operator} ${right.code}`, type: "boolean" };
    }
    case "in": {
      const value = compileExpression(expression.value, context);
      const values = expression.values.map(valueForMembership => {
        if (!comparable(value.type, valueType(valueForMembership))) throw new Error("EJS membership value 型別不相容");
        return emitEjsJsonLiteral(valueForMembership);
      });
      if (value.binding?.kind === "enum" && value.binding.values && expression.values.some((item) => typeof item !== "string" || !value.binding?.values?.includes(item))) {
        throw new Error(`EJS membership 超出 enum values: ${value.binding.path}`);
      }
      return { code: `[${values.join(", ")}].includes(${value.code})`, type: "boolean" };
    }
    case "all":
      return { code: expression.conditions.map((condition) => conditionCode(condition, context)).join(" && "), type: "boolean" };
    case "any":
      return { code: expression.conditions.map((condition) => conditionCode(condition, context)).join(" || "), type: "boolean" };
    case "not":
      return { code: `!(${conditionCode(expression.condition, context)})`, type: "boolean" };
    case "range": {
      const binding = bindingFor(expression.path, context);
      if (!isNumeric(bindingType(binding))) throw new Error(`EJS range 必須使用 numeric path: ${expression.path}`);
      if (expression.min !== undefined && binding.min !== undefined && expression.min < binding.min) throw new Error(`EJS range 小於 MVU min: ${expression.path}`);
      if (expression.max !== undefined && binding.max !== undefined && expression.max > binding.max) throw new Error(`EJS range 大於 MVU max: ${expression.path}`);
      const pathExpression = expressionForBinding(binding, context);
      const clauses: string[] = [];
      if (expression.min !== undefined) clauses.push(`${pathExpression} ${expression.min_inclusive ? ">=" : ">"} ${emitEjsJsonLiteral(expression.min)}`);
      if (expression.max !== undefined) clauses.push(`${pathExpression} ${expression.max_inclusive ? "<=" : "<"} ${emitEjsJsonLiteral(expression.max)}`);
      return { code: clauses.join(" && "), type: "boolean", binding };
    }
  }
}

export function conditionCode(value: EjsWhen, context: EjsExpressionContext): string {
  const result = isLegacyCondition(value) ? compileLegacyCondition(value, context) : compileExpression(value, context);
  return result.type === "boolean" ? result.code : `Boolean(${result.code})`;
}

export function compileEjsExpression(value: EjsExpression, context: EjsExpressionContext): CompiledEjsExpression {
  return compileExpression(value, context);
}
