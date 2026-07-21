# Server-derived Evidence Ranges

## Problem

`fact_submit_candidates` currently requires the Fact Curator to provide global normalized character, normalized line, and raw byte ranges. These values are deterministic properties of the stored projection and chunk, but an LLM must currently calculate them manually. This is especially error-prone for normalized newlines, Unicode surrogate pairs, and UTF-8 CJK text.

## Decision

Keep the persisted `FactEvidence` and `CandidateBatch` contracts unchanged. Replace only the MCP submission draft evidence with a locator:

```yaml
id: evidence-character-appearance
quote: exact text copied from the claimed chunk
occurrence: 0 # optional when the quote occurs once
chapter: optional label
extensions: {}
```

The server resolves each locator inside the exact task-bound chunk and creates the complete `FactEvidence`:

- source, source revision, chunk set, chunk ID, and chunk hash come from the bound job and claimed chunk;
- normalized character range is derived from the exact quote occurrence in `chunk.content` plus the chunk's global offset;
- normalized line range and raw byte range are derived from the stored projection line map;
- the existing evidence validator revalidates the generated evidence before persistence.

No fuzzy matching or whitespace normalization is permitted. A missing quote fails. When a quote occurs more than once, omission of `occurrence` fails as ambiguous. `occurrence` is zero-based and must select an existing exact match.

## Data Flow

1. Fact Curator claims one chunk and reads its verified content.
2. Fact Curator submits candidate semantics plus exact quote locators.
3. The MCP handler reloads the bound job, chunk, and source projection.
4. The ingestion module resolves every locator into full evidence.
5. Existing candidate-batch hashing, validation, persistence, and chunk completion run unchanged.
6. Stored candidate batches remain compatible with all existing review, provenance, and Facts Gate code.

## Errors

- `EVIDENCE_QUOTE_NOT_FOUND`: the exact quote is absent or the requested occurrence does not exist.
- `EVIDENCE_QUOTE_AMBIGUOUS`: multiple matches exist and no occurrence was supplied.
- Existing evidence integrity errors remain authoritative after resolution.

## Compatibility

Existing persisted candidate batches require no migration. The MCP draft contract intentionally stops accepting caller-supplied ranges so future Agents cannot bypass server derivation. Source processing repair lineage and task attempts are unaffected.

## Tests

- Derive exact character, line, and raw byte ranges for CJK and emoji quotes.
- Derive multiline evidence across normalized CRLF input.
- Reject absent quote.
- Reject ambiguous quote without occurrence.
- Resolve the requested repeated occurrence.
- Exercise `fact_submit_candidates` through MCP and verify the persisted batch contains complete evidence.
- Preserve existing evidence tamper, provenance, candidate hash, and chunk completion tests.
