import {
  blueprintSchema,
  blueprintWorldSchema,
  projectCharacterSchema,
  pluginRevisionIntentSchema,
  workflowStateSchema,
  workflowTaskSchema,
  type ArtifactReference,
  type Blueprint,
  type ProjectManifest,
  type TaskFailureCategory,
  type WorkflowDecision,
  type WorkflowStage,
  type WorkflowDefinitions,
  type WorkflowState,
  type WorldEntry,
} from "@card-workspace/schemas";
import { paletteModuleFiles, zhujiModuleFiles } from "@card-workspace/project";
import { z } from "zod";

import { workflowFail } from "./errors.js";
import { systemClock, type Clock } from "./leases.js";
import { completeCurateFactsTask as completeCurateFactsTaskRecord, supersedeTask } from "./tasks.js";

type WorkflowDefinition = WorkflowDefinitions["definitions"][number];

const gateIds = ["facts", "blueprint", "content", "publish"] as const;

const characterExpansionRunV1Schema = z.object({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  original_character_ids: z.array(z.string().min(1)).min(1),
  new_characters: z.array(projectCharacterSchema).min(1),
  affected_artifact_ids: z.array(z.string().min(1)),
  revise_world: z.boolean(),
  base_world: blueprintWorldSchema,
  base_relationships_enabled: z.boolean(),
  base_relationship_character_ids: z.array(z.string().min(1)),
}).strict();

const characterExpansionRunV2Schema = characterExpansionRunV1Schema.extend({
  schema_version: z.literal(2),
  candidate_artifact_id: z.string().min(1),
  candidate_path: z.string().min(1),
  candidate_revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  candidate_version: z.number().int().positive(),
  base_project_revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  base_blueprint_revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  materialized: z.boolean(),
}).strict();

export const characterExpansionRunSchema = z.union([characterExpansionRunV1Schema, characterExpansionRunV2Schema]);

export type CharacterExpansionRun = z.infer<typeof characterExpansionRunSchema>;

function expansionRun(state: WorkflowState): CharacterExpansionRun | undefined {
  const value = state.extensions.character_expansion;
  return value === undefined ? undefined : characterExpansionRunSchema.parse(value);
}

export function startConfiguredWorkflow(options: {
  state: WorkflowState;
  definition: WorkflowDefinition;
  intakeDecisions?: WorkflowDecision[];
  initialInputArtifacts?: ArtifactReference[];
  occurredAt: string;
}): WorkflowState {
  const { state, definition } = options;
  if (definition.id !== state.workflow_definition_id || definition.entry_kind !== state.entry_kind) {
    workflowFail("WORKFLOW_DEFINITION_MISMATCH", "Workflow state does not match configured definition");
  }
  if (state.stage !== "intake") return state;
  const initialInputArtifacts = options.initialInputArtifacts ?? [];
  if (state.entry_kind === "source_adaptation" && initialInputArtifacts.length === 0) {
    workflowFail("SOURCE_ADAPTATION_SOURCE_REQUIRED", "source_adaptation requires at least one source artifact");
  }
  const decisions = [...state.decisions, ...(options.intakeDecisions ?? [])];
  if (!decisions.some((decision) => decision.kind === "interview.answer")) {
    workflowFail("WORKFLOW_INTAKE_REQUIRED", "workflow_start 前必須保存至少一筆 intake 訪談答案");
  }
  if (!decisions.some((decision) => decision.kind === "interview.complete" && decision.option === "no-additional-settings")) {
    workflowFail("WORKFLOW_INTAKE_INCOMPLETE", "進入 Blueprint 前必須確認沒有需要增加或補充的設定");
  }
  if (state.tasks.length > 0 || state.gates.length > 0) {
    workflowFail("WORKFLOW_INTAKE_DIRTY", "intake workflow 已包含未啟動的 task 或 gate");
  }
  const intakeIndex = definition.stages.indexOf("intake");
  const target = definition.stages[intakeIndex + 1];
  if (intakeIndex !== 0 || target === undefined) {
    workflowFail("WORKFLOW_DEFINITION_MISMATCH", "Workflow definition 必須以 intake 開始並包含下一階段");
  }
  const required = new Set(definition.required_gates);
  const optionalGateDecisions: WorkflowDecision[] = gateIds
    .filter((id) => !required.has(id))
    .map((id) => ({
      id: `gate-${id}-not-required`,
      kind: "gate.not_required",
      actor: "engine",
      decided_at: options.occurredAt,
      input_revisions: [],
      summary: `${id} gate is not required by ${definition.id}`,
      extensions: {},
    }));
  const tasks = definition.tasks
    .filter((template) => template.stage === target)
    .map((template) => ({
      id: template.id,
      kind: template.kind,
      status: "pending" as const,
      assigned_agent: template.agent_kind,
      capabilities: [...new Set(["task.execute", ...template.capabilities])],
      input_artifacts: initialInputArtifacts,
      output_contract: state.entry_kind === "source_adaptation" && template.kind === "curate-facts"
        ? "facts-curation-summary@1"
        : template.output_contract,
      dependencies: [],
      attempt: 0,
      max_attempts: template.max_attempts,
      extensions: { stage: target },
    }));
  if (tasks.length === 0) workflowFail("WORKFLOW_STAGE_TASKS_MISSING", `階段 ${target} 沒有 task template`);
  return workflowStateSchema.parse({
    ...state,
    stage: target,
    revision: state.revision + 1,
    decisions: [...decisions, ...optionalGateDecisions],
    gates: gateIds.map((id) => ({ id, status: required.has(id) ? "pending" as const : "not_required" as const, input_revisions: [], extensions: {} })),
    tasks,
  });
}

