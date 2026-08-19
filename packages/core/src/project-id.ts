import path from "node:path";
import { CoreError } from "./core-utilities.js";

const WINDOWS_RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/u;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/u;
const MAX_PORTABLE_SEGMENT_LENGTH = 255;

function invalidProjectId(projectId: string, reason: string): never {
  throw new CoreError(
    "PROJECT_ID_INVALID",
    `project id must be a portable single path segment: ${reason}`,
    true,
    { project_id: projectId, reason },
  );
}

/**
 * Validate a project id before it participates in any filesystem path.
 *
 * The policy deliberately uses the Windows filename superset on every OS so a
 * project created on Linux remains safe to open on Windows. Valid Unicode and
 * ordinary slug punctuation remain supported; path separators, dot segments,
 * control characters, Windows device names/forbidden characters, and trailing
 * spaces or periods are rejected rather than normalized silently.
 */
export function assertProjectId(projectId: string): string {
  if (projectId.length === 0 || projectId.trim().length === 0) {
    return invalidProjectId(projectId, "value is empty");
  }
  if (projectId === "." || projectId === "..") {
    return invalidProjectId(projectId, "dot segments are not allowed");
  }
  if (projectId.includes("/") || projectId.includes("\\")) {
    return invalidProjectId(projectId, "path separators are not allowed");
  }
  if (projectId.length > MAX_PORTABLE_SEGMENT_LENGTH) {
    return invalidProjectId(projectId, `segment exceeds ${MAX_PORTABLE_SEGMENT_LENGTH} characters`);
  }
  if (CONTROL_CHARACTER.test(projectId)) {
    return invalidProjectId(projectId, "control characters are not allowed");
  }
  if (WINDOWS_FORBIDDEN.test(projectId)) {
    return invalidProjectId(projectId, "Windows-forbidden filename characters are not allowed");
  }
  if (/[. ]$/u.test(projectId)) {
    return invalidProjectId(projectId, "trailing spaces or periods are not portable");
  }
  if (WINDOWS_RESERVED_DEVICE.test(projectId)) {
    return invalidProjectId(projectId, "Windows reserved device names are not allowed");
  }
  return projectId;
}

/** Resolve a validated project directory and prove that it remains below root. */
export function resolveProjectDirectory(projectRoot: string, projectId: string): string {
  const validated = assertProjectId(projectId);
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedProject = path.resolve(resolvedRoot, validated);
  const relative = path.relative(resolvedRoot, resolvedProject);
  if (
    relative.length === 0
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    return invalidProjectId(projectId, "resolved path escapes or aliases the project root");
  }
  return resolvedProject;
}
