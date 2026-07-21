import path from "node:path";

import type { FastifyInstance } from "fastify";
import { traceProvenance, verifyProvenance } from "@card-workspace/ingestion";
import { z } from "zod";

import type { DashboardContext } from "../context.js";

export function registerProvenanceRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.post("/api/provenance/trace", async (request) => {
    const input = z.object({ project_id: z.string(), id: z.string() }).strict().parse(request.body);
    return { ok: true, data: await traceProvenance(path.join(context.projectsRoot, input.project_id), input.id) };
  });
  app.get<{ Params: { projectId: string } }>("/api/provenance/:projectId/verify", async (request) => ({
    ok: true,
    data: await verifyProvenance(path.join(context.projectsRoot, request.params.projectId)),
  }));
}
