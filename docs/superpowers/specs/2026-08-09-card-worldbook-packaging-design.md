# Card and Worldbook Packaging Design

Date: 2026-08-09  
Status: Approved design; implementation pending spec review

## Goal

Change the V3 card export boundary so one Tavern-loadable CCv3 card uses the
project name as its card name, keeps semantic card fields empty except for
project greetings, and binds the authored content to the card's embedded
character worldbook.

The export must ask for a mode selection before every build when both Zhuji and
palette modules are available. The selection is per build operation and is not
remembered for the next build.

## Non-goals

- Do not change the workflow-gates/editable-publish design or its spec.
- Do not export the Blueprint artifact.
- Do not export accepted facts.
- Do not export the base `character` artifact as a separate worldbook entry.
- Do not turn Zhuji `self_introduction` into a card greeting.
- Do not create separate standalone worldbook files as the source of truth; the
  worldbook is embedded in `data.character_book`.

## Card envelope

The compiler continues to emit a schema-valid Character Card V3 envelope:

```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {}
}
```

`data.name` is `ProjectState.project_name`, falling back to `project_id` only
when a project has no display name. The following semantic fields are empty:

- `description`
- `personality`
- `scenario`
- `mes_example`
- `creator_notes`
- `system_prompt`
- `post_history_instructions`

`data.wardrobe` is omitted because wardrobe content is emitted into the
worldbook. The required compatibility fields remain present:

- `creator: "ST Workspace V3"`
- `character_version: "3.0"`
- `tags: []`
- `extensions: { ...technical provenance... }`

These values are format/provenance data, not character prose.

## Greeting projection

Only `greeting` artifacts populate card greeting fields:

- primary greeting -> `data.first_mes`
- alternate greetings -> `data.alternate_greetings`
- group-only greetings -> `data.group_only_greetings`

If there is no greeting artifact, `first_mes` is `""` and both greeting arrays
are empty. Zhuji `self_introduction` is never used as a fallback greeting.

## Embedded worldbook

The compiler always embeds the worldbook at `data.character_book` and sets:

```text
character_book.name = "<card name>_世界書"
character_book.description = ""
```

Entries are deterministic and use the existing CCv3 lore-entry contract. Each
entry has a display `name`, full `content`, stable id, enabled state, keys,
insertion order, and non-regex behavior.

### World lore

Each entry in a `world_lore` artifact becomes one worldbook entry:

- entry name = source `title`
- entry content = source `content`

The source `category`, aliases and keys may remain as worldbook activation or
technical metadata, but the user-visible semantic contract is title plus
content. There is no additional wrapper entry called `世界設定` unless the
source world-lore entry itself has that title.

### Relationships

Each project-level relationship artifact becomes one entry named `關係`.
Its content is a readable complete relationship overview containing the
participants, character summaries, directional perspectives, groups, network
summary, conflict triggers and intimacy opportunities. It is not split by
character.

### Wardrobe

Each latest wardrobe artifact becomes one entry named:

```text
<character display name>_衣櫃
```

The complete wardrobe Markdown is retained as the entry content. Character
display names are resolved from the corresponding character artifact; the
character id is used only as a deterministic fallback.

### Mode modules

Latest mode artifacts are filtered by the per-build selection. Each selected
module becomes one entry named:

```text
<character display name>_<localized module name>
```

The localized module names are fixed and are never taken from an English
internal key:

| Mode | Internal key | Worldbook name |
| --- | --- | --- |
| Zhuji | `appearance` | 外觀 |
| Zhuji | `inner_nature` | 內在本質 |
| Zhuji | `extension` | 延伸設定 |
| Zhuji | `trait_refinement` | 特質細化 |
| Zhuji | `trait_dialogue` | 特質對話 |
| Zhuji | `scene_dialogue` | 場景對話 |
| Zhuji | `self_introduction` | 自我介紹 |
| Palette | `basic_information` | 基本資訊 |
| Palette | `personality_palette` | 性格調色盤 |
| Palette | `tri_faceted` | 三面性 |
| Palette | `secondary_interpretation` | 二次詮釋 |

Module content preserves the authored module information in a deterministic,
readable representation. The compiler does not also copy it into
`description`, `personality` or `scenario`.

### Excluded and technical content

Blueprints, accepted facts and base character artifacts are not emitted as
semantic worldbook entries. Plugin contributions remain in their typed CCv3
extension locations because regex/helper/MVU resources are executable card
resources rather than lore prose; their build trace remains a workspace
technical file.

## Mode selection and resume

The compiler accepts an explicit selection:

```text
zhuji | palette | both
```

BuildService determines the available modes from the latest mode artifacts:

- only Zhuji available -> select `zhuji` automatically
- only palette available -> select `palette` automatically
- neither available -> emit no mode entries
- both available and no selection supplied -> set the same build operation to
  `needs_input` and ask for `珠璣`、`調色盤` or `兩者`

The runtime recognizes a valid response to a pending build-mode question and
resumes that exact operation with the selected mode. An invalid response keeps
the operation pending, returns the same question, and does not create a second
build operation. The selection is not persisted as project preference; a later
build asks again when both modes still exist.

The selection applies to every compiler invocation that produces a card
preview or publish output, so a preview and its later publish cannot silently
use different implicit mode sets.

## Legacy workspace-bundle repair

`compileWorkspaceBundle` and the CLI `repair-export` command use the same card
projection rules. A pre-CCv3 bundle's Blueprint is discarded from the card,
its available mode modules are placed in the embedded worldbook using the
localized names, and absent greetings remain empty. In-place repair continues
to create a `.bundle-backup.json` before replacing the invalid JSON.

## Transaction and output behavior

The existing publish transaction, expected-revision CAS, PNG metadata and
plugin trace behavior remain unchanged. The canonical JSON, user-facing named
JSON aliases and PNG all represent the selected mode set and are committed as
one publish result. The PNG continues to carry `ccv3` metadata and the V2
`chara` backfill.

## Verification

Automated coverage must verify:

1. project name is used for `data.name`;
2. semantic card fields are empty except for greeting fields;
3. the embedded worldbook name is `<card name>_世界書`;
4. world-lore title/content entries are preserved;
5. relationships produce one complete `關係` entry;
6. wardrobes use `<character>_衣櫃` and retain full Markdown;
7. character artifacts, Blueprint and accepted facts are excluded;
8. Zhuji and palette module names use the fixed Chinese mapping;
9. `zhuji`, `palette` and `both` selections filter entries correctly;
10. both-mode builds ask once, resume the same operation, reject invalid
    answers without creating another operation, and ask again on a later build;
11. greeting artifacts alone populate `first_mes`, alternate and group-only
    greeting fields;
12. legacy bundle repair does not map `self_introduction` to `first_mes`;
13. CCv3 schema validation and PNG round-trip remain successful.
