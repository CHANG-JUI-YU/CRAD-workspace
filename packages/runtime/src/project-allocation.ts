import { mkdir } from "node:fs/promises";
import { CoreError, resolveProjectDirectory } from "@st-workspace/core";

const MAX_PROJECT_SEQUENCE = 999_999;

export interface ProjectDirectoryReservation {
  readonly project_id: string;
  readonly project_directory: string;
}

export function numberedProjectId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_PROJECT_SEQUENCE) {
    throw new CoreError("PROJECT_ALLOCATION_SEQUENCE_INVALID", `Invalid project allocation sequence: ${sequence}`, true);
  }
  return `project-${String(sequence).padStart(3, "0")}`;
}

/**
 * Reserve the first available numbered project directory atomically.
 *
 * `mkdir(candidate)` is the ownership operation: across managers and processes
 * exactly one caller can create a given candidate. EEXIST means the candidate
 * is already owned, regardless of whether it contains valid state, corrupt
 * state, or only an interrupted reservation. We never delete or adopt such a
 * directory; the allocator advances deterministically to the next id.
 */
export async function reserveNextProjectDirectory(projectRoot: string): Promise<ProjectDirectoryReservation> {
  await mkdir(projectRoot, { recursive: true });
  for (let sequence = 1; sequence <= MAX_PROJECT_SEQUENCE; sequence += 1) {
    const projectId = numberedProjectId(sequence);
    const projectDirectory = resolveProjectDirectory(projectRoot, projectId);
    try {
      await mkdir(projectDirectory);
      return { project_id: projectId, project_directory: projectDirectory };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new CoreError(
    "PROJECT_ALLOCATION_EXHAUSTED",
    `No project id is available below ${projectRoot}`,
    true,
    { max_sequence: MAX_PROJECT_SEQUENCE },
  );
}
