import { DASHBOARD_API_PROJECT_SAFE_JS } from "./dashboard-project-context.js";

function replaceExactlyOnce(source: string, before: string, after: string, label: string): string {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Dashboard session transform missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard session transform found duplicate ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function useCookieOnlyBrowserSession(source: string): string {
  let output = replaceExactlyOnce(
    source,
    `      var dashboardAuthToken = null;

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
      }`,
    `      var dashboardReauthenticationPending = false;

      function extractInitialToken() {
        var search = new URLSearchParams(window.location.search || "");
        if (search.has("token") && window.history && window.history.replaceState) {
          window.history.replaceState(null, "", window.location.pathname + window.location.hash);
        }
      }

      function authHeaders() {
        return {};
      }

      function redirectToDashboardReauthentication() {
        if (typeof dashboardAuthenticationEnabled === "undefined" || dashboardAuthenticationEnabled !== true) return;
        if (dashboardReauthenticationPending) return;
        dashboardReauthenticationPending = true;
        window.location.replace("/");
      }

      async function logoutDashboard() {
        var logoutButton = byId("logout");
        if (logoutButton) {
          logoutButton.disabled = true;
          logoutButton.setAttribute("aria-busy", "true");
        }
        try {
          var response = await fetch("/workspace/auth/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
          });
          if (response.status === 401) {
            redirectToDashboardReauthentication();
            return;
          }
          if (!response.ok) {
            throw new Error(response.statusText || "登出失敗");
          }
          redirectToDashboardReauthentication();
        } catch (error) {
          if (logoutButton) {
            logoutButton.disabled = false;
            logoutButton.removeAttribute("aria-busy");
          }
          setNotice("error", "登出失敗；目前工作階段可能仍有效，請重新嘗試。");
        }
      }

      function installDashboardLogoutControl() {
        if (typeof dashboardAuthenticationEnabled === "undefined" || dashboardAuthenticationEnabled !== true) return;
        var refreshButton = byId("refresh");
        if (!refreshButton || byId("logout")) return;
        var parent = refreshButton.parentNode;
        if (!parent) return;
        var actions = document.createElement("div");
        actions.className = "header-status-line";
        parent.insertBefore(actions, refreshButton);
        actions.appendChild(refreshButton);
        var logoutButton = document.createElement("button");
        logoutButton.id = "logout";
        logoutButton.type = "button";
        logoutButton.textContent = "登出";
        logoutButton.setAttribute("aria-label", "登出 Dashboard");
        logoutButton.addEventListener("click", function () { void logoutDashboard(); });
        actions.appendChild(logoutButton);
      }`,
    "bootstrap bearer removal",
  );

  output = replaceExactlyOnce(
    output,
    `        for (var headerName in callerHeaders) {
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
        headers["X-Requested-With"] = "XMLHttpRequest";`,
    `        for (var headerName in callerHeaders) {
          if (Object.prototype.hasOwnProperty.call(callerHeaders, headerName) && headerName.toLowerCase() !== "authorization") {
            headers[headerName] = callerHeaders[headerName];
          }
        }
        headers["X-Requested-With"] = "XMLHttpRequest";`,
    "request bearer removal",
  );

  output = replaceExactlyOnce(
    output,
    `          response = await fetch(path, Object.assign({}, opts, { headers: headers }));`,
    `          response = await fetch(path, Object.assign({}, opts, { headers: headers, credentials: "same-origin" }));`,
    "cookie credentials",
  );

  output = replaceExactlyOnce(
    output,
    `          if (typeof payload.operation_id === "string") { apiError.operation_id = payload.operation_id; }
          throw apiError;`,
    `          if (typeof payload.operation_id === "string") { apiError.operation_id = payload.operation_id; }
          if (response.status === 401) {
            redirectToDashboardReauthentication();
          }
          throw apiError;`,
    "401 reauthentication",
  );

  output = replaceExactlyOnce(
    output,
    `      function setProtectedImageSource(img, endpoint) {
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
      }`,
    `      function setProtectedImageSource(img, endpoint) {
        fetch(endpoint, { credentials: "same-origin" })
          .then(function (response) {
            if (response.status === 401) {
              redirectToDashboardReauthentication();
              throw new Error("image session expired");
            }
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
      }`,
    "protected image cookie session",
  );

  output = replaceExactlyOnce(
    output,
    `      extractInitialToken();
      startOperationMonitoring();`,
    `      extractInitialToken();
      installDashboardLogoutControl();
      startOperationMonitoring();`,
    "logout control startup",
  );

  if (output.includes("dashboardAuthToken")) {
    throw new Error("Dashboard session transform left dashboardAuthToken in production output");
  }
  return output;
}

export const DASHBOARD_API_SESSION_SAFE_JS = useCookieOnlyBrowserSession(DASHBOARD_API_PROJECT_SAFE_JS);
