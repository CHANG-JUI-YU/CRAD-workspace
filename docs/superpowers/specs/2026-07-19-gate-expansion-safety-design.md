# Gate and Expansion Safety

## Goal

Make Gate decisions authoritative and recoverable, and prevent Character Expansion proposals from modifying formal author data before approval.

## Gate Decisions

- One transport-neutral module derives the current exact snapshot for Facts, Blueprint, Content, and Publish Gates.
- Callers submit intent; the engine validates or supplies authoritative revisions. Empty or stale snapshots cannot be approved.
- Facts rejection starts audited re-curation.
- General Blueprint rejection creates one Blueprint successor task.
- Content rejection records `needs_revision_scope`; Director must choose exact character, relationship, world, or greetings targets.
- Publish rejection requires `repreview`, `content_revision`, or `cancel`; it never guesses an authoring task.
- Preview creation requires `compile_preview`, an approved current Content Gate, and its exact current snapshot.

## Character Expansion V2

- New expansion runs write immutable candidates under `.workflow/candidates/character-expansion/` only.
- Begin and amend do not modify `project.yaml`, `blueprint.yaml`, placeholders, relationships, reviews, Gates, or previews.
- Blueprint approval validates the exact candidate and base revisions, then atomically materializes author files with workflow journal/projection.
- Creator tasks are created only by the following workflow advance.
- Existing V1 materialized runs remain on an explicit legacy branch and are never auto-converted.

## Acceptance

- MCP and Dashboard use identical Gate rules.
- Rejecting any Gate has one legal next route and cannot dead-end silently.
- Rejected or abandoned expansion candidates leave formal author files byte-identical.
- Faults during expansion approval materialization fully roll back.
