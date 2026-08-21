import { createServer, type Server } from "node:http";
import { HttpSourceFetcher } from "@st-workspace/adapters";
import { assertProjectId, CoreError, FileAttachmentStore, FileProjectRepository, z } from "@st-workspace/core";
import { decodeAttachments } from "@st-workspace/domain";
import { AgentAdapter, AgentRouter, WorkspaceProjectManager, WorkspaceRuntime, WorkspaceWorker, type WorkspaceWorkerOptions } from "@st-workspace/runtime";
import { dashboard } from "./dashboard.js";
export { toolDefinitions } from "./mcp-tools.js";
import { applyBrowserSecurityHeaders, body, dashboardQuery, json, parseRequest, restError } from "./http-utils.js";
import { extractBearerToken, normalizeConfiguredAuthToken, parseRequestTarget, timingSafeTextEqual, assertMutationRequestAllowed, assertRequestHostAllowed } from "./http-security.js";
import { DashboardBrowserSessionStore, dashboardReauthenticationHtml, isDashboardSessionScope, type DashboardSessionAuthentication } from "./dashboard-session.js";
import { JSONRPC_INTERNAL_ERROR, jsonRpcError } from "./jsonrpc.js";
import { handleMcpRequest, handleRestRequest, type WorkspaceRouteDeps } from "./routes.js";
import { computeRuntimeRevision } from "./runtime-revision.js";
import { workspaceServerStartupMessage } from "./server-endpoint.js";
export { resolveWorkspaceServerEndpoint, workspaceServerStartupMessage } from "./server-endpoint.js";

const LOOPBACK_TRUSTED_HOSTNAMES = ["127.0.0.1", "localhost", "::1"] as const;
const LEGACY_CARD_MAX_BYTES = 5 * 1024 * 1024;
const legacyCardUploadSchema = z.object({
  attachments: z.array(z.unknown()).length(1),
}).strict();

export interface WorkspaceServerOptions {
  runtime?: WorkspaceRuntime;
  projectManager?: WorkspaceProjectManager;
  actor?: string;
  worker?: WorkspaceWorker;
  workerOptions?: WorkspaceWorkerOptions;
  autoStartWorker?: boolean;
  authToken?: string;
  runtimeRevision?: string;
  trustedHostnames?: readonly string[];
  browserSessionTtlMs?: number;
  browserSessionNow?: () => number;
  browserSessionSecure?: boolean;
}

export interface WorkspaceServer extends Server {
  readonly workspaceWorker: WorkspaceWorker;
  readonly runtimeRevision: string;
}

