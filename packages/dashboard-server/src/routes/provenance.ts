import path from "node:path";
import type { FastifyInstance } from "fastify";
import { traceProvenance, verifyProvenance } from "@card-workspace/ingestion";
import { stableIdSchema } from "@card-workspace/schemas";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import { projectId, resourceId } from "../validation.js";

export function registerProvenanceRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.post("/api/provenance/trace", async (request) => {
    const input = z.object({ project_id: stableIdSchema, id: stableIdSchema }).strict().parse(request.body);
    return { ok: true, data: await traceProvenance(path.join(context.projectsRoot, projectId(input.project_id)), resourceId(input.id)) };
  });
  app.get<{ Params: { projectId: string } }>("/api/provenance/:projectId/verify", async (request) => ({ ok: true, data: await verifyProvenance(path.join(context.projectsRoot, projectId(request.params.projectId))) }));
}
