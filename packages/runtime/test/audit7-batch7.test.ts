import { describe, expect, it } from "vitest";
import {
  CoreError,
  MemoryProjectRepository,
  contentHash,
  provenanceConfirmationFingerprint,
  type ArtifactRecord,
  type ProjectRepository,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];
const PALETTE_MODULES = ["profile", "persona", "worldview", "mannerisms", "scenarios", "dialogue_examples", "lorebook"];

function makeModuleArtifact(kind: "zhuji" | "palette", characterId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module, title: module, data: { description: `${module} module.` } } });
  return {
    id: `${kind}-${module}`,
    key: `${kind}:${characterId}/${module}`,
    kind,
    name: `${characterId}/${module}`,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "reviewed",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function makeGreetingArtifact(characterId: string): ArtifactRecord {
  const content = JSON.stringify({
    document: {
      greetings: [
        { id: "g1", kind: "primary", content: "Hello there!", character_ids: [characterId] },
      ],
    },
  });
  return {
    id: "art-greeting",
    key: `greeting:${characterId}/default`,
    kind: "greeting",
    name: `${characterId}/default`,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "reviewed",
    created_at: now,
    updated_at: now,
    created_by: "greetings_creator",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function makeWorldLoreArtifact(): ArtifactRecord {
  const content = JSON.stringify({
    entries: [
      { id: "e1", keys: ["world"], content: "World description." },
    ],
  });
  return {
    id: "art-world",
    key: "world_lore:global",
    kind: "world_lore",
    name: "global",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "reviewed",
    created_at: now,
    updated_at: now,
    created_by: "world_lore_creator",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function makeCharacterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: "Alpha", aliases: [], summary: "A character.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm.", provenance: [], extensions: {} }], provenance: [], extensions: {} } });
  return {
    id: `character-${id}`,
    key: `character:${id}`,
    kind: "character",
    name: id,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "reviewed",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function sourceRecord(id: string, text: string) {
  return {
    id,
    candidate_id: `candidate-${id}`,
    title: id,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: now,
  };
}

function factRecord(): import("@st-workspace/core").FactRecord {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "accepted",
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    coverage_targets: ["req.personality"],
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "fact-reviewer-1",
  };
}

function reviewRun(): import("@st-workspace/core").FactReviewRunRecord {
  return {
    schema_version: 1,
    id: "run-1",
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "pol-1",
    status: "completed",
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(): import("@st-workspace/core").FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id: "dec-1",
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted",
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: 1,
    created_at: now,
  };
}

