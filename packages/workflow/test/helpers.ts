import { workflowStateSchema, type WorkflowState } from "@card-workspace/schemas";

export const REVISION_A = `sha256:${"a".repeat(64)}`;
export const REVISION_B = `sha256:${"b".repeat(64)}`;

export function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return workflowStateSchema.parse({
    schema_version: 2,
    project_id: "project-a",
    workflow_definition_id: "original-v1",
    entry_kind: "original",
    stage: "intake",
    revision: 0,
    artifacts: [],
    gates: ["facts", "blueprint", "content", "publish"].map((id) => ({
      id,
      status: "pending",
      input_revisions: [],
      extensions: {},
    })),
    tasks: [],
    decisions: [],
    extensions: {},
    ...overrides,
  });
}
