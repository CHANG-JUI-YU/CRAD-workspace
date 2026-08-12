import { createServer, type Server } from "node:http";
import { HttpSourceFetcher } from "@st-workspace/adapters";
import { CoreError, FileAttachmentStore, FileProjectRepository } from "@st-workspace/core";
import { AgentAdapter, AgentRouter, WorkspaceProjectManager, WorkspaceRuntime, WorkspaceWorker, type WorkspaceWorkerOptions } from "@st-workspace/runtime";
import { dashboard } from "./dashboard.js";
import { structuredError } from "./errors.js";
export { toolDefinitions } from "./mcp-tools.js";
import { json } from "./http-utils.js";
import { handleMcpRequest, handleRestRequest, type WorkspaceRouteDeps } from "./routes.js";

export interface WorkspaceServerOptions {
  runtime?: WorkspaceRuntime;
  projectManager?: WorkspaceProjectManager;
  actor?: string;
  worker?: WorkspaceWorker;
  workerOptions?: WorkspaceWorkerOptions;
  autoStartWorker?: boolean;
  authToken?: string;
}

export interface WorkspaceServer extends Server {
  readonly workspaceWorker: WorkspaceWorker;
}

export function createWorkspaceServer(options: WorkspaceServerOptions): WorkspaceServer {
  const actor = options.actor ?? "agent";
  if (options.runtime === undefined && options.projectManager === undefined) throw new Error("workspace server requires a runtime or project manager");
  const router = new AgentRouter();
  const runtimeForWorker = options.projectManager === undefined
    ? options.runtime
    : () => (options.projectManager!.sessionSelected() ? options.projectManager!.ensureRuntime() : undefined);
  if (runtimeForWorker === undefined) throw new Error("workspace server could not initialize a runtime");
  const worker = options.worker ?? new WorkspaceWorker(runtimeForWorker, { actor: `${actor}-worker`, ...options.workerOptions });
  const getRuntime = async (): Promise<WorkspaceRuntime> => options.projectManager === undefined ? options.runtime! : options.projectManager.ensureRuntime();
  if (options.autoStartWorker ?? true) worker.start();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (options.authToken !== undefined) {
        const headerToken = request.headers.authorization === `Bearer ${options.authToken}`;
        const queryToken = request.method === "GET" && url.searchParams.get("token") === options.authToken;
        if (!headerToken && !queryToken) {
          json(response, 401, structuredError(new CoreError("UNAUTHORIZED", "Missing or invalid bearer token", true)));
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(dashboard());
        return;
      }
      const deps: WorkspaceRouteDeps = {
        actor,
        worker,
        getRuntime,
        getAgentAdapter: async () => new AgentAdapter(await getRuntime(), router),
      };
      if (options.projectManager !== undefined) deps.projectManager = options.projectManager;
      if (options.runtime !== undefined) deps.runtime = options.runtime;
      if (await handleRestRequest(request, response, url, deps)) return;
      if (await handleMcpRequest(request, response, url, deps)) return;
      json(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const payload = structuredError(error);
      if (new URL(request.url ?? "/", "http://localhost").pathname === "/mcp") {
        json(response, 200, { jsonrpc: "2.0", id: null, error: { code: payload.recoverable ? -32602 : -32603, message: payload.code === "INTERNAL_ERROR" ? payload.error : `${payload.code}: ${payload.message_zh}` } });
        return;
      }
      json(response, payload.recoverable ? 400 : 500, payload);
    }
  });
  server.once("close", () => worker.stop());
  return Object.assign(server, { workspaceWorker: worker });
}

export async function startWorkspaceServer(options: { port?: number; host?: string; projectRoot?: string; projectId?: string; actor?: string; authToken?: string } = {}): Promise<Server> {
  const host = options.host ?? process.env.ST_WORKSPACE_HOST ?? "127.0.0.1";
  const isLocalHost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  if (!isLocalHost && options.authToken === undefined) {
    throw new CoreError("EXTERNAL_HOST_AUTH_REQUIRED", `Host ${host} exposes every read/write endpoint; refusing to start without an auth token.`, true);
  }
  const projectRoot = options.projectRoot ?? process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
  const fetcher = new HttpSourceFetcher();
  // An explicitly supplied root is already a complete workspace selection;
  // do not let an inherited project environment variable silently redirect it.
  // Environment-based project selection remains available for the default root
  // and for callers that pass projectId explicitly.
  const requestedProject = options.projectId ?? (options.projectRoot === undefined ? process.env.ST_WORKSPACE_PROJECT : undefined);
  const selectedProject = typeof requestedProject === "string" && requestedProject.trim().length > 0 ? requestedProject.trim() : undefined;
  const manager = selectedProject === undefined
    ? new WorkspaceProjectManager({ root: projectRoot, createRuntime: (repository) => new WorkspaceRuntime(repository, { fetcher: fetcher.fetch, interviewRequired: true, attachmentStore: new FileAttachmentStore(repository) }) })
    : undefined;
  const serverOptions: WorkspaceServerOptions = manager !== undefined
    ? { projectManager: manager, actor: options.actor ?? "server", ...(options.authToken === undefined ? {} : { authToken: options.authToken }) }
    : { runtime: new WorkspaceRuntime(new FileProjectRepository(projectRoot, selectedProject!, { layout: "project", materialize: true }), { fetcher: fetcher.fetch, attachmentStore: new FileAttachmentStore(projectRoot, selectedProject!) }), actor: options.actor ?? "server", ...(options.authToken === undefined ? {} : { authToken: options.authToken }) };
  const server = createWorkspaceServer(serverOptions);
  await new Promise<void>((resolve) => server.listen(options.port ?? Number(process.env.ST_WORKSPACE_PORT ?? 8787), host, resolve));
  return server;
}

/* c8 ignore next 3 -- the server entrypoint is exercised through startWorkspaceServer tests. */
if (process.argv[1]?.endsWith("/server/dist/index.js") || process.argv[1]?.endsWith("\\server\\dist\\index.js")) {
  await startWorkspaceServer();
  console.log(`ST Workspace server listening on http://127.0.0.1:${process.env.ST_WORKSPACE_PORT ?? "8787"}`);
}
