import {
  artifactReferenceSchema,
  blueprintPrecheckCheckSchema,
  blueprintSchema,
  blueprintWorldSchema,
  projectManifestSchema,
  taskFailureCategorySchema,
  taskClarificationOptionSchema,
  workflowStateSchema,
  workflowTaskSchema,
  type WorkflowTask,
} from "@card-workspace/schemas";
import {
  readSourceManifest,
  getSourceRevision,
  verifyProvenance,
} from "@card-workspace/ingestion";
import {
  claimTask,
  commitWorkflowMutation,
  advanceConfiguredWorkflow,
  beginCharacterRevision,
  beginScopedContentRevision,
  beginCharacterExpansion,
  beginCharacterReviewRetry,
  beginFactsRecuration,
  beginTaskRecovery,
  beginGreetingsRevision,
  beginWorldAuthoring,
  beginWorldRevision,
  beginSourceProcessingRepair,
  updateCharacterExpansionBlueprint,
  decideGate,
  deriveGateSnapshot,
  markTaskFailed,
  leaseIsExpired,
  requestTaskClarification,
  resolveTaskClarification,
  resumeTaskAfterRepair,
  startConfiguredWorkflow,
  submitTask,
} from "@card-workspace/workflow";
import {
  canonicalYaml,
  canonicalJson,
  computeRevision,
  computeTextRevision,
  createCharacterPlaceholderOperations,
  createRelationshipsPlaceholder,
  legacyZhujiModuleFiles,
  loadAuthorProject,
  paletteModuleFiles,
  resolveExistingWithin,
  zhujiModuleFiles,
  type LoadedAuthorProject,
} from "@card-workspace/project";
import { z } from "zod";

import { mcpFail } from "../errors.js";
import { readFactsReadiness } from "./fact-readiness.js";
import { loadCardInspection } from "./card-import.js";
import { numberArg, objectArg, stringArg, type ToolCallContext } from "./types.js";

const intakeAnswersSchema = z.array(z.object({
  decision_id: z.string().min(1),
  question_id: z.string().min(1),
  answer: z.string().min(1),
}).strict());

const intakeCompletionSchema = z.object({
  decision_id: z.string().min(1),
  answer: z.string().min(1),
  confirmed_no_additional_settings: z.literal(true),
}).strict();

const expansionCharacterSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u),
  display_name: z.string().min(1),
  mode: z.enum(["zhuji", "palette"]),
  core_concept: z.string().min(1),
  relationship_summary: z.string().min(1).optional(),
  role: z.enum(["primary", "supporting"]).default("supporting"),
}).strict();

const expansionBeginSchema = z.object({
  run_id: z.string().min(1),
  reason: z.string().min(1),
  new_title: z.string().min(1).optional(),
  new_characters: z.array(expansionCharacterSchema).min(1),
  candidate_blueprint: blueprintSchema,
  affected_artifact_ids: z.array(z.string().min(1)).default([]),
  revise_world: z.boolean(),
}).strict();

const expansionUpdateSchema = z.object({
  run_id: z.string().min(1),
  reason: z.string().min(1),
  new_title: z.string().min(1).optional(),
  candidate_blueprint: blueprintSchema,
}).strict();

const expansionCandidateV2Schema = z.object({
  schema_version: z.literal(2),
  run_id: z.string().min(1),
  version: z.number().int().positive(),
  base_project_revision: z.string(),
  base_blueprint_revision: z.string(),
  manifest: projectManifestSchema,
  blueprint: blueprintSchema,
  new_characters: z.array(expansionCharacterSchema).min(1),
  affected_artifacts: z.array(artifactReferenceSchema),
  revise_world: z.boolean(),
}).strict();

const expansionRunV2Schema = z.object({
  schema_version: z.literal(2),
  run_id: z.string().min(1),
  candidate_artifact_id: z.string().min(1),
  candidate_path: z.string().min(1),
  candidate_revision: z.string().min(1),
  candidate_version: z.number().int().positive(),
  base_project_revision: z.string().min(1),
  base_blueprint_revision: z.string().min(1),
  materialized: z.boolean(),
}).passthrough();

const requiredPrecheckDimensions = [
  "character_core",
  "background",
  "personality",
  "relationships_boundaries",
  "world_dependencies",
  "cross_module_impact",
] as const;

function event(args: Record<string, unknown>): { eventId: string; occurredAt: string; expectedRevision: number } {
  return {
    eventId: stringArg(args, "event_id"),
    occurredAt: stringArg(args, "occurred_at"),
    expectedRevision: numberArg(args, "expected_workflow_revision"),
  };
}

function authorArtifactId(relativePath: string): string {
  return relativePath === "blueprint.yaml" ? "blueprint" : `author-${relativePath.replace(/[^a-z0-9._-]+/gu, "-")}`;
}

function taskArtifactContent(project: LoadedAuthorProject, artifactId: string, revision: string): unknown {
  const candidates = new Map<string, unknown>();
  const add = (relativePath: string, content: unknown) => {
    if (project.sourceRevisions[relativePath] === revision) candidates.set(authorArtifactId(relativePath), content);
  };
  if (project.blueprint) add("blueprint.yaml", project.blueprint);
  if (project.greetings) add("greetings.yaml", project.greetings);
  if (project.relationships) add("relationships.yaml", project.relationships);
  for (const character of project.characters) {
    add(`characters/${character.manifest.id}/character.yaml`, character.document);
    const layouts = character.manifest.mode === "palette"
      ? [paletteModuleFiles]
      : [zhujiModuleFiles, legacyZhujiModuleFiles];
    for (const layout of layouts) {
      for (const file of layout) {
        const module = character.modules.find((item) => item.module === file.kind);
        if (module) add(`characters/${character.manifest.id}/${character.manifest.mode}/${file.file}`, module);
      }
    }
  }
  for (const entry of project.world) add(`world/${entry.category}/${entry.id}.yaml`, entry);
  const content = candidates.get(artifactId);
  if (content === undefined) mcpFail("TASK_ARTIFACT_CONTEXT_UNAVAILABLE", `Task artifact content is unavailable: ${artifactId}`);
  return content;
}

