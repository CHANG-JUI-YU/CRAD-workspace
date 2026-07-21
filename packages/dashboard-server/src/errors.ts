import type { Diagnostic } from "@card-workspace/schemas";

export class DashboardError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly diagnostics: Diagnostic[];

  constructor(code: string, message: string, statusCode = 400, retryable = false, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "DashboardError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.diagnostics = diagnostics;
  }
}

export function dashboardFail(code: string, message: string, statusCode = 400, retryable = false): never {
  throw new DashboardError(code, message, statusCode, retryable);
}
