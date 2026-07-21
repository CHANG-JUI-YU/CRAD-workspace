import {
  blueprintSchema,
  characterDocumentSchema,
  greetingsDocumentSchema,
  paletteModuleSchema,
  proposalSchema,
  relationshipsDocumentSchema,
  worldEntrySchema,
  zhujiModuleSchema,
  type Proposal,
  type ProvenanceRef,
} from "@card-workspace/schemas";
import { computeRevision, type LoadedAuthorProject } from "@card-workspace/project";

import { workflowFail } from "./errors.js";
import { deriveProposalTargets, type ProposalTarget } from "./proposal-ownership.js";
import type { WorkflowTask } from "@card-workspace/schemas";

function collectFactRefs(value: unknown, refs: Array<{ id: string; single: boolean }> = []): Array<{ id: string; single: boolean }> {
  if (Array.isArray(value)) {
    for (const item of value) collectFactRefs(item, refs);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "fact" && typeof record.ref === "string") {
      const ref = record as unknown as ProvenanceRef & { requires_single_value?: boolean };
      refs.push({ id: record.ref, single: ref.requires_single_value ?? false });
    }
    if (Array.isArray(record.fact_refs)) {
      for (const id of record.fact_refs) if (typeof id === "string") refs.push({ id, single: false });
    }
    for (const item of Object.values(record)) collectFactRefs(item, refs);
  }
  return refs;
}

function validateTargetSchema(target: ProposalTarget): void {
  const path = target.relativePath;
  const schema = path === "blueprint.yaml"
    ? blueprintSchema
    : path === "greetings.yaml"
      ? greetingsDocumentSchema
      : path === "relationships.yaml"
        ? relationshipsDocumentSchema
      : path.endsWith("/character.yaml")
        ? characterDocumentSchema
        : path.includes("/zhuji/")
          ? zhujiModuleSchema
          : path.includes("/palette/")
            ? paletteModuleSchema
            : worldEntrySchema;
  const parsed = schema.safeParse(target.value);
  if (!parsed.success) workflowFail("PROPOSAL_AUTHOR_SCHEMA_INVALID", `${path} 不符合正式作者 schema`, parsed.error);
}

