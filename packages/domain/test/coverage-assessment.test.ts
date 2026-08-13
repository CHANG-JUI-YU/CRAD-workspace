import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  validateState,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type SourceRecord,
} from "@st-workspace/core";
import {
  buildDefaultRequirementSet,
  coverageAssessmentFreshness,
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

function precheck(projectId: string, characters: Array<{ id: string; label: string; ordinal: number; mode: string }>, world: boolean): BlueprintPrecheckRecord {
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
      primary_character_id: characters[0]?.id,
      ...(world ? { world: { enabled: true, concept: "steampunk" } } : {}),
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: characters[0]?.id ?? "", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string, characters: Array<{ id: string; label: string; ordinal: number; mode: string }>): Record<string, unknown> {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "blueprint",
    content: JSON.stringify({ kind: "blueprint", project_id: projectId, characters, primary_character_id: characters[0]?.id }),
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
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("text"), quote: "Alpha is calm." }],
    fact_revision: 1,
    created_at: now,
    updated_at: now,
    created_by: "fact-curator",
    ...overrides,
  };
}

async function scenarioRepository(world: boolean, factsToUse: FactRecord[]) {
  const projectId = "coverage-project";
  const characters = [
    { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
    { id: "beta", label: "Beta", ordinal: 2, mode: "palette" },
  ];
  const next = {
    ...createProjectState("coverage-project"),
    project_status: "ready" as const,
    interview: { ...createProjectState("coverage-project").interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId, characters, world)],
    artifacts: [blueprintArtifact(projectId, characters) as unknown as import("@st-workspace/core").ArtifactRecord],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: factsToUse,
  };
  try {
    validateState(next as unknown as Parameters<typeof validateState>[0]);
  } catch (error) {
    throw new Error(`scenario state invalid: ${(error as Error).message}`);
  }
  const repository = new MemoryProjectRepository("coverage-project");
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId, characters, world)],
    artifacts: [blueprintArtifact(projectId, characters) as unknown as import("@st-workspace/core").ArtifactRecord],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: factsToUse,
  }));
  return repository;
}

