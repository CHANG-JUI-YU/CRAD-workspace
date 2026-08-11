import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import { HttpSourceFetcher } from "@st-workspace/adapters";
import { CoreError, FileAttachmentStore, FileProjectRepository, templateProposalJsonSchema, type AdaptationDecision, type IssueSeverity, type RequestResult, type SourceAttachment, zhujiProposalJsonSchema } from "@st-workspace/core";
import { AgentAdapter, AgentRouter, WorkspaceProjectManager, WorkspaceRuntime, WorkspaceWorker, type WorkspaceWorkerOptions } from "@st-workspace/runtime";
import { dashboard } from "./dashboard.js";

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

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/u;

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

function attachmentsFrom(value: unknown): SourceAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SourceAttachment[] => {
    if (item === null || typeof item !== "object") return [];
    const candidate = item as { name?: unknown; content_base64?: unknown; media_type?: unknown };
    if (typeof candidate.name !== "string" || typeof candidate.content_base64 !== "string") return [];
    if (!base64Pattern.test(candidate.content_base64)) return [];
    const decoded = Buffer.from(candidate.content_base64, "base64");
    if (decoded.byteLength === 0) return [];
    return [{ name: candidate.name, content: new Uint8Array(decoded), ...(typeof candidate.media_type === "string" ? { media_type: candidate.media_type } : {}) }];
  });
}

function requestValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const request = (value as { request?: unknown }).request;
  return typeof request === "string" && request.trim().length > 0 ? request : undefined;
}

function agentValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const agent = (value as { agent?: unknown }).agent;
  return typeof agent === "string" && agent.trim().length > 0 ? agent : undefined;
}

function operationIdValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const operationId = (value as { operation_id?: unknown }).operation_id;
  return typeof operationId === "string" && operationId.trim().length > 0 ? operationId : undefined;
}

function qualityLevelValue(value: unknown): "none" | "light" | "normal" | "strict" | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const level = (value as { level?: unknown }).level;
  return level === "none" || level === "light" || level === "normal" || level === "strict" ? level : undefined;
}

function characterIdValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const characterId = (value as { character_id?: unknown }).character_id;
  return typeof characterId === "string" && characterId.trim().length > 0 ? characterId : undefined;
}

const templateKinds = new Set(["character", "zhuji", "palette", "wardrobe", "greetings", "relationships", "world", "conversion", "import_analysis", "review", "source_research", "fact_curation", "fact_review", "plugin", "director_routing"]);

function templateKindValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && templateKinds.has(kind) ? kind : undefined;
}

function answerValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const answer = (value as { answer?: unknown }).answer;
  return typeof answer === "string" ? answer : undefined;
}

function projectValue(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const project = (value as { project?: unknown }).project;
  return typeof project === "string" && project.trim().length > 0 ? project : undefined;
}

function sourceSelectionValue(value: unknown): Array<{ candidate_id: string; decision: "approve" | "reject" }> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const decisions = (value as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions) || decisions.length === 0) return undefined;
  const parsed = decisions.flatMap((item): Array<{ candidate_id: string; decision: "approve" | "reject" }> => {
    if (item === null || typeof item !== "object") return [];
    const candidate = item as { candidate_id?: unknown; decision?: unknown };
    if (typeof candidate.candidate_id !== "string" || (candidate.decision !== "approve" && candidate.decision !== "reject")) return [];
    return [{ candidate_id: candidate.candidate_id, decision: candidate.decision }];
  });
  return parsed.length === decisions.length ? parsed : undefined;
}

function issueUpdateValue(value: unknown): { issue_id: string; action: "resolve" | "ignore" | "override"; reason: string; severity?: "critical" | "error" | "warning" | "info"; agent?: string } | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const input = value as { issue_id?: unknown; action?: unknown; reason?: unknown; severity?: unknown; agent?: unknown };
  if (typeof input.issue_id !== "string" || typeof input.reason !== "string") return undefined;
  if (input.action !== "resolve" && input.action !== "ignore" && input.action !== "override") return undefined;
  if (input.severity !== undefined && input.severity !== "critical" && input.severity !== "error" && input.severity !== "warning" && input.severity !== "info") return undefined;
  if (input.agent !== undefined && typeof input.agent !== "string") return undefined;
  return {
    issue_id: input.issue_id,
    action: input.action,
    reason: input.reason,
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
  };
}

