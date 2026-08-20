import { afterAll, describe, expect, it } from "vitest";
import { MemoryProjectRepository } from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { DASHBOARD_SESSION_COOKIE } from "../src/dashboard-session.js";
import { createWorkspaceServer } from "../src/index.js";

const TOKEN = "audit13-dashboard-session-token";
const servers: ReturnType<typeof createWorkspaceServer>[] = [];

function cookiePair(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header).not.toBeNull();
  return (header as string).split(";", 1)[0] as string;
}

async function startServer(options: { ttlMs?: number; now?: () => number; secure?: boolean } = {}) {
  const repository = new MemoryProjectRepository(`audit13-session-${servers.length}`);
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({
    runtime,
    actor: "audit13-session-test",
    authToken: TOKEN,
    autoStartWorker: false,
    ...(options.ttlMs === undefined ? {} : { browserSessionTtlMs: options.ttlMs }),
    ...(options.now === undefined ? {} : { browserSessionNow: options.now }),
    ...(options.secure === undefined ? {} : { browserSessionSecure: options.secure }),
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

describe("#210 authenticated Dashboard browser session recovery", () => {
  it("bootstraps a short-lived HttpOnly session and reloads the cleaned URL", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      expect(bootstrap.status).toBe(200);
      const setCookie = bootstrap.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain(`${DASHBOARD_SESSION_COOKIE}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Strict");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("Max-Age=900");
      expect(setCookie).not.toContain("Secure");
      const html = await bootstrap.text();
      expect(html).not.toContain(TOKEN);
      expect(html).not.toContain("localStorage");

      const cleanReload = await fetch(`${url}/`, { headers: { cookie: cookiePair(bootstrap) } });
      expect(cleanReload.status).toBe(200);
      expect(await cleanReload.text()).toContain("來源適配工作流程");
    } finally {
      await closeServer(server);
    }
  });

  it("lets duplicate tabs share the same still-valid browser session", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      const [tabA, tabB] = await Promise.all([
        fetch(`${url}/`, { headers: { cookie } }),
        fetch(`${url}/`, { headers: { cookie } }),
      ]);
      expect(tabA.status).toBe(200);
      expect(tabB.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("expires the absolute session TTL and returns a reauthentication UI", async () => {
    let now = 10_000;
    const { server, url } = await startServer({ ttlMs: 1_000, now: () => now });
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      now += 1_001;
      const expired = await fetch(`${url}/`, { headers: { cookie } });
      expect(expired.status).toBe(401);
      expect(expired.headers.get("content-type")).toContain("text/html");
      expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await expired.text()).toContain("工作階段已過期");
    } finally {
      await closeServer(server);
    }
  });

  it("revokes the session on logout and clears the browser cookie", async () => {
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
      const revoked = await fetch(`${url}/`, { headers: { cookie } });
      expect(revoked.status).toBe(401);
      expect(await revoked.text()).toContain("無效或已撤銷");
    } finally {
      await closeServer(server);
    }
  });

  it("invalidates all browser sessions on server restart", async () => {
    const first = await startServer();
    const bootstrap = await fetch(`${first.url}/?token=${encodeURIComponent(TOKEN)}`);
    const cookie = cookiePair(bootstrap);
    await closeServer(first.server);

    const second = await startServer();
    try {
      const restored = await fetch(`${second.url}/`, { headers: { cookie } });
      expect(restored.status).toBe(401);
      expect(await restored.text()).toContain("無效或已撤銷");
    } finally {
      await closeServer(second.server);
    }
  });

  it("rejects invalid bootstrap tokens and never creates a session for them", async () => {
    const { server, url } = await startServer();
    try {
      const response = await fetch(`${url}/?token=wrong-token`);
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.text()).toContain("無效或已撤銷");
    } finally {
      await closeServer(server);
    }
  });

  it("keeps query tokens bootstrap-only even when a valid session cookie exists", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      const response = await fetch(`${url}/workspace/dashboard/data?token=${encodeURIComponent(TOKEN)}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(401);
      const body = (await response.json()) as { code: string };
      expect(body.code).toBe("UNAUTHORIZED");
    } finally {
      await closeServer(server);
    }
  });

  it("scopes browser sessions to Dashboard routes and does not authorize MCP", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      const dashboardData = await fetch(`${url}/workspace/dashboard/data`, { headers: { cookie } });
      expect(dashboardData.status).toBe(200);

      const mcp = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(mcp.status).toBe(401);
    } finally {
      await closeServer(server);
    }
  });

  it("preserves mutation Origin/CSRF checks for cookie-authenticated requests", async () => {
    const { server, url } = await startServer();
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      const cookie = cookiePair(bootstrap);
      const denied = await fetch(`${url}/workspace/request`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ request: "查看目前狀態" }),
      });
      expect(denied.status).not.toBe(200);
      const body = (await denied.json()) as { code: string };
      expect(body.code).toBe("CSRF_DENIED");

      const allowed = await fetch(`${url}/workspace/request`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ request: "查看目前狀態" }),
      });
      expect(allowed.status).toBe(200);
    } finally {
      await closeServer(server);
    }
  });

  it("marks externally served browser sessions Secure", async () => {
    const { server, url } = await startServer({ secure: true });
    try {
      const bootstrap = await fetch(`${url}/?token=${encodeURIComponent(TOKEN)}`);
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.get("set-cookie")).toContain("Secure");
    } finally {
      await closeServer(server);
    }
  });
});
