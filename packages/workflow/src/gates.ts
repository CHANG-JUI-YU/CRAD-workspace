import {
  workflowGateSchema,
  workflowStateSchema,
  type ArtifactReference,
  type PluginArtifact,
  type WorkflowDecision,
  type WorkflowGate,
  type WorkflowState,
} from "@card-workspace/schemas";

import { WORKFLOW_GATE_ORDER, getWorkflowDefinition, type WorkflowGateId } from "./definitions.js";
import { createDecision } from "./decisions.js";
import { workflowFail } from "./errors.js";
import { createSuccessorTask, type SuccessorTaskSpec } from "./tasks.js";

export interface GateFinding {
  id: string;
  category: "normative" | "schema" | "provenance" | "workspace";
  severity: "error" | "warning" | "info";
  overridable: boolean;
}

export interface GateDecisionInput {
  decisionId: string;
  gateId: WorkflowGateId;
  action: "approve" | "reject" | "not_required";
  actor: string;
  actorRole: "user" | "director";
  decidedAt: string;
  inputRevisions: ArtifactReference[];
  summary: string;
  option?: string;
  impact?: string;
  findings?: readonly GateFinding[];
  overrideReason?: string;
  rejectionRoute?: "facts_recuration" | "blueprint_successor" | "content_revision" | "repreview" | "cancel";
  revisionScope?: Array<"character" | "relationship" | "world" | "greetings">;
}

const gateStages: Record<WorkflowGateId, WorkflowState["stage"]> = {
  facts: "facts_review",
  blueprint: "blueprint",
  content: "content_review",
  publish: "publish_review",
};

const pluginArtifactIds = new Set([
  "plugin-official.mvu-zod",
  "plugin-official.ejs",
  "plugin-official.html",
]);

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reference(item: WorkflowState["artifacts"][number]): ArtifactReference {
  return { id: item.id, revision: item.revision!, ...(item.contract ? { contract: item.contract } : {}) };
}

export function deriveCurrentContentSnapshot(state: WorkflowState): ArtifactReference[] {
  return state.artifacts
    .filter((item) => {
      if (!item.revision || ["missing", "stale"].includes(item.status)) return false;
      if (item.id.startsWith("author-")) return true;
      return pluginArtifactIds.has(item.id) && item.status === "approved";
    })
    .map(reference)
    .sort((left, right) => lexicalCompare(left.id, right.id));
}

/** Invalidates workflow evidence when persisted plugin inputs drift. */
export function supersedeStalePluginEvidence(
  state: WorkflowState,
  currentArtifacts: readonly PluginArtifact[],
  currentSelectionRevision?: string,
): WorkflowState {
  const stateApproved = new Map<string, string>(
    state.artifacts
      .filter((artifact) => pluginArtifactIds.has(artifact.id) && artifact.status === "approved" && artifact.revision)
      .map((artifact) => [artifact.id, artifact.revision!] as const),
  );
  const currentApproved = new Map<string, string>(
    currentArtifacts
      .filter((artifact) => artifact.status === "approved")
      .map((artifact) => [`plugin-${artifact.plugin_id}`, artifact.revision] as const),
  );
  const artifactIds = new Set([...stateApproved.keys(), ...currentApproved.keys()]);
  const artifactsChanged = [...artifactIds].some((id) => {
    const stateArtifact = state.artifacts.find((artifact) => artifact.id === id);
    // A stale workflow artifact is an intentional dependency invalidation. Keep it stale
    // while the persisted source is still the last approved, readable artifact.
    if (stateArtifact?.status === "stale") return false;
    return stateApproved.get(id) !== currentApproved.get(id);
  });
  const recordedSelectionRevision = typeof state.extensions.plugin_selection_revision === "string"
    ? state.extensions.plugin_selection_revision
    : undefined;
  const hasSelectionEvidence = recordedSelectionRevision !== undefined || currentSelectionRevision !== undefined;
  const selectionChanged = hasSelectionEvidence && recordedSelectionRevision !== currentSelectionRevision;
  if (!artifactsChanged && !selectionChanged) return state;

  return workflowStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    artifacts: state.artifacts.map((artifact) => {
      if (pluginArtifactIds.has(artifact.id) && artifact.status !== "stale") return { ...artifact, status: "stale" as const };
      if (artifact.id.startsWith("preview-") && artifact.status !== "stale") return { ...artifact, status: "stale" as const };
      return artifact;
    }),
    gates: state.gates.map((gate) => ["content", "publish"].includes(gate.id) && gate.status === "approved"
      ? { ...gate, status: "superseded" as const }
      : gate),
  });
}

