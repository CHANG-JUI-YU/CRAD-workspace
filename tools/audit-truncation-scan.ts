import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEFAULT_SCAN_DIRECTORY = "projects";
export const DEFAULT_MAX_DEPTH = 4;
export const SCAN_EXIT_OK = 0;
export const SCAN_EXIT_FAILURE = 1;
export const SCAN_EXIT_USAGE = 2;

interface AuditEvent {
  event?: unknown;
}

interface ProjectState {
  audit?: unknown;
  project_name?: unknown;
  project_id?: unknown;
}

export type ScanIssueKind = "input_missing" | "input_not_directory" | "empty" | "unreadable" | "invalid_json" | "invalid_state" | "truncated";

export interface ScanIssue {
  readonly kind: ScanIssueKind;
  readonly path?: string;
  readonly message: string;
}

export interface TruncationScanSummary {
  readonly root: string;
  readonly stateFiles: readonly string[];
  readonly messages: readonly string[];
  readonly clean: number;
  readonly truncated: number;
  readonly suspicious: number;
  readonly issues: readonly ScanIssue[];
  readonly allowEmpty: boolean;
}

export interface ScanOptions {
  readonly allowEmpty?: boolean;
  readonly maxDepth?: number;
}

export interface ScannerCliOptions {
  readonly directory: string;
  readonly allowEmpty: boolean;
}

export class ScannerUsageError extends Error {
  readonly exitCode = SCAN_EXIT_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "ScannerUsageError";
  }
}

export class ScannerInputError extends Error {
  readonly exitCode = SCAN_EXIT_FAILURE;
  readonly kind: "input_missing" | "input_not_directory";

  constructor(kind: "input_missing" | "input_not_directory", message: string) {
    super(message);
    this.name = "ScannerInputError";
    this.kind = kind;
  }
}

