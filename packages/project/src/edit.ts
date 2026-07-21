import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  blueprintSchema,
  characterDocumentSchema,
  greetingsDocumentSchema,
  paletteModuleSchema,
  policyProfileSchema,
  projectManifestSchema,
  worldEntrySchema,
  workflowStateSchema,
  zhujiModuleSchema,
} from "@card-workspace/schemas";

import {
  canonicalJson,
  canonicalYaml,
  computeRevision,
  computeTextRevision,
  orderedYaml,
} from "./canonical.js";
import { ProjectError } from "./errors.js";
import { assertFoundationDocumentPath, assertPatchOwnership } from "./ownership.js";
import { parseStructuredFile } from "./parser.js";
import { applyJsonPatch, type Operation } from "./patch.js";
import { resolveWithin } from "./path-security.js";
import { runFileTransaction } from "./transaction.js";

function validatePatchedValue(relativePath: string, value: unknown): unknown {
  const result =
    relativePath === "project.yaml"
      ? projectManifestSchema.safeParse(value)
      : relativePath === "workflow.json"
        ? workflowStateSchema.safeParse(value)
        : relativePath === "blueprint.yaml"
          ? blueprintSchema.safeParse(value)
        : relativePath === "greetings.yaml"
          ? greetingsDocumentSchema.safeParse(value)
          : relativePath.endsWith("/character.yaml")
            ? characterDocumentSchema.safeParse(value)
            : relativePath.includes("/zhuji/")
              ? zhujiModuleSchema.safeParse(value)
              : relativePath.includes("/palette/")
                ? paletteModuleSchema.safeParse(value)
                : relativePath.startsWith("world/")
                  ? worldEntrySchema.safeParse(value)
                  : policyProfileSchema.safeParse(value);
  if (!result.success) {
    const diagnostics = result.error.issues.map((issue) => ({
      code: "PATCH_SCHEMA_INVALID",
      severity: "error" as const,
      message: issue.message,
      evidence: [],
      fixability: "manual" as const,
      location: { file: relativePath, path: issue.path.map(String) },
    }));
    throw new ProjectError("PATCH_SCHEMA_INVALID", "Patch 後資料不符合 schema", diagnostics);
  }
  return result.data;
}

export interface PatchFileOptions {
  projectRoot: string;
  relativePath: string;
  operations: readonly Operation[];
  expectedRevision: string;
  dryRun?: boolean;
}

export async function patchProjectFile(options: PatchFileOptions) {
  const normalizedPath = assertFoundationDocumentPath(options.relativePath);
  assertPatchOwnership(normalizedPath, options.operations);
  const filePath = await resolveWithin(options.projectRoot, options.relativePath);
  const parsed = await parseStructuredFile(filePath);
  if (parsed.data === undefined) {
    throw new Error(parsed.diagnostics.map((item) => item.message).join("\n"));
  }
  const workflowPath = await resolveWithin(options.projectRoot, "workflow.json");
  const workflowParsed =
    normalizedPath === "workflow.json" ? parsed : await parseStructuredFile(workflowPath);
  if (workflowParsed.data === undefined) {
    throw new ProjectError(
      "WORKFLOW_INVALID",
      workflowParsed.diagnostics.map((item) => item.message).join("\n"),
    );
  }
  const workflow = workflowStateSchema.parse(workflowParsed.data);
  const operations =
    normalizedPath === "workflow.json"
      ? [
          ...options.operations.filter((operation) => operation.path !== "/revision"),
          { op: "replace", path: "/revision", value: workflow.revision + 1 } as Operation,
        ]
      : options.operations;
  const patched = applyJsonPatch(parsed.data, operations, options.expectedRevision);
  const finalValue = validatePatchedValue(normalizedPath, patched.value);
  const authorModule = normalizedPath.includes("/zhuji/") || normalizedPath.includes("/palette/");
  const content = parsed.format === "json"
    ? canonicalJson(finalValue)
    : authorModule ? orderedYaml(finalValue) : canonicalYaml(finalValue);
  const noOp = patched.differences.length === 0;
  const nextWorkflow =
    normalizedPath === "workflow.json"
      ? finalValue
      : workflowStateSchema.parse({ ...workflow, revision: workflow.revision + (noOp ? 0 : 1) });
  const affectedFiles = noOp
    ? []
    : normalizedPath === "workflow.json"
      ? [normalizedPath]
      : [normalizedPath, "workflow.json"];

  if (!options.dryRun && !noOp) {
    const targetRawRevision = computeTextRevision(await readFile(filePath));
    const workflowRawRevision = computeTextRevision(await readFile(workflowPath));
    await runFileTransaction({
      root: options.projectRoot,
      operations:
        normalizedPath === "workflow.json"
          ? [
              {
                relativePath: normalizedPath,
                content,
                expectedRawRevision: targetRawRevision,
              },
            ]
          : [
              {
                relativePath: normalizedPath,
                content,
                expectedRawRevision: targetRawRevision,
              },
              {
                relativePath: "workflow.json",
                content: canonicalJson(nextWorkflow),
                expectedRawRevision: workflowRawRevision,
              },
            ],
    });
  }
  return {
    ...patched,
    value: finalValue,
    afterRevision: computeRevision(finalValue),
    content,
    dryRun: options.dryRun ?? false,
    noOp,
    filePath: path.resolve(filePath),
    affectedFiles,
    rebuildScopes: noOp
      ? []
      : normalizedPath === "project.yaml"
        ? ["project-manifest"]
        : normalizedPath === "workflow.json"
          ? ["workflow-state"]
          : ["author-model"],
    workflowRevision: (nextWorkflow as { revision: number }).revision,
  };
}
