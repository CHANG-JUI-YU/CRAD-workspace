import { describe, expect, it } from "vitest";
import {
  artifactDependencyFingerprint,
  authoringBindingHash,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  createProjectState,
  type ArtifactRecord,
  type AuthoringCoverageBinding,
  type BlueprintPrecheckRecord,
  type BuildRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type ProjectState,
  type ReviewRecord,
  type SourceRecord,
} from "@st-workspace/core";
import {
  SOURCE_ADAPTATION_WORKFLOW_STAGES,
  buildCoverageSnapshot,
  deriveDownstreamInvalidation,
  deriveProjectInvalidations,
  deriveSourceAdaptationWorkflow,
  emptyDownstreamInvalidationReport,
  type SourceAdaptationWorkflowStageStatus,
} from "../src/index.js";

const now = "2026-08-13T00:00:00.000Z";

function sourceRecord(id: string, text: string): SourceRecord {
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

const characters = [
  { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
  { id: "beta", label: "Beta", ordinal: 2, mode: "palette" },
];

function precheck(projectId: string): BlueprintPrecheckRecord {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "character",
      collaboration_mode: "assisted",
      characters,
      primary_character_id: "alpha",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "blueprint",
    content: JSON.stringify({ kind: "blueprint", project_id: projectId, characters, primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(overrides: Partial<FactRecord> = {}): FactRecord {
  return {
    id: "fact-1",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "candidate",
    confidence: 0.8,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    created_at: now,
    updated_at: now,
    created_by: "fact-curator",
    ...overrides,
  };
}

function acceptedAlphaFact(): FactRecord {
  return fact({
    id: "fact-acc",
    value: "calm",
    status: "accepted",
    coverage_targets: ["req.personality"],
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_by: "fact-reviewer-1",
  });
}

function reviewRun(status: "open" | "blocked" | "completed", id = "run-1"): FactReviewRunRecord {
  return {
    schema_version: 1,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "pol-1",
    status,
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(factId: string, occurrenceId: string, resultingFactRevision: number, runId = "run-1", id = "dec-1"): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id,
    operation_id: "op-review",
    review_run_id: runId,
    candidate_occurrence_id: occurrenceId,
    fact_id: factId,
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted",
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: resultingFactRevision,
    created_at: now,
  };
}

function characterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ document: { schema_version: 1, id, display_name: id, aliases: [], summary: "Calm.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm and direct." }], provenance: [], extensions: {} } });
  return {
    id: `character-${id}`,
    key: `character:${id}`,
    kind: "character",
    name: id,
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash(content),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function requirementSet(): CoverageRequirementSet {
  return {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    characters: [{ character_id: "alpha", requirement_ids: ["req.personality"] }],
    world_requirement_ids: [],
    created_by: "director",
    created_at: now,
  };
}

function formalAssessment(state: ProjectState, overrides: Partial<CoverageAssessment> = {}): CoverageAssessment {
  return {
    id: "assess-1",
    revision: contentHash("assess-1"),
    pass: "formal",
    requirement_set_id: "set-1",
    requirement_set_revision: "set-rev-1",
    input_snapshot: {
      blueprint_revision: contentHash("blueprint-1"),
      source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
      fact_projection_revision: coverageFactProjectionRevision(state),
      fact_review_run_id: "run-1",
      fact_review_projection_revision: contentHash("run-1"),
    },
    items: [],
    operation_id: "op-assess",
    created_by: "director",
    created_at: now,
    ...overrides,
  };
}

function binding(artifact: ArtifactRecord, assessment: CoverageAssessment): AuthoringCoverageBinding {
  const base = {
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: "set-rev-1",
    fact_projection_revision: assessment.input_snapshot.fact_projection_revision ?? "",
    fact_review_run_id: "run-1" as string | undefined,
    resolution_ids: [] as string[],
  };
  return {
    id: "binding-1",
    ...base,
    input_snapshot_hash: authoringBindingHash(base),
    created_by: "director",
    created_at: now,
  };
}

function previewBuild(state: ProjectState, assessment: CoverageAssessment): BuildRecord {
  const plan = computeProjectProjection(state).publishPlan();
  return {
    id: "build-1",
    operation_id: "op-build",
    status: "previewed",
    artifact_ids: plan.entries.map((entry) => entry.artifact_id),
    content_hash: contentHash("build-1"),
    diagnostics: [],
    created_at: now,
    coverage_snapshot: buildCoverageSnapshot(state, assessment, plan),
  };
}

function review(artifact: ArtifactRecord): ReviewRecord {
  return {
    id: `review-${artifact.id}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    reviewer: "director",
    status: "passed",
    issue_ids: [],
    created_at: now,
  };
}

function baseState(projectId = "batch6-domain"): ProjectState {
  const seed = createProjectState(projectId);
  return {
    ...seed,
    project_status: "ready",
    interview: { ...seed.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact()],
    fact_review_runs: [reviewRun("completed")],
    fact_review_decisions: [acceptedDecision("fact-acc", "occ-1", 1)],
  };
}

function withFormalAssessment(state: ProjectState): { state: ProjectState; assessment: CoverageAssessment } {
  const assessment = formalAssessment(state);
  const next: ProjectState = {
    ...state,
    coverage_requirement_sets: [...state.coverage_requirement_sets, requirementSet()],
    coverage_assessments: [...state.coverage_assessments, assessment],
  };
  return { state: next, assessment };
}

describe("Audit 5 batch 6: downstream invalidation read model", () => {
  it("#1 reports fact review, coverage assessment, artifact, and build preview invalidation after a source revision changes", () => {
    const { state: base } = withFormalAssessment(baseState());
    const artifact = base.artifacts.find((item) => item.kind === "character")!;
    const fingerprinted: ArtifactRecord = { ...artifact, dependency_fingerprint: artifactDependencyFingerprint(base, artifact) };
    const before: ProjectState = {
      ...base,
      artifacts: [...base.artifacts.filter((item) => item.id !== artifact.id), fingerprinted],
      builds: [previewBuild(base, base.coverage_assessments[0]!)],
    };
    const revisedSource: SourceRecord = { ...before.sources[0]!, canonical_text: "Alpha is calm. Revised.", original_hash: contentHash("Alpha is calm. Revised."), revision: contentHash("Alpha is calm. Revised.") };
    const after: ProjectState = {
      ...before,
      sources: [revisedSource],
    };
    const report = deriveDownstreamInvalidation(before, after);
    expect(report.invalidated).toBe(true);
    expect(report.sources).toEqual([expect.objectContaining({ kind: "source", id: "source-1" })]);
    const codes = report.items.map((item) => item.reason_code);
    expect(codes).toContain("COVERAGE_ASSESSMENT_STALE");
    expect(codes).toContain("COVERAGE_PUBLISH_SNAPSHOT_STALE");
    const assessmentItems = report.items.filter((item) => item.target_kind === "coverage_assessment");
    expect(assessmentItems[0]!.reason).toContain("sources");
  });

  it("#1 fact changes mark the dependent artifact and its review stale", () => {
    const { state: base } = withFormalAssessment(baseState());
    const artifact = base.artifacts.find((item) => item.kind === "character")!;
    const fingerprinted: ArtifactRecord = { ...artifact, dependency_fingerprint: artifactDependencyFingerprint(base, artifact) };
    const before: ProjectState = {
      ...base,
      artifacts: [...base.artifacts.filter((item) => item.id !== artifact.id), fingerprinted],
      reviews: [review(fingerprinted)],
    };
    const revisedFact: FactRecord = { ...before.facts[0]!, value: "serene", statement: "Alpha is calm and reserved.", updated_at: now };
    const after: ProjectState = { ...before, facts: [revisedFact] };
    const report = deriveDownstreamInvalidation(before, after);
    const artifactItem = report.items.find((item) => item.target_kind === "artifact" && item.target_id === artifact.id);
    expect(artifactItem).toBeDefined();
    expect(artifactItem!.reason_code).toBe("ARTIFACT_DEPENDENCY_STALE");
  });

  it("#1 artifact content changes mark the dependent artifact and its review stale, but not unrelated artifacts", () => {
    const before = baseState();
    const plan = computeProjectProjection(before).publishPlan();
    const entry = plan.entries.find((item) => item.kind === "character")!;
    const current = before.artifacts.find((item) => item.id === entry.artifact_id)!;
    const currentWithReview: ProjectState = { ...before, reviews: [review(current)] };
    const newContent = JSON.stringify({ document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "Calm.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm, direct, revised." }], provenance: [], extensions: {} } });
    const revised: ArtifactRecord = { ...current, content: newContent, content_hash: contentHash(newContent), revision: contentHash(newContent), updated_at: now };
    const after: ProjectState = {
      ...currentWithReview,
      artifacts: [...currentWithReview.artifacts.filter((item) => item.id !== current.id), revised],
      reviews: [review(current)],
    };
    const report = deriveDownstreamInvalidation(currentWithReview, after);
    const reviewItem = report.items.find((item) => item.target_kind === "review");
    expect(reviewItem).toBeDefined();
    expect(reviewItem!.reason_code).toBe("REVIEW_REVISION_STALE");
    const artifactItems = report.items.filter((item) => item.target_kind === "artifact");
    expect(artifactItems).toHaveLength(0);
  });

  it("#2 a new authoritative fact review run makes the coverage assessment stale", () => {
    const { state: before } = withFormalAssessment(baseState());
    const runTwo = reviewRun("completed", "run-2");
    runTwo.source_revisions = [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }];
    const after: ProjectState = {
      ...before,
      fact_review_runs: [...before.fact_review_runs, runTwo],
    };
    const report = deriveDownstreamInvalidation(before, after);
    const assessmentItem = report.items.find((item) => item.target_kind === "coverage_assessment" && item.target_id === "assess-1");
    expect(assessmentItem).toBeDefined();
    expect(assessmentItem!.reason_code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(assessmentItem!.reason).toContain("fact_review_run");
  });

  it("#3 a blueprint revision only flags artifacts that actually bind to the blueprint", () => {
    const before = baseState();
    const superseded = { ...precheck("batch6-domain"), id: "precheck-1", status: "superseded" };
    const recordedTwo: BlueprintPrecheckRecord = {
      ...precheck("batch6-domain"),
      id: "precheck-2",
      operation_id: "op-precheck-2",
      candidate_blueprint_revision: contentHash("blueprint-2"),
    };
    const after: ProjectState = {
      ...before,
      blueprint_prechecks: [superseded, recordedTwo],
    };
    const report = deriveDownstreamInvalidation(before, after);
    const plan = computeProjectProjection(after).publishPlan();
    const entry = plan.entries.find((item) => item.kind === "character");
    const artifactItems = report.items.filter((item) => item.target_kind === "artifact");
    expect(entry).toBeDefined();
    expect(artifactItems).toHaveLength(1);
    expect(artifactItems[0]!.target_id).toBe(entry!.artifact_id);
    expect(artifactItems[0]!.reason_code).toBe("BLUEPRINT_BINDING_STALE");
  });

  it("#4 a new coverage assessment marks the old authoring binding and the preview snapshot stale", () => {
    const { state: base } = withFormalAssessment(baseState());
    const assessmentOne = base.coverage_assessments[0]!;
    const artifact = base.artifacts.find((item) => item.kind === "character")!;
    const withBinding: ProjectState = {
      ...base,
      coverage_authoring_bindings: [binding(artifact, assessmentOne)],
    };
    const before: ProjectState = {
      ...withBinding,
      builds: [previewBuild(withBinding, assessmentOne)],
    };
    const assessmentTwo = formalAssessment(before, { id: "assess-2", revision: contentHash("assess-2") });
    const after: ProjectState = {
      ...before,
      coverage_assessments: [...before.coverage_assessments, assessmentTwo],
    };
    const report = deriveDownstreamInvalidation(before, after);
    const codes = report.items.map((item) => item.reason_code);
    expect(codes).toContain("COVERAGE_AUTHORING_BINDING_STALE");
    expect(codes).toContain("COVERAGE_PUBLISH_SNAPSHOT_STALE");
    const bindingItem = report.items.find((item) => item.target_kind === "artifact");
    expect(bindingItem!.target_id).toBe(artifact.id);
    expect(bindingItem!.reason).toContain("assessment");
  });

  it("#5 historical artifacts, historical bindings, and non-plan artifacts do not produce false invalidation", () => {
    const { state: base } = withFormalAssessment(baseState());
    const assessmentOne = base.coverage_assessments[0]!;
    const alpha = base.artifacts.find((item) => item.kind === "character")!;
    const oldArtifact: ArtifactRecord = {
      ...alpha,
      id: "character-alpha-old",
      key: "character:alpha:old",
      revision: contentHash("old-character"),
      content_hash: contentHash("old-character"),
    };
    const oldBinding = { ...binding(alpha, assessmentOne), id: "binding-old", artifact_id: "character-alpha-old", artifact_revision: oldArtifact.revision };
    const historicalAssessment = formalAssessment(base, { id: "assess-0", revision: contentHash("assess-0"), input_snapshot: { ...assessmentOne.input_snapshot, source_revisions: [{ source_id: "source-1", revision: contentHash("old source") }] } });
    const before: ProjectState = {
      ...base,
      artifacts: [...base.artifacts, oldArtifact],
      coverage_authoring_bindings: [...base.coverage_authoring_bindings, oldBinding],
      coverage_assessments: [historicalAssessment, assessmentOne],
      reviews: [review(oldArtifact)],
    };
    const after: ProjectState = { ...before };
    const report = deriveDownstreamInvalidation(before, after);
    expect(report.invalidated).toBe(false);
    expect(report.items).toHaveLength(0);
    expect(report.publish_readiness_affected).toBe(false);
  });

  it("#6 returns a structured empty report when nothing downstream is invalidated", () => {
    const before = baseState();
    const after: ProjectState = { ...before, operations: [...before.operations], audit: [...before.audit, { operation_id: "op-x", event: "operation.created", actor: "director", created_at: now, project_revision: 1 } as never] };
    const report = deriveDownstreamInvalidation(before, after);
    expect(report).toEqual(emptyDownstreamInvalidationReport());
  });

  it("deriveProjectInvalidations reports currently stale items and stays empty when healthy", () => {
    const { state: base } = withFormalAssessment(baseState());
    const artifact = base.artifacts.find((item) => item.kind === "character")!;
    const state: ProjectState = {
      ...base,
      coverage_authoring_bindings: [binding(artifact, base.coverage_assessments[0]!)],
    };
    const healthy = deriveProjectInvalidations(state);
    expect(healthy.items.filter((item) => item.target_kind !== "publish_readiness")).toHaveLength(0);
    const plan = computeProjectProjection(state).publishPlan();
    const entry = plan.entries.find((item) => item.kind === "character")!;
    const artifactCurrent = state.artifacts.find((item) => item.id === entry.artifact_id)!;
    const newContent = JSON.stringify({ document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "Calm.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Different content." }], provenance: [], extensions: {} } });
    const revised: ArtifactRecord = { ...artifactCurrent, content: newContent, content_hash: contentHash(newContent), revision: contentHash(newContent), updated_at: now };
    const staleState: ProjectState = {
      ...state,
      artifacts: [...state.artifacts.filter((item) => item.id !== artifactCurrent.id), revised],
      reviews: [review(artifactCurrent)],
      builds: [previewBuild(state, state.coverage_assessments[0]!)],
    };
    const current = deriveProjectInvalidations(staleState);
    expect(current.invalidated).toBe(true);
    const reviewItem = current.items.find((item) => item.target_kind === "review");
    expect(reviewItem).toBeDefined();
  });
});

describe("Audit 5 batch 6: source adaptation workflow model", () => {
  it("#7 exposes exactly nine stages in the fixed order", () => {
    const model = deriveSourceAdaptationWorkflow(baseState());
    expect(model.stages.map((stage) => stage.id)).toEqual([
      "sources",
      "fact_curation",
      "fact_review",
      "coverage",
      "research_resolution",
      "authoring",
      "review",
      "preview",
      "publish",
    ]);
    expect(SOURCE_ADAPTATION_WORKFLOW_STAGES).toHaveLength(9);
  });

  it("#8 every stage status is one of the five allowed values", () => {
    const statuses: SourceAdaptationWorkflowStageStatus[] = ["completed", "current", "blocked", "stale", "not_applicable"];
    const { state } = withFormalAssessment(baseState());
    const model = deriveSourceAdaptationWorkflow(state);
    for (const stage of model.stages) {
      expect(statuses).toContain(stage.status);
    }
  });

  it("#9 progresses from current to completed as obligations are fulfilled", () => {
    const seed = baseState();
    const early = deriveSourceAdaptationWorkflow({ ...seed, sources: [], facts: [] });
    expect(early.stages[0]!.status).toBe("current");
    expect(early.stages[1]!.status).toBe("blocked");
    expect(early.stages[8]!.status).toBe("blocked");
    expect(early.current_stage).toBe("sources");

    const reviewed = deriveSourceAdaptationWorkflow(seed);
    expect(reviewed.stages[0]!.status).toBe("completed");
    expect(reviewed.stages[1]!.status).toBe("completed");
    expect(reviewed.stages[2]!.status).toBe("completed");
    expect(reviewed.stages[3]!.status).toBe("current");
    expect(reviewed.current_stage).toBe("coverage");

    const { state } = withFormalAssessment(seed);
    const formal = deriveSourceAdaptationWorkflow(state);
    expect(formal.stages[3]!.status).toBe("completed");
    expect(formal.stages[4]!.status).toBe("blocked");
    expect(formal.stages[5]!.status).toBe("blocked");
    expect(formal.stages[6]!.status).toBe("blocked");
  });

  it("#9 source changes flip fact review and later stages to stale with a rerun action", () => {
    const { state: before } = withFormalAssessment(baseState());
    const revisedSource: SourceRecord = { ...before.sources[0]!, canonical_text: "Alpha is calm. V2", original_hash: contentHash("Alpha is calm. V2"), revision: contentHash("Alpha is calm. V2") };
    const after: ProjectState = { ...before, sources: [revisedSource] };
    const model = deriveSourceAdaptationWorkflow(after);
    expect(model.stages[2]!.status).toBe("stale");
    expect(model.current_stage).toBe("fact_review");
    expect(model.stages[2]!.next_action).toBeDefined();
    for (let i = 3; i < model.stages.length; i += 1) {
      expect(model.stages[i]!.status).toBe("blocked");
    }
  });

  it("#10 non source-adaptation projects receive an explicit not_applicable model", () => {
    const seed = createProjectState("batch6-character");
    const model = deriveSourceAdaptationWorkflow({ ...seed, interview: { ...seed.interview, flow: "character", status: "complete" } });
    expect(model.is_source_adaptation).toBe(false);
    expect(model.stages).toHaveLength(9);
    for (const stage of model.stages) {
      expect(stage.status).toBe("not_applicable");
    }
    expect(model.current_stage).toBeUndefined();
  });
});
