import { describe, expect, it } from "vitest";
import {
  COVERAGE_ALL_DIMENSIONS,
  COVERAGE_ASSESSMENT_ITEM_STATUSES,
  COVERAGE_DIMENSIONS,
  COVERAGE_INITIAL_ITEM_STATUSES,
  COVERAGE_FORMAL_ITEM_STATUSES,
  COVERAGE_REQUIREMENT_CATALOG,
  WORLD_COVERAGE_DIMENSION,
  contentHash,
  coverageAssessmentSchema,
  coverageRequirementById,
  coverageRequirementIdForDimension,
  coverageRequirementSetSchema,
  coverageUserDecisionSchema,
  createProjectState,
  isCoverageRequirementId,
  migrateProjectStateV1ToV2,
} from "@st-workspace/core";

describe("coverage requirement catalog", () => {
  it("defines the 13 character dimensions plus world_context with stable requirement ids", () => {
    expect(COVERAGE_DIMENSIONS).toHaveLength(13);
    expect(COVERAGE_ALL_DIMENSIONS).toEqual([...COVERAGE_DIMENSIONS, WORLD_COVERAGE_DIMENSION]);
    expect(COVERAGE_REQUIREMENT_CATALOG).toHaveLength(14);
    for (const dimension of COVERAGE_ALL_DIMENSIONS) {
      const requirement = coverageRequirementById(`req.${dimension}`);
      expect(requirement?.path).toBe(dimension);
      expect(requirement?.dimension).toBe(dimension);
      expect(requirement?.satisfaction).toEqual({ min_accepted_facts: 1, evidence_match: "any" });
      expect(requirement?.evidence_kinds).toEqual([]);
    }
  });

  it("resolves requirement ids and rejects unregistered strings", () => {
    expect(isCoverageRequirementId("req.personality")).toBe(true);
    expect(isCoverageRequirementId("req.world_context")).toBe(true);
    expect(isCoverageRequirementId("req.bogus")).toBe(false);
    expect(isCoverageRequirementId("personality")).toBe(false);
    expect(coverageRequirementIdForDimension("personality")).toBe("req.personality");
    expect(coverageRequirementIdForDimension("values")).toBe("req.values");
    expect(coverageRequirementIdForDimension("unknown")).toBeUndefined();
    expect(coverageRequirementById("req.speech")?.label).toBeTruthy();
    expect(coverageRequirementById("req.unknown")).toBeUndefined();
  });
});

