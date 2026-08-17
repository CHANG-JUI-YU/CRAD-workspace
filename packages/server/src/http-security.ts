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
  if (left.length !== right.length) return false;
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
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

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
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