# Core Coverage 90% Implementation Plan

## 1. Objective and Operating Rules

Implement the approved [Core Coverage 90% Design](./2026-07-31-core-coverage-90-design.md) without changing the meaning of the metric.

Hard completion criteria:

- Global branches, functions, lines, and statements are each at least 90.00%.
- `vitest.config.ts` enforces 90 for all four metrics.
- No production source is newly excluded from coverage.
- No coverage-ignore directive is added.
- Existing `projects/` and `exports/` content remains untouched.
- Unit tests, coverage, lint, typecheck, build, and E2E all pass.

Implementation rules:

1. Work test-first at a public contract or state-transition seam.
2. Use fresh temporary projects for every filesystem mutation.
3. Treat coverage checkpoint percentages as planning estimates; the final 90.00% threshold is the authoritative target.
4. If a test exposes a product defect, fix it narrowly and keep the failing case as a regression.
5. Put product fixes in a separate commit from pure coverage additions whenever practical.
6. Do not execute any item in this plan until the user explicitly authorizes implementation.

## 2. Baseline and Measurement

### Current baseline

| Metric | Covered | Total | Percent |
| --- | ---: | ---: | ---: |
| Statements | 23,382 | 26,114 | 89.54% |
| Lines | 23,382 | 26,114 | 89.54% |
| Functions | 1,076 | 1,170 | 91.97% |
| Branches | 6,484 | 8,105 | 80.00% |

At the current denominator, branch coverage needs about 811 additional covered branches.

### Largest known branch gaps

| Production file | Uncovered branches |
| --- | ---: |
| `packages/workflow/src/runtime.ts` | 109 |
| `packages/mcp-server/src/tools/workflow.ts` | 87 |
| `packages/workflow/src/plugin-lifecycle.ts` | 80 |
| `packages/schemas/src/plugins.ts` | 62 |
| `packages/ingestion/src/research.ts` | 55 |
| `packages/project/src/load-author-project.ts` | 46 |
| `packages/ingestion/src/jobs.ts` | 38 |
| `packages/plugins/src/official/mvu/validate.ts` | 31 |
| `packages/project/src/plugin-data.ts` | 31 |
| `packages/cli/src/program.ts` | 29 |
| `packages/ingestion/src/review.ts` | 28 |
| `packages/mcp-server/src/tools/facts.ts` | 28 |

### Authoritative measurement command

```powershell
pnpm test:coverage -- --pool=forks --maxWorkers=1
```

Use the single-worker run for coverage on Windows. Run normal `pnpm test` separately to verify the default execution mode.

## 3. Milestone 0: Refresh and Classify the Baseline

### Goal

Start from a reproducible report and turn uncovered branches into an ordered test backlog.

### Work

1. Run the authoritative coverage command from a clean product-code state.
2. Read `coverage/coverage-final.json` and rank files by uncovered branch count.
3. For the top files, record each uncovered source line as one of:
   - success path;
   - rejection path;
   - recovery path;
   - adapter/presentation path;
   - unreachable path.
4. Select the next milestone's tests by product risk first, branch yield second.
5. Confirm that no test writes to existing `projects/` or `exports/` paths.

### Verification

```powershell
pnpm test
pnpm test:coverage -- --pool=forks --maxWorkers=1
```

### Acceptance

- Baseline counts are reproducible.
- Every Phase 1 target branch has a behavior classification.
- No production or test file has changed yet.

## 4. Milestone 1: Schemas and Official Plugin Contracts

### Coverage target

Cover approximately 150 additional branches and reach about 82% global branch coverage.

### Files

- Update `packages/schemas/test/author-schemas.test.ts`.
- Update `packages/schemas/test/workflow-contracts.test.ts`.
- Update `packages/schemas/test/schemas.test.ts` where shared plugin schemas are already exercised.
- Update `packages/plugins/test/mvu.test.ts`.
- Update `packages/plugins/test/ejs.test.ts`.
- Update `packages/plugins/test/html.test.ts`.
- Update `packages/plugins/test/registry.test.ts`.
- Update `packages/plugins/test/templates.test.ts` only for remaining public template branches.
- Change owning production validators only when a regression proves a defect or a branch is genuinely unreachable.

