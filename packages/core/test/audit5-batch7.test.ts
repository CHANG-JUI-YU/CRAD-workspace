import { describe, expect, it } from "vitest";
import {
  buildProvenanceCompositionSummary,
  contentHash,
  coverageSnapshotHash,
  createProjectState,
  provenanceCompositionSummarySchema,
  validateState,
  type BuildRecord,
  type CoverageSnapshot,
  type PublishRecord,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";

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
    creative_completion_requirements: [{ requirement_id: "req.world_context" }],
    resolution_ids: ["res-1"],
    authoring_binding_ids: ["binding-1"],
    snapshot_hash: "",
  };
  base.snapshot_hash = coverageSnapshotHash({ ...base, ...overrides });
  return { ...base, ...overrides, snapshot_hash: coverageSnapshotHash({ ...base, ...overrides }) };
}

describe("provenance composition summary", () => {
  it("composes every coverage snapshot facet with counts and ids", () => {
    const state = createProjectState("provenance-core");
    state.coverage_user_decisions = [
      { id: "dec-1", action: "user_supplement", requirement_ids: ["req.personality"], character_id: "alpha", choice: "supplement", rationale: "用户补充", actor: "tester", operation_id: "op-1", supersedes: "dec-0", created_at: now },
    ];
    const snap = snapshot();
    const summary = buildProvenanceCompositionSummary(state, snap, contentHash("compiled-1"));

    expect(summary.source_backed).toEqual({ refs: [{ character_id: "alpha", requirement_id: "req.personality" }], count: 1 });
    expect(summary.creative_completion).toEqual({ refs: [{ requirement_id: "req.world_context" }], count: 1 });
    expect(summary.user_supplement.count).toBe(0);
    expect(summary.overrides).toEqual([{ decision_id: "dec-1", action: "user_supplement", requirement_ids: ["req.personality"], rationale: "用户补充", supersedes: "dec-0" }]);
    expect(summary.assessment).toEqual({ id: "assess-1", revision: "rev-assess-1" });
    expect(summary.requirement_set).toEqual({ id: "set-1", revision: "set-rev-1" });
    expect(summary.fact_review_run).toEqual({ id: "run-1", projection_revision: contentHash("run-1") });
    expect(summary.fact_projection_revision).toBe(contentHash("projection-1"));
    expect(summary.source_revisions).toEqual([{ source_id: "source-1", revision: contentHash("Alpha is calm.") }]);
    expect(summary.resolution_ids).toEqual(["res-1"]);
    expect(summary.authoring_binding_ids).toEqual(["binding-1"]);
    expect(summary.coverage_snapshot_hash).toBe(snap.snapshot_hash);
    expect(summary.build_snapshot_hash).toBe(contentHash("compiled-1"));
  });

  it("prefers quality override audit and tolerates a missing snapshot", () => {
    const state = createProjectState("provenance-core-2");
    state.quality_profile.overrides = { fact_quality: "warning" };
    state.quality_profile.override_audit = [{ code: "fact_quality", configured_severity: "warning", against_effective_severity: "error", actor: "tester", created_at: now }];
    const summary = buildProvenanceCompositionSummary(state, undefined, contentHash("compiled-2"));

    expect(summary.quality_overrides).toEqual([{ code: "fact_quality", severity: "warning", reason: "quality override configured warning against effective error", by: "tester" }]);
    expect(summary.assessment).toBeUndefined();
    expect(summary.requirement_set).toBeUndefined();
    expect(summary.fact_review_run).toBeUndefined();
    expect(summary.fact_projection_revision).toBeUndefined();
    expect(summary.coverage_snapshot_hash).toBeUndefined();
    expect(summary.source_backed.count).toBe(0);
    expect(summary.source_revisions).toEqual([]);
    expect(summary.overrides).toEqual([]);
  });

  it("round-trips through the strict schema", () => {
    const state = createProjectState("provenance-core-3");
    const summary = buildProvenanceCompositionSummary(state, snapshot(), contentHash("compiled-3"));
    const parsed = provenanceCompositionSummarySchema.parse(summary);
    expect(parsed).toEqual(summary);
  });

  it("persists provenance_summary on build and publish records through validation", () => {
    const state = createProjectState("provenance-core-4");
    const summary = buildProvenanceCompositionSummary(state, snapshot(), contentHash("compiled-4"));
    const build: BuildRecord = {
      id: "build-1",
      operation_id: "op-1",
      status: "previewed",
      artifact_ids: ["artifact-1"],
      content_hash: contentHash("compiled-4"),
      diagnostics: [],
      created_at: now,
      provenance_summary: summary,
    };
    const publish: PublishRecord = {
      id: "publish-1",
      operation_id: "op-2",
      artifact_ids: ["artifact-1"],
      content_hash: contentHash("compiled-4"),
      created_at: now,
      provenance_summary: summary,
    };
    state.builds = [build];
    state.publishes = [publish];
    const validated = validateState(state);
    expect(validated.builds[0]?.provenance_summary).toEqual(summary);
    expect(validated.publishes[0]?.provenance_summary).toEqual(summary);
  });

  it("keeps legacy build and publish records without provenance_summary readable", () => {
    const state = createProjectState("provenance-core-5");
    state.builds = [{ id: "build-old", operation_id: "op-1", status: "built", artifact_ids: ["artifact-1"], content_hash: contentHash("old"), diagnostics: [], created_at: now }];
    state.publishes = [{ id: "publish-old", operation_id: "op-2", artifact_ids: ["artifact-1"], content_hash: contentHash("old"), created_at: now }];
    const validated = validateState(state);
    expect(validated.builds[0]?.provenance_summary).toBeUndefined();
    expect(validated.publishes[0]?.provenance_summary).toBeUndefined();
    expect(validated.publishes[0]?.content_hash).toBe(contentHash("old"));
  });
});
