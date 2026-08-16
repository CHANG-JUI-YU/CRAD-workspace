import { describe, expect, it, vi } from "vitest";
import { MemoryProjectRepository, contentHash, type ImageRecord, type OperationRecord, type SourceRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-16T00:00:00.000Z";

function sourceRecord(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: text.split(".")[0] ?? text,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    provenance_kind: "external_source",
    created_at: now,
  };
}

function precheck(projectId: string) {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted" as const,
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "character",
      collaboration_mode: "assisted",
      characters: [
        { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
        { id: "saki", label: "Saki", ordinal: 2, mode: "palette" },
      ],
      primary_character_id: "alpha",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [{ subject_id: "alpha", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded" as const,
    created_by: "director",
    created_at: now,
  };
}

function blueprintArtifact(projectId: string) {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint" as const,
    name: "Blueprint",
    content: JSON.stringify({ schema_version: 1, project_id: projectId, flow: "character", characters: [{ id: "alpha", mode: "zhuji" }, { id: "saki", mode: "palette" }], primary_character_id: "alpha" }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft" as const,
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function characterArtifact(id: string) {
  return {
    id: `character-${id}`,
    key: `character:${id}`,
    kind: "character" as const,
    name: id,
    content: JSON.stringify({ kind: "character", id, display_name: id, aliases: [], summary: "", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm", provenance: [], extensions: {} }], provenance: [], extensions: {} }),
    media_type: "application/json",
    content_hash: contentHash(`character-${id}`),
    revision: contentHash(`character-${id}`),
    status: "draft" as const,
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact() {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    coverage: ["personality"],
    status: "accepted" as const,
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

function reviewRun() {
  return {
    id: "run-1",
    schema_version: 1,
    curation_run_id: "cur-1",
    candidate_set_revision: "cset-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "policy-1",
    status: "completed" as const,
    created_by: "director",
    created_at: now,
    completed_at: now,
  };
}

function decision() {
  return {
    id: "dec-1",
    schema_version: 1,
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted" as const,
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    candidate_revision: "cand-1",
    expected_projection_revision: contentHash("projection-1"),
    resulting_fact_revision: 1,
    created_at: now,
  };
}

function operation(id: string, kind: string): OperationRecord {
  return {
    id,
    kind: kind as OperationRecord["kind"],
    request: kind,
    actor: "director",
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

async function baseRuntime(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    project_status: "ready" as const,
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), characterArtifact("saki")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
  }));
  const runtime = new WorkspaceRuntime(repository);
  const formal = await runtime.coverageAssessment("formal");
  return { runtime, repository, formal: formal as { id: string; revision: string } };
}

function coverImage(id: string, overrides: Record<string, unknown> = {}): ImageRecord {
  return {
    id,
    character_id: undefined as unknown as string,
    blob_hash: contentHash(`blob-${id}`),
    media_type: "image/png",
    width: 1024,
    height: 1536,
    aspect_ratio: "2:3",
    crop: { width: 800, height: 1200, offset_x: 0, offset_y: 0 },
    source: "upload",
    license: "own",
    created_by: "director",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Audit 8 Batch 6 - URL ingestion lifecycle", () => {
  it("records a durable fetch_failed state with structured details when fetching fails", async () => {
    const { runtime, repository } = await baseRuntime("batch6-runtime-fail");
    const state = await repository.read();
        await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_research_batches: [{
        id: "batch-1",
        assessment_id: (current.coverage_assessments.at(-1) as { id: string }).id,
        assessment_revision: (current.coverage_assessments.at(-1) as { revision: string }).revision,
        requirement_set_id: (current.coverage_requirement_sets.at(-1) as { id: string }).id,
        requirement_set_revision: (current.coverage_requirement_sets.at(-1) as { revision: string }).revision,
        status: "completed" as const,
        task_ids: ["task-1"],
        created_by: "director",
        created_at: now,
      }],
      coverage_research_tasks: [{
        id: "task-1",
        batch_id: "batch-1",
        character_id: "alpha",
        requirement_ids: ["req.personality"],
        dimension_paths: ["personality"],
        query_seeds: ["alpha"],
        status: "exhausted" as const,
        claim_generation: 1,
        attempt: 1,
        searched_queries: [],
        source_families: [],
        exhausted_reason: "manual",
        created_at: now,
        updated_at: now,
      }],
      images: [coverImage("img-cover", { character_id: "alpha" })],
    }));
    const fetcher = vi.fn(async () => {
      throw new Error("network down");
    });
    const failingRuntime = new WorkspaceRuntime(repository, { fetcher: fetcher as never });
    const input = {
      task_id: "task-1",
      action: "manual_url" as const,
      url: "https://example.com/page",
      attachments: [],
      operation_id: "op-recover-fail",
    };
    let caught: unknown;
    try {
      await failingRuntime.coverageResearchRecover("director", input as never, []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    const err = caught as { code?: string; details?: Record<string, unknown> };
    expect(err.code).toBe("URL_FETCH_FAILED");
    expect(err.details).toBeDefined();
    expect(err.details?.url_ingestion_id).toBeDefined();
    expect(err.details?.status).toBe("fetch_failed");
    expect(err.details?.next_actions).toEqual(["retry", "change_url"]);
    const after = await repository.read();
        const record = after.url_ingestions.at(-1);
    expect(record).toBeDefined();
    expect(record?.url).toBe("https://example.com/page");
    expect(record?.status).toBe("fetch_failed");
    expect(record?.error_code).toBe("URL_FETCH_FAILED");
    expect(record?.error_message).toContain("network down");
  });

  it("records an ingested state with fetched metadata when fetching succeeds", async () => {
    const { runtime, repository } = await baseRuntime("batch6-runtime-ok");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_research_batches: [{
        id: "batch-1",
        assessment_id: (current.coverage_assessments.at(-1) as { id: string }).id,
        assessment_revision: (current.coverage_assessments.at(-1) as { revision: string }).revision,
        requirement_set_id: (current.coverage_requirement_sets.at(-1) as { id: string }).id,
        requirement_set_revision: (current.coverage_requirement_sets.at(-1) as { revision: string }).revision,
        status: "completed" as const,
        task_ids: ["task-1"],
        created_by: "director",
        created_at: now,
      }],
      coverage_research_tasks: [{
        id: "task-1",
        batch_id: "batch-1",
        character_id: "alpha",
        requirement_ids: ["req.personality"],
        dimension_paths: ["personality"],
        query_seeds: ["alpha"],
        status: "exhausted" as const,
        claim_generation: 1,
        attempt: 1,
        searched_queries: [],
        source_families: [],
        exhausted_reason: "manual",
        created_at: now,
        updated_at: now,
      }],
      images: [coverImage("img-cover", { character_id: "alpha" })],
    }));
    const fetcher = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/markdown" },
      content: Buffer.from("# Fetched title\n\nUseful content here."),
      final_url: "https://example.com/redirected",
      title: "Fetched Title",
      media_type: "text/markdown",
    }));
    const okRuntime = new WorkspaceRuntime(repository, { fetcher: fetcher as never });
    const input = {
      task_id: "task-1",
      action: "manual_url" as const,
      url: "https://example.com/page",
      attachments: [],
      operation_id: "op-recover-ok",
    };
    const result = await okRuntime.coverageResearchRecover("director", input as never, []);
    expect(result.status).toBe("completed");
    const after = await repository.read();
        const record = after.url_ingestions.at(-1);
    expect(record).toBeDefined();
    expect(record?.status).toBe("ingested");
    expect(record?.url).toBe("https://example.com/page");
    expect(record?.final_url).toBe("https://example.com/redirected");
    expect(record?.canonical_url).toBe("https://example.com/page");
    expect(record?.title).toBe("Fetched Title");
    expect(record?.media_type).toBe("text/markdown");
    expect(record?.content_size).toBeGreaterThan(0);
    expect(record?.source_id).toBeDefined();
    const source = after.sources.find((s) => s.id === record?.source_id);
    expect(source).toBeDefined();
    expect(source?.final_url).toBe("https://example.com/redirected");
    expect(source?.canonical_url).toBe("https://example.com/page");
    expect(source?.canonical_text).toContain("Useful content here.");
  });
});
