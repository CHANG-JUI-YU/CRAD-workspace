# Transaction Safety and Atomic Publish

## Goal

Prevent concurrent writers, fail closed on damaged recovery state, and publish build artifacts, exports, workflow journal, and workflow projection as one recoverable operation.

## Design

- Locks contain a schema version, PID, creation time, and an unpredictable owner token.
- Lock creation, stale takeover, and release are ownership checked. Malformed locks and transaction journals block writes.
- Recovery runs only while holding the relevant lock. Legacy valid dead-PID locks remain explicitly recoverable.
- Compiler output is prepared as a publish plan containing operations and CAS expectations; it does not publish directly.
- Formal publication commits build output, export archives, current exports, publish receipt, workflow journal, and workflow projection in one workspace transaction.
- Workspace publication coordinates the workspace and project lock domains in canonical order.
- Direct compiler `publish: true` is rejected so Publish Gate cannot be bypassed.

## Compatibility

- Existing valid transaction journals and legacy lock records remain readable.
- Malformed state is never guessed or silently removed.
- No existing project is rewritten during startup.

## Acceptance

- Competing stale-lock claimers cannot both write.
- Ownership loss cannot delete a successor lock.
- Torn journals fail closed before changing targets.
- Fault injection at every publish phase leaves either all old state or all new state.
- A committed publish always has matching exports, receipt, journal, and `published` projection.
