import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import { computeProjectProjection } from "../src/project-projection.js";
import { createProjectState, validateState } from "../src/project-state.js";
import { projectStateSchema } from "../src/project-state-schema.js";
import { FileProjectRepository } from "../src/repository/file-project-repository.js";
import { MemoryProjectRepository } from "../src/repository/memory-project-repository.js";

describe("core module boundaries", () => {
  it("keeps the public barrel as a compatibility boundary", () => {
    const state = createProjectState("boundary");
    expect(core.createProjectState).toBe(createProjectState);
    expect(core.computeProjectProjection).toBe(computeProjectProjection);
    expect(core.MemoryProjectRepository).toBe(MemoryProjectRepository);
    expect(core.FileProjectRepository).toBe(FileProjectRepository);
    expect(projectStateSchema.parse(state).project_id).toBe("boundary");
    expect(validateState(state)).toEqual(state);
  });
});