describe("coverage schema validation", () => {
  const baseSet = {
    id: "requirement-set-1",
    revision: contentHash("r1"),
    source: "default",
    characters: [{ character_id: "character-1", requirement_ids: ["req.identity", "req.personality"] }],
    world_requirement_ids: [],
    created_by: "system",
    created_at: "2026-08-13T00:00:00.000Z",
  };

  it("accepts a valid requirement set and rejects unknown fields", () => {
    expect(coverageRequirementSetSchema.safeParse(baseSet).success).toBe(true);
    expect(coverageRequirementSetSchema.safeParse({ ...baseSet, characters: [] }).success).toBe(false);
    expect(coverageRequirementSetSchema.safeParse({ ...baseSet, extra: true }).success).toBe(false);
    expect(coverageRequirementSetSchema.safeParse({ ...baseSet, source: "unknown" }).success).toBe(false);
  });

  it("rejects requirement ids outside the controlled catalog", () => {
    const invalid = { ...baseSet, characters: [{ character_id: "character-1", requirement_ids: ["req.not-registered"] }] };
    expect(coverageRequirementSetSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates the initial/formal item status matrix and assessment shape", () => {
    expect(COVERAGE_ASSESSMENT_ITEM_STATUSES).toContain("covered_by_source");
    expect(COVERAGE_INITIAL_ITEM_STATUSES).toEqual(["missing", "candidate_signal", "conflicted"]);
    expect(COVERAGE_FORMAL_ITEM_STATUSES).toEqual(["missing", "covered_by_source", "covered_by_user_supplement", "creative_completion_authorized", "conflicted"]);

    const baseAssessment = {
      id: "assessment-1",
      revision: contentHash("a1"),
      pass: "formal",
      requirement_set_id: "requirement-set-1",
      requirement_set_revision: "rev-1",
      input_snapshot: { source_revisions: [] },
      items: [{ requirement_id: "req.identity", status: "covered_by_source", candidate_fact_ids: [], accepted_fact_ids: ["fact-1"], research_task_ids: [], resolution_ids: [] }],
      operation_id: "op-1",
      created_by: "system",
      created_at: "2026-08-13T00:00:00.000Z",
    };
    expect(coverageAssessmentSchema.safeParse(baseAssessment).success).toBe(true);
    expect(coverageAssessmentSchema.safeParse({ ...baseAssessment, pass: "bogus" }).success).toBe(false);
    expect(coverageAssessmentSchema.safeParse({ ...baseAssessment, items: [] }).success).toBe(false);
    expect(coverageAssessmentSchema.safeParse({ ...baseAssessment, items: [{ ...baseAssessment.items[0], status: "candidate_signal" }] }).success).toBe(true);
  });

  it("validates user decision records", () => {
    const decision = {
      id: "decision-1",
      action: "creative_completion",
      requirement_ids: ["req.identity"],
      requirement_set_revision: "rev-1",
      choice: "creative_completion",
      rationale: "source exhausted",
      user_input: "請自由發揮",
      actor: "user",
      operation_id: "op-1",
      created_at: "2026-08-13T00:00:00.000Z",
    };
    expect(coverageUserDecisionSchema.safeParse(decision).success).toBe(true);
    expect(coverageUserDecisionSchema.safeParse({ ...decision, action: "bogus" }).success).toBe(false);
  });
});

describe("project state v1 to v2 migration", () => {
  function v1Fact(statement: string, coverage: string[]) {
    const now = "2026-08-13T00:00:00.000Z";
    return {
      id: `fact-${statement}`,
      statement,
      status: "candidate",
      confidence: 0.7,
      source_ids: ["source-1"],
      evidence: [statement],
      coverage,
      created_at: now,
      updated_at: now,
      created_by: "worker",
    };
  }

  it("upgrades schema version and fills coverage ledger arrays", () => {
    const v1 = {
      ...createProjectState("migrated"),
      schema_version: 1,
      facts: [v1Fact("Yukino is calm.", ["personality", "world_context"]), v1Fact("Yukino likes tea.", ["preferences"])],
    };
    delete (v1 as Record<string, unknown>).coverage_requirement_sets;
    delete (v1 as Record<string, unknown>).coverage_assessments;
    delete (v1 as Record<string, unknown>).coverage_user_decisions;

    const migrated = migrateProjectStateV1ToV2(v1 as unknown as Record<string, unknown>);

    expect(migrated.schema_version).toBe(2);
    expect(migrated.coverage_requirement_sets).toEqual([]);
    expect(migrated.coverage_assessments).toEqual([]);
    expect(migrated.coverage_user_decisions).toEqual([]);
    const facts = migrated.facts as Array<{ suggested_coverage_targets?: string[] }>;
    expect(facts[0]?.suggested_coverage_targets).toEqual(["req.personality", "req.world_context"]);
    expect(facts[1]?.suggested_coverage_targets).toEqual(["req.preferences"]);
  });

  it("is idempotent and deterministic", () => {
    const v1 = {
      ...createProjectState("migrated"),
      schema_version: 1,
      facts: [v1Fact("Yukino is calm.", ["personality"])],
    };
    delete (v1 as Record<string, unknown>).coverage_requirement_sets;
    delete (v1 as Record<string, unknown>).coverage_assessments;
    delete (v1 as Record<string, unknown>).coverage_user_decisions;

    const first = migrateProjectStateV1ToV2(v1 as unknown as Record<string, unknown>);
    const second = migrateProjectStateV1ToV2(first);
    const third = migrateProjectStateV1ToV2(v1 as unknown as Record<string, unknown>);
    expect(first).toEqual(second);
    expect(first).toEqual(third);
    expect((first.facts as Array<{ suggested_coverage_targets?: string[] }>)[0]?.suggested_coverage_targets).toEqual(["req.personality"]);
  });
});
