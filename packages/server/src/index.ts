import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import { HttpSourceFetcher } from "@st-workspace/adapters";
import { CoreError, FileAttachmentStore, FileProjectRepository, internalId, templateProposalJsonSchema, type AdaptationDecision, type IssueSeverity, type RequestResult, type SourceAttachment, z, zhujiProposalJsonSchema } from "@st-workspace/core";
import { adaptationDecisionInputSchema, answerSchema, characterIdSchema, decodeAttachments, factReviewBatchInputSchema, imageInputSchema, imageRemoveInputSchema, issueUpdateInputSchema, operationIdSchema, projectSchema, qualityLevelSchema, qualityProfileInputSchema, reextractInputSchema, requestSchema, sourceSelectionInputSchema, templateKindSchema, type IssueUpdateInput } from "@st-workspace/domain";
import { AgentAdapter, AgentRouter, parseDashboardQuery, WorkspaceProjectManager, WorkspaceRuntime, WorkspaceWorker, type WorkspaceWorkerOptions } from "@st-workspace/runtime";
import { dashboard } from "./dashboard.js";
import { structuredError } from "./errors.js";

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

const supportedMcpProtocolVersions = new Set(["2025-11-25", "2025-06-18"]);

function mcpProtocolVersion(params: unknown): string {
  if (params !== null && typeof params === "object") {
    const requested = (params as { protocolVersion?: unknown }).protocolVersion;
    if (typeof requested === "string" && supportedMcpProtocolVersions.has(requested)) return requested;
  }
  return "2025-11-25";
}

// OpenCode's MCP schema validator requires every tool input schema to declare
// a top-level object type. The template contract is a oneOf of object shapes,
// so the generated JSON Schema omits that redundant discriminator. Adding it
// at the MCP boundary preserves the contract while keeping the schema valid
// for OpenCode and other strict MCP clients.
const templateProposalMcpInputSchema: Record<string, unknown> = { ...(templateProposalJsonSchema as Record<string, unknown>), type: "object" };

// The MCP surface must stay a high-level contract: internal operation and
// storage fields (project ids, revisions, capabilities, stages, steps, file
// paths, encoded payloads) are stripped from the exposed JSON Schema. The
// authoritative validation still runs through the zod contract server-side.
const exposedSchemaKeyPattern = /project_id|revision|capability|stage|steps|file_path|bytes_base64/iu;

function sanitizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJsonSchema).filter((item) => typeof item !== "string" || !exposedSchemaKeyPattern.test(item));
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (exposedSchemaKeyPattern.test(key)) continue;
      output[key] = sanitizeJsonSchema(item);
    }
    return output;
  }
  return value;
}

const sanitizedTemplateProposalMcpInputSchema = sanitizeJsonSchema(templateProposalMcpInputSchema);

