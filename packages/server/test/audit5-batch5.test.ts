import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactDecisionRecord,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";
import { dashboard } from "../src/dashboard.js";

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

function acceptedAlphaFact(): FactRecord {
  return {
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    coverage_targets: ["req.personality"],
    status: "accepted",
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
    created_by: "fact-reviewer-1",
  };
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
  };
}

async function startServer(): Promise<{ server: ReturnType<typeof createWorkspaceServer>; base: string; repository: MemoryProjectRepository; assessmentId: string; assessmentRevision: string }> {
  const repository = new MemoryProjectRepository("batch5-server");
  const projectId = "batch5-server";
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact()],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, reviewRun("completed")],
    fact_review_decisions: [...state.fact_review_decisions, acceptedDecision("fact-acc", "occ-1", 1)],
  }));
  const runtime = new WorkspaceRuntime(repository);
  const { assessment } = await runtime.coverageAssessment("formal");
  const server = createWorkspaceServer({ runtime, actor: "batch5-test", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return { server, base: `http://127.0.0.1:${address.port}`, repository, assessmentId: assessment.id, assessmentRevision: assessment.revision };
}

describe("Audit 5 batch 5: coverage REST endpoints", () => {
  it("serves the coverage dashboard read model with per-cell actions", async () => {
    const { server, base, assessmentId, assessmentRevision } = await startServer();
    try {
      const data = await (await fetch(`${base}/workspace/dashboard/coverage`)).json();
      expect(data.assessment).toMatchObject({ id: assessmentId, revision: assessmentRevision, pass: "formal" });
      const appearance = data.cells.find((cell: { requirement_id: string }) => cell.requirement_id === "req.appearance");
      expect(appearance).toBeDefined();
      expect(appearance.actions).toEqual(expect.arrayContaining(["research", "supplement", "creative_completion"]));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("starts coverage research through the REST endpoint", async () => {
    const { server, base, assessmentId, assessmentRevision } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/coverage/research/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessment_id: assessmentId, assessment_revision: assessmentRevision }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.batch_id).toBeDefined();
      expect(Array.isArray(body.task_ids)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("claims a research task through the REST endpoint", async () => {
    const { server, base, assessmentId, assessmentRevision } = await startServer();
    try {
      const started = await (await fetch(`${base}/workspace/coverage/research/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessment_id: assessmentId, assessment_revision: assessmentRevision }),
      })).json();
      const claimed = await (await fetch(`${base}/workspace/coverage/research/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch_id: started.batch_id }),
      })).json();
      expect(claimed.task).toMatchObject({ status: "claimed", lease_owner: "batch5-test" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("previews resolution consequences without writing state", async () => {
    const { server, base, repository, assessmentId, assessmentRevision } = await startServer();
    try {
      const before = await repository.read();
      const preview = await (await fetch(`${base}/workspace/coverage/resolution/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessment_id: assessmentId, assessment_revision: assessmentRevision, requirement_id: "req.appearance", character_id: "alpha", action: "user_supplement" }),
      })).json();
      expect(preview.consequences.length).toBeGreaterThan(0);
      const after = await repository.read();
      expect(after.revision).toBe(before.revision);
      expect(after.coverage_user_decisions).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("rejects an unconfirmed resolution confirm with missing fields", async () => {
    const { server, base, assessmentId, assessmentRevision } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/coverage/resolution/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessment_id: assessmentId, assessment_revision: assessmentRevision, requirement_id: "req.appearance", character_id: "alpha", action: "creative_completion" }),
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("COVERAGE_RESOLUTION_REQUIRED");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("includes the coverage panel and endpoints in the dashboard html", async () => {
    const html = dashboard();
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("/workspace/dashboard/coverage");
    expect(html).toContain("/workspace/coverage/research/start");
    expect(html).toContain("/workspace/coverage/resolution/confirm");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });
});
