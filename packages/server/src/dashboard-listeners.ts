export const DASHBOARD_LISTENERS_JS = `      function postOperation(action, operationId) {
        void runTask(action === "recover" ? "重試 operation" : "取消 operation", async function () {
          var payload = await postJson("/workspace/operation/" + action, { operation_id: operationId });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function applyQuality() {
        if (state.busy) return;
        var level = byId("quality-level").value;
        var overrides = {};
        var codes = Object.keys(currentOverrides);
        for (var i = 0; i < codes.length; i += 1) overrides[codes[i]] = currentOverrides[codes[i]];
        void runTask("套用品質設定", async function () {
          var payload = await postJson("/workspace/quality/profile", { level: level, overrides: overrides });
          await Promise.allSettled([loadDashboardData()]);
          return payload;
        });
      }

      function runRepair() {
        void runTask("執行修復", async function () {
          var payload = await postJson("/workspace/repair/run", { plan_hash: repairPlanHash });
          renderRepairReport(payload);
          return payload;
        });
      }

      function createNewProject() {
        if (state.busy) return;
        void runTask("建立新專案", async function () {
          var payload = await postJson("/workspace/project/new", {});
          await refreshAfterAction();
          return payload;
        });
      }

      function revealProjectPanel() {
        var panel = byId("project-panel");
        if (panel) {
          panel.hidden = false;
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        var select = byId("project-select");
        if (select) select.focus();
      }

      function legacyReviewEntry() {
        revealProjectPanel();
        setNotice("info", "舊卡審核：請先選擇或建立專案，再於結構化訪談中選擇「舊卡審核」。");
      }

      byId("operation-filter").addEventListener("change", function () {
        renderOperationList(cachedOperations);
      });
      byId("load-artifacts").addEventListener("click", function () {
        void runTask("載入 Artifact", loadArtifactData);
      });
      byId("load-issues").addEventListener("click", function () {
        void runTask("載入 Issues", loadIssueData);
      });
      byId("load-source-facts").addEventListener("click", function () {
        void runTask("載入來源與事實", loadSourceFactData);
      });
      byId("load-operations").addEventListener("click", function () {
        void runTask("載入 Operations", loadOperationData);
      });
      byId("check-readiness").addEventListener("click", function () {
        void runTask("Publish 就緒檢查", async function () {
          var modeSelect = byId("readiness-mode");
          var modeValue = modeSelect instanceof HTMLSelectElement ? modeSelect.value : "";
          var endpoint = modeValue === "" ? "/workspace/publish/preview" : "/workspace/publish/preview?mode=" + encodeURIComponent(modeValue);
          var payload = await requestJson(endpoint);
          var structured = await requestJson("/workspace/dashboard/publish-diagnostics");
          renderPublishDiagnostics(structured);
          renderProvenanceSummary(payload.provenance_summary);
          return payload;
        });
      });
      byId("check-build").addEventListener("click", function () {
        void runTask("打包預覽", async function () {
          var payload = await requestJson("/workspace/build/preview");
          renderBuildReadiness(payload);
          return payload;
        });
      });
      byId("check-tavern").addEventListener("click", function () {
        void runTask("Tavern 相容性", async function () {
          var payload = await requestJson("/workspace/tavern/compat");
          renderTavern(payload);
          return payload;
        });
      });
      byId("repair-preview").addEventListener("click", function () {
        void runTask("修復檢查", async function () {
          var payload = await requestJson("/workspace/repair/preview");
          renderRepairInspection(payload);
          return payload;
        });
      });
      byId("repair-run").addEventListener("click", runRepair);
      byId("apply-quality").addEventListener("click", applyQuality);
      byId("add-quality-override").addEventListener("click", addQualityOverride);
      byId("submit-image").addEventListener("click", submitImage);
      byId("image-file").addEventListener("change", renderCropPreview);
      byId("image-ratio").addEventListener("change", renderCropPreview);
      byId("refresh").addEventListener("click", function () { void refresh(); });
      byId("submit-request").addEventListener("click", submitRequest);
      byId("select-project").addEventListener("click", selectProject);
      byId("new-project").addEventListener("click", createNewProject);
      byId("home-new-project").addEventListener("click", createNewProject);
      byId("home-open-project").addEventListener("click", revealProjectPanel);
      byId("home-legacy-review").addEventListener("click", legacyReviewEntry);
      byId("interview-target-submit").addEventListener("click", function () {
        submitInterviewAnswer(byId("interview-target-select").value);
      });
      byId("submit-interview").addEventListener("click", function () {
        submitInterviewAnswer(byId("interview-answer-input").value);
      });
      byId("project-select").addEventListener("change", updateControls);
      byId("load-coverage").addEventListener("click", function () { void runTask("載入覆蓋", loadCoverageData); });
      byId("load-coverage").addEventListener("click", function () { void runTask("載入覆蓋矩陣", loadCoverageCenterData); });
      byId("load-workflow").addEventListener("click", function () { void runTask("載入工作流程", loadWorkflowData); });
      void refresh();
`;