function adaptationDecisionValue(value: unknown): Omit<AdaptationDecision, "id" | "created_at" | "created_by"> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const input = value as { topic?: unknown; choice?: unknown; blueprint_refs?: unknown; fact_refs?: unknown; rationale?: unknown };
  if (typeof input.topic !== "string" || typeof input.rationale !== "string" || !["keep_blueprint", "adopt_fact", "blend", "defer"].includes(String(input.choice))) return undefined;
  const strings = (items: unknown): string[] | undefined => {
    if (items === undefined) return undefined;
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) return undefined;
    return items as string[];
  };
  const blueprintRefs = strings(input.blueprint_refs);
  const factRefs = strings(input.fact_refs);
  if (input.blueprint_refs !== undefined && blueprintRefs === undefined) return undefined;
  if (input.fact_refs !== undefined && factRefs === undefined) return undefined;
  return {
    topic: input.topic,
    choice: input.choice as AdaptationDecision["choice"],
    ...(blueprintRefs === undefined ? {} : { blueprint_refs: blueprintRefs }),
    ...(factRefs === undefined ? {} : { fact_refs: factRefs }),
    rationale: input.rationale,
  };
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
    : () => options.projectManager!.ensureRuntime();
  if (runtimeForWorker === undefined) throw new Error("workspace server could not initialize a runtime");
  const worker = options.worker ?? new WorkspaceWorker(runtimeForWorker, { actor: `${actor}-worker`, ...options.workerOptions });
  const getRuntime = async (): Promise<WorkspaceRuntime> => options.projectManager === undefined ? options.runtime! : options.projectManager.ensureRuntime();
  const getAgentAdapter = async (): Promise<AgentAdapter> => new AgentAdapter(await getRuntime(), router);
  if (options.autoStartWorker ?? true) worker.start();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (options.authToken !== undefined && request.headers.authorization !== `Bearer ${options.authToken}`) {
        json(response, 401, { error: "UNAUTHORIZED" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.statusCode = 200;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(dashboard());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/status") {
        json(response, 200, options.projectManager === undefined ? await options.runtime!.status() : await options.projectManager.status());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/data") {
        json(response, 200, await (await getRuntime()).dashboardSnapshot());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/preview") {
        json(response, 200, await (await getRuntime()).publishPreview());
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
        if (kind === null || !templateKinds.has(kind)) {
          json(response, 400, { error: "TEMPLATE_KIND_REQUIRED" });
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
        json(response, 200, await (await getRuntime()).interviewContext());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspace/projects") {
        if (options.projectManager === undefined) {
          json(response, 200, { projects: [] });
        } else {
          const manager = options.projectManager;
          await manager.ensureRuntime();
          const projects = await manager.listProjects();
          const current = await manager.repository.read();
          const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
            ? projects.filter((project) => project.project_id !== current.project_id)
            : projects;
          json(response, 200, { projects: visible });
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/request") {
        const parsed = await body(request);
        const requestText = requestValue(parsed);
        if (requestText === undefined) {
          json(response, 400, { error: "REQUEST_REQUIRED" });
          return;
        }
        const input = parsed as { attachments?: unknown };
        const requestedAgent = agentValue(parsed);
        const result = options.projectManager === undefined
          ? await (await getAgentAdapter()).request({ request: requestText, context: { actor, attachments: attachmentsFrom(input.attachments) }, ...(requestedAgent === undefined ? {} : { agent: requestedAgent }) })
          : await options.projectManager.request(requestText, { actor, attachments: attachmentsFrom(input.attachments) }, requestedAgent === undefined ? {} : { agent: requestedAgent });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/interview/answer") {
        const parsed = await body(request);
        const answer = answerValue(parsed);
        if (answer === undefined) {
          json(response, 400, { error: "ANSWER_REQUIRED" });
          return;
        }
        const result = options.projectManager === undefined
          ? await (await getRuntime()).answerInterview(answer, { actor, attachments: [] })
          : await options.projectManager.answerInterview(answer, { actor, attachments: [] });
        json(response, 200, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/source/select") {
        const parsed = await body(request);
        const decisions = sourceSelectionValue(parsed);
        if (decisions === undefined) {
          json(response, 400, { error: "SOURCE_SELECTION_REQUIRED" });
          return;
        }
        json(response, 200, await (await getRuntime()).selectSourceCandidates(decisions, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/adaptation/decision") {
        const parsed = await body(request);
        const decision = adaptationDecisionValue(parsed);
        if (decision === undefined) {
          json(response, 400, { error: "ADAPTATION_DECISION_REQUIRED" });
          return;
        }
        json(response, 200, await (await getRuntime()).createAdaptationDecision(decision, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/select") {
        const parsed = await body(request);
        const project = projectValue(parsed);
        if (project === undefined || options.projectManager === undefined) {
          json(response, 400, { error: project === undefined ? "PROJECT_REQUIRED" : "PROJECT_MANAGER_REQUIRED" });
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
        const input = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        const attachments = attachmentsFrom(input.attachments);
        const options: { character_id?: string; aspect_ratio?: string; source?: string; license?: string } = {};
        if (typeof input.character_id === "string") options.character_id = input.character_id;
        if (typeof input.aspect_ratio === "string") options.aspect_ratio = input.aspect_ratio;
        if (typeof input.source === "string") options.source = input.source;
        if (typeof input.license === "string") options.license = input.license;
        json(response, 200, await (await getRuntime()).setProjectImage({ actor, attachments }, options));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/images/remove") {
        const parsed = await body(request);
        const input = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        const imageId = typeof input.image_id === "string" && input.image_id.trim().length > 0 ? input.image_id : undefined;
        if (imageId === undefined) {
          json(response, 400, { error: "IMAGE_ID_REQUIRED" });
          return;
        }
        const removed = await (await getRuntime()).removeProjectImage(imageId);
        json(response, 200, { status: removed ? "removed" : "not_found", image_id: imageId });
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/issue") {
        const parsed = await body(request);
        const input = issueUpdateValue(parsed);
        if (input === undefined) {
          json(response, 400, { error: "ISSUE_UPDATE_REQUIRED" });
          return;
        }
        const { agent, ...issue } = input;
        json(response, 200, await (await getRuntime()).updateIssue(issue, { actor, attachments: [] }, agent === undefined ? {} : { agent }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/quality/profile") {
        const parsed = await body(request);
        const level = qualityLevelValue(parsed);
        if (level === undefined) {
          json(response, 400, { error: "QUALITY_LEVEL_REQUIRED" });
          return;
        }
        const overrides: Record<string, IssueSeverity> = {};
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "overrides" in parsed && parsed.overrides !== null && typeof parsed.overrides === "object" && !Array.isArray(parsed.overrides)) {
          for (const [key, value] of Object.entries(parsed.overrides as Record<string, unknown>)) {
            if (value === "critical" || value === "error" || value === "warning" || value === "info") overrides[key] = value;
          }
        }
        json(response, 200, await (await getRuntime()).configureQualityProfile(level, { actor, attachments: [] }, overrides));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/recover") {
        const parsed = await body(request);
        const operationId = operationIdValue(parsed);
        if (operationId === undefined) {
          json(response, 400, { error: "OPERATION_ID_REQUIRED" });
          return;
        }
        json(response, 200, await (await getRuntime()).recoverOperation(operationId, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/fail") {
        const parsed = await body(request);
        const operationId = operationIdValue(parsed);
        if (operationId === undefined) {
          json(response, 400, { error: "OPERATION_ID_REQUIRED" });
          return;
        }
        await (await getRuntime()).failOperation(operationId, new CoreError("OPERATION_CANCELLED", "The operation was cancelled from the workspace console", true), actor);
        json(response, 200, { status: "cancelled", operation_id: operationId });
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/repair/run") {
        json(response, 200, await (await getRuntime()).repairRun());
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
            const argumentsValue = params.arguments;
            const context = await (await getRuntime()).zhujiContext(characterIdValue(argumentsValue));
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_zhuji_submit") {
            const result = await (await getRuntime()).submitZhujiProposal(params.arguments, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_template_context") {
            const kind = templateKindValue(params.arguments);
            if (kind === undefined) {
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
            const input = issueUpdateValue(params.arguments);
            if (input === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "issue_id, action and reason are required" } });
              return;
            }
            const { agent, ...issue } = input;
            const result = await (await getRuntime()).updateIssue(issue, { actor, attachments: [] }, agent === undefined ? {} : { agent });
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
            const decisions = sourceSelectionValue(params.arguments);
            if (decisions === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "decisions are required" } });
              return;
            }
            const result = await (await getRuntime()).selectSourceCandidates(decisions, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_adaptation_decision") {
            const decision = adaptationDecisionValue(params.arguments);
            if (decision === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "topic, choice and rationale are required" } });
              return;
            }
            const result = await (await getRuntime()).createAdaptationDecision(decision, { actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return;
          }
          if (params?.name === "workspace_status") {
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(options.projectManager === undefined ? await options.runtime!.status() : await options.projectManager.status()) }] } });
            return;
          }
          if (params?.name === "workspace_interview_context") {
            const context = await (await getRuntime()).interviewContext();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return;
          }
          if (params?.name === "workspace_interview_answer") {
            const answer = answerValue(params.arguments);
            if (answer === undefined) {
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
              await manager.ensureRuntime();
              const projects = await manager.listProjects();
              const current = await manager.repository.read();
              const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
                ? projects.filter((project) => project.project_id !== current.project_id)
                : projects;
              json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects: visible }) }] } });
            }
            return;
          }
          if (params?.name === "workspace_project_select") {
            const project = projectValue(params.arguments);
            if (project === undefined || options.projectManager === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: project === undefined ? "project is required" : "project manager is required" } });
              return;
            }
            const selected = await options.projectManager.select(project);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(selected) }] } });
            return;
          }
          if (params?.name === "workspace_request") {
            const requestText = requestValue(params.arguments);
            if (requestText === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "request is required" } });
              return;
            }
            const requestedAgent = agentValue(params.arguments);
            const result: RequestResult = options.projectManager === undefined
              ? await (await getAgentAdapter()).request({ request: requestText, context: { actor, attachments: attachmentsFrom(params.arguments) }, ...(requestedAgent === undefined ? {} : { agent: requestedAgent }) })
              : await options.projectManager.request(requestText, { actor, attachments: attachmentsFrom(params.arguments) }, requestedAgent === undefined ? {} : { agent: requestedAgent });
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
      const errorCode = error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "";
      const recoverableInput = error !== null && typeof error === "object" && "recoverable" in error && (error as { recoverable?: unknown }).recoverable === true && /^(?:AGENT_|INTERVIEW_|PROJECT_|REQUEST_|ISSUE_|TEMPLATE_|ZHUJI_)/u.test(errorCode);
      const details = error !== null && typeof error === "object" && "details" in error ? (error as { details?: unknown }).details : undefined;
      if (new URL(request.url ?? "/", "http://localhost").pathname === "/mcp") {
        json(response, 200, { jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
        return;
      }
      json(response, recoverableInput ? 400 : 500, { error: error instanceof Error ? error.message : String(error), ...(errorCode === "" ? {} : { code: errorCode }), ...(details === undefined ? {} : { details }) });
    }
  });
  server.once("close", () => worker.stop());
  return Object.assign(server, { workspaceWorker: worker });
}

