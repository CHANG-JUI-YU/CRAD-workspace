# ST-workspace-v3 BUG-29/BUG-30 Repair Design

## Scope and invariants

This change is based on `e5e78cf0886eef0bddc9be18451047ba9d766cfb` and is isolated to the Luna worktree/branch `codex/bug-29-30-luna`. It does not inspect, merge, or modify the main worktree's later BUG-25/26/27 work. No new dependency, network access, runtime/server change, low-level user parameter, merge, or push is allowed.

The implementation is limited to the approved files: the PNG adapter and tests, conversion and its tests, and only the compiler/core template surfaces needed by these two bugs. Existing typed `CoreError` is the error boundary.

## BUG-29: PNG metadata and fallback image

`parsePngChunks` remains responsible for PNG signature, chunk bounds, ordering, CRC, IEND, and trailing-data validation. `tEXt` decoding will follow the PNG Latin-1 byte contract: the keyword remains validated as a legal 1–79 byte keyword, while text bytes are decoded as Latin-1 rather than being restricted to ASCII. This means an unrelated legal non-ASCII metadata chunk is readable and can pass through a rewrite without changing its raw bytes.

Only the `ccv3` and `chara` keywords are interpreted as card metadata. Their payloads remain ASCII Base64 with strict shape validation, fatal UTF-8 decoding, JSON parsing, and the existing CCv3 schema validation at the card boundary. A malformed card payload therefore still fails closed even though unrelated Latin-1 metadata is tolerated.

`writeCardToPng` will preserve the input PNG's raw non-card chunks, image data, order, IEND, and CRCs. Existing card chunks are removed and canonical ccv3/chara chunks are inserted immediately before IEND. With no input, it will construct a deterministic 512×768, 8-bit RGBA PNG filled with an opaque neutral color; it will not synthesize character imagery or text. The existing input path always takes precedence over this fallback.

Tests will cover unrelated Latin-1 tEXt, damaged card Base64/JSON, raw image and metadata preservation, placeholder dimensions and non-transparency, JSON/PNG round trips, and existing CCv3/chara compatibility.

## BUG-30: complete, latest, Blueprint-bound conversion

The conversion service will first collapse artifacts by logical `key`, preserving only the last record for each key. It will then select source-mode artifacts for the requested character and validate that the latest formal source set contains exactly the required mode modules described by the existing domain manifest (`ZHUJI_REQUIRED_MODULES` / `PALETTE_REQUIRED_MODULES`). Missing or ambiguous source modules raise a recoverable typed error whose details enumerate the missing/invalid modules. Source provenance is built only from these adopted latest records.

Target modules are validated against the same manifest: every required module must occur exactly once, every module must use the target mode, and schema-disallowed/unknown module names are rejected. The target proposal schemas remain the structural validation boundary; service-level checks provide typed completeness and duplicate diagnostics.

When a current recorded Blueprint precheck exists, source artifacts must carry the same `blueprint_precheck_id` and `blueprint_precheck_revision`; an artifact bound to another revision (or not bound when the project has a current Blueprint) is rejected as stale. Legacy projects without a recorded precheck remain compatible. Conversion report artifacts, target artifact records, and target module `card-workspace` provenance receive the current binding using the existing artifact/gate field names, so the compiler and workflow gate can recognize it.

The conversion report includes the adopted source artifact IDs and revisions, mapping digest, modes, target module set, and Blueprint binding. Target artifact content includes deterministic conversion provenance, so a changed source/mapping/Blueprint binding creates a real revision. Identical repeated conversion reuses the existing conversion report and target artifacts; it does not append new artifact revisions. The project changes from `published` to `ready` only when at least one new conversion or target artifact is materialized; a no-op leaves `published` intact.

Tests will cover history selection by logical key, incomplete source sets with listed missing modules, target missing/duplicate/wrong/unknown modules, stale Blueprint bindings, complete conversion in both directions, provenance/audit latest-source references, published no-op behavior, and a real changed conversion that creates new drafts and follows the existing status rule.

## Verification

Run the adapter PNG tests, domain conversion tests, any changed compiler/core template tests, and `pnpm typecheck`. Do not run or modify unrelated BUG-28/31–35 surfaces or the full workspace E2E suite.
