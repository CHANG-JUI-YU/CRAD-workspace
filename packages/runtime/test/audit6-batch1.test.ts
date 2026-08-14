import { describe, expect, it } from "vitest";
import {
  contentHash,
  MemoryProjectRepository,
  createProjectState,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import {
  coverageResearchClaim,
  coverageResearchStart,
  coverageResolutionConfirm,
  coverageSupplement,
  type CoverageApplicationDeps,
} from "../src/index.js";
import { runFormalCoverageAssessment } from "@st-workspace/domain";


const now = "2026-08-14T00:00:00.000Z";

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

function precheck(projectId: string): BlueprintPrecheckRecord {
  const bp = {
    schema_version: 1,
    title: "Test Blueprint",
    source_adaptation: true,
    characters: [{ id: "alpha", label: "Alpha", is_primary: true }],
    world: { enabled: false },
    relationships: { enabled: false },
  };
  const rev = contentHash(JSON.stringify(bp));
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: bp,
    candidate_blueprint_revision: rev,
    status: "recorded",
    checks: [{
      subject_id: "alpha",
      dimension: "character_core",
      uncertainty: "low",
      impact: "low",
      basis: "blueprint character",
      action: "preserve_explicit",
    }],
    created_at: now,
    created_by: "director",
  };
}

function buildBaseState(): ProjectState {
  const base = createProjectState("proj-1", "Test Project");
  const pc = precheck("proj-1");

  const reqSet: CoverageRequirementSet = {
    id: "reqset-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: pc.candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.identity"] }],
    world_requirement_ids: [],
    created_by: "director",
    created_at: now,
  };

  return {
    ...base,
    project_status: "interviewing",
    blueprint_prechecks: [pc],
    coverage_requirement_sets: [reqSet],
  };
}

describe("Audit 6 Batch 1 - Runtime Stale Guards & Research Batch", () => {
  it("#39 Rejects stale assessment on mutation commands without side effects", async () => {
    const baseState = buildBaseState();
    const reqSet = baseState.coverage_requirement_sets[0]!;
    const assessment = runFormalCoverageAssessment(baseState, reqSet, "op-formal-1", "director");

    const stateWithAssess: ProjectState = {
      ...baseState,
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository(stateWithAssess.id, stateWithAssess);
    const deps: CoverageApplicationDeps = {
      repository: repo,
      knowledge: {} as any,
    };

    // Stale trigger 1: Blueprint revision changes
    await repo.commit((await repo.read()).revision, (curr) => ({
      ...curr,
      blueprint_prechecks: [
        {
          ...curr.blueprint_prechecks[0]!,
          candidate_blueprint_revision: contentHash("bp-rev-changed"),
        },
      ],
    }));

    const revisionBefore = (await repo.read()).revision;
    const auditBeforeCount = (await repo.read()).audit.length;

    // Mutation commands should throw COVERAGE_ASSESSMENT_STALE
    await expect(
      coverageResearchStart(deps, "director", assessment.id, assessment.revision),
    ).rejects.toThrow("COVERAGE_ASSESSMENT_STALE");

    await expect(
      coverageResolutionConfirm(deps, "director", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        action: "accept_candidate",
        requirement_id: "req.identity",
      }),
    ).rejects.toThrow("COVERAGE_ASSESSMENT_STALE");

    await expect(
      coverageSupplement(deps, "director", {
        assessment_id: assessment.id,
        assessment_revision: assessment.revision,
        requirement_id: "req.identity",
        text: "Supplemental evidence",
      }),
    ).rejects.toThrow("COVERAGE_ASSESSMENT_STALE");

    // Check no side effects or state mutation occurred
    const stateAfter = await repo.read();
    expect(stateAfter.revision).toBe(revisionBefore);
    expect(stateAfter.audit.length).toBe(auditBeforeCount);
  });

  it("Research batch task lifecycle works normally after start", async () => {
    const baseState = buildBaseState();
    const reqSet = baseState.coverage_requirement_sets[0]!;
    const assessment = runFormalCoverageAssessment(baseState, reqSet, "op-formal-1", "director");

    const stateWithAssess: ProjectState = {
      ...baseState,
      coverage_assessments: [assessment],
    };

    const repo = new MemoryProjectRepository(stateWithAssess.id, stateWithAssess);
    const deps: CoverageApplicationDeps = {
      repository: repo,
      knowledge: {} as any,
    };

    // Start research batch when assessment is fresh
    const startRes = await coverageResearchStart(deps, "director", assessment.id, assessment.revision);
    expect(startRes.status).toBe("completed");
    expect(startRes.batch_id).toBeDefined();

    const batchId = startRes.batch_id as string;

    // Claim task from research batch
    const claimRes = await coverageResearchClaim(deps, "researcher", batchId, 300000);
    expect(claimRes.status).toBe("completed");
    expect(claimRes.task).toBeDefined();
  });
});
