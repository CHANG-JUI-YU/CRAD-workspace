export const DASHBOARD_API_JS = `      var dashboardAuthToken = null;

      function extractInitialToken() {
        var search = new URLSearchParams(window.location.search || "");
        var token = search.get("token");
        if (token !== null && token !== "") {
          dashboardAuthToken = token;
          if (window.history && window.history.replaceState) {
            window.history.replaceState(null, "", window.location.pathname + window.location.hash);
          }
        }
      }

      function authHeaders() {
        return dashboardAuthToken === null ? {} : { Authorization: "Bearer " + dashboardAuthToken };
      }

      async function requestJson(path, options) {
        var opts = options || { headers: { accept: "application/json" } };
        var headers = {};
        var callerHeaders = opts.headers || {};
        for (var headerName in callerHeaders) {
          if (Object.prototype.hasOwnProperty.call(callerHeaders, headerName)) {
            headers[headerName] = callerHeaders[headerName];
          }
        }
        var hasAuthorization = Object.keys(headers).some(function (headerName) {
          return headerName.toLowerCase() === "authorization";
        });
        if (dashboardAuthToken !== null && !hasAuthorization) {
          headers.Authorization = "Bearer " + dashboardAuthToken;
        }
        headers["X-Requested-With"] = "XMLHttpRequest";
        var response;
        try {
          response = await fetch(path, Object.assign({}, opts, { headers: headers }));
        } catch (error) {
          var networkError = new Error("無法連線到本機 server");
          networkError.kind = "network";
          networkError.code = "NETWORK_ERROR";
          networkError.status = 0;
          throw networkError;
        }
        var raw = await response.text();
        var payload;
        try {
          payload = raw.length > 0 ? JSON.parse(raw) : {};
        } catch (error) {
          payload = { raw: raw };
        }
        if (!response.ok) {
          var errorValue = isRecord(payload) ? payload.error : undefined;
          var code = firstString(payload, ["code", "error_code"])
            || (typeof errorValue === "string" ? errorValue : "")
            || (isRecord(errorValue) ? firstString(errorValue, ["code", "error_code"]) : "");
          var message = firstString(payload, ["message_zh", "message", "detail"])
            || (typeof errorValue === "string" ? errorValue : "")
            || (isRecord(errorValue) ? firstString(errorValue, ["message", "detail"]) : "")
            || response.statusText
            || "伺服器拒絕了這次請求";
          var apiError = new Error(message);
          apiError.kind = "http";
          apiError.code = code || "HTTP_ERROR";
          apiError.status = response.status;
          apiError.statusText = response.statusText;
          apiError.payload = payload;
          if (isRecord(payload.details)) { apiError.details = payload.details; }
          if (typeof payload.impact === "string") { apiError.impact = payload.impact; }
          if (Array.isArray(payload.next_actions)) { apiError.next_actions = payload.next_actions; }
          if (typeof payload.operation_id === "string") { apiError.operation_id = payload.operation_id; }
          throw apiError;
        }
        return payload;
      }

      function setProtectedImageSource(img, endpoint) {
        if (dashboardAuthToken === null) {
          img.setAttribute("src", endpoint);
          return;
        }
        fetch(endpoint, { headers: { Authorization: "Bearer " + dashboardAuthToken } })
          .then(function (response) {
            if (!response.ok) throw new Error("image request failed: " + response.status);
            return response.blob();
          })
          .then(function (blob) {
            var objectUrl = URL.createObjectURL(blob);
            img.setAttribute("src", objectUrl);
            img.onload = function () { URL.revokeObjectURL(objectUrl); };
            img.onerror = function () { URL.revokeObjectURL(objectUrl); };
          })
          .catch(function () {
            img.removeAttribute("src");
          });
      }

      function postJson(path, value, extraHeaders) {
        return requestJson(path, {
          method: "POST",
          headers: Object.assign({ "content-type": "application/json", accept: "application/json" }, extraHeaders || {}),
          body: JSON.stringify(value)
        });
      }

      async function loadProjects() {
        var gen = state.projectGeneration;
        try {
          var payload = await requestJson("/workspace/projects");
          if (gen !== state.projectGeneration) return payload;
          renderProjects(payload);
          return payload;
        } catch (error) {
          if (gen === state.projectGeneration) {
            setAreaError("projects-message", error);
          }
          throw error;
        }
      }

      async function loadStatus() {
        var gen = state.projectGeneration;
        try {
          var payload = await requestJson("/workspace/status");
          if (gen !== state.projectGeneration) return payload;
          renderStatus(payload);
          if (typeof operationMonitorWake === "function") operationMonitorWake();
          return payload;
        } catch (error) {
          if (gen === state.projectGeneration) {
            setAreaError("status-summary", error);
          }
          throw error;
        }
      }

      async function loadAgents() {
        var gen = state.projectGeneration;
        try {
          var payload = await requestJson("/workspace/agents");
          if (gen !== state.projectGeneration) return payload;
          renderAgents(payload);
          return payload;
        } catch (error) {
          if (gen === state.projectGeneration) {
            setAreaError("agents-message", error);
          }
          throw error;
        }
      }

      async function loadInterview() {
        var gen = state.projectGeneration;
        try {
          var payload = await requestJson("/workspace/interview/context");
          if (gen !== state.projectGeneration) return payload;
          renderInterview(payload);
          return payload;
        } catch (error) {
          if (gen === state.projectGeneration) {
            setAreaError("interview-message", error);
          }
          throw error;
        }
      }

      async function refresh() {
        if (state.busy) return;
        setBusy(true);
        setNotice("info", "重新整理中…");
        var outcomes = await Promise.allSettled([loadStatus()]);
        var statusFailed = outcomes[0].status === "rejected" || state.sessionUnselected === undefined;
        if (statusFailed) {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects(), loadAgents(), loadInterview(), loadDashboardData()]));
        } else if (state.sessionUnselected) {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects()]));
        } else {
          outcomes = outcomes.concat(await Promise.allSettled([loadProjects(), loadAgents(), loadInterview(), loadDashboardData()]));
        }
        var failures = outcomes.filter(function (outcome) { return outcome.status === "rejected"; });
        if (failures.length > 0) {
          renderLatestError("重新整理", failures[0].reason, "重新整理有 " + failures.length + " 個區塊失敗");
          setNotice("error", "部分資料更新失敗；請查看最近回應/診斷區。");
        } else {
          renderLatest("重新整理", { status: "completed", summary: "專案、狀態、Agent 與訪談資料已更新。" });
          setNotice("success", "資料已更新。");
          if (typeof updateLastUpdated === "function") updateLastUpdated();
        }
        if (typeof applySectionVisibility === "function" && typeof activeSection !== "undefined") {
          applySectionVisibility(activeSection);
        }
        setBusy(false);
      }

      async function runTask(label, task, busyKey) {
        if (state.busy) {
          setNotice("warning", "系統忙碌中，請等待前一項操作完成。");
          return { ok: false, status: "busy_rejected", reason: "系統忙碌中" };
        }
        var scopedBusy = busyKey !== undefined && busyKey !== null;
        if (scopedBusy) {
          setActionBusy(busyKey, true);
        } else {
          setBusy(true);
        }
        setNotice("info", label + "執行中…");
        try {
          var payload = await task();
          renderLatest(label, payload);
          setNotice("success", label + "完成。");
          if (typeof updateLastUpdated === "function") updateLastUpdated();
          return payload;
        } catch (error) {
          renderLatestError(label, error);
          setNotice("error", label + "失敗；請查看最近回應/診斷區。");
          return { ok: false, status: "failed", error: error };
        } finally {
          if (scopedBusy) {
            setActionBusy(busyKey, false);
          } else {
            setBusy(false);
          }
        }
      }

      async function transitionProjectContext(newProject) {
        var generation = ++state.projectGeneration;
        state.currentProjectValue = newProject || "";
        if (typeof resetProjectScopedState === "function") {
          resetProjectScopedState();
        }
        if (typeof syncAllControls === "function") syncAllControls();
        if (typeof applySectionVisibility === "function" && typeof activeSection !== "undefined") {
          applySectionVisibility(activeSection);
        }

        var outcomes = await Promise.allSettled([
          loadStatus(),
          loadProjects(),
          loadAgents(),
          loadInterview(),
          typeof loadDashboardData === "function" ? loadDashboardData() : Promise.resolve(),
          typeof loadWorkflowData === "function" ? loadWorkflowData() : Promise.resolve(),
          typeof loadCoverageCenterData === "function" ? loadCoverageCenterData() : Promise.resolve()
        ]);
        if (generation !== state.projectGeneration) {
          return outcomes;
        }
        if (typeof syncAllControls === "function") syncAllControls();
        if (typeof applySectionVisibility === "function" && typeof activeSection !== "undefined") {
          applySectionVisibility(activeSection);
        }
        return outcomes;
      }

      async function refreshAfterAction() {
        var gen = state.projectGeneration;
        await Promise.allSettled([
          loadProjects(),
          loadStatus(),
          loadInterview(),
          typeof refreshWorkflowViews === "function" ? refreshWorkflowViews() : Promise.resolve()
        ]);
        if (gen === state.projectGeneration) {
          if (typeof applySectionVisibility === "function" && typeof activeSection !== "undefined") {
            applySectionVisibility(activeSection);
          }
        }
      }

      function localValidation(label, message) {
        var error = new Error(message);
        error.kind = "validation";
        error.status = 400;
        error.code = "DASHBOARD_INPUT_REQUIRED";
        renderLatestError(label, error, "請先完成輸入");
        setNotice("error", message + "下一步：補齊內容後再送出。");
      }

      var operationMonitorTimer = null;
      var operationMonitorRunning = false;
      var operationMonitorActive = false;
      var operationMonitorInFlight = false;

      function operationMonitorClearTimer() {
        if (operationMonitorTimer !== null) {
          clearTimeout(operationMonitorTimer);
          operationMonitorTimer = null;
        }
      }

      function operationMonitorSchedule() {
        operationMonitorClearTimer();
        if (!operationMonitorActive) return;
        operationMonitorTimer = setTimeout(function () {
          operationMonitorTimer = null;
          operationMonitorTick();
        }, operationMonitorRunning ? 3000 : 12000);
      }

      function operationMonitorWake() {
        operationMonitorClearTimer();
        operationMonitorTick();
      }

      function operationMonitorTick() {
        if (!operationMonitorActive || operationMonitorInFlight) return;
        if (state.sessionUnselected !== false) {
          operationMonitorRunning = false;
          operationMonitorSchedule();
          return;
        }
        if (document.hidden || (typeof navigator !== "undefined" && navigator.onLine === false)) {
          operationMonitorSchedule();
          return;
        }
        var projectGeneration = state.projectGeneration;
        operationMonitorInFlight = true;
        requestJson("/workspace/dashboard/operations?limit=50").then(function (page) {
          if (projectGeneration !== state.projectGeneration) return;
          var items = page && Array.isArray(page.items) ? page.items : [];
          var runningCount = 0;
          for (var i = 0; i < items.length; i++) {
            var status = items[i] && items[i].status;
            if (status === "running" || status === "resolving" || status === "created") runningCount += 1;
          }
          operationMonitorRunning = runningCount > 0;
          renderOperationList(items);
          var updated = byId("operation-last-updated");
          if (updated) updated.textContent = "最後更新：" + new Date().toLocaleTimeString();
          if (typeof updateLastUpdated === "function") updateLastUpdated();
        }).catch(function () {}).finally(function () {
          operationMonitorInFlight = false;
          operationMonitorSchedule();
        });
      }

      function startOperationMonitoring() {
        if (operationMonitorActive) return;
        operationMonitorActive = true;
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) operationMonitorWake();
        });
        if (typeof window !== "undefined") {
          window.addEventListener("online", function () {
            operationMonitorWake();
          });
        }
        operationMonitorTick();
      }

      extractInitialToken();
      startOperationMonitoring();

`;
