# Web Character Research Design (Superseded Provider)

The paid search-provider portion of this design is superseded by `2026-07-18-model-web-source-research-design.md`. Approval, controlled fetch, immutable snapshots, and provenance remain active.

## Goal

Allow Source Adaptation projects to discover character information on the web, obtain explicit user approval for selected sources, preserve immutable source snapshots, and reuse the existing Fact Curator, Facts Gate, Blueprint, and authoring workflow.

## Decisions

- A dedicated Source Researcher performs discovery; Director and Fact Curator do not receive unrestricted web access.
- Search results require user approval before any page is fetched.
- Approved pages are fetched by a controlled server-side fetcher and stored as ordinary immutable retrieved sources.
- Search snippets are discovery metadata only and can never be cited as evidence.
- Default candidate classes are official sites, encyclopedias, and character wikis. Forums, social posts, and fan works are excluded unless a future explicit policy enables them.
- Provider-specific paid search has been removed; Source Researcher now submits model-discovered candidates.
- Research approval is an audited intake sub-state rather than a new global Workflow stage. This avoids migrating existing workflows while preserving fail-closed selection semantics.

## Components

### Source Researcher Agent

Receives the work title, character names, aliases, language, and optional allowed domains. It creates bounded search queries, invokes only controlled research tools, explains source relevance, and returns candidates to Director. It cannot fetch arbitrary URLs or create facts.

### Search Provider

A small provider interface hides Brave-specific request and response details. Searches are bounded by result count and language. API keys are read from the MCP process environment and never persisted or returned.

### Research Registry

Each project stores immutable search batches under `sources/research/`. A batch includes query intent, provider, candidate URLs, source class, engine-derived source family, per-candidate language, relevance rationale, status, timestamps, and a content revision. Candidate IDs and batch IDs are deterministic. Approval creates a new batch revision and audit decision without overwriting prior evidence. Legacy batches without family or candidate language remain readable through runtime derivation.

### Controlled Fetcher

Only candidates recorded as approved may be fetched. The fetcher accepts HTTP(S), resolves DNS before every request, rejects loopback/private/link-local/reserved addresses, follows at most three redirects, revalidates every redirect target, rejects a final URL whose engine-derived family differs from the approved candidate family, enforces response timeout and byte limits, and accepts only HTML or plain text. Credentials in URLs are rejected.

HTML is converted to bounded plain text by removing scripts, styles, navigation noise, comments, and tags, decoding common entities, and normalizing whitespace. The first version intentionally avoids executing JavaScript. Pages without usable text fail explicitly.

### Snapshot Bridge

Fetched text is passed directly to `intakeRetrievedSource`. The resulting immutable snapshot records requested URL, final canonical URL, fetch time, media type, source tier, research batch/candidate lineage, and raw hash. Existing Source Adaptation then handles chunks, candidates, evidence, Facts Gate, Blueprint, and creation.

## Public Tools

- `source_research_submit_candidates`: Source Researcher only. Persists bounded model-discovered candidates from explicit work/character intent.
- `source_research_status`: Source Researcher and Director read the current batch and candidate states.
- `source_research_approve`: Director only and OpenCode ask-protected. Records the exact approved candidate IDs and batch revision. Approval requires at least two families and an official source when one is available, unless an explicit single-family fallback boolean and non-empty reason are audited.
- `source_research_fetch_approved`: Source Researcher only. Fetches only approved candidates and ingests each as an immutable source revision.

All tools are project scoped and available only at `intake`. Search, status, and fetch do not require a Workflow task or lease. Approval is a mutation and requires exact batch revision.

## Source Classification

Candidates are classified as `official`, `encyclopedia`, or `wiki`, and the engine derives source family from the canonical URL and approved domains. All Wikipedia language hosts share `platform:wikipedia.org`; changing language does not add diversity. The model may not supply family authority or label a source official solely because the page claims to be official.

Fetched source tiers map as follows:

- official -> `official`
- encyclopedia -> `unknown`
- wiki -> `common_fanon`

## Failure Modes

- Missing API key: `WEB_SEARCH_PROVIDER_NOT_CONFIGURED`
- Provider rejection or malformed response: `WEB_SEARCH_PROVIDER_FAILED`
- No useful candidates: a valid empty batch, not fabricated results
- Stale approval revision: `SOURCE_RESEARCH_REVISION_CONFLICT`
- Insufficient source families: `SOURCE_RESEARCH_DIVERSITY_REQUIRED`
- Available official omitted: `SOURCE_RESEARCH_OFFICIAL_REQUIRED`
- Final redirect family differs: `SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH`
- Unapproved candidate fetch: `SOURCE_RESEARCH_NOT_APPROVED`
- Unsafe target or redirect: `WEB_FETCH_TARGET_DENIED`
- Timeout or byte limit: `WEB_FETCH_TIMEOUT` / `WEB_FETCH_TOO_LARGE`
- Unsupported media type or unusable text: `WEB_FETCH_CONTENT_UNSUPPORTED`
- Existing source ID with different content remains protected by normal ingestion invariants

Partial multi-source fetch is resumable: each successful candidate produces its own immutable source. Repeating fetch skips candidates whose exact source revision lineage is already recorded and retries only incomplete approved candidates.

## Testing

- Schema tests for deterministic IDs, statuses, strict parsing, and approval revision.
- Provider tests with injected fetch for headers, query encoding, bounded count, malformed responses, and secret non-disclosure.
- Fetcher tests for HTTP scheme, URL credentials, private IPv4/IPv6, DNS results, redirects, timeout, size, media type, and HTML extraction.
- Registry tests for immutable batches, stale approval, unknown candidates, idempotent approval, and fetch lineage.
- Authorization tests proving only Source Researcher can search/fetch and only Director can approve.
- MCP integration test: search -> Director approval -> fetch -> immutable source -> workflow start with exact source reference.
- Full build, tests, TypeScript, ESLint, Agent lint, and dist verification.

## Non-goals

- Browser automation, JavaScript-rendered pages, login sessions, CAPTCHA bypass, robots circumvention, image OCR, PDF extraction, social-media scraping, automatic source approval, and automatic fact acceptance.
- General-purpose browsing for Director, Fact Curator, or Creator Agents.
