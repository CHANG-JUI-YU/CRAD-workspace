import type { WorkflowEntryKind, WorkflowStage } from "@card-workspace/schemas";

export type WorkflowGateId = "facts" | "blueprint" | "content" | "publish";

export const WORKFLOW_STAGE_ORDER = [
  "intake",
  "source_processing",
  "facts_review",
  "blueprint",
  "pre_world_authoring",
  "pre_world_review",
  "authoring",
  "semantic_review",
  "post_world_authoring",
  "post_world_review",
  "greetings_authoring",
  "plugin_mvu_authoring",
  "plugin_mvu_review",
  "plugin_ejs_authoring",
  "plugin_ejs_review",
  "plugin_html_authoring",
  "plugin_html_review",
  "content_review",
  "compile_preview",
  "publish_review",
  "published",
] as const satisfies readonly WorkflowStage[];

export const WORKFLOW_GATE_ORDER = ["facts", "blueprint", "content", "publish"] as const satisfies readonly WorkflowGateId[];

export interface WorkflowDefinition {
  id: string;
  entryKind: WorkflowEntryKind;
  stages: readonly WorkflowStage[];
  optionalStages: readonly WorkflowStage[];
  optionalGates: readonly WorkflowGateId[];
}

const definitions: Record<WorkflowEntryKind, WorkflowDefinition> = {
  original: {
    id: "original-v1",
    entryKind: "original",
    stages: WORKFLOW_STAGE_ORDER,
    optionalStages: ["source_processing", "facts_review"],
    optionalGates: ["facts"],
  },
  source_adaptation: {
    id: "source-adaptation-v1",
    entryKind: "source_adaptation",
    stages: WORKFLOW_STAGE_ORDER,
    optionalStages: [],
    optionalGates: [],
  },
  card_import: {
    id: "card-import-v1",
    entryKind: "card_import",
    stages: WORKFLOW_STAGE_ORDER,
    optionalStages: ["source_processing"],
    optionalGates: [],
  },
  mode_conversion: {
    id: "mode-conversion-v1",
    entryKind: "mode_conversion",
    stages: WORKFLOW_STAGE_ORDER,
    optionalStages: ["source_processing"],
    optionalGates: [],
  },
};

export function getWorkflowDefinition(entryKind: WorkflowEntryKind): WorkflowDefinition {
  return definitions[entryKind];
}

export function getNextStage(stage: WorkflowStage): WorkflowStage | undefined {
  const index = WORKFLOW_STAGE_ORDER.indexOf(stage);
  return WORKFLOW_STAGE_ORDER[index + 1];
}

export function gateRequiredBeforeStage(stage: WorkflowStage): WorkflowGateId | undefined {
  if (stage === "blueprint") return "facts";
  if (stage === "pre_world_authoring" || stage === "authoring") return "blueprint";
  if (stage === "compile_preview") return "content";
  if (stage === "published") return "publish";
  return undefined;
}

export function artifactsRequiredBeforeStage(stage: WorkflowStage): readonly string[] {
  if (stage === "pre_world_authoring" || stage === "authoring") return ["blueprint"];
  if (stage === "compile_preview") return ["content"];
  if (stage === "published") return ["compile-preview"];
  return [];
}
