# Web Character Research Implementation Plan

## Slice 1: Contracts and persistence

1. Add strict research query, candidate, batch, approval, and fetch-result schemas.
2. Add an ingestion research registry using canonical JSON, deterministic revisions, create-only batch files, and CAS updates.
3. Cover empty results, stale approval, unknown candidates, and idempotency.

## Slice 2: Search provider

1. Define a narrow provider interface and Brave adapter.
2. Superseded: paid provider configuration was removed in favor of model-discovered candidate submission.
3. Bound result count, normalize URLs, reject unsupported protocols, and map results into controlled candidates.
4. Test through injected `fetch` without network access.

## Slice 3: Controlled fetch and snapshot bridge

1. Add DNS/IP policy, redirect revalidation, timeout, byte, and media-type limits.
2. Extract deterministic plain text from HTML without script execution.
3. Fetch approved candidates and call `intakeRetrievedSource` with research lineage.
4. Make repeated and partially completed fetch runs resumable.

## Slice 4: MCP and authorization

1. Register search, status, approve, and approved-fetch tools.
2. Add `source.research` to Source Researcher and `source.approve` to Director.
3. Add intake-stage tool policy and Agent lint invariants.
4. Mark Director approval ask-protected in `opencode.jsonc`.

## Slice 5: Agent behavior

1. Add Source Researcher prompt, skill, personality, MCP process, and Director delegation permission.
2. Update Director routing to collect work/character identity, delegate bounded search, present candidates, request approval, delegate fetch, then call `workflow_start`.
3. Explicitly prohibit snippets as facts and arbitrary URL fetching.

## Slice 6: Verification

1. Add schema, ingestion, MCP integration, authorization, lifecycle visibility, and Agent lint tests.
2. Run targeted tests while implementing.
3. Run full `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm agent-lint`.
4. Confirm dist contains all four tools and no project data changed.
