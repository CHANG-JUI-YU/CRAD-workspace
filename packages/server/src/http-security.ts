import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { CoreError } from "@st-workspace/core";

export function parseRequestTarget(raw: string | undefined, base: string): URL | null {
  try {
    return new URL(raw ?? "/", base);
  } catch {
    return null;
  }
}

export function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match === null ? undefined : match[1];
}

export function normalizeAuthToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const trimmed = token.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function normalizeConfiguredAuthToken(token: string | undefined): string | undefined {
  const normalized = normalizeAuthToken(token);
  if (token !== undefined && normalized === undefined) {
    throw new CoreError("AUTH_TOKEN_BLANK", "Auth token must not be blank or whitespace-only", true);
  }
  return normalized;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) return normalized.slice(1, -1);
  return normalized;
}

function parseHostHeader(hostHeader: string | undefined): { hostname: string; port: string } | null {
  if (hostHeader === undefined || hostHeader.trim().length === 0) return null;
  try {
    const parsed = new URL(`http://${hostHeader.trim()}`);
    if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return null;
    return { hostname: normalizeHostname(parsed.hostname), port: parsed.port };
  } catch {
    return null;
  }
}

export function assertRequestHostAllowed(
  hostHeader: string | undefined,
  allowedHostnames: readonly string[],
  expectedPort: number | undefined,
): void {
  const parsed = parseHostHeader(hostHeader);
  if (parsed === null || expectedPort === undefined) {
    throw new CoreError("CSRF_DENIED", "Untrusted Host header denied", false);
  }
  const port = parsed.port === "" ? 80 : Number(parsed.port);
  const allowed = new Set(allowedHostnames.map(normalizeHostname));
  if (!Number.isInteger(port) || port !== expectedPort || !allowed.has(parsed.hostname)) {
    throw new CoreError("CSRF_DENIED", "Untrusted Host header denied", false);
  }
}

export function assertMutationRequestAllowed(headers: IncomingHttpHeaders, hostHeader: string | undefined): void {
  const requestedWith = headerValue(headers, "x-requested-with");
  if (requestedWith !== undefined && requestedWith.trim() === "XMLHttpRequest") return;

  const csrfToken = headerValue(headers, "x-workspace-csrf");
  if (csrfToken !== undefined && csrfToken.trim().length > 0) return;

  const secFetchSite = headerValue(headers, "sec-fetch-site");
  if (secFetchSite === "cross-site") {
    throw new CoreError("CSRF_DENIED", "Cross-site mutation request denied", false);
  }

  const origin = headerValue(headers, "origin");
  if (origin !== undefined && origin.length > 0) {
    let parsedOrigin: URL | null = null;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      parsedOrigin = null;
    }
    if (parsedOrigin === null || parsedOrigin.host !== (hostHeader ?? "")) {
      throw new CoreError("CSRF_DENIED", "Cross-origin mutation request denied", false);
    }
    return;
  }

  return;
}

export function assertHighImpactConfirmed(headers: IncomingHttpHeaders, action: string): void {
  const confirm = headerValue(headers, "x-workspace-confirm");
  if (confirm === undefined || confirm.trim() !== action) {
    throw new CoreError(
      "CSRF_CONFIRMATION_REQUIRED",
      `High-impact action requires confirmation header X-Workspace-Confirm: ${action}`,
      false,
    );
  }
}
