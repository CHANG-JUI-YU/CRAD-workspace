import type { IncomingMessage, ServerResponse } from "node:http";
import { CoreError, internalId, z, type AdaptationDecision, type RequestResult } from "@st-workspace/core";
import { adaptationDecisionInputSchema, answerSchema, characterIdSchema, coverageResearchCandidatesInputSchema, coverageResearchClaimInputSchema, coverageResearchExhaustInputSchema, coverageResearchRecoverInputSchema, coverageResearchStartInputSchema, coverageResearchStartPreviewInputSchema, coverageResolutionConfirmInputSchema, coverageResolutionPreviewInputSchema, coverageSupplementInputSchema, coverageUrlIngestionRecoverInputSchema, decodeAttachments, factReviewBatchInputSchema, coverSelectInputSchema, imageInputSchema, imageRemoveInputSchema, interviewAmendPreviewSchema, interviewAmendSchema, issueUpdateInputSchema, operationIdSchema, projectSchema, publishProvenanceConfirmSchema, qualityLevelSchema, qualityProfileInputSchema, reextractInputSchema, requestSchema, sourceSelectionInputSchema, templateKindSchema, type IssueUpdateInput } from "@st-workspace/domain";
import { type AgentAdapter, type WorkspaceProjectManager, type WorkspaceRuntime, type WorkspaceWorker } from "@st-workspace/runtime";
import { structuredError } from "./errors.js";
import { body, compact, dashboardPathId, dashboardQuery, json, parseRequest, restError } from "./http-utils.js";
import { assertHighImpactConfirmed } from "./http-security.js";
import { mcpProtocolVersion, toolDefinitions } from "./mcp-tools.js";
import { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_PARSE_ERROR, jsonRpcError, parseJsonRpcMessage, type JsonRpcErrorResponse, type JsonRpcId, type JsonRpcSuccessResponse } from "./jsonrpc.js";
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

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 20;

