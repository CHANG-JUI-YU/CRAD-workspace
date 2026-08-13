import type { IncomingMessage, ServerResponse } from "node:http";
import { CoreError, internalId, z, type AdaptationDecision, type RequestResult } from "@st-workspace/core";
import { adaptationDecisionInputSchema, answerSchema, characterIdSchema, decodeAttachments, factReviewBatchInputSchema, imageInputSchema, imageRemoveInputSchema, issueUpdateInputSchema, operationIdSchema, projectSchema, qualityLevelSchema, qualityProfileInputSchema, reextractInputSchema, requestSchema, sourceSelectionInputSchema, templateKindSchema, type IssueUpdateInput } from "@st-workspace/domain";
import { type AgentAdapter, type WorkspaceProjectManager, type WorkspaceRuntime, type WorkspaceWorker } from "@st-workspace/runtime";
import { structuredError } from "./errors.js";
import { body, compact, dashboardPathId, dashboardQuery, json, parseRequest } from "./http-utils.js";
import { mcpProtocolVersion, toolDefinitions } from "./mcp-tools.js";
import { WORKSPACE_SERVICE } from "./runtime-revision.js";

export interface WorkspaceRouteDeps {
  actor: string;
  projectManager?: WorkspaceProjectManager;
  runtime?: WorkspaceRuntime;
  worker: WorkspaceWorker;
  runtimeRevision: string;
  getRuntime(): Promise<WorkspaceRuntime>;
  getAgentAdapter(): Promise<AgentAdapter>;
}

function visibleAgents(agentAdapter: AgentAdapter): { default_agent: string; agents: ReturnType<AgentAdapter["list"]> } {
  return { default_agent: "director", agents: agentAdapter.list() };
}

