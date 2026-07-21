import type { Operation } from "fast-json-patch";
import jsonPatch from "fast-json-patch";

import type { Revision } from "@card-workspace/schemas";

import { computeRevision } from "./canonical.js";
import { diffValues, type Difference } from "./diff.js";
import { ProjectError } from "./errors.js";

const { applyPatch, validate } = jsonPatch;

export interface PatchResult {
  value: unknown;
  beforeRevision: Revision;
  afterRevision: Revision;
  differences: Difference[];
}

export function applyJsonPatch(
  value: unknown,
  operations: readonly Operation[],
  expectedRevision: string,
): PatchResult {
  const beforeRevision = computeRevision(value);
  if (!expectedRevision) {
    throw new ProjectError("BASE_REVISION_REQUIRED", "Patch 必須提供 base revision");
  }
  if (expectedRevision !== beforeRevision) {
    throw new ProjectError(
      "REVISION_CONFLICT",
      `Revision 已變更；預期 ${expectedRevision}，實際 ${beforeRevision}`,
    );
  }

  for (const operation of operations) {
    const segments = operation.path.split("/").slice(1);
    if (segments.some((segment) => ["__proto__", "constructor", "prototype"].includes(segment))) {
      throw new ProjectError("PATCH_PATH_DENIED", `禁止的 Patch 路徑：${operation.path}`);
    }
  }

  const patchError = validate(operations as Operation[], value);
  if (patchError) {
    throw new ProjectError("PATCH_INVALID", patchError.message);
  }

  const original = structuredClone(value);
  const result = applyPatch<unknown>(
    structuredClone(value),
    operations as Operation[],
    true,
    false,
    true,
  ).newDocument;
  return {
    value: result,
    beforeRevision,
    afterRevision: computeRevision(result),
    differences: diffValues(original, result),
  };
}

export type { Operation } from "fast-json-patch";
