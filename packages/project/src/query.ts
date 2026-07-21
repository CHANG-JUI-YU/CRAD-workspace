import { ProjectError } from "./errors.js";

function decodeSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function queryPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) {
    throw new ProjectError("POINTER_INVALID", "JSON Pointer 必須為空字串或以 / 開頭");
  }

  let current = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodeSegment(rawSegment);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(segment)) {
        throw new ProjectError("POINTER_NOT_FOUND", `陣列索引無效：${segment}`);
      }
      const index = Number(segment);
      if (index >= current.length) {
        throw new ProjectError("POINTER_NOT_FOUND", `陣列索引超出範圍：${segment}`);
      }
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === "object") {
      if (!Object.hasOwn(current, segment)) {
        throw new ProjectError("POINTER_NOT_FOUND", `找不到路徑片段：${segment}`);
      }
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    throw new ProjectError("POINTER_NOT_FOUND", `無法進入路徑片段：${segment}`);
  }
  return current;
}
