# Audit 9 batch 10: maintenance tools and integration docs

## Scope

This batch addresses GitHub issues #149 and #144 from commit
`a4f10e4adabbeb44b5dd6e7548119471c87d0ad8`. The existing untracked
`docs/zhuji-schema-comparison.md` is user-owned and remains outside the change.

## Design

### Maintenance scanner

`tools/audit-truncation-scan.ts` will expose a small, testable scan API and a
CLI parser. The default input is `projects` relative to the current working
directory. A missing path, a non-directory path, an unreadable state file,
invalid JSON, an empty directory without `--allow-empty`, or a truncated state
will produce a non-zero exit code and a diagnostic containing the relevant
path. `--allow-empty` only changes the zero-state-file decision; it never
converts unreadable, invalid, or truncated input into success. The root
`audit:truncation` script and help text will document usage and exit codes.

### Structured agent lint

The lint command will parse `registry.yaml` and `aliases.yaml` with a YAML
parser and `opencode.jsonc` with a JSONC parser. Each parsed document will be
validated before use, including agent records, resource bindings, aliases,
OpenCode agent prompts, and the remote MCP entry. Runtime agent definitions
and aliases will be imported from the TypeScript registry instead of parsing
its source text.

Expected active resources will be derived from the registry and actual
bindings: unique prompt paths, personality IDs, skill IDs, runtime agent IDs,
and alias targets. Shared resources remain one set member and are therefore
not falsely reported as missing. The formal base personalities and runtime
instructions are checked as separate foundational resources. Set equality
will report missing and orphan resources without numeric agent/resource
counts.

### Build/check scripts

Standalone `typecheck`, `test`, and `test:coverage` retain their clean-build
precondition. Internal no-build variants will run workspace typechecks or
Vitest directly. `pnpm check` will explicitly execute one recursive build,
then the no-build typecheck and full test commands, preserving package order,
failure propagation, and test isolation.

### Remote single-server documentation

README and `docs/opencode-integration.md` will describe three distinct paths:

1. The Windows launcher builds, probes, starts or reuses the fixed local
   Dashboard server, and owns shutdown only when it started that server.
2. Direct CLI/server launch owns its own server process and documents the
   actual host, port, project environment, loopback default, and external-host
   auth restriction.
3. OpenCode uses the checked-in remote MCP URL and neither starts nor stops the
   ST Workspace server. Startup order, unavailable-server behavior, the
   checked-in auth posture, and session restart behavior will be explicit.

`tools/opencode-mcp.ts` will remain available only as a legacy diagnostic
helper, with code comments and documentation preventing it from being read as
the primary integration path. The docs/config test will parse the JSONC and
assert stable endpoint, command, ownership, and legacy-positioning contracts
without snapshotting whole documents.

## Validation strategy

Focused tests will cover scanner input and state outcomes, structured parser
errors, shared resources, missing bindings, unknown aliases, orphan resources,
count-free registry growth, and check-script build composition. Server tests
will verify remote MCP configuration, endpoint/document consistency, launcher
reuse/start ownership, and legacy helper positioning. Final validation will
run the requested targeted tests, `pnpm agent:lint`, a fixture-based scanner
run, `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm test:coverage`, and
diff/worktree checks.

## Known boundary

This batch will document the existing `authToken` server API requirement for
non-loopback binding. It will not invent a repository config secret or add a
new auth CLI flag; secrets must remain outside tracked configuration.
