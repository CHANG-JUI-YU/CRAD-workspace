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
    coverage_targets: ["req.personality"],
    status: "candidate",
    confidence: 0.8,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    candidate_occurrence_id: "occ-1",
    created_at: now,
    updated_at: now,
    created_by: "fact-curator-1",
    ...overrides,
  };
}

function acceptedAlphaFact(): FactRecord {
  return fact({
    id: "fact-acc",
    status: "accepted",
    confidence: 0.9,
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    review_run_id: "run-1",
    decision_id: "dec-1",
  });
}

function reviewRun(status: "open" | "blocked" | "completed", id = "run-1"): FactReviewRunRecord {
  return {
    schema_version: 1,
    id,
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1", "occ-2"],
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

async function startServer(): Promise<{ server: ReturnType<typeof createWorkspaceServer>; base: string; repository: MemoryProjectRepository; assessmentId: string; assessmentRevision: string }> {
  const repository = new MemoryProjectRepository("batch7-server");
  const projectId = "batch7-server";
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha")],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [acceptedAlphaFact(), fact({ candidate_occurrence_id: "occ-2" })],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [...state.fact_review_runs, reviewRun("completed")],
    fact_review_decisions: [...state.fact_review_decisions, acceptedDecision("fact-acc", "occ-1", 1)],
  }));
  const runtime = new WorkspaceRuntime(repository);
  const { assessment } = await runtime.coverageAssessment("formal");
  const server = createWorkspaceServer({ runtime, actor: "batch7-test", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return { server, base: `http://127.0.0.1:${address.port}`, repository, assessmentId: assessment.id, assessmentRevision: assessment.revision };
}

async function closeServer(server: ReturnType<typeof createWorkspaceServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
}

describe("Audit 5 batch 7: dashboard UX read models and publish provenance", () => {
  it("serves the coverage center matrix and research monitor", async () => {
    const { server, base } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/dashboard/coverage-center`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.matrix).toBeDefined();
      expect(body.matrix.assessment).toBeDefined();
      expect(Array.isArray(body.matrix.cells)).toBe(true);
      expect(body.matrix.cells.length).toBeGreaterThan(0);
      for (const cell of body.matrix.cells) {
        expect(["missing", "candidate_signal", "source_covered", "supplement", "creative_completion", "conflict", "stale"]).toContain(cell.status);
        expect(cell.assessment_id).toBeTruthy();
        expect(cell.assessment_revision).toBeTruthy();
      }
      expect(body.monitor).toBeDefined();
      expect(Array.isArray(body.monitor.batches)).toBe(true);
      expect(Array.isArray(body.monitor.tasks)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("serves the artifact coverage lineage endpoint", async () => {
    const { server, base } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/dashboard/artifacts/character-alpha/coverage`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.artifact).toBeDefined();
      expect(["current", "stale", "missing"]).toContain(body.state);
      if (body.state === "missing") {
        expect(typeof body.reason).toBe("string");
      } else {
        expect(body.binding).toBeDefined();
        expect(body.input_snapshot_hash).toBeTruthy();
      }
    } finally {
      await closeServer(server);
    }
  });

  it("returns 404 for coverage lineage of an unknown artifact", async () => {
    const { server, base } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/dashboard/artifacts/does-not-exist/coverage`);
      expect(response.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });

  it("serves structured publish diagnostics", async () => {
    const { server, base } = await startServer();
    try {
      const response = await fetch(`${base}/workspace/dashboard/publish-diagnostics`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.rows)).toBe(true);
      for (const row of body.rows) {
        expect(typeof row.code).toBe("string");
        expect(["error", "warning"]).toContain(row.severity);
        expect(typeof row.next_action).toBe("string");
        if (row.target !== undefined) expect(typeof row.target.panel).toBe("string");
      }
      expect(typeof body.has_unknown).toBe("boolean");
    } finally {
      await closeServer(server);
    }
  });

  it("serves fact review evidence with stale markers", async () => {
    const { server, base, repository } = await startServer();
    try {
      const before = await repository.read();
      await repository.commit(before.revision, (state) => ({
        ...state,
        sources: [sourceRecord("source-1", "Alpha is serene and calm.")],
      }));
      const response = await fetch(`${base}/workspace/dashboard/fact-review/evidence`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.candidates)).toBe(true);
      expect(body.candidates.length).toBeGreaterThan(0);
      for (const candidate of body.candidates) {
        expect(Array.isArray(candidate.evidence_ref_stale)).toBe(true);
        for (const entry of candidate.evidence_ref_stale) {
          expect(typeof entry.stale).toBe("boolean");
          if (entry.stale) expect(typeof entry.stale_reason).toBe("string");
        }
      }
    } finally {
      await closeServer(server);
    }
  });

  it("includes the batch-7 panels in the dashboard html", async () => {
    const html = dashboard();
    expect(html).toContain("覆蓋矩陣與研究監控");
    expect(html).toContain("Fact Review 證據上下文");
    expect(html).toContain("kpi-list");
    expect(html).toContain("provenance-summary");
    expect(html).toContain("覆蓋關聯");
    expect(html).toContain("/workspace/dashboard/coverage-center");
    expect(html).toContain("/workspace/dashboard/artifacts/");
    expect(html).toContain("/workspace/dashboard/publish-diagnostics");
    expect(html).toContain("/workspace/dashboard/fact-review/evidence");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
  });

  it("keeps the batch-5 coverage center and prior batches intact", async () => {
    const html = dashboard();
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("/workspace/dashboard/coverage");
    expect(html).toContain("/workspace/coverage/research/start");
    expect(html).toContain("/workspace/coverage/resolution/confirm");
    expect(html).toContain("/workspace/dashboard/workflow");
    expect(html).toContain("來源適配工作流程");
  });
});
