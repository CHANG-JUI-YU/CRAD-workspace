import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stringify } from "yaml";

import {
  blueprintPluginSelectionSchema,
  pluginArtifactSchema,
  pluginProposalEnvelopeSchema,
  pluginRevisionIntentSchema,
  pluginSelectionProjectionSchema,
  pluginSelectionSchema,
  pluginSourceSchema,
  pluginUserAuthorizationEnvelopeSchema,
  projectManifestSchema,
  workflowArtifactSchema,
  workflowStateSchema,
  type ArtifactReference,
  type BlueprintPluginSelection,
  type OfficialPluginId,
  type PluginProposalEnvelope,
  type PluginImplementationPin,
  type PluginRevisionIntent,
  type PluginSelection,
  type PluginSource,
  type PluginUserAuthorizationEnvelope,
  type ProjectManifest,
  type Revision,
  type WorkflowState,
} from "@card-workspace/schemas";
import {
  canonicalJson,
  compileMvuSource,
  assertPluginSourcePinned,
  generatePluginContributions,
  officialPluginImplementationRegistry,
  pendingResultRevisionFor,
  proposalResultText,
  proposalRevisionFor,
  resolvePluginSelectionDependencies,
  resolveExactPluginImplementation,
  revisionFor,
} from "@card-workspace/plugins";
import {
  computeTextRevision,
  pluginArtifactRelativePath,
  pluginSelectionRelativePath,
  pluginSourceOperation,
  readPluginSource,
  resolveWithin,
  parsePluginDataText,
  type LoadedAuthorProject,
  type TransactionOperation,
} from "@card-workspace/project";

import { workflowFail } from "./errors.js";
import { commitWorkflowMutation } from "./repository.js";
import { materializePluginTasks } from "./runtime.js";

function pluginArtifactId(pluginId: PluginSource["plugin_id"]): string {
  return `plugin-${pluginId}`;
}

