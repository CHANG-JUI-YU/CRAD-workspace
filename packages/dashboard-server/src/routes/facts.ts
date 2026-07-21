import path from "node:path";

import type { FastifyInstance } from "fastify";
import { queryFacts, readActiveCandidateIndex, resolveConflict, reviewCandidate } from "@card-workspace/ingestion";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import type { DashboardEvents } from "../events.js";

export function registerFactRoutes(app: FastifyInstance, context: DashboardContext, events: DashboardEvents): void {
  app.get<{ Params: { projectId: string } }>("/api/facts/:projectId/candidates", async (request) => {
    const candidates = await readActiveCandidateIndex(path.join(context.projectsRoot, request.params.projectId));
    return { ok: true, data: [...candidates.candidates.values()].sort((left, right) => left.id.localeCompare(right.id)) };
  });

  app.post("/api/facts/query", async (request) => {
    const input = z.object({ project_id: z.string(), filter: z.record(z.string(), z.unknown()).default({}) }).strict().parse(request.body);
    return { ok: true, data: await queryFacts(path.join(context.projectsRoot, input.project_id), input.filter as never) };
  });

  app.post("/api/facts/review", async (request) => {
    const input = z.object({
      project_id: z.string(), decision: z.unknown(), expected_projection_revision: z.string(),
      expected_fact_revision: z.number().int().positive().optional(), patch: z.unknown().optional(),
    }).strict().parse(request.body);
    const result = await reviewCandidate(path.join(context.projectsRoot, input.project_id), {
      decision: input.decision as never,
      expectedProjectionRevision: input.expected_projection_revision as never,
      ...(input.expected_fact_revision === undefined ? {} : { expectedFactRevision: input.expected_fact_revision }),
      ...(input.patch === undefined ? {} : { patch: input.patch as never }),
    });
    events.publish({ type: "facts.changed", project_id: input.project_id, resource_kind: "facts", resource_id: "register", revision: result.projection.register.revision });
    return { ok: true, data: result };
  });

  app.post("/api/facts/conflict/resolve", async (request) => {
    const input = z.object({
      project_id: z.string(), decision: z.unknown(), expected_projection_revision: z.string(),
      expected_fact_revisions: z.record(z.string(), z.number().int().positive()).default({}),
    }).strict().parse(request.body);
    const result = await resolveConflict(path.join(context.projectsRoot, input.project_id), {
      decision: input.decision as never,
      expectedProjectionRevision: input.expected_projection_revision as never,
      expectedFactRevisions: input.expected_fact_revisions,
    });
    events.publish({ type: "facts.changed", project_id: input.project_id, resource_kind: "conflict", resource_id: "register", revision: result.projection.conflicts.revision });
    return { ok: true, data: result };
  });
}