export function advanceConfiguredWorkflow(options: {
  state: WorkflowState;
  definition: WorkflowDefinition;
  blueprint?: Blueprint;
  projectKind?: ProjectManifest["kind"];
}): WorkflowState {
  const { state, definition, blueprint } = options;
  if (state.outcome?.status === "closed") {
    workflowFail("WORKFLOW_CLOSED", `Workflow is closed with outcome ${state.outcome.kind}`);
  }
  if (definition.id !== state.workflow_definition_id || definition.entry_kind !== state.entry_kind) {
    workflowFail("WORKFLOW_DEFINITION_MISMATCH", "Workflow state does not match configured definition");
  }
  if (state.entry_kind === "mode_conversion") {
    workflowFail("WORKFLOW_ENTRY_NOT_IMPLEMENTED", `Entry ${state.entry_kind} is not yet executable end-to-end`);
  }
  if (state.entry_kind === "source_adaptation" && state.stage === "source_processing") {
    assertStageTasksComplete(state);
    if (nextConfiguredStage(state, definition) !== "facts_review") {
      workflowFail("WORKFLOW_DEFINITION_MISMATCH", "source_processing must be followed by facts_review");
    }
    return workflowStateSchema.parse({ ...state, stage: "facts_review", revision: state.revision + 1 });
  }
  if (state.entry_kind === "source_adaptation" && state.stage === "facts_review") {
    assertStageTasksComplete(state);
    if (nextConfiguredStage(state, definition) !== "blueprint") {
      workflowFail("WORKFLOW_DEFINITION_MISMATCH", "facts_review must be followed by blueprint");
    }
    const factsGate = state.gates.find((item) => item.id === "facts");
    if (!factsGate || !["approved", "not_required"].includes(factsGate.status)) {
      workflowFail("WORKFLOW_GATE_BLOCKED", "facts gate is not approved");
    }
    const task = materializeSourceBlueprintTask(definition, currentSourceAndFactsArtifacts(state));
    return workflowStateSchema.parse({
      ...state,
      stage: "blueprint",
      revision: state.revision + 1,
      tasks: [...state.tasks, task],
    });
  }
  if (blueprint === undefined) workflowFail("WORKFLOW_ARTIFACT_MISSING", "A Blueprint is required to advance this stage");
  const index = definition.stages.indexOf(state.stage);
  const expansion = expansionRun(state);
  if (expansion?.schema_version === 2 && state.stage === "blueprint" && !expansion.materialized) {
    workflowFail("CHARACTER_EXPANSION_NOT_MATERIALIZED", "Character expansion 必須先由 Blueprint approval 原子 materialize");
  }
  const worldRevisionReviewStage = state.extensions.world_revision_review_stage;
  const worldRevisionRunId = typeof state.extensions.world_revision_run_id === "string"
    ? state.extensions.world_revision_run_id
    : undefined;
  const worldOnly = options.projectKind === "worldbook" || state.extensions.world_only_run === true;
  const worldTiming = options.projectKind === "worldbook"
    ? "before_characters"
    : blueprint.world.authoring_timing ?? "after_characters";
  const characterRunId = expansion?.run_id ?? (typeof state.extensions.character_revision_run_id === "string"
    ? state.extensions.character_revision_run_id
    : worldRevisionReviewStage === "post_world_review" ? worldRevisionRunId : undefined);
  const hasSeparateGreetingsStage = definition.stages.includes("greetings_authoring");
  const legacyGreeting = state.tasks.find((task) => task.id === "create-greetings" && task.extensions.stage === "authoring");
  const effectiveTasks = hasSeparateGreetingsStage && state.stage === "authoring" && legacyGreeting?.status !== "completed"
    ? state.tasks.map((task) => task === legacyGreeting ? { ...task, status: "superseded" as const, lease: undefined } : task)
    : state.tasks;
  if (index < 0) workflowFail("WORKFLOW_ALREADY_PUBLISHED", "Workflow has no next configured stage");
  const unfinished = effectiveTasks.find((task) =>
    (task.extensions.stage === state.stage || task.extensions.stage === undefined)
    && ["pending", "claimed", "failed", "retryable", "needs_user_decision"].includes(task.status));
  if (unfinished) workflowFail("WORKFLOW_TASKS_INCOMPLETE", `task ${unfinished.id} is not complete`);
  const legacyWorldCompleted = effectiveTasks.some((task) =>
    task.kind === "create-world" && task.status === "completed" && task.extensions.stage === "authoring");
  const stageApplies = (stage: WorkflowStage) => {
    if (expansion) {
      if (stage === "pre_world_authoring" || stage === "pre_world_review") return false;
      if (stage === "post_world_authoring" || stage === "post_world_review") return expansion.revise_world;
    }
    if (stage === "pre_world_authoring" || stage === "pre_world_review") {
      return blueprint.world.enabled && worldTiming === "before_characters";
    }
    if (stage === "authoring" || stage === "semantic_review") return !worldOnly && blueprint.characters.length > 0;
    if (stage === "post_world_authoring") {
      return (expansion !== undefined || characterRunId === undefined) && !worldOnly && blueprint.world.enabled && worldTiming === "after_characters" && !legacyWorldCompleted;
    }
    if (stage === "post_world_review") {
      if (worldRevisionRunId !== undefined && worldRevisionReviewStage === "post_world_review") return !worldOnly;
      return (expansion !== undefined || characterRunId === undefined) && !worldOnly && blueprint.world.enabled && worldTiming === "after_characters";
    }
    if (stage === "greetings_authoring") {
      return blueprint.greetings.enabled && legacyGreeting?.status !== "completed";
    }
    if ([
      "plugin_mvu_authoring",
      "plugin_mvu_review",
      "plugin_ejs_authoring",
      "plugin_ejs_review",
      "plugin_html_authoring",
      "plugin_html_review",
    ].includes(stage)) {
       return pluginStageApplies(stage, blueprint, state);
    }
    return true;
  };
  const target = definition.stages.slice(index + 1).find(stageApplies);
  if (target === undefined) workflowFail("WORKFLOW_ALREADY_PUBLISHED", "Workflow has no next configured stage");
  if (target === "published") {
    workflowFail("WORKFLOW_PUBLISH_TOOL_REQUIRED", "必須由 project_publish 成功寫出已批准的 exact preview 後進入 published");
  }
  const requiredGate = state.stage === "blueprint" ? "blueprint" : target === "compile_preview" ? "content" : undefined;
  if (requiredGate) {
    const gate = state.gates.find((item) => item.id === requiredGate);
    if (!gate || !["approved", "not_required"].includes(gate.status)) workflowFail("WORKFLOW_GATE_BLOCKED", `${requiredGate} gate is not approved`);
    if (expansion && requiredGate === "blueprint") {
      const expectedId = expansion.schema_version === 2 ? expansion.candidate_artifact_id : "blueprint";
      const expectedRevision = expansion.schema_version === 2 ? expansion.candidate_revision : state.artifacts.find((item) => item.id === "blueprint")?.revision;
      if (!expectedRevision || gate.input_revisions.length !== 1 || gate.input_revisions[0]?.id !== expectedId || gate.input_revisions[0].revision !== expectedRevision) {
        workflowFail("CHARACTER_EXPANSION_BLUEPRINT_GATE_STALE", "Expansion Blueprint Gate 必須批准 exact current Blueprint revision");
      }
    }
  }
  if (state.stage === "blueprint" && !state.artifacts.some((item) => item.id === "blueprint" && item.revision && !["missing", "stale"].includes(item.status))) {
    workflowFail("WORKFLOW_ARTIFACT_MISSING", "A valid Blueprint artifact is required");
  }
  if (target === "publish_review" && !state.artifacts.some((item) => item.id.startsWith("preview-") && item.status === "reviewed" && item.revision)) {
    workflowFail("WORKFLOW_ARTIFACT_MISSING", "A reviewed compile preview is required");
  }
  const inputArtifacts: ArtifactReference[] = state.artifacts
    .filter((item) => item.revision && !["missing", "stale"].includes(item.status))
    .map((item) => ({ id: item.id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) }));
  const runId = expansion?.revise_world === true
    ? expansion.run_id
    : worldRevisionRunId ?? (typeof state.extensions.world_authoring_run_id === "string" ? state.extensions.world_authoring_run_id : undefined);
  const greetingsRunId = expansion?.run_id ?? (typeof state.extensions.greetings_revision_run_id === "string"
    ? state.extensions.greetings_revision_run_id
    : undefined);
  const reviewWorldAtContent = state.extensions.world_only_run === true
    || (options.projectKind === "worldbook" && state.stage === "authoring");
  const tasks = expansion && target === "authoring"
    ? materializeExpansionTasks(blueprint, inputArtifacts, expansion, effectiveTasks)
    : target.startsWith("plugin_")
      ? materializePluginTasks(target, blueprint, inputArtifacts, state)
    : materializeOriginalTasks(target, blueprint, inputArtifacts, worldOnly, runId, reviewWorldAtContent, greetingsRunId, characterRunId, expansion !== undefined);
  const existingIds = new Set(effectiveTasks.map((item) => item.id));
  const dedupedTasks = tasks.filter((item) => !existingIds.has(item.id));
  return workflowStateSchema.parse({
    ...state,
    stage: target,
    revision: state.revision + 1,
    tasks: [...effectiveTasks, ...dedupedTasks],
  });
}

function pluginIdsForBlueprint(blueprint: Blueprint): Set<string> {
  const ids = new Set(blueprint.plugins.map((selection) => selection.plugin_id));
  return addPluginDependencies(ids, blueprint.plugins);
}

function addPluginDependencies(ids: Set<string>, selections: Blueprint["plugins"]): Set<string> {
  if (ids.has("official.ejs") || (ids.has("official.html") && selections.some((selection) =>
    selection.plugin_id === "official.html" && selection.capabilities.includes("html.status_bar")))) {
    ids.add("official.mvu-zod");
  }
  return ids;
}

function pluginIdsForState(state: WorkflowState, blueprint: Blueprint): Set<string> {
  const intent = pluginRevisionIntentSchema.safeParse(state.extensions.plugin_revision_intent);
  if (intent.success) return new Set(intent.data.dependency_closure);
  return pluginIdsForBlueprint(blueprint);
}

function pluginSelectionsForState(state: WorkflowState | undefined, blueprint: Blueprint): Blueprint["plugins"] {
  if (state !== undefined) {
    const intent = pluginRevisionIntentSchema.safeParse(state.extensions.plugin_revision_intent);
    if (intent.success) return intent.data.selections;
  }
  return blueprint.plugins;
}

function pluginStageApplies(stage: WorkflowStage, blueprint: Blueprint, state?: WorkflowState): boolean {
  const ids = state === undefined ? pluginIdsForBlueprint(blueprint) : pluginIdsForState(state, blueprint);
  if (stage === "plugin_mvu_authoring" || stage === "plugin_mvu_review") return ids.has("official.mvu-zod");
  if (stage === "plugin_ejs_authoring" || stage === "plugin_ejs_review") return ids.has("official.ejs");
  if (stage === "plugin_html_authoring" || stage === "plugin_html_review") return ids.has("official.html");
  return false;
}

export function materializePluginTasks(
  stage: WorkflowStage,
  blueprint: Blueprint,
  inputArtifacts: ArtifactReference[],
  state?: WorkflowState,
): ReturnType<typeof workflowTaskSchema.parse>[] {
  const definitions: Record<string, { pluginId: string; author: string; critic: string; capability: string; authorKind: string; reviewKind: string }> = {
    plugin_mvu: { pluginId: "official.mvu-zod", author: "mvu-creator", critic: "mvu-critic", capability: "plugin.mvu.propose", authorKind: "create-plugin-mvu", reviewKind: "review-plugin-mvu" },
    plugin_ejs: { pluginId: "official.ejs", author: "ejs-creator", critic: "ejs-critic", capability: "plugin.ejs.propose", authorKind: "create-plugin-ejs", reviewKind: "review-plugin-ejs" },
    plugin_html: { pluginId: "official.html", author: "html-creator", critic: "html-critic", capability: "plugin.html.propose", authorKind: "create-plugin-html", reviewKind: "review-plugin-html" },
  };
  const key = stage.replace(/_(authoring|review)$/u, "");
  const definition = definitions[key];
  if (!definition || !pluginStageApplies(stage, blueprint, state)) return [];
  const review = stage.endsWith("review");
  const kind = review ? definition.reviewKind : definition.authorKind;
  const taskId = `${review ? "review" : "create"}-${definition.pluginId.replaceAll(".", "-")}`;
  const selections = pluginSelectionsForState(state, blueprint);
  const selectedIds = state === undefined
    ? new Set(selections.map((selection) => selection.plugin_id))
    : pluginIdsForState(state, blueprint);
  const dependencies: string[] = review ? [`create-${definition.pluginId.replaceAll(".", "-")}`] : [];
  if (!review && definition.pluginId === "official.ejs" && selectedIds.has("official.mvu-zod")) {
    dependencies.push("review-official-mvu-zod");
  }
  if (!review && definition.pluginId === "official.html") {
    if (selectedIds.has("official.ejs")) dependencies.push("review-official-ejs");
    else if (selections.some((selection) => selection.plugin_id === "official.html" && selection.capabilities.includes("html.status_bar"))) {
      dependencies.push("review-official-mvu-zod");
    }
  }
  const task = workflowTaskSchema.parse({
    id: taskId,
    kind,
    status: "pending",
     assigned_agent: review ? definition.critic : definition.author,
    capabilities: ["task.execute", review ? "review.submit" : definition.capability, ...(review ? [] : ["task.clarify"])],
    input_artifacts: inputArtifacts,
    output_contract: review ? "review-report@1" : "plugin-proposal@1",
    dependencies,
    attempt: 0,
    max_attempts: 3,
    extensions: { stage, plugin_id: definition.pluginId, plugin_kind: key, requires_immutable_proposal: review },
  });
  return [task];
}