### Test matrix

1. Exercise every plugin selection discriminator and capability combination.
2. Cover missing, empty, duplicate, stale, and unsupported implementation pins.
3. Cover worldbook versus character-card project-kind rejection.
4. Cover MVU recursive variable kinds, valid boundary defaults, invalid constraint combinations, writable/read-only paths, and duplicate path detection.
5. Cover EJS range endpoints, gaps, overlaps, mixed paths, fallback behavior, aliases, and nested condition types.
6. Cover HTML component kinds, safe/unsafe markup, selector scoping, CSS policy branches, greeting references, and writable binding checks.
7. Cover registry exact-match, missing dependency, dependency closure, duplicate registration, and implementation drift.
8. Prefer table-driven tests for closed schema discriminators and boundary values.

### Targeted verification

```powershell
pnpm test -- packages/schemas/test packages/plugins/test
pnpm typecheck
```

### Checkpoint

Run global coverage. If the measured gain is below 120 branches, inspect the new report before continuing; do not add low-value tests merely to preserve the estimate.

### Suggested commit

```text
test: cover plugin contracts and validators
```

## 5. Milestone 2: Workflow Runtime and Plugin Lifecycle

### Coverage target

Cover approximately 250 additional branches and reach about 85% global branch coverage.

### Files

- Update `packages/workflow/test/runtime.test.ts`.
- Update `packages/workflow/test/plugin-lifecycle.test.ts`.
- Update `packages/workflow/test/proposal-validation.test.ts`.
- Update `packages/workflow/test/proposal-apply.test.ts`.
- Update `packages/workflow/test/gates.test.ts`.
- Update `packages/workflow/test/tasks.test.ts`.
- Update `packages/workflow/test/recovery.test.ts` for recovery-only branches.
- Update `packages/workflow/test/helpers.ts` only with reusable deterministic builders.

### Runtime test matrix

1. Initialize, resume, and reject invalid workflow states.
2. Exercise each supported stage transition and invalid predecessor.
3. Cover missing tasks, completed tasks, failed tasks, blocked dependencies, and dependency ordering.
4. Cover lease acquisition, expiry, ownership mismatch, retry, stale attempts, and idempotent re-entry.
5. Cover workflow revision CAS success and failure around every mutation class.
6. Cover decisions and gates with pending, approved, rejected, stale, duplicate, and missing records.
7. Cover preview/publish invalidation and stale artifact combinations.

### Plugin lifecycle test matrix

1. Cover selection normalization, dependency closure, capability impact, and implementation-pin changes.
2. Cover revision preview and begin with missing intent, stale workflow, unsupported selection, and exact pin resolution.
3. Cover proposal submit, approval, rejection, replay, stale source revision, stale dependency artifact, and mismatched result hash.
4. Cover authorization token expiry, decision mismatch, proposal mismatch, workflow mismatch, and one-time consumption.
5. Cover rejection successors and dependency cascade confirmation.

### Testability seam policy

- Inject time or token generation only if an existing branch cannot be deterministically reached.
- Keep seams private to the owning package and preserve default production behavior.
- Do not expose internal mutation methods solely for tests.

### Targeted verification

```powershell
pnpm test -- packages/workflow/test
pnpm --filter @card-workspace/workflow typecheck
```

### Checkpoint

Run global coverage and require at least 85% branches before moving to MCP unless the report proves that the remaining Workflow branches are unreachable or lower risk than the next phase.

### Suggested commit

```text
test: cover workflow runtime and plugin lifecycle
```

## 6. Milestone 3: MCP Tool Boundaries and Authorization

### Coverage target

Cover approximately 140 additional branches and reach about 86.5–87% global branch coverage.

### Files

- Update `packages/mcp-server/test/workflow-tools.test.ts`.
- Update `packages/mcp-server/test/facts-pagination.test.ts`.
- Update `packages/mcp-server/test/plugins.test.ts`.
- Update `packages/mcp-server/test/authorization.test.ts`.
- Update `packages/mcp-server/test/ingestion-tools.test.ts` where workflow errors cross into ingestion tools.
- Update `packages/mcp-server/test/helpers.ts` only for shared server fixtures.

