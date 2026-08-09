# Workflow gates and editable publish design

## Scope

This change completes the derivative-creation workflow around the separately
implemented CCv3/PNG compiler and cross-instance CAS. It does not change those
packages. The scope is the workflow gate, source and fact provenance, artifact
references, Agent routing, review ledger, and project-runtime rebinding.

## Design decisions

### Drafts remain flexible

Every proposal may create or revise a draft when its local schema is valid.
Unresolved cross-artifact references are recorded as diagnostics instead of
blocking authoring. A preview reports them; publish blocks them.

### Publish is an immutable checkpoint

`published` means that the project has a latest successful publish snapshot; it
does not make the project read-only. A later proposal creates a new draft
revision based on the latest published revision. The previous publish record and
its exported files remain available for rollback. A later successful publish
creates a new snapshot and replaces only the `latest` export pointer.

### Central gate

Build/publish uses one workflow-gate boundary. The gate checks interview and
Blueprint precheck state, required artifacts derived from the interview, source
ingestion and policy, fact provenance/adjudication, cross-artifact references,
review status, and plugin/conversion/import links. Editing never invokes the
publish gate; a failed gate leaves the previous publish untouched.

### Source and fact provenance

Source research keeps discovery and ingestion separate, but discovery is not
reported as finished ingestion. Allowed domains and the official-source rule are
enforced at acquisition. Fact evidence must resolve to an ingested source or an
explicit user-authored evidence reference; unresolved evidence is a publish
diagnostic.

### Agent routing and review ledger

Structured plugin proposals route by `plugin_id`; review proposals route by
target kind. Fact-review passes are stored with reviewer identity and pass
number, and the gate can require the configured quorum without exposing storage
parameters to the Agent.

### Runtime switching

The background worker resolves the current project runtime at execution time so
project creation or selection cannot leave recovery jobs attached to the old
project.

## Error handling

Authoring errors are recoverable and return `needs_input` with a concise action.
Publish diagnostics are deterministic, include the affected artifact/source/fact
ids, and do not mutate the prior publish snapshot. No fallback fetch bypasses a
source policy.

## Verification

Regression tests will cover:

1. an assisted precheck cannot be bypassed, while a normal draft can be edited;
2. a published project accepts a new draft and can republish without losing the
   prior snapshot;
3. source discovery does not masquerade as ingestion, official/domain policy is
   enforced, and fact evidence resolves;
4. unresolved references block publish but not authoring;
5. plugin/review routing and fact-review pass records are correct; and
6. project switching rebinds worker recovery to the selected project.

