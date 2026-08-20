import { DASHBOARD_PANELS_MEDIA_JS } from "./dashboard-panels-media.js";
import { DASHBOARD_PANELS_PUBLISH_JS } from "./dashboard-panels-publish.js";
import { DASHBOARD_PANELS_REVIEW_JS } from "./dashboard-panels-review.js";

export type RowScopeRule = {
  functionName: string;
  bindings: readonly string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard publish transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Dashboard publish transform found duplicate ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function useBinaryPublishDownload(source: string): string {
  const before = `      function publishFileDownload(publishId, kind) {
        return function () {
          return requestJson("/workspace/publish/download?publish_id=" + encodeURIComponent(publishId) + "&kind=" + encodeURIComponent(kind)).then(function (result) {
            if (!isRecord(result) || typeof result.content !== "string" || result.content.length === 0) {
              throw new Error("下載回應缺少檔案內容。");
            }
            var binary = atob(result.content);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            var blob = new Blob([bytes], { type: firstString(result, ["media_type"]) || "application/octet-stream" });
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url;
            a.download = firstString(result, ["filename"]) || ("card." + kind);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
            return result;
          }).catch(function (error) {
            setAreaError("publish-completion", error);
            return undefined;
          });
        };
      }`;

  const after = `      function publishFileDownload(publishId, kind) {
        return function () {
          var path = "/workspace/publish/download?publish_id=" + encodeURIComponent(publishId) + "&kind=" + encodeURIComponent(kind);
          var headers = Object.assign({ accept: "application/json, image/png, application/octet-stream" }, authHeaders());
          var requestContext = typeof projectContextSnapshot === "function" ? projectContextSnapshot() : null;
          return fetch(path, { headers: headers, credentials: "same-origin" }).then(async function (response) {
            if (requestContext !== null && typeof projectContextMatches === "function" && !projectContextMatches(requestContext)) {
              throw staleProjectContextError();
            }
            if (response.status === 401 && typeof redirectToDashboardReauthentication === "function") {
              redirectToDashboardReauthentication();
            }
            if (!response.ok) {
              var payload = {};
              try { payload = await response.json(); } catch (error) { payload = {}; }
              var message = firstString(payload, ["message_zh", "message"]) || response.statusText || "下載失敗。";
              var apiError = new Error(message);
              apiError.code = firstString(payload, ["code"]) || "HTTP_ERROR";
              apiError.status = response.status;
              throw apiError;
            }
            var blob = await response.blob();
            if (requestContext !== null && typeof projectContextMatches === "function" && !projectContextMatches(requestContext)) {
              throw staleProjectContextError();
            }
            var disposition = response.headers.get("content-disposition") || "";
            var filename = "card." + kind;
            var encoded = /filename\\*=UTF-8''([^;]+)/i.exec(disposition);
            if (encoded !== null) {
              try { filename = decodeURIComponent(encoded[1]); } catch (error) { filename = "card." + kind; }
            }
            var objectUrl = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1500);
            return { filename: filename, size: blob.size, media_type: blob.type };
          }).catch(function (error) {
            if (typeof isStaleProjectContextError === "function" && isStaleProjectContextError(error)) return undefined;
            setAreaError("publish-completion", error);
            return undefined;
          });
        };
      }`;

  return replaceExactlyOnce(source, before, after, "binary publish download");
}

export function scopeDashboardRowBindings(source: string, rules: readonly RowScopeRule[]): string {
  let output = source;
  for (const rule of rules) {
    const marker = `      function ${rule.functionName}(`;
    const start = output.indexOf(marker);
    if (start < 0) {
      throw new Error(`Dashboard row-scope function not found: ${rule.functionName}`);
    }
    const next = output.indexOf("\n\n      function ", start + marker.length);
    const end = next < 0 ? output.length : next;
    let segment = output.slice(start, end);

    for (const binding of rule.bindings) {
      const declaration = new RegExp(`\\bvar\\s+${escapeRegExp(binding)}\\s*=`, "g");
      const matches = segment.match(declaration) ?? [];
      if (matches.length !== 1) {
        throw new Error(
          `Dashboard row-scope binding ${rule.functionName}.${binding} expected once, found ${matches.length}`,
        );
      }
      segment = segment.replace(declaration, `let ${binding} =`);
    }

    output = output.slice(0, start) + segment + output.slice(end);
  }
  return output;
}

export const DASHBOARD_PANELS_MEDIA_ROW_SAFE_JS = scopeDashboardRowBindings(
  DASHBOARD_PANELS_MEDIA_JS,
  [{ functionName: "renderImageList", bindings: ["imageId"] }],
);

export const DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS = scopeDashboardRowBindings(
  useBinaryPublishDownload(DASHBOARD_PANELS_PUBLISH_JS),
  [{ functionName: "renderArtifactList", bindings: ["current", "revisions", "row"] }],
);

export const DASHBOARD_PANELS_REVIEW_ROW_SAFE_JS = scopeDashboardRowBindings(
  DASHBOARD_PANELS_REVIEW_JS,
  [{ functionName: "renderEvidence", bindings: ["candidate", "runView", "select", "reason"] }],
);
