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

export type DashboardProbeResult =
  | { status: "available"; runtime_revision?: string }
  | { status: "absent" }
  | { status: "occupied"; detail: string };

export interface DashboardLaunchResult {
  ownership: "started" | "reused";
  url: string;
  runtime_revision: string;
  server?: Server;
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

export class DashboardLauncherError extends Error {
  constructor(
    readonly code: "DASHBOARD_PORT_IN_USE" | "DASHBOARD_SERVICE_STALE" | "DASHBOARD_BUILD_FAILED" | "DASHBOARD_START_FAILED" | "DASHBOARD_HEALTH_TIMEOUT",
    message: string,
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "DashboardLauncherError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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
): Promise<DashboardProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(DASHBOARD_HEALTH_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { status: "occupied", detail: `health endpoint returned HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "occupied", detail: "health endpoint did not return JSON" };
    }
    const health = record(payload);
    if (health?.service !== DASHBOARD_SERVICE || health.status !== "ready") {
      return { status: "occupied", detail: "health response is not ST Workspace V3" };
    }
    const runtimeRevision = typeof health.runtime_revision === "string" && health.runtime_revision.length > 0
      ? health.runtime_revision
      : undefined;
    return runtimeRevision === undefined
      ? { status: "available" }
      : { status: "available", runtime_revision: runtimeRevision };
  } catch (error) {
    if (errorCode(error) === "ECONNREFUSED") return { status: "absent" };
    return { status: "occupied", detail: error instanceof Error ? error.message : String(error) };
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
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function openBrowserWithoutStopping(
  opener: (url: string) => Promise<void>,
  log: (message: string) => void,
): Promise<string | undefined> {
  try {
    await opener(DASHBOARD_URL);
    return undefined;
  } catch (error) {
    const warning = `DASHBOARD_BROWSER_OPEN_FAILED: unable to open ${DASHBOARD_URL}: ${error instanceof Error ? error.message : String(error)}`;
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
  options: { healthAttempts?: number; healthDelayMs?: number } = {},
): Promise<DashboardLaunchResult> {
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

  const initialProbe = await probeDashboardService(fetcher);
  if (initialProbe.status === "available") {
    if (!matchesExpectedRevision(initialProbe, expectedRevision)) throw staleError(expectedRevision, initialProbe.runtime_revision);
    log(`Reusing ST Workspace server at ${DASHBOARD_URL}`);
    const browserWarning = await openBrowserWithoutStopping(openBrowser, log);
    return { ownership: "reused", url: DASHBOARD_URL, runtime_revision: expectedRevision, ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }) };
  }
  if (initialProbe.status === "occupied") {
    throw new DashboardLauncherError(
      "DASHBOARD_PORT_IN_USE",
      `DASHBOARD_PORT_IN_USE: ${DASHBOARD_HOST}:${DASHBOARD_PORT} is occupied by a non-matching service. Close that service before starting ST Workspace.`,
    );
  }

  let server: Server;
  try {
    server = await startServer({
      actor: "dashboard-launcher",
      host: DASHBOARD_HOST,
      port: DASHBOARD_PORT,
      projectRoot: path.resolve(workspaceRoot, "projects"),
      workspaceRoot,
      runtimeRevision: expectedRevision,
    });
  } catch (error) {
    const racedProbe = await probeDashboardService(fetcher);
    if (racedProbe.status === "available") {
      if (!matchesExpectedRevision(racedProbe, expectedRevision)) throw staleError(expectedRevision, racedProbe.runtime_revision);
      log(`Reusing ST Workspace server at ${DASHBOARD_URL}`);
      const browserWarning = await openBrowserWithoutStopping(openBrowser, log);
      return { ownership: "reused", url: DASHBOARD_URL, runtime_revision: expectedRevision, ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }) };
    }
    if (errorCode(error) === "EADDRINUSE" || racedProbe.status === "occupied") {
      throw new DashboardLauncherError(
        "DASHBOARD_PORT_IN_USE",
        `DASHBOARD_PORT_IN_USE: ${DASHBOARD_HOST}:${DASHBOARD_PORT} became occupied while starting ST Workspace.`,
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
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await probeDashboardService(fetcher);
    if (health.status === "available") {
      if (!matchesExpectedRevision(health, expectedRevision)) {
        await closeDashboardServer(server).catch(() => undefined);
        throw staleError(expectedRevision, health.runtime_revision);
      }
      log(`ST Workspace Dashboard is ready at ${DASHBOARD_URL}`);
      const browserWarning = await openBrowserWithoutStopping(openBrowser, log);
      return { ownership: "started", url: DASHBOARD_URL, runtime_revision: expectedRevision, server, ...(browserWarning === undefined ? {} : { browser_warning: browserWarning }) };
    }
    if (health.status === "occupied") {
      await closeDashboardServer(server).catch(() => undefined);
      throw new DashboardLauncherError("DASHBOARD_PORT_IN_USE", `DASHBOARD_PORT_IN_USE: port ${DASHBOARD_PORT} is occupied by another service.`);
    }
    if (attempt + 1 < attempts) await wait(delayMs);
  }

  await closeDashboardServer(server).catch(() => undefined);
  throw new DashboardLauncherError(
    "DASHBOARD_HEALTH_TIMEOUT",
    "DASHBOARD_HEALTH_TIMEOUT: ST Workspace did not become ready before the health check deadline.",
  );
}
