import {
  paletteModuleFiles,
  zhujiModuleFiles,
  type LoadedAuthorProject,
} from "@card-workspace/project";
import type { Proposal, WorkflowTask } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";

export interface ProposalTarget {
  relativePath: string;
  value: unknown;
}

function modulePath(characterId: string, mode: "zhuji" | "palette", kind: string): string {
  const file = (mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles).find((item) => item.kind === kind)?.file;
  if (!file) workflowFail("PROPOSAL_MODULE_UNKNOWN", `模式 ${mode} 不包含模組 ${kind}`);
  return `characters/${characterId}/${mode}/${file}`;
}

export function deriveProposalTargets(
  task: WorkflowTask,
  proposal: Proposal,
  project: Pick<LoadedAuthorProject, "manifest">,
): ProposalTarget[] {
  if (!project.manifest) workflowFail("PROPOSAL_PROJECT_INVALID", "專案 manifest 不可用");
  if (task.output_contract !== "proposal@1") workflowFail("PROPOSAL_TASK_CONTRACT_MISMATCH", `task output contract 是 ${task.output_contract}`);
  if (task.assigned_agent !== proposal.owner) workflowFail("PROPOSAL_OWNER_MISMATCH", "proposal owner 必須是 task assigned agent");
  if (task.assigned_agent.includes("critic") || task.capabilities.some((item) => item.includes("review"))) {
    workflowFail("PROPOSAL_CRITIC_READ_ONLY", "Critic 不得修改作者文件");
  }
  const value = proposal.value;
  const declaredKind = task.extensions.output_kind;
  if (typeof declaredKind === "string" && declaredKind !== value.kind) {
    workflowFail("PROPOSAL_OUTPUT_KIND_MISMATCH", `task 只允許 ${declaredKind}，proposal 是 ${value.kind}`);
  }
  const ownedCharacter = task.extensions.character_id;
  const valueCharacter = "character_id" in value ? value.character_id : value.kind === "character" ? value.document.id : undefined;
  if (typeof ownedCharacter === "string" && valueCharacter !== ownedCharacter) {
    workflowFail("PROPOSAL_CHARACTER_OWNERSHIP_DENIED", `task 只擁有角色 ${ownedCharacter}`);
  }
  if (value.kind === "blueprint") return [{ relativePath: "blueprint.yaml", value: value.document }];
  if (value.kind === "character") {
    const character = project.manifest.characters.find((item) => item.id === value.document.id);
    if (!character) workflowFail("PROPOSAL_CHARACTER_UNKNOWN", `找不到 task 角色：${value.document.id}`);
    return [{ relativePath: `characters/${character.id}/character.yaml`, value: value.document }];
  }
  if (value.kind === "zhuji" || value.kind === "palette") {
    const character = project.manifest.characters.find((item) => item.id === value.character_id);
    if (!character) workflowFail("PROPOSAL_CHARACTER_UNKNOWN", `找不到 task 角色：${value.character_id}`);
    if (character.mode !== value.kind) workflowFail("PROPOSAL_MODE_MISMATCH", `角色 active mode 是 ${character.mode}，不可寫 ${value.kind}`);
    const ownedModule = task.extensions.module;
    if (typeof ownedModule === "string" && value.module.module !== ownedModule) {
      workflowFail("PROPOSAL_MODULE_OWNERSHIP_DENIED", `task 只擁有模組 ${ownedModule}`);
    }
    return [{ relativePath: modulePath(character.id, value.kind, value.module.module), value: value.module }];
  }
  if (value.kind === "world") {
    const category = task.extensions.world_category;
    if (typeof category === "string" && value.entries.some((entry) => entry.category !== category)) {
      workflowFail("PROPOSAL_WORLD_OWNERSHIP_DENIED", `task 只擁有 world/${category}`);
    }
    const entryId = task.extensions.world_entry_id;
    if (typeof entryId === "string" && (value.entries.length !== 1 || value.entries[0]?.id !== entryId)) {
      workflowFail("PROPOSAL_WORLD_OWNERSHIP_DENIED", `task 只擁有 world entry ${entryId}`);
    }
    return value.entries.map((entry) => ({ relativePath: `world/${entry.category}/${entry.id}.yaml`, value: entry }));
  }
  if (value.kind === "greetings") return [{ relativePath: "greetings.yaml", value: value.document }];
  if (value.kind === "relationships") {
    if (task.assigned_agent !== "relationship-creator" || task.extensions.output_kind !== "relationships") {
      workflowFail("PROPOSAL_RELATIONSHIPS_OWNERSHIP_DENIED", "relationships.yaml 只允許 relationship-creator 的 relationships task 寫入");
    }
    return [{ relativePath: "relationships.yaml", value: value.document }];
  }
  if (value.kind === "conversion") workflowFail("PROPOSAL_CONVERSION_SERVICE_REQUIRED", "conversion 必須由 mode conversion service 套用");
  if (value.kind === "import_analysis") return [];
  return [];
}
