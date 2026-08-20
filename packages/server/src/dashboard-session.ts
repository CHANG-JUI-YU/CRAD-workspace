import { createHash, randomBytes } from "node:crypto";

export const DASHBOARD_SESSION_COOKIE = "st_workspace_session";
export const DEFAULT_DASHBOARD_SESSION_TTL_MS = 15 * 60 * 1000;

type DashboardSessionScope = "dashboard";
export type DashboardSessionStatus = "missing" | "valid" | "expired" | "invalid";

export interface DashboardSessionAuthentication {
  status: DashboardSessionStatus;
  sessionId?: string;
}

interface DashboardSessionRecord {
  expiresAt: number;
  scope: DashboardSessionScope;
}

export interface DashboardBrowserSessionStoreOptions {
  ttlMs?: number;
  now?: () => number;
  secure?: boolean;
}

function sessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("base64url");
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim() === "") return undefined;
  let found: string | undefined;
  for (const field of cookieHeader.split(";")) {
    const separator = field.indexOf("=");
    if (separator <= 0) continue;
    if (field.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return undefined;
    found = field.slice(separator + 1).trim();
  }
  return found === "" ? undefined : found;
}

function serializeCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${DASHBOARD_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function dashboardReauthenticationHtml(reason: Exclude<DashboardSessionStatus, "valid"> | "invalid-token"): string {
  const heading = reason === "expired"
    ? "Dashboard 工作階段已過期"
    : reason === "invalid" || reason === "invalid-token"
      ? "Dashboard 工作階段無效或已撤銷"
      : "Dashboard 需要重新驗證";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #161616; }
    main { max-width: 44rem; margin: 12vh auto; padding: 2rem; background: white; border: 1px solid #ddd; border-radius: 12px; }
    h1 { margin-top: 0; font-size: 1.5rem; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <p>此頁未保存長效存取權杖。請重新開啟啟動 server 時提供的 Dashboard 驗證網址（包含 <code>?token=...</code>）以建立新的短效工作階段。</p>
    <p>若 server 已重新啟動、工作階段已登出或超過安全期限，舊工作階段會失效，這是預期行為。</p>
  </main>
</body>
</html>`;
}

export function isDashboardSessionScope(pathname: string): boolean {
  return pathname === "/" || pathname === "/workspace" || pathname.startsWith("/workspace/");
}

export class DashboardBrowserSessionStore {
  readonly ttlMs: number;
  private readonly now: () => number;
  private readonly secure: boolean;
  private readonly sessions = new Map<string, DashboardSessionRecord>();

  constructor(options: DashboardBrowserSessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_DASHBOARD_SESSION_TTL_MS;
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("Dashboard browser session TTL must be a positive finite number");
    }
    this.now = options.now ?? Date.now;
    this.secure = options.secure ?? false;
  }

  issue(): { sessionId: string; cookie: string; expiresAt: number } {
    this.pruneExpired();
    const sessionId = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.sessions.set(sessionKey(sessionId), { expiresAt, scope: "dashboard" });
    return {
      sessionId,
      expiresAt,
      cookie: serializeCookie(sessionId, Math.max(1, Math.ceil(this.ttlMs / 1000)), this.secure),
    };
  }

  authenticate(cookieHeader: string | undefined): DashboardSessionAuthentication {
    const sessionId = readCookie(cookieHeader, DASHBOARD_SESSION_COOKIE);
    if (sessionId === undefined) return { status: "missing" };
    if (!/^[A-Za-z0-9_-]{43}$/u.test(sessionId)) return { status: "invalid" };
    const key = sessionKey(sessionId);
    const record = this.sessions.get(key);
    if (record === undefined || record.scope !== "dashboard") return { status: "invalid" };
    if (this.now() >= record.expiresAt) {
      this.sessions.delete(key);
      return { status: "expired" };
    }
    return { status: "valid", sessionId };
  }

  revoke(cookieHeader: string | undefined): boolean {
    const sessionId = readCookie(cookieHeader, DASHBOARD_SESSION_COOKIE);
    if (sessionId === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(sessionId)) return false;
    return this.sessions.delete(sessionKey(sessionId));
  }

  clearCookie(): string {
    return [
      `${DASHBOARD_SESSION_COOKIE}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      ...(this.secure ? ["Secure"] : []),
    ].join("; ");
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, record] of this.sessions) {
      if (now >= record.expiresAt) this.sessions.delete(key);
    }
  }
}
