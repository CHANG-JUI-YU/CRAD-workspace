export class WorkflowError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function workflowFail(code: string, message: string, cause?: unknown): never {
  throw new WorkflowError(code, message, cause);
}
