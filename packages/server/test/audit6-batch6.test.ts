import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  authoringBindingHash,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  createProjectState,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type CoverageAssessment,
  type CoverageRequirementSet,
  type FactRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type OperationRecord,
  type ProjectRepository,
  type ProjectState,
  type SourceRecord,
} from "@st-workspace/core";
import { runFormalCoverageAssessment } from "@st-workspace/domain";
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

const characters = [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }];

const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];

function zhujiArtifact(projectId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "zhuji", character_id: "alpha", module: { schema_version: 1, mode: "zhuji", module, title: module, data: { description: `${module} module.` } } });
  return {
    id: `zhuji-${module}`,
    key: `zhuji:alpha/${module}`,
    kind: "zhuji",
    name: `alpha/${module}`,
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
    id: "fact-acc",
    statement: "Alpha is calm.",
    subject: "alpha",
    predicate: "has",
    value: "calm",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage: ["personality"],
    status: "accepted",
    confidence: 0.8,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    fact_revision: 1,
    coverage_targets: ["req.personality"],
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "fact-curator",
    ...overrides,
  };
}

function reviewRun(): FactReviewRunRecord {
  return {
    schema_version: 1,
    id: "run-1",
    candidate_set_revision: "set-1",
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: "pol-1",
    status: "completed",
    created_by: "system",
    created_at: now,
  };
}

