# Fact Quality Readiness Design

## Problem

Source Adaptation currently proves that every source chunk produced a batch, but it does not prove that the resulting facts are useful for character adaptation. Empty batches, placeholder candidates, unsupported claims, unscoped candidates, and several language variants of the same Wikipedia platform can still reach Facts Review and satisfy the mechanical workflow.

## Decisions

1. Preserve all immutable batches, jobs, summaries, and review events. Quality changes select a new active curation rather than rewriting history.
2. The latest completed `facts-curation-summary@1` is the authority for the active candidate set. Orphan batches and candidates from earlier curations remain historical and cannot be reviewed or satisfy the current Facts Gate.
3. New submissions reject explicit test, fixture, dummy, and placeholder content. The server overwrites candidate `created_by` and `created_at` with trusted execution identity and time.
4. Character candidates declare one or more controlled coverage dimensions: `identity`, `appearance`, `personality`, `speech`, `habits`, `background`, `relationships`, `goals`, `abilities`, and `world_context`. Legacy candidates without dimensions remain readable but do not satisfy readiness.
5. A primary character is ready only when accepted active source-derived facts cover `identity`, `personality`, `speech`, `habits`, `background`, and `relationships`, plus at least one of `appearance`, `goals`, `abilities`, or `world_context`. Supporting characters require `identity`, `personality`, and `relationships`.
6. Evidence must be exact and source-derived. Agent instructions require the quoted evidence to directly support the submitted value; reasonable extrapolation must use `reasonable_inference`, never `source_fact`.
7. `facts_review_status` returns active candidates, quality diagnostics, source-family diagnostics, per-character coverage, and `gate_ready`. Facts Gate recomputes the same report and rejects insufficient coverage.
8. Web research candidates receive an engine-derived source family. Wikipedia language variants share `platform:wikipedia.org`. Approval normally requires at least two families and, when an official candidate exists, at least one official source. A user may explicitly approve a single-family fallback with a non-empty reason when no better source is available.
9. A completed low-quality curation is restarted through Director-only `facts_recuration_begin`. The previous completed task remains immutable, the workflow returns to `source_processing`, downstream gates reset, and extraction jobs include a curation run identity so they do not reuse old completed results.

## Active Curation

The active curation resolver loads the latest completed `curate-facts` task result, validates its `facts-curation-summary@1` revision, then loads only the exact batch IDs and hashes referenced by that summary. Review and Gate operations reject candidate IDs outside this set.

## Candidate Hygiene

Quality diagnostics are domain-level and shared by submission, review, status, and Gate code. Explicit marker values such as `test`, `test-char`, `placeholder`, `dummy`, `fixture`, `測試`, and `佔位` are rejected when they occupy semantic fields or trusted-identity fields. IDs alone are diagnostic context rather than the sole rejection reason, avoiding accidental rejection of legitimate names containing those substrings.

The server replaces candidate creator metadata. Existing invalid candidates may be rejected for audit purposes but cannot be accepted.

## Source Diversity

Source family is derived from canonical URL and approved domains, never supplied as authority by the model. Registration stores the family and per-candidate language. Approval validates family diversity before fetch. Redirects are reclassified and cannot silently retain an official tier after crossing families.

## Re-curation

`facts_recuration_begin(project_id, run_id, reason, expected_workflow_revision, event_id, occurred_at)` is Director-only and valid in `facts_review` for Source Adaptation when the latest curation is completed. It creates `curate-facts-recurate-<run_id>`, records `facts.recuration.requested`, resets Facts and downstream gates, and returns to `source_processing`. New extraction job identity includes `curation_run_id`; old jobs remain readable history.

## Errors

- `CANDIDATE_PLACEHOLDER_FORBIDDEN`
- `FACT_CANDIDATE_NOT_ACTIVE`
- `FACT_CANDIDATE_QUALITY_DENIED`
- `FACTS_ACTIVE_CURATION_INVALID`
- `FACTS_COVERAGE_INSUFFICIENT`
- `SOURCE_RESEARCH_DIVERSITY_REQUIRED`
- `SOURCE_RESEARCH_OFFICIAL_REQUIRED`
- `SOURCE_RESEARCH_FAMILY_REDIRECT_MISMATCH`
- `FACTS_RECURATION_DENIED`
- `FACTS_RECURATION_ID_CONFLICT`

## Tests

Tests cover placeholder rejection, trusted metadata replacement, active-summary filtering, orphan exclusion, legacy rejection, per-role coverage, Gate blocking, source-family derivation, explicit single-family fallback, redirect reclassification, curation run job identity, re-curation lineage, MCP authorization, Director status, and the full Source Adaptation path from research through a quality-approved Facts Gate.