export async function startWorkspaceServer(options: { port?: number; host?: string; projectRoot?: string; projectId?: string; actor?: string; authToken?: string } = {}): Promise<Server> {
  const projectRoot = options.projectRoot ?? process.env.ST_WORKSPACE_PROJECT_ROOT ?? "projects";
  const fetcher = new HttpSourceFetcher();
  // An explicitly supplied root is already a complete workspace selection;
  // do not let an inherited project environment variable silently redirect it.
  // Environment-based project selection remains available for the default root
  // and for callers that pass projectId explicitly.
  const requestedProject = options.projectId ?? (options.projectRoot === undefined ? process.env.ST_WORKSPACE_PROJECT : undefined);
  const selectedProject = typeof requestedProject === "string" && requestedProject.trim().length > 0 ? requestedProject.trim() : undefined;
  const manager = selectedProject === undefined
    ? new WorkspaceProjectManager({ root: projectRoot, createRuntime: (repository) => new WorkspaceRuntime(repository, { fetcher: fetcher.fetch, interviewRequired: true, attachmentStore: new FileAttachmentStore(projectRoot, repository.projectId) }) })
    : undefined;
  if (manager !== undefined) await manager.ensureRuntime();
  const serverOptions: WorkspaceServerOptions = manager !== undefined
    ? { projectManager: manager, actor: options.actor ?? "server", ...(options.authToken === undefined ? {} : { authToken: options.authToken }) }
    : { runtime: new WorkspaceRuntime(new FileProjectRepository(projectRoot, selectedProject!, { layout: "project", materialize: true }), { fetcher: fetcher.fetch, attachmentStore: new FileAttachmentStore(projectRoot, selectedProject!) }), actor: options.actor ?? "server", ...(options.authToken === undefined ? {} : { authToken: options.authToken }) };
  const server = createWorkspaceServer(serverOptions);
  await new Promise<void>((resolve) => server.listen(options.port ?? Number(process.env.ST_WORKSPACE_PORT ?? 8787), options.host ?? "127.0.0.1", resolve));
  return server;
}

/* c8 ignore next 3 -- the server entrypoint is exercised through startWorkspaceServer tests. */
if (process.argv[1]?.endsWith("/server/dist/index.js") || process.argv[1]?.endsWith("\\server\\dist\\index.js")) {
  await startWorkspaceServer();
  console.log(`ST Workspace server listening on http://127.0.0.1:${process.env.ST_WORKSPACE_PORT ?? "8787"}`);
}
