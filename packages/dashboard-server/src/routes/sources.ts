import path from "node:path";

import type { FastifyInstance } from "fastify";
import { getJobStatus, getSourceRevision, getTextProjection, listChunkSets, listSources, verifyChunkSet } from "@card-workspace/ingestion";
import { z } from "zod";

import type { DashboardContext } from "../context.js";

const sourceQuerySchema = z.object({
  project_id: z.string().min(1),
  source_id: z.string().min(1),
  revision_id: z.string().optional(),
}).strict();

export function registerSourceRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.get<{ Params: { projectId: string } }>("/api/sources/:projectId", async (request) => ({
    ok: true,
    data: await listSources(path.join(context.projectsRoot, request.params.projectId)),
  }));

  app.post("/api/sources/revision", async (request) => {
    const input = sourceQuerySchema.parse(request.body);
    const projectRoot = path.join(context.projectsRoot, input.project_id);
    const revision = await getSourceRevision(projectRoot, input.source_id, input.revision_id as never);
    const projection = await getTextProjection(projectRoot, input.source_id, input.revision_id as never);
    const chunkSets = await listChunkSets(projectRoot, input.source_id, revision.id);
    return { ok: true, data: { revision, projection, chunk_sets: chunkSets } };
  });

  app.post("/api/sources/chunk-set/verify", async (request) => {
    const input = z.object({ project_id: z.string(), source_id: z.string(), revision_id: z.string(), chunk_set_id: z.string() }).strict().parse(request.body);
    return { ok: true, data: await verifyChunkSet(path.join(context.projectsRoot, input.project_id), input.source_id, input.revision_id as never, input.chunk_set_id) };
  });

  app.post("/api/sources/job", async (request) => {
    const input = z.object({ project_id: z.string(), job_id: z.string() }).strict().parse(request.body);
    return { ok: true, data: await getJobStatus(path.join(context.projectsRoot, input.project_id), input.job_id) };
  });
}
