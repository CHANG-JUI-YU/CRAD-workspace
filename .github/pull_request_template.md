## Summary

Describe the change and why it is needed.

## Linked issues

For Audit issues, use non-closing references such as `Refs #158`. Do not use `Fixes`, `Closes`, or `Resolves` for an Audit issue in the PR body, title, or commit messages; Audit issues are closed only after the merged `main` commit has successful CI, Security, and Governance push runs.

## Verification

- [ ] Correctness (ubuntu-latest)
- [ ] Correctness (windows-latest)
- [ ] Coverage (ubuntu-latest)
- [ ] Dependency audit (high+)
- [ ] CodeQL (javascript-typescript)
- [ ] PR governance

## Governance

- [ ] This change is proposed through a pull request rather than a direct `main` push.
- [ ] Any Audit issue remains open until post-merge `main` CI, Security, and Governance evidence is green.
- [ ] No required check was bypassed, or the emergency bypass reason and follow-up repair issue are documented below.

Emergency bypass / follow-up repair issue: N/A