export function createWorkspaceServer(options: WorkspaceServerOptions): WorkspaceServer {
  const actor = options.actor ?? "agent";
  const runtimeRevision = options.runtimeRevision ?? "manual";
  if (options.runtime === undefined && options.projectManager === undefined) throw new Error("workspace server requires a runtime or project manager");
  const authToken = normalizeConfiguredAuthToken(options.authToken);
  const browserSessions = authToken === undefined
    ? undefined
    : new DashboardBrowserSessionStore({
        ...(options.browserSessionTtlMs === undefined ? {} : { ttlMs: options.browserSessionTtlMs }),
        ...(options.browserSessionNow === undefined ? {} : { now: options.browserSessionNow }),
        secure: options.browserSessionSecure ?? false,
      });
  const router = new AgentRouter();
  const runtimeForWorker = options.projectManager === undefined
    ? options.runtime
    : () => (options.projectManager!.sessionSelected() ? options.projectManager!.ensureRuntime() : undefined);
  if (runtimeForWorker === undefined) throw new Error("workspace server could not initialize a runtime");
  const worker = options.worker ?? new WorkspaceWorker(runtimeForWorker, { actor: `${actor}-worker`, ...options.workerOptions });
  const getRuntime = async (): Promise<WorkspaceRuntime> => options.projectManager === undefined ? options.runtime! : options.projectManager.ensureRuntime();
  const trustedHostnames = options.trustedHostnames ?? (authToken === undefined ? LOOPBACK_TRUSTED_HOSTNAMES : undefined);
  if (options.autoStartWorker ?? true) worker.start();
  const server = createServer(async (request, response) => {
    applyBrowserSecurityHeaders(response);
    let url: URL | null = null;
    try {
      url = parseRequestTarget(request.url, "http://localhost");
      if (url === null) {
        restError(response, new CoreError("REQUEST_TARGET_INVALID", "Malformed request target", true));
        return;
      }
      if (trustedHostnames !== undefined) {
        assertRequestHostAllowed(request.headers.host, trustedHostnames, request.socket.localPort);
      }
      let sessionAuthentication: DashboardSessionAuthentication = { status: "missing" };
      if (authToken !== undefined) {
        const headerToken = extractBearerToken(request.headers.authorization);
        const queryToken = url.searchParams.get("token");
        const isDashboardBootstrap = request.method === "GET" && url.pathname === "/";
        if (queryToken !== null && !isDashboardBootstrap) {
          restError(response, new CoreError("UNAUTHORIZED", "Query token is only allowed on the Dashboard bootstrap route", true));
          return;
        }
        const headerOk = headerToken !== undefined && timingSafeTextEqual(headerToken, authToken);
        const queryOk = isDashboardBootstrap && queryToken !== null && timingSafeTextEqual(queryToken, authToken);
        sessionAuthentication = browserSessions!.authenticate(request.headers.cookie);
        const sessionOk = isDashboardSessionScope(url.pathname) && sessionAuthentication.status === "valid";
        if (!headerOk && !queryOk && !sessionOk) {
          if (sessionAuthentication.status === "expired" || sessionAuthentication.status === "invalid") {
            response.setHeader("set-cookie", browserSessions!.clearCookie());
          }
          if (isDashboardBootstrap) {
            response.statusCode = 401;
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(dashboardReauthenticationHtml(queryToken !== null ? "invalid-token" : sessionAuthentication.status));
            return;
          }
          restError(response, new CoreError("UNAUTHORIZED", "Missing or invalid bearer token or Dashboard session", true));
          return;
        }
        if (queryOk) {
          response.setHeader("set-cookie", browserSessions!.issue().cookie);
        } else if (headerOk && (sessionAuthentication.status === "expired" || sessionAuthentication.status === "invalid")) {
          response.setHeader("set-cookie", browserSessions!.clearCookie());
        }
      }
      const isMutation = request.method !== undefined && request.method !== "GET" && request.method !== "HEAD";
      if (isMutation) {
        assertMutationRequestAllowed(request.headers, request.headers.host);
      }
      if (request.method === "POST" && url.pathname === "/workspace/auth/logout" && browserSessions !== undefined) {
        const revoked = browserSessions.revoke(request.headers.cookie);
        response.setHeader("set-cookie", browserSessions.clearCookie());
        json(response, 200, { status: "logged_out", revoked });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(dashboard({ authenticationRequired: authToken !== undefined }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/legacy-card/import") {
        const parsed = await body(request);
        const input = parseRequest(legacyCardUploadSchema, parsed, "ATTACHMENT_REQUIRED");
        const attachments = decodeAttachments(input.attachments);
        if (attachments.length !== 1) {
          throw new CoreError("ATTACHMENT_REQUIRED", "舊卡審核需要一個可讀取的 PNG、JSON 或 YAML 附件。", true);
        }
        const attachment = attachments[0]!;
        if (attachment.name === "." || attachment.name === ".." || /[\\/]/u.test(attachment.name)) {
          throw new CoreError("LEGACY_CARD_UNREADABLE", "舊卡上傳只接受檔名，不接受 filesystem path。", true);
        }
        if (!/\.(?:png|json|ya?ml)$/iu.test(attachment.name)) {
          throw new CoreError("LEGACY_CARD_UNREADABLE", "舊卡審核僅支援 PNG、JSON、YAML（.yaml/.yml）檔案。", true);
        }
        if (attachment.content.byteLength > LEGACY_CARD_MAX_BYTES) {
          throw new CoreError("ATTACHMENT_TOO_LARGE", "舊卡檔案超過 5 MiB 上限，請縮小檔案後重試。", true, { max_bytes: LEGACY_CARD_MAX_BYTES });
        }
        const requestText = `匯入舊卡 ${attachment.name}`;
        let result;
        if (options.projectManager !== undefined) {
          await options.projectManager.ensureRuntime();
          const repository = options.projectManager.repository;
          const directRuntime = new WorkspaceRuntime(repository, {
            interviewRequired: false,
            attachmentStore: new FileAttachmentStore(repository),
          });
          result = await options.projectManager.finalizeIfNamed(await directRuntime.request(requestText, { actor, attachments }));
        } else {
          result = await (await getRuntime()).request(requestText, { actor, attachments });
        }
        json(response, 200, result);
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/operations" && options.projectManager !== undefined && !options.projectManager.sessionSelected()) {
        const query = dashboardQuery(url);
        json(response, 200, {
          selected: false,
          items: [],
          total: 0,
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });
        return;
      }
      const deps: WorkspaceRouteDeps = {
        actor,
        worker,
        runtimeRevision,
        getRuntime,
        getAgentAdapter: async () => new AgentAdapter(await getRuntime(), router),
      };
      if (options.projectManager !== undefined) deps.projectManager = options.projectManager;
      if (options.runtime !== undefined) deps.runtime = options.runtime;
      if (await handleRestRequest(request, response, url, deps)) return;
      if (await handleMcpRequest(request, response, url, deps)) return;
      restError(response, new CoreError("NOT_FOUND", "Not found", false));
    } catch (error) {
      if (url !== null && url.pathname === "/mcp") {
        json(response, 200, jsonRpcError(null, JSONRPC_INTERNAL_ERROR, "Internal error"));
        return;
      }
      restError(response, error);
    }
  });
  server.once("close", () => worker.stop());
  return Object.assign(server, { workspaceWorker: worker, runtimeRevision });
}

export async function startWorkspaceServer(options: { port?: number; host?: string; projectRoot?: string; projectId?: string; actor?: string; authToken?: string; workspaceRoot?: string; runtimeRevision?: string } = {}): Promise<Server> {
  const host = options.host ?? process.env.ST_WORKSPACE_HOST ?? "127.0.0.1";
  const isLocalHost = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  const configuredAuthToken = normalizeConfiguredAuthToken(options.authToken);
  if (!isLocalHost && configuredAuthToken === undefined) {
    throw new CoreError("EXTERNAL_HOST_AUTH_REQUIRED", `Host ${host} exposes every read/write endpoint; refusing to start without an auth token.`, true);
  }
  const projectRoot = options.projectRoot ?? process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
  // An explicitly supplied root is already a complete workspace selection;
  // do not let an inherited project environment variable silently redirect it.
  // Environment-based project selection remains available for the default root
  // and for callers that pass projectId explicitly.
  const requestedProject = options.projectId ?? (options.projectRoot === undefined ? process.env.ST_WORKSPACE_PROJECT : undefined);
  const selectedProject = typeof requestedProject === "string" ? assertProjectId(requestedProject) : undefined;
  // Validate caller-controlled project identity before runtime revision probing or
  // any filesystem-backed repository/attachment object can perform I/O.
  const runtimeRevision = options.runtimeRevision ?? await computeRuntimeRevision(options.workspaceRoot ?? process.cwd());
  const fetcher = new HttpSourceFetcher();
  // Loopback mode uses an explicit Host allowlist to resist browser DNS rebinding.
  // Non-loopback mode keeps the mandatory auth-token boundary and does not infer DNS/reverse-proxy hostnames.
  const hostPolicy = isLocalHost ? { trustedHostnames: LOOPBACK_TRUSTED_HOSTNAMES } : {};
  const browserSessionPolicy = configuredAuthToken === undefined ? {} : { browserSessionSecure: !isLocalHost };
  const manager = selectedProject === undefined
    ? new WorkspaceProjectManager({ root: projectRoot, createRuntime: (repository) => new WorkspaceRuntime(repository, { fetcher: fetcher.fetch, interviewRequired: true, attachmentStore: new FileAttachmentStore(repository) }) })
    : undefined;
  const selectedRepository = selectedProject === undefined
    ? undefined
    : new FileProjectRepository(projectRoot, selectedProject, { layout: "project", materialize: true });
  const serverOptions: WorkspaceServerOptions = manager !== undefined
    ? { projectManager: manager, actor: options.actor ?? "server", runtimeRevision, ...hostPolicy, ...browserSessionPolicy, ...(configuredAuthToken === undefined ? {} : { authToken: configuredAuthToken }) }
    : { runtime: new WorkspaceRuntime(selectedRepository!, { fetcher: fetcher.fetch, attachmentStore: new FileAttachmentStore(selectedRepository!) }), actor: options.actor ?? "server", runtimeRevision, ...hostPolicy, ...browserSessionPolicy, ...(configuredAuthToken === undefined ? {} : { authToken: configuredAuthToken }) };
  const server = createWorkspaceServer(serverOptions);
  await new Promise<void>((resolve, reject) => {
    const listening = (): void => {
      server.off("error", failed);
      resolve();
    };
    const failed = (error: Error): void => {
      server.off("listening", listening);
      void server.workspaceWorker.stop().catch(() => undefined);
      reject(error);
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(options.port ?? Number(process.env.ST_WORKSPACE_PORT ?? 8787), host);
  });
  return server;
}

/* c8 ignore next 4 -- the server entrypoint is exercised through startWorkspaceServer tests. */
if (process.argv[1]?.endsWith("/server/dist/index.js") || process.argv[1]?.endsWith("\\server\\dist\\index.js")) {
  const server = await startWorkspaceServer();
  console.log(workspaceServerStartupMessage(server));
}
