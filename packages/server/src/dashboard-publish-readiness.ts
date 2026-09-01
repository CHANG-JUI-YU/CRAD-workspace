import { DASHBOARD_LISTENERS_LEGACY_UPLOAD_JS } from "./dashboard-legacy-card-upload.js";

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard publish-readiness transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard publish-readiness transform found duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const LEGACY_READINESS_ENTRY = `      async function triggerCheckReadiness() {
        return runTask("Publish 就緒檢查", async function () {
          var modeSelect = byId("readiness-mode");
          var modeValue = modeSelect instanceof HTMLSelectElement ? modeSelect.value : "";
          var endpoint = modeValue === "" ? "/workspace/publish/preview" : "/workspace/publish/preview?mode=" + encodeURIComponent(modeValue);
          var payload = await requestJson(endpoint);
          var readinessInfo = await requestJson("/workspace/build/preview");
          if (readinessInfo) {
            updateBothModeOption(readinessInfo.modes, readinessInfo.export_modes, readinessInfo.both_blockers);
          }
          var structured = await requestJson("/workspace/dashboard/publish-diagnostics");
          renderPublishDiagnostics(structured);
          var hasBlocking = structured && Array.isArray(structured.rows) && structured.rows.some(function (r) { return r.severity === "error"; });
          updatePublishStepper("readiness", hasBlocking ? "blocked" : "pass");
          return payload;
        });
      }`;

const REVISION_SAFE_READINESS_ENTRY = `      async function triggerCheckReadiness() {
        return runTask("Publish 就緒檢查", async function () {
          var modeSelect = byId("readiness-mode");
          var modeValue = modeSelect instanceof HTMLSelectElement ? modeSelect.value : "";
          var endpoint = modeValue === "" ? "/workspace/publish/readiness" : "/workspace/publish/readiness?mode=" + encodeURIComponent(modeValue);
          var snapshot;
          try {
            snapshot = await requestJson(endpoint);
          } catch (error) {
            if (error && error.code === "PUBLISH_READINESS_SNAPSHOT_STALE") {
              currentProvenanceConfirmation = null;
              var confirmButton = byId("confirm-publish");
              if (confirmButton) confirmButton.disabled = true;
              await Promise.allSettled([loadDashboardData()]);
              var messageEl = byId("provenance-confirm-message");
              if (messageEl) messageEl.textContent = "發布就緒狀態在檢查期間發生變更，已重新載入最新 project revision；請再次執行就緒檢查。";
              updatePublishStepper("readiness", "stale");
            }
            throw error;
          }
          var payload = snapshot && snapshot.publish;
          var readinessInfo = snapshot && snapshot.build;
          if (readinessInfo) {
            updateBothModeOption(readinessInfo.modes, readinessInfo.export_modes, readinessInfo.both_blockers);
          }
          var structured = snapshot && snapshot.diagnostics;
          renderPublishDiagnostics(structured);
          var hasBlocking = structured && Array.isArray(structured.rows) && structured.rows.some(function (r) { return r.severity === "error"; });
          updatePublishStepper("readiness", hasBlocking ? "blocked" : "pass");
          return snapshot;
        });
      }`;

export const DASHBOARD_LISTENERS_REVISION_SAFE_JS = replaceExactlyOnce(
  DASHBOARD_LISTENERS_LEGACY_UPLOAD_JS,
  LEGACY_READINESS_ENTRY,
  REVISION_SAFE_READINESS_ENTRY,
  "triggerCheckReadiness",
);
