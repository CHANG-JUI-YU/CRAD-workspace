# Dashboard security boundary

The Dashboard authentication token is a long-lived server credential and must not be used as a general query-string credential or copied into browser-persistent JavaScript storage.

## Authenticated bootstrap and recovery flow

When `authToken` is configured, the supported browser flow is:

1. Open `GET /?token=<token>` to bootstrap the Dashboard shell.
2. The server validates the long-lived token only on this bootstrap route and creates a random, server-side Dashboard browser session.
3. The response sets a host-only `st_workspace_session` cookie with `HttpOnly`, `SameSite=Strict`, `Path=/`, and a 15-minute absolute `Max-Age`. The cookie contains only an opaque random session identifier; the server stores only a SHA-256 lookup key plus expiry/scope metadata.
4. The inline Dashboard script immediately removes the query string from the visible/history URL with `history.replaceState(...)`. The long-lived token is not written to HTML, `localStorage`, `sessionStorage`, or another persistent JavaScript-readable store.
5. Reloads and duplicate tabs can authenticate `GET /` and `/workspace/*` using the short-lived cookie until the absolute expiry time. The session cookie does not authorize `/mcp`.
6. Protected API routes continue to reject a `token` query parameter, including when a bearer header or valid browser session is also present. Query-token reuse therefore remains bootstrap-only.

Bearer authentication remains supported for API clients and continues to authorize the same routes it did before browser-session recovery was added.

## Session lifecycle and revocation

Dashboard browser sessions have an absolute lifetime of 15 minutes by default. The lifetime is not extended by activity. Expired sessions are deleted when observed and the browser receives a clearing cookie.

`POST /workspace/auth/logout` revokes the current browser session server-side and returns a `Max-Age=0` cookie. The endpoint remains behind the normal authentication and mutation-request checks.

Sessions exist only in the server process. A server restart intentionally revokes all outstanding browser sessions. There is no disk-backed session resurrection.

A missing, expired, revoked, restart-invalidated, or malformed session cannot load the Dashboard shell. `GET /` returns HTTP 401 with a small reauthentication page explaining that the user must reopen the original `?token=...` bootstrap URL. That page never embeds the token.

## Scope and CSRF/Host boundary

Browser-session authentication is accepted only for the Dashboard shell (`/`) and `/workspace` routes. It is deliberately not an alternate authentication mechanism for `/mcp` or arbitrary future paths.

Session support does not bypass Host, Origin, Fetch Metadata, `X-Requested-With`, `X-Workspace-CSRF`, or high-impact confirmation checks. Cookie-authenticated mutations pass through the same `assertMutationRequestAllowed` boundary as bearer-authenticated mutations. `SameSite=Strict` and the host-only cookie are additional defenses, not replacements for those checks.

Loopback HTTP omits the `Secure` cookie attribute so `127.0.0.1`/`localhost` development remains usable. Non-loopback startup marks the session cookie `Secure`; browser session recovery for externally exposed deployments therefore requires the client-facing Dashboard origin to use HTTPS (including deployments where TLS terminates at a trusted reverse proxy).

## Browser response policy

The server applies one response-header baseline at the HTTP boundary:

- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` with `default-src 'none'`, no framing/base/form submission, same-origin network access, and same-origin/blob/data images.

The current Dashboard is assembled from inline CSS and JavaScript, so CSP temporarily permits `'unsafe-inline'` for `style-src` and `script-src`. This is intentionally narrow: other resource classes remain denied by default. A future static-asset or nonce/hash migration should remove these inline allowances without weakening the rest of the policy.
