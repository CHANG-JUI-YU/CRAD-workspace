# Character Folder Naming Design

Date: 2026-08-09
Status: Implemented

## Scope

When a project contains multiple characters, every character's user-facing
files must be grouped under one deterministic directory. The current
materializer uses `character_id` for zhuji/palette modules but can use an
artifact display name for a character document, so the same character can be
split across directories.

This change standardizes new materialized paths to
`characters/<character-id>-<display-name>/` while keeping the existing
subdirectories and file names. The workflow-gates/editable-publish work is
out of scope.

## Design decisions

### 1. Canonical directory name

For a structured character document:

```text
characters/<safe(character_id)>-<safe(display_name)>/
```

For example:

```text
characters/kanzaki-rina-神崎-莉奈/
```

If no structured character document is available for the ID, the fallback is
`characters/<safe(character_id)>/`. The ID prefix guarantees that two
characters with the same display name still receive different directories.
The existing `safeSegment` rules remain authoritative for path safety,
reserved characters, whitespace, and length limits.

### 2. One resolver for all character artifacts

`FileProjectRepository` derives a character-name map from the current state
before producing materialized files:

- the latest character artifact for each parsed `document.id` supplies its
  `display_name`; latest means the last matching record in `state.artifacts`,
  consistent with the repository's existing revision ordering;
- zhuji and palette artifacts use their parsed `character_id` to look up the
  same directory name; and
- a character artifact with a valid structured document uses that document ID,
  not the artifact's display name, to select its directory.

An unstructured free-text character artifact without a parseable document ID
keeps the existing artifact-name fallback for its own file; mode artifacts
without a matching character document use the ID-only directory.

The resolver is used by character, zhuji, and palette path generation. No new
state field or artifact schema field is required, and compiler/project
metadata continues to use the existing ID/display-name fields.

### 3. Existing subdirectory layout

The standardized character root contains:

```text
characters/<character-folder>/
├─ character.json or character.md
├─ zhuji/<module>.json
└─ palette/<module>.json
```

All non-character paths remain unchanged: blueprint stays at the project
root, relationships/world/greetings stay at their current root files, and
plugins/other artifacts keep their current directories.

### 4. Revision and rename behavior

A changed `display_name` produces a new canonical path on the next
materialization. The state file remains authoritative. This change does not
delete old user-facing files during reconciliation; cleanup of orphaned paths
is intentionally separate. Fresh projects, which are the validation target,
start with only the canonical path.

## Data flow

```text
state.artifacts
      |
      +--> latest character document: id -> display_name
      |
      +--> zhuji/palette character_id
      |
      v
characters/<id>-<display-name>/<mode>/<module>.json
```

## Error handling

- Invalid path characters are normalized by `safeSegment`.
- Missing or malformed character document content does not block materializing
  mode artifacts; those artifacts use the ID-only fallback directory.
- Two IDs with the same display name remain isolated because the ID is always
  the first path segment.
- Existing atomic materialization and rollback behavior is unchanged.

## Testing

Add tests proving:

1. one structured character plus zhuji and palette artifacts share the
   `id-display-name` directory;
2. two characters with different IDs and the same display name remain in
   separate directories;
3. a mode-only character uses the ID-only fallback;
4. unsafe/space-containing IDs and names are safely normalized; and
5. non-character artifact paths are unchanged.

## Alternatives considered

1. **Keep ID-only directories:** simple and stable, but does not make a
   multi-character project easy to inspect by name.
2. **Store a folder name in every artifact:** explicit, but duplicates mutable
   display-name state and requires schema changes across all authoring paths.
3. **Derive one shared directory resolver from the latest character document
   (selected):** keeps state normalized, makes all related artifacts agree, and
   provides a safe ID-only fallback.