/** Derives the only snapshot that may be decided for a Gate from workflow state. */
export function deriveGateSnapshot(state: WorkflowState, gateId: WorkflowGateId): ArtifactReference[] {
  if (state.stage !== gateStages[gateId]) workflowFail("GATE_STAGE_INVALID", `${gateId} gate 不可在 stage ${state.stage} 決定`);
  const current = state.artifacts.filter((item) => item.revision && !["missing", "stale"].includes(item.status));
  let snapshot: ArtifactReference[];
  if (gateId === "facts") {
    snapshot = current.filter((item) => ["fact-register", "conflict-register"].includes(item.id)).map(reference);
  } else if (gateId === "blueprint") {
    const expansionCandidate = current.find((item) => item.id.startsWith("character-expansion-candidate-"));
    snapshot = (expansionCandidate ? [expansionCandidate] : current.filter((item) => item.id === "blueprint")).map(reference);
  } else if (gateId === "content") {
    snapshot = deriveCurrentContentSnapshot(state);
  } else {
    snapshot = current.filter((item) => item.id.startsWith("preview-") && item.status === "reviewed").map(reference);
  }
  snapshot.sort((left, right) => lexicalCompare(left.id, right.id));
  if (snapshot.length === 0) workflowFail("GATE_SNAPSHOT_EMPTY", `${gateId} gate authoritative snapshot 不可為空`);
  if (gateId === "publish" && snapshot.length !== 1) workflowFail("GATE_SNAPSHOT_AMBIGUOUS", "Publish Gate 必須只有一個 current reviewed preview");
  return snapshot;
}

function assertExactSnapshot(supplied: readonly ArtifactReference[], authoritative: readonly ArtifactReference[]): void {
  const normalize = (items: readonly ArtifactReference[]) => [...items]
    .map(({ id, revision, contract }) => ({ id, revision, ...(contract ? { contract } : {}) }))
    .sort((left, right) => lexicalCompare(left.id, right.id));
  if (JSON.stringify(normalize(supplied)) !== JSON.stringify(normalize(authoritative))) {
    workflowFail("GATE_SNAPSHOT_STALE", "Gate decision 必須使用 authoritative exact current snapshot");
  }
}