/** Returns workflow evidence invalidated by a changed official plugin. */
export function derivePluginDependencyImpact(
  changedPluginId: OfficialPluginId,
  selections: readonly PluginSelection[],
): string[] {
  if (changedPluginId !== "official.mvu-zod") return [];
  return [...new Set(selections
    .filter((selection) => selection.plugin_id === "official.ejs"
      || (selection.plugin_id === "official.html" && selection.capabilities.includes("html.status_bar")))
    .map((selection) => pluginArtifactId(selection.plugin_id)))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function pendingResultId(proposal: PluginProposalEnvelope): string {
  return `plugin-pending-${proposal.value.plugin_id}-${proposal.id}`;
}

function artifactReference(artifact: { id: string; revision: Revision; contract?: string }): ArtifactReference {
  return { id: artifact.id, revision: artifact.revision, ...(artifact.contract ? { contract: artifact.contract } : {}) };
}

function normalizedPluginSelections(selections: readonly BlueprintPluginSelection[]): BlueprintPluginSelection[] {
  return selections
    .map((selection) => blueprintPluginSelectionSchema.parse({
      ...selection,
      capabilities: [...new Set(selection.capabilities)].sort(),
    }))
    .sort((left, right) => left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0);
}

function dependencyClosure(selections: readonly BlueprintPluginSelection[]): OfficialPluginId[] {
  return resolvePluginSelectionDependencies(selections);
}

function pluginIntentFromBlueprint(options: {
  projectId: string;
  projectKind: ProjectManifest["kind"];
  blueprint: LoadedAuthorProject["blueprint"];
  baseSelectionRevision: PluginRevisionIntent["base_selection_revision"];
  desiredSelections?: readonly BlueprintPluginSelection[];
  sourcePins: readonly PluginSource[];
  implementationPins?: Partial<Record<OfficialPluginId, PluginImplementationPin>>;
}): PluginRevisionIntent {
  const { projectId, projectKind, blueprint } = options;
  if (!blueprint) workflowFail("PLUGIN_BLUEPRINT_REQUIRED", "plugin revision 必須有 Blueprint");
  const selections = normalizedPluginSelections(options.desiredSelections ?? blueprint.plugins);
  const closure = dependencyClosure(selections);
  const sourcePins = new Map(options.sourcePins.map((source) => [source.plugin_id, source.implementation] as const));
  const implementationPins = closure.map((pluginId) => {
    const implementation = options.implementationPins?.[pluginId] ?? sourcePins.get(pluginId);
    if (!implementation) workflowFail("PLUGIN_IMPLEMENTATION_PIN_REQUIRED", `缺少 ${pluginId} 的 exact implementation/asset pin`);
    try {
      resolveExactPluginImplementation(officialPluginImplementationRegistry, pluginId, implementation);
    } catch (error) {
      workflowFail("PLUGIN_IMPLEMENTATION_PIN_INVALID", `${pluginId} 的 implementation pin 未被目前 registry 精確註冊`, error);
    }
    return { plugin_id: pluginId, implementation };
  });
  return pluginRevisionIntentSchema.parse({
    schema_version: 1,
    project_id: projectId,
    revision: revisionFor({
      project_id: projectId,
      project_kind: projectKind,
      base_selection_revision: options.baseSelectionRevision,
      selections,
      dependency_closure: closure,
      implementation_pins: implementationPins,
    }),
    project_kind: projectKind,
    base_selection_revision: options.baseSelectionRevision,
    selections,
    dependency_closure: closure,
    implementation_pins: implementationPins,
  });
}

export function beginPluginRevision(options: {
  state: WorkflowState;
  project: LoadedAuthorProject;
  occurredAt: string;
  actor: string;
  desiredSelections?: readonly BlueprintPluginSelection[];
  implementationPins?: Partial<Record<OfficialPluginId, PluginImplementationPin>>;
}): WorkflowState {
  if (!options.project.manifest || !options.project.blueprint) workflowFail("PLUGIN_PROJECT_INVALID", "plugin revision project 不完整");
  if (options.project.manifest.kind !== "character_card") workflowFail("PLUGIN_PROJECT_KIND_DENIED", "worldbook 不支援 plugin revision");
  const blueprint = options.project.blueprint;
  if (options.state.tasks.some((task) => ["pending", "claimed", "failed", "retryable", "needs_user_decision"].includes(task.status))) {
    workflowFail("PLUGIN_REVISION_TASK_ACTIVE", "已有 active task，不能開始 plugin revision");
  }
  const intent = pluginIntentFromBlueprint({
    projectId: options.project.manifest.id,
    projectKind: options.project.manifest.kind,
    blueprint: options.project.blueprint,
    baseSelectionRevision: options.project.pluginSelectionRevision ?? "absent",
    sourcePins: options.project.pluginSources ?? [],
    ...(options.desiredSelections ? { desiredSelections: options.desiredSelections } : {}),
    ...(options.implementationPins ? { implementationPins: options.implementationPins } : {}),
  });
  const nextStage = intent.dependency_closure.includes("official.mvu-zod")
    ? "plugin_mvu_authoring"
    : intent.dependency_closure.includes("official.ejs")
      ? "plugin_ejs_authoring"
      : intent.dependency_closure.includes("official.html")
        ? "plugin_html_authoring"
        : "content_review";
  const inputArtifacts = options.state.artifacts
    .filter((artifact) => artifact.revision && !["missing", "stale"].includes(artifact.status))
    .map((artifact) => artifactReference({ id: artifact.id, revision: artifact.revision!, ...(artifact.contract ? { contract: artifact.contract } : {}) }));
  const intentArtifact = workflowArtifactSchema.parse({
    id: "plugin-revision-intent",
    status: "draft",
    revision: intent.revision,
    updated_at: options.occurredAt,
    contract: "plugin-revision-intent@1",
    extensions: intent,
  });
  const existing = options.state.artifacts.filter((artifact) => artifact.id !== "plugin-revision-intent" && !artifact.id.startsWith("preview-"));
  const intentState = workflowStateSchema.parse({
    ...options.state,
    stage: nextStage,
    revision: options.state.revision + 1,
    artifacts: [...existing, intentArtifact],
    tasks: [],
    gates: options.state.gates.map((gate) => gate.id === "content" || gate.id === "publish"
      ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] }
      : gate),
    extensions: { ...options.state.extensions, plugin_revision_intent: intent, plugin_input_artifacts: inputArtifacts },
  });
  if (nextStage === "content_review") return intentState;
  return workflowStateSchema.parse({
    ...intentState,
    tasks: materializePluginTasks(nextStage, blueprint, inputArtifacts, intentState),
  });
}

