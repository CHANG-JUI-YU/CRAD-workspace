import { describe, expect, it } from "vitest";
import {
  buildProvenanceCompositionSummary,
  computeBuildSnapshotHash,
  contentHash,
  coverageSnapshotHash,
  createProjectState,
  deriveActiveDecisionRefs,
  deriveHistoricalDecisionRefs,
  provenanceCompositionSummarySchema,
  provenanceConfirmationFingerprint,
  type BuildPlan,
  type CoverageResolution,
  type CoverageSnapshot,
  type CoverageUserDecisionRecord,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";

function decision(overrides: Partial<CoverageUserDecisionRecord> = {}): CoverageUserDecisionRecord {
  return {
    id: "dec-1",
    action: "user_supplement",
    requirement_ids: ["req.personality"],
    character_id: "alpha",
    choice: "supplement",
    rationale: "用户补充",
    actor: "tester",
    operation_id: "op-1",
    created_at: now,
    ...overrides,
  };
}

function resolution(overrides: Partial<CoverageResolution> = {}): CoverageResolution {
  return {
    id: "res-1",
    character_id: "alpha",
    requirement_id: "req.personality",
    mode: "user_supplement",
    status: "fulfilled",
    assessment_id: "assess-1",
    assessment_revision: "rev-assess-1",
    requirement_set_revision: "set-rev-1",
    rationale: "补足",
    user_decision_id: "dec-1",
    authorized_by: "tester",
    operation_id: "op-1",
    created_by: "tester",
    created_at: now,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  const base: CoverageSnapshot = {
    assessment_id: "assess-1",
    assessment_revision: "rev-assess-1",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    blueprint_revision: contentHash("blueprint-1"),
    fact_projection_revision: contentHash("projection-1"),
    fact_review_run_id: "run-1",
    fact_review_projection_revision: contentHash("run-1"),
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    source_covered_requirements: [{ character_id: "alpha", requirement_id: "req.personality" }],
    user_supplement_requirements: [],
    creative_completion_requirements: [],
    resolution_ids: ["res-1"],
    authoring_binding_ids: ["binding-1"],
    snapshot_hash: "",
  };
  const merged = { ...base, ...overrides };
  merged.snapshot_hash = coverageSnapshotHash(merged);
  return merged;
}

function baseState(projectId: string) {
  const state = createProjectState(projectId);
  state.artifacts = [
    { id: "character-alpha", key: "character:alpha", kind: "character", name: "Alpha", content: "{}", content_hash: contentHash("character-v1"), revision: "rev-1", status: "draft", created_at: now, updated_at: now, created_by: "tester", operation_id: "op-1" },
  ];
  state.quality_profile.level = "normal";
  state.quality_profile.blocking_severity = "error";
  return state;
}

function plan(mode: string | null = "zhuji"): BuildPlan {
  return {
    mode_selection: mode ?? undefined,
    export_roster: ["alpha"],
    world_enabled: false,
    relationships_enabled: false,
    world_artifact_ids: [],
    relationship_artifact_ids: [],
    entries: [{ key: "character:alpha", artifact_id: "character-alpha", kind: "character", revision: "rev-1" }],
    diagnostics: [],
  };
}

describe("#51 active decisions separated from history", () => {
  it("includes only decisions reachable through the snapshot resolution lineage", () => {
    const state = baseState("p51-active");
    state.coverage_user_decisions = [decision(), decision({ id: "dec-2", supersedes: "dec-1" })];
    state.coverage_resolutions = [resolution()];
    const snap = snapshot();
    const active = deriveActiveDecisionRefs(state, snap);
    expect(active.map((ref) => ref.decision_id)).toEqual(["dec-1"]);
    const summary = buildProvenanceCompositionSummary(state, snap, contentHash("build-snap-1"), contentHash("compiled-1"));
    expect(summary.overrides).toEqual([{ decision_id: "dec-1", action: "user_supplement", requirement_ids: ["req.personality"], rationale: "用户补充" }]);
  });

  it("excludes superseded decisions from the active composition", () => {
    const state = baseState("p51-superseded");
    state.coverage_user_decisions = [decision(), decision({ id: "dec-2", supersedes: "dec-1" })];
    state.coverage_resolutions = [resolution({ user_decision_id: "dec-1" }), resolution({ id: "res-2", user_decision_id: "dec-2" })];
    const snap = snapshot({ resolution_ids: ["res-2"] });
    const active = deriveActiveDecisionRefs(state, snap);
    expect(active.map((ref) => ref.decision_id)).toEqual(["dec-2"]);
  });

  it("excludes decisions of older assessments or requirement sets not referenced by the snapshot", () => {
    const state = baseState("p51-old");
    state.coverage_user_decisions = [decision(), decision({ id: "dec-old", assessment_id: "assess-0", assessment_revision: "rev-0", requirement_set_revision: "set-rev-0" })];
    state.coverage_resolutions = [resolution(), resolution({ id: "res-old", assessment_id: "assess-0", assessment_revision: "rev-0", user_decision_id: "dec-old" })];
    const snap = snapshot();
    expect(deriveActiveDecisionRefs(state, snap).map((ref) => ref.decision_id)).toEqual(["dec-1"]);
  });

  it("keeps every historical decision readable for audit", () => {
    const state = baseState("p51-history");
    state.coverage_user_decisions = [decision(), decision({ id: "dec-2", supersedes: "dec-1" }), decision({ id: "dec-old", assessment_id: "assess-0", requirement_set_revision: "set-rev-0" })];
    state.coverage_resolutions = [resolution()];
    const snap = snapshot();
    const historical = deriveHistoricalDecisionRefs(state, snap);
    expect(historical.map((ref) => ref.decision_id)).toEqual(["dec-2", "dec-old"]);
    expect(state.coverage_user_decisions.length).toBe(3);
  });

  it("fails closed without a coverage snapshot: no decision is treated as active", () => {
    const state = baseState("p51-failclosed");
    state.coverage_user_decisions = [decision(), decision({ id: "dec-2" })];
    state.coverage_resolutions = [resolution()];
    const summary = buildProvenanceCompositionSummary(state, undefined, contentHash("build-snap-1"), contentHash("compiled-1"));
    expect(summary.overrides).toEqual([]);
    expect(deriveActiveDecisionRefs(state, undefined)).toEqual([]);
    expect(deriveHistoricalDecisionRefs(state, undefined).map((ref) => ref.decision_id)).toEqual(["dec-1", "dec-2"]);
  });

  it("is deterministic and deduplicated regardless of record order", () => {
    const state = baseState("p51-deterministic");
    state.coverage_user_decisions = [decision({ id: "dec-b" }), decision({ id: "dec-a" }), decision({ id: "dec-a" })];
    state.coverage_resolutions = [resolution({ id: "res-a", user_decision_id: "dec-a" }), resolution({ id: "res-b", user_decision_id: "dec-b" }), resolution({ id: "res-c", user_decision_id: "dec-b" })];
    const snap = snapshot({ resolution_ids: ["res-b", "res-a", "res-c"] });
    const active = deriveActiveDecisionRefs(state, snap);
    expect(active.map((ref) => ref.decision_id)).toEqual(["dec-a", "dec-b"]);
    const first = buildProvenanceCompositionSummary(state, snap, contentHash("build-snap-1"), contentHash("compiled-1"));
    state.coverage_user_decisions.reverse();
    state.coverage_resolutions.reverse();
    const second = buildProvenanceCompositionSummary(state, snap, contentHash("build-snap-1"), contentHash("compiled-1"));
    expect(second).toEqual(first);
  });
});

describe("#52 build snapshot hash identity", () => {
  it("keeps compiled content hash and build snapshot hash semantically separate", () => {
    const state = baseState("p52-separate");
    const snap = snapshot();
    const buildHash = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    const summary = buildProvenanceCompositionSummary(state, snap, buildHash, contentHash("compiled-v1"));
    expect(summary.build_snapshot_hash).not.toBe(summary.compiled_content_hash);
    expect(summary.compiled_content_hash).toBe(contentHash("compiled-v1"));
  });

  it("changes when a relevant build input changes", () => {
    const state = baseState("p52-sensitive");
    const snap = snapshot();
    const before = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    state.artifacts[0].content_hash = contentHash("character-v2");
    const afterContent = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    expect(afterContent).not.toBe(before);
    state.artifacts[0].content_hash = contentHash("character-v1");
    const afterMode = computeBuildSnapshotHash(state, plan(), "palette", snap);
    expect(afterMode).not.toBe(before);
    const afterSnapshot = computeBuildSnapshotHash(state, plan(), "zhuji", snapshot({ assessment_revision: "rev-assess-2" }));
    expect(afterSnapshot).not.toBe(before);
  });

  it("ignores created_at, operation ids and array insertion order", () => {
    const state = baseState("p52-stable");
    const snap = snapshot({ resolution_ids: ["res-1"], source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }] });
    const before = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    state.artifacts[0].created_at = "2026-09-01T00:00:00.000Z";
    state.artifacts[0].operation_id = "op-999";
    const afterMeta = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    expect(afterMeta).toBe(before);
    const reordered = computeBuildSnapshotHash(state, plan(), "zhuji", { ...snap, resolution_ids: ["res-1"], source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }] });
    expect(reordered).toBe(before);
  });

  it("round-trips through the strict schema with optional compiled content hash", () => {
    const state = baseState("p52-schema");
    const snap = snapshot();
    const buildHash = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    const modern = buildProvenanceCompositionSummary(state, snap, buildHash, contentHash("compiled-1"));
    expect(provenanceCompositionSummarySchema.parse(modern)).toEqual(modern);
    const legacy = buildProvenanceCompositionSummary(state, snap, buildHash);
    expect(legacy.compiled_content_hash).toBeUndefined();
    expect(provenanceCompositionSummarySchema.parse(legacy)).toEqual(legacy);
  });
});

describe("#68 confirmation fingerprint", () => {
  it("is stable for the same composition and changes when refs change", () => {
    const state = baseState("p68-fingerprint");
    const snap = snapshot();
    const buildHash = computeBuildSnapshotHash(state, plan(), "zhuji", snap);
    const composition = buildProvenanceCompositionSummary(state, snap, buildHash, contentHash("compiled-1"));
    const fingerprint = provenanceConfirmationFingerprint(composition);
    expect(fingerprint).toBe(provenanceConfirmationFingerprint(composition));
    const changed = buildProvenanceCompositionSummary(state, snapshot({ resolution_ids: ["res-other"] }), buildHash, contentHash("compiled-1"));
    expect(provenanceConfirmationFingerprint(changed)).not.toBe(fingerprint);
  });
});
