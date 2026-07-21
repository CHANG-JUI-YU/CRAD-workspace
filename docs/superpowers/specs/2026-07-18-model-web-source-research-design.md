# Model Web Source Research Design

## Goal

Remove the paid Brave Search dependency. Source Researcher discovers source URLs with model/OpenCode web access, then submits bounded candidates into the existing approval, controlled-fetch, immutable-source, and evidence workflow.

## Design

- Source Researcher may use OpenCode `webfetch`; no API key is configured or persisted.
- `source_research_submit_candidates` accepts the original bounded work/character query plus at most ten model-discovered URL descriptors, each with its own page language.
- The ingestion module canonicalizes URLs, derives source class and source family from allowed official domains or known encyclopedia/wiki hosts, removes unsupported results before applying `result_count`, creates deterministic candidate IDs, and persists an exact revisioned research batch. Wikipedia language variants share `platform:wikipedia.org`.
- Director continues to read the batch, present candidates, and approve exact candidate IDs at an exact batch revision.
- Controlled Fetcher remains the only path that turns approved URLs into immutable source snapshots. Search snippets remain discovery metadata and never become evidence.
- Approval normally requires at least two source families. If any official candidate is available, the approved set must include an official candidate. A single-family approval requires an explicit boolean fallback and non-empty reason, both persisted in the approval audit.
- Controlled Fetcher re-derives the family from the final redirected URL and rejects `SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH` before intake when it differs from the approved candidate family.
- New batches use `provider: model_web`. Existing persisted `provider: brave` batches remain readable and fetchable, but no Brave request code or secret configuration remains.
- Legacy batches without candidate family or language remain readable; runtime derivation supplies family and falls back to the batch query language.

## Errors

- Empty or unsupported candidate sets are valid and produce an empty batch for transparent review.
- Invalid URLs are dropped; unsafe fetch targets remain blocked by DNS/SSRF checks during controlled fetch.
- Stale approvals, unknown candidates, insufficient family diversity, missing required official selection, malformed batches, oversized pages, unsupported content, and redirect-family violations fail closed.

## Verification

- Contract tests cover deterministic model-web registration, filter-before-count behavior, strict source classes, URL-derived families, Wikipedia language-family normalization, per-candidate language, legacy runtime derivation, diversity and official approval, fallback audit, redirect mismatch, and immutable snapshot lineage.
- MCP tests cover Source Researcher visibility, candidate submission, explicit fallback approval audit, controlled fetch, and workflow source refs without any API key.
- Build, full tests, typecheck, ESLint, Agent lint, and dist inspection must pass without modifying `projects/*`.