export async function handleRestRequest(request: IncomingMessage, response: ServerResponse, url: URL, deps: WorkspaceRouteDeps): Promise<boolean> {
      if (request.method === "GET" && url.pathname === "/workspace/status") {
        if (deps.projectManager === undefined) {
          json(response, 200, await deps.runtime!.status());
        } else if (!deps.projectManager.sessionSelected()) {
          json(response, 200, { ok: true, selected: false, projects: await deps.projectManager.listProjects() });
        } else {
          json(response, 200, await deps.projectManager.status());
        }
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/data") {
        if (deps.projectManager !== undefined && !deps.projectManager.sessionSelected()) {
          json(response, 200, { selected: false, projects: await deps.projectManager.listProjects() });
        } else {
          json(response, 200, await (await deps.getRuntime()).dashboardSummary());
        }
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/artifacts") {
        json(response, 200, await (await deps.getRuntime()).dashboardArtifacts(dashboardQuery(url)));
        return true;
      }
      const artifactDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/artifacts\/([^/]+)$/u.exec(url.pathname) : null;
      if (artifactDetailMatch !== null) {
        const artifact = await (await deps.getRuntime()).dashboardArtifact(dashboardPathId(artifactDetailMatch[1] ?? ""), url.searchParams.get("revision") ?? undefined);
        if (artifact === undefined) {
          json(response, 404, { code: "DASHBOARD_ARTIFACT_NOT_FOUND", message: "Artifact not found" });
        } else {
          json(response, 200, artifact);
        }
        return true;
      }
      const artifactHistoryMatch = request.method === "GET" ? /^\/workspace\/dashboard\/artifacts\/([^/]+)\/history$/u.exec(url.pathname) : null;
      if (artifactHistoryMatch !== null) {
        json(response, 200, await (await deps.getRuntime()).dashboardArtifactHistory(dashboardPathId(artifactHistoryMatch[1] ?? ""), dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/facts") {
        json(response, 200, await (await deps.getRuntime()).dashboardFacts(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/sources") {
        json(response, 200, await (await deps.getRuntime()).dashboardSources(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/candidates") {
        json(response, 200, await (await deps.getRuntime()).dashboardCandidates(dashboardQuery(url)));
        return true;
      }
      const sourceDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/sources\/([^/]+)$/u.exec(url.pathname) : null;
      if (sourceDetailMatch !== null) {
        const source = await (await deps.getRuntime()).dashboardSource(dashboardPathId(sourceDetailMatch[1] ?? ""));
        if (source === undefined) json(response, 404, { code: "DASHBOARD_SOURCE_NOT_FOUND", message: "Source not found" });
        else json(response, 200, source);
        return true;
      }
      const candidateDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/candidates\/([^/]+)$/u.exec(url.pathname) : null;
      if (candidateDetailMatch !== null) {
        const candidate = await (await deps.getRuntime()).dashboardCandidate(dashboardPathId(candidateDetailMatch[1] ?? ""));
        if (candidate === undefined) json(response, 404, { code: "DASHBOARD_CANDIDATE_NOT_FOUND", message: "Candidate not found" });
        else json(response, 200, candidate);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/operations") {
        json(response, 200, await (await deps.getRuntime()).dashboardOperations(dashboardQuery(url)));
        return true;
      }
      const operationDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/operations\/([^/]+)$/u.exec(url.pathname) : null;
      if (operationDetailMatch !== null) {
        const operation = await (await deps.getRuntime()).dashboardOperation(dashboardPathId(operationDetailMatch[1] ?? ""));
        if (operation === undefined) json(response, 404, { code: "DASHBOARD_OPERATION_NOT_FOUND", message: "Operation not found" });
        else json(response, 200, operation);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/audit") {
        json(response, 200, await (await deps.getRuntime()).dashboardAudit(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/issues") {
        json(response, 200, await (await deps.getRuntime()).dashboardIssues(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/reviews") {
        json(response, 200, await (await deps.getRuntime()).dashboardReviews(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/fact-review/runs") {
        json(response, 200, await (await deps.getRuntime()).dashboardReviewRuns(dashboardQuery(url)));
        return true;
      }
      const reviewRunDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/fact-review\/runs\/([^/]+)$/u.exec(url.pathname) : null;
      if (reviewRunDetailMatch !== null) {
        const run = await (await deps.getRuntime()).dashboardReviewRun(dashboardPathId(reviewRunDetailMatch[1] ?? ""));
        if (run === undefined) json(response, 404, { code: "DASHBOARD_REVIEW_RUN_NOT_FOUND", message: "Fact review run not found" });
        else json(response, 200, run);
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/publishes") {
        json(response, 200, await (await deps.getRuntime()).dashboardPublishes(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/builds") {
        json(response, 200, await (await deps.getRuntime()).dashboardBuilds(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/preview") {
        const rawMode = url.searchParams.get("mode");
        const mode = rawMode === "zhuji" || rawMode === "palette" ? rawMode : undefined;
        json(response, 200, await (await deps.getRuntime()).publishPreview(mode));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/tavern/compat") {
        json(response, 200, await (await deps.getRuntime()).tavernCompat());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/build/preview") {
        json(response, 200, await (await deps.getRuntime()).buildReadiness());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/repair/preview") {
        json(response, 200, await (await deps.getRuntime()).repairPreview());
        return true;
      }
      const imageMatch = request.method === "GET" ? /^\/workspace\/images\/([^/]+)$/u.exec(url.pathname) : null;
      if (imageMatch !== null) {
        const image = await (await deps.getRuntime()).getProjectImage(imageMatch[1] ?? "");
        if (image === undefined) {
          json(response, 404, { error: "IMAGE_NOT_FOUND" });
          return true;
        }
        response.setHeader("content-type", image.media_type);
        response.setHeader("cache-control", "no-store");
        response.end(Buffer.from(image.content.buffer, image.content.byteOffset, image.content.byteLength));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/health") {
        json(response, 200, { service: WORKSPACE_SERVICE, status: "ready", runtime_revision: deps.runtimeRevision, worker: deps.worker.status() });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/agents") {
        json(response, 200, visibleAgents(await deps.getAgentAdapter()));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/zhuji/context") {
        json(response, 200, await (await deps.getRuntime()).zhujiContext(url.searchParams.get("character_id") ?? undefined));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/template/context") {
        const kind = url.searchParams.get("kind");
        if (kind === null || !templateKindSchema.safeParse({ kind }).success) {
          json(response, 400, structuredError(new CoreError("TEMPLATE_KIND_REQUIRED", "TEMPLATE_KIND_REQUIRED", true)));
          return true;
        }
        json(response, 200, await (await deps.getRuntime()).templateContext(kind as Parameters<WorkspaceRuntime["templateContext"]>[0]));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/authoring/context") {
        json(response, 200, await (await deps.getRuntime()).authoringKnowledgeContext());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/source/candidates") {
        json(response, 200, { candidates: await (await deps.getRuntime()).sourceCandidates() });
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/interview/context") {
        if (deps.projectManager !== undefined && !deps.projectManager.sessionSelected()) {
          json(response, 200, { status: "idle", answers: [], selected: false });
        } else {
          json(response, 200, await (await deps.getRuntime()).interviewContext());
        }
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/projects") {
        if (deps.projectManager === undefined) {
          json(response, 200, { projects: [] });
        } else {
          const manager = deps.projectManager;
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
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/new") {
        if (deps.projectManager === undefined) {
          json(response, 400, structuredError(new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true)));
          return true;
        }
        const runtime = await deps.projectManager.startNewProject();
        json(response, 200, { selected: true, ...(await runtime.interviewContext()) });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/request") {
        const parsed = await body(request);
        const input = parseRequest(requestSchema, parsed, "REQUEST_REQUIRED");
        const requestText = input.request;
        const requestedAgent = input.agent;
        const targetOpId = input.target_operation_id ?? input.operation_id;
        const requestOptions = {
          ...(requestedAgent === undefined ? {} : { agent: requestedAgent }),
          ...(targetOpId === undefined ? {} : { target_operation_id: targetOpId }),
        };
        const result = deps.projectManager === undefined
          ? await (await deps.getAgentAdapter()).request({ request: requestText, context: { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, ...requestOptions })
          : await deps.projectManager.request(requestText, { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, requestOptions);
        json(response, 200, result);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/interview/answer") {
        const parsed = await body(request);
        const { answer } = parseRequest(answerSchema, parsed, "ANSWER_REQUIRED");
        const result = deps.projectManager === undefined
          ? await (await deps.getRuntime()).answerInterview(answer, { actor: deps.actor, attachments: [] })
          : await deps.projectManager.answerInterview(answer, { actor: deps.actor, attachments: [] });
        json(response, 200, result);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/source/select") {
        const parsed = await body(request);
        const { decisions } = parseRequest(sourceSelectionInputSchema, parsed, "SOURCE_SELECTION_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).selectSourceCandidates(decisions, { actor: deps.actor, attachments: [] }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/adaptation/decision") {
        const parsed = await body(request);
        const decision = parseRequest(adaptationDecisionInputSchema, parsed, "ADAPTATION_DECISION_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).createAdaptationDecision(compact(decision) as Omit<AdaptationDecision, "id" | "created_at" | "created_by">, { actor: deps.actor, attachments: [] }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/project/select") {
        const parsed = await body(request);
        const { project } = parseRequest(projectSchema, parsed, "PROJECT_REQUIRED");
        if (deps.projectManager === undefined) {
          json(response, 400, structuredError(new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true)));
          return true;
        }
        json(response, 200, await deps.projectManager.select(project));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/zhuji") {
        const parsed = await body(request);
        const result = await (await deps.getRuntime()).submitZhujiProposal(parsed, { actor: deps.actor, attachments: [] });
        json(response, 200, result);
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/template") {
        const parsed = await body(request);
        const result = await (await deps.getRuntime()).submitTemplateProposal(parsed, { actor: deps.actor, attachments: [] });
        json(response, 200, result);
        return true;
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
        json(response, 200, await (await deps.getRuntime()).setProjectImage({ actor: deps.actor, attachments }, options));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/images/remove") {
        const parsed = await body(request);
        const { image_id } = parseRequest(imageRemoveInputSchema, parsed, "IMAGE_ID_REQUIRED");
        const removed = await (await deps.getRuntime()).removeProjectImage(image_id, deps.actor);
        json(response, 200, { status: removed ? "removed" : "not_found", image_id });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/issue") {
        const parsed = await body(request);
        const input = parseRequest(issueUpdateInputSchema, parsed, "ISSUE_UPDATE_REQUIRED");
        const { agent, ...issue } = input;
        json(response, 200, await (await deps.getRuntime()).updateIssue(compact(issue) as IssueUpdateInput, { actor: deps.actor, attachments: [] }, agent === undefined ? {} : { agent }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/quality/profile") {
        const parsed = await body(request);
        const input = parseRequest(qualityProfileInputSchema, parsed, "QUALITY_LEVEL_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).configureQualityProfile(input.level, { actor: deps.actor, attachments: [] }, input.overrides ?? {}));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/run") {
        const runtime = await deps.getRuntime();
        json(response, 200, await runtime.startFactReviewRun(deps.actor));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/knowledge/reextract") {
        const parsed = await body(request);
        const input = parseRequest(reextractInputSchema, parsed, "SOURCE_IDS_REQUIRED");
        const runtime = await deps.getRuntime();
        json(response, 200, await runtime.reextract(internalId("operation"), input.source_ids, deps.actor, input.extractor_revision));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/batch") {
        const parsed = await body(request);
        const input = parseRequest(factReviewBatchInputSchema, parsed, "FACT_DECISIONS_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).applyFactReviewBatch(input.decisions, deps.actor, input.reviewer_identity, input.run_id, input.expected_projection_revision));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/fact/review/conflict") {
        const parsed = await body(request);
        const input = parseRequest(factReviewBatchInputSchema, parsed, "FACT_DECISIONS_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).resolveFactConflict(input.decisions, deps.actor, input.run_id, input.expected_projection_revision));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/recover") {
        const parsed = await body(request);
        const { operation_id } = parseRequest(operationIdSchema, parsed, "OPERATION_ID_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).recoverOperation(operation_id, { actor: deps.actor, attachments: [] }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/fail") {
        const parsed = await body(request);
        const { operation_id } = parseRequest(operationIdSchema, parsed, "OPERATION_ID_REQUIRED");
        try {
          json(response, 200, await (await deps.getRuntime()).cancelOperation(operation_id, deps.actor));
        } catch (error) {
          if (error instanceof CoreError) {
            json(response, 400, structuredError(error));
            return true;
          }
          throw error;
        }
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/repair/run") {
        const parsed = await body(request) as { plan_hash?: unknown } | undefined;
        json(response, 200, await (await deps.getRuntime()).repairRun(typeof parsed?.plan_hash === "string" ? parsed.plan_hash : undefined));
        return true;
      }
  return false;
}

export async function handleMcpRequest(request: IncomingMessage, response: ServerResponse, url: URL, deps: WorkspaceRouteDeps): Promise<boolean> {
      if (request.method === "POST" && url.pathname === "/mcp") {
        const parsed = await body(request) as { id?: unknown; method?: unknown; params?: unknown };
        const id = parsed.id ?? null;
        if (parsed.method === "initialize") {
          json(response, 200, { jsonrpc: "2.0", id, result: { protocolVersion: mcpProtocolVersion(parsed.params), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "st-workspace-v3", version: "0.1.0" } } });
          return true;
        }
        if (parsed.method === "tools/list") {
          json(response, 200, { jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
          return true;
        }
        if (parsed.method === "tools/call") {
          const params = parsed.params as { name?: unknown; arguments?: unknown } | undefined;
          if (params?.name === "workspace_agents") {
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(visibleAgents(await deps.getAgentAdapter())) }] } });
            return true;
          }
          if (params?.name === "workspace_zhuji_context") {
            const input = params.arguments === undefined || typeof params.arguments !== "object" ? undefined : parseRequest(characterIdSchema, params.arguments, "CHARACTER_ID_REQUIRED");
            const context = await (await deps.getRuntime()).zhujiContext(input?.character_id);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return true;
          }
          if (params?.name === "workspace_zhuji_submit") {
            const result = await (await deps.getRuntime()).submitZhujiProposal(params.arguments, { actor: deps.actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_template_context") {
            let kind: string | undefined;
            try {
              kind = parseRequest(templateKindSchema, params.arguments, "TEMPLATE_KIND_REQUIRED").kind;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "kind is required" } });
              return true;
            }
            const context = await (await deps.getRuntime()).templateContext(kind as Parameters<WorkspaceRuntime["templateContext"]>[0]);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return true;
          }
          if (params?.name === "workspace_template_submit") {
            const result = await (await deps.getRuntime()).submitTemplateProposal(params.arguments, { actor: deps.actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_issue_update") {
            let input: z.infer<typeof issueUpdateInputSchema>;
            try {
              input = parseRequest(issueUpdateInputSchema, params.arguments, "ISSUE_UPDATE_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "issue_id, action and reason are required" } });
              return true;
            }
            const { agent, ...issue } = input;
            const result = await (await deps.getRuntime()).updateIssue(compact(issue) as IssueUpdateInput, { actor: deps.actor, attachments: [] }, agent === undefined ? {} : { agent });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_authoring_context") {
            const context = await (await deps.getRuntime()).authoringKnowledgeContext();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return true;
          }
          if (params?.name === "workspace_source_candidates") {
            const candidates = await (await deps.getRuntime()).sourceCandidates();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ candidates }) }] } });
            return true;
          }
          if (params?.name === "workspace_source_select") {
            let decisions: z.infer<typeof sourceSelectionInputSchema>["decisions"];
            try {
              decisions = parseRequest(sourceSelectionInputSchema, params.arguments, "SOURCE_SELECTION_REQUIRED").decisions;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "decisions are required" } });
              return true;
            }
            const result = await (await deps.getRuntime()).selectSourceCandidates(decisions, { actor: deps.actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_adaptation_decision") {
            let decision: z.infer<typeof adaptationDecisionInputSchema>;
            try {
              decision = parseRequest(adaptationDecisionInputSchema, params.arguments, "ADAPTATION_DECISION_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "topic, choice and rationale are required" } });
              return true;
            }
            const result = await (await deps.getRuntime()).createAdaptationDecision(compact(decision) as Omit<AdaptationDecision, "id" | "created_at" | "created_by">, { actor: deps.actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_status") {
            const statusValue = deps.projectManager === undefined
              ? await deps.runtime!.status()
              : deps.projectManager.sessionSelected()
                ? await deps.projectManager.status()
                : { ok: true, selected: false, projects: await deps.projectManager.listProjects() };
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(statusValue) }] } });
            return true;
          }
          if (params?.name === "workspace_interview_context") {
            const context = deps.projectManager !== undefined && !deps.projectManager.sessionSelected()
              ? { status: "idle", answers: [], selected: false }
              : await (await deps.getRuntime()).interviewContext();
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(context) }] } });
            return true;
          }
          if (params?.name === "workspace_interview_answer") {
            let answer: string;
            try {
              answer = parseRequest(answerSchema, params.arguments, "ANSWER_REQUIRED").answer;
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "answer is required" } });
              return true;
            }
            const result = deps.projectManager === undefined
              ? await (await deps.getRuntime()).answerInterview(answer, { actor: deps.actor, attachments: [] })
              : await deps.projectManager.answerInterview(answer, { actor: deps.actor, attachments: [] });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          if (params?.name === "workspace_projects") {
            if (deps.projectManager === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects: [] }) }] } });
            } else {
              const manager = deps.projectManager;
              const projects = await manager.listProjects();
              if (!manager.sessionSelected()) {
                json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects }) }] } });
                return true;
              }
              const current = await manager.repository.read();
              const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
                ? projects.filter((project) => project.project_id !== current.project_id)
                : projects;
              json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ projects: visible }) }] } });
            }
            return true;
          }
          if (params?.name === "workspace_project_select") {
            let project: string | undefined;
            try {
              project = parseRequest(projectSchema, params.arguments, "PROJECT_REQUIRED").project;
            } catch {
              project = undefined;
            }
            if (project === undefined || deps.projectManager === undefined) {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: project === undefined ? "project is required" : "project manager is required" } });
              return true;
            }
            const selected = await deps.projectManager.select(project);
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(selected) }] } });
            return true;
          }
          if (params?.name === "workspace_request") {
            let input: z.infer<typeof requestSchema>;
            try {
              input = parseRequest(requestSchema, params.arguments, "REQUEST_REQUIRED");
            } catch {
              json(response, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "request is required" } });
              return true;
            }
            const result: RequestResult = deps.projectManager === undefined
              ? await (await deps.getAgentAdapter()).request({ request: input.request, context: { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, ...(input.agent === undefined ? {} : { agent: input.agent }) })
              : await deps.projectManager.request(input.request, { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, input.agent === undefined ? {} : { agent: input.agent });
            json(response, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
            return true;
          }
          json(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "tool not found" } });
          return true;
        }
        json(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
        return true;
      }
  return false;
}