async function createTestRuntime(includePalette = false): Promise<{ runtime: WorkspaceRuntime; repo: ProjectRepository }> {
  const repo = new MemoryProjectRepository("test-proj");
  const pre = {
    id: "precheck-1",
    schema_version: 1,
    project_id: "test-proj",
    operation_id: "op-precheck",
    collaboration_mode: "assisted" as const,
    candidate_blueprint: { schema_version: 1, flow: "source_adaptation" as const, characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: includePalette ? "both" : "zhuji" }], primary_character_id: "alpha", export_modes: includePalette ? "both" : "zhuji" },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core" as const, uncertainty: "low" as const, impact: "high" as const, basis: "explicit" as const, action: "preserve_explicit" as const }],
    status: "recorded" as const,
    created_at: now,
    created_by: "director",
  };

  await repo.commit(0, (current) => {
    const charArt = makeCharacterArtifact("alpha");
    const zhujiArts = ZHUJI_MODULES.map((m) => makeModuleArtifact("zhuji", "alpha", m));
    const paletteArts = includePalette ? PALETTE_MODULES.map((m) => makeModuleArtifact("palette", "alpha", m)) : [];
    const greetingArt = makeGreetingArtifact("alpha");
    const worldArt = makeWorldLoreArtifact();
    const blueprintContent = JSON.stringify({
      characters: [{ id: "alpha", label: "Alpha", mode: includePalette ? "both" : "zhuji" }],
      export_modes: includePalette ? "both" : "zhuji",
    });
    const blueprintArt: ArtifactRecord = {
      id: "art-blueprint",
      key: "blueprint:project",
      kind: "blueprint",
      name: "project",
      content: blueprintContent,
      media_type: "application/json",
      content_hash: contentHash(blueprintContent),
      revision: contentHash(blueprintContent),
      status: "reviewed",
      created_at: now,
      updated_at: now,
      created_by: "director",
      operation_id: "op-author",
    };

    const allArts = [blueprintArt, charArt, ...zhujiArts, ...paletteArts, greetingArt, worldArt];
    const reviewable = allArts.filter((a) => a.kind !== "blueprint");
    const reviews = reviewable.map((item, index) => ({
      id: `review-${index + 1}`,
      artifact_id: item.id,
      artifact_revision: item.revision,
      reviewer: "reviewer",
      status: "passed" as const,
      issue_ids: [],
      created_at: now,
    }));

    return {
      ...current,
      project_id: "test-proj",
      project_name: "Test Project",
      project_status: "ready",
      interview: { ...current.interview, flow: "source_adaptation", status: "complete" },
      blueprint_prechecks: [pre],
      artifacts: allArts,
      sources: [sourceRecord("source-1", "Alpha is calm.")],
      facts: [factRecord()],
      fact_review_runs: [reviewRun()],
      fact_review_decisions: [acceptedDecision()],
      reviews,
      operations: [
        { id: "op-author", kind: "authoring", request: "author", actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] },
        { id: "op-precheck", kind: "interview", request: "precheck", actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] },
        { id: "op-review", kind: "review", request: "review", actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] },
      ],
      quality_profile: {
        level: "normal",
        blocking_severity: "error",
        overrides: {},
        override_audit: [],
      },
    };
  });

  const runtime = new WorkspaceRuntime(repo, { interviewRequired: false });
  const { assessment } = await runtime.coverageAssessment("formal");
  const stateAfterAssessment = await repo.read();
  await repo.commit(stateAfterAssessment.revision, (current) => ({
    ...current,
    coverage_assessments: current.coverage_assessments.map((item) => item.id === assessment.id
      ? { ...item, items: item.items.map((cell) => ({ ...cell, status: "covered_by_source" as const, accepted_fact_ids: ["fact-acc"] })) }
      : item),
  }));

  const ready = await repo.read();
  const coverageSensitiveArtifacts = ready.artifacts.filter((item) => item.kind === "character" || item.kind === "zhuji" || item.kind === "palette" || item.kind === "greeting");
  const requirementSet = ready.coverage_requirement_sets.at(-1)!;
  const factProjection = (await import("@st-workspace/core")).coverageFactProjectionRevision(ready);
  const authoringBindingHash = (await import("@st-workspace/core")).authoringBindingHash;

  const bindings = coverageSensitiveArtifacts.map((artifact, index) => {
    const input = {
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_revision: requirementSet.revision,
      fact_projection_revision: factProjection,
      fact_review_run_id: "run-1",
      resolution_ids: [] as string[],
    };
    return {
      id: `binding-${artifact.id}-${index}`,
      ...input,
      input_snapshot_hash: authoringBindingHash(input),
      created_by: "director",
      created_at: now,
    };
  });

  const plan = (await import("@st-workspace/core")).computeProjectProjection(ready).publishPlan();
  await repo.commit(ready.revision, (current) => ({
    ...current,
    coverage_authoring_bindings: bindings,
    builds: [...current.builds, {
      id: "build-1",
      operation_id: "op-build",
      status: "previewed" as const,
      artifact_ids: plan.entries.map((entry) => entry.artifact_id),
      content_hash: contentHash("build-1"),
      diagnostics: [],
      created_at: now,
    }],
    operations: [
      ...current.operations,
      { id: "op-build", kind: "build" as any, request: "build", actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] },
    ],
  }));

  return { runtime, repo };
}

