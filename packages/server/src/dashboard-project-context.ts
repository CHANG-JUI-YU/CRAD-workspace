import { DASHBOARD_API_JS } from "./dashboard-api.js";
import { DASHBOARD_PANELS_MEDIA_ROW_SAFE_JS } from "./dashboard-row-scope.js";

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard project-context transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard project-context transform found duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function makeProjectSafeApi(source: string): string {
  let output = replaceExactlyOnce(
    source,
    "      async function requestJson(path, options) {",
    `      function projectContextSnapshot() {
        return { generation: state.projectGeneration, project: state.currentProjectValue || "" };
      }

      function projectContextMatches(snapshot) {
        return snapshot !== null
          && snapshot.generation === state.projectGeneration
          && snapshot.project === (state.currentProjectValue || "");
      }

      function staleProjectContextError() {
        var error = new Error("Project context changed while the request was in flight");
        error.kind = "stale_project_context";
        error.code = "DASHBOARD_STALE_PROJECT_CONTEXT";
        error.status = 0;
        error.staleProjectContext = true;
        return error;
      }

      function isStaleProjectContextError(error) {
        return error !== null && error !== undefined
          && (error.staleProjectContext === true || error.code === "DASHBOARD_STALE_PROJECT_CONTEXT");
      }

      function projectRequestIsScoped(path) {
        var pathname = String(path || "").split("?")[0];
        return pathname !== "/workspace/projects"
          && pathname !== "/workspace/project/select"
          && pathname !== "/workspace/project/new";
      }

      async function requestJson(path, options) {`,
    "requestJson context helpers",
  );

  output = replaceExactlyOnce(
    output,
    '        var opts = options || { headers: { accept: "application/json" } };',
    '        var opts = options || { headers: { accept: "application/json" } };\n        var requestContext = projectRequestIsScoped(path) ? projectContextSnapshot() : null;',
    "requestJson context capture",
  );

  output = replaceExactlyOnce(
    output,
    `        } catch (error) {
          var networkError = new Error("無法連線到本機 server");`,
    `        } catch (error) {
          if (requestContext !== null && !projectContextMatches(requestContext)) {
            throw staleProjectContextError();
          }
          var networkError = new Error("無法連線到本機 server");`,
    "network stale guard",
  );

  output = replaceExactlyOnce(
    output,
    "        var raw = await response.text();",
    `        var raw = await response.text();
        if (requestContext !== null && !projectContextMatches(requestContext)) {
          throw staleProjectContextError();
        }`,
    "response stale guard",
  );

  output = replaceExactlyOnce(
    output,
    `        } catch (error) {
          renderLatestError(label, error);
          setNotice("error", label + "失敗；請查看最近回應/診斷區。");`,
    `        } catch (error) {
          if (isStaleProjectContextError(error)) {
            return { ok: false, status: "stale_project_context" };
          }
          renderLatestError(label, error);
          setNotice("error", label + "失敗；請查看最近回應/診斷區。");`,
    "runTask stale handling",
  );

  output = replaceExactlyOnce(
    output,
    `          typeof loadDashboardData === "function" ? loadDashboardData() : Promise.resolve(),
          typeof loadWorkflowData === "function" ? loadWorkflowData() : Promise.resolve(),
          typeof loadCoverageCenterData === "function" ? loadCoverageCenterData() : Promise.resolve()`,
    `          typeof loadDashboardData === "function" ? loadDashboardData() : Promise.resolve(),
          typeof loadWorkflowData === "function" ? loadWorkflowData() : Promise.resolve(),
          typeof loadCoverageCenterData === "function" ? loadCoverageCenterData() : Promise.resolve(),
          typeof loadProvenanceHistory === "function" ? loadProvenanceHistory() : Promise.resolve()`,
    "transition coordinated loaders",
  );

  return output;
}

function makeProjectSafeMedia(source: string): string {
  return replaceExactlyOnce(
    source,
    `          void refreshWorkflowViews();
          void loadProvenanceHistory();`,
    "",
    "nested dashboard refreshes",
  );
}

