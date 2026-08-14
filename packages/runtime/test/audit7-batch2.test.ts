import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type OperationRecord,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";
import type {
  CoverageResearchStartInput,
  CoverageResearchStartPreviewInput,
  CoverageResolutionConfirmInput,
} from "@st-workspace/domain";

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
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      title: "Test Blueprint",
      source_adaptation: true,
      characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }],
      primary_character_id: "alpha",
      world: { enabled: false },
      relationships: { enabled: false },
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    status: "recorded",
    checks: [
      { subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" },
    ],
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({ schema_version: 1, title: "Test Blueprint", source_adaptation: true }),
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

function characterArtifact(): ArtifactRecord {
  return {
    id: "character-alpha",
    key: "character:alpha",
    kind: "character",
    name: "Alpha",
    content: JSON.stringify({ document: { schema_version: 1, id: "alpha", title: "Alpha", text: "Alpha is calm." } }),
    media_type: "text/markdown",
    content_hash: contentHash("character-alpha"),
    revision: contentHash("character-alpha"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(): FactRecord {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    status: "accepted",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "director",
  };
}

function reviewRun(): FactReviewRunRecord {
  return {
    id: "run-1",
    schema_version: 1,
    status: "completed",
    candidate_occurrence_ids: ["occ-1"],
    candidate_set_revision: "cset-1",
    policy_revision: "policy-1",
    created_by: "reviewer",
    created_at: now,
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
  };
}

function decision(): FactReviewDecisionRecord {
  return {
    id: "dec-1",
    schema_version: 1,
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted",
    resulting_fact_revision: 1,
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    candidate_revision: "cand-1",
    expected_projection_revision: contentHash("projection-1"),
    created_at: now,
  };
}

function operation(id: string, kind: string): OperationRecord {
  return {
    id,
    kind,
    request: kind,
    actor: "director",
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  } as OperationRecord;
}

async function baseRuntime(projectId = "batch7-2-runtime") {
  const repository = new MemoryProjectRepository(projectId);
  const state = createProjectState(projectId, "Batch7-2 Runtime");
  await repository.commit(0, (current) => ({
    ...current,
    project_status: "ready",
    interview: { ...current.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact()],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  const runtime = new WorkspaceRuntime(repository);
  return { runtime, repository };
}

describe("Audit 7 Batch 2 - Runtime Issue #74 Research Target Eligibility", () => {
  it("coverageResearchStart rejects non-missing explicit requirement scope", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };

    // req.personality is covered_by_source due to accepted fact
    const personalityItem = formal.assessment.items.find((i) => i.requirement_id === "req.personality");
    expect(personalityItem?.status).toBe("covered_by_source");

    const startInput: CoverageResearchStartInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      scope: {
        kind: "requirements",
        targets: [{ requirement_id: "req.personality", character_id: "alpha" }],
      },
    };

    let caught: Error | undefined;
    try {
      await runtime.coverageResearchStart("director", startInput.assessment_id, startInput.assessment_revision, startInput.scope);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_RESEARCH_TARGET_INELIGIBLE");
    expect(caught?.message).toContain("covered_by_source");
  });

  it("coverageResearchStartPreview rejects non-missing explicit requirement scope", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const previewInput: CoverageResearchStartPreviewInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      scope: {
        kind: "requirements",
        targets: [{ requirement_id: "req.personality", character_id: "alpha" }],
      },
    };

    let caught: Error | undefined;
    try {
      await runtime.coverageResearchStartPreview(previewInput);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_RESEARCH_TARGET_INELIGIBLE");
  });

  it("coverageResearchStart succeeds for missing requirement targets and creates batch", async () => {
    const { runtime, repository } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };

    // Find a missing item (e.g. req.appearance or other character dimensions)
    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    const startResult = await runtime.coverageResearchStart("director", formal.assessment.id, formal.assessment.revision, {
      kind: "requirements",
      targets: [{ requirement_id: missingItem!.requirement_id, character_id: "alpha" }],
    });

    expect(startResult.status).toBe("completed");
    expect(startResult.batch_id).toBeDefined();

    const state = await repository.read();
    expect(state.coverage_research_batches.length).toBeGreaterThan(0);
    expect(state.coverage_research_tasks.length).toBeGreaterThan(0);
  });
});

describe("Audit 7 Batch 2 - Runtime Issue #78 Duplicate Resolution Rejection", () => {
  it("coverageResolutionConfirm rejects duplicate user_supplement confirmation on the same requirement scope", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };

    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    const confirmInput: CoverageResolutionConfirmInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: missingItem!.requirement_id,
      character_id: "alpha",
      action: "user_supplement",
      choice: "提供補充資料",
      rationale: "理由一",
      operation_id: "op-confirm-supp-1",
    };

    const first = await runtime.coverageResolutionConfirm("director", confirmInput);
    expect(first.status).toBe("completed");

    // Second confirmation on same requirement with different operation_id must fail with COVERAGE_RESOLUTION_DUPLICATE
    const duplicateInput: CoverageResolutionConfirmInput = {
      ...confirmInput,
      rationale: "理由二",
      operation_id: "op-confirm-supp-2",
    };

    let caught: Error | undefined;
    try {
      await runtime.coverageResolutionConfirm("director", duplicateInput);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_RESOLUTION_DUPLICATE");
  });

  it("coverageResolutionConfirm marks assessment stale on creative_completion and rejects duplicate after reassessment", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };

    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    const confirmInput: CoverageResolutionConfirmInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: missingItem!.requirement_id,
      character_id: "alpha",
      action: "creative_completion",
      choice: "授權創作補全",
      rationale: "理由一",
      operation_id: "op-confirm-creative-1",
    };

    const first = await runtime.coverageResolutionConfirm("director", confirmInput);
    expect(first.status).toBe("completed");

    // Direct repeat on old assessment fails because assessment is now stale
    let caughtStale: Error | undefined;
    try {
      await runtime.coverageResolutionConfirm("director", { ...confirmInput, operation_id: "op-confirm-creative-2" });
    } catch (error) {
      caughtStale = error as Error;
    }
    expect(caughtStale).toBeDefined();
    expect((caughtStale as { code?: string }).code).toBe("COVERAGE_ASSESSMENT_STALE");

    // Reassess to get new fresh assessment
    const reassessment = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    // Confirm again on new assessment revision fails with COVERAGE_RESOLUTION_DUPLICATE
    let caughtDup: Error | undefined;
    try {
      await runtime.coverageResolutionConfirm("director", {
        ...confirmInput,
        assessment_id: reassessment.assessment.id,
        assessment_revision: reassessment.assessment.revision,
        operation_id: "op-confirm-creative-3",
      });
    } catch (error) {
      caughtDup = error as Error;
    }
    expect(caughtDup).toBeDefined();
    expect((caughtDup as { code?: string }).code).toBe("COVERAGE_RESOLUTION_DUPLICATE");
  });
});

describe("Audit 7 Batch 2 - Runtime Issue #95 In-flight Work Reuse", () => {
  it("coverageResearchStart reuses existing in-flight task when all requested targets are in-flight", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string; items: Array<{ requirement_id: string; status: string }> } };

    const missingItem = formal.assessment.items.find((i) => i.status === "missing");
    expect(missingItem).toBeDefined();

    // Start research once
    const first = await runtime.coverageResearchStart("director", formal.assessment.id, formal.assessment.revision, {
      kind: "requirements",
      targets: [{ requirement_id: missingItem!.requirement_id, character_id: "alpha" }],
    });
    expect(first.status).toBe("completed");

    // Start research again on same target (already queued/running)
    const second = await runtime.coverageResearchStart("director", formal.assessment.id, formal.assessment.revision, {
      kind: "requirements",
      targets: [{ requirement_id: missingItem!.requirement_id, character_id: "alpha" }],
    });

    expect(second.status).toBe("completed");
    expect((second as { reused?: boolean }).reused).toBe(true);
  });
});
