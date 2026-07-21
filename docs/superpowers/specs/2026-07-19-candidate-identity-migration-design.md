# Persistent Candidate Identity

## Goal

Ensure future candidate batches cannot make an already committed Fact decision impossible to replay.

## Design

- Every new Fact decision is normalized to the resolved `candidate-occurrence-*` ID before journal append.
- Caller-provided legacy raw IDs may be resolved for compatibility but are never persisted by new mutations.
- A Director-only explicit migration binds legacy raw decision IDs to exact occurrence IDs when the mapping is unique.
- Bindings are append-only, auditable, and validated against batch lineage. Ambiguous legacy identities fail closed.
- Existing immutable candidate batches and historical decision events are never rewritten.

## Compatibility

- Unique legacy raw IDs remain readable before migration.
- Migration is explicit and idempotent; startup performs no automatic rewrite.

## Acceptance

- A raw-ID review writes an occurrence ID to the journal.
- Adding a later batch with the same raw ID does not change replay results.
- Unique legacy decisions migrate successfully; ambiguous ones remain unchanged and report a stable error.
