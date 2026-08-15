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
          var message = firstString(payload, ["message", "detail"])
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

      function postJson(path, value) {
        return requestJson(path, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(value)
        });
      }

      async function loadProjects() {
        try {
          var payload = await requestJson("/workspace/projects");
          renderProjects(payload);
          return payload;
        } catch (error) {
          setAreaError("projects-message", error);
          throw error;
        }
      }

      async function loadStatus() {
        try {
          var payload = await requestJson("/workspace/status");
          renderStatus(payload);
          return payload;
        } catch (error) {
          setAreaError("status-summary", error);
          throw error;
        }
      }

      async function loadAgents() {
        try {
          var payload = await requestJson("/workspace/agents");
          renderAgents(payload);
          return payload;
        } catch (error) {
          setAreaError("agents-message", error);
          throw error;
        }
      }

      async function loadInterview() {
        try {
          var payload = await requestJson("/workspace/interview/context");
          renderInterview(payload);
          return payload;
        } catch (error) {
          setAreaError("interview-message", error);
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
        }
        setBusy(false);
      }

      async function runTask(label, task) {
        if (state.busy) return undefined;
        setBusy(true);
        setNotice("info", label + "執行中…");
        try {
          var payload = await task();
          renderLatest(label, payload);
          setNotice("success", label + "完成。");
          return payload;
        } catch (error) {
          renderLatestError(label, error);
          setNotice("error", label + "失敗；請查看最近回應/診斷區。");
          return undefined;
        } finally {
          setBusy(false);
        }
      }

      async function refreshAfterAction() {
        await Promise.allSettled([loadProjects(), loadStatus(), loadInterview(), refreshWorkflowViews()]);
      }

      function localValidation(label, message) {
        var error = new Error(message);
        error.kind = "validation";
        error.status = 400;
        error.code = "DASHBOARD_INPUT_REQUIRED";
        renderLatestError(label, error, "請先完成輸入");
        setNotice("error", message + "下一步：補齊內容後再送出。");
      }

      extractInitialToken();

`;
