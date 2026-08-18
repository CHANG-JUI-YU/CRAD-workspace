# Security CI policy

Security automation supplements the repository's focused SSRF, authentication, CSRF, filesystem, transaction, and HTTP boundary regression tests. It does not replace them.

## Automated gates

The `Security` workflow runs on pull requests, pushes to `main`, and a weekly schedule.

### CodeQL SAST

CodeQL analyzes `javascript-typescript` with the `security-extended` query suite and uploads findings to GitHub code scanning.

The CodeQL Action intentionally follows the maintained `v4` major channel. GitHub recommends the maintained major tag for advanced setup so Action behavior and the bundled CodeQL CLI continue receiving compatibility and security updates. Other reusable Actions in this repository are pinned to immutable commit SHAs and annotated with their release versions.

A pull request with a new credible CodeQL security finding must not be merged until the finding is fixed or explicitly triaged as an approved exception. Repository rules/required-check enforcement is tracked separately by the branch-governance work; until that is enforced by GitHub settings, this is a project merge policy rather than a claim that branch protection is active.

### Dependency audit

`pnpm audit --audit-level=high` is the dependency vulnerability gate.

- `high` and `critical` advisories fail the workflow.
- `moderate` and `low` advisories do not fail this gate, but may still be remediated during routine dependency maintenance.
- Audit service/network errors are not converted to success. The gate is fail-closed rather than silently skipping vulnerability checks.
- The audit is lockfile-oriented and does not run package lifecycle scripts before evaluating advisories.

## Triage and suppression

The default response to a finding is remediation: update the dependency, remove the vulnerable path, or change the affected code.

A suppression or alert dismissal is allowed only when remediation is not currently appropriate and the risk has been reviewed. The change or dismissal must have a version-controlled record in `docs/security-exceptions.md` containing:

- advisory/CodeQL rule identifier and affected scope;
- technical rationale for accepting or classifying the result as not exploitable/false positive;
- compensating controls, if any;
- owner or reviewer;
- creation date and a review/expiry date;
- link to the pull request or GitHub alert when available.

Do not add blanket audit ignores, broad CodeQL path exclusions, or query-suite reductions solely to make CI green. Any CI/configuration suppression must be introduced in the same pull request as its exception record. Expired exceptions must be removed, renewed with fresh rationale, or remediated.

## Action supply-chain maintenance

`actions/checkout`, `actions/setup-node`, and `pnpm/action-setup` are pinned to immutable commit SHAs. Dependabot monitors GitHub Actions weekly so those pins can be reviewed and advanced deliberately.

When updating a pin:

1. verify the commit belongs to the intended upstream release/tag;
2. review release notes for runtime or permission changes;
3. keep the human-readable version comment next to the SHA;
4. require the normal CI and Security workflows to pass before merge.

The CodeQL Action is the documented exception to immutable pinning because GitHub recommends the maintained major channel for advanced setups.
