import type { z } from "zod";

import type { Diagnostic } from "./diagnostic.js";
import { policyProfileSchema } from "./policy.js";
import { projectManifestSchema } from "./project.js";
import { workflowStateSchema } from "./workflow.js";

export interface ValidationSuccess<T> {
  ok: true;
  diagnostics: [];
  data: T;
}

export interface ValidationFailure {
  ok: false;
  diagnostics: Diagnostic[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
  options: { file?: string; code?: string } = {},
): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, diagnostics: [], data: result.data };
  }

  const diagnostics = result.error.issues.map<Diagnostic>((issue) => ({
    code: options.code ?? "SCHEMA_INVALID",
    severity: "error",
    message: issue.message,
    evidence: [],
    fixability: "manual",
    location: {
      file: options.file ?? "<input>",
      path: issue.path.map((segment) =>
        typeof segment === "symbol" ? segment.description ?? segment.toString() : segment,
      ),
    },
  }));

  return { ok: false, diagnostics };
}

export function parseProjectManifest(input: unknown) {
  return projectManifestSchema.parse(input);
}

export function safeParseProjectManifest(input: unknown) {
  return validateSchema(projectManifestSchema, input, { code: "PROJECT_MANIFEST_INVALID" });
}

export function parseWorkflowState(input: unknown) {
  return workflowStateSchema.parse(input);
}

export function safeParseWorkflowState(input: unknown) {
  return validateSchema(workflowStateSchema, input, { code: "WORKFLOW_STATE_INVALID" });
}

export function parsePolicyProfile(input: unknown) {
  return policyProfileSchema.parse(input);
}

export function safeParsePolicyProfile(input: unknown) {
  return validateSchema(policyProfileSchema, input, { code: "POLICY_PROFILE_INVALID" });
}
