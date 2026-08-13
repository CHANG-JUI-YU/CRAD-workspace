import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  coverageFactProjectionRevision,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type FactRecord,
  type SourceRecord,
} from "@st-workspace/core";
import {
  BuildService,
  buildDefaultRequirementSet,
  coverageAssessmentFreshness,
  createCoverageBindingForArtifact,
  deriveCoverageReadiness,
  fulfillUserSupplementResolution,
  recordUserDecisionAndResolution,
  requirementsResolved,
  runFormalCoverageAssessment,
  runInitialCoverageAssessment,
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

function precheck(projectId: string, world = false): BlueprintPrecheckRecord {
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
      ...(world ? { world: { enabled: true, concept: "steampunk" } } : {}),
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): import("@st-workspace/core").ArtifactRecord {
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

function fact(overrides: Partial<FactRecord>): FactRecord {
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

async function baseRepository(factsToUse: FactRecord[], world = false) {
  const projectId = "coverage-project";
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId, world)],
    artifacts: [blueprintArtifact(projectId)],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: factsToUse,
  }));
  return repository;
}

function reviewRun(status: "open" | "blocked" | "completed" | "superseded", id = "run-1") {
  return {
    schema_version: 1 as const,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("text") }],
    policy_revision: "pol-1",
    status,
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(factId: string, occurrenceId: string, resultingFactRevision: number, runId = "run-1", id = "dec-1") {
  return {
    schema_version: 1 as const,
    id,
    operation_id: "op-review",
    review_run_id: runId,
    candidate_occurrence_id: occurrenceId,
    fact_id: factId,
    reviewer_identity: "fact-reviewer-1",
    decision: "accepted" as const,
    reason: "supported",
    evidence: [],
    candidate_revision: "cand-1",
    expected_projection_revision: "proj-1",
    resulting_fact_revision: resultingFactRevision,
    created_at: now,
  };
}

const acceptedAlphaFact = fact({
  id: "fact-acc",
  statement: "Alpha is calm.",
  value: "calm",
  status: "accepted",
  coverage_targets: ["req.personality"],
  fact_revision: 1,
  accepted_fact_revision: contentHash("accepted-1"),
  candidate_occurrence_id: "occ-1",
  review_run_id: "run-1",
  decision_id: "dec-1",
  created_by: "fact-reviewer-1",
  evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
});

async function commitRun(repository: MemoryProjectRepository, revision: number, run: ReturnType<typeof reviewRun>, decisions: ReturnType<typeof acceptedDecision>[]) {
  await repository.commit(revision, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, run],
    fact_review_decisions: [...state.fact_review_decisions, ...decisions],
  }));
}

async function commitAssessment(repository: MemoryProjectRepository, revision: number, set: CoverageRequirementSet, assessment: CoverageAssessment) {
  await repository.commit(revision, (state) => ({
    ...state,
    coverage_requirement_sets: [...state.coverage_requirement_sets, set],
    coverage_assessments: [...state.coverage_assessments, assessment],
  }));
}