describe("Audit 7 Batch 7 - Runtime Prepared Snapshot & Stale Diff & Both Mode", () => {
  it("returns full prepared_snapshot in publishProvenancePreview", async () => {
    const { runtime } = await createTestRuntime();
    const preview = await runtime.publishProvenancePreview("zhuji");

    expect(preview.available).toBe(true);
    expect(preview.fingerprint).toBeDefined();
    expect(preview.prepared_snapshot).toBeDefined();
    const snap = preview.prepared_snapshot!;
    expect(snap.version).toBe("prepared-snapshot-v2");
    expect(snap.groups.mode.status).toBe("included");
    expect(snap.groups.artifacts.status).toBe("included");
    expect(snap.predicted_outputs.files).toContain("exports/Test Project.json");
    expect(snap.human_acknowledgement).toContain("我確認並批准目前畫面所顯示的模式");
  });

  it("successfully confirms publish with bound snapshot and fingerprint", async () => {
    const { runtime, repo } = await createTestRuntime();
    const preview = await runtime.publishProvenancePreview("zhuji");
    expect(preview.available).toBe(true);

    const res = await runtime.publishProvenanceConfirm(
      {
        fingerprint: preview.fingerprint!,
        mode_selection: "zhuji",
        idempotency_key: "idem-1",
        prepared_snapshot: preview.prepared_snapshot,
      },
      { actor: "user", attachments: [] },
    );
    if (res.status !== "completed") {
      console.error("CONFIRM FAILED SUMMARY:", res.summary);
    }
    expect(res.status).toBe("completed");
    expect(res.publish_id).toBeDefined();
    const state = await repo.read();
    expect(state.publishes.length).toBe(1);
    expect(state.publishes[0]?.provenance_summary).toBeDefined();
    expect(provenanceConfirmationFingerprint(state.publishes[0]?.provenance_summary!)).toBe(preview.fingerprint);
  });

  it("returns structured changed_inputs when state changes after preview (stale diff)", async () => {
    const { runtime, repo } = await createTestRuntime();
    const preview = await runtime.publishProvenancePreview("zhuji");
    expect(preview.available).toBe(true);

    // Modify state: change quality profile
    const currentState = await repo.read();
    await repo.commit(currentState.revision, (current) => ({
      ...current,
      quality_profile: {
        level: "strict",
        blocking_severity: "warning",
        overrides: { TEST_CODE: "warning" },
        override_audit: [
          { code: "TEST_CODE", configured_severity: "warning", against_effective_severity: "error", actor: "user", occurred_at: now },
        ],
      },
    }));

    // Confirm using old prepared_snapshot
    let errorCaught: any;
    try {
      await runtime.publishProvenanceConfirm(
        {
          fingerprint: preview.fingerprint!,
          mode_selection: "zhuji",
          idempotency_key: "idem-stale-1",
          prepared_snapshot: preview.prepared_snapshot,
        },
        { actor: "user", attachments: [] },
      );
    } catch (error) {
      errorCaught = error;
    }

    expect(errorCaught).toBeInstanceOf(CoreError);
    expect(errorCaught.code).toBe("PROVENANCE_CONFIRMATION_STALE");
    expect(errorCaught.details).toBeDefined();
    expect(Array.isArray(errorCaught.details.changed_inputs)).toBe(true);
    const changed = errorCaught.details.changed_inputs;
    expect(changed.some((item: any) => item.category === "quality_policy")).toBe(true);

    // Verify no operation or publish record created
    const finalState = await repo.read();
    expect(finalState.publishes.length).toBe(0);
    expect(finalState.operations.filter((op) => op.command?.type === "provenance_publish").length).toBe(0);
  });

  it("maintains Batch 6 idempotency priority: completed publish is replayed even if state changes", async () => {
    const { runtime, repo } = await createTestRuntime();
    const preview = await runtime.publishProvenancePreview("zhuji");

    const firstRes = await runtime.publishProvenanceConfirm(
      {
        fingerprint: preview.fingerprint!,
        mode_selection: "zhuji",
        idempotency_key: "idem-replay-1",
        prepared_snapshot: preview.prepared_snapshot,
      },
      { actor: "user", attachments: [] },
    );
    expect(firstRes.status).toBe("completed");

    // Later state change
    const cur = await repo.read();
    await repo.commit(cur.revision, (s) => ({
      ...s,
      quality_profile: { level: "strict", blocking_severity: "warning", overrides: {}, override_audit: [] },
    }));

    // Replay with identical idempotency_key
    const replayRes = await runtime.publishProvenanceConfirm(
      {
        fingerprint: preview.fingerprint!,
        mode_selection: "zhuji",
        idempotency_key: "idem-replay-1",
      },
      { actor: "user", attachments: [] },
    );

    expect(replayRes.status).toBe("completed");
    expect(replayRes.idempotent_replay).toBe(true);
    expect(replayRes.publish_id).toBe(firstRes.publish_id);
  });

  it("reports both mode readiness and blockers accurately", async () => {
    // 1. Only zhuji available
    const { runtime: zhujiOnlyRuntime } = await createTestRuntime(false);
    const preview1 = await zhujiOnlyRuntime.publishProvenancePreview("zhuji");
    expect(preview1.both_readiness).toBeDefined();
    expect(preview1.both_readiness?.both_available).toBe(false);
    expect(preview1.both_readiness?.both_blockers.some((b) => b.mode === "palette")).toBe(true);

    // 2. Both zhuji and palette available
    const { runtime: dualRuntime } = await createTestRuntime(true);
    const preview2 = await dualRuntime.publishProvenancePreview("both");
    expect(preview2.available).toBe(true);
    expect(preview2.both_readiness?.both_available).toBe(true);
    expect(preview2.prepared_snapshot?.predicted_outputs.is_dual_mode).toBe(true);
  });
});
