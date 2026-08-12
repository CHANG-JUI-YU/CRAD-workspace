import type { ProjectRepository, RepairInspection, RepairReport } from "./project-repository.js";

/** Repair boundary used by callers that do not need to know the repository implementation. */
export function inspectRepositoryRepair(repository: ProjectRepository): Promise<RepairInspection> {
  return repository.inspectRepair();
}

export function runRepositoryRepair(repository: ProjectRepository, planHash?: string): Promise<RepairReport> {
  return repository.runRepair(planHash);
}