export const toolDefinitions = [
  {
    name: "workspace_request",
    description: "Execute a natural-language workspace intent.",
    inputSchema: { type: "object", additionalProperties: false, properties: { request: { type: "string" }, agent: { type: "string", description: "Optional visible Agent id or alias. Omit to let Director route the intent." } }, required: ["request"] },
  },
  {
    name: "workspace_status",
    description: "Read the current workspace operation status.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_agents",
    description: "List the visible Agents, their roles, and the default Director route.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_zhuji_context",
    description: "Read the Zhuji Creator contract, seven module guides, JSON Schema, and existing module instances.",
    inputSchema: { type: "object", additionalProperties: false, properties: { character_id: { type: "string", description: "Optional character id used to filter existing module instances." } } },
  },
  {
    name: "workspace_zhuji_submit",
    description: "Submit one validated Zhuji module proposal. The proposal must match the seven-module JSON Schema.",
    inputSchema: zhujiProposalJsonSchema,
  },
  {
    name: "workspace_template_context",
    description: "Read the fixed template contract, JSON Schema, guide and existing examples for one Agent/Skill output kind.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: ["character", "zhuji", "palette", "wardrobe", "greetings", "relationships", "world", "conversion", "import_analysis", "review", "source_research", "fact_curation", "fact_review", "plugin", "director_routing"],
        },
      },
      required: ["kind"],
    },
  },
  {
    name: "workspace_template_submit",
    description: "Submit one validated high-level template value. Internal operation and storage details are generated by the workspace.",
    inputSchema: sanitizedTemplateProposalMcpInputSchema,
  },
  {
    name: "workspace_issue_update",
    description: "Resolve, ignore, or override one review issue. Ignore and override are allowed only for overridable findings and every action needs a reason.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        issue_id: { type: "string" },
        action: { type: "string", enum: ["resolve", "ignore", "override"] },
        reason: { type: "string" },
        severity: { type: "string", enum: ["critical", "error", "warning", "info"] },
        agent: { type: "string", description: "Optional trusted execution agent; defaults to Director." },
      },
      required: ["issue_id", "action", "reason"],
    },
  },
  {
    name: "workspace_authoring_context",
    description: "Read Blueprint, accepted and unresolved Facts, source records, and adaptation decisions for Creator authoring.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_source_candidates",
    description: "List source candidates and their explicit selection state.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_source_select",
    description: "Explicitly approve or reject source candidate ids before source ingestion.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { candidate_id: { type: "string" }, decision: { type: "string", enum: ["approve", "reject"] } },
            required: ["candidate_id", "decision"],
          },
        },
      },
      required: ["decisions"],
    },
  },
  {
    name: "workspace_adaptation_decision",
    description: "Record how a deliberate Blueprint-versus-canon difference should be handled.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        topic: { type: "string" },
        choice: { type: "string", enum: ["keep_blueprint", "adopt_fact", "blend", "defer"] },
        blueprint_refs: { type: "array", items: { type: "string" } },
        fact_refs: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
      required: ["topic", "choice", "rationale"],
    },
  },
  {
    name: "workspace_interview_context",
    description: "Read exactly one current high-level project interview question and its saved answers. Do not treat this as a batch questionnaire.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_interview_answer",
    description: "Answer exactly the current project interview question. The workspace stores one answer atomically and returns one next question; it does not accept batch answers.",
    inputSchema: { type: "object", additionalProperties: false, properties: { answer: { type: "string" } }, required: ["answer"] },
  },
  {
    name: "workspace_projects",
    description: "List projects available inside the workspace projects folder.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "workspace_project_select",
    description: "Select an existing project by its visible name or folder name.",
    inputSchema: { type: "object", additionalProperties: false, properties: { project: { type: "string" } }, required: ["project"] },
  },
] as const;

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

class RequestBodyError extends Error {
  readonly code = "REQUEST_INVALID_UTF8";
  readonly recoverable = true;

  constructor() {
    super("Request body is not valid UTF-8");
    this.name = "RequestBodyError";
  }
}

class RequestJsonError extends Error {
  readonly code = "REQUEST_INVALID_JSON";
  readonly recoverable = true;

  constructor() {
    super("Request body is not valid JSON");
    this.name = "RequestJsonError";
  }
}

class RequestTooLargeError extends Error {
  readonly code = "REQUEST_TOO_LARGE";
  readonly recoverable = true;

  constructor() {
    super("Request body exceeds the 10 MiB limit");
    this.name = "RequestTooLargeError";
  }
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

async function body(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new RequestTooLargeError();
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(Buffer.from(chunk));
  }
  if (tooLarge) throw new RequestTooLargeError();
  if (chunks.length === 0) return {};
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new RequestBodyError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestJsonError();
  }
}

function parseRequest<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown, code: string): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CoreError(code, `Invalid ${(schema as z.ZodTypeAny & { description?: string }).description ?? "input"}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`, true);
  }
  return parsed.data;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result as T;
}