function workflowStatusSummary(context: ToolCallContext, sourceRevisions: Record<string, string>) {
  const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
  const completedTaskIds = new Set(context.workflow.tasks.filter((task) => task.status === "completed").map((task) => task.id));
  const terminalStatuses = new Set(["completed", "failed", "superseded"]);
  const activeTasks = context.workflow.tasks
    .filter((task) => !terminalStatuses.has(task.status))
    .filter((task) => agent?.kind === "director" || task.assigned_agent === context.trusted.agentId)
    .map((task) => {
      const blockedBy = task.dependencies.filter((dependency) => !completedTaskIds.has(dependency));
      const leaseExpired = task.status === "claimed" && leaseIsExpired(task);
      const resumable = task.status === "claimed"
        && !leaseExpired
        && task.lease?.owner === context.trusted.agentId;
      const claimable = blockedBy.length === 0 && (
        task.status === "pending"
        || (task.status === "retryable" && task.attempt < task.max_attempts)
        || leaseExpired
      );
      return {
        id: task.id,
        kind: task.kind,
        status: task.status,
        assigned_agent: task.assigned_agent,
        output_contract: task.output_contract,
        dependencies: task.dependencies,
        blocked_by: blockedBy,
        attempt: task.attempt,
        max_attempts: task.max_attempts,
        ...(task.lease === undefined ? {} : { lease: task.lease, lease_expired: leaseExpired }),
        claimable,
        resumable,
        ...(task.clarifications === undefined ? {} : { clarifications: task.clarifications }),
        extensions: task.extensions,
      };
    });
  return {
    workflow: {
      schema_version: context.workflow.schema_version,
      project_id: context.workflow.project_id,
      workflow_definition_id: context.workflow.workflow_definition_id,
      entry_kind: context.workflow.entry_kind,
      stage: context.workflow.stage,
      revision: context.workflow.revision,
      gates: context.workflow.gates,
      ...(context.workflow.outcome === undefined ? {} : { outcome: context.workflow.outcome }),
      extensions: context.workflow.extensions,
    },
    routing: context.workflow.outcome?.status === "closed" ? "closed" : "active",
    agent_id: context.trusted.agentId,
    resumable_tasks: activeTasks.filter((task) => task.resumable),
    next_claimable_tasks: activeTasks.filter((task) => task.claimable),
    active_tasks: activeTasks,
    source_revisions: sourceRevisions,
  };
}

async function replaceTask(context: ToolCallContext, nextTask: WorkflowTask, suffix: string) {
  const input = event(context.args);
  return commitWorkflowMutation(context.projectRoot, {
    ...input,
    actor: context.trusted.agentId,
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      tasks: state.tasks.map((task) => task.id === nextTask.id ? nextTask : task),
      extensions: { ...state.extensions, last_task_event: suffix },
    }),
  });
}

