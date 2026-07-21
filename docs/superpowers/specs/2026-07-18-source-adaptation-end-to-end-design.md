# Source Adaptation End-to-End Design

## Status

Approved for implementation under the user's explicit autonomous implementation authorization.

## Problem

`source_adaptation` currently creates an empty `curate-facts` Workflow Task. The Task cannot use source-processing tools, claimed chunk content is not returned, candidate submission does not complete ingestion chunk work, and the configured runtime rejects the entry before it can reach Facts Review or Blueprint authoring. Existing projects such as `ye-hong-shang` therefore become permanently blocked despite having valid immutable source revisions and projections.

## Goals

- Run Source Adaptation from an already ingested source through Facts Review, Blueprint, the shared authoring tail, preview, and publish.
- Preserve exact source, chunk, candidate, fact, and Workflow lineage.
- Keep ingestion chunk retries separate from Workflow Task attempts.
- Recover legacy failed `curate-facts` Tasks without rewriting journals or re-ingesting sources.
- Reuse the existing Blueprint-driven character, world, review, and Greetings routing.

## Non-Goals

- Replacing the file transaction architecture with a cross-journal distributed transaction.
- Adding source retrieval or OCR formats beyond the existing ingestion adapters.
- Reworking Character, World, or Greetings review bundles.
- Automatically accepting extracted facts.
- Modifying project data during installation or tests.

## Chosen Architecture

Source Adaptation is a source-specific prelude followed by the existing shared authoring tail:

```text
intake
  -> source_processing
  -> facts_review
  -> Facts Gate
  -> blueprint
  -> Blueprint Gate
  -> shared world/character/review/greetings/content/preview/publish stages
```

The Workflow Task is the orchestration owner. Ingestion Jobs remain the fine-grained chunk execution model. Every ingestion mutation must carry the Workflow `task_id` and `lease_id`; authorization therefore requires the intersection of Agent, Task, policy, and lease capabilities.

## Source Set and Task Materialization

`workflow_start` for `source_adaptation` reads the current Source Manifest and fails with `SOURCE_ADAPTATION_SOURCE_REQUIRED` when no current source revision exists. It creates exact source Artifact References and assigns them to `curate-facts`.

The Task has:

- capabilities `task.execute`, `source.process`, `facts.propose`, and `facts.read`;
- output contract `facts-curation-summary@1`;
- exact source revision inputs;
- `extensions.stage = source_processing`;
- a persisted `source_jobs` map populated as each deterministic extraction job is prepared.

Source artifact IDs are engine-generated and never interpreted as filesystem paths.

## Source Processing Tools

### `source_create_chunks`

This existing tool becomes Task-scoped and receives Workflow event/CAS fields. It verifies that the requested source revision is assigned to the claimed Task, deterministically creates or reuses the Chunk Set and Extraction Job, then records the exact Job identity in Task extensions.

The ingestion writes and Workflow mutation form an idempotent saga. If the process stops after the ingestion write, retrying recreates the same IDs and completes only the missing Workflow mutation.

### `source_get_chunk_task`

This existing tool becomes Task-scoped. Status reads and claims verify that the Job is bound to the Workflow Task. A successful claim returns the persisted Job state plus the exact verified chunk payload, identity, ranges, and lease. Agents never receive a raw path.

### `fact_submit_candidates`

This existing tool becomes Task-scoped and chunk-scoped. A Candidate Batch includes exact `chunk_id` and `chunk_hash`, and its `candidates` array may be empty. Every non-creative candidate evidence item must belong to that chunk.

Submission validates the Workflow lease and ingestion lease, stores the immutable Candidate Batch, and completes that ingestion chunk. The two writes are idempotent: a retry accepts only byte-equivalent batch content and completes only the still-processing matching chunk.

### `fact_finalize_curation`

This new specialized completion tool verifies:

- every source input has one Task-bound current Job;
- every Job is completed;
- every completed chunk references a valid immutable Candidate Batch for that exact chunk;
- current Source revisions and Chunk Sets still match;
- Candidate Batch identity and evidence chains remain valid.