const interviewEvents = new Set([
  "interview.started",
  "interview.answer.recorded",
  "blueprint.precheck.recorded",
  "operation.created",
  "workflow.answer_interview",
  "blueprint.revision.proposed",
  "source.candidates_registered",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return isRecord(value) && (value.event === undefined || typeof value.event === "string");
}

function describeProject(state: ProjectState): string {
  const projectName = typeof state.project_name === "string" ? state.project_name : undefined;
  const projectId = typeof state.project_id === "string" ? state.project_id : undefined;
  return projectName ?? projectId ?? "unknown";
}

export async function findStateFiles(directory: string, depth = 0, maxDepth = DEFAULT_MAX_DEPTH): Promise<string[]> {
  if (depth > maxDepth) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findStateFiles(fullPath, depth + 1, maxDepth));
    } else if (entry.isFile() && entry.name === "state.json") {
      results.push(fullPath);
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

async function validateScanRoot(directory: string): Promise<void> {
  let details;
  try {
    details = await stat(directory);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ScannerInputError("input_missing", `TRUNCATION_SCAN_INPUT_MISSING: scan directory does not exist: ${directory} (${reason})`);
  }
  if (!details.isDirectory()) {
    throw new ScannerInputError("input_not_directory", `TRUNCATION_SCAN_INPUT_NOT_DIRECTORY: scan path is not a directory: ${directory}`);
  }
}

function classifyState(stateFile: string, parsed: unknown): { kind: "clean" | "truncated" | "invalid"; issue?: ScanIssue; label: string } {
  if (!isRecord(parsed)) {
    return {
      kind: "invalid",
      label: "unknown",
      issue: { kind: "invalid_state", path: stateFile, message: `INVALID_STATE ${stateFile}: root JSON value must be an object` },
    };
  }
  const state = parsed as ProjectState;
  if (state.audit !== undefined && (!Array.isArray(state.audit) || !state.audit.every(isAuditEvent))) {
    return {
      kind: "invalid",
      label: describeProject(state),
      issue: { kind: "invalid_state", path: stateFile, message: `INVALID_STATE ${stateFile}: audit must be an array of event objects` },
    };
  }
  const audit = (state.audit ?? []) as AuditEvent[];
  const firstConfirmed = audit.findIndex((event) => event.event === "blueprint.precheck.confirmed");
  const label = `${stateFile} (${describeProject(state)}, audit=${audit.length})`;
  if (firstConfirmed === -1) {
    return { kind: "clean", label };
  }
  const before = audit.slice(0, firstConfirmed);
  const hasHistory = before.some((event) => typeof event.event === "string" && interviewEvents.has(event.event));
  if (firstConfirmed === 0 || (firstConfirmed === 1 && before[0]?.event === "blueprint.created") || !hasHistory) {
    return {
      kind: "truncated",
      label,
      issue: {
        kind: "truncated",
        path: stateFile,
        message: `TRUNCATED ${label} - audit history before precheck.confirmed was replaced (first events: ${before.map((event) => typeof event.event === "string" ? event.event : "unknown").join(", ") || "none"})`,
      },
    };
  }
  return { kind: "clean", label };
}

export async function scanTruncationDirectory(directory: string, options: ScanOptions = {}): Promise<TruncationScanSummary> {
  const root = path.resolve(directory);
  await validateScanRoot(root);
  const stateFiles = await findStateFiles(root, 0, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const issues: ScanIssue[] = [];
  const messages: string[] = [];
  let clean = 0;
  let truncated = 0;

  if (stateFiles.length === 0 && options.allowEmpty !== true) {
    issues.push({ kind: "empty", path: root, message: `EMPTY_SCAN ${root}: no state.json files found; pass --allow-empty only when an empty scan is intentional` });
  }

  for (const stateFile of stateFiles) {
    let contents: string;
    try {
      contents = await readFile(stateFile, "utf8");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({ kind: "unreadable", path: stateFile, message: `UNREADABLE ${stateFile}: ${reason}` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({ kind: "invalid_json", path: stateFile, message: `INVALID_JSON ${stateFile}: ${reason}` });
      continue;
    }
    const result = classifyState(stateFile, parsed);
    if (result.kind === "clean") {
      messages.push(`CLEAN    ${result.label}`);
      clean += 1;
    } else if (result.kind === "truncated") {
      truncated += 1;
      if (result.issue !== undefined) {
        messages.push(result.issue.message);
        issues.push(result.issue);
      } else {
        messages.push(result.label);
      }
    } else if (result.issue !== undefined) {
      issues.push(result.issue);
    }
  }

  return { root, stateFiles, messages, clean, truncated, suspicious: 0, issues, allowEmpty: options.allowEmpty === true };
}

export function formatScannerHelp(): string {
  return [
    "Usage: pnpm audit:truncation -- [directory] [--allow-empty]",
    "",
    `Default directory: ${DEFAULT_SCAN_DIRECTORY} (relative to the current working directory)`,
    "--allow-empty     explicitly allow a directory with zero state.json files",
    "-h, --help        show this help",
    "",
    "Exit codes:",
    "  0  scan completed with no truncation or invalid input",
    "  1  input/JSON/state error or at least one truncated state was found",
    "  2  invalid command-line usage",
  ].join("\n") + "\n";
}

export function parseScannerArgs(args: readonly string[]): ScannerCliOptions | { help: true } {
  let directory: string | undefined;
  let allowEmpty = false;
  let endOptions = false;
  for (const argument of args) {
    if (!endOptions && argument === "--") {
      endOptions = true;
      continue;
    }
    if (!endOptions && (argument === "-h" || argument === "--help")) return { help: true };
    if (!endOptions && argument === "--allow-empty") {
      allowEmpty = true;
      continue;
    }
    if (!endOptions && argument.startsWith("-")) throw new ScannerUsageError(`unknown option: ${argument}`);
    if (directory !== undefined) throw new ScannerUsageError(`expected one scan directory, received both "${directory}" and "${argument}"`);
    directory = argument;
  }
  return { directory: directory ?? DEFAULT_SCAN_DIRECTORY, allowEmpty };
}

export interface ScannerIo {
  readonly out: (message: string) => void;
  readonly err: (message: string) => void;
}

export async function runTruncationScanner(argv: readonly string[], io: ScannerIo = { out: console.log, err: console.error }): Promise<number> {
  try {
    const parsed = parseScannerArgs(argv);
    if ("help" in parsed) {
      io.out(formatScannerHelp());
      return SCAN_EXIT_OK;
    }
    const summary = await scanTruncationDirectory(parsed.directory, { allowEmpty: parsed.allowEmpty });
    for (const message of summary.messages) io.out(message);
    for (const issue of summary.issues) io.err(issue.message);
    io.out(`\nScanned ${summary.stateFiles.length} state files: ${summary.clean} clean, ${summary.truncated} truncated, ${summary.suspicious} suspicious`);
    return summary.issues.length > 0 ? SCAN_EXIT_FAILURE : SCAN_EXIT_OK;
  } catch (error) {
    if (error instanceof ScannerUsageError) {
      io.err(`${error.message}\n\n${formatScannerHelp()}`);
      return error.exitCode;
    }
    if (error instanceof ScannerInputError) {
      io.err(error.message);
      return error.exitCode;
    }
    io.err(`TRUNCATION_SCAN_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    return SCAN_EXIT_FAILURE;
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = await runTruncationScanner(process.argv.slice(2));
