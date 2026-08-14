import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageRequirementSet,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type OperationRecord,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";
import type { CoverageResearchRecoverInput, CoverageResolutionConfirmInput, CoverageResolutionPreviewInput, CoverageSupplementInput } from "@st-workspace/domain";

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
    content: JSON.stringify({
      schema_version: 1,
      title: "Test Blueprint",
      source_adaptation: true,
      characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }],
      primary_character_id: "alpha",
      world: { enabled: false },
      relationships: { enabled: false },
    }),
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

function fact(overrides: Partial<FactRecord> = {}): FactRecord {
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
    ...overrides,
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

async function baseRuntime(projectId = "batch7-runtime") {
  const repository = new MemoryProjectRepository(projectId);
  const state = createProjectState(projectId, "Batch7 Runtime");
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

async function runtimeState(repository: MemoryProjectRepository): Promise<ProjectState> {
  return repository.read();
}

describe("Audit 7 Batch 1 - Runtime Preview/Confirm Eligibility", () => {
  it("preview rejects a historical assessment with a stable reason", async () => {
    const { runtime, repository } = await baseRuntime();
    const first = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };
    const state = await runtimeState(repository);
    const reqSet = state.coverage_requirement_sets.at(-1)!;
    const second = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };
    void reqSet;

    const previewInput: CoverageResolutionPreviewInput = {
      assessment_id: first.assessment.id,
      assessment_revision: first.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      action: "user_supplement",
    };

    let caught: Error | undefined;
    try {
      await runtime.coverageResolutionPreview(previewInput);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(caught?.message).toContain("NOT_CURRENT");
    expect(second.assessment).toBeDefined();
  });

  it("preview rejects an initial assessment (not formal)", async () => {
    const { runtime } = await baseRuntime();
    const initial = (await runtime.coverageAssessment("initial")) as { assessment: { id: string; revision: string } };

    let caught: Error | undefined;
    try {
      await runtime.coverageResolutionPreview({
        assessment_id: initial.assessment.id,
        assessment_revision: initial.assessment.revision,
        requirement_id: "req.personality",
        character_id: "alpha",
        action: "user_supplement",
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(caught?.message).toContain("NOT_FORMAL");
  });

  it("preview rejects stale inputs after the assessment", async () => {
    const { runtime, repository } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const state = await runtimeState(repository);
    const changedSource = sourceRecord("source-1", "Alpha is serene and calm.");
    await repository.commit(state.revision, (current) => ({ ...current, sources: [changedSource] }));

    let caught: Error | undefined;
    try {
      await runtime.coverageResolutionPreview({
        assessment_id: formal.assessment.id,
        assessment_revision: formal.assessment.revision,
        requirement_id: "req.personality",
        character_id: "alpha",
        action: "user_supplement",
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(caught?.message).toContain("STALE");
  });

  it("preview succeeds for a valid current formal assessment", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const preview = await runtime.coverageResolutionPreview({
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      action: "user_supplement",
    });
    expect(preview).toBeDefined();
    expect((preview as { assessment_id?: string }).assessment_id).toBe(formal.assessment.id);
    expect((preview as { consequences?: unknown[] }).consequences).toBeDefined();
  });

  it("confirm re-evaluates eligibility after a successful preview (race protection)", async () => {
    const { runtime, repository } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const preview = await runtime.coverageResolutionPreview({
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      action: "user_supplement",
    });
    expect(preview).toBeDefined();

    const state = await runtimeState(repository);
    const changedSource = sourceRecord("source-1", "Alpha is serene and calm.");
    await repository.commit(state.revision, (current) => ({ ...current, sources: [changedSource] }));

    const confirmInput: CoverageResolutionConfirmInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      action: "user_supplement",
      choice: "user_supplement",
      rationale: "補充資料已提供",
      operation_id: "op-supp-1",
    };

    let caught: Error | undefined;
    try {
      await runtime.coverageResolutionConfirm("director", confirmInput);
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("COVERAGE_ASSESSMENT_STALE");
    expect(caught?.message).toContain("STALE");
  });
});

describe("Audit 7 Batch 1 - Runtime Typed Contract Forwarding", () => {
  it("supplement forwards operation_id and text into the operation identity", async () => {
    const { runtime, repository } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const supplementInput: CoverageSupplementInput = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      choice: "補充性格設定",
      rationale: "由創作者補充性格資料",
      text: "補充文字內容",
      url: undefined,
      attachments: [],
      operation_id: "op-supp-1",
    };
    void supplementInput.attachments;

    const first = await runtime.coverageSupplement("director", { ...supplementInput, attachments: undefined }, []);
    expect(first.status).toBe("completed");

    const state = await runtimeState(repository);
    const operation = state.operations.find((op) => op.id === "op-supp-1");
    expect(operation).toBeDefined();
    expect(operation?.command?.type).toBe("coverage_supplement");
    expect((operation?.command?.payload as { text?: string }).text).toBe("補充文字內容");
    expect(operation?.status).toBe("completed");

    const replay = await runtime.coverageSupplement("director", { ...supplementInput, attachments: undefined }, []);
    expect((replay as { replayed?: boolean }).replayed).toBe(true);
    const afterReplay = await runtimeState(repository);
    expect(afterReplay.operations.filter((op) => op.id === "op-supp-1").length).toBe(1);
  });

  it("recovery forwards text/choice/rationale into the command payload", async () => {
    const { runtime, repository } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };

    const state = await runtimeState(repository);
    await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_research_batches: [
        {
          id: "batch-1",
          assessment_id: formal.assessment.id,
          assessment_revision: formal.assessment.revision,
          requirement_set_id: current.coverage_requirement_sets.at(-1)?.id ?? "set-1",
          requirement_set_revision: current.coverage_requirement_sets.at(-1)?.revision ?? "set-rev-1",
          status: "open",
          task_ids: ["task-1"],
          created_by: "director",
          created_at: now,
        },
      ],
      coverage_research_tasks: [
        {
          id: "task-1",
          batch_id: "batch-1",
          character_id: "alpha",
          requirement_ids: ["req.personality"],
          dimension_paths: ["personality"],
          query_seeds: ["Alpha"],
          source_constraints: [],
          status: "exhausted",
          claim_generation: 1,
          lease_owner: "researcher-1",
          lease_expires_at: "2099-01-01T00:00:00.000Z",
          attempt: 1,
          searched_queries: ["Alpha"],
          source_families: ["wiki"],
          exhausted_reason: "沒有更多結果",
          created_at: now,
          updated_at: now,
        },
      ],
    }));

    const recoverInput: CoverageResearchRecoverInput = {
      task_id: "task-1",
      action: "creative_completion",
      text: "補充創作說明",
      choice: "授權創作補全",
      rationale: "來源不足，授權創作補全",
      attachments: [],
      operation_id: "op-recover-1",
    };

    const result = await runtime.coverageResearchRecover("director", { ...recoverInput, attachments: undefined }, []);
    expect(result.status).toBe("completed");

    const after = await runtimeState(repository);
    const operation = after.operations.find((op) => op.id === "op-recover-1");
    expect(operation).toBeDefined();
    const payload = operation?.command?.payload as Record<string, unknown>;
    expect(payload.action).toBe("creative_completion");
    expect(payload.text).toBe("補充創作說明");
    expect(payload.choice).toBe("授權創作補全");
    expect(payload.rationale).toBe("來源不足，授權創作補全");
    expect(payload.task_id).toBe("task-1");
  });
});

describe("Audit 7 Batch 1 - Runtime Read Model Projection", () => {
  it("coverage center exposes eligibility and wide-research projections", async () => {
    const { runtime } = await baseRuntime();
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };
    void formal;

    const center = (await runtime.dashboardCoverageCenter()) as {
      matrix: {
        assessment: { actionable: boolean; formal: boolean; fresh: boolean };
        assessment_eligibility: { actionable: boolean };
        assessment_wide_research: { enabled: boolean; target_count: number };
      };
    };
    expect(center.matrix.assessment_eligibility.actionable).toBe(true);
    expect(center.matrix.assessment.actionable).toBe(true);
    expect(center.matrix.assessment.formal).toBe(true);
    expect(center.matrix.assessment_wide_research.enabled).toBe(true);
    expect(center.matrix.assessment_wide_research.target_count).toBeGreaterThan(0);
  });
});
