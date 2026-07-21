import {
  ejsSourceSchema,
  type EjsExpression,
  type EjsSource,
  type EjsWhen,
} from "@card-workspace/schemas";

import type { MvuPathBinding, MvuPathRegistry } from "../mvu/paths.js";
import { conditionCode, type EjsExpressionContext } from "./generate-expression.js";

export interface EjsValidationContext extends EjsExpressionContext {
  readonly source: EjsSource;
  readonly aliases: readonly { id: string; variable: string; path: string; binding: MvuPathBinding }[];
}

function aliasVariable(id: string): string {
  return `cw_${id.replace(/[^A-Za-z0-9_$]/gu, "_")}`;
}

function rangeOf(value: EjsWhen): Extract<EjsExpression, { kind: "range" }> | undefined {
  return "kind" in value && value.kind === "range" ? value : undefined;
}

function validateRanges(sectionId: string, branches: readonly { when: EjsWhen }[], hasFallback: boolean): void {
  const ranges = branches.map((branch) => rangeOf(branch.when));
  if (ranges.some((range) => range === undefined)) {
    if (!hasFallback) throw new Error(`EJS ${sectionId} branches 需要 fallback`);
    return;
  }
  const resolvedRanges = ranges.filter((range): range is NonNullable<typeof range> => range !== undefined);
  const paths = new Set(resolvedRanges.map((range) => range.path));
  if (paths.size !== 1) {
    if (!hasFallback) throw new Error(`EJS ${sectionId} branches path 不一致且缺少 fallback`);
    return;
  }
  const sorted = [...resolvedRanges].sort((left, right) => (left.min ?? Number.NEGATIVE_INFINITY) - (right.min ?? Number.NEGATIVE_INFINITY));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.max !== undefined && current.min !== undefined) {
      if (previous.max > current.min || (previous.max === current.min && previous.max_inclusive && current.min_inclusive)) {
        throw new Error(`EJS ${sectionId} range branches overlap`);
      }
      if (previous.max < current.min || (!previous.max_inclusive && !current.min_inclusive)) {
        if (!hasFallback) throw new Error(`EJS ${sectionId} range branches 有 gap 且缺少 fallback`);
      }
    }
  }
  if (!hasFallback && (sorted[0]?.min !== undefined || sorted.at(-1)?.max !== undefined)) {
    throw new Error(`EJS ${sectionId} range branches 非 exhaustive 且缺少 fallback`);
  }
}

function validateBranchSet(
  id: string,
  branches: readonly { when: EjsWhen }[],
  fallback: string | undefined,
  context: EjsExpressionContext,
): void {
  for (const branch of branches) conditionCode(branch.when, context);
  validateRanges(id, branches, fallback !== undefined);
}

export function validateEjsSource(source: EjsSource, mvuPathRegistry: MvuPathRegistry): EjsValidationContext {
  const parsed = ejsSourceSchema.parse(source);
  const aliases: EjsValidationContext["aliases"][number][] = [];
  const aliasesByPath = new Map<string, string>();
  const aliasVariables = new Set<string>();
  for (const alias of parsed.preprocessing) {
    const binding = mvuPathRegistry.paths[alias.path];
    if (!binding) throw new Error(`EJS preprocessing path 未在 MVU registry 宣告: ${alias.path}`);
    const variable = aliasVariable(alias.id);
    if (aliasVariables.has(variable)) throw new Error(`EJS preprocessing alias identifier collision: ${alias.id}`);
    aliasVariables.add(variable);
    aliasesByPath.set(alias.path, variable);
    aliases.push({ id: alias.id, variable, path: alias.path, binding });
  }
  const context: EjsValidationContext = { source: parsed, mvuPathRegistry, aliasesByPath, aliases };
  for (const entry of parsed.entries) conditionCode(entry.condition, context);
  for (const section of parsed.sections) validateBranchSet(section.id, section.branches, section.fallback, context);
  for (const dynamic of parsed.dynamic_text) validateBranchSet(dynamic.id, dynamic.branches, dynamic.fallback, context);
  return context;
}
