export interface PatchOperation {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildPatch(before: unknown, after: unknown, path = ""): PatchOperation[] {
  if (equal(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    const operations: PatchOperation[] = [];
    for (const key of Object.keys(before).sort()) {
      if (!(key in after)) operations.push({ op: "remove", path: `${path}/${escapePointer(key)}` });
    }
    for (const key of Object.keys(after).sort()) {
      const pointer = `${path}/${escapePointer(key)}`;
      if (!(key in before)) operations.push({ op: "add", path: pointer, value: after[key] });
      else operations.push(...buildPatch(before[key], after[key], pointer));
    }
    return operations;
  }
  return [{ op: "replace", path: path || "/", value: after }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
