# Facts Review Pagination Design

## Scope

Fix oversized `facts_review_status` responses, prevent raw candidate identity from entering new review mutations, and expose Fact/Conflict Registers through controlled artifact reads.

## Status Contract

`facts_review_status` accepts optional `limit` (default 20, maximum 50), opaque `cursor`, and `review_state` (`all`, `reviewed`, `unreviewed`). It returns aggregate counts, current projection revisions, coverage, Gate readiness, and one bounded page.

Page items expose exactly one actionable identity: `candidate_id`, which is always an engine-qualified `candidate-occurrence-<64 hex>`. Internal lineage IDs, candidate extensions, creator metadata, and duplicated full ID arrays are omitted. Evidence retains exact quote and source/chunk coordinates required for review.

The cursor binds the active curation result revision, filter, and last occurrence ID. A changed active curation makes the cursor stale. Fact review decisions do not change the active candidate set, so they do not invalidate pagination; each status response returns the latest Fact projection revision for the next mutation.

## Review Mutation

New MCP `fact_review` calls require an occurrence ID. Ingestion keeps legacy resolution for replay and explicit migration only. Raw IDs at the MCP boundary fail with `FACT_CANDIDATE_OCCURRENCE_ID_REQUIRED`, while a genuinely absent occurrence remains `FACT_CANDIDATE_NOT_ACTIVE`.

## Controlled Artifacts

`project_artifact_list/read` includes fixed artifacts:

- `fact-register`, kind `fact_register`, contract `fact-register@1`
- `conflict-register`, kind `conflict_register`, contract `conflict-register@1`

Descriptor revisions use `computeRevision(parsedProjection)`, matching Facts Gate references. Reads run `verifyFactProjection`, then recheck the exact revision so schema, semantic revision, journal projection, and list/read races fail closed.

## Verification

Tests cover 140 candidates across pages, stable continuation after one acceptance, stale cursors after curation replacement, response size bounds, omission of raw IDs, raw-ID mutation rejection, exact Fact/Conflict Register reads, stale revisions, and tampered projections. Existing projects and immutable candidate batches are not rewritten.
