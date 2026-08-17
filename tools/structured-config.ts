import { readFile } from "node:fs/promises";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parseDocument } from "yaml";

export class StructuredConfigError extends Error {
  constructor(
    readonly filePath: string,
    readonly format: "JSONC" | "YAML",
    message: string,
    readonly causeValue?: unknown,
  ) {
    super(`${filePath}: invalid ${format}: ${message}`);
    this.name = "StructuredConfigError";
  }
}

function jsoncErrorMessage(error: ParseError): string {
  return printParseErrorCode(error.error);
}

export function parseJsoncText<T = unknown>(contents: string, filePath: string): T {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(contents, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new StructuredConfigError(filePath, "JSONC", errors.map(jsoncErrorMessage).join(", "));
  }
  return parsed as T;
}

export function parseYamlText<T = unknown>(contents: string, filePath: string): T {
  const document = parseDocument(contents, { prettyErrors: false });
  if (document.errors.length > 0) {
    throw new StructuredConfigError(filePath, "YAML", document.errors.map((error) => error.message).join(", "));
  }
  try {
    return document.toJS() as T;
  } catch (error) {
    throw new StructuredConfigError(filePath, "YAML", error instanceof Error ? error.message : String(error), error);
  }
}

export async function parseJsoncFile<T = unknown>(filePath: string): Promise<T> {
  return parseJsoncText<T>(await readFile(filePath, "utf8"), filePath);
}

export async function parseYamlFile<T = unknown>(filePath: string): Promise<T> {
  return parseYamlText<T>(await readFile(filePath, "utf8"), filePath);
}