describe("audit5 batch2 coverage canonical correctness", () => {
  it("#5 completed review runs remain authoritative for formal assessment", async () => {
    const repository = await baseRepository([acceptedAlphaFact]);
    await commitRun(repository, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    const personality = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.personality");
    expect(personality?.status).toBe("covered_by_source");
    expect(assessment.input_snapshot.fact_review_run_id).toBe("run-1");
  });

  it("#5 superseded runs are excluded while newer completed runs win", async () => {
    const repository = await baseRepository([acceptedAlphaFact]);
    await commitRun(repository, 1, reviewRun("superseded", "run-old"), []);
    await commitRun(repository, 2, reviewRun("completed", "run-new"), [acceptedDecision("fact-acc", "occ-1", 1, "run-new", "dec-new")]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    expect(assessment.input_snapshot.fact_review_run_id).toBe("run-new");
    const personality = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.personality");
    expect(personality?.status).toBe("covered_by_source");
  });

  it("#15 every consumer shares the same fact projection revision", async () => {
    const repository = await baseRepository([acceptedAlphaFact]);
    await commitRun(repository, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    await commitAssessment(repository, 2, set, assessment);
    const characterContent = JSON.stringify({ kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha", summary: "Calm." } });
    await repository.commit(3, (next) => ({ ...next, artifacts: [...next.artifacts, { id: "character-1", key: "character:alpha", kind: "character", name: "alpha", content: characterContent, media_type: "application/json", content_hash: contentHash(characterContent), revision: contentHash(characterContent), status: "draft", created_at: now, updated_at: now, created_by: "server", operation_id: "op-author" }] }));
    const withAssessment = await repository.read();
    const coreRevision = coverageFactProjectionRevision(withAssessment);
    expect(assessment.input_snapshot.fact_projection_revision).toBe(coreRevision);
    const characterArtifact = withAssessment.artifacts.find((artifact) => artifact.kind === "character")!;
    const binding = createCoverageBindingForArtifact(withAssessment, characterArtifact, "server");
    expect(binding?.fact_projection_revision).toBe(coreRevision);
    expect(binding?.assessment_id).toBe(assessment.id);
  });

  it("#18 requirement change and assessment replacement decisions fail closed", async () => {
    const repository = await baseRepository([]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    await commitAssessment(repository, 1, set, runInitialCoverageAssessment(state, set, "op-1", "system"));
    const ready = await repository.read();
    for (const action of ["requirement_change", "assessment_replacement"] as const) {
      let caught: { code?: string } = {};
      try {
        recordUserDecisionAndResolution(ready, action, ["req.personality"], "remove", "not needed", "user typed", { actor: "user-1" }, "op-2");
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught.code).toBe("COVERAGE_USER_DECISION_INVALID");
    }
    const creative = recordUserDecisionAndResolution(ready, "creative_completion", ["req.personality"], "authorize", "model may fill gaps", "user typed", { actor: "user-1" }, "op-3");
    expect(creative.resolutions.some((resolution) => resolution.mode === "creative_completion" && resolution.status === "authorized")).toBe(true);
    expect(creative.resolutions[0]?.user_decision_id).toBe(creative.decision.id);
  });

  it("#6 user supplement fulfillment fails closed and succeeds on exact provenance", async () => {
    const repository = await baseRepository([acceptedAlphaFact]);
    await commitRun(repository, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    await commitAssessment(repository, 2, set, assessment);
    let ready = await repository.read();
    const pending = recordUserDecisionAndResolution(ready, "user_supplement", ["req.personality"], "supplement", "user will provide", "user typed", { actor: "user-1" }, "op-3");
    await repository.commit(3, (next) => ({
      ...next,
      coverage_user_decisions: [...next.coverage_user_decisions, pending.decision],
      coverage_resolutions: [...next.coverage_resolutions, ...pending.resolutions],
    }));
    ready = await repository.read();
    const source = sourceRecord("source-1", "Alpha is calm.");
    const pendingResolution = ready.coverage_resolutions.find((resolution) => resolution.mode === "user_supplement" && resolution.status === "pending");
    expect(pendingResolution).toBeDefined();

    const reject = async (mutations: (input: { source_refs: Array<{ source_id: string; revision: string }>; fact_refs: Array<{ fact_id: string; fact_revision: string; decision_id: string }>; revision?: string; factStatus?: FactRecord["status"]; coverageTargets?: string[]; resulting?: number }) => unknown) => {
      const finalFact = {
        ...acceptedAlphaFact,
        ...(mutations.factStatus === undefined ? {} : { status: mutations.factStatus }),
        ...(mutations.coverageTargets === undefined ? {} : { coverage_targets: mutations.coverageTargets }),
        ...(mutations.resulting === undefined ? {} : { fact_revision: mutations.resulting }),
      } as FactRecord;
      const adjusted: ReturnType<typeof baseRepository> = await baseRepository([finalFact]);
      await commitRun(adjusted, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", mutations.resulting ?? 1)]);
      const s2 = await adjusted.read();
      await commitAssessment(adjusted, 2, set, runFormalCoverageAssessment(s2, set, "op-1", "system"));
      const s3 = await adjusted.read();
      const pendingRes = {
        ...pendingResolution!,
        ...(mutations.revision === undefined ? {} : { requirement_set_revision: mutations.revision }),
      } as import("@st-workspace/core").CoverageResolution;
      await adjusted.commit(3, (next) => ({ ...next, coverage_resolutions: [...next.coverage_resolutions, pendingRes] }));
      const s4 = await adjusted.read();
      let code = "";
      try {
        fulfillUserSupplementResolution(s4, pendingRes.id, mutations.source_refs, mutations.fact_refs, { actor: "user-1" }, "op-4");
      } catch (error) {
        code = (error as { code?: string }).code ?? "";
      }
      return code;
    };

    expect(await reject({ source_refs: [], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }] })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: contentHash("text") }], fact_refs: [], revision: set.revision })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: "wrong-revision" }], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], revision: set.revision })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: contentHash("text") }], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], revision: "old-revision" })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: contentHash("text") }], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], revision: set.revision, factStatus: "candidate" })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: contentHash("text") }], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], revision: set.revision, resulting: 2 })).toBe("COVERAGE_RESOLUTION_INVALID");
    expect(await reject({ source_refs: [{ source_id: "source-1", revision: contentHash("text") }], fact_refs: [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], revision: set.revision, coverageTargets: ["req.speech"] })).toBe("COVERAGE_RESOLUTION_INVALID");

    const success = fulfillUserSupplementResolution(ready, pendingResolution!.id, [{ source_id: "source-1", revision: source.revision }], [{ fact_id: "fact-acc", fact_revision: contentHash("accepted-1"), decision_id: "dec-1" }], { actor: "user-1" }, "op-4");
    expect(success.resolution.status).toBe("fulfilled");
    expect(success.resolution.supersedes).toBe(pendingResolution!.id);
    expect(success.resolution.fact_refs?.[0]).toMatchObject({ fact_id: "fact-acc" });
  });

  it("#7 resolutions bound to an older requirement set revision do not count", async () => {
    const repository = await baseRepository([]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const stateWithAssessment = {
      ...state,
      coverage_requirement_sets: [set],
      coverage_assessments: [runInitialCoverageAssessment(state, set, "op-0", "system")],
    };
    const oldResolution = recordUserDecisionAndResolution(stateWithAssessment, "creative_completion", ["req.personality"], "authorize", "old", "typed", { actor: "user-1" }, "op-old", "alpha");
    const oldRes = { ...oldResolution.resolutions[0]!, requirement_set_revision: "old-revision" } as import("@st-workspace/core").CoverageResolution;
    await commitAssessment(repository, 1, set, runInitialCoverageAssessment(state, set, "op-1", "system"));
    await repository.commit(2, (next) => ({ ...next, coverage_resolutions: [...next.coverage_resolutions, oldRes] }));
    let ready = await repository.read();
    const formal = runFormalCoverageAssessment(ready, set, "op-2", "system");
    const personality = formal.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.personality");
    expect(personality?.status).toBe("missing");

    const currentResolution = recordUserDecisionAndResolution(ready, "creative_completion", ["req.personality"], "authorize", "current", "typed", { actor: "user-1" }, "op-3", "alpha");
    await repository.commit(3, (next) => ({
      ...next,
      coverage_user_decisions: [...next.coverage_user_decisions, currentResolution.decision],
      coverage_resolutions: [...next.coverage_resolutions, ...currentResolution.resolutions],
    }));
    ready = await repository.read();
    const formal2 = runFormalCoverageAssessment(ready, set, "op-4", "system");
    const personality2 = formal2.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.personality");
    expect(personality2?.status).toBe("creative_completion_authorized");
  });

  it("#8 requirementsResolved requires an exact formal assessment", async () => {
    const repository = await baseRepository([]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const initial = runInitialCoverageAssessment(state, set, "op-1", "system");
    expect(requirementsResolved({ ...state, coverage_requirement_sets: [set], coverage_assessments: [initial] }).resolved).toBe(false);
    const formal = runFormalCoverageAssessment(state, set, "op-2", "system");
    expect(requirementsResolved({ ...state, coverage_requirement_sets: [set], coverage_assessments: [formal] }).resolved).toBe(false);
    const mismatched = { ...formal, requirement_set_id: "other-set", requirement_set_revision: "other-rev" };
    expect(requirementsResolved({ ...state, coverage_requirement_sets: [set], coverage_assessments: [mismatched] }).resolved).toBe(false);
    const extra = { ...formal, items: [...formal.items, { character_id: "ghost", requirement_id: "req.speech", status: "covered_by_source" as const, candidate_fact_ids: [], accepted_fact_ids: [], research_task_ids: [], resolution_ids: [] }] };
    expect(requirementsResolved({ ...state, coverage_requirement_sets: [set], coverage_assessments: [extra] }).resolved).toBe(false);

    const smallSet: CoverageRequirementSet = {
      id: "set-small",
      revision: contentHash("small"),
      source: "default",
      characters: [{ character_id: "alpha", requirement_ids: ["req.personality"] }],
      world_requirement_ids: [],
      created_by: "director",
      created_at: now,
    };
    const smallAssessment: CoverageAssessment = {
      id: "assess-small",
      revision: contentHash("small-a"),
      pass: "formal",
      requirement_set_id: "set-small",
      requirement_set_revision: smallSet.revision,
      input_snapshot: { source_revisions: [], fact_projection_revision: contentHash("facts") },
      items: [{ character_id: "alpha", requirement_id: "req.personality", status: "covered_by_source", candidate_fact_ids: [], accepted_fact_ids: ["fact-acc"], research_task_ids: [], resolution_ids: [] }],
      operation_id: "op-small",
      created_by: "system",
      created_at: now,
    };
    const resolved = requirementsResolved({ ...state, coverage_requirement_sets: [smallSet], coverage_assessments: [smallAssessment] });
    expect(resolved.resolved).toBe(true);
    expect(resolved.missing).toHaveLength(0);
  });

  it("#9 deriveCoverageReadiness reports structured blockers", async () => {
    const repository = await baseRepository([]);
    let state = await repository.read();
    const noSet = deriveCoverageReadiness(state);
    expect(noSet.ready).toBe(false);
    expect(noSet.blockers.some((blocker) => blocker.code === "COVERAGE_RESEARCH_REQUIRED")).toBe(true);

    const set = buildDefaultRequirementSet(state, "director");
    state = { ...state, coverage_requirement_sets: [set] };
    const noFormal = deriveCoverageReadiness(state);
    expect(noFormal.blockers.some((blocker) => blocker.code === "COVERAGE_FACT_REVIEW_REQUIRED")).toBe(true);

    const candidateRepo = await baseRepository([fact({ id: "fact-cand", statement: "Alpha likes tea.", value: "tea", status: "candidate", suggested_coverage_targets: ["req.preferences"], coverage: ["preferences"] })]);
    let candidateState = await candidateRepo.read();
    candidateState = { ...candidateState, coverage_requirement_sets: [buildDefaultRequirementSet(candidateState, "director")] };
    const candidate = deriveCoverageReadiness(candidateState);
    expect(candidate.blockers.some((blocker) => blocker.code === "COVERAGE_FACT_REVIEW_REQUIRED" && blocker.fact_ids?.includes("fact-cand"))).toBe(true);

    const conflictRepo = await baseRepository([fact({ id: "fact-conf", statement: "Beta is loud.", subject: "beta", value: "loud", entity_refs: ["beta"], status: "conflict", coverage_targets: ["req.personality"] })]);
    const conflictState = { ...(await conflictRepo.read()), coverage_requirement_sets: [buildDefaultRequirementSet(await conflictRepo.read(), "director")] };
    const conflict = deriveCoverageReadiness(conflictState);
    expect(conflict.blockers.some((blocker) => blocker.code === "COVERAGE_RESOLUTION_REQUIRED" && blocker.conflict === true)).toBe(true);

    const openRunRepo = await baseRepository([acceptedAlphaFact]);
    await commitRun(openRunRepo, 1, reviewRun("open"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const openRunState = await openRunRepo.read();
    const openRunSet = buildDefaultRequirementSet(openRunState, "director");
    const openRun = deriveCoverageReadiness({
      ...openRunState,
      coverage_requirement_sets: [openRunSet],
      coverage_assessments: [runFormalCoverageAssessment(openRunState, openRunSet, "op-r", "system")],
    });
    expect(openRun.blockers.some((blocker) => blocker.code === "COVERAGE_FACT_REVIEW_REQUIRED" && blocker.current_status === "open")).toBe(true);

    const staleRepo = await baseRepository([acceptedAlphaFact]);
    await commitRun(staleRepo, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const staleState = await staleRepo.read();
    const staleSet = buildDefaultRequirementSet(staleState, "director");
    const staleAssessment = runFormalCoverageAssessment(staleState, staleSet, "op-1", "system");
    await commitAssessment(staleRepo, 2, staleSet, staleAssessment);
    await staleRepo.commit(3, (next) => ({ ...next, facts: [...next.facts, fact({ id: "fact-new", statement: "Beta runs fast.", subject: "beta", value: "fast", entity_refs: ["beta"], status: "candidate" })] }));
    const stale = deriveCoverageReadiness(await staleRepo.read());
    expect(stale.blockers.some((blocker) => blocker.code === "COVERAGE_ASSESSMENT_STALE")).toBe(true);

    const goodRepo = await baseRepository([acceptedAlphaFact]);
    await commitRun(goodRepo, 1, reviewRun("completed"), [acceptedDecision("fact-acc", "occ-1", 1)]);
    const goodState = await goodRepo.read();
    const goodSet = buildDefaultRequirementSet(goodState, "director");
    const goodAssessment = runFormalCoverageAssessment(goodState, goodSet, "op-1", "system");
    await commitAssessment(goodRepo, 2, goodSet, goodAssessment);
    const good = deriveCoverageReadiness(await goodRepo.read());
    const goodBlockers = good.blockers;
    expect(goodBlockers.some((b) => b.code === "COVERAGE_ASSESSMENT_STALE" || b.code === "COVERAGE_FACT_REVIEW_REQUIRED" || b.code === "COVERAGE_RESEARCH_REQUIRED")).toBe(false);
    expect(goodBlockers.every((b) => b.code === "COVERAGE_RESOLUTION_REQUIRED")).toBe(true);
  });

  it("#4 source-adaptation builds fail closed without a fresh formal assessment", async () => {
    const projectId = "coverage-project";
    const repository = new MemoryProjectRepository(projectId);
    const characterArtifact: import("@st-workspace/core").ArtifactRecord = {
      id: "character-1",
      key: "character:alpha",
      kind: "character",
      name: "alpha",
      content: JSON.stringify({ document: { schema_version: 1, id: "alpha", display_name: "Alpha", aliases: [], summary: "Calm.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm and direct." }], provenance: [], extensions: {} } }),
      media_type: "application/json",
      content_hash: contentHash("character-1"),
      revision: contentHash("character-1"),
      status: "draft",
      created_at: now,
      updated_at: now,
      created_by: "director",
      operation_id: "op-author",
    };
    await repository.commit(0, (state) => ({
      ...state,
      project_status: "ready",
      interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
      blueprint_prechecks: [precheck(projectId)],
      artifacts: [blueprintArtifact(projectId), characterArtifact],
      sources: [sourceRecord("source-1", "Alpha is calm.")],
      operations: [{ id: "op-build", kind: "build", request: "Preview current card", actor: "worker", status: "running", created_at: now, updated_at: now, progress: [] }],
    }));
    const service = new BuildService(repository);
    const missing = await service.run("op-build", "Preview current card", "worker");
    expect(missing.status).toBe("blocked");
    const afterMissing = await repository.read();
    expect(afterMissing.builds[0]?.status).toBe("failed");
    expect(afterMissing.builds[0]?.diagnostics.join(" ")).toContain("COVERAGE_ASSESSMENT_REQUIRED");

    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [{ id: "op-build-2", kind: "build", request: "Preview current card", actor: "worker", status: "running", created_at: now, updated_at: now, progress: [] }] }));
    const set = buildDefaultRequirementSet(await repository.read(), "director");
    await commitAssessment(repository, (await repository.read()).revision, set, runFormalCoverageAssessment(await repository.read(), set, "op-1", "system"));
    await repository.commit((await repository.read()).revision, (next) => ({ ...next, facts: [...next.facts, fact({ id: "fact-new", statement: "Beta runs fast.", subject: "beta", value: "fast", entity_refs: ["beta"], status: "candidate" })] }));
    const stale = await service.run("op-build-2", "Preview current card", "worker");
    expect(stale.status).toBe("blocked");
    const afterStale = await repository.read();
    expect(afterStale.builds[1]?.diagnostics.join(" ")).toContain("COVERAGE_ASSESSMENT_STALE");
  });
});