function applyRejectionRoute(state: WorkflowState, input: GateDecisionInput, snapshot: ArtifactReference[]): Pick<WorkflowState, "tasks" | "extensions"> {
  let tasks = state.tasks;
  if (input.gateId === "facts") {
    if (input.rejectionRoute !== "facts_recuration") workflowFail("GATE_REJECTION_ROUTE_REQUIRED", "Facts rejection 必須建立 audited facts_recuration");
    if (state.tasks.some((task) => task.extensions.gate_rejection_decision_id === input.decisionId)) workflowFail("GATE_REJECTION_SUCCESSOR_EXISTS", "Facts rejection successor 已存在");
    tasks = [...state.tasks, createSuccessorTask({
      id: `curate-facts-recurate-${input.decisionId}`,
      kind: "curate-facts",
      assignedAgent: "fact-curator",
      capabilities: ["task.execute", "source.process", "facts.propose", "facts.read"],
      inputArtifacts: state.artifacts.filter((artifact) => artifact.id.startsWith("source-") && artifact.revision && !["missing", "stale"].includes(artifact.status)).map(reference),
      outputContract: "facts-curation-summary@1",
      dependencies: [],
      maxAttempts: 3,
      extensions: { stage: "source_processing", gate_rejection_decision_id: input.decisionId, predecessor_snapshot: snapshot },
    }, "engine")];
  } else if (input.gateId === "blueprint") {
    if (state.extensions.character_expansion === undefined && input.rejectionRoute !== "blueprint_successor") {
      workflowFail("GATE_REJECTION_ROUTE_REQUIRED", "Blueprint rejection 必須建立唯一 blueprint_successor");
    }
    if (state.extensions.character_expansion === undefined) {
      if (state.tasks.some((task) => task.kind === "create-blueprint" && ["pending", "claimed", "retryable"].includes(task.status))) {
        workflowFail("GATE_REJECTION_SUCCESSOR_EXISTS", "Blueprint rejection 只能有一個 active successor");
      }
      tasks = [...state.tasks, createSuccessorTask({
        id: `create-blueprint-successor-${input.decisionId}`,
        kind: "create-blueprint",
        assignedAgent: "director",
        capabilities: ["task.execute", "blueprint.propose"],
        inputArtifacts: snapshot,
        outputContract: "proposal@1",
        dependencies: [],
        maxAttempts: 3,
        extensions: { stage: "blueprint", gate_rejection_decision_id: input.decisionId },
      }, "engine")];
    }
  } else if (input.gateId === "content") {
    if (input.rejectionRoute !== "content_revision" || !input.revisionScope?.length) {
      workflowFail("GATE_REVISION_SCOPE_REQUIRED", "Content rejection 必須由 Director 提供 exact revision scope");
    }
  } else if (!(["repreview", "content_revision", "cancel"] as const).includes(input.rejectionRoute as never)) {
    workflowFail("GATE_REJECTION_ROUTE_REQUIRED", "Publish rejection 必須選擇 repreview、content_revision 或 cancel");
  }
  return {
    tasks,
    extensions: {
      ...state.extensions,
      ...(input.rejectionRoute ? { gate_rejection_route: input.rejectionRoute } : {}),
      ...(input.revisionScope ? { needs_revision_scope: [...new Set(input.revisionScope)] } : {}),
    },
  };
}

function assertGateOrder(state: WorkflowState, gateId: WorkflowGateId): void {
  const index = WORKFLOW_GATE_ORDER.indexOf(gateId);
  for (const priorId of WORKFLOW_GATE_ORDER.slice(0, index)) {
    const prior = state.gates.find((gate) => gate.id === priorId);
    if (prior === undefined || !["approved", "not_required"].includes(prior.status)) {
      workflowFail("GATE_ORDER_INVALID", `${gateId} gate 前必須先通過 ${priorId} gate`);
    }
  }
}

