# Dashboard security boundary

The Dashboard authentication token is a long-lived server credential and must not be used as a general query-string credential.

## Authenticated bootstrap flow

When `authToken` is configured, the only supported query-token flow is:

1. Open `GET /?token=<token>` to bootstrap the Dashboard shell.
2. The inline Dashboard script reads the token into memory and immediately removes the query string from the visible/history URL with `history.replaceState(...)`.
3. All subsequent protected REST/image requests send `Authorization: Bearer <token>`.
4. Protected API routes reject a `token` query parameter, including when a bearer header is also present. This prevents query-token reuse from becoming an alternate API authentication channel.

Query-token authentication is not supported on `/workspace/*`, `/mcp`, image endpoints, or mutation requests.

## Browser response policy

The server applies one response-header baseline at the HTTP boundary:

- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` with `default-src 'none'`, no framing/base/form submission, same-origin network access, and same-origin/blob/data images.

The current Dashboard is assembled from inline CSS and JavaScript, so CSP temporarily permits `'unsafe-inline'` for `style-src` and `script-src`. This is intentionally narrow: other resource classes remain denied by default. A future static-asset or nonce/hash migration should remove these inline allowances without weakening the rest of the policy.