export function previewPluginRevision(options: {
  project: LoadedAuthorProject;
  desiredSelections?: readonly BlueprintPluginSelection[];
  implementationPins?: Partial<Record<OfficialPluginId, PluginImplementationPin>>;
}): PluginRevisionIntent {
  if (!options.project.manifest || !options.project.blueprint) workflowFail("PLUGIN_PROJECT_INVALID", "plugin revision project 不完整");
  if (options.project.manifest.kind !== "character_card") workflowFail("PLUGIN_PROJECT_KIND_DENIED", "worldbook 不支援 plugin revision");
  return pluginIntentFromBlueprint({
    projectId: options.project.manifest.id,
    projectKind: options.project.manifest.kind,
    blueprint: options.project.blueprint,
    baseSelectionRevision: options.project.pluginSelectionRevision ?? "absent",
    sourcePins: options.project.pluginSources ?? [],
    ...(options.desiredSelections ? { desiredSelections: options.desiredSelections } : {}),
    ...(options.implementationPins ? { implementationPins: options.implementationPins } : {}),
  });
}

function proposalResultPath(taskId: string, proposalId: string): string {
  return `.workflow/results/${taskId}/${proposalId}.json`;
}

function assertPluginTask(state: WorkflowState, taskId: string, owner: string): WorkflowState["tasks"][number] {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task || !task.kind.startsWith("create-plugin-")) workflowFail("PLUGIN_TASK_INVALID", `task ${taskId} 不是 plugin authoring task`);
  if (task.status !== "claimed" || task.assigned_agent !== owner) workflowFail("PLUGIN_TASK_LEASE_INVALID", "plugin proposal 必須由已 claim 的指定 agent 提交");
  if (task.lease && new Date(task.lease.expires_at).getTime() <= Date.now()) workflowFail("PLUGIN_TASK_LEASE_EXPIRED", "plugin task lease 已過期");
  return task;
}

