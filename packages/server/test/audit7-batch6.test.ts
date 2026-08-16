import { describe, expect, it } from "vitest";
import {
  authoringBindingHash,
  computeProjectProjection,
  contentHash,
  coverageFactProjectionRevision,
  MemoryProjectRepository,
  type ArtifactRecord,
  type OperationRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "@st-workspace/runtime";
import { createWorkspaceServer } from "../src/index.js";

const now = "2026-08-14T00:00:00.000Z";
const ZHUJI_MODULES = ["appearance", "inner_nature", "extension", "trait_refinement", "trait_dialogue", "scene_dialogue", "self_introduction"];

const CHARACTERS = [
  { id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" },
] as const;

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  return { id, kind, request: `${id} request`, actor: "director", status: "completed", created_at: now, updated_at: now, progress: [] };
}

function characterArtifact(id: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "character", document: { schema_version: 1, id, display_name: "Alpha", aliases: [], summary: "A character.", relationships: [], sections: [{ id: "personality", title: "Personality", content: "Calm.", provenance: [], extensions: {} }], provenance: [], extensions: {} } });
  return { id: `character-${id}`, key: `character:${id}`, kind: "character", name: id, content, media_type: "text/markdown", content_hash: contentHash(content), revision: contentHash(`character-${id}`), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function greetingArtifact(): ArtifactRecord {
  const content = JSON.stringify({ kind: "greeting", document: { schema_version: 1, greetings: [{ kind: "primary", content: "Hello.", character_ids: ["alpha"] }] } });
  return { id: "greeting-alpha", key: "greeting:alpha", kind: "greeting", name: "Greeting", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash("greeting-alpha"), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function modeArtifact(projectId: string, kind: "zhuji" | "palette", characterId: string, module: string): ArtifactRecord {
  const content = JSON.stringify({ kind, character_id: characterId, module: { schema_version: 1, mode: kind, module, title: module, data: {} } });
  return { id: `${kind}-${module}`, key: `${kind}:${characterId}/${module}`, kind, name: module, content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash(`${kind}-${module}`), status: "draft", created_at: now, updated_at: now, created_by: "writer", operation_id: "op-author", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function precheck(projectId: string): unknown {
  return {
    id: "precheck-1",
    schema_version: 1,
    project_id: projectId,
    operation_id: "op-precheck",
    collaboration_mode: "assisted",
    candidate_blueprint: { schema_version: 1, flow: "source_adaptation", characters: CHARACTERS, primary_character_id: "alpha", export_modes: "zhuji" },
    candidate_blueprint_revision: contentHash("blueprint-1"),
    checks: CHARACTERS.map((character) => ({ subject_id: character.id, dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" })),
    status: "recorded" as const,
    created_at: now,
    created_by: "director",
  };
}

function blueprintArtifact(projectId: string): ArtifactRecord {
  const content = JSON.stringify({ kind: "blueprint", project_id: projectId, primary_character_id: "alpha" });
  return { id: "blueprint-1", key: `blueprint:${projectId}`, kind: "blueprint", name: "Blueprint", content, media_type: "application/json", content_hash: contentHash(content), revision: contentHash("blueprint-1"), status: "draft", created_at: now, updated_at: now, created_by: "director", operation_id: "op-precheck", blueprint_precheck_id: "precheck-1", blueprint_precheck_revision: contentHash("blueprint-1") };
}

function fact(): unknown {
  return {
    id: "fact-acc",
    statement: "Alpha is calm and direct.",
    subject: "alpha",
    classification: "trait",
    entity_refs: ["alpha"],
    coverage_targets: ["req.personality"],
    confidence: 0.9,
    source_ids: ["source-1"],
    evidence: ["Alpha is calm."],
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
    status: "accepted",
    fact_revision: 1,
    accepted_fact_revision: contentHash("accepted-1"),
    candidate_occurrence_id: "occ-1",
    review_run_id: "run-1",
    decision_id: "dec-1",
    created_at: now,
    updated_at: now,
    created_by: "reviewer",
  };
}

function reviewRun(): unknown {
  return { id: "run-1", schema_version: 1, curation_run_id: "cset-1", candidate_set_revision: "cset-1", candidate_occurrence_ids: ["occ-1"], source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }], policy_revision: "policy-1", status: "completed", created_by: "reviewer", created_at: now, completed_at: now };
}

function acceptedDecision(): unknown {
  return { id: "dec-1", schema_version: 1, operation_id: "op-review", review_run_id: "run-1", candidate_occurrence_id: "occ-1", fact_id: "fact-acc", decision: "accepted", reviewer_identity: "reviewer", reason: "proven", evidence: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }], candidate_revision: "cand-1", expected_projection_revision: contentHash("projection-1"), resulting_fact_revision: 1, created_at: now };
}

async function readyState(projectId: string) {
  const repository = new MemoryProjectRepository(projectId);
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { ...state.interview, flow: "source_adaptation", status: "complete" },
    blueprint_prechecks: [precheck(projectId) as any],
    artifacts: [
      blueprintArtifact(projectId),
      characterArtifact("alpha"),
      greetingArtifact(),
      ...ZHUJI_MODULES.map((m) => modeArtifact(projectId, "zhuji", "alpha", m)),
    ],
    sources: [{ id: "source-1", candidate_id: "cand-1", title: "Alpha's story", canonical_text: "Alpha is calm.", original_hash: contentHash("Alpha is calm."), revision: contentHash("Alpha is calm."), media_type: "text/plain", created_at: now }],
    facts: [fact() as any],
    fact_review_runs: [reviewRun() as any],
    fact_review_decisions: [acceptedDecision() as any],
    operations: [operation("op-precheck", "interview"), operation("op-review", "knowledge")],
  }));
  return repository.read();
}

async function healthyRuntime(projectId: string): Promise<{ runtime: WorkspaceRuntime; repository: MemoryProjectRepository }> {
  const initial = await readyState(projectId);
  const repository = new MemoryProjectRepository(projectId, initial);
  const runtime = new WorkspaceRuntime(repository);
  await runtime.coverageAssessment("formal");
  const state = await repository.read();
  const assessment = state.coverage_assessments.at(-1);
  await repository.commit(state.revision, (current) => ({
    ...current,
    coverage_assessments: (current.coverage_assessments ?? []).map((item) => (item.id === assessment?.id ? { ...item, items: (item.items ?? []).map((cell) => ({ ...cell, status: "covered_by_source" as const, accepted_fact_ids: ["fact-acc"] })) } : item)),
  }));
  const ready = await repository.read();
  const plan = computeProjectProjection(ready).publishPlan();
  const bindings = ready.artifacts.filter((item) => item.kind !== "blueprint").map((artifact) => ({
    id: `binding-${artifact.id}`,
    artifact_id: artifact.id,
    artifact_revision: artifact.revision,
    assessment_id: assessment?.id ?? "assess-1",
    assessment_revision: assessment?.revision ?? "rev-1",
    requirement_set_revision: assessment?.requirement_set_revision ?? "set-rev-1",
    fact_projection_revision: coverageFactProjectionRevision(ready),
    fact_review_run_id: "run-1",
    resolution_ids: [],
    input_snapshot_hash: authoringBindingHash({ artifact_id: artifact.id, artifact_revision: artifact.revision, assessment_id: assessment?.id ?? "assess-1", assessment_revision: assessment?.revision ?? "rev-1", requirement_set_revision: assessment?.requirement_set_revision ?? "set-rev-1", fact_projection_revision: coverageFactProjectionRevision(ready), fact_review_run_id: "run-1", resolution_ids: [] }),
    created_by: "director",
    created_at: now,
  }));
  const artifactIds = plan.entries.map((entry) => entry.artifact_id);
  await repository.commit(ready.revision, (current) => ({
    ...current,
    coverage_authoring_bindings: bindings,
    builds: [{ id: "build-1", operation_id: "op-preview", status: "previewed" as const, artifact_ids: artifactIds, content_hash: contentHash("build-1"), diagnostics: [], created_at: now }],
    reviews: current.artifacts.filter((item) => item.kind !== "blueprint").map((item) => ({ id: `review-${item.id}`, artifact_id: item.id, artifact_revision: item.revision, reviewer: "reviewer", status: "passed" as const, issue_ids: [], created_at: now })),
  }));
  return { runtime, repository };
}

async function startServer(projectId: string): Promise<{ url: string; runtime: WorkspaceRuntime; repository: MemoryProjectRepository; close: () => Promise<void> }> {
  const { runtime, repository } = await healthyRuntime(projectId);
  const server = createWorkspaceServer({ runtime, actor: "director", autoStartWorker: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    runtime,
    repository,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Audit 7 Batch 6 - Server Routes & HTTP Idempotency (#77, #92, #100)", () => {
  it("POST /workspace/publish/provenance/confirm returns full metadata on first call and identical metadata on replay", async () => {
    const server = await startServer("server-batch6-test-1");
    try {
      const previewRes = await fetch(`${server.url}/workspace/publish/provenance/preview`);
      expect(previewRes.status).toBe(200);
      const preview = await previewRes.json() as { available: boolean; fingerprint: string };
      expect(preview.available).toBe(true);

      const idempotencyKey = "server-key-1";
      const confirmRes = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: preview.fingerprint,
          idempotency_key: idempotencyKey,
        }),
      });

      expect(confirmRes.status).toBe(200);
      const confirmBody = await confirmRes.json() as {
        status: string;
        operation_id: string;
        build_id: string;
        publish_id: string;
        published_at: string;
        idempotent_replay: boolean;
      };

      expect(confirmBody.status).toBe("completed");
      expect(confirmBody.build_id).toBeDefined();
      expect(confirmBody.publish_id).toBeDefined();
      expect(confirmBody.published_at).toBeDefined();
      expect(confirmBody.idempotent_replay).toBe(false);

      // Replay request with same body
      const replayRes = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: preview.fingerprint,
          idempotency_key: idempotencyKey,
        }),
      });

      expect(replayRes.status).toBe(200);
      const replayBody = await replayRes.json() as typeof confirmBody;
      expect(replayBody.status).toBe("completed");
      expect(replayBody.idempotent_replay).toBe(true);
      expect(replayBody.operation_id).toBe(confirmBody.operation_id);
      expect(replayBody.build_id).toBe(confirmBody.build_id);
      expect(replayBody.publish_id).toBe(confirmBody.publish_id);
      expect(replayBody.published_at).toBe(confirmBody.published_at);
    } finally {
      await server.close();
    }
  });

  it("POST /workspace/publish/provenance/confirm returns 400 on idempotency conflict", async () => {
    const server = await startServer("server-batch6-test-2");
    try {
      const previewRes = await fetch(`${server.url}/workspace/publish/provenance/preview`);
      const preview = await previewRes.json() as { available: boolean; fingerprint: string };

      const idempotencyKey = "server-key-2";
      await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: preview.fingerprint,
          idempotency_key: idempotencyKey,
        }),
      });

      // Conflict call with different fingerprint
      const conflictRes = await fetch(`${server.url}/workspace/publish/provenance/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: "conflicting-fingerprint",
          idempotency_key: idempotencyKey,
        }),
      });

      expect(conflictRes.status).toBe(400);
      const conflictBody = await conflictRes.json() as { code: string };
      expect(conflictBody.code).toBe("IDEMPOTENCY_CONFLICT");
    } finally {
      await server.close();
    }
  });

  it("#100: dashboard renders provenance confirmation with idempotency key and safe replay UI handling", async () => {
    const server = await startServer("server-batch6-test-3");
    try {
      const htmlRes = await fetch(`${server.url}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();

      // #120: durable server-side publish intent（sessionStorage 自產 key 已移除）
      expect(html).not.toContain("getOrCreateProvenanceIdempotencyKey");
      expect(html).toContain("再次發布");
      expect(html).toContain("in_flight");
      expect(html).toContain("此發布先前已完成，已回傳既有結果（idempotent replay），未建立新輸出。");
      expect(html).toContain("readiness-mode");
    } finally {
      await server.close();
    }
  });
});
