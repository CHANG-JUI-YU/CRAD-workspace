import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  closeDashboardServer,
  DASHBOARD_HOST,
  DASHBOARD_PORT,
  DASHBOARD_SERVICE,
  DASHBOARD_URL,
  DashboardLauncherError,
  isConnectionRefused,
  isTimeoutError,
  launchDashboard,
  preflightNodeRuntime,
  probeDashboardService,
  resolveDashboardEndpoint,
} from "../src/dashboard-launcher.js";

const TEST_REVISION = `sha256:${"a".repeat(64)}`;

function healthResponse(service = DASHBOARD_SERVICE, status = "ready", runtimeRevision: string | null = TEST_REVISION): Response {
  return new Response(
    JSON.stringify({
      service,
      status,
      ...(runtimeRevision === null ? {} : { runtime_revision: runtimeRevision }),
      worker: { running: true },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function refused(code = "ECONNREFUSED"): Error {
  return Object.assign(new Error("fetch failed"), { cause: { code } });
}

function timeoutError(name = "AbortError"): Error {
  const err = new Error("The operation was aborted");
  err.name = name;
  return err;
}

function nestedTimeoutError(): Error {
  return Object.assign(new Error("fetch failed"), {
    cause: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
  });
}

function revisionDependency(revision = TEST_REVISION): () => Promise<string> {
  return vi.fn(async () => revision);
}

async function listeningServer(): Promise<Server> {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  return server;
}

describe("Audit 9 Batch 7 Suite", () => {
  describe("Issue #143: Node runtime declaration, preflight & Dashboard endpoint ownership", () => {
    it("declares engines.node >=20.0.0 across all workspace packages", async () => {
      const packagePaths = [
        "package.json",
        "packages/adapters/package.json",
        "packages/adapters-ccv3/package.json",
        "packages/adapters-png/package.json",
        "packages/cli/package.json",
        "packages/compiler/package.json",
        "packages/core/package.json",
        "packages/domain/package.json",
        "packages/plugins/package.json",
        "packages/runtime/package.json",
        "packages/server/package.json",
      ];

      for (const relPath of packagePaths) {
        const fullPath = resolve(process.cwd(), relPath);
        const pkg = JSON.parse(await readFile(fullPath, "utf8"));
        expect(pkg.engines?.node, `Missing or invalid engines.node in ${relPath}`).toBe(">=20.0.0");
      }
    });

    it("preflightNodeRuntime validates supported and unsupported Node versions", () => {
      // 支援版本
      expect(preflightNodeRuntime("v20.0.0").ok).toBe(true);
      expect(preflightNodeRuntime("v20.19.9").ok).toBe(true);
      expect(preflightNodeRuntime("21.5.0").ok).toBe(true);
      expect(preflightNodeRuntime("v22.1.0").ok).toBe(true);

      // 不支援版本
      const v18 = preflightNodeRuntime("v18.19.0");
      expect(v18.ok).toBe(false);
      expect(v18.error).toContain("DASHBOARD_RUNTIME_UNSUPPORTED");
      expect(v18.error).toContain(">= 20.0.0");

      const v16 = preflightNodeRuntime("v16.20.2");
      expect(v16.ok).toBe(false);
      expect(v16.error).toContain("DASHBOARD_RUNTIME_UNSUPPORTED");

      const invalid = preflightNodeRuntime("invalid");
      expect(invalid.ok).toBe(false);
      expect(invalid.error).toContain("DASHBOARD_RUNTIME_UNSUPPORTED");
    });

    it("resolveDashboardEndpoint centralizes default and custom endpoint options", () => {
      const defaultEndpoint = resolveDashboardEndpoint();
      expect(defaultEndpoint).toEqual({
        host: "127.0.0.1",
        port: 8787,
        url: "http://127.0.0.1:8787/",
        healthUrl: "http://127.0.0.1:8787/workspace/health",
        mcpUrl: "http://127.0.0.1:8787/mcp",
      });

      const customEndpoint = resolveDashboardEndpoint({ host: "0.0.0.0", port: 9090 });
      expect(customEndpoint).toEqual({
        host: "0.0.0.0",
        port: 9090,
        url: "http://0.0.0.0:9090/",
        healthUrl: "http://0.0.0.0:9090/workspace/health",
        mcpUrl: "http://0.0.0.0:9090/mcp",
      });
    });

    it("propagates custom endpoint options across server start, health probe, and URL", async () => {
      const customPort = 8899;
      const customHost = "127.0.0.1";
      const startServer = vi.fn(async () => await listeningServer());
      const openBrowser = vi.fn(async () => undefined);
      const log = vi.fn();
      let probedUrl = "";

      const result = await launchDashboard(
        "C:/workspace",
        {
          fetch: vi.fn(async (url: any) => {
            probedUrl = String(url);
            return healthResponse();
          }) as unknown as typeof fetch,
          startServer,
          computeRuntimeRevision: revisionDependency(),
          openBrowser,
          log,
        },
        { host: customHost, port: customPort },
      );

      expect(probedUrl).toBe(`http://${customHost}:${customPort}/workspace/health`);
      expect(result.ownership).toBe("reused");
      expect(result.url).toBe(`http://${customHost}:${customPort}/`);
      expect(openBrowser).toHaveBeenCalledWith(`http://${customHost}:${customPort}/`);
    });

    it("clearly indicates process ownership when starting a new server versus reusing", async () => {
      const server = await listeningServer();
      const openBrowser = vi.fn(async () => undefined);
      const log = vi.fn();

      // 1. 啟動新 server
      let probeCount = 0;
      const startedResult = await launchDashboard("C:/workspace", {
        fetch: vi.fn(async () => {
          probeCount += 1;
          if (probeCount === 1) throw refused();
          return healthResponse();
        }) as unknown as typeof fetch,
        startServer: vi.fn(async () => server),
        computeRuntimeRevision: revisionDependency(),
        openBrowser,
        wait: vi.fn(async () => undefined),
        log,
      });

      expect(startedResult.ownership).toBe("started");
      expect(startedResult.server).toBe(server);
      expect(startedResult.message).toContain("caller owns shutdown");

      // 2. 重用既有 server
      const reusedResult = await launchDashboard("C:/workspace", {
        fetch: vi.fn(async () => healthResponse()) as unknown as typeof fetch,
        startServer: vi.fn(),
        computeRuntimeRevision: revisionDependency(),
        openBrowser,
        log,
      });

      expect(reusedResult.ownership).toBe("reused");
      expect(reusedResult.server).toBeUndefined();
      expect(reusedResult.message).toContain("process owned by existing server");

      await closeDashboardServer(server);
    });
  });

  describe("Issue #124: Distinguish Dashboard probe timeouts and HTTP mismatches from occupied ports", () => {
    it("error classifiers recognize timeouts, aborts, causes, and connection refused", () => {
      // isTimeoutError
      expect(isTimeoutError(timeoutError("AbortError"))).toBe(true);
      expect(isTimeoutError(timeoutError("TimeoutError"))).toBe(true);
      expect(isTimeoutError(Object.assign(new Error(), { code: "ETIMEDOUT" }))).toBe(true);
      expect(isTimeoutError(nestedTimeoutError())).toBe(true);
      expect(isTimeoutError(refused())).toBe(false);
      expect(isTimeoutError(new Error("generic"))).toBe(false);

      // isConnectionRefused
      expect(isConnectionRefused(refused("ECONNREFUSED"))).toBe(true);
      expect(isConnectionRefused(refused("EHOSTUNREACH"))).toBe(true);
      expect(isConnectionRefused(refused("ENETUNREACH"))).toBe(true);
      expect(isConnectionRefused(timeoutError())).toBe(false);
    });

    it("probe classifies connection refused as absent", async () => {
      const result = await probeDashboardService(vi.fn(async () => { throw refused(); }) as unknown as typeof fetch);
      expect(result.status).toBe("absent");
      expect(result.url).toBe("http://127.0.0.1:8787/workspace/health");
    });

    it("probe classifies AbortError and timeouts as timeout without claiming port occupied", async () => {
      const result = await probeDashboardService(vi.fn(async () => { throw timeoutError(); }) as unknown as typeof fetch, 1500);
      expect(result.status).toBe("timeout");
      if (result.status === "timeout") {
        expect(result.timeoutMs).toBe(1500);
        expect(result.detail).toContain("timed out after 1500ms");
        expect(result.detail).not.toContain("occupied");
      }
    });

    it("probe classifies nested AbortError cause as timeout", async () => {
      const result = await probeDashboardService(vi.fn(async () => { throw nestedTimeoutError(); }) as unknown as typeof fetch, 1200);
      expect(result.status).toBe("timeout");
      if (result.status === "timeout") {
        expect(result.timeoutMs).toBe(1200);
      }
    });

    it("probe classifies HTTP 404/500/HTML as http_mismatch", async () => {
      // 1. HTTP 404
      const res404 = await probeDashboardService(vi.fn(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch);
      expect(res404.status).toBe("http_mismatch");
      if (res404.status === "http_mismatch") {
        expect(res404.httpStatus).toBe(404);
        expect(res404.detail).toContain("HTTP 404");
      }

      // 2. HTTP 500
      const res500 = await probeDashboardService(vi.fn(async () => new Response("Internal Error", { status: 500 })) as unknown as typeof fetch);
      expect(res500.status).toBe("http_mismatch");
      if (res500.status === "http_mismatch") {
        expect(res500.httpStatus).toBe(500);
      }

      // 3. HTTP 200 but HTML
      const resHtml = await probeDashboardService(vi.fn(async () => new Response("<html>nginx</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch);
      expect(resHtml.status).toBe("http_mismatch");
      if (resHtml.status === "http_mismatch") {
        expect(resHtml.detail).toContain("not valid JSON");
      }

      // 4. HTTP 200 with non-matching JSON service
      const resForeign = await probeDashboardService(vi.fn(async () => healthResponse("apache-solr", "ready")) as unknown as typeof fetch);
      expect(resForeign.status).toBe("http_mismatch");
      if (resForeign.status === "http_mismatch") {
        expect(resForeign.detail).toContain("apache-solr");
      }

      // 5. HTTP 200 with status not ready
      const resNotReady = await probeDashboardService(vi.fn(async () => healthResponse(DASHBOARD_SERVICE, "booting")) as unknown as typeof fetch);
      expect(resNotReady.status).toBe("http_mismatch");
      if (resNotReady.status === "http_mismatch") {
        expect(resNotReady.detail).toContain("status \"ready\"");
      }
    });

    it("probe classifies protocol errors / socket reset as occupied", async () => {
      const resetErr = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      const result = await probeDashboardService(vi.fn(async () => { throw resetErr; }) as unknown as typeof fetch);
      expect(result.status).toBe("occupied");
      expect(result.detail).toContain("ECONNRESET");
    });

    it("launchDashboard retries on transient probe timeouts during server startup without aborting server prematurely", async () => {
      const server = await listeningServer();
      let probeCount = 0;
      const startServer = vi.fn(async () => server);
      const openBrowser = vi.fn(async () => undefined);

      const result = await launchDashboard(
        "C:/workspace",
        {
          fetch: vi.fn(async () => {
            probeCount += 1;
            if (probeCount === 1) throw refused(); // initial probe: absent
            if (probeCount === 2) throw timeoutError(); // attempt 1: timeout
            if (probeCount === 3) throw timeoutError(); // attempt 2: timeout
            return healthResponse(); // attempt 3: ready!
          }) as unknown as typeof fetch,
          startServer,
          computeRuntimeRevision: revisionDependency(),
          openBrowser,
          wait: vi.fn(async () => undefined),
          log: vi.fn(),
        },
        { healthAttempts: 5, healthDelayMs: 0 },
      );

      expect(result.ownership).toBe("started");
      expect(probeCount).toBe(4);
      expect(server.listening).toBe(true);

      await closeDashboardServer(server);
    });

    it("launchDashboard distinguishes health timeout error from port occupied error", async () => {
      const server = await listeningServer();

      // 所有 attempts 都逾時
      const err = await launchDashboard(
        "C:/workspace",
        {
          fetch: vi.fn(async () => {
            throw timeoutError();
          }) as unknown as typeof fetch,
          startServer: vi.fn(async () => server),
          computeRuntimeRevision: revisionDependency(),
          openBrowser: vi.fn(async () => undefined),
          wait: vi.fn(async () => undefined),
          log: vi.fn(),
        },
        { healthAttempts: 2, healthDelayMs: 0 },
      ).catch((e) => e);

      expect(err).toBeInstanceOf(DashboardLauncherError);
      expect(err.code).toBe("DASHBOARD_HEALTH_TIMEOUT");
      expect(err.message).toContain("DASHBOARD_HEALTH_TIMEOUT");
      expect(err.message).toContain("http://127.0.0.1:8787/workspace/health");
      expect(err.message).toContain("timed out");
      expect(err.message).not.toContain("DASHBOARD_PORT_IN_USE");
      expect(server.listening).toBe(false);
    });

    it("launchDashboard reports structured port in use diagnostic for foreign HTTP service", async () => {
      const err = await launchDashboard("C:/workspace", {
        fetch: vi.fn(async () => new Response("Welcome to nginx", { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
        startServer: vi.fn(),
        computeRuntimeRevision: revisionDependency(),
        openBrowser: vi.fn(async () => undefined),
        log: vi.fn(),
      }).catch((e) => e);

      expect(err).toBeInstanceOf(DashboardLauncherError);
      expect(err.code).toBe("DASHBOARD_PORT_IN_USE");
      expect(err.message).toContain("occupied by an incompatible HTTP service");
      expect(err.message).toContain("not valid JSON");
    });
  });
});
