import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryProjectRepository, contentHash, type ProjectState } from "@st-workspace/core";

const now = "2026-08-16T00:00:00.000Z";

function sourceRecord(id: string, text: string) {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: id,
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    created_at: now,
  };
}

function precheck(projectId: string) {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: {
      schema_version: 1,
      project_id: projectId,
      flow: "source_adaptation",
      collaboration_mode: "assisted",
      characters: [
        { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
        { id: "saki", label: "Saki", ordinal: 2, mode: "palette" },
      ],
      primary_character_id: "alpha",
    },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: [
      {
        subject_id: "alpha",
        dimension: "character_core",
        uncertainty: "low",
        impact: "high",
        basis: "explicit",
        action: "preserve_explicit",
      },
    ],
    status: "recorded",
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string) {
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content: JSON.stringify({
      schema_version: 1,
      project_id: projectId,
      flow: "source_adaptation",
      characters: [
        { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
        { id: "saki", label: "Saki", ordinal: 2, mode: "palette" },
      ],
      primary_character_id: "alpha",
    }),
    media_type: "application/json",
    content_hash: contentHash("blueprint-1"),
    revision: contentHash("blueprint-1"),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
  };
}

function characterArtifact(id: string) {
  return {
    id,
    key: `character:${id}`,
    kind: "character",
    name: `Character ${id}`,
    content: JSON.stringify({
      kind: "character",
      document: {
        schema_version: 1,
        id,
        display_name: id,
        aliases: [],
        summary: "Summary",
        relationships: [],
        sections: [{ id: "personality", title: "Personality", content: "Content", provenance: [], extensions: {} }],
        provenance: [],
        extensions: {},
      },
    }),
    media_type: "text/markdown",
    content_hash: contentHash(`character-${id}`),
    revision: contentHash(`character-${id}`),
    status: "draft",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-author",
  };
}

function fact(overrides: Record<string, unknown> = {}) {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    coverage: ["personality"],
    status: "accepted",
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [
      {
        source_id: "source-1",
        source_revision_id: contentHash("Alpha is calm."),
        quote: "Alpha is calm.",
      },
    ],
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

function reviewRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    schema_version: 1,
    curation_run_id: "curation-1",
    candidate_set_revision: contentHash("cset-1"),
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: contentHash("policy-1"),
    status: "completed",
    created_by: "director",
    created_at: now,
    completed_at: now,
    ...overrides,
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
    decision: "accepted",
    reviewer_identity: "reviewer",
    reason: "proven",
    evidence: [
      {
        source_id: "source-1",
        source_revision_id: contentHash("Alpha is calm."),
        quote: "Alpha is calm.",
      },
    ],
    candidate_revision: "cand-1",
    expected_projection_revision: contentHash("projection-1"),
    resulting_fact_revision: 1,
    created_at: now,
  };
}

function operation(id: string, kind: string) {
  return {
    id,
    kind,
    request: kind,
    actor: "director",
    status: "completed",
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

async function baseState(repository: MemoryProjectRepository, projectId: string) {
  await repository.commit(0, (current) => ({
    ...current,
    project_name: "雪乃",
    project_status: "ready",
    interview: {
      schema_version: 1,
      flow: "source_adaptation",
      status: "complete",
      values: {},
      answers: [],
    },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), characterArtifact("saki")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit((await repository.read()).revision, (current) => ({
    ...current,
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
  }));
}

describe("#108 url ingestion lifecycle", () => {
  it("round-trips a url_ingestions record through state validation", async () => {
    const repository = new MemoryProjectRepository("batch6-core");
    await baseState(repository, "batch6-core");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      url_ingestions: [
        {
          id: "ingest-1",
          operation_id: "op-recover-1",
          url: "https://example.com/a",
          status: "fetching",
          created_at: now,
          updated_at: now,
        },
      ],
    }));
    const after = await repository.read();
    expect(after.url_ingestions).toHaveLength(1);
    expect(after.url_ingestions[0]?.status).toBe("fetching");
    const failed = await repository.commit(after.revision, (current) => ({
      ...current,
      url_ingestions: [
        {
          ...current.url_ingestions[0]!,
          status: "fetch_failed",
          error_code: "URL_FETCH_FAILED",
          error_message: "boom",
          updated_at: now,
        },
      ],
    }));
    expect(failed.url_ingestions[0]?.status).toBe("fetch_failed");
    expect(failed.url_ingestions[0]?.error_code).toBe("URL_FETCH_FAILED");
    const done = await repository.commit(failed.revision, (current) => ({
      ...current,
      url_ingestions: [
        {
          ...current.url_ingestions[0]!,
          status: "ingested",
          final_url: "https://example.com/a",
          canonical_url: "https://example.com/a",
          title: "Example",
          media_type: "text/html",
          content_size: 12,
          source_id: "source-2",
          updated_at: now,
        },
      ],
    }));
    expect(done.url_ingestions[0]?.status).toBe("ingested");
    expect(done.url_ingestions[0]?.source_id).toBe("source-2");
  });

  it("keeps legacy states without url_ingestions readable", async () => {
    const state = (await import("@st-workspace/core")).createProjectState("batch6-legacy") as unknown as ProjectState & {
      url_ingestions?: unknown[];
    };
    expect(Array.isArray(state.url_ingestions)).toBe(true);
  });
});
