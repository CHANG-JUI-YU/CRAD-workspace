import { ProjectError } from "./errors.js";

export const workflowProjectionFile = "workflow.json";
export const blueprintFile = "blueprint.yaml";
export const workflowJournalFile = ".workflow/journal.jsonl";

const safeSegment = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
const workflowPathPatterns = [
  ["journal", /^\.workflow\/journal\.jsonl$/u],
  ["result", new RegExp(`^\\.workflow/results/${safeSegment}/${safeSegment}\\.json$`, "u")],
  ["review", new RegExp(`^\\.workflow/reviews/${safeSegment}/${safeSegment}\\.json$`, "u")],
  ["preview", new RegExp(`^\\.workflow/previews/${safeSegment}\\.json$`, "u")],
  ["decision", new RegExp(`^\\.workflow/decisions/${safeSegment}\\.json$`, "u")],
  ["plugin_token", new RegExp(`^\\.workflow/plugin-review-tokens/[a-f0-9]{64}\\.json$`, "u")],
  ["plugin_selection", /^\\.workflow\/plugin-selection\.yaml$/u],
  ["plugin_artifact", new RegExp(`^\\.workflow/plugin-artifacts/${safeSegment}\\.json$`, "u")],
] as const;

export type WorkflowPathKind = (typeof workflowPathPatterns)[number][0];

export interface WorkflowProjectPath {
  relativePath: string;
  kind: WorkflowPathKind;
}

export function classifyWorkflowProjectPath(relativePath: string): WorkflowProjectPath | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  const match = workflowPathPatterns.find(([, pattern]) => pattern.test(normalized));
  return match ? { relativePath: normalized, kind: match[0] } : undefined;
}

export function assertWorkflowProjectPath(relativePath: string): WorkflowProjectPath {
  const classified = classifyWorkflowProjectPath(relativePath);
  if (!classified) {
    throw new ProjectError(
      "WORKFLOW_TARGET_DENIED",
      `workflow 僅允許存取受控 artifacts：${relativePath}`,
    );
  }
  return classified;
}