describe("coverage assessment", async () => {
  it("builds a default requirement set from the roster and world enablement", async () => {
    const repository = await scenarioRepository(true, []);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    expect(set.source).toBe("default");
    expect(set.characters).toHaveLength(2);
    expect(set.characters[0]!.requirement_ids).toHaveLength(13);
    expect(set.characters[1]!.requirement_ids).toHaveLength(13);
    expect(set.characters[0]!.character_id).toBe("alpha");
    expect(set.world_requirement_ids).toEqual(["req.world_context"]);
    expect(set.revision).toBeTruthy();
    expect(set.created_by).toBe("director");

    const noWorld = await scenarioRepository(false, []);
    const worldOff = buildDefaultRequirementSet(await noWorld.read(), "director");
    expect(worldOff.world_requirement_ids).toEqual([]);
  });

  it("runs an initial assessment with candidate signals and conflicts", async () => {
    const repository = await scenarioRepository(true, [
      fact({ id: "fact-cand", statement: "Alpha likes tea.", value: "tea", coverage_targets: undefined, suggested_coverage_targets: ["req.preferences"], coverage: ["preferences"], status: "candidate" }),
      fact({ id: "fact-conflict", statement: "Beta is loud.", subject: "beta", value: "loud", entity_refs: ["beta"], status: "conflict", suggested_coverage_targets: ["req.personality"], coverage: ["personality"] }),
    ]);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runInitialCoverageAssessment(state, set, "op-1", "system");
    expect(assessment.pass).toBe("initial");
    const preferences = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.preferences");
    expect(preferences?.status).toBe("candidate_signal");
    expect(preferences?.candidate_fact_ids).toContain("fact-cand");
    const appearance = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.appearance");
    expect(appearance?.status).toBe("missing");
    const conflict = assessment.items.find((item) => item.character_id === "beta" && item.requirement_id === "req.personality");
    expect(conflict?.status).toBe("conflicted");
    expect(assessment.items.every((item) => ["missing", "candidate_signal", "conflicted"].includes(item.status))).toBe(true);
  });

  it("runs a formal assessment counting only accepted facts with current decisions", async () => {
    const source = sourceRecord("source-1", "Alpha is calm.");
    const repository = await scenarioRepository(true, [
      fact({
        id: "fact-acc",
        statement: "Alpha is calm.",
        value: "calm",
        status: "accepted",
        coverage_targets: ["req.personality"],
        fact_revision: 1,
        candidate_occurrence_id: "occ-1",
        review_run_id: "run-1",
        decision_id: "dec-1",
        created_by: "fact-reviewer-1",
        evidence_refs: [{ source_id: "source-1", source_revision_id: source.revision, quote: "Alpha is calm." }],
      }),
      fact({ id: "fact-cand", statement: "Alpha likes tea.", value: "tea", status: "candidate", suggested_coverage_targets: ["req.preferences"], coverage: ["preferences"] }),
    ]);
    await repository.commit(1, (state) => ({
      ...state,
      fact_review_runs: [
        {
          schema_version: 1,
          id: "run-1",
          candidate_set_revision: "set-1",
          candidate_occurrence_ids: ["occ-1"],
          source_revisions: [{ source_id: "source-1", revision: source.revision }],
          policy_revision: "pol-1",
          status: "open",
          created_by: "system",
          created_at: now,
        },
      ],
      fact_review_decisions: [
        {
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
        },
      ],
    }));
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    expect(assessment.pass).toBe("formal");
    const personality = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.personality");
    expect(personality?.status).toBe("covered_by_source");
    expect(personality?.accepted_fact_ids).toContain("fact-acc");
    const preferences = assessment.items.find((item) => item.character_id === "alpha" && item.requirement_id === "req.preferences");
    expect(preferences?.status).toBe("missing");
    const betaPersonality = assessment.items.find((item) => item.character_id === "beta" && item.requirement_id === "req.personality");
    expect(betaPersonality?.status).toBe("missing");
  });

  it("reports stale assessments when inputs change", async () => {
    const repository = await scenarioRepository(true, [
      fact({ id: "fact-acc", statement: "Alpha is calm.", value: "calm", status: "accepted", coverage_targets: ["req.personality"], fact_revision: 1, candidate_occurrence_id: "occ-1", review_run_id: "run-1", decision_id: "dec-1", created_by: "fact-reviewer-1" }),
    ]);
    await repository.commit(1, (state) => ({
      ...state,
      fact_review_runs: [{
        schema_version: 1,
        id: "run-1",
        candidate_set_revision: "set-1",
        candidate_occurrence_ids: ["occ-1"],
        source_revisions: [{ source_id: "source-1", revision: contentHash("text") }],
        policy_revision: "pol-1",
        status: "open",
        created_by: "system",
        created_at: now,
      }],
      fact_review_decisions: [{
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
      }],
    }));
    let state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const assessment = runFormalCoverageAssessment(state, set, "op-1", "system");
    expect(coverageAssessmentFreshness(state, assessment)).toBe(true);
    await repository.commit(2, (next) => ({
      ...next,
      facts: [...next.facts, fact({ id: "fact-new", statement: "Beta runs fast.", subject: "beta", value: "fast", entity_refs: ["beta"], status: "candidate" })],
    }));
    state = await repository.read();
    expect(coverageAssessmentFreshness(state, assessment)).toBe(false);
  });

  it("keeps assessments immutable and revisioned", async () => {
    const repository = await scenarioRepository(false, []);
    const state = await repository.read();
    const set = buildDefaultRequirementSet(state, "director");
    const first = runInitialCoverageAssessment(state, set, "op-1", "system");
    const second = runInitialCoverageAssessment(state, set, "op-1", "system");
    expect(first.id).not.toBe(second.id);
    expect(first.revision).toBe(second.revision);
    expect(first.requirement_set_id).toBe(set.id);
    expect(first.requirement_set_revision).toBe(set.revision);
    expect(first.items.length).toBe(set.characters.length * 13 + set.world_requirement_ids.length);
  });
});

