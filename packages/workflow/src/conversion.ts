import { readFile } from "node:fs/promises";

import {
  canonicalYaml,
  computeTextRevision,
  legacyZhujiModuleFiles,
  loadAuthorProject,
  orderedYaml,
  paletteModuleFiles,
  prepareModeHistoryArchive,
  resolveExistingWithin,
  resolveWithin,
  zhujiModuleFiles,
  type ModeHistoryReport,
  type TransactionOperation,
} from "@card-workspace/project";
import { proposalSchema, workflowStateSchema, type Revision } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";
import { commitWorkflowMutation } from "./repository.js";

export interface ApplyModeConversionOptions {
  projectsRoot: string;
  projectId: string;
  taskId: string;
  proposal: unknown;
  eventId: string;
  occurredAt: string;
  expectedTargetRevisions: Record<string, Revision>;
  expectedSemanticLoss?: string[];
}

function provenanceRefs(value: unknown): Array<{ id: string; single: boolean }> {
  const refs = new Map<string, boolean>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (item === null || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (record.kind === "fact" && typeof record.ref === "string") {
      refs.set(record.ref, refs.get(record.ref) === true || record.requires_single_value === true);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...refs].sort(([left], [right]) => left.localeCompare(right)).map(([id, single]) => ({ id, single }));
}

export async function applyModeConversion(options: ApplyModeConversionOptions) {
  const loaded = await loadAuthorProject(options.projectsRoot, options.projectId);
  if (!loaded.ok || !loaded.workflow || !loaded.manifest) workflowFail("CONVERSION_PROJECT_INVALID", "轉換前專案必須完整有效");
  const task = loaded.workflow.tasks.find((item) => item.id === options.taskId);
  if (!task || ["failed", "superseded", "needs_user_decision"].includes(task.status)) workflowFail("CONVERSION_TASK_STALE", `task ${options.taskId} 已失效`);
  const parsed = proposalSchema.safeParse(options.proposal);
  if (!parsed.success) workflowFail("CONVERSION_PROPOSAL_INVALID", "需要 conversion proposal", parsed.error);
  const proposal = parsed.data;
  const value = proposal.value;
  if (value.kind !== "conversion") workflowFail("CONVERSION_PROPOSAL_INVALID", "需要 conversion proposal");
  if (proposal.owner !== task.assigned_agent) workflowFail("PROPOSAL_OWNER_MISMATCH", "proposal owner 必須是 task assigned agent");
  if (task.output_contract !== "proposal@1") workflowFail("PROPOSAL_TASK_CONTRACT_MISMATCH", `task output contract 是 ${task.output_contract}`);
  if (task.assigned_agent.includes("critic")) workflowFail("PROPOSAL_CRITIC_READ_ONLY", "Critic 不得執行模式轉換");
  if (proposal.base_workflow_revision !== loaded.workflow.revision) workflowFail("PROPOSAL_WORKFLOW_REVISION_CONFLICT", "conversion base workflow revision 已過期");
  const character = loaded.manifest.characters.find((item) => item.id === value.character_id);
  if (!character || character.mode !== value.source_mode) workflowFail("CONVERSION_SOURCE_MODE_STALE", "角色 active mode 與 conversion source 不符");
  const targetLayout = value.target_mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
  const expectedKinds = targetLayout.map((item) => item.kind).sort();
  const actualKinds = value.modules.map((item) => item.module).sort();
  if (JSON.stringify(expectedKinds) !== JSON.stringify(actualKinds)) {
    workflowFail("CONVERSION_TARGET_INCOMPLETE", `目標模式必須一次提供全部 ${targetLayout.length} 個固定模組`);
  }
  const sourceCharacter = loaded.characters.find((item) => item.manifest.id === character.id);
  const sourceLayout = value.source_mode === "zhuji"
    ? sourceCharacter?.modules.some((module) => module.module === "expanded_extension")
      ? legacyZhujiModuleFiles
      : zhujiModuleFiles
    : paletteModuleFiles;
  const mappedSources = new Set(value.mappings.map((item) => item.source.replaceAll("_", "-")));
  const unmapped = sourceLayout.filter((item) => !mappedSources.has(item.kind.replaceAll("_", "-")));
  if (unmapped.length > 0 && (options.expectedSemanticLoss?.length ?? 0) === 0) {
    workflowFail("CONVERSION_SEMANTIC_LOSS_UNDECLARED", `未映射來源模組必須明列 expected semantic loss：${unmapped.map((item) => item.kind).join(", ")}`);
  }
  const refs = provenanceRefs(value.modules);
  const facts = new Map(loaded.factRegister?.facts.map((fact) => [fact.id, fact]) ?? []);
  const openConflicts = loaded.conflictRegister?.conflicts.filter((item) => item.status === "open") ?? [];
  for (const ref of refs) {
    const fact = facts.get(ref.id);
    if (!fact || fact.status !== "accepted") workflowFail("PROPOSAL_FACT_NOT_ACCEPTED", `fact ${ref.id} 不存在或未 accepted`);
    if (fact.classification !== "creative_completion" && fact.evidence.length === 0) workflowFail("PROPOSAL_FACT_EVIDENCE_INCOMPLETE", `fact ${ref.id} 缺少 evidence`);
    if (ref.single && openConflicts.some((conflict) => conflict.members.some((member) => member.fact_id === ref.id))) {
      workflowFail("PROPOSAL_FACT_CONFLICT_UNRESOLVED", `single-value fact ${ref.id} 尚有 unresolved conflict`);
    }
  }
  const sourceRevisions = Object.fromEntries(sourceLayout.map((item) => {
    const relativePath = `characters/${character.id}/${value.source_mode}/${item.file}`;
    const revision = loaded.sourceRevisions[relativePath];
    if (!revision) workflowFail("CONVERSION_SOURCE_INCOMPLETE", `來源模式缺少 ${relativePath}`);
    return [relativePath, revision];
  }));
  const targetOperations: TransactionOperation[] = await Promise.all(targetLayout.map(async (layout) => {
    const module = value.modules.find((item) => item.module === layout.kind)!;
    const relativePath = `characters/${character.id}/${value.target_mode}/${layout.file}`;
    let actual: Revision | undefined;
    try {
      actual = computeTextRevision(await readFile(await resolveWithin(loaded.projectRoot, relativePath)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const expected = options.expectedTargetRevisions[relativePath];
    if (actual === undefined && expected !== "absent") workflowFail("CONVERSION_EXPECTED_ABSENT_REQUIRED", `${relativePath} 新檔需要 expectedAbsent`);
    if (actual !== undefined && expected !== actual) workflowFail("CONVERSION_TARGET_REVISION_CONFLICT", `${relativePath} 已變更`);
    return {
      relativePath,
      content: orderedYaml(module),
      ...(actual === undefined ? { expectedAbsent: true } : { expectedRawRevision: actual }),
    };
  }));
  const targetRevisions = Object.fromEntries(targetOperations.map((item) => [item.relativePath, computeTextRevision(item.content)]));
  const report: ModeHistoryReport = {
    schema_version: 1,
    conversion_id: proposal.id,
    character_id: character.id,
    source_mode: value.source_mode,
    target_mode: value.target_mode,
    source_revisions: sourceRevisions,
    target_revisions: targetRevisions,
    mappings: value.mappings,
    provenance: refs.map((item) => item.id),
    expected_semantic_loss: options.expectedSemanticLoss ?? [],
  };
  const archive = await prepareModeHistoryArchive({
    projectRoot: loaded.projectRoot,
    characterId: character.id,
    conversionId: proposal.id,
    sourceMode: value.source_mode,
    report,
  });
  const manifestPath = await resolveExistingWithin(loaded.projectRoot, "project.yaml");
  const manifestRaw = await readFile(manifestPath);
  const nextManifest = {
    ...loaded.manifest,
    characters: loaded.manifest.characters.map((item) => item.id === character.id ? { ...item, mode: value.target_mode } : item),
  };
  const next = await commitWorkflowMutation(loaded.projectRoot, {
    expectedRevision: proposal.base_workflow_revision,
    eventId: options.eventId,
    actor: proposal.owner,
    occurredAt: options.occurredAt,
    operations: [
      ...archive.operations,
      ...targetOperations,
      { relativePath: "project.yaml", content: canonicalYaml(nextManifest), expectedRawRevision: computeTextRevision(manifestRaw) },
    ],
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      tasks: state.tasks.map((item) => item.id === task.id ? {
        ...item,
        status: "completed",
        result: { id: proposal.id, revision: computeTextRevision(canonicalYaml(value)), contract: "proposal@1" },
        lease: undefined,
      } : item),
      artifacts: state.artifacts.map((item) => ["reviewed", "approved"].includes(item.status) ? { ...item, status: "stale" as const } : item),
      gates: state.gates.map((gate) => gate.status === "approved" ? { ...gate, status: "superseded" as const } : gate),
    }),
  });
  return { state: next, archive: archive.files, report };
}