### Test matrix

1. Cover missing, malformed, and boundary tool arguments.
2. Cover project-not-found, task-not-found, stale revision, stage mismatch, and lease mismatch translation.
3. Cover authorization allow/deny decisions for every agent/tool/stage combination used by workflow and plugin operations.
4. Cover facts pagination at empty, first, middle, last, stale-cursor, invalid-limit, and changed-projection boundaries.
5. Cover plugin revision preview/begin/review error translation and token rejection paths.
6. Assert stable MCP error codes and safe messages; do not assert private stack traces.
7. Verify failed tools leave project, workflow, and authorization state unchanged.

### Targeted verification

```powershell
pnpm test -- packages/mcp-server/test/workflow-tools.test.ts packages/mcp-server/test/facts-pagination.test.ts packages/mcp-server/test/plugins.test.ts packages/mcp-server/test/authorization.test.ts
pnpm --filter @card-workspace/mcp-server typecheck
```

### Checkpoint

Run global coverage. Re-rank uncovered branches because MCP tests may also execute Workflow and Project code.

### Suggested commit

```text
test: cover MCP workflow and authorization boundaries
```

## 7. Milestone 4: Ingestion, Research, Jobs, and Review

### Coverage target

Cover approximately 150 additional branches and reach about 88.5% global branch coverage.

### Files

- Update `packages/ingestion/test/research.test.ts`.
- Update `packages/ingestion/test/jobs.test.ts`.
- Update `packages/ingestion/test/review-projector.test.ts`.
- Update `packages/ingestion/test/intake.test.ts` where intake drives uncovered research paths.
- Update `packages/ingestion/test/provenance.test.ts` where evidence/provenance rejection is shared.

### Research test matrix

1. Cover every supported research source and query mode.
2. Cover empty results, duplicate results, unsupported URLs, invalid metadata, and stale source revisions.
3. Cover approval required, approval absent, approval rejected, and approval superseded.
4. Cover provider/adapter failure translation without external network access.
5. Cover deterministic normalization and result ordering.

### Job and review test matrix

1. Cover create, claim, renew, complete, fail, retry, expire, and resume.
2. Cover wrong chunk, wrong batch, stale lease, stale source, stale job, and superseded result.
3. Cover transaction failure before and after every persisted job transition.
4. Cover review accept/reject/defer, duplicate decisions, conflict resolution, and projector recovery.
5. Cover idempotent submission and same-identity/different-payload conflict.
6. Keep instrumented filesystem tests isolated and deterministic on Windows.

### Targeted verification

```powershell
pnpm test -- packages/ingestion/test/research.test.ts packages/ingestion/test/jobs.test.ts packages/ingestion/test/review-projector.test.ts packages/ingestion/test/intake.test.ts
pnpm --filter @card-workspace/ingestion typecheck
```

### Checkpoint

Run global coverage with one worker. If temporary-directory cleanup races appear, reproduce the affected file alone before changing product code.

### Suggested commit

```text
test: cover ingestion recovery and review paths
```

## 8. Milestone 5: Project Loading, Persistence, CLI, and Dashboard

### Coverage target

Cover approximately 130 additional branches and cross 90% global branch coverage.

### Project files

- Update `packages/project/test/load-author-project.test.ts`.
- Update `packages/project/test/plugin-data.test.ts`.
- Update `packages/project/test/plugin-storage.test.ts`.
- Update `packages/project/test/transaction.test.ts` for shared recovery branches.
- Update `packages/project/test/parser-validation.test.ts` for malformed persisted data.

### Project test matrix

1. Cover missing optional documents, missing required documents, malformed manifests, and unsupported schema versions.
2. Cover active, disabled, orphaned, stale, and mismatched plugin data.
3. Cover symlink/junction rejection, path normalization, duplicate canonical paths, and bounded parser failures.
4. Cover raw and semantic revision mismatch, expected-absent CAS, idempotent writes, and transaction rollback.
5. Assert loaders remain read-only.