export const DASHBOARD_API_PROJECT_SAFE_JS = makeProjectSafeApi(DASHBOARD_API_JS);
export const DASHBOARD_PANELS_MEDIA_PROJECT_SAFE_JS = makeProjectSafeMedia(DASHBOARD_PANELS_MEDIA_ROW_SAFE_JS);

export const DASHBOARD_PROJECT_CONTEXT_JS = `
var baseResetProjectScopedState = resetProjectScopedState;
var baseSetAreaError = setAreaError;
var baseRenderLatestError = renderLatestError;

setAreaError = function (areaId, error) {
  if (typeof isStaleProjectContextError === "function" && isStaleProjectContextError(error)) return;
  return baseSetAreaError(areaId, error);
};

renderLatestError = function (label, error, summary) {
  if (typeof isStaleProjectContextError === "function" && isStaleProjectContextError(error)) return;
  return baseRenderLatestError(label, error, summary);
};

resetProjectScopedState = function () {
  baseResetProjectScopedState();

  state.status = null;
  state.interviewQuestion = null;
  state.interviewRevision = 0;
  state.amendQuestionId = null;
  state.amendPreview = null;
  state.amendInFlight = false;
  state.actionBusy = {};

  if (typeof currentWorkflow !== "undefined") currentWorkflow = null;
  if (typeof currentInvalidations !== "undefined") currentInvalidations = null;
  if (typeof currentLatestReviewRun !== "undefined") currentLatestReviewRun = null;
  if (typeof currentProvenanceConfirmation !== "undefined") currentProvenanceConfirmation = null;
  if (typeof cachedOperations !== "undefined") cachedOperations = [];
  if (typeof currentOverrides !== "undefined") currentOverrides = {};
  if (typeof repairPlanHash !== "undefined") repairPlanHash = "";

  var projectScopedContainers = [
    "status-summary", "kpi-list", "status-fields", "status-json", "current-project",
    "interview-message", "interview-question", "interview-choices", "interview-history", "amend-impact", "amend-message",
    "prechecks-message", "precheck-matrix", "latest-summary", "latest-json", "latest-recovery",
    "source-fact-message", "source-list", "fact-list", "fact-review-message", "fact-review-runs", "fact-review-evidence",
    "coverage-center-message", "coverage-center", "research-monitor",
    "workflow-message", "workflow-stages", "workflow-invalidations",
    "artifact-message", "artifact-list", "blueprint-json",
    "quality-message", "quality-issues", "quality-overrides",
    "readiness-message", "readiness-list", "provenance-summary", "provenance-stale-diff", "provenance-confirm-message", "provenance-history", "publish-completion",
    "build-message", "build-summary", "operation-message", "operation-list", "operation-last-updated",
    "repair-message", "repair-list", "tavern-message", "tavern-summary", "image-message", "image-list"
  ];
  for (var i = 0; i < projectScopedContainers.length; i += 1) {
    var node = typeof byId === "function" ? byId(projectScopedContainers[i]) : null;
    if (node !== null) node.textContent = "";
  }

  var textInputs = ["request-input", "interview-answer-input", "amend-answer-input", "image-source", "image-license"];
  for (var j = 0; j < textInputs.length; j += 1) {
    var input = typeof byId === "function" ? byId(textInputs[j]) : null;
    if (input !== null && "value" in input) input.value = "";
  }

  var amendArea = typeof byId === "function" ? byId("amend-area") : null;
  if (amendArea !== null) amendArea.hidden = true;
  var externalNotice = typeof byId === "function" ? byId("external-change-notice") : null;
  if (externalNotice !== null) externalNotice.hidden = true;
  var cropPreview = typeof byId === "function" ? byId("image-crop-preview") : null;
  if (cropPreview !== null) {
    cropPreview.textContent = "";
    cropPreview.hidden = true;
  }
};
`;
