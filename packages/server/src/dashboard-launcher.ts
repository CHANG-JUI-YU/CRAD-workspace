import { spawn } from "node:child_process";
import type { Server } from "node:http";
import path from "node:path";
import { startWorkspaceServer } from "./index.js";
import { computeRuntimeRevision, WORKSPACE_SERVICE } from "./runtime-revision.js";

export const DASHBOARD_HOST = "127.0.0.1";
export const DASHBOARD_PORT = 8787;
export const DASHBOARD_SERVICE = WORKSPACE_SERVICE;
export const DASHBOARD_URL = `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}/`;
export const DASHBOARD_HEALTH_URL = `${DASHBOARD_URL}workspace/health`;
export const DASHBOARD_MCP_URL = `${DASHBOARD_URL}mcp`;

export interface DashboardEndpoint {
  host: string;
  port: number;
  url: string;
  healthUrl: string;
  mcpUrl: string;
}

export function resolveDashboardEndpoint(options: { host?: string; port?: number } = {}): DashboardEndpoint {
  const host = options.host?.trim() || DASHBOARD_HOST;
  const port = typeof options.port === "number" && options.port > 0 ? options.port : DASHBOARD_PORT;
  const baseUrl = `http://${host}:${port}`;
  const url = `${baseUrl}/`;
  const healthUrl = `${baseUrl}/workspace/health`;
  const mcpUrl = `${baseUrl}/mcp`;
  return { host, port, url, healthUrl, mcpUrl };
}

export function preflightNodeRuntime(version = process.version): { ok: boolean; version: string; error?: string } {
  const clean = version.startsWith("v") ? version.slice(1) : version;
  const parts = clean.split(".");
  const major = Number.parseInt(parts[0] || "", 10);
  if (Number.isNaN(major) || major < 20) {
    const msg = `DASHBOARD_RUNTIME_UNSUPPORTED: ST Workspace requires Node.js >= 20.0.0, but observed runtime version is ${version}. Please upgrade Node.js to version 20 or newer.`;
    return { ok: false, version, error: msg };
  }
  return { ok: true, version };
}

export type DashboardProbeStatus = "available" | "absent" | "timeout" | "http_mismatch" | "occupied";

export type DashboardProbeResult =
  | { status: "available"; runtime_revision?: string; url: string; service?: string; detail?: string }
  | { status: "absent"; url: string; detail?: string }
  | { status: "timeout"; url: string; timeoutMs: number; detail: string }
  | { status: "http_mismatch"; url: string; httpStatus?: number; detail: string }
  | { status: "occupied"; url: string; detail: string };

export interface DashboardLaunchResult {
  ownership: "started" | "reused";
  url: string;
  runtime_revision: string;
  server?: Server;
  message?: string;
  browser_warning?: string;
}

export interface DashboardLauncherDependencies {
  fetch?: typeof globalThis.fetch;
  startServer?: typeof startWorkspaceServer;
  computeRuntimeRevision?: typeof computeRuntimeRevision;
  openBrowser?: (url: string) => Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
  log?: (message: string) => void;
}

export type DashboardLauncherErrorCode =
  | "DASHBOARD_PORT_IN_USE"
  | "DASHBOARD_SERVICE_STALE"
  | "DASHBOARD_BUILD_FAILED"
  | "DASHBOARD_START_FAILED"
  | "DASHBOARD_HEALTH_TIMEOUT"
  | "DASHBOARD_RUNTIME_UNSUPPORTED"
  | "DASHBOARD_HTTP_MISMATCH";

export class DashboardLauncherError extends Error {
  constructor(
    readonly code: DashboardLauncherErrorCode,
    message: string,
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "DashboardLauncherError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current !== null && typeof current === "object") {
      const err = current as any;
      if (err.name === "AbortError" || err.name === "TimeoutError") return true;
      if (err.code === "ETIMEDOUT" || err.code === "ABORT_ERR" || err.code === 20) return true;
      current = err.cause;
    } else {
      break;
    }
  }
  return false;
}

export function isConnectionRefused(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current !== null && typeof current === "object") {
      const err = current as any;
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "EHOSTUNREACH" ||
        err.code === "ENETUNREACH" ||
        err.code === "EADDRNOTAVAIL"
      ) {
        return true;
      }
      current = err.cause;
    } else {
      break;
    }
  }
  return false;
}

function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const value = record(current);
    if (typeof value?.code === "string") return value.code;
    current = value?.cause;
  }
  return undefined;
}