### CLI files

- Update `packages/cli/test/cli.test.ts`.

### CLI test matrix

1. Cover every reachable subcommand help and validation branch.
2. Cover unknown command, missing arguments, malformed values, absent projects, and domain-error exit codes.
3. Exercise command handlers through exported program construction or spawned CLI processes, not private functions.

### Dashboard files

- Update `apps/dashboard/test/coverage-gaps.test.tsx` only when a scenario spans several defensive states.
- Prefer focused additions to `apps/dashboard/test/workbench.test.ts`, `editor-gates.test.ts`, and `client-events.test.ts`.
- Update dashboard server route tests when the uncovered branch belongs to server behavior.

### Dashboard test matrix

1. Cover API loading, empty, success, malformed-payload, and domain-error states.
2. Cover mutation pending/success/error/reset paths.
3. Cover navigation and selection states through accessible user actions.
4. Cover event reconnect, stale messages, duplicate messages, and teardown behavior.
5. Keep E2E for cross-component user journeys; use component tests for local branch matrices.

### Targeted verification

```powershell
pnpm test -- packages/project/test packages/cli/test apps/dashboard/test
pnpm typecheck
pnpm lint
pnpm test:e2e
```

### Checkpoint

Run authoritative coverage. If branches remain below 90%, proceed to the residual closure milestone rather than weakening scope.

### Suggested commit

```text
test: cover project CLI and dashboard boundaries
```

## 9. Milestone 6: Residual Closure and Threshold Enforcement

### Goal

Close the measured gap, remove only proven unreachable branches, and enforce the new baseline.

### Work

1. Generate a fresh uncovered-branch ranking.
2. Select remaining tests by core risk and expected branch yield.
3. For each unreachable branch:
   - prove it cannot be reached through a supported contract;
   - remove or simplify it without changing behavior; or
   - pause for review if removal changes a public contract.
4. Repeat targeted tests and global coverage until all four metrics are at least 90.00%.
5. Update `vitest.config.ts` thresholds:

```ts
thresholds: {
  branches: 90,
  functions: 90,
  lines: 90,
  statements: 90,
}
```

6. Run the complete verification set from a clean process.
7. Confirm Git reports no changes under `projects/` or `exports/`.

### Full verification

```powershell
pnpm test
pnpm test:coverage -- --pool=forks --maxWorkers=1
pnpm lint
pnpm typecheck
pnpm -r --workspace-concurrency=1 build
pnpm test:e2e
```

### Acceptance

- Every command passes.
- Coverage reports at least 90.00% for all four metrics.
- The committed threshold is 90 for all four metrics.
- No production coverage exclusion or ignore directive was introduced.
- `projects/` and `exports/` are unchanged.

### Suggested commit

```text
test: enforce 90 percent coverage
```

## 10. Product Defect Handling

When a new test fails against current behavior:

1. Reproduce the failure in the smallest owning test file.
2. Confirm whether the expected behavior follows an existing schema, workflow invariant, or user-visible contract.
3. If it is a product defect, make the narrowest production fix and add a named regression test.
4. Run the owning package tests, typecheck, and relevant integration tests.
5. Commit the fix separately when practical:

```text
fix: <short defect description>
```

Do not reinterpret a real failure as a coverage-only concern.

## 11. Pause and Escalation Conditions

Pause implementation and request direction when:

- reaching a branch requires changing supported public behavior;
- the only apparent route is a coverage exclusion or ignore directive;
- a test requires external network state or a real user account;
- a production refactor would cross package ownership boundaries beyond a narrow testability seam;
- existing user data under `projects/` or `exports/` would need mutation;
- the new 90% threshold would be met only by tests that assert private implementation details with no stable contract.

## 12. Completion Handoff

The final handoff reports:

- before/after coverage for all four metrics;
- covered branch gains by milestone;
- product defects found and fixed;
- complete verification results;
- final commit list;
- any intentionally deferred low-risk branches, while still satisfying the 90% global threshold.

This document is a plan only. No implementation begins until explicit user approval.
