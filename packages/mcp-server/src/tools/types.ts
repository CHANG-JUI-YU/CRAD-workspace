import type { WorkflowState } from "@card-workspace/schemas";

import type { TrustedContext } from "../context.js";

export type ToolArguments = Record<string, unknown>;

export interface ToolCallContext {
  trusted: TrustedContext;
  args: ToolArguments;
  workflow: WorkflowState;
  projectRoot: string;
}

export type ToolHandler = (context: ToolCallContext) => unknown;

export interface WorkspaceToolCallContext {
  trusted: TrustedContext;
  args: ToolArguments;
}

export type WorkspaceToolHandler = (context: WorkspaceToolCallContext) => unknown;

export function stringArg(args: ToolArguments, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${key} must be a non-empty string`);
  return value;
}

export function numberArg(args: ToolArguments, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${key} must be a number`);
  return value;
}

export function objectArg(args: ToolArguments, key: string): Record<string, unknown> {
  const value = args[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${key} must be an object`);
  return value as Record<string, unknown>;
}
