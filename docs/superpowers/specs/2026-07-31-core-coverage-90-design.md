# Core Coverage 90% Design

## Goal

Raise the repository's global production-code coverage to at least 90% for branches, functions, lines, and statements while prioritizing meaningful core behavior. The result must come from executable tests and removal of genuinely unreachable branches, not from lowering thresholds, excluding production files, or adding coverage-ignore directives.

## Baseline

The authoritative 2026-07-31 run uses:

```powershell
pnpm test:coverage -- --pool=forks --maxWorkers=1
```

Current V8 coverage is:

| Metric | Covered | Total | Percent |
| --- | ---: | ---: | ---: |
| Statements | 23,382 | 26,114 | 89.54% |
| Lines | 23,382 | 26,114 | 89.54% |
| Functions | 1,076 | 1,170 | 91.97% |
| Branches | 6,484 | 8,105 | 80.00% |

The branch target requires roughly 811 additional existing branches to execute, subject to small denominator changes introduced by testability refactors. Branch coverage is therefore the main workstream; statement and line coverage are expected to cross 90% as those branches are exercised.

## Approaches Considered

### 1. Core branch-driven tests — chosen

Use `coverage/coverage-final.json` to rank uncovered branches, then add package-local tests through public APIs and state transitions. This produces the most trustworthy metric and directly protects important behavior, but requires the most test design work.

### 2. Contract and property tests only

Concentrate on schemas, validators, and pure functions with table-driven and property-based cases. This is efficient for many edge conditions but cannot adequately cover orchestration, persistence, authorization, recovery, or UI behavior by itself.

### 3. Coverage-scope reduction

Exclude CLI entry points, defensive adapters, or low-traffic production modules. This reaches the number quickly but weakens the meaning of the global metric. It is rejected for this effort.

The implementation will use approach 1, with approach 2 as a technique inside pure modules.

## Coverage Architecture

The work follows a repeatable loop:

1. Read the global V8 report and classify each high-impact uncovered branch.
2. Map the branch to a public contract, state transition, failure path, or unreachable condition.
3. Add the smallest package-local test that proves the behavior.
4. Run the affected test file and package checks.
5. Run authoritative global coverage after each phase.
6. Stop only when every global metric is at least 90.00% and the complete verification suite is green.

Uncovered branches are classified as:

- **Core success path:** normal authoring, workflow, ingestion, build, and dashboard behavior.
- **Core rejection path:** invalid input, stale revision, authorization failure, conflict, replay, and invariant violation.
- **Recovery path:** transaction failure, partial persistence, retry, lease expiry, and idempotent resume.
- **Adapter or presentation path:** CLI, MCP, dashboard route, and React rendering behavior.
- **Unreachable path:** a branch that cannot be reached through any supported contract.

An unreachable path must be removed or simplified when safe. A narrow dependency-injection seam may be introduced when an external effect prevents deterministic testing. Coverage-ignore comments are not permitted.

## Priority Order

### Phase 1: Workflow and MCP orchestration

Target the largest and most consequential gaps first:

- `packages/workflow/src/runtime.ts`
- `packages/workflow/src/plugin-lifecycle.ts`
- `packages/mcp-server/src/tools/workflow.ts`
- `packages/mcp-server/src/tools/facts.ts`

Tests cover state transitions, stage guards, stale revisions, task dependency resolution, authorization, replay protection, plugin revision lifecycle, and MCP error translation.

### Phase 2: Ingestion and project persistence

Target:

- `packages/ingestion/src/research.ts`
- `packages/ingestion/src/jobs.ts`
- `packages/ingestion/src/review.ts`
- `packages/project/src/load-author-project.ts`
- `packages/project/src/plugin-data.ts`
- related transaction and plugin-storage branches revealed by the report

Tests cover resumability, lease and CAS failures, malformed artifacts, missing or stale revisions, partial transaction recovery, projection consistency, and read-only loading behavior.

### Phase 3: Schemas and official plugins

Target:

- `packages/schemas/src/plugins.ts`
- official MVU, EJS, and HTML validators and generators
- plugin template and registry edge cases

Use table-driven cases for each supported discriminator and rejection condition. Use `fast-check` only where it proves a stable invariant more clearly than enumerated examples.

### Phase 4: CLI, dashboard, and residual core gaps

Cover reachable command errors, API response boundaries, dashboard empty/error/loading states, and remaining high-value branches. This phase closes the global gap without spending effort on artificial tests of implementation details.

### Phase 5: Threshold enforcement

After the measured result is stable, set all four thresholds in `vitest.config.ts` to 90. A final clean run must pass with the new thresholds.

## Test Isolation and Data Safety

- Tests use fresh temporary directories and deterministic builders.
- Existing `projects/` and `exports/` content is never modified.
- Tests do not require external network access.
- Time, IDs, tokens, and fault injection are controlled where nondeterminism affects assertions.
- Package tests may reuse existing fixtures read-only; mutations operate on copied fixtures or new temporary projects.
- Windows coverage runs use a single worker because parallel instrumented ingestion tests can race during temporary-directory cleanup.

## Production-Code Change Policy

The primary deliverable is tests. Production code may change only when:

- a new test exposes a real bug;
- an unreachable branch can be safely removed;
- a small dependency seam is required for deterministic testing; or
- duplicated branch logic can be extracted without changing behavior.

Every production change requires a regression test. Unrelated refactors are outside scope.

## Error Handling During the Work

- A failing new test is first classified as a test defect, an existing product defect, or an environment race.
- Product defects are fixed at the narrowest owning layer and retained as regressions.
- Environment races are reproduced separately and addressed without weakening assertions.
- Coverage regressions are reported by file and branch count before proceeding to another phase.
- If a supported branch cannot be tested without changing public behavior, implementation pauses for explicit review.

## Verification

The final verification set is:

```powershell
pnpm test
pnpm test:coverage -- --pool=forks --maxWorkers=1
pnpm lint
pnpm typecheck
pnpm -r --workspace-concurrency=1 build
pnpm test:e2e
```

Package-local tests run continuously during each phase; the full suite runs at phase boundaries and at completion.

## Acceptance Criteria

- Global branches, functions, lines, and statements are each at least 90.00%.
- `vitest.config.ts` enforces 90 for all four metrics.
- No production source file is newly excluded from coverage.
- No coverage-ignore directive is added.
- Unit, coverage, lint, typecheck, build, and E2E commands all pass.
- No existing `projects/` or `exports/` content is changed.
- New tests are deterministic and do not depend on network access.
- Any product bug found during coverage work has a focused regression test.

## Non-Goals

- Reaching 100% coverage.
- Refactoring unrelated architecture.
- Testing third-party library internals.
- Treating the coverage percentage as proof that no bugs remain.