It creates an exact `facts-curation-summary@1` result reference and completes the Workflow Task through the Workflow repository transaction. It does not accept or reject facts.

## Facts Review and Gate

`facts_review_status` is a Director-only, no-Task read tool. It returns bounded review state: source/job completion, Candidate IDs and contents, decision status, accepted Fact Register revision, Conflict Register revision, unresolved Candidate IDs, and provenance diagnostics.

Facts Gate approval is fail-closed. For Source Adaptation, the MCP gate handler computes the current Facts snapshot and requires the supplied input revisions to match the engine-computed Fact Register and Conflict Register revisions. Approval is rejected while:

- curation is incomplete;
- any Candidate lacks a review decision;
- Fact or Conflict projections are invalid;
- accepted source-derived Facts fail provenance verification.

`facts_review -> blueprint` requires the approved exact Facts Gate. The engine creates a `create-blueprint` Director Task with current Fact artifacts included in its inputs.

Applying a Blueprint proposal preserves the approved Facts Gate while superseding downstream Blueprint, Content, and Publish approvals as applicable.

## Shared Authoring Tail

After Blueprint approval, `source_adaptation` uses `materializeOriginalTasks`. Character Agents are selected from each Blueprint character's actual `mode`; the obsolete static `source-character` template is removed. World timing, Character Review, World Review, Greetings, Content Gate, preview, and publish retain the same invariants as Original projects.

## Legacy Repair

Director-only `source_processing_repair_begin` repairs legacy orchestration failures. It requires:

- `entry_kind = source_adaptation` and `stage = source_processing`;
- a terminal failed legacy `curate-facts` Task with exhausted attempts;
- no active Task lease;
- valid current Source revisions/projections;
- no prior repair lineage for the target;
- Workflow revision/event CAS.

The operation preserves and supersedes the failed Task, creates one new pending `curate-facts` successor using the corrected contract/capabilities/source inputs, and appends a `source_processing.repair_requested` Decision. It does not create chunks, modify Facts, or re-ingest sources. The Fact Curator resumes through the normal tools.

## Errors

Stable errors include:

- `SOURCE_ADAPTATION_SOURCE_REQUIRED`
- `SOURCE_TASK_INPUT_NOT_ASSIGNED`
- `SOURCE_JOB_NOT_BOUND`
- `SOURCE_JOB_BINDING_CONFLICT`
- `CANDIDATE_CHUNK_MISMATCH`
- `CURATION_INCOMPLETE`
- `CURATION_RESULT_INVALID`
- `FACTS_REVIEW_INCOMPLETE`
- `FACTS_GATE_SNAPSHOT_STALE`
- `SOURCE_PROCESSING_REPAIR_TARGET_INVALID`
- `SOURCE_PROCESSING_REPAIR_LINEAGE_EXISTS`

Existing ingestion CAS, lease, evidence, revision, and transaction errors remain authoritative.

## Testing

Regression coverage must include:

- Source Adaptation start rejects missing sources and materializes exact source inputs.
- Tool authorization requires the matching Workflow Task lease.
- Chunk claims return verified content and cannot cross Task-bound Jobs.
- Candidate submission supports zero candidates, binds to one chunk, completes that chunk, rejects stale leases and cross-chunk evidence, and is idempotent.
- Finalization rejects partial Jobs and completes the Workflow Task only after every source Job completes.
- Facts Review exposes complete bounded state; Gate rejects undecided Candidates and stale revisions.
- Facts Gate remains approved after Blueprint proposal application.
- Runtime creates Blueprint Task and then uses Palette/Zhuji mode-driven shared tail.
- Legacy repair preserves the failed Task, creates one successor, rejects duplicate repair, and does not alter source files.
- A public MCP end-to-end test covers intake/start/process/review/gate/Blueprint transition.
- Full build, TypeScript, ESLint, Agent lint, and all tests pass; `dist` contains the new tools.

## Migration Safety

No project is automatically mutated. Existing valid Candidate Batches are absent from current projects, so the Candidate Batch contract may add required chunk identity without a persisted-data migration. `ye-hong-shang` is repaired only when Director explicitly invokes the new repair tool after OpenCode restart.