function acceptedDecision(): FactReviewDecisionRecord {
  return {
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

function greetingArtifact(): ArtifactRecord {
  const content = JSON.stringify({ document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } });
  return {
    id: "greeting-alpha",
    key: "greeting:alpha",
    kind: "greeting",
    name: "alpha",
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

function operation(id: string, kind: string): OperationRecord {
  return { id, kind, request: kind, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

function buildReadyState(projectId: string): ProjectState {
  const base = createProjectState(projectId, "Test Project");
  const initial: ProjectState = {
    ...base,
    project_status: "ready",
    interview: { ...base.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact("alpha"), greetingArtifact(), ...ZHUJI_MODULES.map((module) => zhujiArtifact(projectId, module))],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [acceptedDecision()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  };
  const reqSet: CoverageRequirementSet = {
    id: "set-1",
    revision: "set-rev-1",
    source: "default",
    blueprint_revision: precheck(projectId).candidate_blueprint_revision,
    characters: [{ character_id: "alpha", requirement_ids: ["req.personality"] }],
    world_requirement_ids: [],
    created_at: now,
    created_by: "director",
  };
  const rawAssessment = runFormalCoverageAssessment({ ...initial, coverage_requirement_sets: [reqSet] }, reqSet, "op-formal-1", "director");
  const assessment: CoverageAssessment = {
    ...rawAssessment,
    items: rawAssessment.items.map((item) => ({ ...item, status: "covered_by_source", accepted_fact_ids: ["fact-acc"] })),
  };
  const withAssessment: ProjectState = {
    ...initial,
    coverage_requirement_sets: [reqSet],
    coverage_assessments: [assessment],
  };
  const plan = computeProjectProjection(withAssessment).publishPlan();
  const factProjection = coverageFactProjectionRevision(withAssessment);
  const coverageSensitiveArtifacts = withAssessment.artifacts.filter((item) => item.kind === "character" || item.kind === "zhuji" || item.kind === "greeting");
  const bindings = coverageSensitiveArtifacts.map((artifact, index) => ({
    id: `binding-${index + 1}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment.id,
    assessment_revision: assessment.revision,
    requirement_set_revision: reqSet.revision,
    fact_projection_revision: factProjection,
    fact_review_run_id: "run-1",
    resolution_ids: [],
    input_snapshot_hash: authoringBindingHash({
      artifact_id: artifact.id,
      artifact_revision: artifact.revision,
      assessment_id: assessment.id,
      assessment_revision: assessment.revision,
      requirement_set_revision: reqSet.revision,
      fact_projection_revision: factProjection,
      fact_review_run_id: "run-1",
      resolution_ids: [],
    }),
    created_by: "director",
    created_at: now,
  }));
  return {
    ...withAssessment,
    coverage_authoring_bindings: bindings,
    builds: [{
      id: "build-1",
      operation_id: "op-build",
      status: "previewed",
      artifact_ids: plan.entries.map((entry) => entry.artifact_id),
      content_hash: contentHash("build-1"),
      diagnostics: [],
      created_at: now,
    }],
    reviews: coverageSensitiveArtifacts.map((item, index) => ({ id: `review-${index + 1}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "reviewer", status: "passed", issue_ids: [], created_at: now })),
  };
}

async function startServer(projectId = "batch6-server"): Promise<{ runtime: WorkspaceRuntime; repository: ProjectRepository; url: string; close: () => Promise<void> }> {
  const repository = new MemoryProjectRepository(projectId, buildReadyState(projectId));
  const runtime = new WorkspaceRuntime(repository);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    runtime,
    repository,
    url,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

describe("Audit 6 batch 6: provenance preview, confirm and dashboard (server)", () => {
  it("serves a provenance preview with fingerprint and separated hashes", async () => {
    const { url, close } = await startServer("batch6-server-preview");
    try {
      const res = await fetch(`${url}/workspace/publish/provenance/preview`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(true);
      expect(typeof body.fingerprint).toBe("string");
      expect(typeof body.build_snapshot_hash).toBe("string");
      expect(body.composition).toBeDefined();
      expect(body.composition.build_snapshot_hash).toBe(body.build_snapshot_hash);
      expect(body.composition.compiled_content_hash).toBeUndefined();
      expect(Array.isArray(body.historical_decisions)).toBe(true);
    } finally {
      await close();
    }
  });

  it("confirms a publish that persists the same immutable refs", async () => {
    const { repository, url, close } = await startServer("batch6-server-confirm");
    try {
      const previewRes = await fetch(`${url}/workspace/publish/provenance/preview`);
      const preview = await previewRes.json();
      const confirmRes = await fetch(`${url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint, idempotency_key: "confirm-server-1" }),
      });
      expect(confirmRes.status).toBe(200);
      const result = await confirmRes.json();
      expect(result.status).toBe("completed");

      const state = await repository.read();
      expect(state.publishes).toHaveLength(1);
      const publish = state.publishes[0]!;
      expect(publish.provenance_summary?.build_snapshot_hash).toBe(preview.build_snapshot_hash);
      expect(publish.provenance_summary?.compiled_content_hash).toBe(publish.content_hash);
      const audit = state.audit.find((item) => item.event === "publish.committed");
      expect(audit?.details.confirmation_fingerprint).toBe(preview.fingerprint);
      expect(audit?.details.build_snapshot_hash).toBe(preview.build_snapshot_hash);
      expect(audit?.details.compiled_content_hash).toBe(publish.content_hash);
      expect(audit?.details.publish_id).toBe(publish.id);
    } finally {
      await close();
    }
  });

  it("rejects a stale confirmation with PROVENANCE_CONFIRMATION_STALE and no publish record", async () => {
    const { repository, url, close } = await startServer("batch6-server-stale");
    try {
      const previewRes = await fetch(`${url}/workspace/publish/provenance/preview`);
      const preview = await previewRes.json();
      const state = await repository.read();
      await repository.commit(state.revision, (current) => ({
        ...current,
        artifacts: current.artifacts.map((item) => (item.kind === "character" ? { ...item, content_hash: contentHash("changed-v2") } : item)),
      }));
      const confirmRes = await fetch(`${url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint }),
      });
      expect(confirmRes.status).toBe(400);
      const body = await confirmRes.json();
      expect(body.code).toBe("PROVENANCE_CONFIRMATION_STALE");
      const after = await repository.read();
      expect(after.publishes).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it("replays the same idempotency key without a second publish record", async () => {
    const { repository, url, close } = await startServer("batch6-server-replay");
    try {
      const previewRes = await fetch(`${url}/workspace/publish/provenance/preview`);
      const preview = await previewRes.json();
      const body = JSON.stringify({ fingerprint: preview.fingerprint, idempotency_key: "confirm-replay" });
      const first = await (await fetch(`${url}/workspace/publish/provenance/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body })).json();
      const second = await (await fetch(`${url}/workspace/publish/provenance/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body })).json();
      expect(first.status).toBe("completed");
      expect(second.operation_id).toBe(first.operation_id);
      const state = await repository.read();
      expect(state.publishes).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("serves dashboard provenance after confirmation", async () => {
    const { repository, url, close } = await startServer("batch6-server-dashboard");
    try {
      const previewRes = await fetch(`${url}/workspace/publish/provenance/preview`);
      const preview = await previewRes.json();
      await fetch(`${url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: preview.fingerprint }),
      });
      const res = await fetch(`${url}/workspace/dashboard/provenance`);
      expect(res.status).toBe(200);
      const view = await res.json();
      expect(view.build_id).toBeDefined();
      expect(view.legacy_build_snapshot_hash).toBe(false);
      expect(view.compiled_content_hash).toBeDefined();
      expect(view.build_snapshot_hash).toBe(preview.build_snapshot_hash);
      expect(Array.isArray(view.historical_decisions)).toBe(true);
      const state = await repository.read();
      expect(view.provenance_summary.build_snapshot_hash).toBe(state.publishes[0]!.provenance_summary!.build_snapshot_hash);
    } finally {
      await close();
    }
  });

  it("keeps dashboard HTML safe and integrates provenance confirmation UI", () => {
    const html = dashboard();
    expect(html).toContain("準備發布確認");
    expect(html).toContain("確認並發布");
    expect(html).toContain("id=\"confirm-publish\"");
    expect(html).toContain("id=\"provenance-history\"");
    expect(html).toContain("id=\"provenance-confirm-message\"");
    expect(html).toContain("/workspace/publish/provenance/preview");
    expect(html).toContain("/workspace/publish/provenance/confirm");
    expect(html).toContain("/workspace/dashboard/provenance");
    expect(html).toContain("textContent");
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("Coverage 角色設定覆蓋");
    expect(html).toContain("/workspace/dashboard/coverage");
    expect(html).toContain("來源適配工作流程");
    expect(html).toContain("/workspace/dashboard/workflow");
  });
});
