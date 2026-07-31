import path from "node:path";

import type { FastifyInstance } from "fastify";
import { getJobStatus, getSourceRevision, getTextProjection, listChunkSets, listSources, verifyChunkSet } from "@card-workspace/ingestion";
import { revisionSchema, stableIdSchema } from "@card-workspace/schemas";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import { projectId, resourceId } from "../validation.js";

const sourceQuerySchema = z.object({ project_id: stableIdSchema, source_id: stableIdSchema, revision_id: revisionSchema.optional() }).strict();

export function registerSourceRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.get<{ Params: { projectId: string } }>("/api/sources/:projectId", async (request) => ({
    ok: true,
    data: await listSources(path.join(context.projectsRoot, projectId(request.params.projectId))),
  }));

  app.post("/api/sources/revision", async (request) => {
    const input = sourceQuerySchema.parse(request.body);
    const projectRoot = path.join(context.projectsRoot, projectId(input.project_id));
    const source = resourceId(input.source_id);
    const revision = await getSourceRevision(projectRoot, source, input.revision_id as never);
    const projection = await getTextProjection(projectRoot, source, input.revision_id as never);
    const chunkSets = await listChunkSets(projectRoot, source, revision.id);
    return { ok: true, data: { revision, projection, chunk_sets: chunkSets } };
  });

  app.post("/api/sources/chunk-set/verify", async (request) => {
    const input = z.object({ project_id: stableIdSchema, source_id: stableIdSchema, revision_id: revisionSchema, chunk_set_id: stableIdSchema }).strict().parse(request.body);
    return { ok: true, data: await verifyChunkSet(path.join(context.projectsRoot, projectId(input.project_id)), resourceId(input.source_id), input.revision_id as never, resourceId(input.chunk_set_id)) };
  });

  app.post("/api/sources/job", async (request) => {
    const input = z.object({ project_id: stableIdSchema, job_id: stableIdSchema }).strict().parse(request.body);
    return { ok: true, data: await getJobStatus(path.join(context.projectsRoot, projectId(input.project_id)), resourceId(input.job_id)) };
  });
}
