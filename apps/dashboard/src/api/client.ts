import type { ApiEnvelope } from "./types";

let csrfToken: string | undefined;

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function bootstrapSession(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get("bootstrap");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (token === null) {
    const session = await rawFetch<{ authenticated: boolean; csrf_token: string }>("/api/session", { method: "GET" }, false);
    if (!session.authenticated) throw new ApiError("DASHBOARD_SESSION_INVALID", "工作階段無效，請重新啟動 Dashboard");
    csrfToken = session.csrf_token;
    return;
  }
  const result = await rawFetch<{ csrf_token: string }>("/api/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }, false);
  csrfToken = result.csrf_token;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  return rawFetch<T>(url, init, true);
}

async function rawFetch<T>(url: string, init: RequestInit, authenticated: boolean): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (authenticated && !["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken !== undefined) {
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!envelope.ok) throw new ApiError(envelope.error.code, envelope.error.message, envelope.error);
  return envelope.data;
}
