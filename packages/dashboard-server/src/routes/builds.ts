import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance, FastifyReply } from "fastify";
import { importCardSource, roundTripImportedCard } from "@card-workspace/compiler";
import { loadAuthorProject, resolveExistingWithin } from "@card-workspace/project";
import { createCompilePreview, publishApprovedPreview, readCompilePreview } from "@card-workspace/workflow";
import { z } from "zod";

import type { DashboardContext } from "../context.js";
import { dashboardFail } from "../errors.js";
import type { DashboardEvents } from "../events.js";

export function registerBuildRoutes(app: FastifyInstance, context: DashboardContext, events: DashboardEvents): void {
  app.post("/api/builds/preview", async (request) => {
    const input = z.object({
      project_id: z.string(), preview_id: z.string(), event_id: z.string(),
      strict: z.boolean().default(true), token_budget: z.number().int().positive().optional(),
      json: z.boolean().default(true), png: z.boolean().default(false), v2_backfill: z.boolean().default(false),
    }).strict().parse(request.body);
    const preview = await createCompilePreview({
      workspaceRoot: context.workspaceRoot, projectId: input.project_id, previewId: input.preview_id,
      eventId: input.event_id, actor: "dashboard-user", occurredAt: new Date().toISOString(),
      build: {
        strict: input.strict,
        ...(input.token_budget !== undefined ? { tokenBudget: input.token_budget } : {}),
        json: input.json,
        png: input.png,
        v2Backfill: input.v2_backfill,
      },
    });
    events.publish({ type: "preview.changed", project_id: input.project_id, resource_kind: "preview", resource_id: preview.id, revision: preview.revision });
    return { ok: true, data: preview };
  });

  app.get<{ Params: { projectId: string } }>("/api/builds/:projectId/previews", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    if (!loaded.workflow) dashboardFail("DASHBOARD_WORKFLOW_INVALID", "Workflow is unavailable");
    const artifacts = loaded.workflow.artifacts
      .filter((artifact) => artifact.id.startsWith("preview-") && artifact.revision !== undefined)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    return {
      ok: true,
      data: await Promise.all(artifacts.map(async (artifact) => ({
        preview: await readCompilePreview(loaded.projectRoot, artifact.id),
        status: artifact.status,
        updated_at: artifact.updated_at,
      }))),
    };
  });

  app.get<{ Params: { projectId: string; previewId: string } }>("/api/builds/:projectId/preview/:previewId", async (request) => ({
    ok: true,
    data: await readCompilePreview(path.join(context.projectsRoot, request.params.projectId), request.params.previewId),
  }));

  app.post("/api/builds/publish", async (request) => {
    const input = z.object({ project_id: z.string(), preview_id: z.string(), event_id: z.string() }).strict().parse(request.body);
    const result = await publishApprovedPreview({
      workspaceRoot: context.workspaceRoot,
      projectId: input.project_id,
      previewId: input.preview_id,
      eventId: input.event_id,
      actor: "dashboard-user",
      occurredAt: new Date().toISOString(),
    });
    events.publish({ type: "build.published", project_id: input.project_id, resource_kind: "export", resource_id: input.preview_id, revision: result.preview.revision });
    return { ok: true, data: result };
  });

  app.get<{ Params: { projectId: string } }>("/api/builds/:projectId/exports", async (request) => {
    const root = path.join(context.exportsRoot, request.params.projectId);
    let names: string[] = [];
    try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const items = await Promise.all(names.filter(safeArtifactName).sort().map(async (name) => {
      const info = await stat(await resolveExistingWithin(root, name));
      return { id: name, bytes: info.size, modified_at: info.mtime.toISOString(), read_only: true };
    }));
    return { ok: true, data: items };
  });

  app.get<{ Params: { projectId: string; artifact: string } }>("/api/builds/:projectId/export/:artifact", async (request, reply) => {
    if (!safeArtifactName(request.params.artifact)) dashboardFail("DASHBOARD_ARTIFACT_INVALID", "Invalid artifact ID");
    const root = path.join(context.exportsRoot, request.params.projectId);
    const file = await resolveExistingWithin(root, request.params.artifact);
    const content = await readFile(file);
    sendArtifact(reply, request.params.artifact, content);
  });

  app.post("/api/builds/roundtrip", { bodyLimit: 48 * 1024 * 1024 }, (request) => {
    const input = z.object({ bytes_base64: z.string().max(48 * 1024 * 1024) }).strict().parse(request.body);
    const envelope = importCardSource(Buffer.from(input.bytes_base64, "base64"));
    return { ok: true, data: { envelope, report: roundTripImportedCard(envelope) } };
  });
}

function safeArtifactName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(name) && [".json", ".png", ".md"].includes(path.extname(name).toLowerCase());
}

function sendArtifact(reply: FastifyReply, name: string, content: Buffer): void {
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".json") ? "application/json" : "text/markdown; charset=utf-8";
  void reply.header("content-type", type).header("content-disposition", `attachment; filename="${name}"`).send(content);
}