function nextConfiguredStage(state: WorkflowState, definition: WorkflowDefinition): WorkflowStage | undefined {
  const index = definition.stages.indexOf(state.stage);
  return index < 0 ? undefined : definition.stages[index + 1];
}

function assertStageTasksComplete(state: WorkflowState): void {
  const unfinished = state.tasks.find((task) =>
    (task.extensions.stage === state.stage || task.extensions.stage === undefined)
    && ["pending", "claimed", "failed", "retryable", "needs_user_decision"].includes(task.status));
  if (unfinished) workflowFail("WORKFLOW_TASKS_INCOMPLETE", `task ${unfinished.id} is not complete`);
}

function currentSourceAndFactsArtifacts(state: WorkflowState): ArtifactReference[] {
  const currentCurate = [...state.tasks].reverse().find((task) => task.kind === "curate-facts" && task.status === "completed");
  const factsGate = state.gates.find((gate) => gate.id === "facts" && gate.status === "approved");
  const references: ArtifactReference[] = [
    ...state.artifacts
      .filter((item) => item.revision && !["missing", "stale"].includes(item.status))
      .map((item) => ({ id: item.id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) })),
    ...(currentCurate?.input_artifacts ?? []),
    ...(currentCurate?.result ? [currentCurate.result] : []),
    ...(factsGate?.input_revisions ?? []),
  ];
  const seen = new Set<string>();
  return references.filter((item) => {
    const key = `${item.id}\u0000${item.revision}\u0000${item.contract ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function materializeSourceBlueprintTask(definition: WorkflowDefinition, inputArtifacts: ArtifactReference[]) {
  const template = definition.tasks.find((item) => item.stage === "blueprint" && item.kind === "create-blueprint");
  return workflowTaskSchema.parse({
    id: template?.id ?? "create-blueprint",
    kind: "create-blueprint",
    status: "pending",
    assigned_agent: "director",
    capabilities: [...new Set(["task.execute", ...(template?.capabilities ?? ["blueprint.propose"])])],
    input_artifacts: inputArtifacts,
    output_contract: template?.output_contract ?? "proposal@1",
    dependencies: [],
    attempt: 0,
    max_attempts: template?.max_attempts ?? 3,
    extensions: { stage: "blueprint" },
  });
}

export function completeSourceProcessingTask(options: {
  state: WorkflowState;
  taskId: string;
  leaseId: string;
  owner: string;
  result: ArtifactReference;
  clock?: Clock;
}): WorkflowState {
  const target = options.state.tasks.find((task) => task.id === options.taskId);
  if (target === undefined) workflowFail("CURATE_FACTS_TASK_NOT_FOUND", `task ${options.taskId} was not found`);
  const completed = completeCurateFactsTaskRecord(target, {
    taskId: options.taskId,
    leaseId: options.leaseId,
    owner: options.owner,
    result: options.result,
  }, options.clock ?? systemClock);
  if (completed === target) return options.state;
  return workflowStateSchema.parse({
    ...options.state,
    revision: options.state.revision + 1,
    tasks: options.state.tasks.map((task) => task.id === target.id ? completed : task),
  });
}

export function beginSourceProcessingRepair(options: {
  state: WorkflowState;
  sourceInputs: ArtifactReference[];
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
}): WorkflowState {
  const { state } = options;
  if (options.actor !== "director") workflowFail("SOURCE_PROCESSING_REPAIR_DENIED", "Only the Director may request source processing repair");
  if (state.entry_kind !== "source_adaptation" || state.stage !== "source_processing") {
    workflowFail("SOURCE_PROCESSING_REPAIR_STAGE_DENIED", "Repair requires source_adaptation at source_processing");
  }
  if (options.sourceInputs.length === 0) workflowFail("SOURCE_ADAPTATION_SOURCE_REQUIRED", "Source processing repair requires source inputs");
  const target = [...state.tasks].reverse().find((task) => task.kind === "curate-facts" && task.status === "failed");
  if (target === undefined) workflowFail("SOURCE_PROCESSING_REPAIR_TARGET_NOT_FAILED", "No failed curate-facts task exists");
  if (target.attempt < target.max_attempts) {
    workflowFail("SOURCE_PROCESSING_REPAIR_ATTEMPTS_NOT_EXHAUSTED", `task ${target.id} has attempts remaining`);
  }
  const occurredAt = new Date(options.occurredAt).getTime();
  if (state.tasks.some((task) => task.status === "claimed" && task.lease !== undefined
    && new Date(task.lease.expires_at).getTime() > occurredAt)) {
    workflowFail("SOURCE_PROCESSING_REPAIR_ACTIVE_LEASE", "workflow has an active task lease");
  }
  const repairParentId = typeof target.extensions.repair_of === "string" ? target.extensions.repair_of : undefined;
  if ((repairParentId !== undefined && !state.tasks.some((task) => task.id === repairParentId))
    || state.tasks.some((task) => task.extensions.repair_of === target.id)) {
    workflowFail("SOURCE_PROCESSING_REPAIR_LINEAGE_EXISTS", `task ${target.id} repair lineage already exists`);
  }
  const priorGeneration = typeof target.extensions.repair_generation === "number"
    ? target.extensions.repair_generation
    : target.extensions.repair_of !== undefined ? 1 : 0;
  if (priorGeneration >= 2) {
    workflowFail("SOURCE_PROCESSING_REPAIR_LINEAGE_EXHAUSTED", `task ${target.id} exhausted source processing repair lineage`);
  }
  const repairGeneration = priorGeneration + 1;
  const repairRoot = typeof target.extensions.repair_root === "string"
    ? target.extensions.repair_root
    : typeof target.extensions.repair_of === "string" ? target.extensions.repair_of : target.id;
  const successorId = `curate-facts-${options.runId}`;
  const decisionId = `source-processing-repair-${options.runId}`;
  if (state.tasks.some((task) => task.id === successorId || task.extensions.repair_run_id === options.runId)
    || state.decisions.some((decision) => decision.id === decisionId || decision.extensions.repair_run_id === options.runId)) {
    workflowFail("SOURCE_PROCESSING_REPAIR_ID_CONFLICT", `repair run ${options.runId} conflicts with an existing ID`);
  }
  const successor = workflowTaskSchema.parse({
    id: successorId,
    kind: "curate-facts",
    status: "pending",
    assigned_agent: "fact-curator",
    capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
    input_artifacts: options.sourceInputs,
    output_contract: "facts-curation-summary@1",
    dependencies: [],
    attempt: 0,
    max_attempts: 3,
    extensions: {
      repair_of: target.id,
      repair_root: repairRoot,
      repair_generation: repairGeneration,
      repair_run_id: options.runId,
      stage: "source_processing",
      source_jobs: {},
    },
  });
  return workflowStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    tasks: [...state.tasks.map((task) => task.id === target.id ? supersedeTask(task) : task), successor],
    decisions: [...state.decisions, {
      id: decisionId,
      kind: "source_processing.repair_requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: options.sourceInputs,
      summary: options.reason,
      extensions: {
        repair_of: target.id,
        repair_root: repairRoot,
        repair_generation: repairGeneration,
        repair_run_id: options.runId,
        successor_task_id: successorId,
      },
    }],
  });
}

export function beginFactsRecuration(options: {
  state: WorkflowState;
  sourceInputs: ArtifactReference[];
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
}): WorkflowState {
  const { state } = options;
  if (options.actor !== "director") workflowFail("FACTS_RECURATION_DENIED", "Only the Director may begin facts re-curation");
  if (state.entry_kind !== "source_adaptation" || state.stage !== "facts_review") {
    workflowFail("FACTS_RECURATION_DENIED", "Facts re-curation requires source_adaptation at facts_review");
  }
  if (options.sourceInputs.length === 0) workflowFail("SOURCE_ADAPTATION_SOURCE_REQUIRED", "Facts re-curation requires exact source inputs");
  const predecessor = [...state.tasks].reverse().find((task) => task.kind === "curate-facts");
  if (predecessor?.status !== "completed") {
    workflowFail("FACTS_RECURATION_DENIED", "The latest curate-facts task must be completed");
  }
  const successorId = `curate-facts-recurate-${options.runId}`;
  const decisionId = `facts-recuration-${options.runId}`;
  if (state.tasks.some((task) => task.id === successorId || task.extensions.curation_run_id === options.runId)
    || state.decisions.some((decision) => decision.id === decisionId || decision.extensions.curation_run_id === options.runId)) {
    workflowFail("FACTS_RECURATION_ID_CONFLICT", `Facts re-curation run already exists: ${options.runId}`);
  }
  const successor = workflowTaskSchema.parse({
    id: successorId,
    kind: "curate-facts",
    status: "pending",
    assigned_agent: "fact-curator",
    capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
    input_artifacts: options.sourceInputs,
    output_contract: "facts-curation-summary@1",
    dependencies: [],
    attempt: 0,
    max_attempts: 3,
    extensions: {
      stage: "source_processing",
      source_jobs: {},
      curation_run_id: options.runId,
      recuration_of: predecessor.id,
    },
  });
  return workflowStateSchema.parse({
    ...state,
    stage: "source_processing",
    revision: state.revision + 1,
    tasks: [...state.tasks, successor],
    gates: state.gates.map((gate) => ({
      ...gate,
      status: "pending" as const,
      decision_id: undefined,
      input_revisions: [],
    })),
    decisions: [...state.decisions, {
      id: decisionId,
      kind: "facts.recuration.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: options.sourceInputs,
      summary: options.reason,
      extensions: {
        curation_run_id: options.runId,
        predecessor_task_id: predecessor.id,
        successor_task_id: successorId,
      },
    }],
    extensions: { ...state.extensions, facts_recuration_run_id: options.runId },
  });
}

function materializeOriginalTasks(
  stage: WorkflowStage,
  blueprint: Blueprint,
  inputArtifacts: ArtifactReference[],
  worldOnly = false,
  runId?: string,
  reviewWorldAtContent = false,
  greetingsRunId?: string,
  characterRunId?: string,
  characterArtifactsOnly = false,
) {
  const task = (id: string, kind: string, agent: string, capability: string, outputContract: string, extensions: Record<string, unknown> = {}, dependencies: string[] = []) => ({
    id, kind, status: "pending" as const, assigned_agent: agent,
    capabilities: ["task.execute", capability, ...(["character.propose", "relationships.propose", "world.propose", "greetings.propose"].includes(capability) ? ["task.clarify"] : [])], input_artifacts: inputArtifacts,
    output_contract: outputContract, dependencies, attempt: 0, max_attempts: 3, extensions: { ...extensions, stage },
  });
  if (stage === "pre_world_authoring" || stage === "post_world_authoring") {
    const id = runId === undefined ? "create-world" : `create-world-${runId}`;
    return [task(id, "create-world", "world-lore-creator", "world.propose", "proposal@1", { output_kind: "world" })];
  }
  if (stage === "pre_world_review" || stage === "post_world_review") {
    return [task(runId === undefined ? "review-world" : `review-world-${runId}`, "review-world", "world-lore-critic", "review.submit", "review-report@1")];
  }
  if (stage === "authoring") {
    if (worldOnly) {
      const id = runId === undefined ? "create-world" : `create-world-${runId}`;
      return [task(id, "create-world", "world-lore-creator", "world.propose", "proposal@1", { output_kind: "world" })];
    }
    const characterTasks = blueprint.characters.flatMap((character) => {
      const agent = character.mode === "zhuji" ? "zhuji-creator" : "palette-creator";
      const files = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
      const characterTaskId = `create-character-${character.id}`;
      const moduleTasks = files.map((file, index) => {
        const previous = index === 0 ? characterTaskId : `create-${character.id}-${files[index - 1]!.kind}`;
        return task(
          `create-${character.id}-${file.kind}`,
          "create-character-module",
          agent,
          "character.propose",
          "proposal@1",
          { character_id: character.id, output_kind: character.mode, module: file.kind },
          [previous],
        );
      });
      return [
        task(characterTaskId, "create-character", agent, "character.propose", "proposal@1", { character_id: character.id, output_kind: "character" }),
        ...moduleTasks,
      ];
    });
    if (!blueprint.relationships.enabled) return characterTasks;
    const participantIds = new Set(blueprint.relationships.character_ids);
    const dependencies = blueprint.characters
      .filter((character) => participantIds.has(character.id))
      .map((character) => {
        const files = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
        return `create-${character.id}-${files.at(-1)!.kind}`;
      });
    return [...characterTasks, task(
      "create-relationships",
      "create-relationships",
      "relationship-creator",
      "relationships.propose",
      "proposal@1",
      { output_kind: "relationships", participant_ids: blueprint.relationships.character_ids },
      dependencies,
    )];
  }
  if (stage === "semantic_review") return worldOnly
    ? []
    : [task(
        characterRunId === undefined ? "review-characters" : `review-characters-${characterRunId}`,
        "review-character",
        "character-critic",
        "review.submit",
        "review-report@1",
      )].map((review) => characterArtifactsOnly
        ? { ...review, input_artifacts: inputArtifacts.filter((item) => item.id.startsWith("author-characters-") || item.id === "author-relationships.yaml") }
        : review);
  if (stage === "greetings_authoring") return blueprint.greetings.enabled
    ? [task(greetingsRunId === undefined ? "create-greetings" : `revise-greetings-${greetingsRunId}`, "create-greetings", "greetings-creator", "greetings.propose", "proposal@1", { output_kind: "greetings" })]
    : [];
  if (stage === "content_review") return reviewWorldAtContent
    ? [task(runId === undefined ? "review-world" : `review-world-${runId}`, "review-world", "world-lore-critic", "review.submit", "review-report@1")]
    : blueprint.greetings.enabled
      ? [task(greetingsRunId === undefined ? "review-greetings" : `review-greetings-${greetingsRunId}`, "review-greetings", "greetings-critic", "review.submit", "review-report@1")]
      : [];
  return [];
}

function characterArtifactTargets(blueprint: Blueprint) {
  return blueprint.characters.flatMap((character) => {
    const files = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
    return [
      { artifactId: authorArtifactId(`characters/${character.id}/character.yaml`), character, module: undefined },
      ...files.map((file) => ({
        artifactId: authorArtifactId(`characters/${character.id}/${character.mode}/${file.file}`),
        character,
        module: file.kind,
      })),
    ];
  });
}

function materializeExpansionTasks(
  blueprint: Blueprint,
  inputArtifacts: ArtifactReference[],
  expansion: CharacterExpansionRun,
  priorTasks: WorkflowState["tasks"],
) {
  const newIds = new Set(expansion.new_characters.map((item) => item.id));
  const affected = new Set(expansion.affected_artifact_ids);
  const tasks: ReturnType<typeof workflowTaskSchema.parse>[] = [];
  const previousByCharacter = new Map<string, string>();
  for (const target of characterArtifactTargets(blueprint)) {
    if (!newIds.has(target.character.id) && !affected.has(target.artifactId)) continue;
    const agent = target.character.mode === "zhuji" ? "zhuji-creator" : "palette-creator";
    const suffix = target.module ?? "character";
    const id = newIds.has(target.character.id)
      ? `create-${target.character.id}-${suffix}-${expansion.run_id}`
      : `revise-${target.character.id}-${suffix}-${expansion.run_id}`;
    const previous = previousByCharacter.get(target.character.id);
    tasks.push(workflowTaskSchema.parse({
      id,
      kind: target.module === undefined ? "create-character" : "create-character-module",
      status: "pending",
      assigned_agent: agent,
      capabilities: ["task.execute", "character.propose", "task.clarify"],
      input_artifacts: inputArtifacts,
      output_contract: "proposal@1",
      dependencies: previous ? [previous] : [],
      attempt: 0,
      max_attempts: 3,
      extensions: {
        character_id: target.character.id,
        output_kind: target.module === undefined ? "character" : target.character.mode,
        ...(target.module === undefined ? {} : { module: target.module }),
        stage: "authoring",
        expansion_run_id: expansion.run_id,
        target_artifact_id: target.artifactId,
      },
    }));
    previousByCharacter.set(target.character.id, id);
  }
  const relationshipsArtifactId = authorArtifactId("relationships.yaml");
  const baseEnabled = expansion.base_relationships_enabled;
  const participantsChanged = !sameValue(expansion.base_relationship_character_ids, blueprint.relationships.character_ids);
  if (blueprint.relationships.enabled && (!baseEnabled || participantsChanged || affected.has(relationshipsArtifactId))) {
    const dependencies = blueprint.relationships.character_ids.map((characterId) => {
      const current = previousByCharacter.get(characterId);
      if (current) return current;
      const character = blueprint.characters.find((item) => item.id === characterId)!;
      const files = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
      const canonical = `create-${character.id}-${files.at(-1)!.kind}`;
      const completed = [...priorTasks].reverse().find((item) => item.status === "completed"
        && item.extensions.character_id === characterId && item.extensions.module === files.at(-1)!.kind);
      const dependency = completed?.id ?? (priorTasks.some((item) => item.id === canonical && item.status === "completed") ? canonical : undefined);
      if (!dependency) {
        workflowFail("CHARACTER_EXPANSION_RELATIONSHIPS_DEPENDENCY_MISSING", `relationships participant 缺少完成的 final mode module：${characterId}`);
      }
      return dependency;
    });
    tasks.push(workflowTaskSchema.parse({
      id: `${baseEnabled ? "revise" : "create"}-relationships-${expansion.run_id}`,
      kind: "create-relationships",
      status: "pending",
      assigned_agent: "relationship-creator",
      capabilities: ["task.execute", "relationships.propose", "task.clarify"],
      input_artifacts: inputArtifacts,
      output_contract: "proposal@1",
      dependencies: [...new Set(dependencies)],
      attempt: 0,
      max_attempts: 3,
      extensions: { output_kind: "relationships", participant_ids: blueprint.relationships.character_ids, stage: "authoring", expansion_run_id: expansion.run_id, target_artifact_id: relationshipsArtifactId },
    }));
  }
  return tasks;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateExpansionCandidate(options: {
  manifest: ProjectManifest;
  currentBlueprint: Blueprint;
  candidateBlueprint: Blueprint;
  newCharacters: Array<ProjectManifest["characters"][number] & { core_concept: string; relationship_summary?: string | undefined }>;
  reviseWorld: boolean;
  enforceNewConcept?: boolean;
}) {
  if (options.manifest.kind !== "character_card") workflowFail("CHARACTER_EXPANSION_KIND_DENIED", "只有 character_card 可新增角色");
  const candidate = options.candidateBlueprint;
  if (candidate.project_id !== options.manifest.id || candidate.entry_kind !== options.currentBlueprint.entry_kind) {
    workflowFail("CHARACTER_EXPANSION_IDENTITY_CHANGED", "candidate 不可變更 project_id 或 entry_kind");
  }
  if (candidate.collaboration_mode !== options.currentBlueprint.collaboration_mode) {
    workflowFail("CHARACTER_EXPANSION_MODE_CHANGED", "candidate 不可變更 collaboration_mode");
  }
  const existing = new Map(options.manifest.characters.map((item) => [item.id, item]));
  const requested = new Map(options.newCharacters.map((item) => [item.id, item]));
  if (requested.size !== options.newCharacters.length || [...requested.keys()].some((id) => existing.has(id))) {
    workflowFail("CHARACTER_EXPANSION_ROSTER_INVALID", "新角色 ID 重複或與既有角色衝突");
  }
  const candidateById = new Map(candidate.characters.map((item) => [item.id, item]));
  if (candidateById.size !== existing.size + requested.size) workflowFail("CHARACTER_EXPANSION_ROSTER_INVALID", "candidate 必須完整保留既有角色並只加入 requested roster");
  for (const character of [...existing.values(), ...requested.values()]) {
    const item = candidateById.get(character.id);
    if (!item || item.display_name !== character.display_name || item.mode !== character.mode) {
      workflowFail("CHARACTER_EXPANSION_ROSTER_INVALID", `candidate 角色 identity 不符：${character.id}`);
    }
  }
  if (options.enforceNewConcept !== false) {
    for (const character of requested.values()) {
      const item = candidateById.get(character.id)!;
      if (item.core_concept !== character.core_concept || item.relationship_summary !== character.relationship_summary) {
        workflowFail("CHARACTER_EXPANSION_ROSTER_INVALID", `candidate 新角色概念不符 request：${character.id}`);
      }
    }
  }
  const greetingIds = new Set(candidate.greetings.character_ids);
  if (!candidate.greetings.enabled) workflowFail("CHARACTER_EXPANSION_GREETINGS_REQUIRED", "character expansion 不可停用 greetings");
  if (greetingIds.size !== candidate.characters.length || candidate.characters.some((item) => !greetingIds.has(item.id))) {
    workflowFail("CHARACTER_EXPANSION_GREETINGS_ROSTER_INVALID", "Blueprint greetings.character_ids 必須包含完整 roster");
  }
  if (!options.reviseWorld && !sameValue(candidate.world, options.currentBlueprint.world)) {
    workflowFail("CHARACTER_EXPANSION_WORLD_CHANGED", "revise_world=false 時不可變更 world");
  }
  if (!candidate.relationships.enabled && options.currentBlueprint.relationships.enabled) {
    workflowFail("CHARACTER_EXPANSION_RELATIONSHIPS_DELETE_FORBIDDEN", "character expansion 不可停用既有 relationships");
  }
}

export function beginCharacterExpansion(options: {
  state: WorkflowState;
  manifest: ProjectManifest;
  currentBlueprint: Blueprint;
  candidateBlueprint: Blueprint;
  newCharacters: Array<ProjectManifest["characters"][number] & { core_concept: string; relationship_summary?: string | undefined }>;
  affectedArtifactIds: string[];
  reviseWorld: boolean;
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
  blueprintRevision: string;
  placeholderArtifacts: Array<{ id: string; revision: string; contract?: string }>;
  candidate?: {
    artifactId: string;
    path: string;
    revision: string;
    version: number;
    baseProjectRevision: string;
    baseBlueprintRevision: string;
  };
}): WorkflowState {
  if (!["semantic_review", "content_review", "compile_preview", "publish_review", "published"].includes(options.state.stage)) {
    workflowFail("CHARACTER_EXPANSION_STAGE_DENIED", `stage ${options.state.stage} 不可新增角色`);
  }
  if (options.state.tasks.some((item) => activeTaskStatuses.has(item.status))) workflowFail("CHARACTER_EXPANSION_TASK_ACTIVE", "專案仍有 active task，不可新增角色");
  if (!options.state.tasks.some((item) => item.kind === "review-character" && item.status === "completed")) {
    workflowFail("CHARACTER_EXPANSION_REVIEW_REQUIRED", "新增角色前必須先有完成的 Character Review");
  }
  if (expansionRun(options.state) && options.state.stage !== "published") workflowFail("CHARACTER_EXPANSION_RUN_ACTIVE", "已有 active character expansion run");
  if (options.state.decisions.some((item) => item.id === `character-expansion-${options.runId}`)) {
    workflowFail("CHARACTER_EXPANSION_RUN_EXISTS", `Character expansion run 已存在：${options.runId}`);
  }
  validateExpansionCandidate(options);
  const selected = new Set(options.affectedArtifactIds);
  if (selected.size !== options.affectedArtifactIds.length) workflowFail("CHARACTER_EXPANSION_TARGET_INVALID", "affected artifact 不得重複");
  const valid = new Map(options.state.artifacts.filter((item) => item.revision && !["missing", "stale"].includes(item.status)).map((item) => [item.id, item]));
  const relationshipArtifactId = authorArtifactId("relationships.yaml");
  const existingTargets = new Set([
    ...characterArtifactTargets(options.currentBlueprint).map((item) => item.artifactId),
    ...(options.currentBlueprint.relationships.enabled ? [relationshipArtifactId] : []),
  ]);
  for (const id of selected) {
    if (!existingTargets.has(id)) workflowFail("CHARACTER_EXPANSION_TARGET_INVALID", `affected artifact 非既有角色 exact artifact：${id}`);
    if (!valid.has(id)) workflowFail("CHARACTER_EXPANSION_TARGET_STALE", `affected artifact 缺少有效 exact revision：${id}`);
  }
  const metadata = characterExpansionRunSchema.parse({
    schema_version: options.candidate ? 2 : 1,
    run_id: options.runId,
    original_character_ids: options.manifest.characters.map((item) => item.id),
    new_characters: options.newCharacters.map((item) => ({
      id: item.id,
      display_name: item.display_name,
      mode: item.mode,
      role: item.role,
    })),
    affected_artifact_ids: options.affectedArtifactIds,
    revise_world: options.reviseWorld,
    base_world: options.currentBlueprint.world,
    base_relationships_enabled: options.currentBlueprint.relationships.enabled,
    base_relationship_character_ids: options.currentBlueprint.relationships.character_ids,
    ...(options.candidate ? {
      candidate_artifact_id: options.candidate.artifactId,
      candidate_path: options.candidate.path,
      candidate_revision: options.candidate.revision,
      candidate_version: options.candidate.version,
      base_project_revision: options.candidate.baseProjectRevision,
      base_blueprint_revision: options.candidate.baseBlueprintRevision,
      materialized: false,
    } : {}),
  });
  const artifactInputs = [...selected].map((id) => {
    const item = valid.get(id)!;
    return { id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) };
  });
  const nextArtifacts = (options.candidate
    ? options.state.artifacts
    : options.state.artifacts.filter((item) => item.id !== "blueprint" && !options.placeholderArtifacts.some((added) => added.id === item.id)))
    .map((item) => options.candidate ? item : item.id.startsWith("preview-") ? { ...item, status: "stale" as const } : item);
  return workflowStateSchema.parse({
    ...options.state,
    stage: "blueprint",
    revision: options.state.revision + 1,
    artifacts: [
      ...nextArtifacts,
      ...(options.candidate
        ? [{ id: options.candidate.artifactId, status: "draft" as const, revision: options.candidate.revision, updated_at: options.occurredAt, extensions: { candidate_path: options.candidate.path } }]
        : [
            { id: "blueprint", status: "draft" as const, revision: options.blueprintRevision, updated_at: options.occurredAt, extensions: {} },
            ...options.placeholderArtifacts.map((item) => ({ ...item, status: "draft" as const, updated_at: options.occurredAt, extensions: {} })),
          ]),
    ],
    gates: options.state.gates.map((gate) => options.candidate && gate.id !== "blueprint"
      ? gate
      : gate.id === "facts" ? gate : { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }),
    decisions: [...options.state.decisions, {
      id: `character-expansion-${options.runId}`,
      kind: "character.expansion.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: artifactInputs,
      summary: options.reason,
      extensions: { run_id: options.runId, new_character_ids: options.newCharacters.map((item) => item.id), affected_artifact_ids: options.affectedArtifactIds, revise_world: options.reviseWorld },
    }],
    extensions: { ...options.state.extensions, character_expansion: metadata },
  });
}

export function updateCharacterExpansionBlueprint(options: {
  state: WorkflowState;
  manifest: ProjectManifest;
  currentBlueprint: Blueprint;
  candidateBlueprint: Blueprint;
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
  blueprintRevision: string;
  candidate?: { artifactId: string; path: string; revision: string; version: number };
}): WorkflowState {
  if (options.state.stage !== "blueprint") workflowFail("CHARACTER_EXPANSION_UPDATE_STAGE_DENIED", "expansion candidate 只能在 blueprint stage 修訂");
  const metadata = expansionRun(options.state);
  if (!metadata || metadata.run_id !== options.runId) workflowFail("CHARACTER_EXPANSION_RUN_MISMATCH", "找不到指定的 active expansion run");
  if (options.candidate && metadata.schema_version !== 2) workflowFail("CHARACTER_EXPANSION_LEGACY_RUN", "V1 materialized expansion 不可自動改寫為 V2 candidate");
  if (options.state.tasks.some((item) => item.extensions.expansion_run_id === options.runId)) workflowFail("CHARACTER_EXPANSION_UPDATE_TASKS_EXIST", "Creator tasks 建立後不可修訂 expansion Blueprint");
  const originalCharacters = options.manifest.characters.filter((item) => metadata.original_character_ids.includes(item.id));
  validateExpansionCandidate({
    manifest: { ...options.manifest, characters: originalCharacters },
    currentBlueprint: { ...options.currentBlueprint, world: metadata.base_world, characters: options.currentBlueprint.characters.filter((item) => metadata.original_character_ids.includes(item.id)) },
    candidateBlueprint: options.candidateBlueprint,
    newCharacters: metadata.new_characters.map((item) => {
      const current = options.currentBlueprint.characters.find((character) => character.id === item.id)!;
      return { ...item, core_concept: current.core_concept, ...(current.relationship_summary ? { relationship_summary: current.relationship_summary } : {}) };
    }),
    reviseWorld: metadata.revise_world,
    enforceNewConcept: false,
  });
  return workflowStateSchema.parse({
    ...options.state,
    revision: options.state.revision + 1,
    artifacts: options.candidate
      ? [
          ...options.state.artifacts.map((item) => item.id === (metadata.schema_version === 2 ? metadata.candidate_artifact_id : "") ? { ...item, status: "stale" as const } : item),
          { id: options.candidate.artifactId, status: "draft" as const, revision: options.candidate.revision, updated_at: options.occurredAt, extensions: { candidate_path: options.candidate.path } },
        ]
      : options.state.artifacts.map((item) => item.id === "blueprint"
          ? { ...item, status: "draft" as const, revision: options.blueprintRevision, updated_at: options.occurredAt }
          : item),
    gates: options.state.gates.map((gate) => gate.id === "blueprint"
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    decisions: [...options.state.decisions, {
      id: `character-expansion-blueprint-${options.runId}-${options.state.revision + 1}`,
      kind: "character.expansion.blueprint_updated",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: [{ id: options.candidate?.artifactId ?? "blueprint", revision: options.candidate?.revision ?? options.blueprintRevision }],
      summary: options.reason,
      extensions: { run_id: options.runId },
    }],
    extensions: options.candidate ? {
      ...options.state.extensions,
      character_expansion: {
        ...metadata,
        candidate_artifact_id: options.candidate.artifactId,
        candidate_path: options.candidate.path,
        candidate_revision: options.candidate.revision,
        candidate_version: options.candidate.version,
      },
    } : options.state.extensions,
  });
}

const activeTaskStatuses = new Set(["pending", "claimed", "failed", "retryable", "needs_user_decision"]);

function authorArtifactId(relativePath: string): string {
  return relativePath === "blueprint.yaml" ? "blueprint" : `author-${relativePath.replace(/[^a-z0-9._-]+/gu, "-")}`;
}

export function beginCharacterRevision(options: {
  state: WorkflowState;
  blueprint: Blueprint;
  runId: string;
  reason: string;
  artifactIds: string[];
  occurredAt: string;
  actor: string;
}): WorkflowState {
  if (!["semantic_review", "content_review", "compile_preview", "publish_review", "published"].includes(options.state.stage)) {
    workflowFail("CHARACTER_REVISION_STAGE_DENIED", `stage ${options.state.stage} 不可開始角色修訂`);
  }
  if (options.state.tasks.some((item) => activeTaskStatuses.has(item.status))) {
    workflowFail("CHARACTER_REVISION_TASK_ACTIVE", "專案仍有 active task，不可開始角色修訂");
  }
  if (!options.state.tasks.some((item) => item.kind === "review-character" && item.status === "completed")) {
    workflowFail("CHARACTER_REVISION_REVIEW_REQUIRED", "角色修訂前必須先有完成的 Character Review");
  }
  const selected = new Set(options.artifactIds);
  if (selected.size === 0 || selected.size !== options.artifactIds.length) {
    workflowFail("CHARACTER_REVISION_TARGET_INVALID", "角色修訂必須指定至少一個且不得重複的 artifact ID");
  }
  const validArtifacts = options.state.artifacts.filter((item) => item.revision && !["missing", "stale"].includes(item.status));
  const artifactById = new Map(validArtifacts.map((item) => [item.id, item]));
  const targets: Array<{
    artifactId: string;
    characterId?: string;
    agent: string;
    kind: string;
    outputKind: string;
    module?: string;
  }> = options.blueprint.characters.flatMap((character) => {
    const agent = character.mode === "zhuji" ? "zhuji-creator" : "palette-creator";
    const files = character.mode === "zhuji" ? zhujiModuleFiles : paletteModuleFiles;
    return [
      {
        artifactId: authorArtifactId(`characters/${character.id}/character.yaml`),
        characterId: character.id,
        agent,
        kind: "create-character",
        outputKind: "character",
      },
      ...files.map((file) => ({
        artifactId: authorArtifactId(`characters/${character.id}/${character.mode}/${file.file}`),
        characterId: character.id,
        agent,
        kind: "create-character-module",
        outputKind: character.mode,
        module: file.kind,
      })),
    ];
  }).filter((target) => selected.has(target.artifactId));
  const relationshipArtifactId = authorArtifactId("relationships.yaml");
  if (options.blueprint.relationships.enabled && selected.has(relationshipArtifactId)) {
    targets.push({ artifactId: relationshipArtifactId, agent: "relationship-creator", kind: "create-relationships", outputKind: "relationships" });
  }
  if (targets.length !== selected.size) {
    workflowFail("CHARACTER_REVISION_TARGET_INVALID", "角色修訂 target 必須是目前 Blueprint 中的角色、角色模組或 relationships artifact");
  }
  for (const target of targets) {
    if (!artifactById.has(target.artifactId)) {
      workflowFail("CHARACTER_REVISION_TARGET_STALE", `角色修訂 target 缺少有效 exact revision：${target.artifactId}`);
    }
  }
  const inputArtifacts = validArtifacts.map((item) => ({
    id: item.id,
    revision: item.revision!,
    ...(item.contract ? { contract: item.contract } : {}),
  }));
  const previousByCharacter = new Map<string, string>();
  const revisionTasks = targets.map((target) => {
    const relationshipTarget = target.outputKind === "relationships";
    const suffix = target.module ?? "character";
    const taskId = relationshipTarget ? `revise-relationships-${options.runId}` : `revise-${target.characterId}-${suffix}-${options.runId}`;
    const previous = target.characterId === undefined ? undefined : previousByCharacter.get(target.characterId);
    if (target.characterId !== undefined) previousByCharacter.set(target.characterId, taskId);
    return workflowTaskSchema.parse({
      id: taskId,
      kind: target.kind,
      status: "pending",
      assigned_agent: target.agent,
      capabilities: ["task.execute", relationshipTarget ? "relationships.propose" : "character.propose", "task.clarify"],
      input_artifacts: inputArtifacts,
      output_contract: "proposal@1",
      dependencies: previous === undefined ? [] : [previous],
      attempt: 0,
      max_attempts: 3,
      extensions: {
        ...(target.characterId === undefined ? {} : { character_id: target.characterId }),
        output_kind: target.outputKind,
        ...(relationshipTarget ? { participant_ids: options.blueprint.relationships.character_ids } : {}),
        ...(target.module === undefined ? {} : { module: target.module }),
        stage: "authoring",
        revision_run_id: options.runId,
        target_artifact_id: target.artifactId,
      },
    });
  });
  const taskIds = new Set(revisionTasks.map((item) => item.id));
  if (options.state.tasks.some((item) => taskIds.has(item.id) || item.id === `review-characters-${options.runId}` || item.id === `revise-greetings-${options.runId}` || item.id === `review-greetings-${options.runId}`)) {
    workflowFail("CHARACTER_REVISION_RUN_EXISTS", `Character revision run 已存在：${options.runId}`);
  }
  const selectedRevisions = targets.map((target) => {
    const artifact = artifactById.get(target.artifactId)!;
    return { id: artifact.id, revision: artifact.revision!, ...(artifact.contract ? { contract: artifact.contract } : {}) };
  });
  return workflowStateSchema.parse({
    ...options.state,
    stage: "authoring",
    revision: options.state.revision + 1,
    tasks: [...options.state.tasks, ...revisionTasks],
    artifacts: options.state.artifacts.map((item) => item.id.startsWith("preview-") ? { ...item, status: "stale" as const } : item),
    gates: options.state.gates.map((gate) => ["content", "publish"].includes(gate.id)
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    decisions: [...options.state.decisions, {
      id: `character-revision-${options.runId}`,
      kind: "character.revision.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: selectedRevisions,
      summary: options.reason,
      extensions: { run_id: options.runId, task_ids: revisionTasks.map((item) => item.id), artifact_ids: options.artifactIds },
    }],
    extensions: {
      ...options.state.extensions,
      character_revision_run_id: options.runId,
      ...(options.blueprint.greetings.enabled ? { greetings_revision_run_id: options.runId } : {}),
    },
  });
}

export function beginScopedContentRevision(options: {
  state: WorkflowState;
  blueprint: Blueprint;
  worldEntries: WorldEntry[];
  scope: "character" | "relationship" | "world" | "greetings";
  runId: string;
  reason: string;
  artifactIds: string[];
  occurredAt: string;
  actor: string;
}): WorkflowState {
  if (options.scope === "world") {
    return beginWorldRevision({
      state: options.state,
      blueprint: options.blueprint,
      worldEntries: options.worldEntries,
      runId: options.runId,
      reason: options.reason,
      artifactIds: options.artifactIds,
      occurredAt: options.occurredAt,
      actor: options.actor,
    });
  }
  if (options.scope === "greetings") {
    if (options.artifactIds.length > 0) {
      workflowFail("CONTENT_REVISION_TARGET_INVALID", "Greeting revision 不接受 artifact IDs");
    }
    return beginGreetingsRevision({
      state: options.state,
      runId: options.runId,
      reason: options.reason,
      occurredAt: options.occurredAt,
      actor: options.actor,
    });
  }
  return beginCharacterRevision({
    state: options.state,
    blueprint: options.blueprint,
    runId: options.runId,
    reason: options.reason,
    artifactIds: options.artifactIds,
    occurredAt: options.occurredAt,
    actor: options.actor,
  });
}

export function beginCharacterReviewRetry(options: {
  state: WorkflowState;
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
}): WorkflowState {
  const failedReviews = options.state.tasks.filter((item) => item.kind === "review-character" && item.status === "failed");
  if (failedReviews.length === 0) {
    workflowFail("CHARACTER_REVIEW_RETRY_NOT_REQUIRED", "沒有失敗的角色審查 task");
  }
  const target = failedReviews.at(-1)!;
  if (target.failure === undefined) {
    workflowFail("TASK_RECOVERY_FAILURE_UNCLASSIFIED", `legacy task ${target.id} 沒有 typed failure category`);
  }
  return beginTaskRecovery({
    ...options,
    taskId: target.id,
    failureCategory: target.failure.category,
  });
}

const recoverableFailureCategories = new Set<TaskFailureCategory>([
  "provider_timeout",
  "tool_failure",
  "context_limit",
  "session_interruption",
  "temporary_unavailable",
]);

const recoveryStagesByKind: Record<string, ReadonlySet<WorkflowStage>> = {
  "create-blueprint": new Set(["blueprint"]),
  "analyze-import": new Set(["blueprint"]),
  "create-character": new Set(["authoring"]),
  "create-character-module": new Set(["authoring"]),
  "create-relationships": new Set(["authoring"]),
  "create-world": new Set(["pre_world_authoring", "post_world_authoring", "authoring"]),
  "review-world": new Set(["pre_world_review", "post_world_review", "content_review"]),
  "review-character": new Set(["semantic_review"]),
  "create-greetings": new Set(["greetings_authoring"]),
  "review-greetings": new Set(["content_review"]),
};

const recoveryEntriesByKind: Partial<Record<string, ReadonlySet<WorkflowState["entry_kind"]>>> = {
  "create-blueprint": new Set(["original", "source_adaptation", "card_import"]),
  "analyze-import": new Set(["card_import"]),
};

const genericRecoveryEntries = new Set<WorkflowState["entry_kind"]>(["original", "source_adaptation", "card_import"]);

export interface BeginTaskRecoveryOptions {
  state: WorkflowState;
  taskId: string;
  runId: string;
  failureCategory: TaskFailureCategory;
  reason: string;
  occurredAt: string;
  actor: string;
}

export function beginTaskRecovery(options: BeginTaskRecoveryOptions): WorkflowState {
  const { state } = options;
  if (options.actor !== "director") workflowFail("TASK_RECOVERY_DENIED", "Only the Director may recover a task");
  if (state.outcome?.status === "closed") workflowFail("WORKFLOW_CLOSED", `Workflow is closed with outcome ${state.outcome.kind}`);
  const target = state.tasks.find((task) => task.id === options.taskId);
  if (target?.status !== "failed") workflowFail("TASK_RECOVERY_TARGET_NOT_FAILED", `task ${options.taskId} is not failed`);
  if (target.attempt < target.max_attempts) workflowFail("TASK_RECOVERY_ATTEMPTS_NOT_EXHAUSTED", `task ${target.id} has attempts remaining`);
  if (target.extensions.recovery_of !== undefined || target.extensions.recovery_generation !== undefined
    || state.tasks.some((task) => task.extensions.recovery_of === target.id)) {
    workflowFail("TASK_RECOVERY_LINEAGE_EXISTS", `task ${target.id} recovery lineage already exists`);
  }
  if (!recoverableFailureCategories.has(options.failureCategory)
    || (target.failure !== undefined && target.failure.category !== options.failureCategory)) {
    workflowFail("TASK_RECOVERY_FAILURE_NOT_RECOVERABLE", `task ${target.id} failure category is not recoverable or does not match`);
  }
  if (!genericRecoveryEntries.has(state.entry_kind)) {
    workflowFail("TASK_RECOVERY_STAGE_UNSUPPORTED", `entry ${state.entry_kind} does not support task recovery`);
  }
  const stages = recoveryStagesByKind[target.kind];
  const entries = recoveryEntriesByKind[target.kind];
  const persistedStage = target.extensions.stage;
  if (stages === undefined || !stages.has(state.stage)
    || (entries !== undefined && !entries.has(state.entry_kind))
    || (persistedStage !== undefined && persistedStage !== state.stage)) {
    workflowFail("TASK_RECOVERY_STAGE_UNSUPPORTED", `task ${target.id} is not compatible with stage ${state.stage}`);
  }
  const occurredAt = new Date(options.occurredAt).getTime();
  if (state.tasks.some((task) => task.status === "claimed" && task.lease !== undefined
    && new Date(task.lease.expires_at).getTime() > occurredAt)) {
    workflowFail("TASK_RECOVERY_ACTIVE_LEASE", "workflow has an active task lease");
  }
  const directDependents = state.tasks.filter((task) => task.dependencies.includes(target.id));
  if (directDependents.some((task) => task.status !== "pending")) {
    workflowFail("TASK_RECOVERY_GRAPH_INVALID", `task ${target.id} has a non-pending direct dependent`);
  }
  const successorId = `recover-${options.runId}`;
  const decisionId = `task-recovery-${options.runId}`;
  if (state.tasks.some((task) => task.id === successorId) || state.decisions.some((decision) => decision.id === decisionId)) {
    workflowFail("TASK_RECOVERY_ID_CONFLICT", `recovery run ${options.runId} conflicts with an existing ID`);
  }
  const successor = workflowTaskSchema.parse({
    id: successorId,
    kind: target.kind,
    status: "pending",
    assigned_agent: target.assigned_agent,
    capabilities: target.capabilities,
    input_artifacts: target.input_artifacts,
    output_contract: target.output_contract,
    dependencies: target.dependencies,
    attempt: 0,
    max_attempts: 1,
    extensions: {
      ...target.extensions,
      recovery_of: target.id,
      recovery_run_id: options.runId,
      recovery_generation: 1,
      recovery_input_strategy: "same_snapshot",
    },
  });
  const rewiredIds = new Set(directDependents.map((task) => task.id));
  return workflowStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    tasks: [
      ...state.tasks.map((task) => task.id === target.id
        ? { ...task, status: "superseded" as const, lease: undefined }
        : rewiredIds.has(task.id)
          ? { ...task, dependencies: task.dependencies.map((dependency) => dependency === target.id ? successorId : dependency) }
          : task),
      successor,
    ],
    decisions: [...state.decisions, {
      id: decisionId,
      kind: "task.recovery.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: target.input_artifacts,
      summary: options.reason,
      extensions: {
        run_id: options.runId,
        task_id: target.id,
        successor_task_id: successorId,
        failure_category: options.failureCategory,
        rewired_task_ids: directDependents.map((task) => task.id),
        recovery_generation: 1,
        recovery_input_strategy: "same_snapshot",
      },
    }],
  });
}

export function resumeTaskAfterRepair(options: {
  state: WorkflowState;
  taskId: string;
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
}): WorkflowState {
  if (options.actor !== "director") workflowFail("TASK_REPAIR_RESUME_DENIED", "只有 Director 可在修復後續接 task");
  if (options.state.outcome?.status === "closed") workflowFail("WORKFLOW_CLOSED", "closed workflow 不可續接 task");
  const target = options.state.tasks.find((task) => task.id === options.taskId);
  if (!target || target.status !== "needs_user_decision" || target.extensions.recovery_exhausted !== true
    || target.extensions.recovery_generation !== 1 || typeof target.extensions.recovery_of !== "string") {
    workflowFail("TASK_REPAIR_RESUME_TARGET_INVALID", `task ${options.taskId} 不是已耗盡 recovery 的待決 task`);
  }
  if (target.extensions.repair_resume_count !== undefined) {
    workflowFail("TASK_REPAIR_RESUME_EXHAUSTED", `task ${options.taskId} 已使用修復後續接`);
  }
  if ((target.clarifications ?? []).some((item) => item.status === "pending")) {
    workflowFail("TASK_REPAIR_RESUME_CLARIFICATION_PENDING", `task ${options.taskId} 仍有待處理 clarification`);
  }
  if (options.state.tasks.some((task) => task.id !== target.id && task.status === "claimed" && task.lease !== undefined
    && new Date(task.lease.expires_at).getTime() > new Date(options.occurredAt).getTime())) {
    workflowFail("TASK_REPAIR_RESUME_ACTIVE_LEASE", "專案仍有 active lease，不可續接修復 task");
  }
  const decisionId = `task-repair-resume-${options.runId}`;
  if (options.state.decisions.some((decision) => decision.id === decisionId)) {
    workflowFail("TASK_REPAIR_RESUME_ID_CONFLICT", `修復續接 run 已存在：${options.runId}`);
  }
  const priorFailure = target.failure;
  return workflowStateSchema.parse({
    ...options.state,
    revision: options.state.revision + 1,
    tasks: options.state.tasks.map((task) => task.id === target.id ? {
      ...task,
      status: "pending",
      lease: undefined,
      failure: undefined,
      failure_summary: undefined,
      resume_without_attempt: true,
      extensions: {
        ...task.extensions,
        repair_resume_count: 1,
        repair_resume_run_id: options.runId,
      },
    } : task),
    decisions: [...options.state.decisions, {
      id: decisionId,
      kind: "task.repair_resumed",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: target.input_artifacts,
      summary: options.reason,
      extensions: {
        run_id: options.runId,
        task_id: target.id,
        recovery_of: target.extensions.recovery_of,
        prior_failure_category: priorFailure?.category,
        prior_failure_summary: priorFailure?.summary ?? target.failure_summary,
      },
    }],
  });
}

export function beginGreetingsRevision(options: {
  state: WorkflowState;
  runId: string;
  reason: string;
  occurredAt: string;
  actor: string;
}): WorkflowState {
  if (!["content_review", "compile_preview", "publish_review", "published"].includes(options.state.stage)) {
    workflowFail("GREETINGS_REVISION_STAGE_DENIED", `stage ${options.state.stage} 不可開始 Greeting 修訂`);
  }
  if (options.state.tasks.some((item) => activeTaskStatuses.has(item.status))) {
    workflowFail("GREETINGS_REVISION_TASK_ACTIVE", "專案仍有 active task，不可開始 Greeting 修訂");
  }
  const taskId = `revise-greetings-${options.runId}`;
  const reviewTaskId = `review-greetings-${options.runId}`;
  if (options.state.tasks.some((item) => item.id === taskId || item.id === reviewTaskId)) {
    workflowFail("GREETINGS_REVISION_RUN_EXISTS", `Greeting revision run 已存在：${options.runId}`);
  }
  const inputArtifacts = options.state.artifacts
    .filter((item) => item.revision && !["missing", "stale"].includes(item.status))
    .map((item) => ({ id: item.id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) }));
  const revisionTask = workflowTaskSchema.parse({
    id: taskId,
    kind: "create-greetings",
    status: "pending",
    assigned_agent: "greetings-creator",
    capabilities: ["task.execute", "greetings.propose", "task.clarify"],
    input_artifacts: inputArtifacts,
    output_contract: "proposal@1",
    dependencies: [],
    attempt: 0,
    max_attempts: 3,
    extensions: { output_kind: "greetings", stage: "greetings_authoring", revision_run_id: options.runId },
  });
  return workflowStateSchema.parse({
    ...options.state,
    stage: "greetings_authoring",
    revision: options.state.revision + 1,
    tasks: [...options.state.tasks, revisionTask],
    artifacts: options.state.artifacts.map((item) => item.id.startsWith("preview-") ? { ...item, status: "stale" as const } : item),
    gates: options.state.gates.map((gate) => ["content", "publish"].includes(gate.id)
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    decisions: [...options.state.decisions, {
      id: `greetings-revision-${options.runId}`,
      kind: "greetings.revision.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: inputArtifacts,
      summary: options.reason,
      extensions: { run_id: options.runId, task_id: taskId },
    }],
    extensions: { ...options.state.extensions, greetings_revision_run_id: options.runId },
  });
}

export function beginWorldAuthoring(options: {
  state: WorkflowState;
  blueprint: Blueprint;
  world: Blueprint["world"];
  runId: string;
  occurredAt: string;
}): { state: WorkflowState; blueprint: Blueprint } {
  if (options.state.stage !== "published") {
    workflowFail("WORLD_AUTHORING_PROJECT_NOT_PUBLISHED", "只有 published 專案可補世界設定");
  }
  if (options.state.tasks.some((item) => activeTaskStatuses.has(item.status))) {
    workflowFail("WORLD_AUTHORING_TASK_ACTIVE", "專案仍有 active task，不可開始補世界設定");
  }
  if (!options.world.enabled) workflowFail("WORLD_AUTHORING_DELETE_FORBIDDEN", "補世界設定不可停用或刪除 world");
  const inputArtifacts: ArtifactReference[] = options.state.artifacts
    .filter((item) => item.revision && !["missing", "stale"].includes(item.status))
    .map((item) => ({ id: item.id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) }));
  const taskId = `create-world-${options.runId}`;
  if (options.state.tasks.some((item) => item.id === taskId)) {
    workflowFail("WORLD_AUTHORING_RUN_EXISTS", `world authoring run 已存在：${options.runId}`);
  }
  const nextBlueprint = blueprintSchema.parse({ ...options.blueprint, world: options.world });
  const nextState = workflowStateSchema.parse({
    ...options.state,
    stage: "authoring",
    revision: options.state.revision + 1,
    artifacts: options.state.artifacts.map((item) =>
      item.id.startsWith("preview-") && item.status !== "stale" ? { ...item, status: "stale" as const } : item),
    gates: options.state.gates.map((gate) =>
      gate.id === "content" || gate.id === "publish"
        ? { id: gate.id, status: "pending" as const, input_revisions: [], extensions: {} }
        : gate),
    tasks: [...options.state.tasks, {
      id: taskId,
      kind: "create-world",
      status: "pending",
      assigned_agent: "world-lore-creator",
      capabilities: ["task.execute", "world.propose", "task.clarify"],
      input_artifacts: inputArtifacts,
      output_contract: "proposal@1",
      dependencies: [],
      attempt: 0,
      max_attempts: 3,
      extensions: { stage: "authoring", output_kind: "world", world_authoring_run_id: options.runId },
    }],
    extensions: {
      ...options.state.extensions,
      world_only_run: true,
      world_authoring_run_id: options.runId,
    },
  });
  return { state: nextState, blueprint: nextBlueprint };
}

export function beginWorldRevision(options: {
  state: WorkflowState;
  blueprint: Blueprint;
  worldEntries: WorldEntry[];
  runId: string;
  reason: string;
  artifactIds: string[];
  occurredAt: string;
  actor: string;
}): WorkflowState {
  if (!["pre_world_review", "post_world_review", "semantic_review", "content_review", "compile_preview", "publish_review", "published"].includes(options.state.stage)) {
    workflowFail("WORLD_REVISION_STAGE_DENIED", `stage ${options.state.stage} 不可開始世界修訂`);
  }
  if (options.state.tasks.some((item) => activeTaskStatuses.has(item.status))) {
    workflowFail("WORLD_REVISION_TASK_ACTIVE", "專案仍有 active task，不可開始世界修訂");
  }
  if (!options.state.tasks.some((item) => item.kind === "review-world" && item.status === "completed")) {
    workflowFail("WORLD_REVISION_REVIEW_REQUIRED", "世界修訂前必須先有完成的 World Review");
  }
  const selected = new Set(options.artifactIds);
  if (selected.size === 0 || selected.size !== options.artifactIds.length) {
    workflowFail("WORLD_REVISION_TARGET_INVALID", "世界修訂必須指定至少一個且不得重複的 artifact ID");
  }
  const validArtifacts = options.state.artifacts.filter((item) => item.revision && !["missing", "stale"].includes(item.status));
  const artifactById = new Map(validArtifacts.map((item) => [item.id, item]));
  const targets = options.worldEntries.map((entry) => ({
    artifactId: authorArtifactId(`world/${entry.category}/${entry.id}.yaml`),
    entry,
  })).filter((target) => selected.has(target.artifactId));
  if (targets.length !== selected.size) {
    workflowFail("WORLD_REVISION_TARGET_INVALID", "世界修訂 target 必須是目前專案中的 world artifact");
  }
  for (const target of targets) {
    if (!artifactById.has(target.artifactId)) {
      workflowFail("WORLD_REVISION_TARGET_STALE", `世界修訂 target 缺少有效 exact revision：${target.artifactId}`);
    }
  }
  const inputArtifacts = validArtifacts.map((item) => ({
    id: item.id,
    revision: item.revision!,
    ...(item.contract ? { contract: item.contract } : {}),
  }));
  const revisionStage = options.state.stage === "pre_world_review" ? "pre_world_authoring" : "authoring";
  let previous: string | undefined;
  const revisionTasks = targets.map((target) => {
    const taskId = `revise-world-${target.entry.category}-${target.entry.id}-${options.runId}`;
    const task = workflowTaskSchema.parse({
      id: taskId,
      kind: "create-world",
      status: "pending",
      assigned_agent: "world-lore-creator",
      capabilities: ["task.execute", "world.propose", "task.clarify"],
      input_artifacts: inputArtifacts,
      output_contract: "proposal@1",
      dependencies: previous === undefined ? [] : [previous],
      attempt: 0,
      max_attempts: 3,
      extensions: {
        stage: revisionStage,
        output_kind: "world",
        world_category: target.entry.category,
        world_entry_id: target.entry.id,
        revision_run_id: options.runId,
        target_artifact_id: target.artifactId,
      },
    });
    previous = taskId;
    return task;
  });
  const taskIds = new Set(revisionTasks.map((item) => item.id));
  if (options.state.tasks.some((item) => taskIds.has(item.id) || item.id === `review-world-${options.runId}`)) {
    workflowFail("WORLD_REVISION_RUN_EXISTS", `World revision run 已存在：${options.runId}`);
  }
  const selectedRevisions = targets.map((target) => {
    const artifact = artifactById.get(target.artifactId)!;
    return { id: artifact.id, revision: artifact.revision!, ...(artifact.contract ? { contract: artifact.contract } : {}) };
  });
  const reviewStage = options.state.stage === "pre_world_review" ? "pre_world_review" : "post_world_review";
  return workflowStateSchema.parse({
    ...options.state,
    stage: revisionStage,
    revision: options.state.revision + 1,
    tasks: [...options.state.tasks, ...revisionTasks],
    artifacts: options.state.artifacts.map((item) => item.id.startsWith("preview-") ? { ...item, status: "stale" as const } : item),
    gates: options.state.gates.map((gate) => ["content", "publish"].includes(gate.id)
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    decisions: [...options.state.decisions, {
      id: `world-revision-${options.runId}`,
      kind: "world.revision.requested",
      actor: options.actor,
      decided_at: options.occurredAt,
      input_revisions: selectedRevisions,
      summary: options.reason,
      extensions: { run_id: options.runId, task_ids: revisionTasks.map((item) => item.id), artifact_ids: options.artifactIds },
    }],
    extensions: (() => {
      const ext = {
        ...options.state.extensions,
        world_revision_run_id: options.runId,
        world_revision_review_stage: reviewStage,
      } as Record<string, unknown>;
      if (reviewStage === "post_world_review" && options.blueprint.greetings.enabled) {
        ext.greetings_revision_run_id = options.runId;
      } else {
        delete ext.greetings_revision_run_id;
      }
      return ext;
    })(),
  });
}
