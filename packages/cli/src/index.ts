#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { IngestionError, SourceAdapterError } from "@card-workspace/ingestion";
import { canonicalJson, ProjectError } from "@card-workspace/project";
import { CommanderError } from "commander";

import { runCli } from "./program.js";

export * from "./program.js";

interface CodedError {
  code?: string;
  diagnostics?: unknown[];
}

export function cliErrorCode(error: unknown): number {
  const code = (error as CodedError).code ?? "";
  if (/(?:CONFLICT|STALE|LOCKED|ALREADY_EXISTS|SUPERSEDED)/u.test(code)) return 3;
  if (/(?:PATH|SYMLINK|NOT_REGULAR_FILE|FILE_UNREADABLE|OUTSIDE_ROOT|SECURITY)/u.test(code)) return 4;
  if (
    error instanceof ProjectError
    || error instanceof IngestionError
    || error instanceof SourceAdapterError
    || error instanceof CommanderError
    || error instanceof SyntaxError
    || code.endsWith("_INVALID")
    || code.endsWith("_NOT_FOUND")
    || code.startsWith("EVIDENCE_")
  ) return 2;
  return 5;
}

export function machineError(error: unknown): string {
  const coded = error as CodedError;
  return canonicalJson({
    ok: false,
    code: coded.code ?? (error instanceof SyntaxError ? "JSON_INVALID" : "INTERNAL_ERROR"),
    message: error instanceof Error ? error.message : String(error),
    diagnostics: coded.diagnostics ?? [],
  });
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(machineError(error));
    process.exitCode = cliErrorCode(error);
  });
}