const operationAttachmentReuploadSchema = z.object({
  operation_id: z.string().min(1),
  replacements: z.array(z.object({
    missing_ref_id: z.string().min(1).optional(),
    original_ref_id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(255).refine((n) => !n.includes("..") && !n.includes("/") && !n.includes("\\"), {
      message: "Invalid attachment filename",
    }),
    content_base64: z.string().optional(),
    content: z.string().optional(),
    media_type: z.string().max(100).optional(),
  }).refine((r) => {
    const raw = r.content_base64 ?? r.content;
    return typeof raw === "string" && raw.trim().length > 0;
  }, {
    message: "Attachment content is required",
  })).min(1).max(MAX_ATTACHMENT_COUNT),
}).strict();

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
          restError(response, new CoreError("DASHBOARD_ARTIFACT_NOT_FOUND", "Artifact not found", true));
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
      const artifactCoverageMatch = request.method === "GET" ? /^\/workspace\/dashboard\/artifacts\/([^/]+)\/coverage$/u.exec(url.pathname) : null;
      if (artifactCoverageMatch !== null) {
        const lineage = await (await deps.getRuntime()).dashboardArtifactLineage(dashboardPathId(artifactCoverageMatch[1] ?? ""));
        if (lineage === undefined) restError(response, new CoreError("DASHBOARD_ARTIFACT_COVERAGE_NOT_FOUND", "Artifact coverage lineage not found", true));
        else json(response, 200, lineage);
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
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/url-ingestions") {
        json(response, 200, await (await deps.getRuntime()).dashboardUrlIngestions(dashboardQuery(url)));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/candidates") {
        json(response, 200, await (await deps.getRuntime()).dashboardCandidates(dashboardQuery(url)));
        return true;
      }
      const sourceDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/sources\/([^/]+)$/u.exec(url.pathname) : null;
      if (sourceDetailMatch !== null) {
        const source = await (await deps.getRuntime()).dashboardSource(dashboardPathId(sourceDetailMatch[1] ?? ""));
        if (source === undefined) restError(response, new CoreError("DASHBOARD_SOURCE_NOT_FOUND", "Source not found", true));
        else json(response, 200, source);
        return true;
      }
      const candidateDetailMatch = request.method === "GET" ? /^\/workspace\/dashboard\/candidates\/([^/]+)$/u.exec(url.pathname) : null;
      if (candidateDetailMatch !== null) {
        const candidate = await (await deps.getRuntime()).dashboardCandidate(dashboardPathId(candidateDetailMatch[1] ?? ""));
        if (candidate === undefined) restError(response, new CoreError("DASHBOARD_CANDIDATE_NOT_FOUND", "Candidate not found", true));
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
        if (operation === undefined) restError(response, new CoreError("DASHBOARD_OPERATION_NOT_FOUND", "Operation not found", true));
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
        if (run === undefined) restError(response, new CoreError("DASHBOARD_REVIEW_RUN_NOT_FOUND", "Fact review run not found", true));
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
        if (rawMode !== null && rawMode !== "" && rawMode !== "zhuji" && rawMode !== "palette" && rawMode !== "both") {
          restError(response, new CoreError("BUILD_MODE_INVALID", `Invalid build mode: ${rawMode}`, true));
          return true;
        }
        const mode = rawMode === null || rawMode === "" ? undefined : rawMode as "zhuji" | "palette" | "both";
        json(response, 200, await (await deps.getRuntime()).publishPreview(mode));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/provenance/preview") {
        const rawMode = url.searchParams.get("mode");
        if (rawMode !== null && rawMode !== "" && rawMode !== "zhuji" && rawMode !== "palette" && rawMode !== "both") {
          restError(response, new CoreError("BUILD_MODE_INVALID", `Invalid build mode: ${rawMode}`, true));
          return true;
        }
        const mode = rawMode === null || rawMode === "" ? undefined : rawMode as "zhuji" | "palette" | "both";
        json(response, 200, await (await deps.getRuntime()).publishProvenancePreview(mode));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/provenance") {
        json(response, 200, await (await deps.getRuntime()).dashboardProvenance());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/completion") {
        const publishId = url.searchParams.get("publish_id");
        if (publishId === null || publishId === "") {
          restError(response, new CoreError("PUBLISH_ID_REQUIRED", "publish_id 參數為必填。", true));
          return true;
        }
        json(response, 200, await (await deps.getRuntime()).publishCompletion(publishId));
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/publish/download") {
        const publishId = url.searchParams.get("publish_id");
        const rawKind = url.searchParams.get("kind");
        if (publishId === null || publishId === "") {
          restError(response, new CoreError("PUBLISH_ID_REQUIRED", "publish_id 參數為必填。", true));
          return true;
        }
        if (rawKind !== "json" && rawKind !== "png") {
          restError(response, new CoreError("PUBLISH_DOWNLOAD_KIND_INVALID", `Invalid download kind: ${rawKind ?? "null"}`, true));
          return true;
        }
        try {
          const result = await (await deps.getRuntime()).publishDownload(publishId, rawKind);
          json(response, 200, {
            media_type: result.media_type,
            filename: result.filename,
            content: Buffer.from(result.content.buffer, result.content.byteOffset, result.content.byteLength).toString("base64"),
          });
        } catch (error) {
          restError(response, error);
        }
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
        const rawImageId = imageMatch[1] ?? "";
        let imageId: string;
        try {
          imageId = decodeURIComponent(rawImageId);
        } catch {
          restError(response, new CoreError("IMAGE_ID_INVALID", `Malformed percent-encoded image identifier: ${rawImageId}`, true));
          return true;
        }
        if (!imageId || imageId === "." || imageId === ".." || imageId.includes("/") || imageId.includes("\\") || imageId.includes("\0")) {
          restError(response, new CoreError("IMAGE_ID_INVALID", `Invalid image identifier: ${rawImageId}`, true));
          return true;
        }
        const image = await (await deps.getRuntime()).getProjectImage(imageId);
        if (image === undefined) {
          restError(response, new CoreError("IMAGE_NOT_FOUND", "Image not found", true));
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
          restError(response, new CoreError("TEMPLATE_KIND_REQUIRED", "TEMPLATE_KIND_REQUIRED", true));
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
          restError(response, new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true));
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
      if (request.method === "POST" && url.pathname === "/workspace/publish/provenance/confirm") {
        assertHighImpactConfirmed(request.headers, "publish");
        const parsed = await body(request);
        const input = parseRequest(publishProvenanceConfirmSchema, parsed, "PROVENANCE_CONFIRMATION_REQUIRED");
        const result = await (await deps.getRuntime()).publishProvenanceConfirm({
          fingerprint: input.fingerprint,
          ...(input.mode_selection === undefined ? {} : { mode_selection: input.mode_selection }),
          ...(input.idempotency_key === undefined ? {} : { idempotency_key: input.idempotency_key }),
          ...(input.operation_id === undefined ? {} : { operation_id: input.operation_id }),
          ...(input.prepared_snapshot === undefined ? {} : { prepared_snapshot: input.prepared_snapshot as unknown as Parameters<WorkspaceRuntime["publishProvenanceConfirm"]>[0]["prepared_snapshot"] }),
        }, { actor: deps.actor, attachments: [] });
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
      if (request.method === "POST" && url.pathname === "/workspace/interview/amend-preview") {
        const parsed = await body(request);
        const input = parseRequest(interviewAmendPreviewSchema, parsed, "INTERVIEW_AMEND_PREVIEW_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).interviewAmendmentImpactPreview(input));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/interview/amend") {
        const parsed = await body(request);
        const input = parseRequest(interviewAmendSchema, parsed, "INTERVIEW_AMEND_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).amendInterviewAnswer(input, { actor: deps.actor, attachments: [] }));
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
          restError(response, new CoreError("PROJECT_MANAGER_REQUIRED", "PROJECT_MANAGER_REQUIRED", true));
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
        if (!image_id || image_id === "." || image_id === ".." || image_id.includes("/") || image_id.includes("\\") || image_id.includes("\0")) {
          restError(response, new CoreError("IMAGE_ID_INVALID", `Invalid image identifier: ${image_id}`, true));
          return true;
        }
        const removed = await (await deps.getRuntime()).removeProjectImage(image_id, deps.actor);
        json(response, 200, { status: removed ? "removed" : "not_found", image_id });
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/cover/select") {
        const parsed = await body(request);
        const { image_id, placeholder } = parseRequest(coverSelectInputSchema, parsed, "COVER_SELECT_REQUIRED");
        if (image_id !== undefined && (!image_id || image_id === "." || image_id === ".." || image_id.includes("/") || image_id.includes("\\") || image_id.includes("\0"))) {
          restError(response, new CoreError("IMAGE_ID_INVALID", `Invalid image identifier: ${image_id}`, true));
          return true;
        }
        const options: { image_id?: string; placeholder?: boolean } = {};
        if (image_id !== undefined) options.image_id = image_id;
        if (placeholder !== undefined) options.placeholder = placeholder;
        json(response, 200, await (await deps.getRuntime()).setProjectCover(deps.actor, options));
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
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/coverage") {
        json(response, 200, await (await deps.getRuntime()).dashboardCoverage());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/workflow") {
        json(response, 200, await (await deps.getRuntime()).dashboardWorkflow());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/invalidations") {
        json(response, 200, await (await deps.getRuntime()).dashboardInvalidations());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/coverage-center") {
        json(response, 200, await (await deps.getRuntime()).dashboardCoverageCenter());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/publish-diagnostics") {
        json(response, 200, await (await deps.getRuntime()).dashboardPublishDiagnostics());
        return true;
      }
      if (request.method === "GET" && url.pathname === "/workspace/dashboard/fact-review/evidence") {
        const query = dashboardQuery(url);
        const sourceId = url.searchParams.get("source_id");
        const classification = url.searchParams.get("classification");
        const reviewerIdentity = url.searchParams.get("reviewer_identity");
        json(response, 200, await (await deps.getRuntime()).dashboardFactReviewEvidence({
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(sourceId === null ? {} : { source_id: sourceId }),
          ...(classification === "identity" || classification === "trait" || classification === "event" || classification === "relationship" || classification === "world" || classification === "other" ? { classification } : {}),
          ...(reviewerIdentity === null ? {} : { reviewer_identity: reviewerIdentity }),
        }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/preview") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchStartPreviewInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResearchStartPreview(input));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/start") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchStartInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResearchStart(deps.actor, input.assessment_id, input.assessment_revision, input.scope, input.operation_id));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/claim") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchClaimInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResearchClaim(deps.actor, input.batch_id, input.lease_duration_ms));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/candidates") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchCandidatesInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResearchCandidates(deps.actor, input.task_id, input.claim_generation, input.lease_owner, input.candidates));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/exhaust") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchExhaustInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResearchExhaust(deps.actor, input.task_id, input.claim_generation, input.lease_owner, input.searched_queries, input.source_families, input.exhausted_reason));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/resolution/preview") {
        const parsed = await body(request);
        const input = parseRequest(coverageResolutionPreviewInputSchema, parsed, "COVERAGE_RESOLUTION_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResolutionPreview({ assessment_id: input.assessment_id, assessment_revision: input.assessment_revision, requirement_id: input.requirement_id, ...(input.character_id === undefined ? {} : { character_id: input.character_id }), action: input.action }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/resolution/confirm") {
        const parsed = await body(request);
        const input = parseRequest(coverageResolutionConfirmInputSchema, parsed, "COVERAGE_RESOLUTION_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageResolutionConfirm(deps.actor, { assessment_id: input.assessment_id, assessment_revision: input.assessment_revision, requirement_id: input.requirement_id, ...(input.character_id === undefined ? {} : { character_id: input.character_id }), action: input.action, choice: input.choice, rationale: input.rationale, ...(input.operation_id === undefined ? {} : { operation_id: input.operation_id }) }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/supplement") {
        const parsed = await body(request);
        const input = parseRequest(coverageSupplementInputSchema, parsed, "COVERAGE_SUPPLEMENT_REQUIRED");
        const attachments = decodeAttachments(input.attachments);
        json(response, 200, await (await deps.getRuntime()).coverageSupplement(deps.actor, {
          assessment_id: input.assessment_id,
          assessment_revision: input.assessment_revision,
          requirement_id: input.requirement_id,
          ...(input.character_id === undefined ? {} : { character_id: input.character_id }),
          ...(input.choice === undefined ? {} : { choice: input.choice }),
          ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
          ...(input.pending_resolution_id === undefined ? {} : { pending_resolution_id: input.pending_resolution_id }),
          ...(input.resolution_id === undefined ? {} : { resolution_id: input.resolution_id }),
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.url_ingestion_id === undefined ? {} : { url_ingestion_id: input.url_ingestion_id }),
          ...(input.operation_id === undefined ? {} : { operation_id: input.operation_id }),
        }, attachments));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/research/recover") {
        const parsed = await body(request);
        const input = parseRequest(coverageResearchRecoverInputSchema, parsed, "COVERAGE_RESEARCH_REQUIRED");
        const attachments = decodeAttachments(input.attachments);
        json(response, 200, await (await deps.getRuntime()).coverageResearchRecover(deps.actor, {
          task_id: input.task_id,
          action: input.action,
          ...(input.query_seeds === undefined ? {} : { query_seeds: input.query_seeds }),
          ...(input.source_constraints === undefined ? {} : { source_constraints: input.source_constraints }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.choice === undefined ? {} : { choice: input.choice }),
          ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
          ...(input.url_ingestion_id === undefined ? {} : { url_ingestion_id: input.url_ingestion_id }),
          ...(input.operation_id === undefined ? {} : { operation_id: input.operation_id }),
        }, attachments));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/coverage/url-ingestion/recover") {
        const parsed = await body(request);
        const input = parseRequest(coverageUrlIngestionRecoverInputSchema, parsed, "COVERAGE_URL_INGESTION_REQUIRED");
        json(response, 200, await (await deps.getRuntime()).coverageUrlIngestionRecover(deps.actor, input));
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
      if (request.method === "POST" && url.pathname === "/workspace/operation/attachments/reupload") {
        const parsed = await body(request);
        let input: z.infer<typeof operationAttachmentReuploadSchema>;
        try {
          input = parseRequest(operationAttachmentReuploadSchema, parsed, "OPERATION_ID_REQUIRED");
        } catch (error) {
          if (error instanceof CoreError) {
            restError(response, error);
            return true;
          }
          throw error;
        }
        const replacements = [];
        for (const r of input.replacements) {
          const rawBase64 = (r.content_base64 ?? r.content ?? "").trim();
          if (!rawBase64) {
            restError(response, new CoreError("ATTACHMENT_CONTENT_REQUIRED", "附件內容為必填。", true));
            return true;
          }
          if (rawBase64.length % 4 !== 0 || !BASE64_PATTERN.test(rawBase64)) {
            restError(response, new CoreError("ATTACHMENT_INVALID_BASE64", "附件 base64 編碼格式不正確。", true));
            return true;
          }
          let content: Buffer;
          try {
            content = Buffer.from(rawBase64, "base64");
          } catch {
            restError(response, new CoreError("ATTACHMENT_INVALID_BASE64", "附件 base64 解碼失敗。", true));
            return true;
          }
          if (content.byteLength === 0) {
            restError(response, new CoreError("ATTACHMENT_EMPTY", "附件內容不可為空（0 位元組）。", true));
            return true;
          }
          if (content.byteLength > MAX_ATTACHMENT_SIZE) {
            restError(response, new CoreError("ATTACHMENT_TOO_LARGE", "附件檔案過大，單檔限制為 5MB。", true));
            return true;
          }
          const missingRefId = r.missing_ref_id ?? r.original_ref_id;
          replacements.push({
            ...(missingRefId === undefined ? {} : { missing_ref_id: missingRefId }),
            name: r.name,
            content: new Uint8Array(content),
            ...(r.media_type === undefined ? {} : { media_type: r.media_type }),
          });
        }
        const runtime = await deps.getRuntime();
        json(response, 200, await runtime.reuploadOperationAttachments(input.operation_id, replacements, { actor: deps.actor, attachments: [] }));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/operation/fail") {
        const parsed = await body(request);
        const { operation_id } = parseRequest(operationIdSchema, parsed, "OPERATION_ID_REQUIRED");
        try {
          json(response, 200, await (await deps.getRuntime()).cancelOperation(operation_id, deps.actor));
        } catch (error) {
          if (error instanceof CoreError) {
            restError(response, error);
            return true;
          }
          throw error;
        }
        return true;
      }
      if (request.method === "POST" && url.pathname === "/workspace/repair/run") {
        assertHighImpactConfirmed(request.headers, "repair");
        const parsed = await body(request) as { plan_hash?: unknown } | undefined;
        json(response, 200, await (await deps.getRuntime()).repairRun(typeof parsed?.plan_hash === "string" ? parsed.plan_hash : undefined));
        return true;
      }
  return false;
}

export async function handleMcpRequest(request: IncomingMessage, response: ServerResponse, url: URL, deps: WorkspaceRouteDeps): Promise<boolean> {
      if (request.method === "POST" && url.pathname === "/mcp") {
        let raw: unknown;
        try {
          raw = await body(request);
        } catch {
          json(response, 200, jsonRpcError(null, JSONRPC_PARSE_ERROR, "Parse error"));
          return true;
        }
        const isBatch = Array.isArray(raw);
        if (isBatch && (raw as unknown[]).length === 0) {
          json(response, 200, jsonRpcError(null, JSONRPC_INVALID_REQUEST, "Invalid Request"));
          return true;
        }
        const messages = isBatch ? (raw as unknown[]) : [raw];
        const responses: Array<JsonRpcSuccessResponse | JsonRpcErrorResponse> = [];
        for (const rawMessage of messages) {
          const parsed = parseJsonRpcMessage(rawMessage);
          if (parsed.kind !== "request") {
            responses.push(jsonRpcError(null, parsed.code, parsed.message));
            continue;
          }
          if (parsed.notification) continue;
          responses.push(await dispatchMcpMethod(parsed.method, parsed.params, parsed.id, deps));
        }
        if (responses.length === 0) {
          response.statusCode = 204;
          response.end();
        } else if (isBatch) {
          json(response, 200, responses);
        } else {
          json(response, 200, responses[0]);
        }
        return true;
      }
  return false;
}

async function dispatchMcpMethod(method: string, params: unknown, id: JsonRpcId, deps: WorkspaceRouteDeps): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
  try {
    if (method === "initialize") {
      return { jsonrpc: "2.0", id, result: { protocolVersion: mcpProtocolVersion(params), capabilities: { tools: { listChanged: false } }, serverInfo: { name: "st-workspace-v3", version: "0.1.0" } } };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: toolDefinitions } };
    }
    if (method === "tools/call") {
      if (params === undefined || typeof params !== "object" || params === null || Array.isArray(params)) {
        return jsonRpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params");
      }
      const name = (params as { name?: unknown }).name;
      if (typeof name !== "string" || name === "") {
        return jsonRpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params");
      }
      if (!toolDefinitions.some((tool) => tool.name === name)) {
        return jsonRpcError(id, JSONRPC_METHOD_NOT_FOUND, "tool not found");
      }
      const result = await callWorkspaceTool(name, (params as { arguments?: unknown }).arguments, deps);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
    }
    return jsonRpcError(id, JSONRPC_METHOD_NOT_FOUND, "method not found");
  } catch (error) {
    const code = error instanceof CoreError ? error.code : undefined;
    if (error instanceof CoreError && error.recoverable) {
      return jsonRpcError(id, JSONRPC_INVALID_PARAMS, "Invalid params", code === undefined ? undefined : { code });
    }
    return jsonRpcError(id, JSONRPC_INTERNAL_ERROR, "Internal error", code === undefined ? undefined : { code });
  }
}

