import {
  blueprintPluginSelectionSchema,
  pluginProposalEnvelopeSchema,
  pluginRevisionIntentSchema,
  revisionSchema,
  stableIdSchema,
  type BlueprintPluginSelection,
  type OfficialPluginId,
  type PluginImplementationPin,
} from "@card-workspace/schemas";
import { loadAuthorProject, resolveWithin } from "@card-workspace/project";
import {
  beginPluginRevision,
  commitWorkflowMutation,
  decidePluginProposal,
  previewPluginRevision,
} from "@card-workspace/workflow";
import { officialPluginImplementationPin, resolvePluginSelectionDependencies } from "@card-workspace/plugins";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import type { DashboardEvents } from "../events.js";
import { dashboardFail } from "../errors.js";
import type { DashboardSessions } from "../security/session.js";

const tokenBindingSchema = z.object({
  project_id: z.string().min(1),
  proposal_id: z.string().min(1),
  proposal_revision: revisionSchema,
  decision: z.enum(["approve", "reject"]),
  workflow_revision: z.number().int().nonnegative(),
}).strict();

const reviewSchema = z.object({
  expected_workflow_revision: z.number().int().nonnegative(),
  proposal: pluginProposalEnvelopeSchema,
  action: z.enum(["approve", "reject"]),
  authorization_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

const revisionPreviewSchema = z.object({
  expected_workflow_revision: z.number().int().nonnegative(),
  desired_selections: z.array(blueprintPluginSelectionSchema),
}).strict();

const revisionBeginSchema = revisionPreviewSchema.extend({
  event_id: stableIdSchema,
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

function dependencyClosure(selections: readonly BlueprintPluginSelection[]): OfficialPluginId[] {
  return resolvePluginSelectionDependencies(selections);
}

function exactImplementationPins(
  selections: readonly BlueprintPluginSelection[],
): Partial<Record<OfficialPluginId, PluginImplementationPin>> {
  const pins: Partial<Record<OfficialPluginId, PluginImplementationPin>> = {};
  for (const pluginId of dependencyClosure(selections)) {
    try {
      pins[pluginId] = officialPluginImplementationPin(pluginId);
    } catch {
      dashboardFail("PLUGIN_IMPLEMENTATION_PIN_INVALID", `${pluginId} 沒有可用的 exact implementation pin`, 409, false);
    }
  }
  return pins;
}

export function registerPluginRoutes(
  app: FastifyInstance,
  context: DashboardContext,
  sessions: DashboardSessions,
  events: DashboardEvents,
): void {
  app.get<{ Params: { projectId: string } }>("/api/plugins/:projectId", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    return {
      ok: true,
      data: {
        project_id: request.params.projectId,
        project_kind: loaded.manifest?.kind,
        workflow_stage: loaded.workflow?.stage,
        workflow_revision: loaded.workflow?.revision,
        blueprint_selections: loaded.blueprint?.plugins ?? [],
        selection: loaded.pluginSelection,
        selection_revision: loaded.pluginSelectionRevision,
        sources: loaded.pluginSources ?? [],
        artifacts: loaded.pluginArtifacts ?? [],
        pending_proposals: loaded.workflow
          ? Object.entries(loaded.workflow.extensions)
            .filter(([key]) => key.startsWith("plugin_pending_"))
            .flatMap(([, value]) => {
              const parsed = pluginProposalEnvelopeSchema.safeParse(value);
              return parsed.success ? [parsed.data] : [];
            })
          : [],
        diagnostics: loaded.diagnostics,
      },
    };
  });

  app.post<{ Params: { projectId: string } }>("/api/plugins/:projectId/revision-preview", async (request) => {
    const input = revisionPreviewSchema.parse(request.body);
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    if (!loaded.workflow || loaded.workflow.revision !== input.expected_workflow_revision) {
      dashboardFail("PLUGIN_REVISION_WORKFLOW_STALE", "plugin revision preview 的 workflow revision 已過期", 409);
    }
    const selections = input.desired_selections.map((selection) => blueprintPluginSelectionSchema.parse(selection));
    const intent = previewPluginRevision({
      project: loaded,
      desiredSelections: selections,
      implementationPins: exactImplementationPins(selections),
    });
    return { ok: true, data: { intent, workflow_revision: loaded.workflow.revision } };
  });

  app.post<{ Params: { projectId: string } }>("/api/plugins/:projectId/revision-begin", async (request) => {
    const input = revisionBeginSchema.parse(request.body);
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    if (!loaded.workflow || loaded.workflow.revision !== input.expected_workflow_revision) {
      dashboardFail("PLUGIN_REVISION_WORKFLOW_STALE", "plugin revision begin 的 workflow revision 已過期", 409);
    }
    const selections = input.desired_selections.map((selection) => blueprintPluginSelectionSchema.parse(selection));
    const next = beginPluginRevision({
      state: loaded.workflow,
      project: loaded,
      occurredAt: input.occurred_at,
      actor: "dashboard-user",
      desiredSelections: selections,
      implementationPins: exactImplementationPins(selections),
    });
    const projectRoot = await resolveWithin(context.projectsRoot, request.params.projectId);
    const state = await commitWorkflowMutation(projectRoot, {
      expectedRevision: input.expected_workflow_revision,
      eventId: input.event_id,
      actor: "dashboard-user",
      occurredAt: input.occurred_at,
      update: () => next,
    });
    const intent = pluginRevisionIntentSchema.parse(state.extensions.plugin_revision_intent);
    events.publish({
      type: "workflow.changed",
      project_id: request.params.projectId,
      resource_kind: "plugin-revision",
      resource_id: "plugin-revision-intent",
      revision: state.revision,
    });
    return { ok: true, data: { workflow: state, intent } };
  });

  app.post<{ Params: { projectId: string } }>("/api/plugins/:projectId/decision-token", async (request) => {
    const input = tokenBindingSchema.parse({
      ...(request.body as Record<string, unknown>),
      project_id: request.params.projectId,
    });
    const loaded = await loadAuthorProject(context.projectsRoot, input.project_id);
    if (!loaded.workflow || loaded.workflow.revision !== input.workflow_revision) {
      dashboardFail("PLUGIN_REVIEW_WORKFLOW_STALE", "plugin review workflow revision 已過期", 409);
    }
    const projectRoot = await resolveWithin(context.projectsRoot, input.project_id);
    const issued = await sessions.issuePluginDecisionToken(
      projectRoot,
      input,
      request.headers.cookie,
      request.headers["x-csrf-token"] as string | undefined,
    );
    return { ok: true, data: issued };
  });

  app.post<{ Params: { projectId: string } }>("/api/plugins/:projectId/review", async (request) => {
    const input = reviewSchema.parse(request.body);
    if (input.proposal.project_id !== request.params.projectId) {
      dashboardFail("PLUGIN_REVIEW_PROJECT_MISMATCH", "proposal project_id 與 route 不一致");
    }
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    if (!loaded.workflow || loaded.workflow.revision !== input.expected_workflow_revision) {
      dashboardFail("PLUGIN_REVIEW_WORKFLOW_STALE", "plugin review workflow revision 已過期", 409);
    }
    const session = sessions.authenticate(
      request.headers.cookie,
      request.headers["x-csrf-token"] as string | undefined,
      true,
    );
    const projectRoot = await resolveWithin(context.projectsRoot, request.params.projectId);
    const state = await decidePluginProposal({
      projectRoot,
      project: loaded,
      state: loaded.workflow,
      proposal: input.proposal,
      action: input.action,
      occurredAt: input.occurred_at,
      authorizationToken: input.authorization_token,
      authenticatedSessionId: session.id,
    });
    events.publish({
      type: "workflow.changed",
      project_id: request.params.projectId,
      resource_kind: "plugin-review",
      resource_id: input.proposal.id,
      revision: state.revision,
    });
    return { ok: true, data: state };
  });
}
