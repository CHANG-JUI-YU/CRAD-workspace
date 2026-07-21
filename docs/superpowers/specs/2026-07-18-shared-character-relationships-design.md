# Shared Character Relationships Module

## Goal

Add an optional, project-level character relationships module for multi-character cards. The module describes directional character perspectives, overlapping social groups, and whole-network stability without duplicating the same relationship across per-character mode modules.

## Scope

- Available only to `character_card` projects with at least two characters.
- Supports Zhuji, Palette, and mixed-mode rosters.
- A project has at most one active `relationships.yaml`.
- The module may include the full roster or a subset of at least two characters.
- Disabled projects create no placeholder, task, artifact, or compiled lore entry.
- This work does not add a per-character relationships module or a new global workflow stage.

## Blueprint Contract

Blueprint gains an optional `relationships` object:

```yaml
relationships:
  enabled: true
  character_ids: [character-1, character-2]
  requirements: []
  extensions: {}
```

When enabled, `character_ids` must be unique, reference Blueprint roster members, and contain at least two characters. Enabling it for a single-character project is invalid. The Blueprint is the sole enablement authority; the manifest does not duplicate this flag.

## Author Contract

The fixed author path is `relationships.yaml`, with contract `relationships@1`. The document contains:

- `team_code`: six uppercase alphanumeric characters, generated once by the engine and then persisted.
- `character_ids`: the exact participating roster subset.
- `character_summaries`: one concise identity summary per participant.
- `perspectives`: a complete directional matrix. Every ordered pair is distinct, and self-pairs record self-perception.
- `groups`: overlapping groups with members, formation cause, operating pattern, exclusivity, latent conflicts, and joining conditions.
- `summary`: overall network character, inter-group relations, stability, concrete conflict triggers and severity, and intimacy-development opportunities.
- `compile`, `provenance`, and `extensions` using existing author conventions.

The document is structured YAML. Original prompt-only markers and chain-of-thought are not persisted. The Creator may use a concise private planning process, but only the formal document is submitted.

## Compiled Output

The compiler creates one ownerless lore node, `project.relationships`. Activation keys are derived from participant display names and aliases. Its rendered body is wrapped in the persisted code:

```text
<team_ABC123>
...
</team_ABC123>
```

The body presents character summaries, the directional matrix, groups, and network summary. It does not include hidden reasoning or scene enactment.

## Workflow

A mode-neutral `relationship-creator` owns `relationships` proposals. The engine creates one `create-relationships` task after every participating character's final required mode module is completed. Non-participating characters are not dependencies.

The task receives the Blueprint, accepted facts, and all current participant character artifacts. Its proposal writes only `relationships.yaml`. Proposal ownership, participant scope, exact base revision, and project identity are enforced by the engine.

Character Critic receives the relationship artifact together with participant character artifacts and checks directional consistency, scope, group membership, factual provenance, and contradictions with character modules.

Character revision may target the exact current relationship artifact. Character expansion includes it in `affected_artifact_ids` only when the new character joins the graph or the approved expansion Blueprint changes existing relationships. Relationship revision stales old reviews and preview and resets downstream Content and Publish gates using existing author-artifact semantics.

Generic transient task recovery supports the new Creator task in `authoring`.

## Agent Behavior

Relationship Creator:

- Reads only task-bound exact artifacts.
- Supports Zhuji, Palette, and mixed-mode participants.
- Treats row character as the viewpoint and column character as the target.
- Does not infer symmetry between opposite directions.
- Does not invent important facts outside accepted facts, Blueprint constraints, or explicitly marked creative completion.
- Allows one character to belong to multiple groups.
- Produces settings analysis only, not roleplay or scene enactment.
- Submits structured `relationships@1`; it never writes files directly.

Character Critic additionally verifies all matrix cells, participant references, graph/group consistency, and cross-module continuity.

## Controlled Reads

`task_context`, `project_artifact_list`, and `project_artifact_read` expose the exact relationship artifact with a distinct `relationship_module` kind and `relationships@1` contract. Raw paths remain unavailable.

## Errors

- Relationships enabled for a non-character or single-character project.
- Fewer than two, duplicate, or unknown participant IDs.
- Missing enabled author document.
- Participant set differs from the approved Blueprint.
- Missing or duplicate directional matrix cells.
- Group member outside the participant set.
- Invalid or changed `team_code` during revision.
- Wrong Creator, task, output kind, or target artifact.
- Stale workflow or artifact revision.

## Testing

Regression coverage includes:

- Schema acceptance for full-roster, subset, and mixed-mode projects.
- Rejection of disabled/single-character/unknown/duplicate participant states.
- Initialization creates a placeholder only when enabled and keeps `team_code` stable.
- Task materialization waits for all participant chains and ignores non-participants.
- Proposal ownership and exact replacement revision.
- Character expansion with and without relationship impact.
- Character revision and generic recovery.
- Controlled artifact list/read and Critic task context.
- Compiler normalization, activation keys, stable ordering, `<team_CODE>` rendering, CCv3 export, and disabled omission.
- Full build, test, typecheck, ESLint, Agent lint, and rebuilt runtime distributions.

## Non-Goals

- Persisting chain-of-thought.
- Adding relationships to the required Zhuji seven-module or Palette four-module enums.
- Creating separate copies for each participant.
- Treating the module as a world entry.
- Automatically enabling the module for every multi-character card.