export const workflowTools = {
  workflow_start: async (context: ToolCallContext) => {
    const definition = context.trusted.config.definitions.definitions.find((item) => item.id === context.workflow.workflow_definition_id);
    if (!definition || definition.entry_kind !== context.workflow.entry_kind) mcpFail("WORKFLOW_DEFINITION_MISMATCH", "Workflow state does not match configured definition");
    if (context.workflow.stage !== "intake") return context.workflow;
    const input = event(context.args);
    const answers = intakeAnswersSchema.parse(context.args.intake_answers ?? []);
    const completion = intakeCompletionSchema.parse(context.args.intake_completion);
    const initialInputArtifacts = context.workflow.entry_kind === "source_adaptation"
      ? await sourceArtifactReferences(context.projectRoot)
      : undefined;
    const next = startConfiguredWorkflow({
      state: context.workflow,
      definition,
      occurredAt: input.occurredAt,
      ...(initialInputArtifacts === undefined ? {} : { initialInputArtifacts }),
      intakeDecisions: [...answers.map((answer) => ({
        id: answer.decision_id,
        kind: "interview.answer",
        actor: context.trusted.agentId,
        decided_at: input.occurredAt,
        input_revisions: [],
        summary: answer.answer,
        extensions: { question_id: answer.question_id },
      })), {
        id: completion.decision_id,
        kind: "interview.complete",
        actor: context.trusted.agentId,
        decided_at: input.occurredAt,
        input_revisions: [],
        summary: completion.answer,
        option: "no-additional-settings",
        extensions: { question_id: "additional-settings" },
      }],
    });
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: () => next,
    });
  },
  workflow_status: async (context: ToolCallContext) => {
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (context.args.detail !== "full") return workflowStatusSummary(context, project.sourceRevisions);
    return {
      workflow: context.workflow,
      routing: context.workflow.outcome?.status === "closed" ? "closed" : "active",
      source_revisions: project.sourceRevisions,
    };
  },
  workflow_advance: async (context: ToolCallContext) => {
    const definition = context.trusted.config.definitions.definitions.find((item) => item.id === context.workflow.workflow_definition_id);
    if (!definition) mcpFail("WORKFLOW_DEFINITION_MISMATCH", "Workflow definition is unavailable");
    const input = event(context.args);
    if (context.workflow.entry_kind === "source_adaptation" && ["source_processing", "facts_review"].includes(context.workflow.stage)) {
      const next = advanceConfiguredWorkflow({ state: context.workflow, definition });
      return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
    }
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.blueprint || !project.manifest) mcpFail("BLUEPRINT_UNAVAILABLE", "A valid Blueprint and manifest are required to advance workflow");
    const relationshipRevision = project.blueprint.relationships.enabled
      ? project.sourceRevisions["relationships.yaml"]
      : undefined;
    if (project.blueprint.relationships.enabled && (!project.relationships || !relationshipRevision)) {
      mcpFail("RELATIONSHIPS_ARTIFACT_UNAVAILABLE", "Enabled relationships require an exact relationships.yaml artifact");
    }
    const runtimeState = relationshipRevision && !context.workflow.artifacts.some((artifact) =>
      artifact.id === "author-relationships.yaml" && artifact.revision === relationshipRevision && !["missing", "stale"].includes(artifact.status))
      ? workflowStateSchema.parse({
          ...context.workflow,
          artifacts: [
            ...context.workflow.artifacts.filter((artifact) => artifact.id !== "author-relationships.yaml"),
            { id: "author-relationships.yaml", status: "draft", revision: relationshipRevision, contract: "relationships@1", updated_at: input.occurredAt, extensions: {} },
          ],
        })
      : context.workflow;
    const next = advanceConfiguredWorkflow({
      state: runtimeState,
      definition,
      blueprint: project.blueprint,
      projectKind: project.manifest.kind,
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },
  world_authoring_begin: async (context: ToolCallContext) => {
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.blueprint) mcpFail("PROJECT_INVALID", "World authoring requires a valid project and Blueprint", project.diagnostics);
    const input = event(context.args);
    const begun = beginWorldAuthoring({
      state: context.workflow,
      blueprint: project.blueprint,
      world: blueprintWorldSchema.parse(context.args.world),
      runId: stringArg(context.args, "run_id"),
      occurredAt: input.occurredAt,
    });
    const blueprintRevision = project.sourceRevisions["blueprint.yaml"];
    if (!blueprintRevision) mcpFail("BLUEPRINT_UNAVAILABLE", "Blueprint source revision is unavailable");
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      operations: [{
        relativePath: "blueprint.yaml",
        content: canonicalYaml(begun.blueprint),
        expectedRawRevision: blueprintRevision,
      }],
      update: () => begun.state,
    });
  },
  world_revision_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("WORLD_REVISION_DENIED", "Only the Director may begin a World revision");
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.blueprint) mcpFail("PROJECT_INVALID", "World revision requires a valid project and Blueprint", project.diagnostics);
    const input = event(context.args);
    const next = beginWorldRevision({
      state: context.workflow,
      blueprint: project.blueprint,
      worldEntries: project.world,
      runId: stringArg(context.args, "run_id"),
      reason: stringArg(context.args, "reason"),
      artifactIds: z.array(z.string().min(1)).min(1).parse(context.args.artifact_ids),
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },
  greetings_revision_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("GREETINGS_REVISION_DENIED", "Only the Director may begin a Greeting revision");
    const input = event(context.args);
    const next = beginGreetingsRevision({
      state: context.workflow,
      runId: stringArg(context.args, "run_id"),
      reason: stringArg(context.args, "reason"),
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },
  character_revision_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("CHARACTER_REVISION_DENIED", "Only the Director may begin a Character revision");
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.blueprint) mcpFail("PROJECT_INVALID", "Character revision requires a valid project and Blueprint", project.diagnostics);
    const input = event(context.args);
    const next = beginCharacterRevision({
      state: context.workflow,
      blueprint: project.blueprint,
      runId: stringArg(context.args, "run_id"),
      reason: stringArg(context.args, "reason"),
      artifactIds: z.array(z.string().min(1)).min(1).parse(context.args.artifact_ids),
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },
  character_expansion_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("CHARACTER_EXPANSION_DENIED", "Only the Director may begin Character expansion");
    const args = expansionBeginSchema.parse({
      run_id: context.args.run_id,
      reason: context.args.reason,
      ...(context.args.new_title === undefined ? {} : { new_title: context.args.new_title }),
      new_characters: context.args.new_characters,
      candidate_blueprint: context.args.candidate_blueprint,
      affected_artifact_ids: context.args.affected_artifact_ids ?? [],
      revise_world: context.args.revise_world,
    });
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.manifest || !project.blueprint) mcpFail("PROJECT_INVALID", "Character expansion requires a valid project and Blueprint", project.diagnostics);
    const input = event(context.args);
    const newManifestCharacters = args.new_characters.map((item) => ({
      id: item.id,
      display_name: item.display_name,
      mode: item.mode,
      role: item.role,
    }));
    const title = args.new_title ?? project.manifest.title;
    const nextManifest = projectManifestSchema.parse({ ...project.manifest, title, card: { ...project.manifest.card, name: title }, characters: [...project.manifest.characters, ...newManifestCharacters] });
    const nextBlueprint = blueprintSchema.parse({ ...args.candidate_blueprint, approved_revision: undefined });
    const expectations = args.affected_artifact_ids.map((id) => {
      const relativePath = Object.keys(project.sourceRevisions).find((path) => authorArtifactId(path) === id);
      const stateRevision = context.workflow.artifacts.find((item) => item.id === id && item.revision && !["missing", "stale"].includes(item.status))?.revision;
      if (!relativePath || !stateRevision || project.sourceRevisions[relativePath] !== stateRevision) {
        mcpFail("CHARACTER_EXPANSION_TARGET_STALE", `affected artifact 缺少 current exact raw revision：${id}`);
      }
      return { relativePath, expectedRawRevision: stateRevision };
    });
    const projectRevision = project.sourceRevisions["project.yaml"];
    const blueprintRevision = project.sourceRevisions["blueprint.yaml"];
    if (!projectRevision || !blueprintRevision) mcpFail("CHARACTER_EXPANSION_REVISION_UNAVAILABLE", "project/blueprint raw revision unavailable");
    const candidatePath = `.workflow/candidates/character-expansion/${args.run_id}/candidate-1.json`;
    const candidateDocument = {
      schema_version: 2 as const,
      run_id: args.run_id,
      version: 1,
      base_project_revision: projectRevision,
      base_blueprint_revision: blueprintRevision,
      manifest: nextManifest,
      blueprint: nextBlueprint,
      new_characters: args.new_characters,
      affected_artifacts: expectations.map((item) => ({ id: authorArtifactId(item.relativePath), revision: item.expectedRawRevision })),
      revise_world: args.revise_world,
    };
    const candidateRevision = computeRevision(candidateDocument);
    const candidateArtifactId = `character-expansion-candidate-${args.run_id}-1`;
    const next = beginCharacterExpansion({
      state: context.workflow,
      manifest: project.manifest,
      currentBlueprint: project.blueprint,
      candidateBlueprint: nextBlueprint,
      newCharacters: args.new_characters,
      affectedArtifactIds: args.affected_artifact_ids,
      reviseWorld: args.revise_world,
      runId: args.run_id,
      reason: args.reason,
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
      blueprintRevision: computeRevision(nextBlueprint),
      placeholderArtifacts: [],
      candidate: {
        artifactId: candidateArtifactId,
        path: candidatePath,
        revision: candidateRevision,
        version: 1,
        baseProjectRevision: projectRevision,
        baseBlueprintRevision: blueprintRevision,
      },
    });
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      operations: [{ relativePath: candidatePath, content: canonicalJson(candidateDocument), expectedAbsent: true }],
      expectations: [
        { relativePath: "project.yaml", expectedRawRevision: projectRevision },
        { relativePath: "blueprint.yaml", expectedRawRevision: blueprintRevision },
        ...expectations,
      ],
      update: () => next,
    });
  },
  character_expansion_blueprint_update: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("CHARACTER_EXPANSION_DENIED", "Only the Director may update Character expansion");
    const args = expansionUpdateSchema.parse({
      run_id: context.args.run_id,
      reason: context.args.reason,
      ...(context.args.new_title === undefined ? {} : { new_title: context.args.new_title }),
      candidate_blueprint: context.args.candidate_blueprint,
    });
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.manifest || !project.blueprint) mcpFail("PROJECT_INVALID", "Character expansion update requires a valid project and Blueprint", project.diagnostics);
    const input = event(context.args);
    const metadata = characterExpansionV2(context.workflow, args.run_id);
    const priorCandidate = await readExpansionCandidate(context.projectRoot, metadata.candidate_path, metadata.candidate_revision);
    const title = args.new_title ?? priorCandidate.manifest.title;
    const nextManifest = projectManifestSchema.parse({ ...priorCandidate.manifest, title, card: { ...priorCandidate.manifest.card, name: title } });
    const nextBlueprint = blueprintSchema.parse({ ...args.candidate_blueprint, approved_revision: undefined });
    const projectRevision = project.sourceRevisions["project.yaml"];
    const blueprintRevision = project.sourceRevisions["blueprint.yaml"];
    if (!projectRevision || !blueprintRevision) mcpFail("CHARACTER_EXPANSION_REVISION_UNAVAILABLE", "project/blueprint raw revision unavailable");
    const version = metadata.candidate_version + 1;
    const candidatePath = `.workflow/candidates/character-expansion/${args.run_id}/candidate-${version}.json`;
    const candidateDocument = { ...priorCandidate, version, manifest: nextManifest, blueprint: nextBlueprint };
    const candidateRevision = computeRevision(candidateDocument);
    const candidateArtifactId = `character-expansion-candidate-${args.run_id}-${version}`;
    const next = updateCharacterExpansionBlueprint({
      state: context.workflow,
      manifest: project.manifest,
      currentBlueprint: priorCandidate.blueprint,
      candidateBlueprint: nextBlueprint,
      runId: args.run_id,
      reason: args.reason,
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
      blueprintRevision: computeRevision(nextBlueprint),
      candidate: { artifactId: candidateArtifactId, path: candidatePath, revision: candidateRevision, version },
    });
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      operations: [{ relativePath: candidatePath, content: canonicalJson(candidateDocument), expectedAbsent: true }],
      expectations: [
        { relativePath: "project.yaml", expectedRawRevision: metadata.base_project_revision },
        { relativePath: "blueprint.yaml", expectedRawRevision: metadata.base_blueprint_revision },
      ],
      update: () => next,
    });
  },
  character_review_retry_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("CHARACTER_REVIEW_RETRY_DENIED", "Only the Director may retry Character Review");
    const input = event(context.args);
    const next = beginCharacterReviewRetry({
      state: context.workflow,
      runId: stringArg(context.args, "run_id"),
      reason: stringArg(context.args, "reason"),
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
    });
    return commitWorkflowMutation(context.projectRoot, { ...input, actor: context.trusted.agentId, update: () => next });
  },
  task_recovery_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("TASK_RECOVERY_DENIED", "Only the Director may recover a failed task");
    const input = event(context.args);
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => beginTaskRecovery({
        state,
        taskId: stringArg(context.args, "task_id"),
        runId: stringArg(context.args, "run_id"),
        failureCategory: taskFailureCategorySchema.parse(context.args.failure_category),
        reason: stringArg(context.args, "reason"),
        occurredAt: input.occurredAt,
        actor: context.trusted.agentId,
      }),
    });
  },
  task_repair_resume: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("TASK_REPAIR_RESUME_DENIED", "Only the Director may resume a task after repair");
    const input = event(context.args);
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => resumeTaskAfterRepair({
        state,
        taskId: stringArg(context.args, "task_id"),
        runId: stringArg(context.args, "run_id"),
        reason: stringArg(context.args, "reason"),
        occurredAt: input.occurredAt,
        actor: context.trusted.agentId,
      }),
    });
  },
  source_processing_repair_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("SOURCE_PROCESSING_REPAIR_DENIED", "Only the Director may repair source processing");
    const input = event(context.args);
    const sourceInputs = await sourceArtifactReferences(context.projectRoot);
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => beginSourceProcessingRepair({
        state,
        sourceInputs,
        runId: stringArg(context.args, "run_id"),
        reason: stringArg(context.args, "reason"),
        occurredAt: input.occurredAt,
        actor: context.trusted.agentId,
      }),
    });
  },
  facts_recuration_begin: async (context: ToolCallContext) => {
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("FACTS_RECURATION_DENIED", "Only the Director may begin facts re-curation");
    const input = event(context.args);
    const sourceInputs = await sourceArtifactReferences(context.projectRoot);
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => beginFactsRecuration({
        state,
        sourceInputs,
        runId: stringArg(context.args, "run_id"),
        reason: stringArg(context.args, "reason"),
        occurredAt: input.occurredAt,
        actor: context.trusted.agentId,
      }),
    });
  },
  workflow_answer_interview: async (context: ToolCallContext) => {
    const input = event(context.args);
    const questionId = stringArg(context.args, "question_id");
    const answer = stringArg(context.args, "answer");
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => workflowStateSchema.parse({
        ...state,
        revision: state.revision + 1,
        decisions: [...state.decisions, {
          id: stringArg(context.args, "decision_id"),
          kind: "interview.answer",
          actor: context.trusted.agentId,
          decided_at: input.occurredAt,
          input_revisions: [],
          summary: answer,
          extensions: { question_id: questionId },
        }],
      }),
    });
  },
  workflow_approve_gate: (context: ToolCallContext) => gate(context, "approve"),
  workflow_reject_gate: (context: ToolCallContext) => gate(context, "reject"),
  task_claim: async (context: ToolCallContext) => {
    const taskId = stringArg(context.args, "task_id");
    const task = context.workflow.tasks.find((item) => item.id === taskId);
    if (!task) mcpFail("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    const requestedLeaseDurationMs = numberArg(context.args, "lease_duration_ms");
    const requiresExtendedLease = task.assigned_agent === "zhuji-creator" || task.kind === "create-blueprint";
    const leaseDurationMs = requiresExtendedLease
      ? Math.max(requestedLeaseDurationMs, 30 * 60 * 1000)
      : requestedLeaseDurationMs;
    const completed = new Set(context.workflow.tasks.filter((item) => item.status === "completed").map((item) => item.id));
    const next = claimTask(task, {
      owner: context.trusted.agentId,
      leaseId: stringArg(context.args, "lease_id"),
      leaseDurationMs,
      completedTaskIds: completed,
    });
    return replaceTask(context, next, "claimed");
  },
  task_context: async (context: ToolCallContext) => {
    const task = currentTask(context);
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok) mcpFail("PROJECT_INVALID", "Task context requires a valid author project", project.diagnostics);
    const inspectionRef = task.input_artifacts.find((item) => item.id === "card-inspection");
    const inspection = task.kind === "analyze-import" && inspectionRef
      ? await loadCardInspection(context.projectRoot, inspectionRef.revision)
      : undefined;
    const artifactId = typeof context.args.artifact_id === "string" ? context.args.artifact_id : undefined;
    if (artifactId) {
      const artifact = task.input_artifacts.find((item) => item.id === artifactId);
      if (!artifact) mcpFail("TASK_ARTIFACT_NOT_ASSIGNED", `Artifact is not assigned to task ${task.id}: ${artifactId}`);
      return {
        task,
        artifact: {
          id: artifact.id,
          revision: artifact.revision,
          ...(artifact.contract ? { contract: artifact.contract } : {}),
          content: taskArtifactContent(project, artifact.id, artifact.revision),
        },
        authoring_decisions: context.workflow.decisions.filter((decision) => (
          decision.kind === "creative-collaboration.mode"
          || decision.extensions.task_id === task.id
        )),
      };
    }
    const authoringDecisions = context.workflow.decisions.filter((decision) => (
      decision.kind === "creative-collaboration.mode"
      || decision.extensions.task_id === task.id
    ));
    if (context.args.detail !== "full") {
      return {
        task,
        source_revisions: project.sourceRevisions,
        authoring_decisions: authoringDecisions,
        ...(inspection ? { inspection } : {}),
      };
    }
    return {
      task,
      blueprint: project.blueprint,
      manifest: project.manifest,
      characters: project.characters,
      world: project.world,
      greetings: project.greetings,
      relationships: project.relationships,
      facts: project.factRegister?.facts.filter((fact) => fact.status === "accepted") ?? [],
      source_revisions: project.sourceRevisions,
      authoring_decisions: authoringDecisions,
      ...(inspection ? { inspection } : {}),
    };
  },
  task_submit: async (context: ToolCallContext) => {
    const task = currentTask(context);
    if (task.output_contract === "proposal@1") {
      mcpFail(
        "TASK_SPECIALIZED_SUBMISSION_REQUIRED",
        `Task ${task.id} must be completed through its specialized proposal submission tool`,
      );
    }
    const result = artifactReferenceSchema.parse(objectArg(context.args, "result"));
    if (result.contract !== task.output_contract) mcpFail("TASK_OUTPUT_CONTRACT_MISMATCH", `Task requires ${task.output_contract}`);
    submitTask(task, {
      taskId: task.id,
      leaseId: stringArg(context.args, "lease_id"),
      owner: context.trusted.agentId,
      result,
    });
    return replaceTask(context, workflowTaskSchema.parse({
      ...task,
      status: "completed",
      result,
      lease: undefined,
    }), "submitted");
  },
  task_fail: async (context: ToolCallContext) => {
    const task = currentTask(context);
    const input = event(context.args);
    return replaceTask(context, markTaskFailed(
      task,
      stringArg(context.args, "summary"),
      taskFailureCategorySchema.parse(context.args.failure_category),
      input.occurredAt,
      context.trusted.agentId,
    ), "failed");
  },
  task_release: async (context: ToolCallContext) => {
    const task = currentTask(context);
    return replaceTask(context, workflowTaskSchema.parse({
      ...task,
      status: "pending",
      lease: undefined,
      resume_without_attempt: true,
    }), "released");
  },
  task_request_clarification: async (context: ToolCallContext) => {
    const input = event(context.args);
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.blueprint) mcpFail("PROJECT_INVALID", "Clarification requires a valid Blueprint", project.diagnostics);
    if (project.blueprint.collaboration_mode !== "assisted") {
      mcpFail("CLARIFICATION_MODE_DISABLED", "Clarification is only available in assisted collaboration mode");
    }
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (!agent || !["zhuji-creator", "palette-creator", "relationship-creator", "world-lore-creator", "greetings-creator"].includes(agent.kind)) {
      mcpFail("CLARIFICATION_REQUEST_DENIED", "Only Creator agents may request clarification");
    }
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => {
        const taskId = stringArg(context.args, "task_id");
        const task = state.tasks.find((candidate) => candidate.id === taskId);
        if (!task) mcpFail("TASK_NOT_FOUND", `Task not found: ${taskId}`);
        const nextTask = requestTaskClarification(
          task,
          context.trusted.agentId,
          stringArg(context.args, "lease_id"),
          {
            id: stringArg(context.args, "clarification_id"),
            question: stringArg(context.args, "question"),
            reason: stringArg(context.args, "reason"),
            affectedModules: z.array(z.string().min(1)).min(1).parse(context.args.affected_modules),
            options: z.array(taskClarificationOptionSchema).min(2).max(5).parse(context.args.options),
            requestedAt: input.occurredAt,
          },
        );
        return workflowStateSchema.parse({
          ...state,
          revision: state.revision + 1,
          tasks: state.tasks.map((candidate) => candidate.id === taskId ? nextTask : candidate),
          decisions: [...state.decisions, {
            id: stringArg(context.args, "decision_id"),
            kind: "task.clarification.requested",
            actor: context.trusted.agentId,
            decided_at: input.occurredAt,
            input_revisions: [],
            summary: stringArg(context.args, "question"),
            extensions: { task_id: taskId, clarification_id: stringArg(context.args, "clarification_id") },
          }],
        });
      },
    });
  },
  blueprint_precheck_record: async (context: ToolCallContext) => {
    const input = event(context.args);
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("BLUEPRINT_PRECHECK_DENIED", "Only the Director may record Blueprint prechecks");
    const candidate = blueprintSchema.parse(context.args.candidate_blueprint);
    if (candidate.collaboration_mode !== "assisted") mcpFail("BLUEPRINT_PRECHECK_MODE_DISABLED", "Blueprint precheck is required only in assisted mode");
    if (candidate.project_id !== context.workflow.project_id) mcpFail("BLUEPRINT_PRECHECK_PROJECT_MISMATCH", "Precheck candidate belongs to another project");
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.manifest || project.blueprint?.collaboration_mode !== "assisted") {
      mcpFail("BLUEPRINT_PRECHECK_MODE_DISABLED", "Project is not in assisted collaboration mode", project.diagnostics);
    }
    const manifestCharacterIds = project.manifest.characters.map((character) => character.id).sort();
    const candidateCharacterIds = candidate.characters.map((character) => character.id).sort();
    if (JSON.stringify(manifestCharacterIds) !== JSON.stringify(candidateCharacterIds)) {
      mcpFail("BLUEPRINT_PRECHECK_SUBJECT_INVALID", "Precheck candidate characters must match the project manifest");
    }
    const checks = z.array(blueprintPrecheckCheckSchema).min(1).parse(context.args.checks);
    const subjects = candidate.characters.length > 0 ? candidate.characters.map((character) => character.id) : [candidate.project_id];
    for (const subjectId of subjects) {
      for (const dimension of requiredPrecheckDimensions) {
        const matches = checks.filter((check) => check.subject_id === subjectId && check.dimension === dimension);
        if (matches.length !== 1) mcpFail("BLUEPRINT_PRECHECK_INCOMPLETE", `Precheck requires exactly one ${dimension} check for ${subjectId}`);
      }
    }
    if (checks.some((check) => !subjects.includes(check.subject_id))) {
      mcpFail("BLUEPRINT_PRECHECK_SUBJECT_INVALID", "Precheck contains a subject outside the candidate Blueprint");
    }
    const revision = computeRevision(candidate);
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => {
        const taskId = stringArg(context.args, "task_id");
        const task = state.tasks.find((item) => item.id === taskId);
        if (!task || task.kind !== "create-blueprint" || task.status !== "claimed") {
          mcpFail("BLUEPRINT_PRECHECK_TASK_INVALID", "Precheck requires the claimed create-blueprint task");
        }
        if (task.assigned_agent !== context.trusted.agentId || task.lease?.id !== stringArg(context.args, "lease_id")) {
          mcpFail("BLUEPRINT_PRECHECK_LEASE_INVALID", "Precheck requires the Director's current Blueprint task lease");
        }
        return workflowStateSchema.parse({
          ...state,
          revision: state.revision + 1,
          tasks: state.tasks.map((item) => item.id === taskId ? {
            ...item,
            blueprint_precheck: { schema_version: 1, candidate_blueprint_revision: revision, recorded_at: input.occurredAt, checks },
          } : item),
          decisions: [...state.decisions, {
            id: stringArg(context.args, "decision_id"),
            kind: "blueprint.precheck.completed",
            actor: context.trusted.agentId,
            decided_at: input.occurredAt,
            input_revisions: [],
            summary: `Blueprint 預檢完成：${checks.length} 項`,
            extensions: { task_id: taskId, candidate_blueprint_revision: revision },
          }],
        });
      },
    });
  },
  task_resolve_clarification: async (context: ToolCallContext) => {
    const input = event(context.args);
    const agent = context.trusted.config.registry.agents.find((candidate) => candidate.id === context.trusted.agentId);
    if (agent?.kind !== "director") mcpFail("CLARIFICATION_RESOLVE_DENIED", "Only the Director may resolve clarification");
    return commitWorkflowMutation(context.projectRoot, {
      ...input,
      actor: context.trusted.agentId,
      update: (state) => {
        const taskId = stringArg(context.args, "task_id");
        const task = state.tasks.find((candidate) => candidate.id === taskId);
        if (!task) mcpFail("TASK_NOT_FOUND", `Task not found: ${taskId}`);
        const selectedOption = typeof context.args.selected_option === "string" ? context.args.selected_option : undefined;
        const nextTask = resolveTaskClarification(task, {
          clarificationId: stringArg(context.args, "clarification_id"),
          answer: stringArg(context.args, "answer"),
          ...(selectedOption === undefined ? {} : { selectedOption }),
          resolvedAt: input.occurredAt,
        });
        return workflowStateSchema.parse({
          ...state,
          revision: state.revision + 1,
          tasks: state.tasks.map((candidate) => candidate.id === taskId ? nextTask : candidate),
          decisions: [...state.decisions, {
            id: stringArg(context.args, "decision_id"),
            kind: "task.clarification.resolved",
            actor: context.trusted.agentId,
            decided_at: input.occurredAt,
            input_revisions: [],
            summary: stringArg(context.args, "answer"),
            ...(selectedOption === undefined ? {} : { option: selectedOption }),
            extensions: { task_id: taskId, clarification_id: stringArg(context.args, "clarification_id") },
          }],
        });
      },
    });
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;

function characterExpansionV2(state: typeof workflowStateSchema._output, runId?: string) {
  const parsed = expansionRunV2Schema.safeParse(state.extensions.character_expansion);
  if (!parsed.success || (runId !== undefined && parsed.data.run_id !== runId)) {
    mcpFail("CHARACTER_EXPANSION_LEGACY_RUN", "此操作只適用於 active Character Expansion V2 candidate；V1 materialized run 保留 legacy branch");
  }
  return parsed.data;
}

async function readExpansionCandidate(projectRoot: string, relativePath: string, expectedRevision: string) {
  const file = await resolveExistingWithin(projectRoot, relativePath);
  const raw = await readFile(file, "utf8");
  const candidate = expansionCandidateV2Schema.parse(JSON.parse(raw));
  if (computeRevision(candidate) !== expectedRevision) mcpFail("CHARACTER_EXPANSION_CANDIDATE_STALE", "Expansion candidate revision 不符");
  return candidate;
}

async function approveExpansionGate(context: ToolCallContext, input: ReturnType<typeof event>) {
  const metadata = characterExpansionV2(context.workflow);
  if (metadata.materialized) return undefined;
  const candidate = await readExpansionCandidate(context.projectRoot, metadata.candidate_path, metadata.candidate_revision);
  const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
  if (!project.ok || !project.manifest || !project.blueprint) mcpFail("PROJECT_INVALID", "Expansion approval requires a valid base project", project.diagnostics);
  if (project.sourceRevisions["project.yaml"] !== metadata.base_project_revision || project.sourceRevisions["blueprint.yaml"] !== metadata.base_blueprint_revision) {
    mcpFail("CHARACTER_EXPANSION_BASE_STALE", "Expansion approval base project/Blueprint CAS 已變更");
  }
  const placeholderOperations = createCharacterPlaceholderOperations(candidate.manifest.characters.filter((character) =>
    candidate.new_characters.some((requested) => requested.id === character.id)), true);
  const relationshipsChanged = candidate.blueprint.relationships.enabled && (
    !project.blueprint.relationships.enabled
    || JSON.stringify(candidate.blueprint.relationships.character_ids) !== JSON.stringify(project.blueprint.relationships.character_ids)
  );
  const relationshipOperation = relationshipsChanged ? {
    relativePath: "relationships.yaml",
    content: canonicalYaml(createRelationshipsPlaceholder(project.manifest.id, candidate.blueprint.relationships.character_ids, project.relationships?.team_code)),
    ...(project.sourceRevisions["relationships.yaml"]
      ? { expectedRawRevision: project.sourceRevisions["relationships.yaml"] }
      : { expectedAbsent: true }),
  } : undefined;
  const formalArtifacts: Array<{ id: string; revision: string; contract?: string }> = placeholderOperations.map((operation) => ({
    id: authorArtifactId(operation.relativePath), revision: computeTextRevision(operation.content),
  }));
  if (relationshipOperation) formalArtifacts.push({ id: "author-relationships.yaml", revision: computeTextRevision(relationshipOperation.content), contract: "relationships@1" });
  const supplied = artifactReferenceSchema.array().parse(context.args.input_revisions ?? []);
  const decision = decideGate(context.workflow, {
    decisionId: stringArg(context.args, "decision_id"), gateId: "blueprint", action: "approve",
    actor: "opencode-user", actorRole: "user", decidedAt: input.occurredAt,
    inputRevisions: supplied, summary: stringArg(context.args, "summary"),
  });
  const blueprintContent = canonicalYaml(candidate.blueprint);
  const nextState = workflowStateSchema.parse({
    ...decision.state,
    gates: decision.state.gates.map((gate) => ["content", "publish"].includes(gate.id)
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    artifacts: [
      ...decision.state.artifacts
        .filter((artifact) => artifact.id !== "blueprint" && !formalArtifacts.some((formal) => formal.id === artifact.id))
        .map((artifact) => artifact.id.startsWith("preview-") ? { ...artifact, status: "stale" as const } : artifact),
      { id: "blueprint", status: "draft", revision: computeTextRevision(blueprintContent), updated_at: input.occurredAt, contract: "blueprint@1", extensions: {} },
      ...formalArtifacts.map((artifact) => ({ ...artifact, status: "draft" as const, updated_at: input.occurredAt, extensions: {} })),
    ],
    extensions: { ...decision.state.extensions, character_expansion: { ...metadata, materialized: true } },
  });
  return commitWorkflowMutation(context.projectRoot, {
    ...input,
    actor: "opencode-user",
    operations: [
      { relativePath: "project.yaml", content: canonicalYaml(candidate.manifest), expectedRawRevision: metadata.base_project_revision },
      { relativePath: "blueprint.yaml", content: blueprintContent, expectedRawRevision: metadata.base_blueprint_revision },
      ...placeholderOperations,
      ...(relationshipOperation ? [relationshipOperation] : []),
    ],
    expectations: [
      { relativePath: metadata.candidate_path, expectedRawRevision: metadata.candidate_revision },
      ...candidate.affected_artifacts.map((artifact) => {
        const relativePath = Object.keys(project.sourceRevisions).find((item) => authorArtifactId(item) === artifact.id);
        if (!relativePath) mcpFail("CHARACTER_EXPANSION_TARGET_STALE", `找不到 affected artifact：${artifact.id}`);
        return { relativePath, expectedRawRevision: artifact.revision };
      }),
    ],
    ...(typeof context.args.before_publish === "function"
      ? { beforePublish: context.args.before_publish as (index: number) => void | Promise<void> }
      : {}),
    update: () => nextState,
  });
}

function currentTask(context: ToolCallContext): WorkflowTask {
  const taskId = stringArg(context.args, "task_id");
  const task = context.workflow.tasks.find((item) => item.id === taskId);
  if (!task) mcpFail("TASK_NOT_FOUND", `Task not found: ${taskId}`);
  return task;
}

async function gate(context: ToolCallContext, action: "approve" | "reject") {
  const input = event(context.args);
  if (action === "approve" && context.args.gate_id === "blueprint" && expansionRunV2Schema.safeParse(context.workflow.extensions.character_expansion).success) {
    return approveExpansionGate(context, input);
  }
  let inputRevisions = artifactReferenceSchema.array().parse(context.args.input_revisions ?? []);
  if (action === "approve" && context.args.gate_id === "facts" && context.workflow.entry_kind === "source_adaptation") {
    const currentCurate = [...context.workflow.tasks].reverse().find((task) => task.kind === "curate-facts");
    if (currentCurate?.status !== "completed") mcpFail("FACTS_REVIEW_INCOMPLETE", "Fact curation is not completed");
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.manifest) mcpFail("PROJECT_INVALID", "Facts Gate requires a valid project manifest", project.diagnostics);
    const [readiness, provenance] = await Promise.all([
      readFactsReadiness(context.projectRoot, project.manifest.characters),
      verifyProvenance(context.projectRoot),
    ]);
    if (readiness.candidateIds.some((id) => !readiness.reviewed.has(id))) {
      mcpFail("FACTS_REVIEW_INCOMPLETE", "Every candidate requires a review decision");
    }
    if (readiness.blockingQualityDiagnostics.length > 0) {
      mcpFail("FACTS_GATE_CANDIDATE_INVALID", "Active curation contains invalid candidates that were not rejected", readiness.blockingQualityDiagnostics);
    }
    if (readiness.projection.conflicts.conflicts.some((conflict) => conflict.status === "open")) {
      mcpFail("FACTS_REVIEW_INCOMPLETE", "Open fact conflicts must be resolved");
    }
    if (!readiness.coverage.gate_ready) {
      mcpFail("FACTS_COVERAGE_INSUFFICIENT", "Accepted active facts do not cover the required character dimensions", readiness.coverage);
    }
    if (!provenance.ok) mcpFail("FACTS_REVIEW_INCOMPLETE", "Accepted fact provenance is invalid", provenance.diagnostics);
    const expected = [
      { id: "fact-register", revision: computeRevision(readiness.projection.register) },
      { id: "conflict-register", revision: computeRevision(readiness.projection.conflicts) },
    ];
    const normalize = (references: typeof expected) => [...references].sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(normalize(inputRevisions)) !== JSON.stringify(normalize(expected))) {
      mcpFail("FACTS_GATE_SNAPSHOT_STALE", "Facts Gate approval requires exact current register revisions");
    }
    inputRevisions = expected;
  }
  if (action === "approve" && context.args.gate_id === "blueprint" && context.workflow.extensions.character_expansion !== undefined) {
    const current = context.workflow.artifacts.find((item) => item.id === "blueprint" && item.revision && !["missing", "stale"].includes(item.status));
    const supplied = artifactReferenceSchema.array().parse(context.args.input_revisions ?? []);
    if (!current || supplied.length !== 1 || supplied[0]?.id !== "blueprint" || supplied[0].revision !== current.revision) {
      mcpFail("CHARACTER_EXPANSION_BLUEPRINT_GATE_STALE", "Expansion Blueprint Gate 必須批准 exact current Blueprint revision");
    }
  }
  let decisionState = context.workflow;
  if (context.args.gate_id === "facts" && inputRevisions.length > 0) {
    decisionState = workflowStateSchema.parse({
      ...context.workflow,
      artifacts: [
        ...context.workflow.artifacts.filter((artifact) => !inputRevisions.some((item) => item.id === artifact.id)),
        ...inputRevisions.map((item) => ({ ...item, status: "reviewed" as const, updated_at: input.occurredAt, extensions: {} })),
      ],
    });
  }
  const authoritative = context.args.gate_id === "facts" && inputRevisions.length > 0
    ? inputRevisions
    : deriveGateSnapshot(decisionState, stringArg(context.args, "gate_id") as "facts" | "blueprint" | "content" | "publish");
  if (inputRevisions.length === 0) inputRevisions = authoritative;
  const result = decideGate(decisionState, {
    decisionId: stringArg(context.args, "decision_id"),
    gateId: stringArg(context.args, "gate_id") as "facts" | "blueprint" | "content" | "publish",
    action,
    actor: "opencode-user",
    actorRole: "user",
    decidedAt: input.occurredAt,
    inputRevisions,
    summary: stringArg(context.args, "summary"),
    ...(typeof context.args.rejection_route === "string" ? { rejectionRoute: context.args.rejection_route as "facts_recuration" | "blueprint_successor" | "content_revision" | "repreview" | "cancel" } : {}),
    ...(Array.isArray(context.args.revision_scope) ? { revisionScope: context.args.revision_scope as Array<"character" | "relationship" | "world" | "greetings"> } : {}),
  });
  let nextState = result.state;
  if (action === "reject" && context.args.gate_id === "content" && context.args.rejection_route === "content_revision") {
    const scope = z.array(z.enum(["character", "relationship", "world", "greetings"])).length(1).parse(context.args.revision_scope)[0]!;
    const runId = stringArg(context.args, "revision_run_id");
    const artifactIds = z.array(z.string().min(1)).parse(context.args.revision_artifact_ids ?? []);
    if (scope !== "greetings" && artifactIds.length === 0) {
      mcpFail("CONTENT_REVISION_TARGET_REQUIRED", "Content revision 必須指定 exact revision_artifact_ids");
    }
    const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
    if (!project.ok || !project.blueprint) mcpFail("PROJECT_INVALID", "Content revision requires a valid project and Blueprint", project.diagnostics);
    const routedState = beginScopedContentRevision({
      state: result.state,
      blueprint: project.blueprint,
      worldEntries: project.world,
      scope,
      runId,
      reason: stringArg(context.args, "summary"),
      artifactIds,
      occurredAt: input.occurredAt,
      actor: context.trusted.agentId,
    });
    nextState = workflowStateSchema.parse({ ...routedState, revision: context.workflow.revision + 1 });
  }
  return commitWorkflowMutation(context.projectRoot, {
    ...input,
    actor: "opencode-user",
    update: () => nextState,
  });
}

async function sourceArtifactReferences(projectRoot: string) {
  const manifest = await readSourceManifest(projectRoot);
  return Promise.all(manifest.sources
    .filter((source) => source.current_revision_id !== undefined)
    .map(async (source) => {
      const revision = await getSourceRevision(projectRoot, source.id, source.current_revision_id);
      return artifactReferenceSchema.parse({ id: `source-${source.id}`, revision: revision.id });
    }));
}
import { readFile } from "node:fs/promises";
