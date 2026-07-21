import {
  mvuSourceSchema,
  type JsonValue,
  type MvuSource,
  type MvuVariable,
  type MvuVariableNode,
} from "@card-workspace/schemas";

export type MvuNodeKind = "string" | "number" | "integer" | "boolean" | "enum" | "object" | "array";

export interface NormalizedMvuNode {
  readonly id: string;
  readonly label: string;
  readonly kind: MvuNodeKind;
  readonly default: JsonValue;
  readonly writable: boolean;
  readonly visibility: "visible" | "hidden";
  readonly description?: string;
  readonly min?: number;
  readonly max?: number;
  readonly clamp?: boolean;
  readonly min_length?: number;
  readonly max_length?: number;
  readonly min_items?: number;
  readonly max_items?: number;
  readonly values?: readonly string[];
  readonly fields?: readonly NormalizedMvuNode[];
  readonly items?: NormalizedMvuNode;
  readonly update_rules: readonly string[];
  readonly legacy: boolean;
  readonly path: readonly string[];
}

export interface MvuPathBinding {
  readonly id: string;
  readonly label: string;
  readonly kind: MvuNodeKind;
  readonly path: string;
  readonly read_path: string;
  readonly patch_path: string;
  readonly default: JsonValue;
  readonly min?: number;
  readonly max?: number;
  readonly values?: readonly string[];
  readonly writable: boolean;
  readonly visibility: "visible" | "hidden";
  readonly container: boolean;
}

export interface MvuPathRegistry {
  readonly schema_version: 1;
  readonly paths: Readonly<Record<string, MvuPathBinding>>;
  readonly by_id: Readonly<Record<string, string>>;
  readonly runtime_read_paths: Readonly<Record<string, string>>;
  readonly json_patch_paths: Readonly<Record<string, string>>;
}

function isVariableNode(variable: MvuVariable): variable is MvuVariableNode {
  return "kind" in variable;
}

function withOptional<T extends Record<string, unknown>>(base: T, key: string, value: unknown): T & Record<string, unknown> {
  if (value === undefined) return base;
  return { ...base, [key]: value };
}

export function normalizeMvuVariable(variable: MvuVariable, path: readonly string[] = []): NormalizedMvuNode {
  if (!isVariableNode(variable)) {
    const base = {
      id: variable.name,
      label: variable.name,
      kind: variable.type as MvuNodeKind,
      default: variable.default as JsonValue,
      writable: variable.writable,
      visibility: "visible" as const,
      update_rules: [] as readonly string[],
      legacy: true,
      path,
    };
    return withOptional(withOptional(base, "min", variable.min), "max", variable.max) as NormalizedMvuNode;
  }

  const base = {
    id: variable.id,
    label: variable.label,
    kind: variable.kind,
    default: variable.default as JsonValue,
    writable: variable.writable,
    visibility: variable.visibility,
    update_rules: variable.update_rules,
    legacy: false,
    path,
  };
  const withDescription = withOptional(base, "description", variable.description);
  switch (variable.kind) {
    case "string":
      return withOptional(
        withOptional(withDescription, "min_length", variable.min_length),
        "max_length",
        variable.max_length,
      ) as NormalizedMvuNode;
    case "number":
    case "integer":
      return withOptional(
        withOptional({ ...withDescription, clamp: variable.clamp }, "min", variable.min),
        "max",
        variable.max,
      ) as NormalizedMvuNode;
    case "boolean":
      return withDescription as NormalizedMvuNode;
    case "enum":
      return { ...withDescription, values: variable.values } as NormalizedMvuNode;
    case "object":
      return {
        ...withDescription,
        fields: variable.fields.map((field) => normalizeMvuVariable(field, [...path, field.id])),
      } as NormalizedMvuNode;
    case "array":
      return {
        ...withOptional(withOptional(withDescription, "min_items", variable.min_items), "max_items", variable.max_items),
        items: normalizeMvuVariable(variable.items, [...path, "*"]),
      } as NormalizedMvuNode;
  }
}

export function normalizeMvuSource(source: MvuSource): { source: MvuSource; roots: readonly NormalizedMvuNode[] } {
  const parsed = mvuSourceSchema.parse(source);
  return {
    source: parsed,
    roots: parsed.variables.map((variable) => normalizeMvuVariable(variable, [isVariableNode(variable) ? variable.id : variable.name])),
  };
}

function encodePointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerFor(path: readonly string[]): string {
  return `/${path.filter((part) => part !== "*").map(encodePointerToken).join("/")}`;
}

function runtimePathFor(path: readonly string[]): string {
  return `stat_data${path
    .filter((part) => part !== "*")
    .map((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`)
    .join("")}`;
}

function collectPathBindings(nodes: readonly NormalizedMvuNode[], output: MvuPathBinding[]): void {
  const paths = new Set(output.map((binding) => binding.path));
  for (const node of nodes) {
    const path = pointerFor(node.path);
    if (paths.has(path)) {
      throw new Error(`MVU path 重複: ${path}`);
    }
    paths.add(path);
    output.push({
      id: node.id,
      label: node.label,
      kind: node.kind,
      path,
      read_path: runtimePathFor(node.path),
      patch_path: path,
      default: node.default,
      ...(node.min === undefined ? {} : { min: node.min }),
      ...(node.max === undefined ? {} : { max: node.max }),
      ...(node.values === undefined ? {} : { values: [...node.values] }),
      writable: node.writable,
      visibility: node.visibility,
      container: node.kind === "object" || node.kind === "array",
    });
    if (node.fields) collectPathBindings(node.fields, output);
  }
}

export function buildMvuPathRegistry(source: MvuSource | readonly NormalizedMvuNode[]): MvuPathRegistry {
  const roots: readonly NormalizedMvuNode[] = "variables" in source
    ? normalizeMvuSource(source).roots
    : source;
  const bindings: MvuPathBinding[] = [];
  collectPathBindings(roots, bindings);
  const paths = Object.fromEntries(bindings
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((binding) => [binding.path, binding]));
  const byId: Record<string, string> = {};
  const runtimeReadPaths: Record<string, string> = {};
  const jsonPatchPaths: Record<string, string> = {};
  for (const binding of [...bindings].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (byId[binding.id] !== undefined) throw new Error(`MVU variable ID 重複: ${binding.id}`);
    byId[binding.id] = binding.path;
    runtimeReadPaths[binding.id] = binding.read_path;
    jsonPatchPaths[binding.id] = binding.patch_path;
  }
  return {
    schema_version: 1,
    paths,
    by_id: byId,
    runtime_read_paths: runtimeReadPaths,
    json_patch_paths: jsonPatchPaths,
  };
}

export function flattenMvuNodes(roots: readonly NormalizedMvuNode[]): NormalizedMvuNode[] {
  const result: NormalizedMvuNode[] = [];
  const visit = (nodes: readonly NormalizedMvuNode[]): void => {
    for (const node of nodes) {
      result.push(node);
      if (node.fields) visit(node.fields);
      if (node.items) visit([node.items]);
    }
  };
  visit(roots);
  return result;
}