function dashboardQuery(url: URL) {
  const raw: { cursor?: string; limit?: string; filter?: string } = {};
  const cursor = url.searchParams.get("cursor");
  const limit = url.searchParams.get("limit");
  const filter = url.searchParams.get("filter");
  if (cursor !== null) raw.cursor = cursor;
  if (limit !== null) raw.limit = limit;
  if (filter !== null) raw.filter = filter;
  return parseDashboardQuery(raw);
}

function dashboardPathId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new CoreError("DASHBOARD_PATH_INVALID", "Dashboard resource id is invalid", true);
  }
}

function visibleAgents(agentAdapter: AgentAdapter): { default_agent: string; agents: ReturnType<AgentAdapter["list"]> } {
  return { default_agent: "director", agents: agentAdapter.list() };
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
  const getAgentAdapter = async (): Promise<AgentAdapter> => new AgentAdapter(await getRuntime(), router);
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
      if (request.method === "GET" && url.pathname === "/workspace/status") {
        if (options.projectManager === undefined) {
          json(response, 200, await options.runtime!.status());
        } else if (!options.projectManager.sessionSelected()) {
          json(response, 200, { ok: true, selected: false, projects: await options.projectManager.listProjects() });
        } else {
          json(response, 200, await options.projectManager.status());
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/data") {
        if (options.projectManager !== undefined && !options.projectManager.sessionSelected()) {
          json(response, 200, { selected: false, projects: await options.projectManager.listProjects() });
        } else {
          json(response, 200, await (await getRuntime()).dashboardSummary());
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/artifacts") {
        json(response, 200, await (await getRuntime()).dashboardArtifacts(dashboardQuery(url)));
        return;
      }
      const artifactDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/artifacts\/([^/]+)$/u.exec(url.pathname) : null;
      if (artifactDetailMatch !== null) {
        const artifact = await (await getRuntime()).dashboardArtifact(dashboardPathId(artifactDetailMatch[1] ?? ""), url.searchParams.get("revision") ?? undefined);
        if (artifact === undefined) {
          json(response, 404, { code: "DASHBOARD_ARTIFACT_NOT_FOUND", message: "Artifact not found" });
        } else {
          json(response, 200, artifact);
        }
        return;
      }
      const artifactHistoryMatch = request.method === "GET" ? /^\/workspace\/dashboard\/artifacts\/([^/]+)\/history$/u.exec(url.pathname) : null;
      if (artifactHistoryMatch !== null) {
        json(response, 200, await (await getRuntime()).dashboardArtifactHistory(dashboardPathId(artifactHistoryMatch[1] ?? ""), dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/facts") {
        json(response, 200, await (await getRuntime()).dashboardFacts(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/sources") {
        json(response, 200, await (await getRuntime()).dashboardSources(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/candidates") {
        json(response, 200, await (await getRuntime()).dashboardCandidates(dashboardQuery(url)));
        return;
      }
      const sourceDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/sources\/([^/]+)$/u.exec(url.pathname) : null;
      if (sourceDetailMatch !== null) {
        const source = await (await getRuntime()).dashboardSource(dashboardPathId(sourceDetailMatch[1] ?? ""));
        if (source === undefined) json(response, 404, { code: "DASHBOARD_SOURCE_NOT_FOUND", message: "Source not found" });
        else json(response, 200, source);
        return;
      }
      const candidateDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/candidates\/([^/]+)$/u.exec(url.pathname) : null;
      if (candidateDetailMatch !== null) {
        const candidate = await (await getRuntime()).dashboardCandidate(dashboardPathId(candidateDetailMatch[1] ?? ""));
        if (candidate === undefined) json(response, 404, { code: "DASHBOARD_CANDIDATE_NOT_FOUND", message: "Candidate not found" });
        else json(response, 200, candidate);
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/operations") {
        json(response, 200, await (await getRuntime()).dashboardOperations(dashboardQuery(url)));
        return;
      }
      const operationDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/operations\/([^/]+)$/u.exec(url.pathname) : null;
      if (operationDetailMatch !== null) {
        const operation = await (await getRuntime()).dashboardOperation(dashboardPathId(operationDetailMatch[1] ?? ""));
        if (operation === undefined) json(response, 404, { code: "DASHBOARD_OPERATION_NOT_FOUND", message: "Operation not found" });
        else json(response, 200, operation);
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/audit") {
        json(response, 200, await (await getRuntime()).dashboardAudit(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/issues") {
        json(response, 200, await (await getRuntime()).dashboardIssues(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/reviews") {
        json(response, 200, await (await getRuntime()).dashboardReviews(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/fact-review/runs") {
        json(response, 200, await (await getRuntime()).dashboardReviewRuns(dashboardQuery(url)));
        return;
      }
      const reviewRunDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/fact-review\/runs\/([^/]+)$/u.exec(url.pathname) : null;
      if (reviewRunDetailMatch !== null) {
        const run = await (await getRuntime()).dashboardReviewRun(dashboardPathId(reviewRunDetailMatch[1] ?? ""));
        if (run === undefined) json(response, 404, { code: "DASHBOARD_REVIEW_RUN_NOT_FOUND", message: "Fact review run not found" });
        else json(response, 200, run);
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/publishes") {
        json(response, 200, await (await getRuntime()).dashboardPublishes(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/builds") {
        json(response, 200, await (await getRuntime()).dashboardBuilds(dashboardQuery(url)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/preview") {
        const rawMode = url.searchParams.get("mode");
        const mode = rawMode === "zhuji" || rawMode === "palette" ? rawMode : undefined;
        json(response, 200, await (await getRuntime()).publishPreview(mode));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/tavern/compat") {
        json(response, 200, await (await getRuntime()).tavernCompat());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/build/preview") {
        json(response, 200, await (await getRuntime()).buildReadiness());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/repair/preview") {
        json(response, 200, await (await getRuntime()).repairPreview());
        return;
      }
      const imageMatch = request.method === "GET" ? /^\/workspace\/images\/([^/]+)$/u.exec(url.pathname) : null;
      if (imageMatch !== null) {
        const image = await (await getRuntime()).getProjectImage(imageMatch[1] ?? "");
        if (image === undefined) {
          json(response, 404, { error: "IMAGE_NOT_FOUND" });
          return;
        }
        response.setHeader("content-type", image.media_type);
        response.setHeader("cache-control", "no-store");
        response.end(Buffer.from(image.content.buffer, image.content.byteOffset, image.content.byteLength));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/health") {
        json(response, 200, { status: "ready", worker: worker.status() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/agents") {
        json(response, 200, visibleAgents(await getAgentAdapter()));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/zhuji/context") {
        json(response, 200, await (await getRuntime()).zhujiContext(url.searchParams.get("character_id") ?? undefined));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/template/context") {
        const kind = url.searchParams.get("kind");
        if (kind === null || !templateKindSchema.safeParse({ kind }).success) {
          json(response, 400, structuredError(new CoreError("TEMPLATE_KIND_REQUIRED", "TEMPLATE_KIND_REQUIRED", true)));
          return;
        }
        json(response, 200, await (await getRuntime()).templateContext(kind as Parameters<WorkspaceRuntime["templateContext"]>[0]));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/authoring/context") {
        json(response, 200, await (await getRuntime()).authoringKnowledgeContext());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/source/candidates") {
        json(response, 200, { candidates: await (await getRuntime()).sourceCandidates() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/interview/context") {
        if (options.projectManager !== undefined && !options.projectManager.sessionSelected()) {
          json(response, 200, { status: "idle", answers: [], selected: false });
        } else {
          json(response, 200, await (await getRuntime()).interviewContext());
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/projects") {
        if (options.projectManager === undefined) {
          json(response, 200, { projects: [] });
        } else {
          const manager = options.projectManager;
          const projects = await manager.listProjects();
          if (!manager.sessionSelected()) {
            json(response, 200, { projects });
          } else {
            const current = await manager.repository.read();
            const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
              ? projects.filter((project) => project.project_id !== current.project_id)
              : projects;
            json(response, 200, { projects: visible });
          }
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/new") {
        if (options.projectManager === undefined) {
          json(response, 400, structuredError(new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true)));
          return;
        }
        const runtime = await options.projectManager.startNewProject();
        json(response, 200, { selected: true, ...(await runtime.interviewContext()) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/request") {
        const parsed = await body(request);
        const input = parseRequest(requestSchema, parsed, "REQUEST_REQUIRED");
        const requestText = input.request;
        const requestedAgent = input.agent;
        const result = options.projectManager === undefined
          ? await (await getAgentAdapter()).request({ request: requestText, context: { actor, attachments: decodeAttachments(input.attachments) }, ...(requestedAgent === undefined ? {} : { agent: requestedAgent }) })
          : await options.projectManager.request(requestText, { actor, attachments: decodeAttachments(input.attachments) }, requestedAgent === undefined ? {} : { agent: requestedAgent });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/interview/answer") {
        const parsed = await body(request);
        const { answer } = parseRequest(answerSchema, parsed, "ANSWER_REQUIRED");
        const result = options.projectManager === undefined
          ? await (await getRuntime()).answerInterview(answer, { actor, attachments: [] })
          : await options.projectManager.answerInterview(answer, { actor, attachments: [] });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/source/select") {
        const parsed = await body(request);
        const { decisions } = parseRequest(sourceSelectionInputSchema, parsed, "SOURCE_SELECTION_REQUIRED");
        json(response, 200, await (await getRuntime()).selectSourceCandidates(decisions, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/adaptation/decision") {
        const parsed = await body(request);
        const decision = parseRequest(adaptationDecisionInputSchema, parsed, "ADAPTATION_DECISION_REQUIRED");
        json(response, 200, await (await getRuntime()).createAdaptationDecision(compact(decision) as Omit<AdaptationDecision, "id" | "created_at" | "created_by">, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/select") {
        const parsed = await body(request);
        const { project } = parseRequest(projectSchema, parsed, "PROJECT_REQUIRED");
        if (options.projectManager === undefined) {
          json(response, 400, structuredError(new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true)));
          return;
        }
        json(response, 200, await options.projectManager.select(project));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/zhuji") {
        const parsed = await body(request);
        const result = await (await getRuntime()).submitZhujiProposal(parsed, { actor, attachments: [] });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/template") {
        const parsed = await body(request);
        const result = await (await getRuntime()).submitTemplateProposal(parsed, { actor, attachments: [] });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/images") {
        const parsed = await body(request);
        const input = parseRequest(imageInputSchema, parsed, "IMAGE_INPUT_REQUIRED");
        const attachments = decodeAttachments(input.attachments);
        const options: { character_id?: string; aspect_ratio?: string; source?: string; license?: string } = {};
        if (input.character_id !== undefined) options.character_id = input.character_id;
        if (input.aspect_ratio !== undefined) options.aspect_ratio = input.aspect_ratio;
        if (input.source !== undefined) options.source = input.source;
        if (input.license !== undefined) options.license = input.license;
        json(response, 200, await (await getRuntime()).setProjectImage({ actor, attachments }, options));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/images/remove") {
        const parsed = await body(request);
        const { image_id } = parseRequest(imageRemoveInputSchema, parsed, "IMAGE_ID_REQUIRED");
        const removed = await (await getRuntime()).removeProjectImage(image_id, actor);
        json(response, 200, { status: removed ? "removed" : "not_found", image_id });
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/issue") {
        const parsed = await body(request);
        const input = parseRequest(issueUpdateInputSchema, parsed, "ISSUE_UPDATE_REQUIRED");
        const { agent, ...issue } = input;
        json(response, 200, await (await getRuntime()).updateIssue(compact(issue) as IssueUpdateInput, { actor, attachments: [] }, agent === undefined ? {} : { agent }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/quality/profile") {
        const parsed = await body(request);
        const input = parseRequest(qualityProfileInputSchema, parsed, "QUALITY_LEVEL_REQUIRED");
        json(response, 200, await (await getRuntime()).configureQualityProfile(input.level, { actor, attachments: [] }, input.overrides ?? {}));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/run") {
        const runtime = await getRuntime();
        json(response, 200, await runtime.startFactReviewRun(actor));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/knowledge/reextract") {
        const parsed = await body(request);
        const input = parseRequest(reextractInputSchema, parsed, "SOURCE_IDS_REQUIRED");
        const runtime = await getRuntime();
        json(response, 200, await runtime.reextract(internalId("operation"), input.source_ids, actor, input.extractor_revision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/batch") {
        const parsed = await body(request);
        const input = parseRequest(factReviewBatchInputSchema, parsed, "FACT_DECISIONS_REQUIRED");
        json(response, 200, await (await getRuntime()).applyFactReviewBatch(input.decisions, actor, input.reviewer_identity, input.run_id, input.expected_projection_revision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/conflict") {
        const parsed = await body(request);
        const input = parseRequest(factReviewBatchInputSchema, parsed, "FACT_DECISIONS_REQUIRED");
        json(response, 200, await (await getRuntime()).resolveFactConflict(input.decisions, actor, input.run_id, input.expected_projection_revision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/recover") {
        const parsed = await body(request);
        const { operation_id } = parseRequest(operationIdSchema, parsed, "OPERATION_ID_REQUIRED");
        json(response, 200, await (await getRuntime()).recoverOperation(operation_id, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/fail") {
        const parsed = await body(request);
        const { operation_id } = parseRequest(operationIdSchema, parsed, "OPERATION_ID_REQUIRED");
        try {
          json(response, 200, await (await getRuntime()).cancelOperation(operation_id, actor));
        } catch (error) {
          if (error instanceof CoreError) {
            json(response, 400, structuredError(error));
            return;
          }
          throw error;
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/repair/run") {
        const parsed = await body(request) as { plan_hash?: unknown } | undefined;
        json(response, 200, await (await getRuntime()).repairRun(typeof parsed?.plan_hash === "string" ? parsed.plan_hash : undefined));
        return;
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const parsed = await body(request) as { id?: unknown; method?: unknown; params?: unknown };
        const id = parsed.id ?? null;
        if (parsed.method === "initialize") {
          json(response, 200, { jsonrpc: "2.0", id, result: { protocolVersion: mcpProtocolVersion(parsed.params), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "st-workspace-v3", version: "0.1.0" } } });
          return;
        }
        if (parsed.method === "tools/list") {
          json(response, 200, { jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
          return;
        }
        if (parsed.method === "tools/call") {
          const params = parsed.params as { name?: unknown; arguments?: unknown } | undefined;
          if (params?.name === "workspace_agents") {
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(visibleAgents(await getAgentAdapter())) }] } });
            return;
          }
          if (params?.name === "workspace_zhuji_context") {
            const input = params.arguments === undefined || typeof params.arguments !== "object" ? undefined : parseRequest(characterIdSchema, params.arguments, "CHARACTER_ID_REQUIRED");
            const context = await (await getRuntime()).zhujiContext(input?.character_id);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_zhuji_submit") {
            const result = await (await getRuntime()).submitZhujiProposal(params.arguments, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_template_context") {
            let kind: string | undefined;
            try {
              kind = parseRequest(templateKindSchema, params.arguments, "TEMPLATE_KIND_REQUIRED").kind;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "kind is required" } });
              return;
            }
            const context = await (await getRuntime()).templateContext(kind as Parameters<WorkspaceRuntime["templateContext"]>[0]);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_template_submit") {
            const result = await (await getRuntime()).submitTemplateProposal(params.arguments, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_issue_update") {
            let input: z.infer<typeof issueUpdateInputSchema>;
            try {
              input = parseRequest(issueUpdateInputSchema, params.arguments, "ISSUE_UPDATE_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "issue_id, action and reason are required" } });
              return;
            }
            const { agent, ...issue } = input;
            const result = await (await getRuntime()).updateIssue(compact(issue) as IssueUpdateInput, { actor, attachments: [] }, agent === undefined ? {} : { agent });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_authoring_context") {
            const context = await (await getRuntime()).authoringKnowledgeContext();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_source_candidates") {
            const candidates = await (await getRuntime()).sourceCandidates();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ candidates }) }] } });
            return;
          }
          if (params?.name === "workspace_source_select") {
            let decisions: z.infer<typeof sourceSelectionInputSchema>["decisions"];
            try {
              decisions = parseRequest(sourceSelectionInputSchema, params.arguments, "SOURCE_SELECTION_REQUIRED").decisions;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "decisions are required" } });
              return;
            }
            const result = await (await getRuntime()).selectSourceCandidates(decisions, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_adaptation_decision") {
            let decision: z.infer<typeof adaptationDecisionInputSchema>;
            try {
              decision = parseRequest(adaptationDecisionInputSchema, params.arguments, "ADAPTATION_DECISION_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "topic, choice and rationale are required" } });
              return;
            }
            const result = await (await getRuntime()).createAdaptationDecision(compact(decision) as Omit<AdaptationDecision, "id" | "created_at" | "created_by">, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_status") {
            const statusValue = options.projectManager === undefined
              ? await options.runtime!.status()
              : options.projectManager.sessionSelected()
                ? await options.projectManager.status()
                : { ok: true, selected: false, projects: await options.projectManager.listProjects() };
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(statusValue) }] } });
            return;
          }
          if (params?.name === "workspace_interview_context") {
            const context = options.projectManager !== undefined && !options.projectManager.sessionSelected()
              ? { status: "idle", answers: [], selected: false }
              : await (await getRuntime()).interviewContext();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_interview_answer") {
            let answer: string;
            try {
              answer = parseRequest(answerSchema, params.arguments, "ANSWER_REQUIRED").answer;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "answer is required" } });
              return;
            }
            const result = options.projectManager === undefined
              ? await (await getRuntime()).answerInterview(answer, { actor, attachments: [] })
              : await options.projectManager.answerInterview(answer, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_projects") {
            if (options.projectManager === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects: [] }) }] } });
            } else {
              const manager = options.projectManager;
              const projects = await manager.listProjects();
              if (!manager.sessionSelected()) {
                json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects }) }] } });
                return;
              }
              const current = await manager.repository.read();
              const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
                ? projects.filter((project) => project.project_id !== current.project_id)
                : projects;
              json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects: visible }) }] } });
            }
            return;
          }
          if (params?.name === "workspace_project_select") {
            let project: string | undefined;
            try {
              project = parseRequest(projectSchema, params.arguments, "PROJECT_REQUIRED").project;
            } catch {
              project = undefined;
            }
            if (project === undefined || options.projectManager === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: project === undefined ? "project is required" : "project manager is required" } });
              return;
            }
            const selected = await options.projectManager.select(project);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(selected) }] } });
            return;
          }
          if (params?.name === "workspace_request") {
            let input: z.infer<typeof requestSchema>;
            try {
              input = parseRequest(requestSchema, params.arguments, "REQUEST_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "request is required" } });
              return;
            }
            const result: RequestResult = options.projectManager === undefined
              ? await (await getAgentAdapter()).request({ request: input.request, context: { actor, attachments: decodeAttachments(input.attachments) }, ...(input.agent === undefined ? {} : { agent: input.agent }) })
              : await options.projectManager.request(input.request, { actor, attachments: decodeAttachments(input.attachments) }, input.agent === undefined ? {} : { agent: input.agent });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          json(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "tool not found" } });
          return;
        }
        json(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
        return;
      }
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
