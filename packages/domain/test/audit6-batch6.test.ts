import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, provenanceConfirmationFingerprint, type ArtifactRecord, type OperationRecord } from "@st-workspace/core";
import { BuildService } from "../src/index.js";

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function artifact(operationId: string, content: string): ArtifactRecord {
  const hash = contentHash(content);
  return { id: "artifact-1", key: "character:yukino", kind: "character", name: "Yukino", content, media_type: "text/markdown", content_hash: hash, revision: hash, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "writer", operation_id: operationId };
}

async function readyRepository(projectId: string, buildOperationId = "op-build") {
  const repository = new MemoryProjectRepository(projectId);
  const characterContent = JSON.stringify({
    kind: "character",
    document: {
      schema_version: 1,
      id: "yukino",
      display_name: "雪乃",
      aliases: [],
      summary: "A complete character.",
      relationships: [],
      sections: [{ id: "personality", title: "Personality", content: "Calm and direct.", provenance: [], extensions: {} }],
      provenance: [],
      extensions: {},
    },
  });
  await repository.commit(0, (state) => ({
    ...state,
    project_name: "雪乃",
    artifacts: [artifact("op-author", characterContent)],
    operations: [operation("op-author", "authoring"), operation(buildOperationId, "build")],
  }));
  return repository;
}

describe("#68 build-level provenance confirmation fail closed", () => {
  it("rejects a mismatched confirmation fingerprint without writing a build or publish record", async () => {
    const repository = await readyRepository("b6-domain-reject", "op-preview");
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    expect(afterPreview.builds).toHaveLength(1);
    expect(afterPreview.publishes).toHaveLength(0);

    await repository.commit(afterPreview.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-rejected", "build")] }));
    const rejected = await service.run("op-rejected", "publish current card", "publisher", { expected_provenance_fingerprint: contentHash("wrong-fingerprint") });
    expect(rejected.status).toBe("blocked");
    const afterReject = await repository.read();
    expect(afterReject.builds).toHaveLength(1);
    expect(afterReject.publishes).toHaveLength(0);
    expect(afterReject.operations.find((item) => item.id === "op-rejected")?.status).toBe("blocked");
    const audit = afterReject.audit.filter((item) => item.event === "provenance.confirmation.rejected");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details.expected).toBe(contentHash("wrong-fingerprint"));
    expect(typeof audit[0]?.details.actual).toBe("string");
    expect(typeof audit[0]?.details.build_snapshot_hash).toBe("string");
  });

  it("accepts the correct fingerprint, persists compiled content hash and records confirmation in the audit", async () => {
    const repository = await readyRepository("b6-domain-accept", "op-preview");
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    const previewSummary = afterPreview.builds[0]?.provenance_summary;
    expect(previewSummary).toBeDefined();
    expect(previewSummary?.compiled_content_hash).toBe(afterPreview.builds[0]?.content_hash);
    expect(previewSummary?.build_snapshot_hash).not.toBe(previewSummary?.compiled_content_hash);
    const fingerprint = provenanceConfirmationFingerprint(previewSummary!);

    await repository.commit(afterPreview.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-publish", "build")] }));
    const confirmed = await service.run("op-publish", "publish current card", "publisher", { expected_provenance_fingerprint: fingerprint });
    expect(confirmed.status).toBe("completed");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(1);
    const confirmedAudit = after.audit.filter((item) => item.event === "publish.committed").at(-1);
    expect(confirmedAudit?.details.confirmation_fingerprint).toBe(fingerprint);
    expect(confirmedAudit?.details.build_snapshot_hash).toBe(previewSummary?.build_snapshot_hash);
    expect(confirmedAudit?.details.compiled_content_hash).toBe(after.publishes[0]?.content_hash);
    expect(after.publishes[0]?.provenance_summary?.compiled_content_hash).toBe(after.publishes[0]?.content_hash);
  });

  it("still blocks a stale fingerprint when build inputs change between preview and confirm", async () => {
    const repository = await readyRepository("b6-domain-stale", "op-preview");
    const service = new BuildService(repository);
    await service.run("op-preview", "preview current card", "builder");
    const afterPreview = await repository.read();
    const summary = afterPreview.builds[0]?.provenance_summary;
    const fingerprint = provenanceConfirmationFingerprint(summary!);

    await repository.commit(afterPreview.revision, (state) => ({
      ...state,
      artifacts: state.artifacts.map((item) => (item.id === "artifact-1" ? { ...item, content_hash: contentHash("changed-v2") } : item)),
      operations: [...state.operations, operation("op-stale", "build")],
    }));
    const rejected = await service.run("op-stale", "publish current card", "publisher", { expected_provenance_fingerprint: fingerprint });
    expect(rejected.status).toBe("blocked");
    const after = await repository.read();
    expect(after.publishes).toHaveLength(0);
    expect(after.builds).toHaveLength(1);
    expect(after.audit.some((item) => item.event === "provenance.confirmation.rejected")).toBe(true);
  });
});