export async function probeDashboardService(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 1_500,
  options: { host?: string; port?: number; endpoint?: DashboardEndpoint } = {},
): Promise<DashboardProbeResult> {
  const endpoint = options.endpoint ?? resolveDashboardEndpoint(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint.healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "http_mismatch",
        url: endpoint.healthUrl,
        httpStatus: response.status,
        detail: `health endpoint returned HTTP ${response.status}`,
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        status: "http_mismatch",
        url: endpoint.healthUrl,
        httpStatus: response.status,
        detail: "health endpoint response is not valid JSON",
      };
    }
    const health = record(payload);
    if (health?.service !== DASHBOARD_SERVICE || health.status !== "ready") {
      return {
        status: "http_mismatch",
        url: endpoint.healthUrl,
        httpStatus: response.status,
        detail: `health response service is "${health?.service ?? "unknown"}", expected "${DASHBOARD_SERVICE}" with status "ready"`,
      };
    }
    const runtimeRevision = typeof health.runtime_revision === "string" && health.runtime_revision.length > 0
      ? health.runtime_revision
      : undefined;
    return {
      status: "available",
      url: endpoint.healthUrl,
      service: DASHBOARD_SERVICE,
      ...(runtimeRevision === undefined ? {} : { runtime_revision: runtimeRevision }),
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return {
        status: "timeout",
        url: endpoint.healthUrl,
        timeoutMs,
        detail: `health probe timed out after ${timeoutMs}ms`,
      };
    }
    if (isConnectionRefused(error)) {
      return {
        status: "absent",
        url: endpoint.healthUrl,
        detail: "connection refused (no service listening)",
      };
    }
    return {
      status: "occupied",
      url: endpoint.healthUrl,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function openDashboardBrowser(url = DASHBOARD_URL): Promise<void> {
  if (process.platform !== "win32") throw new Error("Dashboard launcher currently supports Windows only");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function closeDashboardServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function openBrowserWithoutStopping(
  opener: (url: string) => Promise<void>,
  log: (message: string) => void,
  url = DASHBOARD_URL,
): Promise<string | undefined> {
  try {
    await opener(url);
    return undefined;
  } catch (error) {
    const warning = `DASHBOARD_BROWSER_OPEN_FAILED: unable to open ${url}: ${error instanceof Error ? error.message : String(error)}`;
    log(warning);
    return warning;
  }
}

function matchesExpectedRevision(probe: DashboardProbeResult, expectedRevision: string): boolean {
  return probe.status === "available" && probe.runtime_revision === expectedRevision;
}

function staleError(expectedRevision: string, observedRevision: string | undefined): DashboardLauncherError {
  const observed = observedRevision === undefined ? "missing" : observedRevision;
  return new DashboardLauncherError(
    "DASHBOARD_SERVICE_STALE",
    `DASHBOARD_SERVICE_STALE: the existing ST Workspace service has runtime revision ${observed}, but the current build is ${expectedRevision}. Close the old Dashboard window and restart it.`,
  );
}

export async function launchDashboard(
  workspaceRoot: string,
  dependencies: DashboardLauncherDependencies = {},
  options: { healthAttempts?: number; healthDelayMs?: number; host?: string; port?: number } = {},
): Promise<DashboardLaunchResult> {
  const preflight = preflightNodeRuntime();
  if (!preflight.ok) {
    throw new DashboardLauncherError("DASHBOARD_RUNTIME_UNSUPPORTED", preflight.error!);
  }

  const endpoint = resolveDashboardEndpoint(options);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const startServer = dependencies.startServer ?? startWorkspaceServer;
  const calculateRevision = dependencies.computeRuntimeRevision ?? computeRuntimeRevision;
  const openBrowser = dependencies.openBrowser ?? openDashboardBrowser;
  const wait = dependencies.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const log = dependencies.log ?? console.log;

  let expectedRevision: string;
  try {
    expectedRevision = await calculateRevision(workspaceRoot);
  } catch (error) {
    throw new DashboardLauncherError(
      "DASHBOARD_BUILD_FAILED",
      `DASHBOARD_BUILD_FAILED: unable to calculate the built runtime revision: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  const initialProbe = await probeDashboardService(fetcher, 1_500, { endpoint });
  if (initialProbe.status === "available") {
    if (!matchesExpectedRevision(initialProbe, expectedRevision)) throw staleError(expectedRevision, initialProbe.runtime_revision);
    const msg = `Reusing existing ST Workspace server at ${endpoint.url} (process owned by existing server)`;
    log(msg);
    const browserWarning = await openBrowserWithoutStopping(openBrowser, log, endpoint.url);
    return {
      ownership: "reused",
      url: endpoint.url,
      runtime_revision: expectedRevision,
      message: msg,
      ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }),
    };
  }
  if (initialProbe.status === "http_mismatch") {
    throw new DashboardLauncherError(
      "DASHBOARD_PORT_IN_USE",
      `DASHBOARD_PORT_IN_USE: ${endpoint.host}:${endpoint.port} is occupied by an incompatible HTTP service (${initialProbe.detail}). Close that service or change port before starting ST Workspace.`,
    );
  }
  if (initialProbe.status === "occupied") {
    throw new DashboardLauncherError(
      "DASHBOARD_PORT_IN_USE",
      `DASHBOARD_PORT_IN_USE: ${endpoint.host}:${endpoint.port} is occupied by a non-matching service. Close that service before starting ST Workspace.`,
    );
  }

  let server: Server;
  try {
    server = await startServer({
      actor: "dashboard-launcher",
      host: endpoint.host,
      port: endpoint.port,
      projectRoot: path.resolve(workspaceRoot, "projects"),
      workspaceRoot,
      runtimeRevision: expectedRevision,
    });
  } catch (error) {
    const racedProbe = await probeDashboardService(fetcher, 1_500, { endpoint });
    if (racedProbe.status === "available") {
      if (!matchesExpectedRevision(racedProbe, expectedRevision)) throw staleError(expectedRevision, racedProbe.runtime_revision);
      const msg = `Reusing ST Workspace server at ${endpoint.url}`;
      log(msg);
      const browserWarning = await openBrowserWithoutStopping(openBrowser, log, endpoint.url);
      return {
        ownership: "reused",
        url: endpoint.url,
        runtime_revision: expectedRevision,
        message: msg,
        ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }),
      };
    }
    if (errorCode(error) === "EADDRINUSE" || racedProbe.status === "occupied" || racedProbe.status === "http_mismatch") {
      throw new DashboardLauncherError(
        "DASHBOARD_PORT_IN_USE",
        `DASHBOARD_PORT_IN_USE: ${endpoint.host}:${endpoint.port} became occupied while starting ST Workspace.`,
        error,
      );
    }
    throw new DashboardLauncherError(
      "DASHBOARD_START_FAILED",
      `DASHBOARD_START_FAILED: ST Workspace server could not start: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  const attempts = Math.max(1, options.healthAttempts ?? 20);
  const delayMs = Math.max(0, options.healthDelayMs ?? 250);
  let lastProbeResult: DashboardProbeResult | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await probeDashboardService(fetcher, 1_500, { endpoint });
    lastProbeResult = health;
    if (health.status === "available") {
      if (!matchesExpectedRevision(health, expectedRevision)) {
        await closeDashboardServer(server).catch(() => undefined);
        throw staleError(expectedRevision, health.runtime_revision);
      }
      const msg = `ST Workspace Dashboard is ready at ${endpoint.url} (new server started, caller owns shutdown)`;
      log(msg);
      const browserWarning = await openBrowserWithoutStopping(openBrowser, log, endpoint.url);
      return {
        ownership: "started",
        url: endpoint.url,
        runtime_revision: expectedRevision,
        server,
        message: msg,
        ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }),
      };
    }
    if (health.status === "occupied") {
      await closeDashboardServer(server).catch(() => undefined);
      throw new DashboardLauncherError(
        "DASHBOARD_PORT_IN_USE",
        `DASHBOARD_PORT_IN_USE: port ${endpoint.port} is occupied by another service (${health.detail}).`,
      );
    }
    if (health.status === "http_mismatch") {
      await closeDashboardServer(server).catch(() => undefined);
      throw new DashboardLauncherError(
        "DASHBOARD_PORT_IN_USE",
        `DASHBOARD_PORT_IN_USE: ${endpoint.healthUrl} responded with an incompatible service (${health.detail}).`,
      );
    }
    if (attempt + 1 < attempts) await wait(delayMs);
  }

  await closeDashboardServer(server).catch(() => undefined);
  const timeoutDetail = lastProbeResult?.status === "timeout"
    ? ` (last probe timed out: ${lastProbeResult.detail})`
    : lastProbeResult?.detail ? ` (last probe: ${lastProbeResult.detail})` : "";
  throw new DashboardLauncherError(
    "DASHBOARD_HEALTH_TIMEOUT",
    `DASHBOARD_HEALTH_TIMEOUT: ST Workspace at ${endpoint.healthUrl} did not become ready before the health check deadline${timeoutDetail}. Check system load or antivirus firewall settings.`,
  );
}
