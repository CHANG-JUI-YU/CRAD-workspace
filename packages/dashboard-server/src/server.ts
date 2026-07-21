import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";

import { dashboardBootstrapRequestSchema } from "@card-workspace/schemas";

import type { DashboardContext } from "./context.js";
import { DashboardError } from "./errors.js";
import { assertLoopbackRequest } from "./security/origin.js";
import { DashboardSessions } from "./security/session.js";
import { DashboardEvents } from "./events.js";
import { registerBuildRoutes } from "./routes/builds.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerFactRoutes } from "./routes/facts.js";
import { registerPlannerRoutes } from "./routes/planner.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerProvenanceRoutes } from "./routes/provenance.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerWorkflowRoutes } from "./routes/workflow.js";
import { registerPluginRoutes } from "./routes/plugins.js";

export interface DashboardServerOptions {
  context: DashboardContext;
  bootstrapToken?: string;
  logger?: boolean;
  clientDist?: string;
}

function mutation(request: FastifyRequest): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

export function createDashboardServer(options: DashboardServerOptions): {
  app: FastifyInstance;
  sessions: DashboardSessions;
} {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: "x-request-id",
  });
  const sessions = new DashboardSessions(options.bootstrapToken);
  const events = new DashboardEvents();

  app.addHook("onRequest", async (request, reply) => {
    assertLoopbackRequest(request, mutation(request));
    reply.headers({
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
    if (request.url === "/api/session/bootstrap") return;
    if (request.url.startsWith("/api/")) {
      sessions.authenticate(request.headers.cookie, request.headers["x-csrf-token"] as string | undefined, mutation(request));
    }
  });

  app.post("/api/session/bootstrap", async (request, reply) => {
    const input = dashboardBootstrapRequestSchema.parse(request.body);
    const session = sessions.bootstrap(input.token);
    reply.header("set-cookie", `cw_session=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return { ok: true, data: { csrf_token: session.csrf, expires_at: new Date(session.expiresAt).toISOString() } };
  });

  app.get("/api/session", (request) => ({ ok: true, data: { authenticated: true, csrf_token: sessions.csrfFor(request.headers.cookie) } }));
  app.get("/api/health", () => ({ ok: true, data: { status: "ok" } }));
  app.get("/api/events", async (_request, reply) => {
    events.subscribe(reply);
    return reply;
  });

  registerProjectRoutes(app, options.context);
  registerDocumentRoutes(app, options.context, events);
  registerWorkflowRoutes(app, options.context, events);
  registerPluginRoutes(app, options.context, sessions, events);
  registerSourceRoutes(app, options.context);
  registerFactRoutes(app, options.context, events);
  registerProvenanceRoutes(app, options.context);
  registerPlannerRoutes(app, options.context);
  registerBuildRoutes(app, options.context, events);

  if (options.clientDist !== undefined) {
    void app.register(fastifyStatic, { root: options.clientDist, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        void reply.code(404).send({ ok: false, error: { code: "DASHBOARD_ROUTE_NOT_FOUND", severity: "error", message: "API route not found", retryable: false, diagnostics: [], next_actions: [] } });
        return;
      }
      void reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const dashboardError = error instanceof DashboardError ? error : undefined;
    const statusCode = dashboardError?.statusCode ?? statusFromUnknown(error);
    sendError(reply, statusCode, dashboardError?.code ?? "DASHBOARD_INTERNAL_ERROR", dashboardError?.message ?? "Dashboard request failed", dashboardError?.retryable ?? false, dashboardError?.diagnostics ?? []);
  });

  return { app, sessions };
}

function statusFromUnknown(error: unknown): number {
  if (error instanceof Error && error.name === "ZodError") return 400;
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return 500;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : 500;
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string, retryable: boolean, diagnostics: unknown[]): void {
  void reply.code(statusCode).send({
    ok: false,
    error: { code, severity: "error", message, retryable, diagnostics, next_actions: [] },
  });
}
