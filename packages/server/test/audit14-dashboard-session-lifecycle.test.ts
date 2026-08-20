import { afterAll, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { dashboard } from "../src/dashboard.js";
import { DASHBOARD_API_SESSION_SAFE_JS } from "../src/dashboard-session-client.js";
import { DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS } from "../src/dashboard-row-scope.js";
import { DASHBOARD_SESSION_COOKIE } from "../src/dashboard-session.js";
import { createWorkspaceServer } from "../src/index.js";

const TOKEN = "audit14-dashboard-session-token";
const servers: ReturnType<typeof createWorkspaceServer>[] = [];

function cookiePair(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header).not.toBeNull();
  return (header as string).split(";", 1)[0] as string;
}

async function startServer(options: { ttlMs?: number; now?: () => number; auth?: boolean } = {}) {
  const repository = new MemoryProjectRepository(`audit14-session-${servers.length}`);
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({
    runtime,
    actor: "audit14-session-test",
    autoStartWorker: false,
    ...(options.auth === false ? {} : { authToken: TOKEN }),
    ...(options.ttlMs === undefined ? {} : { browserSessionTtlMs: options.ttlMs }),
    ...(options.now === undefined ? {} : { browserSessionNow: options.now }),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected numeric server address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: ReturnType<typeof createWorkspaceServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterAll(async () => {
  await Promise.all(servers.map(closeServer));
});

describe("#234 Dashboard browser session lifecycle", () => {
  it("renders a cookie-only browser client without retaining the bootstrap bearer", () => {
    expect(DASHBOARD_API_SESSION_SAFE_JS).not.toContain("dashboardAuthToken");
    expect(DASHBOARD_API_SESSION_SAFE_JS).not.toContain('Authorization: "Bearer "');
    expect(DASHBOARD_API_SESSION_SAFE_JS).not.toContain('headers.Authorization = "Bearer "');
    expect(DASHBOARD_API_SESSION_SAFE_JS).toContain('credentials: "same-origin"');
    expect(DASHBOARD_API_SESSION_SAFE_JS).toContain('window.location.replace("/")');
    expect(DASHBOARD_API_SESSION_SAFE_JS).toContain('logoutButton.textContent = "登出"');
    expect(DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS).toContain('credentials: "same-origin"');
    expect(DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS).toContain('response.status === 401');
    expect(DASHBOARD_PANELS_PUBLISH_ROW_SAFE_JS).toContain("redirectToDashboardReauthentication");

    const protectedHtml = dashboard({ authenticationRequired: true });
    expect(protectedHtml).toContain("var dashboardAuthenticationEnabled = true;");
    expect(protectedHtml).not.toContain("dashboardAuthToken");

    const localHtml = dashboard();
    expect(localHtml).toContain("var dashboardAuthenticationEnabled = false;");
  });

  it("bootstraps once and then authorizes Dashboard API calls with only the HttpOnly session cookie", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.get("set-cookie")).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
      const html = await bootstrap.text();
      expect(html).not.toContain(TOKEN);
      expect(html).not.toContain("dashboardAuthToken");
      expect(html).toContain("var dashboardAuthenticationEnabled = true;");

      const cookie = cookiePair(bootstrap);
      const api = await fetch(`${url}/workspace/dashboard/data`, { headers: { cookie } });
      expect(api.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("makes logout terminate the same browser session instead of falling back to a bearer", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);

      const logout = await fetch(`${url}/workspace/auth/logout`, {
        method: "POST",
        headers: { cookie, "X-Requested-With": "XMLHttpRequest" },
      });
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

      const sameTabApi = await fetch(`${url}/workspace/dashboard/data`, { headers: { cookie } });
      expect(sameTabApi.status).toBe(401);
      const body = (await sameTabApi.json()) as { code: string };
      expect(body.code).toBe("UNAUTHORIZED");
    } finally {
      await closeServer(server);
    }
  });

  it("expires an already-open browser session at the absolute TTL for subsequent API calls", async () => {
    let now = 50_000;
    const { server, url } = await startServer({ ttlMs: 1_000, now: () => now });
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      now += 1_001;

      const expired = await fetch(`${url}/workspace/dashboard/data`, { headers: { cookie } });
      expect(expired.status).toBe(401);
      expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
    } finally {
      await closeServer(server);
    }
  });

  it("preserves explicit bearer authentication for non-browser API callers", async () => {
    const { server, url } = await startServer();
    try {
      const api = await fetch(`${url}/workspace/dashboard/data`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(api.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("does not advertise an authenticated browser session in auth-disabled local mode", async () => {
    const { server, url } = await startServer({ auth: false });
    try {
      const response = await fetch(`${url}/`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("var dashboardAuthenticationEnabled = false;");
    } finally {
      await closeServer(server);
    }
  });
});
