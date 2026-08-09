# Creation-Time Artifact File Materialization Design

Date: 2026-08-09
Status: Superseded by `2026-08-09-character-scoped-interview-layout-design.md`

> This document records the earlier materializer baseline. The current
> contract keeps the repository-owned atomic projection, but uses semantic
> folders, archives legacy `proposals/`/intermediate exports, and leaves only
> the latest JSON/PNG in `exports/`.

## Scope

ST Workspace V3 currently stores the complete project state in
`.workspace/state.json`. `FileProjectRepository` already contains a
materialized-file layout, but existing projects are not reconciled when they
are reopened, and callers that do not enable `materialize` receive no
user-facing artifact files.

This change makes file-backed project creation usable as a normal workspace:
when materialization is enabled, creating or reopening a project produces the
human-facing files for its current artifacts. The workflow-gates/editable-
publish work remains out of scope and its design file is not modified.

Historical layout migration is now handled by the newer character-scoped
layout design; this file is retained as implementation history.

## Design decisions

### 1. Repository-owned materialization

Materialization remains a responsibility of `FileProjectRepository`, not of
each authoring service. Authoring, import, conversion, review, and interview
flows continue to commit state through the repository. The repository derives
the file set from the committed state and writes it atomically with state
changes.

This keeps all creation paths consistent: a blueprint submitted through the
template path, a character document created by authoring, and a zhuji or
palette module created by a specialist use the same file materializer.

### 2. Reconcile on open and commit

For repositories created with `materialize: true`:

- a new project is initialized with its standard project files;
- every successful commit rewrites the materialized representation from the
  committed state; and
- opening an existing project reconciles its materialized representation even
  when the state file already exists.

The open-time reconciliation is idempotent and does not increment the
project revision or append an audit event. It exists to repair projects made
before materialization was enabled and to restore missing human-facing files.
The state file remains the source of truth.

Repositories with `materialize: false` remain state-only repositories. This
preserves the existing in-memory/test-oriented behavior while making the
server, CLI, and project manager paths explicitly file-backed.

### 3. User-facing file layout

The existing safe path mapping is retained and becomes the public contract:

| Artifact kind | Materialized path |
| --- | --- |
| `blueprint` | `blueprint/blueprint.json` |
| `character` | `characters/<artifact-name>/character.json` or `.md` |
| `zhuji` | `characters/<character_id>/zhuji/<module>.json` |
| `palette` | `characters/<character_id>/palette/<module>.json` |
| `relationship` | `relationships/relationships.json` |
| `world_lore` | `world/<safe-artifact-name>.json` |
| `greeting` | `greetings/greetings.json` |
| `plugin` | `plugins/<plugin_id>.json` or `.md` |
| process/unknown kinds | `.workspace/artifacts/<kind>/<safe-name>.json` or `.md` |

The repository also maintains project operational files such as
`project.json`, `.workspace/interview.json`, `.workspace/workflow.json`,
`sources/manifest.json`, `knowledge/chunks.json`, `facts/register.json`, and
published exports. Existing safe-segment normalization remains mandatory so
artifact names cannot escape the project directory.

### 4. Atomicity and stale-file behavior

The current staged-file/backup/rollback transaction is the write boundary.
Materialized files and state must either represent the same committed state or
the commit fails and the previous state/files are restored.

The materializer must not delete arbitrary user files. This change performs no
open-time deletion: it writes or replaces only the known repository-managed
paths. Artifact revisions with the same logical key overwrite the same public
path; their historical content remains available in `.workspace/state.json`.
Removal of orphaned generated paths is a separate future change and is not
required for creation-time materialization.

### 5. File content

Artifact content is written exactly as stored, with one trailing newline for
text/JSON files when absent. JSON artifacts remain canonical JSON. The
materialized files are projections for direct inspection and editing tools;
state revisions, artifact hashes, and workflow records remain authoritative.

## Data flow

```text
authoring/import/conversion/review/interview
                  |
                  v
       FileProjectRepository.commit/transaction
                  |
                  +--> .workspace/state.json
                  +--> project.json and operational files
                  +--> blueprint / characters / mode / world files
                  +--> exports when a publish exists

existing project open --materialize:true--> reconcile the same file set
```

## Error handling

- Invalid or unsafe repository paths fail with the existing recoverable
  repository path error.
- A materialization write failure fails the commit and triggers the existing
  rollback path; a partially written project is not reported as committed.
- Open-time reconciliation failures surface to the caller instead of being
  silently ignored, because the caller requested a file-backed project.
- Missing optional state collections are represented by the existing empty
  operational files rather than omitted, so a newly created project has a
  predictable directory shape.

## Testing

Add or extend tests to prove:

1. a new materialized project creates the standard files immediately;
2. an existing state-only project is reconciled on `read()` without changing
   its revision;
3. blueprint, character, zhuji, palette, relationship, world, greeting, and
   plugin artifacts land at the documented paths;
4. repeated open/commit reconciliation is idempotent;
5. a materialization failure rolls back state and files together; and
6. state-only repositories do not unexpectedly create user-facing files.

## Alternatives considered

1. **Authoring-service writes:** each authoring/import/conversion path would
   explicitly add a write set. This duplicates path rules and misses future
   creation paths, so it is rejected.
2. **Publish-only export:** generate files only during build/publish. This
   does not satisfy direct inspection after creating a blueprint or character,
   so it is rejected.
3. **Repository-owned reconcile (selected):** one source of truth for every
   creation path, atomic with state, and able to repair existing projects.