export async function submitPluginProposal(options: {
  projectRoot: string;
  state: WorkflowState;
  taskId: string;
  owner: string;
  proposal: PluginProposalEnvelope;
  occurredAt: string;
}): Promise<WorkflowState> {
  const task = assertPluginTask(options.state, options.taskId, options.owner);
  const proposal = pluginProposalEnvelopeSchema.parse(options.proposal);
  if (proposal.task_id !== options.taskId) workflowFail("PLUGIN_PROPOSAL_TASK_INVALID", "plugin proposal task_id 與提交 task 不一致");
  if (proposal.project_id !== options.state.project_id || proposal.owner !== options.owner) workflowFail("PLUGIN_PROPOSAL_OWNER_INVALID", "plugin proposal project/owner 不一致");
  if (proposal.base_workflow_revision !== options.state.revision) workflowFail("PLUGIN_PROPOSAL_WORKFLOW_STALE", "plugin proposal workflow revision 已過期");
  if (task.extensions.plugin_id !== proposal.value.plugin_id) workflowFail("PLUGIN_PROPOSAL_SCOPE_INVALID", "proposal plugin 不符合 task scope");
  if (proposal.proposal_revision !== proposalRevisionFor(proposal)) workflowFail("PLUGIN_PROPOSAL_REVISION_INVALID", "proposal_revision 不符合 canonical proposal payload");
  if (proposal.pending_result_revision !== pendingResultRevisionFor(proposal)) workflowFail("PLUGIN_PROPOSAL_HASH_INVALID", "pending_result_revision 不符合 canonical proposal payload");
  const raw = proposalResultText(proposal);
  const currentManifest = await readOptionalRaw(await resolveWithin(options.projectRoot, "project.yaml"));
  if (!currentManifest || currentManifest.revision !== proposal.value.expected_manifest_revision) {
    workflowFail("PLUGIN_MANIFEST_CAS_CONFLICT", "plugin proposal 的 manifest raw revision 已過期");
  }
  const currentSource = await readOptionalRaw(await resolveWithin(options.projectRoot, `extensions/${proposal.value.plugin_id}/source.yaml`));
  if (proposal.value.expected_source_revision === "absent" ? currentSource !== undefined : currentSource?.revision !== proposal.value.expected_source_revision) {
    workflowFail("PLUGIN_SOURCE_CAS_CONFLICT", "plugin proposal 的 source raw revision 已過期");
  }
  if (currentSource) {
    try {
      pluginSourceSchema.parse(parsePluginDataText(currentSource.raw, "yaml"));
    } catch (error) {
      workflowFail("PLUGIN_SOURCE_INVALID", "目前 plugin source 無法通過 shared plugin-data/schema validation", error);
    }
  }
  const resultPath = proposalResultPath(options.taskId, proposal.id);
  // The proposal hash is self-reference-safe; the task result still records
  // the actual bytes revision so approval can detect file drift exactly.
  const result: ArtifactReference = { id: pendingResultId(proposal), revision: computeTextRevision(raw), contract: "plugin-proposal@1" };
  return commitWorkflowMutation(options.projectRoot, {
    expectedRevision: options.state.revision,
    eventId: `plugin-proposal-submit-${proposal.id}`,
    actor: options.owner,
    occurredAt: options.occurredAt,
    operations: [{ relativePath: resultPath, content: raw, expectedAbsent: true }],
    update: (current) => workflowStateSchema.parse({
      ...current,
      tasks: current.tasks.map((candidate) => candidate.id === task.id
        ? { ...candidate, status: "completed" as const, lease: undefined, result }
        : candidate),
      artifacts: [
        ...current.artifacts.filter((artifact) => artifact.id !== result.id),
        workflowArtifactSchema.parse({ id: result.id, status: "draft", revision: result.revision, updated_at: options.occurredAt, contract: result.contract, extensions: { proposal_id: proposal.id, plugin_id: proposal.value.plugin_id } }),
      ],
      revision: current.revision + 1,
        extensions: { ...current.extensions, [`plugin_pending_${proposal.value.plugin_id}_${proposal.id}`]: proposal },
    }),
  });
}

