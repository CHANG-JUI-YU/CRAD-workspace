# Mode Conversion and Semantic Compiler Design

Date: 2026-08-09
Status: Approved design

## Scope

This change completes two self-use authoring gaps in ST Workspace V3:

1. A validated `conversion` proposal materializes the requested target-mode
   modules as draft artifacts while preserving the source mode.
2. The existing single-card CCv3/PNG compiler maps in-project mode artifacts
   into card semantics instead of treating every non-character artifact as
   unstructured lore.

The workflow-gates/editable-publish work is being implemented by another agent
and is intentionally not changed here. External card import, multi-card bundle
export, quality-profile expansion, and binary-source ratio detection are also
out of scope.

## Design decisions

### 1. Conversion materialization

The submitted conversion proposal is authoritative for the target modules. The
runtime does not invent target prose or silently infer missing content. It
validates the proposal, resolves the latest source-mode artifacts for the same
`character_id`, and atomically writes:

- one `conversion` artifact containing the validated proposal and conversion
  report; and
- one draft `zhuji` or `palette` artifact for each target module in the
  proposal.

The source artifacts are never modified. Each target artifact uses the normal
mode-specific key, links to the previous target revision with `based_on` when
present, and retains conversion provenance in its serialized proposal content.
The conversion record and target artifacts are committed in one repository
transaction.

If the same target key already has the same content hash, the existing target
artifact is reused. A changed target creates a new draft revision. Conversion
never marks an artifact as published and never changes the project status to
published.

The conversion audit records source artifact IDs and revisions, target artifact
IDs and revisions, mapping digest, `unmapped`, and each mapping's declared
`expected_loss`. A missing source-mode artifact, an invalid target module, or a
conversion that would overwrite source mode returns a recoverable domain error
and leaves the repository unchanged.

### 2. Single-card semantic compiler

The public output remains one `exports/ccv3.json` and one `exports/card.png`.
CCv3 is a single-character envelope, so the compiler chooses a deterministic
primary character for the standard fields while preserving the complete
project roster and non-primary data in structured `card-workspace` extensions
and worldbook entries.

Primary selection is deterministic: use the latest character document when one
exists; otherwise use the lexically first character ID found in the latest
zhuji/palette artifacts. No artifact is silently discarded because it is not
the primary character.

Mode artifacts are compiled as follows:

- Palette `basic_information` contributes to description; its
  `personality_palette` content contributes to personality; `tri_faceted` and
  `secondary_interpretation` remain typed worldbook entries and structured
  mode metadata.
- Zhuji modules are retained as typed, deterministic entries. Stable module
  groups contribute to description/personality/scenario where the module type
  has an unambiguous correspondence; all remaining structured data is emitted
  as a readable worldbook entry with its module ID and provenance. Zhuji
  `self_introduction` never becomes a greeting automatically.
- Greeting artifacts remain the only source of `first_mes`, alternate
  greetings, and group-only greetings.
- Relationship documents are emitted as structured relationship metadata and a
  readable worldbook entry, including the full roster and directional
  perspectives.
- World entries and accepted facts remain typed worldbook entries.
- Conversion artifacts are provenance records only and are not emitted as
  duplicate lore content.

All artifact IDs and revisions remain attached to the card extension. Ordering
of artifacts, modules, roster members, and entries is lexical or schema-defined
so identical project state produces identical JSON, PNG metadata, and content
hashes.

### 3. Error handling and compatibility

Schema failures continue to use the existing recoverability rules. Conversion
source resolution and materialization failures are recoverable and must not
partially write target artifacts. Compiler failures remain build failures with
the existing operation/audit path; compiler output must still pass the CCv3
schema before PNG emission.

The implementation does not change the public single-card export filenames or
the existing plugin contribution merge contract.

## Verification

Automated tests will cover:

- zhuji-to-palette and palette-to-zhuji materialization;
- source immutability, target draft status, `based_on`, idempotent reuse, and
  atomic failure;
- runtime conversion submission returning the conversion and target artifacts;
- palette and zhuji semantic mapping into CCv3 fields/worldbook entries;
- relationship and multi-character preservation in structured extensions;
- conversion artifacts not becoming duplicate lore entries;
- deterministic compiler hashes and PNG round-trip metadata.

Manual acceptance remains useful for judging whether converted prose and the
resulting card behavior match the intended character; it is complementary to
the automated regression suite.
