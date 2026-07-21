export interface Difference {
  path: string;
  before?: unknown;
  after?: unknown;
  kind: "added" | "changed" | "removed";
}

function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function diffValues(before: unknown, after: unknown, pointer = ""): Difference[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const differences: Difference[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const child = `${pointer}/${index}`;
      if (index >= before.length) {
        differences.push({ path: child, after: after[index], kind: "added" });
      } else if (index >= after.length) {
        differences.push({ path: child, before: before[index], kind: "removed" });
      } else {
        differences.push(...diffValues(before[index], after[index], child));
      }
    }
    return differences;
  }
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.flatMap((key) => {
      const child = `${pointer}/${escapeSegment(key)}`;
      if (!Object.hasOwn(left, key)) return [{ path: child, after: right[key], kind: "added" }];
      if (!Object.hasOwn(right, key)) return [{ path: child, before: left[key], kind: "removed" }];
      return diffValues(left[key], right[key], child);
    });
  }
  return [{ path: pointer, before, after, kind: "changed" }];
}