async function readOptionalRaw(filePath: string): Promise<{ raw: string; revision: Revision } | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    return { raw, revision: computeTextRevision(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function selectionForProposal(
  proposal: PluginProposalEnvelope,
  sourceRevision: Revision,
  artifactRevision: Revision,
): ReturnType<typeof pluginSelectionSchema.parse> {
  return pluginSelectionSchema.parse({
    schema_version: 1,
    plugin_id: proposal.value.plugin_id,
    capabilities: proposal.value.capabilities,
    source_revision: sourceRevision,
    implementation: proposal.value.source.implementation,
    artifact_revision: artifactRevision,
  });
}

export async function decidePluginProposal(options: {
  projectRoot: string;
  project: LoadedAuthorProject;
  state: WorkflowState;
  proposal: PluginProposalEnvelope;
  action: "approve" | "reject";
  occurredAt: string;
  authorizationToken: string;
  authenticatedSessionId?: string;
}): Promise<WorkflowState> {
  if (!options.project.manifest) workflowFail("PLUGIN_PROJECT_INVALID", "project manifest 不存在");
  const proposal = pluginProposalEnvelopeSchema.parse(options.proposal);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(options.authorizationToken)) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "plugin user authorization token 格式無效");
  }
  const tokenHash = createHash("sha256").update(options.authorizationToken, "utf8").digest("hex");
  const tokenRelativePath = `.workflow/plugin-review-tokens/${tokenHash}.json`;
  const tokenPath = await resolveWithin(options.projectRoot, tokenRelativePath);
  const tokenRaw = await readOptionalRaw(tokenPath);
  if (!tokenRaw) workflowFail("PLUGIN_USER_AUTHORIZATION_MISSING", "找不到 server-issued plugin authorization token");
  let authorization: PluginUserAuthorizationEnvelope;
  try {
    authorization = pluginUserAuthorizationEnvelopeSchema.parse(parsePluginDataText(tokenRaw.raw, "json"));
  } catch (error) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "server-issued plugin authorization token 格式無效", error);
  }
  if (authorization.token_hash !== tokenHash) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "opaque token hash 不符合 server-issued authorization");
  }
  if (authorization.project_id !== options.project.manifest.id || authorization.project_id !== options.state.project_id
    || authorization.proposal_id !== proposal.id || authorization.proposal_revision !== proposal.proposal_revision
    || authorization.workflow_revision !== options.state.revision || authorization.decision !== options.action) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "plugin user authorization binding 不一致");
  }
  if (options.authenticatedSessionId !== undefined && authorization.session_id !== options.authenticatedSessionId) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "plugin user authorization session 不一致");
  }
  if (authorization.consumed_at !== undefined || Date.parse(authorization.expires_at) <= Date.now()) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_EXPIRED", "plugin user authorization 已過期或已消耗");
  }
  if (authorization.consumed_at !== undefined) {
    workflowFail("PLUGIN_USER_AUTHORIZATION_INVALID", "authorization token binding 不一致或已消耗");
  }
  const consumedAuthorization = pluginUserAuthorizationEnvelopeSchema.parse({
    ...authorization,
    consumed_at: options.occurredAt,
  });
  const tokenOperation: TransactionOperation = {
    relativePath: tokenRelativePath,
    content: `${JSON.stringify(consumedAuthorization)}\n`,
    expectedRawRevision: tokenRaw.revision,
  };
  if (proposal.base_workflow_revision + 1 !== options.state.revision) {
    workflowFail("PLUGIN_PROPOSAL_WORKFLOW_STALE", "plugin proposal 必須直接接續提交後的 workflow revision");
  }
  const proposalTask = options.state.tasks.find((task) => task.id === proposal.task_id);
  if (!proposalTask || proposalTask.status !== "completed" || proposalTask.assigned_agent !== proposal.owner || proposalTask.result?.id !== pendingResultId(proposal)
    || proposalTask.extensions.plugin_id !== proposal.value.plugin_id) {
    workflowFail("PLUGIN_PENDING_RESULT_INVALID", "proposal task result 未綁定至指定 pending proposal");
  }
  const resultPath = proposalResultPath(proposal.task_id, proposal.id);
  const pendingPath = await resolveWithin(options.projectRoot, resultPath);
  const pending = await readOptionalRaw(pendingPath);
  if (!pending || proposalTask.result?.revision !== pending.revision) workflowFail("PLUGIN_PENDING_RESULT_STALE", "pending proposal bytes 已變更");
  let pendingProposal: PluginProposalEnvelope;
  try {
    pendingProposal = pluginProposalEnvelopeSchema.parse(parsePluginDataText(pending.raw, "json"));
  } catch (error) {
    workflowFail("PLUGIN_PENDING_RESULT_INVALID", "pending proposal bytes 不是有效 plugin proposal", error);
  }
  if (pending.raw !== proposalResultText(pendingProposal)
    || canonicalJson(pendingProposal) !== canonicalJson(proposal)
    || pendingProposal.proposal_revision !== proposal.proposal_revision
    || pendingProposal.pending_result_revision !== proposal.pending_result_revision
    || pendingProposal.proposal_revision !== proposalRevisionFor(pendingProposal)
    || pendingProposal.pending_result_revision !== pendingResultRevisionFor(pendingProposal)) {
    workflowFail("PLUGIN_PENDING_RESULT_STALE", "pending proposal bytes 與審查 proposal 不一致");
  }
  if (options.action === "reject") {
    return commitWorkflowMutation(options.projectRoot, {
      expectedRevision: options.state.revision,
      eventId: `plugin-proposal-reject-${proposal.id}`,
      actor: "dashboard-user",
      occurredAt: options.occurredAt,
      operations: [tokenOperation],
      expectations: [{ relativePath: resultPath, expectedRawRevision: pending.revision }],
      update: (current) => workflowStateSchema.parse({
        ...current,
        revision: current.revision + 1,
       decisions: [...current.decisions, { id: `plugin-review-${proposal.id}`, kind: "plugin.review.rejected", actor: "dashboard-user", decided_at: options.occurredAt, input_revisions: [{ id: pendingResultId(proposal), revision: proposal.pending_result_revision, contract: "plugin-proposal@1" }], summary: "Plugin proposal rejected", extensions: { proposal_id: proposal.id, plugin_id: proposal.value.plugin_id, authorization_session_id: authorization.session_id } }],
      }),
    });
  }
  const sourcePath = await resolveWithin(options.projectRoot, `extensions/${proposal.value.plugin_id}/source.yaml`);
  const manifestPath = await resolveWithin(options.projectRoot, "project.yaml");
  const currentSource = await readOptionalRaw(sourcePath);
  const currentManifest = await readOptionalRaw(manifestPath);
  if (!currentManifest || !options.project.manifest) workflowFail("PLUGIN_MANIFEST_INVALID", "project manifest 不存在");
  let currentManifestValue: ProjectManifest;
  try {
    currentManifestValue = projectManifestSchema.parse(parsePluginDataText(currentManifest.raw, "yaml"));
  } catch (error) {
    workflowFail("PLUGIN_MANIFEST_INVALID", "目前 project.yaml 無法通過 bounded parser/schema validation", error);
  }
  if (currentManifestValue.id !== options.state.project_id || currentManifestValue.kind !== "character_card") {
    workflowFail("PLUGIN_PROJECT_KIND_DENIED", "plugin approval 只允許目前的 character_card project");
  }
  if (proposal.value.expected_source_revision === "absent" ? currentSource !== undefined : currentSource?.revision !== proposal.value.expected_source_revision) {
    workflowFail("PLUGIN_SOURCE_CAS_CONFLICT", "plugin source raw revision 已變更");
  }
  if (proposal.value.expected_manifest_revision === "absent" || currentManifest.revision !== proposal.value.expected_manifest_revision) {
    workflowFail("PLUGIN_MANIFEST_CAS_CONFLICT", "project manifest raw revision 已變更");
  }
  if (currentSource) {
    try {
      pluginSourceSchema.parse(parsePluginDataText(currentSource.raw, "yaml"));
    } catch (error) {
      workflowFail("PLUGIN_SOURCE_INVALID", "目前 plugin source 無法通過 bounded parser/schema validation", error);
    }
  }
  const activePluginIds = new Set(currentManifestValue.plugins);
  const requiresMvu = proposal.value.plugin_id === "official.ejs"
    || (proposal.value.source.plugin_id === "official.html" && proposal.value.source.features.includes("status_bar"));
  if (requiresMvu && !activePluginIds.has("official.mvu-zod")) {
    workflowFail("PLUGIN_DEPENDENCY_MISSING", `${proposal.value.plugin_id} approval 需要 active official.mvu-zod`);
  }
  const currentMvu = requiresMvu ? await readPluginSource(options.projectRoot, "official.mvu-zod") : undefined;
  const currentMvuSource = currentMvu?.source.plugin_id === "official.mvu-zod" ? currentMvu.source : undefined;
  if (requiresMvu && currentMvuSource === undefined) {
    workflowFail("PLUGIN_DEPENDENCY_MISSING", "active official.mvu-zod source 不存在");
  }
  try {
    assertPluginSourcePinned(officialPluginImplementationRegistry, proposal.value.source);
    if (currentMvuSource) assertPluginSourcePinned(officialPluginImplementationRegistry, currentMvuSource);
  } catch (error) {
    workflowFail("PLUGIN_IMPLEMENTATION_PIN_INVALID", "proposal 或其 MVU dependency 未使用目前 registry 的 exact pin", error);
  }
  const generated = generatePluginContributions(proposal.value.source, {
    implementationRegistry: officialPluginImplementationRegistry,
    ...(currentMvuSource && proposal.value.plugin_id !== "official.mvu-zod" ? { mvuPathRegistry: compileMvuSource(currentMvuSource).path_registry } : {}),
    ...(options.project.greetings ? { greetingIds: options.project.greetings.greetings.map((greeting) => greeting.id) } : {}),
  });
  const generatedResolvedSourceHash = generated.metadata.resolved_source_hash;
  if (typeof generatedResolvedSourceHash !== "string" || generatedResolvedSourceHash !== proposal.value.resolved_source_hash) {
    workflowFail("PLUGIN_RESOLVED_SOURCE_MISMATCH", "proposal 的 resolved_source_hash 與重新生成結果不一致");
  }
  const sourceOperation = pluginSourceOperation(
    proposal.value.plugin_id,
    proposal.value.source,
    proposal.value.expected_source_revision === "absent" ? undefined : proposal.value.expected_source_revision,
  );
  const sourceRevision = computeTextRevision(sourceOperation.content);
  const selection = selectionForProposal(proposal, sourceRevision, generated.artifact_revision);
  const selectionPath = await resolveWithin(options.projectRoot, pluginSelectionRelativePath);
  const currentSelectionRaw = await readOptionalRaw(selectionPath);
  let currentSelection: ReturnType<typeof pluginSelectionProjectionSchema.parse> | undefined;
  try {
    currentSelection = currentSelectionRaw ? pluginSelectionProjectionSchema.parse(parsePluginDataText(currentSelectionRaw.raw, "yaml")) : undefined;
  } catch (error) {
    workflowFail("PLUGIN_SELECTION_INVALID", "既有 plugin-selection 無法通過 bounded parser/schema validation", error);
  }
  if (currentSelection && currentSelection.project_id !== currentManifestValue.id) {
    workflowFail("PLUGIN_SELECTION_PROJECT_MISMATCH", "既有 plugin-selection project_id 不一致");
  }
  if (currentManifestValue.plugins.length > 0 && currentSelection === undefined && !currentManifestValue.plugins.every((pluginId) => pluginId === proposal.value.plugin_id)) {
    workflowFail("PLUGIN_SELECTION_MISSING", "existing active plugins 必須先有 server-derived plugin-selection");
  }
  const selections = [...(currentSelection?.selections ?? []).filter((candidate) => candidate.plugin_id !== selection.plugin_id), selection]
    .sort((left, right) => left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0);
  const projection = pluginSelectionProjectionSchema.parse({
    schema_version: 1,
    project_id: currentManifestValue.id,
    intent_revision: typeof options.state.extensions.plugin_revision_intent === "object" && options.state.extensions.plugin_revision_intent !== null
      ? (options.state.extensions.plugin_revision_intent as { revision?: string }).revision ?? revisionFor({ project_id: options.project.manifest.id, selections })
      : revisionFor({ project_id: options.project.manifest.id, selections }),
    selections,
    updated_at: options.occurredAt,
  });
  const artifact = pluginArtifactSchema.parse({
    id: pluginArtifactId(proposal.value.plugin_id),
    plugin_id: proposal.value.plugin_id,
    revision: generated.artifact_revision,
    source_revision: sourceRevision,
    resolved_source_hash: proposal.value.resolved_source_hash,
    ...(proposal.value.template_payload_hash ? { template_payload_hash: proposal.value.template_payload_hash } : {}),
    implementation: proposal.value.source.implementation,
    generated_at: options.occurredAt,
    status: "approved",
  });
  const staleDependentArtifactIds = derivePluginDependencyImpact(proposal.value.plugin_id, currentSelection?.selections ?? []);
  const staleDependentArtifactSet = new Set(staleDependentArtifactIds);
  const artifactRelativePath = pluginArtifactRelativePath(artifact.id);
  const artifactAbsolutePath = await resolveWithin(options.projectRoot, artifactRelativePath);
  const currentArtifactRaw = await readOptionalRaw(artifactAbsolutePath);
  const nextManifest = projectManifestSchema.parse({ ...currentManifestValue, plugins: [...new Set([...currentManifestValue.plugins, proposal.value.plugin_id])] });
  const selectionContent = stringify(projection);
  const selectionRevision = computeTextRevision(selectionContent);
  const operations: TransactionOperation[] = [
    sourceOperation,
    { relativePath: "project.yaml", content: stringify(nextManifest), expectedRawRevision: currentManifest.revision },
    {
      relativePath: pluginSelectionRelativePath,
      content: selectionContent,
      ...(currentSelectionRaw ? { expectedRawRevision: currentSelectionRaw.revision } : { expectedAbsent: true }),
    },
    {
      relativePath: artifactRelativePath,
      content: `${canonicalJson({ artifact, source: proposal.value.source, contributions: generated })}\n`,
      ...(currentArtifactRaw ? { expectedRawRevision: currentArtifactRaw.revision } : { expectedAbsent: true }),
    },
    tokenOperation,
  ];
  return commitWorkflowMutation(options.projectRoot, {
    expectedRevision: options.state.revision,
    eventId: `plugin-proposal-approve-${proposal.id}`,
      actor: "dashboard-user",
      occurredAt: options.occurredAt,
      operations,
      expectations: [{ relativePath: resultPath, expectedRawRevision: pending.revision }],
    update: (current) => workflowStateSchema.parse({
        ...current,
         revision: current.revision + 1,
         artifacts: [
           ...current.artifacts
             .filter((candidate) => ![artifact.id, pendingResultId(proposal)].includes(candidate.id))
             .map((candidate) => candidate.id.startsWith("preview-") || staleDependentArtifactSet.has(candidate.id)
               ? { ...candidate, status: "stale" as const }
               : candidate),
           workflowArtifactSchema.parse({ id: artifact.id, status: "approved", revision: artifact.revision, updated_at: options.occurredAt, contract: "plugin-artifact@1", extensions: artifact }),
         ],
        decisions: [...current.decisions, { id: `plugin-review-${proposal.id}`, kind: "plugin.review.approved", actor: "dashboard-user", decided_at: options.occurredAt, input_revisions: [{ id: pendingResultId(proposal), revision: proposal.pending_result_revision, contract: "plugin-proposal@1" }], summary: "Plugin proposal approved", extensions: { proposal_id: proposal.id, plugin_id: proposal.value.plugin_id, artifact_revision: artifact.revision, authorization_session_id: authorization.session_id } }],
         gates: current.gates.map((gate) => ["content", "publish"].includes(gate.id) ? { ...gate, status: "pending" as const, decision_id: undefined, input_revisions: [] } : gate),
         extensions: {
           ...current.extensions,
           plugin_selection_revision: selectionRevision,
           plugin_dependency_impact: staleDependentArtifactIds,
         },
     }),
  });
}
