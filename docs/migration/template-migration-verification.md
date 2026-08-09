# Structured template migration verification

The previous migration copied the 20 Skill files but only wired a concrete
schema for Zhuji. This follow-up closes that gap.

- `packages/core/src/templates.ts` registers 14 high-level template kinds and
  all 20 Skill bindings.
- Core Zod schemas emit JSON Schema for MCP input discovery.
- `WorkspaceRuntime.templateContext` exposes a guide, schema and existing
  examples without storage fields.
- `WorkspaceRuntime.submitTemplateProposal` validates, creates the operation,
  persists JSON, writes an audit event and registers source candidates when a
  research proposal includes them.
- `workspace_template_context` and `workspace_template_submit` are available
  over REST and MCP; Zhuji endpoints remain compatible aliases.
- `opencode.jsonc` mounts prompt, base personality, agent personality and Skill
  for every registry Agent, not only Director.

Verification commands:

```text
pnpm agent:lint
pnpm typecheck
pnpm test
```

