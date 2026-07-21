import path from "node:path";

import type { FastifyInstance } from "fastify";
import { artifactReferenceSchema, contentRevisionScopeSchema, gateRejectionRouteSchema, workflowStateSchema } from "@card-workspace/schemas";
import { loadAuthorProject } from "@card-workspace/project";
import { beginScopedContentRevision, commitWorkflowMutation, decideGate, deriveGateSnapshot, readCompilePreview } from "@card-workspace/workflow";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import { dashboardFail } from "../errors.js";
import type { DashboardEvents } from "../events.js";

const decisionSchema = z.object({
  project_id: z.string().min(1),
  expected_workflow_revision: z.number().int().nonnegative(),
  event_id: z.string().min(1),
  decision_id: z.string().min(1),
  gate_id: z.enum(["facts", "blueprint", "content", "publish"]),
  action: z.enum(["approve", "reject", "not_required"]),
  summary: z.string().min(1),
  input_revisions: z.array(artifactReferenceSchema),
  findings: z.array(z.object({
    id: z.string(), category: z.enum(["normative", "schema", "provenance", "workspace"]),
    severity: z.enum(["error", "warning", "info"]), overridable: z.boolean(),
  }).strict()).default([]),
  override_reason: z.string().optional(),
  rejection_route: gateRejectionRouteSchema.optional(),
  revision_scope: z.array(contentRevisionScopeSchema).length(1).optional(),
  revision_run_id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u).optional(),
  revision_artifact_ids: z.array(z.string().min(1)).default([]),
}).strict();

export function registerWorkflowRoutes(app: FastifyInstance, context: DashboardContext, events: DashboardEvents): void {
  app.get<{ Params: { projectId: string } }>("/api/workflow/:projectId", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    if (!loaded.workflow) dashboardFail("DASHBOARD_WORKFLOW_INVALID", "Workflow is unavailable");
    return { ok: true, data: loaded.workflow };
  });

  app.post("/api/workflow/gate", async (request) => {
    const input = decisionSchema.parse(request.body);
    const projectRoot = path.join(context.projectsRoot, input.project_id);
    const loaded = await loadAuthorProject(context.projectsRoot, input.project_id);
    if (!loaded.workflow) dashboardFail("DASHBOARD_WORKFLOW_INVALID", "Workflow is unavailable");
    const findings = input.gate_id === "publish"
      ? await publishFindings(projectRoot, input.input_revisions)
      : input.findings;
    const authoritative = deriveGateSnapshot(loaded.workflow, input.gate_id);
    const decision = decideGate(loaded.workflow, {
      decisionId: input.decision_id,
      gateId: input.gate_id,
      action: input.action,
      actor: "dashboard-user",
      actorRole: "user",
      decidedAt: new Date().toISOString(),
      inputRevisions: input.input_revisions.length === 0 ? authoritative : input.input_revisions,
      summary: input.summary,
      findings,
      ...(input.override_reason === undefined ? {} : { overrideReason: input.override_reason }),
      ...(input.rejection_route === undefined ? {} : { rejectionRoute: input.rejection_route }),
      ...(input.revision_scope === undefined ? {} : { revisionScope: input.revision_scope }),
    });
    let nextState = decision.state;
    if (input.action === "reject" && input.gate_id === "content" && input.rejection_route === "content_revision") {
      const scope = input.revision_scope?.[0];
      if (!scope || !input.revision_run_id) dashboardFail("DASHBOARD_CONTENT_REVISION_INVALID", "Content revision 必須指定唯一 scope 與 run ID");
      if (scope !== "greetings" && input.revision_artifact_ids.length === 0) {
        dashboardFail("DASHBOARD_CONTENT_REVISION_TARGET_REQUIRED", "Content revision 必須指定 exact artifact IDs");
      }
      if (!loaded.blueprint) dashboardFail("DASHBOARD_CONTENT_REVISION_INVALID", "Content revision requires a valid Blueprint");
      const routedState = beginScopedContentRevision({
        state: decision.state,
        blueprint: loaded.blueprint,
        worldEntries: loaded.world,
        scope,
        runId: input.revision_run_id,
        reason: input.summary,
        artifactIds: input.revision_artifact_ids,
        occurredAt: new Date().toISOString(),
        actor: "dashboard-user",
      });
      nextState = workflowStateSchema.parse({ ...routedState, revision: loaded.workflow.revision + 1 });
    }
    const state = await commitWorkflowMutation(projectRoot, {
      expectedRevision: input.expected_workflow_revision,
      eventId: input.event_id,
      actor: "dashboard-user",
      occurredAt: new Date().toISOString(),
      update: () => workflowStateSchema.parse(nextState),
    });
    events.publish({ type: "gate.changed", project_id: input.project_id, resource_kind: "gate", resource_id: input.gate_id, revision: state.revision });
    return { ok: true, data: { workflow: state, decision: decision.decision } };
  });
}

async function publishFindings(projectRoot: string, inputs: Array<{ id: string; revision: string }>) {
  if (inputs.length !== 1) dashboardFail("DASHBOARD_PUBLISH_INPUT_INVALID", "Publish Gate 必須指定一個 exact preview revision");
  const input = inputs[0];
  if (!input?.id.startsWith("preview-")) dashboardFail("DASHBOARD_PUBLISH_INPUT_INVALID", "Publish Gate input 必須是 preview");
  const preview = await readCompilePreview(projectRoot, input.id);
  if (preview.revision !== input.revision) dashboardFail("DASHBOARD_PUBLISH_INPUT_STALE", "Publish Gate preview revision 不符", 409);
  return preview.audit.findings.map((finding) => ({
    id: finding.rule_id,
    category: finding.layer === "compatibility" ? "schema" as const : finding.layer,
    severity: finding.severity,
    overridable: finding.overridable,
  }));
}
