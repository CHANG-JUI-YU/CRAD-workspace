# Green-main and issue-closing policy

This repository treats a green default branch as a release-quality invariant. Normal changes must reach `main` through a pull request, and Audit issues must remain open until the merged `main` commit has successful post-merge correctness, security, and governance evidence.

## Required evidence before merge

A normal pull request targeting `main` must not be merged until all applicable checks are successful:

- `Correctness (ubuntu-latest)`
- `Correctness (windows-latest)`
- `Coverage (ubuntu-latest)`
- `Dependency audit (high+)`
- `CodeQL (javascript-typescript)`
- `PR governance`

Pending, skipped unexpectedly, cancelled, neutral, timed-out, or failed required checks are not green evidence. A rerun is acceptable only when the rerun itself succeeds and the reason for the rerun is understood.

Direct pushes to `main` are not part of the normal development workflow. Changes are prepared on a branch, reviewed as a pull request, and merged only after the required evidence above is green. The `Governance` workflow also runs `Main provenance` after every `main` push and fails when the resulting head SHA is not associated with a pull request merged into `main`. This provides a verifiable detector while branch protection is unavailable; it does not prevent the direct push itself.

## Audit issue lifecycle

Audit issues use a stricter close sequence because GitHub closing keywords can close an issue at merge time, before the `push` workflows for the merged commit have completed.

### Audit issue title identity

New Audit issues use exactly one canonical naming format:

`<CATEGORY><ROUND>-<SEQUENCE>: <summary>`

Examples include `BUG13-01: ...`, `DASHBOARD13-01: ...`, `USER13-01: ...`, and `WORKFLOW13-01: ...`. Writers use uppercase category names, a positive numeric Audit round, and a sequence of at least two digits. The supported category vocabulary is `AUDIT`, `BUG`, `DASHBOARD`, `UX`, `USER`, `RISK`, and `WORKFLOW`. The matcher is case-insensitive when reading titles so historical or manually edited case does not bypass governance, but lowercase is not the canonical writing style.

Legacy bracketed titles are read-only compatibility. The matcher continues to recognize historical `[AUDITn-*]`, `[BUGn-*]`, `[UXn-*]`, `[USERn-*]`, and `[RISKn-*]` prefixes, including existing trailing classification brackets. Do not create new bracketed Audit titles.

Only the issue title establishes Audit identity. Body text, labels, comments, PR text, and other mutable metadata do not turn a normal issue into an Audit issue. The canonical matcher lives in `.github/scripts/audit_issue_identity.py`; both the PR closing-keyword guard and the verify-and-close workflow use that same implementation. In PR governance, the token-bearing step only collects referenced issue titles into a temporary JSON file and never imports the matcher; the matcher/fixture steps run with checkout credentials not persisted and receive no `GH_TOKEN`. The issue-write close workflow always loads the matcher from `main` before classifying the issue it may close.

1. During development, reference an Audit issue with `Refs #<number>` or equivalent non-closing language.
2. Do not use `Fixes`, `Closes`, or `Resolves` for an Audit issue in a pull-request body, title, or commit message. The `PR governance` check scans all three locations and rejects closing keywords that target an Audit-titled issue.
3. Merge the pull request only after all required PR checks are green.
4. Wait for `CI`, `Security`, and `Governance` workflows triggered by the merged `main` push to complete successfully.
5. Run the `Close audit issue` workflow from the default branch. Supply the Audit issue number and, preferably, the current merged `main` SHA.
6. The workflow verifies successful completed `push` runs for `ci.yml`, `security.yml`, and `governance.yml` on that exact current `main` SHA before closing the issue.

The closure workflow fails closed if `main` moved, the issue is not an Audit issue, required workflow evidence is missing, or any required workflow has not produced a successful completed run for the target SHA.

## Branch protection / ruleset

As of 2026-08-18, the GitHub branch API reports `main` as unprotected. The connected repository automation available for this audit can read branch state but does not expose a branch-protection or ruleset write operation. Until protection is configured in repository settings, the policy and detector workflows in this document are the required manual control.

When repository settings are available, configure a branch protection rule or ruleset for `main` with these controls:

- require a pull request before merging;
- require the six checks listed under "Required evidence before merge";
- require branches to be up to date before merging when GitHub can enforce that without creating an unusable merge queue;
- block force pushes and branch deletion;
- do not allow routine bypass of required checks;
- restrict any bypass permission to repository administrators/maintainers responsible for incident response.

After enabling protection, verify from the branch/ruleset settings page that the configured check names exactly match the emitted GitHub check contexts. If a workflow job is renamed, update the ruleset and this document in the same pull request/change window.

## Emergency bypass

A bypass is reserved for an urgent incident where waiting for the normal merge path creates greater operational or security risk than bypassing it. Convenience, flaky tests, or a desire to merge faster are not valid bypass reasons.

When a bypass is used:

1. record the reason, operator, affected commit, and bypassed check/control in the incident or pull request;
2. create a follow-up repair issue before the bypass when practical, otherwise immediately afterward;
3. run the complete CI, Security, and Governance workflows on `main` as soon as the emergency change lands;
4. keep any associated Audit issue open until the normal green-main evidence exists;
5. restore any temporarily disabled protection/check before closing the follow-up repair issue.

If post-merge CI, Security, or Governance fails, `main` is considered red. Stop normal merges and prioritize a repair pull request until all required workflows are green again.

## Review evidence

The pull request is the review and change record. Keep the problem statement, scope, test/security evidence, linked issues, and any rerun/bypass rationale in the PR conversation so future audits can reconstruct why the change was accepted.