export function validateProposal(options: {
  task: WorkflowTask;
  proposal: unknown;
  project: LoadedAuthorProject;
}): { proposal: Proposal; targets: ProposalTarget[] } {
  const parsed = proposalSchema.safeParse(options.proposal);
  if (!parsed.success) workflowFail("PROPOSAL_SCHEMA_INVALID", "proposal schema 無效", parsed.error);
  const proposal = parsed.data;
  if (!options.project.workflow || proposal.base_workflow_revision !== options.project.workflow.revision) {
    workflowFail("PROPOSAL_WORKFLOW_REVISION_CONFLICT", "proposal base workflow revision 已過期");
  }
  const targets = deriveProposalTargets(options.task, proposal, options.project);
  targets.forEach(validateTargetSchema);

  const characterIds = new Set(options.project.manifest?.characters.map((item) => item.id) ?? []);
  const proposedWorld = proposal.value.kind === "world" ? proposal.value.entries.map((item) => item.id) : [];
  const worldIds = new Set([...options.project.world.map((item) => item.id), ...proposedWorld]);
  if (proposal.value.kind === "blueprint") {
    if (proposal.value.document.project_id !== options.project.manifest?.id) workflowFail("PROPOSAL_PROJECT_ID_MISMATCH", "Blueprint project_id 不符");
    if (proposal.value.document.collaboration_mode !== options.project.blueprint?.collaboration_mode) {
      workflowFail("PROPOSAL_COLLABORATION_MODE_MISMATCH", "Blueprint collaboration_mode 不得改變初始化決定");
    }
    if (proposal.value.document.collaboration_mode === "assisted") {
      if (!options.task.blueprint_precheck) workflowFail("BLUEPRINT_PRECHECK_REQUIRED", "協助創作模式必須先保存 Blueprint 預檢紀錄");
      if (options.task.blueprint_precheck.candidate_blueprint_revision !== computeRevision(proposal.value.document)) {
        workflowFail("BLUEPRINT_PRECHECK_REVISION_MISMATCH", "Blueprint proposal 與已預檢候選版本不一致");
      }
    }
    for (const character of proposal.value.document.characters) {
      if (!characterIds.has(character.id)) workflowFail("PROPOSAL_REFERENCE_MISSING", `Blueprint 找不到角色：${character.id}`);
    }
  }
  if (proposal.value.kind === "character") {
    const document = proposal.value.document;
    const manifestCharacter = options.project.manifest?.characters.find((item) => item.id === document.id);
    if (manifestCharacter?.display_name !== document.display_name) workflowFail("PROPOSAL_CHARACTER_NAME_MISMATCH", "角色顯示名稱與 manifest 不符");
    for (const relationship of document.relationships) {
      if (!characterIds.has(relationship.target_id)) workflowFail("PROPOSAL_REFERENCE_MISSING", `找不到關係角色：${relationship.target_id}`);
    }
  }
  if (proposal.value.kind === "greetings") {
    for (const greeting of proposal.value.document.greetings) {
      for (const id of greeting.character_ids) if (!characterIds.has(id)) workflowFail("PROPOSAL_REFERENCE_MISSING", `找不到 greeting 角色：${id}`);
    }
  }
  if (proposal.value.kind === "relationships") {
    const blueprintRelationships = options.project.blueprint?.relationships;
    if (!blueprintRelationships?.enabled) workflowFail("PROPOSAL_RELATIONSHIPS_DISABLED", "Blueprint 未啟用 relationships");
    const expected = blueprintRelationships.character_ids;
    const actual = proposal.value.document.character_ids;
    if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
      workflowFail("PROPOSAL_RELATIONSHIPS_PARTICIPANTS_MISMATCH", "relationships participants 必須與 Blueprint 完全一致");
    }
    const taskParticipants = options.task.extensions.participant_ids;
    if (!Array.isArray(taskParticipants) || taskParticipants.length !== expected.length
      || taskParticipants.some((id, index) => id !== expected[index])) {
      workflowFail("PROPOSAL_RELATIONSHIPS_TASK_SCOPE_MISMATCH", "relationships task participant scope 必須與 Blueprint 完全一致");
    }
    const current = options.project.relationships;
    if (current && current.team_code !== proposal.value.document.team_code) {
      workflowFail("PROPOSAL_RELATIONSHIPS_TEAM_CODE_CHANGED", "relationships revision 必須保留 team_code");
    }
  }
  if (proposal.value.kind === "world") {
    for (const entry of proposal.value.entries) {
      for (const id of entry.related_ids) {
        if (!characterIds.has(id) && !worldIds.has(id)) workflowFail("PROPOSAL_REFERENCE_MISSING", `找不到世界設定引用：${id}`);
      }
    }
  }

  const facts = new Map(options.project.factRegister?.facts.map((fact) => [fact.id, fact]) ?? []);
  const openConflicts = options.project.conflictRegister?.conflicts.filter((item) => item.status === "open") ?? [];
  for (const ref of collectFactRefs(proposal.value)) {
    const fact = facts.get(ref.id);
    if (!fact || fact.status !== "accepted") workflowFail("PROPOSAL_FACT_NOT_ACCEPTED", `fact ${ref.id} 不存在或未 accepted`);
    if (fact.classification !== "creative_completion" && fact.evidence.length === 0) {
      workflowFail("PROPOSAL_FACT_EVIDENCE_INCOMPLETE", `fact ${ref.id} 缺少 evidence`);
    }
    if (ref.single && openConflicts.some((conflict) => conflict.members.some((member) => member.fact_id === ref.id))) {
      workflowFail("PROPOSAL_FACT_CONFLICT_UNRESOLVED", `single-value fact ${ref.id} 尚有 unresolved conflict`);
    }
  }
  return { proposal, targets };
}