export function decideGate(state: WorkflowState, input: GateDecisionInput): { state: WorkflowState; decision: WorkflowDecision } {
  if (input.actorRole === "director") workflowFail("GATE_ACTOR_DENIED", "Director 只能呈現 gate，不能批准或拒絕");
  assertGateOrder(state, input.gateId);
  const gate = state.gates.find((candidate) => candidate.id === input.gateId);
  if (gate === undefined) workflowFail("GATE_NOT_FOUND", `找不到 gate：${input.gateId}`);
  if (input.action === "not_required") {
    const definition = getWorkflowDefinition(state.entry_kind);
    if (!definition.optionalGates.includes(input.gateId)) workflowFail("GATE_NOT_REQUIRED_DENIED", `${input.gateId} 不可標為 not_required`);
  }
  if (input.action === "approve") {
    const blocking = input.findings?.find((finding) => finding.severity === "error" && (["normative", "schema", "provenance"].includes(finding.category) || !finding.overridable));
    if (blocking !== undefined) workflowFail("GATE_FINDING_BLOCKED", `finding ${blocking.id} 不可覆寫`);
    const overridden = input.findings?.some((finding) => finding.severity === "error" && finding.category === "workspace" && finding.overridable);
    if (overridden && input.overrideReason?.trim() === "") workflowFail("GATE_OVERRIDE_REASON_REQUIRED", "覆寫 workspace finding 必須提供理由");
    if (overridden && input.overrideReason === undefined) workflowFail("GATE_OVERRIDE_REASON_REQUIRED", "覆寫 workspace finding 必須提供理由");
  }
  const hasDerivableSnapshot = state.artifacts.some((item) => item.revision && !["missing", "stale"].includes(item.status));
  const authoritative = hasDerivableSnapshot ? deriveGateSnapshot(state, input.gateId) : input.inputRevisions;
  if (authoritative.length === 0 && input.action !== "not_required") workflowFail("GATE_SNAPSHOT_EMPTY", `${input.gateId} gate snapshot 不可為空`);
  assertExactSnapshot(input.inputRevisions, authoritative);
  const routed = input.action === "reject" ? applyRejectionRoute(state, input, authoritative) : { tasks: state.tasks, extensions: state.extensions };
  const decision = createDecision({
    id: input.decisionId,
    kind: `gate.${input.action}`,
    actor: input.actor,
    actorRole: input.actorRole,
    decidedAt: input.decidedAt,
    inputRevisions: authoritative,
    summary: input.summary,
    ...(input.option === undefined ? {} : { option: input.option }),
    ...((input.overrideReason ?? input.impact) === undefined ? {} : { impact: input.overrideReason ?? input.impact }),
  });
  const status = input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "not_required";
  const updatedGate = workflowGateSchema.parse({ ...gate, status, decision_id: decision.id, input_revisions: authoritative });
  const rejectionStage = input.action !== "reject" ? state.stage
    : input.gateId === "facts" ? "source_processing"
    : input.gateId === "publish" && input.rejectionRoute === "repreview" ? "compile_preview"
    : input.gateId === "publish" && input.rejectionRoute === "content_revision" ? "content_review"
    : state.stage;
  return {
    decision,
    state: workflowStateSchema.parse({
      ...state,
      stage: rejectionStage,
      revision: state.revision + 1,
      gates: state.gates.map((candidate) => candidate.id === input.gateId ? updatedGate : candidate),
      decisions: [...state.decisions, decision],
      tasks: routed.tasks,
      extensions: routed.extensions,
      ...(input.action === "reject" && input.gateId === "publish" && input.rejectionRoute === "cancel" ? {
        outcome: { status: "closed", kind: "cancelled", closed_at: input.decidedAt, decision_id: decision.id },
      } : {}),
    }),
  };
}

export function supersedeStaleGates(state: WorkflowState, currentInputs: ReadonlyMap<WorkflowGateId, readonly ArtifactReference[]>): WorkflowState {
  let changed = false;
  const gates = state.gates.map((gate) => {
    if (gate.status !== "approved") return gate;
    const current = currentInputs.get(gate.id);
    if (current === undefined || sameReferences(gate.input_revisions, current)) return gate;
    changed = true;
    return workflowGateSchema.parse({ ...gate, status: "superseded" });
  });
  return changed ? workflowStateSchema.parse({ ...state, revision: state.revision + 1, gates }) : state;
}

function sameReferences(left: readonly ArtifactReference[], right: readonly ArtifactReference[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.id === right[index]?.id
    && item.revision === right[index]?.revision
    && item.contract === right[index]?.contract);
}

export function createRejectedGateSuccessor(gate: WorkflowGate, spec: SuccessorTaskSpec) {
  if (gate.status !== "rejected") workflowFail("GATE_NOT_REJECTED", `${gate.id} gate 未被拒絕`);
  return createSuccessorTask(spec, "engine");
}