async function callWorkspaceTool(name: string, args: unknown, deps: WorkspaceRouteDeps): Promise<unknown> {
  const parsedArguments = args === undefined || typeof args !== "object" || args === null || Array.isArray(args) ? undefined : (args as Record<string, unknown>);
  switch (name) {
    case "workspace_agents":
      return visibleAgents(await deps.getAgentAdapter());
    case "workspace_zhuji_context": {
      const input = parsedArguments === undefined ? undefined : parseRequest(characterIdSchema, parsedArguments, "CHARACTER_ID_REQUIRED");
      return (await deps.getRuntime()).zhujiContext(input?.character_id);
    }
    case "workspace_zhuji_submit":
      return (await deps.getRuntime()).submitZhujiProposal(parsedArguments, { actor: deps.actor, attachments: [] });
    case "workspace_template_context": {
      const input = parseRequest(templateKindSchema, parsedArguments, "TEMPLATE_KIND_REQUIRED");
      return (await deps.getRuntime()).templateContext(input.kind);
    }
    case "workspace_template_submit":
      return (await deps.getRuntime()).submitTemplateProposal(parsedArguments, { actor: deps.actor, attachments: [] });
    case "workspace_issue_update": {
      const input = parseRequest(issueUpdateInputSchema, parsedArguments, "ISSUE_UPDATE_REQUIRED");
      const { agent, ...issue } = input;
      return (await deps.getRuntime()).updateIssue(compact(issue) as IssueUpdateInput, { actor: deps.actor, attachments: [] }, agent === undefined ? {} : { agent });
    }
    case "workspace_authoring_context":
      return (await deps.getRuntime()).authoringKnowledgeContext();
    case "workspace_source_candidates":
      return { candidates: await (await deps.getRuntime()).sourceCandidates() };
    case "workspace_source_select": {
      const input = parseRequest(sourceSelectionInputSchema, parsedArguments, "SOURCE_SELECTION_REQUIRED");
      return (await deps.getRuntime()).selectSourceCandidates(input.decisions, { actor: deps.actor, attachments: [] });
    }
    case "workspace_adaptation_decision": {
      const input = parseRequest(adaptationDecisionInputSchema, parsedArguments, "ADAPTATION_DECISION_REQUIRED");
      return (await deps.getRuntime()).createAdaptationDecision(compact(input) as Omit<AdaptationDecision, "id" | "created_at" | "created_by">, { actor: deps.actor, attachments: [] });
    }
    case "workspace_status":
      return deps.projectManager === undefined
        ? await deps.runtime!.status()
        : deps.projectManager.sessionSelected()
          ? await deps.projectManager.status()
          : { ok: true, selected: false, projects: await deps.projectManager.listProjects() };
    case "workspace_interview_context":
      return deps.projectManager !== undefined && !deps.projectManager.sessionSelected()
        ? { status: "idle", answers: [], selected: false }
        : await (await deps.getRuntime()).interviewContext();
    case "workspace_interview_answer": {
      const input = parseRequest(answerSchema, parsedArguments, "ANSWER_REQUIRED");
      return deps.projectManager === undefined
        ? await (await deps.getRuntime()).answerInterview(input.answer, { actor: deps.actor, attachments: [] })
        : await deps.projectManager.answerInterview(input.answer, { actor: deps.actor, attachments: [] });
    }
    case "workspace_projects": {
      if (deps.projectManager === undefined) return { projects: [] };
      const manager = deps.projectManager;
      const projects = await manager.listProjects();
      if (!manager.sessionSelected()) return { projects };
      const current = await manager.repository.read();
      const visible = current.project_status === "uninitialized" && current.interview.status === "idle" && current.operations.length === 0
        ? projects.filter((project) => project.project_id !== current.project_id)
        : projects;
      return { projects: visible };
    }
    case "workspace_project_select": {
      if (deps.projectManager === undefined) throw new CoreError("PROJECT_MANAGER_REQUIRED", "Project manager is required", true);
      const input = parseRequest(projectSchema, parsedArguments, "PROJECT_REQUIRED");
      return deps.projectManager.select(input.project);
    }
    case "workspace_request": {
      const input = parseRequest(requestSchema, parsedArguments, "REQUEST_REQUIRED");
      return deps.projectManager === undefined
        ? await (await deps.getAgentAdapter()).request({ request: input.request, context: { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, ...(input.agent === undefined ? {} : { agent: input.agent }) })
        : await deps.projectManager.request(input.request, { actor: deps.actor, attachments: decodeAttachments(input.attachments) }, input.agent === undefined ? {} : { agent: input.agent });
    }
    default:
      return undefined;
  }
}
