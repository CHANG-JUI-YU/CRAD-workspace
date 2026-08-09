# Agent/Skill template contract map

Every migrated Skill has a fixed, model-readable contract in
`packages/core/src/templates.ts`. Agents interact with it through two
high-level calls:

- `workspace_template_context({ kind })` returns the guide, examples and JSON Schema.
- `workspace_template_submit({ kind, ...value })` validates and stores the value.

The Agent does not provide storage operation identifiers, lease information,
CAS values, fetch transport fields or encoded files. The runtime creates those
details after a proposal passes the template schema.

| Skill | Template kind | Main invariant |
| --- | --- | --- |
| director-orchestration | `director_routing` | phase and next action are explicit |
| source-research | `source_research` | query and candidate source shape |
| fact-curation | `fact_curation` | every claim has evidence |
| fact-review | `fact_review` | every decision has a reason |
| zhuji-creation | `zhuji` | seven-module Zod contract |
| palette-creation | `palette` | four palette module kinds |
| character-critique | `review` | evidence-backed findings |
| relationship-creation | `relationships` | all participant pairs have perspectives |
| greetings-creation | `greetings` | exactly one primary greeting |
| greetings-critique | `review` | evidence-backed findings |
| mode-conversion | `conversion` | source/target modes differ and mappings explain loss |
| card-import-analysis | `import_analysis` | source fields map to target contracts |
| world-lore-creation | `world` | every entry has a category and content |
| world-lore-critique | `review` | evidence-backed findings |
| mvu-creation | `plugin` | typed variables and update rules |
| mvu-critique | `review` | typed proposal findings |
| ejs-creation | `plugin` | typed branches; raw delimiters rejected |
| ejs-critique | `review` | typed proposal findings |
| html-creation | `plugin` | allowlisted components and bindings |
| html-critique | `review` | typed proposal findings |

The existing Zhuji-specific context and submit endpoints remain available as
backwards-compatible aliases of the same core contract family.

