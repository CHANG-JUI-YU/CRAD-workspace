import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { pluginUserAuthorizationEnvelopeSchema, type PluginUserAuthorizationEnvelope, type Revision } from "@card-workspace/schemas";
import { runFileTransaction } from "@card-workspace/project";

import { dashboardFail } from "../errors.js";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;

interface SessionRecord {
  id: string;
  csrf: string;
  expiresAt: number;
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export class DashboardSessions {
  readonly bootstrapToken: string;
  private bootstrapExpiresAt: number;
  private bootstrapUsed = false;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(bootstrapToken = token(), now = Date.now()) {
    if (bootstrapToken.length < 32) dashboardFail("DASHBOARD_BOOTSTRAP_WEAK", "Bootstrap token must be at least 32 characters", 500);
    this.bootstrapToken = bootstrapToken;
    this.bootstrapExpiresAt = now + BOOTSTRAP_TTL_MS;
  }

  bootstrap(candidate: string, now = Date.now()): { id: string; csrf: string; expiresAt: number } {
    if (this.bootstrapUsed || now > this.bootstrapExpiresAt || !equal(candidate, this.bootstrapToken)) {
      dashboardFail("DASHBOARD_BOOTSTRAP_INVALID", "Bootstrap token is invalid, expired, or already used", 401);
    }
    this.bootstrapUsed = true;
    this.bootstrapExpiresAt = 0;
    const id = token();
    const csrf = token();
    const expiresAt = now + SESSION_TTL_MS;
    this.sessions.set(id, { id, csrf, expiresAt });
    return { id, csrf, expiresAt };
  }

  authenticate(cookie: string | undefined, csrf: string | undefined, mutation: boolean, now = Date.now()): SessionRecord {
    const id = parseCookie(cookie, "cw_session");
    const session = id === undefined ? undefined : this.sessions.get(id);
    if (id === undefined || session === undefined || now > session.expiresAt) {
      if (id !== undefined) this.sessions.delete(id);
      dashboardFail("DASHBOARD_SESSION_INVALID", "Dashboard session is missing or expired", 401);
    }
    if (mutation && (csrf === undefined || !equal(csrf, session.csrf))) {
      dashboardFail("DASHBOARD_CSRF_INVALID", "CSRF token is missing or invalid", 403);
    }
    return session;
  }

  csrfFor(cookie: string | undefined): string {
    return this.authenticate(cookie, undefined, false).csrf;
  }

  async issuePluginDecisionToken(
    projectRoot: string,
    binding: {
      project_id: string;
      proposal_id: string;
      proposal_revision: Revision;
      decision: "approve" | "reject";
      workflow_revision: number;
    },
    cookie: string | undefined,
    csrf: string | undefined,
    now = Date.now(),
  ): Promise<{ token: string; authorization: PluginUserAuthorizationEnvelope }> {
    const session = this.authenticate(cookie, csrf, true, now);
    const tokenValue = token(32);
    const tokenHash = createHash("sha256").update(tokenValue, "utf8").digest("hex");
    const authorization = pluginUserAuthorizationEnvelopeSchema.parse({
      schema_version: 1,
      token_hash: tokenHash,
      ...binding,
      session_id: session.id,
      nonce: randomBytes(32).toString("hex"),
      expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
    });
    await runFileTransaction({
      root: projectRoot,
      operations: [{
        relativePath: `.workflow/plugin-review-tokens/${tokenHash}.json`,
        content: `${JSON.stringify(authorization)}\n`,
        expectedAbsent: true,
      }],
    });
    return { token: tokenValue, authorization };
  }
}
