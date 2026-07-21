import type { FastifyInstance } from "fastify";
import { buildProject, normalizeAuthorProject, planCanonicalProject, simulateTriggers } from "@card-workspace/compiler";
import { loadAuthorProject } from "@card-workspace/project";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import { dashboardFail } from "../errors.js";

export function registerPlannerRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.get<{ Params: { projectId: string } }>("/api/planner/:projectId", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    const normalized = normalizeAuthorProject(loaded);
    if (!normalized.ok || !normalized.ir) dashboardFail("DASHBOARD_PROJECT_INVALID", "Project cannot be normalized");
    return { ok: true, data: { normalized, plan: planCanonicalProject(normalized.ir) } };
  });

  app.post("/api/planner/simulate", async (request) => {
    const input = z.object({
      project_id: z.string(), token_budget: z.number().int().positive().optional(),
      conversation: z.array(z.string()).default([]), strict: z.boolean().default(false),
    }).strict().parse(request.body);
    const built = await buildProject({
      workspaceRoot: context.workspaceRoot,
      projectId: input.project_id,
      publish: false,
      png: false,
      strict: input.strict,
      ...(input.token_budget !== undefined ? { tokenBudget: input.token_budget } : {}),
    });
    return { ok: true, data: {
      token: built.tokenReport,
      trigger: simulateTriggers(built.planned, {
        messages: input.conversation,
        budgetIncludedEntryIds: built.tokenReport.entries.filter((entry) => entry.included).map((entry) => entry.entry_id),
      }),
      plan: built.planned,
    } };
  });
}
