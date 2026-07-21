import { canonicalJson, canonicalYaml, computeRevision, computeTextRevision, loadAuthorProject, orderedYaml } from "@card-workspace/project";
import { workflowStateSchema, type Revision, type WorkflowArtifact, type WorkflowTask } from "@card-workspace/schemas";

import { workflowFail } from "./errors.js";
import { commitWorkflowMutation } from "./repository.js";
import { validateProposal } from "./proposal-validation.js";

export interface ApplyProposalOptions {
  projectsRoot: string;
  projectId: string;
  taskId: string;
  proposal: unknown;
  eventId: string;
  occurredAt: string;
  expectedArtifactRevisions?: Record<string, Revision>;
}

export async function applyProposal(options: ApplyProposalOptions) {
  const loaded = await loadAuthorProject(options.projectsRoot, options.projectId);
  if (!loaded.ok || !loaded.workflow) workflowFail("PROPOSAL_PROJECT_INVALID", "套用前作者專案必須完整有效");
  const task = loaded.workflow.tasks.find((item) => item.id === options.taskId);
  if (!task || ["failed", "superseded", "needs_user_decision"].includes(task.status)) {
    workflowFail("PROPOSAL_TASK_STALE", `task ${options.taskId} 已失效`);
  }
  const { proposal, targets } = validateProposal({ task, proposal: options.proposal, project: loaded });
  const revisions = options.expectedArtifactRevisions ?? {};
  const serializedTargets = new Map<string, string>();
  const operations = targets.map((target) => {
    const actual = loaded.sourceRevisions[target.relativePath];
    const expected = revisions[target.relativePath] ?? (targets.length === 1 ? proposal.base_artifact_revision : undefined);
    if (actual !== undefined && expected === undefined) workflowFail("PROPOSAL_BASE_REVISION_REQUIRED", `${target.relativePath} 需要 base raw revision`);
    if (actual === undefined && expected !== "absent") workflowFail("PROPOSAL_EXPECTED_ABSENT_REQUIRED", `${target.relativePath} 新檔需要 expectedAbsent`);
    if (actual !== undefined && expected !== actual) workflowFail("PROPOSAL_ARTIFACT_REVISION_CONFLICT", `${target.relativePath} base raw revision 已過期`);
    const content = /^characters\/[^/]+\/(?:zhuji|palette)\//u.test(target.relativePath)
      ? orderedYaml(target.value)
      : canonicalYaml(target.value);
    serializedTargets.set(target.relativePath, content);
    return {
      relativePath: target.relativePath,
      content,
      ...(actual === undefined ? { expectedAbsent: true } : { expectedRawRevision: actual }),
    };
  });
  const resultRevision = computeRevision(proposal);
  const preservedApprovedGates = proposal.value.kind === "blueprint"
    ? new Set(["facts"])
    : new Set(["facts", "blueprint"]);
  const resultPath = `.workflow/results/${task.id}/${proposal.id}.json`;
  operations.push({ relativePath: resultPath, content: canonicalJson(proposal), expectedAbsent: true });
  const targetArtifacts: WorkflowArtifact[] = targets.map((target) => ({
    id: target.relativePath === "blueprint.yaml" ? "blueprint" : `author-${target.relativePath.replace(/[^a-z0-9._-]+/gu, "-")}`,
    status: "draft",
    revision: computeTextRevision(serializedTargets.get(target.relativePath)!),
    updated_at: options.occurredAt,
    ...(target.relativePath === "relationships.yaml" ? { contract: "relationships@1" } : {}),
    extensions: {},
  }));
  const participantArtifactCharacters = new Map(targets.map((target, index) => {
    const match = /^characters\/([^/]+)\//u.exec(target.relativePath);
    return [targetArtifacts[index]!.id, match?.[1]] as const;
  }));
  const next = await commitWorkflowMutation(loaded.projectRoot, {
    expectedRevision: proposal.base_workflow_revision,
    eventId: options.eventId,
    actor: proposal.owner,
    occurredAt: options.occurredAt,
    operations,
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      tasks: state.tasks.map((item): WorkflowTask => {
        if (item.id === task.id) return {
          ...item,
          status: "completed",
          result: { id: proposal.id, revision: resultRevision, contract: "proposal@1" },
          lease: undefined,
        };
        if (item.kind !== "create-relationships" || item.status !== "pending" || !Array.isArray(item.extensions.participant_ids)) return item;
        const participants = new Set(item.extensions.participant_ids.filter((id): id is string => typeof id === "string"));
        const additions = targetArtifacts
          .filter((artifact) => {
            const characterId = participantArtifactCharacters.get(artifact.id);
            return characterId !== undefined && participants.has(characterId);
          })
          .map((artifact) => ({ id: artifact.id, revision: artifact.revision!, ...(artifact.contract ? { contract: artifact.contract } : {}) }));
        if (additions.length === 0) return item;
        const addedIds = new Set(additions.map((artifact) => artifact.id));
        return { ...item, input_artifacts: [...item.input_artifacts.filter((artifact) => !addedIds.has(artifact.id)), ...additions] };
      }),
      artifacts: [
        ...state.artifacts
          .filter((item) => !targetArtifacts.some((target) => target.id === item.id))
          .map((item) => (["reviewed", "approved"].includes(item.status) || item.id.startsWith("preview")) ? { ...item, status: "stale" as const } : item),
        ...targetArtifacts,
      ],
      gates: state.gates.map((gate) => gate.status === "approved" && !preservedApprovedGates.has(gate.id)
        ? { ...gate, status: "superseded" as const }
        : gate),
    }),
  });
  return { state: next, targets: targets.map((item) => item.relativePath), resultPath, resultRevision };
}
