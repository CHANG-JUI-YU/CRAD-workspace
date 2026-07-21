import { readdir } from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { loadAuthorProject } from "@card-workspace/project";

import type { DashboardContext } from "../context.js";

export function registerProjectRoutes(app: FastifyInstance, context: DashboardContext): void {
  app.get("/api/projects", async () => {
    const entries = await readdir(context.projectsRoot, { withFileTypes: true });
    const projects = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const loaded = await loadAuthorProject(context.projectsRoot, entry.name);
        const workflow = loaded.workflow;
        return {
          id: entry.name,
          title: loaded.manifest?.title ?? entry.name,
          stage: workflow?.stage ?? "invalid",
          workflow_revision: workflow?.revision ?? 0,
          valid: loaded.ok,
          character_count: loaded.characters.length,
          pending_gates: workflow?.gates.filter((gate) => gate.status === "pending").length ?? 0,
          failed_tasks: workflow?.tasks.filter((task) => ["failed", "needs_user_decision"].includes(task.status)).length ?? 0,
          diagnostics: loaded.diagnostics,
        };
      }));
    return { ok: true, data: projects };
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    return { ok: true, data: {
      project: loaded.manifest,
      workflow: loaded.workflow,
      blueprint: loaded.blueprint,
      characters: loaded.characters,
      greetings: loaded.greetings,
      world: loaded.world,
      sources: loaded.sourceManifest,
      facts: loaded.factRegister,
      conflicts: loaded.conflictRegister,
      diagnostics: loaded.diagnostics,
      revisions: loaded.sourceRevisions,
    } };
  });

  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/health", async (request) => {
    const loaded = await loadAuthorProject(context.projectsRoot, request.params.projectId);
    return { ok: true, data: { ok: loaded.ok, diagnostics: loaded.diagnostics, project_root: path.basename(loaded.projectRoot) } };
  });
}
