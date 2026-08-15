import { describe, expect, it } from "vitest";
import {
  buildPreparedPublishSnapshot,
  buildProvenanceCompositionSummary,
  comparePreparedSnapshotDiff,
  computeBuildSnapshotHash,
  provenanceConfirmationFingerprint,
  type BuildPlan,
  type CoverageSnapshot,
  type PreparedPublishSnapshot,
  type ProjectState,
} from "../src/index.js";

function createDummyState(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    project_id: "test-proj",
    project_name: "test-project",
    project_status: "ready",
    revision: 1,
    interview: { status: "completed", questions: [], answers: [] },
    blueprint_prechecks: [],
    artifacts: [
      { id: "art-1", key: "character:c1:zhuji:main", kind: "zhuji", name: "main", revision: "rev-1", status: "reviewed", content: "{}", content_hash: "hash-1", created_at: "2026-01-01T00:00:00Z" },
      { id: "art-2", key: "world:world_lore:w1", kind: "world_lore", name: "w1", revision: "rev-1", status: "reviewed", content: "{}", content_hash: "hash-2", created_at: "2026-01-01T00:00:00Z" },
    ],
    images: [
      { id: "img-1", blob_hash: "blob-123456789abc", media_type: "image/png", width: 512, height: 512, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],
    facts: [],
    sources: [],
    source_candidates: [],
    operations: [],
    issues: [],
    reviews: [],
    quality_profile: {
      level: "normal",
      blocking_severity: "error",
      overrides: { PLACEHOLDER: "warning" },
      override_audit: [
        { code: "PLACEHOLDER", configured_severity: "warning", against_effective_severity: "error", actor: "user" },
      ],
    },
    coverage_assessments: [],
    coverage_requirement_sets: [],
    coverage_resolutions: [],
    coverage_user_decisions: [],
    fact_review_runs: [],
    publishes: [],
    builds: [],
    audit: [],
    ...overrides,
  };
}

const dummyPlan: BuildPlan = {
  entries: [
    { key: "character:c1:zhuji:main", artifact_id: "art-1", kind: "zhuji", revision: "rev-1" },
    { key: "world:world_lore:w1", artifact_id: "art-2", kind: "world_lore", revision: "rev-1" },
  ],
  missing_keys: [],
};

const dummyCoverage: CoverageSnapshot = {
  assessment_id: "cov-1",
  assessment_revision: "cov-rev-1",
  requirement_set_id: "req-1",
  requirement_set_revision: "req-rev-1",
  snapshot_hash: "cov-snap-hash",
  source_revisions: [{ source_id: "src-1", revision: "src-rev-1" }],
  resolution_ids: ["res-1"],
  authoring_binding_ids: ["bind-1"],
  source_covered_requirements: [{ requirement_id: "req-a" }],
  user_supplement_requirements: [{ requirement_id: "req-b" }],
  creative_completion_requirements: [{ requirement_id: "req-c" }],
};

