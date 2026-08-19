import { resolveProjectDirectory } from "../project-id.js";
import type { FileProjectRepositoryOptions } from "./project-repository.js";
import { FileProjectRepository as RepositoryImplementation } from "./repository-implementation.js";

/**
 * Durable adapter boundary. Validate project identity before the shared
 * implementation derives state/blob/materialization paths, and repeat the
 * same canonical check before relocation changes identity.
 */
export class FileProjectRepository extends RepositoryImplementation {
  constructor(projectRoot: string, projectId: string, options: FileProjectRepositoryOptions = {}) {
    resolveProjectDirectory(projectRoot, projectId);
    super(projectRoot, projectId, options);
  }

  override async relocate(newProjectId: string): Promise<void> {
    resolveProjectDirectory(this.projectDirectory === undefined ? "." : this.projectDirectory, newProjectId);
    await super.relocate(newProjectId);
  }
}
