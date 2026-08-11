import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TextDecoder } from "node:util";
import { HttpSourceFetcher } from "@st-workspace/adapters";
import { CoreError, FileAttachmentStore, FileProjectRepository, internalId, templateProposalJsonSchema, type AdaptationDecision, type IssueSeverity, type RequestResult, type SourceAttachment, zhujiProposalJsonSchema } from "@st-workspace/core";
import { AgentAdapter, AgentRouter, WorkspaceProjectManager, WorkspaceRuntime, WorkspaceWorker, type WorkspaceWorkerOptions } from "@st-workspace/runtime";
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

function factDecisionsValue(value: unknown): Array<{ fact_id?: string; candidate_occurrence_id?: string; claim: string; decision: "accept" | "reject" | "conflict" | "needs_evidence"; reason: string; evidence: { source: string; quote?: string; locator?: string }[]; evidence_refs: { source_id: string; source_revision_id: string; quote: string; locator?: string; character_range?: { start: number; end: number } }[]; coverage: string[] }> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const decisions: Array<{ fact_id?: string; candidate_occurrence_id?: string; claim: string; decision: "accept" | "reject" | "conflict" | "needs_evidence"; reason: string; evidence: { source: string; quote?: string; locator?: string }[]; evidence_refs: { source_id: string; source_revision_id: string; quote: string; locator?: string; character_range?: { start: number; end: number } }[]; coverage: string[] }> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return undefined;
    const input = item as { fact_id?: unknown; candidate_occurrence_id?: unknown; claim?: unknown; decision?: unknown; reason?: unknown; evidence?: unknown; evidence_refs?: unknown; coverage?: unknown };
    if (typeof input.claim !== "string" || typeof input.reason !== "string") return undefined;
    if (input.decision !== "accept" && input.decision !== "reject" && input.decision !== "conflict" && input.decision !== "needs_evidence") return undefined;
    if (input.fact_id !== undefined && typeof input.fact_id !== "string") return undefined;
    if (input.candidate_occurrence_id !== undefined && typeof input.candidate_occurrence_id !== "string") return undefined;
    if (input.fact_id === undefined && input.candidate_occurrence_id === undefined) return undefined;

    const evidence: Array<{ source: string; quote?: string; locator?: string }> = [];
    if (Array.isArray(input.evidence)) {
      for (const e of input.evidence) {
        if (e && typeof e === "object" && typeof (e as Record<string, unknown>).source === "string") {
          const evObj = e as Record<string, unknown>;
          evidence.push({
            source: evObj.source as string,
            ...(typeof evObj.quote === "string" ? { quote: evObj.quote } : {}),
            ...(typeof evObj.locator === "string" ? { locator: evObj.locator } : {}),
          });
        }
      }
    }

    const evidenceRefs: Array<{ source_id: string; source_revision_id: string; quote: string; locator?: string; character_range?: { start: number; end: number } }> = [];
    if (Array.isArray(input.evidence_refs)) {
      for (const er of input.evidence_refs) {
        if (er && typeof er === "object" && typeof (er as Record<string, unknown>).source_id === "string" && typeof (er as Record<string, unknown>).source_revision_id === "string" && typeof (er as Record<string, unknown>).quote === "string") {
          const erObj = er as Record<string, unknown>;
          evidenceRefs.push({
            source_id: erObj.source_id as string,
            source_revision_id: erObj.source_revision_id as string,
            quote: erObj.quote as string,
            ...(typeof erObj.locator === "string" ? { locator: erObj.locator } : {}),
          });
        }
      }
    }

    const coverage: string[] = [];
    if (Array.isArray(input.coverage)) {
      for (const c of input.coverage) {
        if (typeof c === "string") coverage.push(c);
      }
    }

    decisions.push({
      claim: input.claim,
      decision: input.decision,
      reason: input.reason,
      evidence,
      evidence_refs: evidenceRefs,
      coverage,
      ...(input.fact_id === undefined ? {} : { fact_id: input.fact_id }),
      ...(input.candidate_occurrence_id === undefined ? {} : { candidate_occurrence_id: input.candidate_occurrence_id }),
    });
  }
  return decisions;
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
          json(response, 200, await (await getRuntime()).dashboardSnapshot());
        }
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
        if (kind === null || !templateKinds.has(kind)) {
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
        const requestText = requestValue(parsed);
        if (requestText === undefined) {
          json(response, 400, structuredError(new CoreError("REQUEST_REQUIRED", "The request field is required", true)));
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
          json(response, 400, structuredError(new CoreError("ANSWER_REQUIRED", "ANSWER_REQUIRED", true)));
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
          json(response, 400, structuredError(new CoreError("SOURCE_SELECTION_REQUIRED", "SOURCE_SELECTION_REQUIRED", true)));
          return;
        }
        json(response, 200, await (await getRuntime()).selectSourceCandidates(decisions, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/adaptation/decision") {
        const parsed = await body(request);
        const decision = adaptationDecisionValue(parsed);
        if (decision === undefined) {
          json(response, 400, structuredError(new CoreError("ADAPTATION_DECISION_REQUIRED", "ADAPTATION_DECISION_REQUIRED", true)));
          return;
        }
        json(response, 200, await (await getRuntime()).createAdaptationDecision(decision, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/select") {
        const parsed = await body(request);
        const project = projectValue(parsed);
        if (project === undefined || options.projectManager === undefined) {
          json(response, 400, structuredError(new CoreError(project === undefined ? "PROJECT_REQUIRED" : "PROJECT_MANAGER_REQUIRED", project === undefined ? "PROJECT_REQUIRED" : "PROJECT_MANAGER_REQUIRED", true)));
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
          json(response, 400, structuredError(new CoreError("IMAGE_ID_REQUIRED", "IMAGE_ID_REQUIRED", true)));
          return;
        }
        const removed = await (await getRuntime()).removeProjectImage(imageId, actor);
        json(response, 200, { status: removed ? "removed" : "not_found", image_id: imageId });
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/issue") {
        const parsed = await body(request);
        const input = issueUpdateValue(parsed);
        if (input === undefined) {
          json(response, 400, structuredError(new CoreError("ISSUE_UPDATE_REQUIRED", "ISSUE_UPDATE_REQUIRED", true)));
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
          json(response, 400, structuredError(new CoreError("QUALITY_LEVEL_REQUIRED", "QUALITY_LEVEL_REQUIRED", true)));
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
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/run") {
        const runtime = await getRuntime();
        json(response, 200, await runtime.startFactReviewRun(actor));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/knowledge/reextract") {
        const parsed = await body(request);
        const input = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as { source_ids?: unknown; extractor_revision?: unknown } : undefined;
        const sourceIds = input !== undefined && Array.isArray(input.source_ids)
          ? input.source_ids.filter((item): item is string => typeof item === "string")
          : undefined;
        if (sourceIds === undefined || sourceIds.length === 0) {
          json(response, 400, structuredError(new CoreError("SOURCE_IDS_REQUIRED", "SOURCE_IDS_REQUIRED", true)));
          return;
        }
        const extractorRevision = input !== undefined && typeof input.extractor_revision === "string" && input.extractor_revision.length > 0 ? input.extractor_revision : undefined;
        const runtime = await getRuntime();
        json(response, 200, await runtime.reextract(internalId("operation"), sourceIds, actor, extractorRevision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/batch") {
        const parsed = await body(request);
        const decisions = factDecisionsValue(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "decisions" in parsed ? parsed.decisions : undefined);
        if (decisions === undefined) {
          json(response, 400, structuredError(new CoreError("FACT_DECISIONS_REQUIRED", "FACT_DECISIONS_REQUIRED", true)));
          return;
        }
        const input = parsed as { reviewer_identity?: unknown; run_id?: unknown; expected_projection_revision?: unknown };
        const reviewerIdentity = typeof input.reviewer_identity === "string" && input.reviewer_identity.length > 0 ? input.reviewer_identity : undefined;
        const runId = typeof input.run_id === "string" && input.run_id.length > 0 ? input.run_id : undefined;
        const expectedProjectionRevision = typeof input.expected_projection_revision === "string" && input.expected_projection_revision.length > 0 ? input.expected_projection_revision : undefined;
        json(response, 200, await (await getRuntime()).applyFactReviewBatch(decisions, actor, reviewerIdentity, runId, expectedProjectionRevision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/conflict") {
        const parsed = await body(request);
        const decisions = factDecisionsValue(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "decisions" in parsed ? parsed.decisions : undefined);
        if (decisions === undefined) {
          json(response, 400, structuredError(new CoreError("FACT_DECISIONS_REQUIRED", "FACT_DECISIONS_REQUIRED", true)));
          return;
        }
        const input = parsed as { run_id?: unknown; expected_projection_revision?: unknown };
        const runId = typeof input.run_id === "string" && input.run_id.length > 0 ? input.run_id : undefined;
        const expectedProjectionRevision = typeof input.expected_projection_revision === "string" && input.expected_projection_revision.length > 0 ? input.expected_projection_revision : undefined;
        json(response, 200, await (await getRuntime()).resolveFactConflict(decisions, actor, runId, expectedProjectionRevision));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/recover") {
        const parsed = await body(request);
        const operationId = operationIdValue(parsed);
        if (operationId === undefined) {
          json(response, 400, structuredError(new CoreError("OPERATION_ID_REQUIRED", "OPERATION_ID_REQUIRED", true)));
          return;
        }
        json(response, 200, await (await getRuntime()).recoverOperation(operationId, { actor, attachments: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/fail") {
        const parsed = await body(request);
        const operationId = operationIdValue(parsed);
        if (operationId === undefined) {
          json(response, 400, structuredError(new CoreError("OPERATION_ID_REQUIRED", "OPERATION_ID_REQUIRED", true)));
          return;
        }
        try {
          json(response, 200, await (await getRuntime()).cancelOperation(operationId, actor));
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