describe("Audit 7 Batch 7 - Core PreparedPublishSnapshot & Stale Diff", () => {
  it("builds canonical PreparedPublishSnapshot deterministically", () => {
    const state = createDummyState();
    const buildSnapshotHash = computeBuildSnapshotHash(state, dummyPlan, "zhuji", dummyCoverage);
    const composition = buildProvenanceCompositionSummary(state, dummyCoverage, buildSnapshotHash);
    const fingerprint = provenanceConfirmationFingerprint(composition);

    const snapshot1 = buildPreparedPublishSnapshot(state, dummyPlan, "zhuji", dummyCoverage, composition, fingerprint);
    const snapshot2 = buildPreparedPublishSnapshot(state, dummyPlan, "zhuji", dummyCoverage, composition, fingerprint);

    expect(snapshot1).toEqual(snapshot2);
    expect(snapshot1.version).toBe("prepared-snapshot-v2");
    expect(snapshot1.artifacts.length).toBe(2);
    expect(snapshot1.groups.mode.status).toBe("included");
    expect(snapshot1.groups.artifacts.status).toBe("included");
    expect(snapshot1.groups.coverage.status).toBe("included");
    expect(snapshot1.groups.quality_policy.status).toBe("included");
    expect(snapshot1.human_acknowledgement).toContain("我確認並批准目前畫面所顯示的模式");
  });

  it("detects mode change in stale diff", () => {
    const state1 = createDummyState();
    const hash1 = computeBuildSnapshotHash(state1, dummyPlan, "zhuji", dummyCoverage);
    const comp1 = buildProvenanceCompositionSummary(state1, dummyCoverage, hash1);
    const fp1 = provenanceConfirmationFingerprint(comp1);
    const snap1 = buildPreparedPublishSnapshot(state1, dummyPlan, "zhuji", dummyCoverage, comp1, fp1);

    const hash2 = computeBuildSnapshotHash(state1, dummyPlan, "palette", dummyCoverage);
    const comp2 = buildProvenanceCompositionSummary(state1, dummyCoverage, hash2);
    const fp2 = provenanceConfirmationFingerprint(comp2);
    const snap2 = buildPreparedPublishSnapshot(state1, dummyPlan, "palette", dummyCoverage, comp2, fp2);

    const diff = comparePreparedSnapshotDiff(snap1, snap2);
    expect(diff.is_stale).toBe(true);
    expect(diff.changed_inputs.some((item) => item.category === "mode")).toBe(true);
  });

  it("detects artifact revisions change in stale diff", () => {
    const state1 = createDummyState();
    const hash1 = computeBuildSnapshotHash(state1, dummyPlan, "zhuji", dummyCoverage);
    const comp1 = buildProvenanceCompositionSummary(state1, dummyCoverage, hash1);
    const fp1 = provenanceConfirmationFingerprint(comp1);
    const snap1 = buildPreparedPublishSnapshot(state1, dummyPlan, "zhuji", dummyCoverage, comp1, fp1);

    const modifiedPlan: BuildPlan = {
      entries: [
        { key: "character:c1:zhuji:main", artifact_id: "art-1", kind: "zhuji", revision: "rev-2" },
        { key: "world:world_lore:w1", artifact_id: "art-2", kind: "world_lore", revision: "rev-1" },
      ],
      missing_keys: [],
    };
    const hash2 = computeBuildSnapshotHash(state1, modifiedPlan, "zhuji", dummyCoverage);
    const comp2 = buildProvenanceCompositionSummary(state1, dummyCoverage, hash2);
    const fp2 = provenanceConfirmationFingerprint(comp2);
    const snap2 = buildPreparedPublishSnapshot(state1, modifiedPlan, "zhuji", dummyCoverage, comp2, fp2);

    const diff = comparePreparedSnapshotDiff(snap1, snap2);
    expect(diff.is_stale).toBe(true);
    expect(diff.changed_inputs.some((item) => item.category === "artifact_revisions")).toBe(true);
  });

  it("detects quality policy changes in stale diff", () => {
    const state1 = createDummyState();
    const hash1 = computeBuildSnapshotHash(state1, dummyPlan, "zhuji", dummyCoverage);
    const comp1 = buildProvenanceCompositionSummary(state1, dummyCoverage, hash1);
    const fp1 = provenanceConfirmationFingerprint(comp1);
    const snap1 = buildPreparedPublishSnapshot(state1, dummyPlan, "zhuji", dummyCoverage, comp1, fp1);

    const state2 = createDummyState({
      quality_profile: {
        level: "strict",
        blocking_severity: "warning",
        overrides: {},
        override_audit: [],
      },
    });
    const hash2 = computeBuildSnapshotHash(state2, dummyPlan, "zhuji", dummyCoverage);
    const comp2 = buildProvenanceCompositionSummary(state2, dummyCoverage, hash2);
    const fp2 = provenanceConfirmationFingerprint(comp2);
    const snap2 = buildPreparedPublishSnapshot(state2, dummyPlan, "zhuji", dummyCoverage, comp2, fp2);

    const diff = comparePreparedSnapshotDiff(snap1, snap2);
    expect(diff.is_stale).toBe(true);
    expect(diff.changed_inputs.some((item) => item.category === "quality_policy")).toBe(true);
  });

  it("returns is_stale false when snapshots are identical", () => {
    const state = createDummyState();
    const hash = computeBuildSnapshotHash(state, dummyPlan, "zhuji", dummyCoverage);
    const comp = buildProvenanceCompositionSummary(state, dummyCoverage, hash);
    const fp = provenanceConfirmationFingerprint(comp);
    const snap = buildPreparedPublishSnapshot(state, dummyPlan, "zhuji", dummyCoverage, comp, fp);

    const diff = comparePreparedSnapshotDiff(snap, snap);
    expect(diff.is_stale).toBe(false);
    expect(diff.changed_inputs.length).toBe(0);
  });
});
