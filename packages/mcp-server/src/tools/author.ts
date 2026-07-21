import {
  proposalSchema,
  reviewReportSchema,
  workflowStateSchema,
  type ArtifactReference,
  type WorkflowTask,
} from "@card-workspace/schemas";
import { canonicalJson, canonicalYaml, computeRevision, loadAuthorProject } from "@card-workspace/project";
import { applyProposal, commitWorkflowMutation } from "@card-workspace/workflow";

import { mcpFail } from "../errors.js";
import { stringArg, type ToolCallContext } from "./types.js";

const proposalKinds = {
  blueprint_submit_proposal: ["blueprint"],
  character_submit_proposal: ["character", "zhuji", "palette", "relationships"],
  world_submit_proposal: ["world"],
  greetings_submit_proposal: ["greetings"],
  conversion_submit_proposal: ["conversion"],
  import_submit_analysis: ["import_analysis"],
} as const;

async function persistResult(
  context: ToolCallContext,
  id: string,
  contract: "proposal@1" | "review-report@1",
  value: unknown,
) {
  const taskId = stringArg(context.args, "task_id");
  const task = context.workflow.tasks.find((item) => item.id === taskId);
  if (!task || task.output_contract !== contract) mcpFail("TASK_OUTPUT_CONTRACT_MISMATCH", `Task does not accept ${contract}`);
  const revision = computeRevision(value);
  const result: ArtifactReference = { id, revision, contract };
  const nextTask: WorkflowTask = { ...task, status: "completed", result, lease: undefined };
  const next = await commitWorkflowMutation(context.projectRoot, {
    expectedRevision: Number(context.args.expected_workflow_revision),
    eventId: stringArg(context.args, "event_id"),
    actor: context.trusted.agentId,
    occurredAt: stringArg(context.args, "occurred_at"),
    operations: [{
      relativePath: `.workflow/results/${task.id}/${id}.json`,
      content: canonicalJson(value),
      expectedAbsent: true,
    }],
    update: (state) => workflowStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      tasks: state.tasks.map((item) => item.id === task.id ? nextTask : item),
    }),
  });
  return { state: next, result };
}

function proposal(tool: keyof typeof proposalKinds) {
  return async (context: ToolCallContext) => {
    const parsed = proposalSchema.parse(context.args.proposal);
    if (parsed.owner !== context.trusted.agentId) mcpFail("PROPOSAL_OWNER_MISMATCH", "Proposal owner must match the bound server identity");
    if (parsed.base_workflow_revision !== context.workflow.revision) mcpFail("WORKFLOW_REVISION_CONFLICT", "Proposal workflow revision is stale");
    if (!(proposalKinds[tool] as readonly string[]).includes(parsed.value.kind)) mcpFail("PROPOSAL_KIND_DENIED", `Proposal kind is not accepted by ${tool}`);
    if (parsed.value.kind === "conversion") return persistResult(context, parsed.id, "proposal@1", parsed);
    return applyProposal({
      projectsRoot: `${context.trusted.workspaceRoot}/projects`,
      projectId: context.workflow.project_id,
      taskId: stringArg(context.args, "task_id"),
      proposal: parsed,
      eventId: stringArg(context.args, "event_id"),
      occurredAt: stringArg(context.args, "occurred_at"),
      ...(
        context.args.expected_artifact_revisions !== null
        && typeof context.args.expected_artifact_revisions === "object"
        && !Array.isArray(context.args.expected_artifact_revisions)
          ? { expectedArtifactRevisions: context.args.expected_artifact_revisions as Record<string, `sha256:${string}`> }
          : {}
      ),
    });
  };
}

export const authorTools = {
  blueprint_submit_proposal: proposal("blueprint_submit_proposal"),
  character_submit_proposal: proposal("character_submit_proposal"),
  world_submit_proposal: proposal("world_submit_proposal"),
  greetings_submit_proposal: proposal("greetings_submit_proposal"),
  conversion_submit_proposal: proposal("conversion_submit_proposal"),
  import_submit_analysis: proposal("import_submit_analysis"),
  review_submit_report: async (context: ToolCallContext) => {
    const report = reviewReportSchema.parse(context.args.report);
    if (report.reviewer !== context.trusted.agentId) mcpFail("REVIEW_OWNER_MISMATCH", "Review owner must match the bound server identity");
    const target = context.workflow.artifacts.find((item) => item.id === report.target_id)
      ?? context.workflow.tasks.flatMap((item) => item.result ? [item.result] : []).find((item) => item.id === report.target_id);
    if (!target || target.revision !== report.target_revision) mcpFail("REVIEW_TARGET_STALE", "Review target revision is stale");
    if (report.target_id === "author-greetings.yaml") {
      const project = await loadAuthorProject(`${context.trusted.workspaceRoot}/projects`, context.workflow.project_id);
      if (!project.ok || !project.greetings) mcpFail("REVIEW_TARGET_UNAVAILABLE", "Greeting review target is unavailable", project.diagnostics);
      const exactTarget = canonicalYaml(project.greetings);
      for (const finding of report.findings.filter((item) => item.severity !== "info")) {
        if (finding.evidence.some((evidence) => evidence.excerpt === undefined || !exactTarget.includes(evidence.excerpt))) {
          mcpFail("REVIEW_EVIDENCE_NOT_IN_TARGET", `Finding ${finding.id} evidence does not exist in the exact Greeting revision`);
        }
      }
    }
    return persistResult(context, report.id, "review-report@1", report);
  },
} satisfies Record<string, (context: ToolCallContext) => unknown>;
