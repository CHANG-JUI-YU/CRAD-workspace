# Security exceptions

No active security exceptions.

When an exception is required, append a dated entry using this template and keep it in the same pull request as any CI/configuration suppression:

```md
## <identifier> — <short title>

- Scope: <package, path, CodeQL rule, or advisory>
- Decision: <accepted risk | false positive | not exploitable>
- Rationale: <technical explanation>
- Compensating controls: <controls or none>
- Owner/reviewer: <name or GitHub handle>
- Created: YYYY-MM-DD
- Review/expiry: YYYY-MM-DD
- Tracking: <PR or alert reference>
```

Expired entries must be removed, renewed with current evidence, or remediated. Blanket suppressions without an entry here are not permitted.
