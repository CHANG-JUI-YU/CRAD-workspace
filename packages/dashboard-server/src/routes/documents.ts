import path from "node:path";

import type { FastifyInstance } from "fastify";
import { dashboardPatchRequestSchema, dashboardResourceRefSchema } from "@card-workspace/schemas";

import type { DashboardContext } from "../context.js";
import type { DashboardEvents } from "../events.js";
import { patchDashboardDocument, readDashboardDocument } from "../resources.js";

export function registerDocumentRoutes(app: FastifyInstance, context: DashboardContext, events: DashboardEvents): void {
  app.post("/api/documents/read", async (request) => {
    const resource = dashboardResourceRefSchema.parse(request.body);
    return { ok: true, data: await readDashboardDocument(path.join(context.projectsRoot, resource.project_id), resource) };
  });

  app.post("/api/documents/patch", async (request) => {
    const input = dashboardPatchRequestSchema.parse(request.body);
    const result = await patchDashboardDocument({
      projectRoot: path.join(context.projectsRoot, input.resource.project_id),
      resource: input.resource,
      expectedRevision: input.expected_revision,
      operations: input.operations,
      dryRun: input.dry_run,
    });
    if (!input.dry_run && !result.no_op) events.publish({
      type: "project.changed",
      project_id: input.resource.project_id,
      resource_kind: input.resource.kind,
      resource_id: input.resource.id,
      revision: result.after_revision,
    });
    return { ok: true, data: result };
  });
}
