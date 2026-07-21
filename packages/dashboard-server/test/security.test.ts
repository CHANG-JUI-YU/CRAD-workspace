import { describe, expect, it } from "vitest";

import { createDashboardServer } from "../src/index.js";

const bootstrap = "b".repeat(48);
const context = { workspaceRoot: "C:/workspace", projectsRoot: "C:/workspace/projects", exportsRoot: "C:/workspace/exports" };
const headers = { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" };

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

describe("dashboard security", () => {
  it("exchanges a one-time bootstrap token and enforces csrf", async () => {
    const { app } = createDashboardServer({ context, bootstrapToken: bootstrap });
    const response = await app.inject({ method: "POST", url: "/api/session/bootstrap", headers, payload: { token: bootstrap } });
    expect(response.statusCode).toBe(200);
    const cookie = firstHeader(response.headers["set-cookie"]).split(";")[0] ?? "";
    const csrf = response.json<{ data: { csrf_token: string } }>().data.csrf_token;
    expect(cookie).toMatch(/^cw_session=/);
    expect((await app.inject({ method: "POST", url: "/api/session/bootstrap", headers, payload: { token: bootstrap } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/session", headers: { host: headers.host, cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/unknown", headers: { ...headers, cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/unknown", headers: { ...headers, cookie, "x-csrf-token": csrf } })).statusCode).toBe(404);
    await app.close();
  });

  it("rejects non-loopback hosts and mismatched origins", async () => {
    const { app } = createDashboardServer({ context, bootstrapToken: bootstrap });
    expect((await app.inject({ method: "GET", url: "/api/health", headers: { host: "localhost:3210" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/session/bootstrap", headers: { host: headers.host, origin: "http://evil.test" }, payload: { token: bootstrap } })).statusCode).toBe(403);
    await app.close();
  });

  it("rejects oversized bodies before route logic", async () => {
    const { app } = createDashboardServer({ context, bootstrapToken: bootstrap });
    const response = await app.inject({ method: "POST", url: "/api/session/bootstrap", headers, payload: { token: "x".repeat(2 * 1024 * 1024 + 1) } });
    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it("protects plugin decision routes with the dashboard session and CSRF", async () => {
    const { app } = createDashboardServer({ context, bootstrapToken: bootstrap });
    const unauthenticated = await app.inject({
      method: "POST",
      url: "/api/plugins/demo/decision-token",
      headers,
      payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);

    const bootstrapResponse = await app.inject({ method: "POST", url: "/api/session/bootstrap", headers, payload: { token: bootstrap } });
    const cookie = firstHeader(bootstrapResponse.headers["set-cookie"]).split(";")[0] ?? "";
    const csrf = bootstrapResponse.json<{ data: { csrf_token: string } }>().data.csrf_token;
    const invalid = await app.inject({
      method: "POST",
      url: "/api/plugins/demo/decision-token",
      headers: { ...headers, cookie, "x-csrf-token": csrf },
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
