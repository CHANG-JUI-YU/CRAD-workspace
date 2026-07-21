import type { Diagnostic } from "@card-workspace/schemas";

export class ProjectError extends Error {
  public readonly code: string;
  public readonly diagnostics: Diagnostic[];

  public constructor(code: string, message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
