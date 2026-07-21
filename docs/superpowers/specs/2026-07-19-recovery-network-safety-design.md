# Recovery Matrix and Network Safety

## Recovery

- Generic transient recovery supports `original`, `source_adaptation`, and `card_import` shared-tail tasks.
- `create-blueprint` recovery supports all three entries; `analyze-import` remains Card Import only.
- `curate-facts` keeps its dedicated source-processing repair semantics.
- `mode_conversion` remains fail closed until its lifecycle is implemented.

## Controlled Fetch

- DNS resolution has a deadline and rejects mixed public/private answer sets.
- Every HTTP hop connects only to an address from that hop's validated DNS result.
- Production uses Node HTTP/HTTPS transport with a pinned custom lookup while preserving original Host, TLS SNI, and certificate verification.
- Redirects are manual and repeat canonicalization, DNS validation, and pinning.
- There is no fallback to ordinary fetch.
- Timeout and byte-limit failures destroy the active request/body stream.
- IPv4, IPv6, and IPv4-mapped IPv6 private/reserved ranges are rejected.

## Acceptance

- Source Adaptation and Card Import Blueprint failures can recover without widening curate-facts recovery.
- A DNS answer changed after validation cannot affect the connected address.
- Redirect, timeout, IPv6, body-size, and transport failure tests are deterministic and fail closed.
