import { WorkflowError } from "@card-workspace/workflow";

export class McpDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "McpDomainError";
  }
}

export function mcpFail(code: string, message: string, details?: unknown): never {
  throw new McpDomainError(code, message, details);
}

export function errorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof McpDomainError ? error.code : "MCP_TOOL_FAILED";
}

export function machineError(error: unknown): { ok: false; error: { code: string; message: string; details?: unknown } } {
  const domainError = error instanceof McpDomainError ? error : undefined;
  const workflowCause = error instanceof WorkflowError && error.cause !== undefined
    && error.cause !== null && typeof error.cause === "object"
    ? error.cause
    : undefined;
  return {
    ok: false,
    error: {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "Tool call failed",
      ...(domainError?.details === undefined && workflowCause === undefined ? {} : { details: domainError?.details ?? workflowCause }),
    },
  };
}
