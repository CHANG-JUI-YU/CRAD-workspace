# Candidate Occurrence Identity Design

## Problem

Fact Curator sessions process chunks independently and currently choose `FactCandidate.id`. The schema only rejects duplicate IDs inside one batch, while active review and historical projection assume the same ID is globally unique across every batch. Independent sessions can therefore submit the same ID and make `facts_review_status`, Fact Review, and Facts Gate unusable.

## Goals

- New submissions cannot create cross-batch candidate ID collisions.
- Existing immutable candidate batches, hashes, jobs, summaries, and journals are not rewritten.
- Existing active batches with duplicate raw IDs remain independently reviewable.
- Orphan or historical batch collisions do not block the latest active curation.
- Old decisions that reference a globally unique raw candidate ID remain replayable.
- Ambiguous old decisions fail closed rather than being assigned to an arbitrary occurrence.

## Identity Model

`FactCandidate.id` remains part of the persisted batch contract for backward compatibility. Two additional engine identities are introduced.

### New persisted candidates

The submission draft no longer accepts candidate `id`, `created_by`, or `created_at`. Before hashing the batch, the server generates each candidate ID from canonical data containing:

- job ID
- chunk ID and hash
- zero-based candidate ordinal
- candidate semantic fields and resolved evidence

The ID is `candidate-<sha256 digest>`. Trusted creator identity comes from the authenticated Agent, and candidate time comes from the batch submission time. Identical retries produce the same IDs and batch hash; different chunks, ordinals, or content produce different IDs.

### Existing persisted candidates

Every persisted occurrence receives a derived, non-persisted ID:

`candidate-occurrence-<sha256(batch_id, raw_candidate_id)>`

The resolver returns a cloned candidate whose public `id` is the occurrence ID and whose extensions preserve `source_candidate_id` and `source_batch_id`. Immutable batch bytes and hashes remain unchanged.

## Indexing and Review

- The active index returns occurrence-qualified candidates from only the latest completed curation summary.
- The historical index always indexes every occurrence ID.
- The historical index also exposes a raw ID only when that raw ID occurs exactly once across all persisted batches, preserving old decision replay.
- A duplicated raw ID is never assigned to one occurrence arbitrarily.
- New `fact_review` decisions use the occurrence ID returned by `facts_review_status`.
- Readiness resolves old raw decision IDs to an active occurrence only when exactly one active occurrence preserves that raw ID.
- Orphan batches remain auditable through the historical index but never enter the active review set.

## Errors

- Submission schemas reject caller-supplied candidate identity fields.
- A decision referencing neither an active occurrence ID nor an unambiguous legacy raw ID returns `FACT_CANDIDATE_NOT_ACTIVE`.
- Historical journals containing an ambiguous raw candidate ID fail projection verification with `FACT_EVENT_DECISION_INVALID`; no heuristic migration is attempted.

## Agent Contract

Fact Curator submits candidate semantics, scope, coverage dimensions, evidence locators, confidence, and classification only. It must not invent candidate IDs or coordinate counters across sessions. Director reviews the exact IDs returned by `facts_review_status`.

## Tests

- Submission draft rejects `id`, `created_by`, and `created_at`.
- Server-generated IDs are deterministic and differ across chunk/content/ordinal.
- Two active batches with the same legacy raw ID produce two distinct occurrence IDs.
- Active status excludes orphan batches while historical indexing tolerates their collisions.
- Each active duplicate occurrence can be reviewed independently.
- Unique legacy raw decisions still replay.
- Ambiguous legacy raw decisions fail closed.
- Existing end-to-end Source Adaptation flow uses server-generated IDs.

## Non-goals

- Rewriting old immutable batches or journals.
- Semantic deduplication of equivalent facts; that remains the deduplicate/conflict workflow.
- Automatically selecting which duplicate legacy occurrence an ambiguous old decision intended.
