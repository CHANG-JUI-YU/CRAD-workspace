import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileAttachmentStore,
  FileProjectRepository,
  MemoryProjectRepository,
  contentHash,
  type ArtifactRecord,
  type BlueprintPrecheckRecord,
  type FactReviewDecisionRecord,
  type FactReviewRunRecord,
  type FactRecord,
  type OperationRecord,
  type SourceRecord,
} from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const now = "2026-08-15T00:00:00.000Z";

function sourceRecord(id: string, text: string): SourceRecord {
  return {
    id,
    candidate_id: `cand-${id}`,
    title: text.slice(0, 24),
    canonical_text: text,
    original_hash: contentHash(text),
    revision: contentHash(text),
    media_type: "text/plain",
    provenance_kind: "external_source",
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
      flow: "source_adaptation",
      collaboration_mode: "assisted",
      characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }],
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
  const content = JSON.stringify({ kind: "blueprint", characters: [{ id: "alpha", label: "Alpha", ordinal: 1, mode: "zhuji" }], primary_character_id: "alpha" });
  return {
    id: "blueprint-1",
    key: `blueprint:${projectId}`,
    kind: "blueprint",
    name: "Blueprint",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash("blueprint-1"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "director",
    operation_id: "op-precheck",
    blueprint_precheck_id: "precheck-1",
  };
}

function characterArtifact(): ArtifactRecord {
  const content = JSON.stringify({ kind: "character", document: { schema_version: 1, id: "alpha", display_name: "Alpha" } });
  return {
    id: "character-alpha",
    key: "character:alpha",
    kind: "character",
    name: "Alpha",
    content,
    media_type: "application/json",
    content_hash: contentHash(content),
    revision: contentHash("character-alpha"),
    status: "draft",
    created_at: now,
    updated_at: now,
    created_by: "writer",
    operation_id: "op-author",
    blueprint_precheck_id: "precheck-1",
    blueprint_precheck_revision: contentHash("blueprint-1"),
  };
}

function fact(): FactRecord {
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
    evidence_refs: [{ source_id: "source-1", source_revision_id: contentHash("Alpha is calm."), quote: "Alpha is calm." }],
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

function reviewRun(): FactReviewRunRecord {
  return {
    schema_version: 1,
    id: "run-1",
    candidate_set_revision: contentHash("cset-1"),
    candidate_occurrence_ids: ["occ-1"],
    source_revisions: [{ source_id: "source-1", revision: contentHash("Alpha is calm.") }],
    policy_revision: contentHash("policy-1"),
    status: "completed",
    created_by: "director",
    created_at: now,
    completed_at: now,
  };
}

function decision(): FactReviewDecisionRecord {
  return {
    schema_version: 1,
    id: "dec-1",
    operation_id: "op-review",
    review_run_id: "run-1",
    candidate_occurrence_id: "occ-1",
    fact_id: "fact-acc",
    decision: "accepted",
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
    status: "running",
    created_at: now,
    updated_at: now,
    progress: [],
  };
}

function attachment(name: string, text: string, mediaType?: string) {
  return {
    name,
    content: new TextEncoder().encode(text),
    ...(mediaType === undefined ? {} : { media_type: mediaType }),
  };
}

async function baseState(repository: MemoryProjectRepository | FileProjectRepository, projectId: string): Promise<void> {
  await repository.commit(0, (state) => ({
    ...state,
    project_status: "ready",
    interview: { schema_version: 1, flow: "source_adaptation", status: "complete", values: {}, answers: [] },
    blueprint_prechecks: [precheck(projectId)],
    artifacts: [blueprintArtifact(projectId), characterArtifact()],
    sources: [sourceRecord("source-1", "Alpha is calm.")],
    facts: [fact()],
    operations: [operation("op-precheck", "interview"), operation("op-review", "review")],
  }));
  await repository.commit(1, (state) => ({
    ...state,
    fact_review_runs: [reviewRun()],
    fact_review_decisions: [decision()],
  }));
}

async function baseRuntime(projectId = "batch8-runtime", attachmentStore?: FileAttachmentStore | undefined) {
  const repository = new MemoryProjectRepository(projectId);
  await baseState(repository, projectId);
  const runtime = attachmentStore === undefined ? new WorkspaceRuntime(repository) : new WorkspaceRuntime(repository, { attachmentStore });
  const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };
  return { runtime, repository, formal };
}

function supplementInput(formal: { id: string; revision: string }, overrides: Record<string, unknown> = {}) {
  return {
    assessment_id: formal.id,
    assessment_revision: formal.revision,
    requirement_id: "req.personality",
    character_id: "alpha",
    choice: "補充性格設定",
    rationale: "由創作者補充性格資料",
    text: "補充文字內容",
    operation_id: "op-supp-1",
    ...overrides,
  };
}

describe("#103 immutable coverage command identity", () => {
  it("replays a completed operation when the same command is resubmitted", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-same");
    const input = supplementInput(formal.assessment);
    const first = await runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []);
    expect(first.status).toBe("completed");
    const replay = await runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []);
    expect((replay as { replayed?: boolean }).replayed).toBe(true);
    const state = await repository.read();
    expect(state.operations.filter((op) => op.id === "op-supp-1")).toHaveLength(1);
    expect(state.coverage_user_decisions).toHaveLength(1);
  });

  it("rejects a changed field on a completed operation with OPERATION_COMMAND_MISMATCH", async () => {
    const { runtime, formal } = await baseRuntime("batch8-mismatch");
    const input = supplementInput(formal.assessment);
    const first = await runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []);
    expect(first.status).toBe("completed");

    let caught: { code?: string; message?: string } | undefined;
    try {
      await runtime.coverageSupplement("director", { ...input, text: "其他補充內容", url: undefined, attachments: undefined }, []);
    } catch (error) {
      caught = error as { code?: string; message?: string };
    }
    expect(caught?.code).toBe("OPERATION_COMMAND_MISMATCH");
    expect(caught?.message).toContain("op-supp-1");
  });

  it("rejects changed assessment, requirement, task, action, url and query fields", async () => {
    const { runtime, formal } = await baseRuntime("batch8-fields");
    const base = supplementInput(formal.assessment);
    await runtime.coverageSupplement("director", { ...base, url: undefined, attachments: undefined }, []);
    const variants = [
      { assessment_id: "assess-other" },
      { assessment_revision: "rev-other" },
      { requirement_id: "req.identity" },
      { requirement_id: undefined },
      { character_id: undefined },
      { choice: "其他選擇" },
      { rationale: "其他理由" },
    ];
    for (const variant of variants) {
      let caught: { code?: string } | undefined;
      try {
        await runtime.coverageSupplement("director", { ...base, ...variant, url: undefined, attachments: undefined }, []);
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught?.code, JSON.stringify(variant)).toBe("OPERATION_COMMAND_MISMATCH");
    }
  });

  it("allows a retry of a failed operation only with the identical command", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-failed");
    const state = await repository.read();
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [...current.operations, { ...operation("op-supp-failed", "knowledge"), id: "op-supp-failed", request: "coverage_supplement", status: "failed" as const }],
    }));
    const input = supplementInput(formal.assessment);
    const first = await runtime.coverageSupplement("director", { ...input, operation_id: "op-supp-failed", url: undefined, attachments: undefined }, []);
    expect(first.status).toBe("completed");
    expect(first.operation_id).toBe("op-supp-failed");

    let caught: { code?: string } | undefined;
    try {
      await runtime.coverageSupplement("director", { ...input, operation_id: "op-supp-failed", text: "不同內容", url: undefined, attachments: undefined }, []);
    } catch (error) {
      caught = error as { code?: string };
    }
    expect(caught?.code).toBe("OPERATION_COMMAND_MISMATCH");
  });

  it("keeps the identity immutable for needs_input and cancelled operations", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-states");
    const state = await repository.read();
    const legacyPayload = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      choice: "補充性格設定",
      rationale: "由創作者補充性格資料",
      text: "補充文字內容",
    };
    await repository.commit(state.revision, (current) => ({
      ...current,
      operations: [
        ...current.operations,
        { ...operation("op-needs-input", "knowledge"), id: "op-needs-input", request: "coverage_supplement", status: "needs_input" as const, question: "question", command: { version: 1, type: "coverage_supplement", payload: legacyPayload } },
        { ...operation("op-cancelled", "knowledge"), id: "op-cancelled", request: "coverage_supplement", status: "cancelled" as const, command: { version: 1, type: "coverage_supplement", payload: legacyPayload } },
      ],
    }));
    const input = supplementInput(formal.assessment);
    const needsReplay = await runtime.coverageSupplement("director", { ...input, operation_id: "op-needs-input", url: undefined, attachments: undefined }, []);
    expect((needsReplay as { replayed?: boolean }).replayed).toBe(true);
    const cancelledReplay = await runtime.coverageSupplement("director", { ...input, operation_id: "op-cancelled", url: undefined, attachments: undefined }, []);
    expect((cancelledReplay as { replayed?: boolean }).replayed).toBe(true);

    let caught: { code?: string } | undefined;
    try {
      await runtime.coverageSupplement("director", { ...input, operation_id: "op-needs-input", rationale: "不同理由", url: undefined, attachments: undefined }, []);
    } catch (error) {
      caught = error as { code?: string };
    }
    expect(caught?.code).toBe("OPERATION_COMMAND_MISMATCH");
  });

  it("rejects attachment changes (name, media type and content bytes)", async () => {
    const { runtime, formal } = await baseRuntime("batch8-attachments");
    const input = supplementInput(formal.assessment);
    await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一", "text/plain")]);

    const variants: Array<Array<{ name: string; content: Uint8Array; media_type?: string }>> = [
      [attachment("renamed.txt", "補充一", "text/plain")],
      [attachment("note.txt", "補充一", "application/json")],
      [attachment("note.txt", "補充二", "text/plain")],
      [attachment("note.txt", "補充一", "text/plain"), attachment("extra.txt", "額外")],
      [],
    ];
    for (const variant of variants) {
      let caught: { code?: string } | undefined;
      try {
        await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, variant);
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught?.code).toBe("OPERATION_COMMAND_MISMATCH");
    }
  });

  it("rejects changes to task, batch and recovery action fields", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-recover");
    const state = await repository.read();
    const reqSet = state.coverage_requirement_sets.at(-1);
    expect(reqSet).toBeDefined();
    await repository.commit(state.revision, (current) => ({
      ...current,
      coverage_research_batches: [{ id: "batch-1", assessment_id: formal.assessment.id, assessment_revision: formal.assessment.revision, requirement_set_id: reqSet!.id, requirement_set_revision: reqSet!.revision, status: "open", task_ids: ["task-1"], created_by: "director", created_at: now }],
      coverage_research_tasks: [{ id: "task-1", batch_id: "batch-1", character_id: "alpha", requirement_ids: ["req.personality"], dimension_paths: ["personality"], query_seeds: ["alpha"], status: "exhausted", claim_generation: 1, attempt: 1, searched_queries: [], source_families: [], exhausted_reason: "manual", created_at: now, updated_at: now }],
    }));
    const base = { task_id: "task-1", action: "revise_query", query_seeds: ["alpha"], operation_id: "op-recover-1" };
    const first = await runtime.coverageResearchRecover("director", { ...base, attachments: undefined }, []);
    expect(first.status).toBe("completed");
    for (const variant of [{ task_id: "task-2" }, { action: "revise_constraints" as const }, { query_seeds: ["beta"] }]) {
      let caught: { code?: string } | undefined;
      try {
        await runtime.coverageResearchRecover("director", { ...base, ...variant, attachments: undefined }, []);
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught?.code, JSON.stringify(variant)).toBe("OPERATION_COMMAND_MISMATCH");
    }
  });

  it("handles concurrent identical commands without double success", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-concurrent-same");
    const input = supplementInput(formal.assessment);
    const [first, second] = await Promise.allSettled([
      runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []),
      runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []),
    ]);
    expect(first.status).toBe("fulfilled");
    expect((first as PromiseFulfilledResult<{ status: string }>).value.status).toBe("completed");
    if (second.status === "rejected") {
      expect((second as PromiseRejectedResult).reason).toMatchObject({ code: "REVISION_CONFLICT" });
    } else {
      expect((second as PromiseFulfilledResult<{ replayed?: boolean }>).value.replayed).toBe(true);
    }
    const state = await repository.read();
    expect(state.operations.filter((op) => op.id === "op-supp-1")).toHaveLength(1);
    expect(state.coverage_user_decisions).toHaveLength(1);
  });

  it("handles concurrent different commands with a single winner", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-concurrent-diff");
    const input = supplementInput(formal.assessment);
    const changed = { ...input, text: "競爭補充內容" };
    const [first, second] = await Promise.allSettled([
      runtime.coverageSupplement("director", { ...input, url: undefined, attachments: undefined }, []),
      runtime.coverageSupplement("director", { ...changed, url: undefined, attachments: undefined }, []),
    ]);
    const fulfilled = [first, second].filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const state = await repository.read();
    expect(state.operations.filter((op) => op.id === "op-supp-1")).toHaveLength(1);
    expect(state.coverage_user_decisions).toHaveLength(1);
  });

  it("reconstructs the identity of a legacy operation without attachments and fails closed with attachments", async () => {
    const { runtime, repository, formal } = await baseRuntime("batch8-legacy");
    const state = await repository.read();
    const legacyPayload = {
      assessment_id: formal.assessment.id,
      assessment_revision: formal.assessment.revision,
      requirement_id: "req.personality",
      character_id: "alpha",
      choice: "補充性格設定",
      rationale: "由創作者補充性格資料",
      text: "補充文字內容",
    };
    const legacyNoRefs = {
      ...operation("op-legacy-plain", "knowledge"),
      id: "op-legacy-plain",
      request: "coverage_supplement",
      status: "completed" as const,
      result_summary: "done",
      command: { version: 1, type: "coverage_supplement", payload: legacyPayload },
    };
    const legacyWithRefs = {
      ...operation("op-legacy-refs", "knowledge"),
      id: "op-legacy-refs",
      request: "coverage_supplement",
      status: "completed" as const,
      result_summary: "done",
      command: { version: 1, type: "coverage_supplement", payload: { ...legacyPayload, attachment_refs: [{ id: "old-id", name: "note.txt" }] } },
    };
    await repository.commit(state.revision, (current) => ({ ...current, operations: [...current.operations, legacyNoRefs, legacyWithRefs] }));

    const samePayload = await runtime.coverageSupplement("director", { ...supplementInput(formal.assessment), operation_id: "op-legacy-plain", url: undefined, attachments: undefined }, []);
    expect((samePayload as { replayed?: boolean }).replayed).toBe(true);

    let changed: { code?: string } | undefined;
    try {
      await runtime.coverageSupplement("director", { ...supplementInput(formal.assessment), operation_id: "op-legacy-plain", text: "不同內容", url: undefined, attachments: undefined }, []);
    } catch (error) {
      changed = error as { code?: string };
    }
    expect(changed?.code).toBe("OPERATION_COMMAND_MISMATCH");

    let withRefs: { code?: string } | undefined;
    try {
      await runtime.coverageSupplement("director", { ...supplementInput(formal.assessment), operation_id: "op-legacy-refs", url: undefined, attachments: undefined }, []);
    } catch (error) {
      withRefs = error as { code?: string };
    }
    expect(withRefs?.code).toBe("OPERATION_COMMAND_MISMATCH");
    expect(withRefs?.message).toContain("new operation id");
  });
});

describe("#104 transactional attachment staging", () => {
  async function fileRuntime(projectId: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), "st-workspace-v3-a8b2-"));
    const repository = new FileProjectRepository(root, projectId, { layout: "project", materialize: true });
    await baseState(repository, projectId);
    const attachmentStore = new FileAttachmentStore(repository);
    const runtime = new WorkspaceRuntime(repository, { attachmentStore });
    const formal = (await runtime.coverageAssessment("formal")) as { assessment: { id: string; revision: string } };
    return { runtime, repository, attachmentStore, formal, root };
  }

  it("does not create new files when a completed command is replayed", async () => {
    const { runtime, repository, attachmentStore, formal, root } = await fileRuntime("a8b2-replay");
    try {
      const input = supplementInput(formal.assessment);
      const first = await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      expect(first.status).toBe("completed");
      const state = await repository.read();
      const op = state.operations.find((item) => item.id === "op-supp-1");
      const refs = op?.command ? ((op.command as { attachment_refs?: unknown[] }).attachment_refs ?? []) : [];
      const before = await attachmentStore.listOperationFiles("op-supp-1");

      const replay = await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      expect((replay as { replayed?: boolean }).replayed).toBe(true);
      const after = await attachmentStore.listOperationFiles("op-supp-1");
      expect(after.sort()).toEqual(before.sort());
      expect(after).toHaveLength(refs.length);
      expect(await attachmentStore.listStagedSessions()).toHaveLength(0);
      const loaded = await attachmentStore.load("op-supp-1", refs as never[]);
      expect(new TextDecoder().decode(loaded[0]?.content)).toBe("補充一");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses the same content-addressed refs on retry and replay", async () => {
    const { runtime, repository, formal, root } = await fileRuntime("a8b2-refs");
    try {
      const input = supplementInput(formal.assessment);
      const first = await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      expect(first.status).toBe("completed");
      const state1 = await repository.read();
      const refs1 = (state1.operations.find((item) => item.id === "op-supp-1")?.command as { attachment_refs?: Array<{ id: string; content_hash?: string }> }).attachment_refs ?? [];
      expect(refs1).toHaveLength(1);
      expect(refs1[0]?.id).toBe(contentHash(new TextEncoder().encode("補充一")));
      expect(refs1[0]?.content_hash).toBe(refs1[0]?.id);

      await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      const state2 = await repository.read();
      const refs2 = (state2.operations.find((item) => item.id === "op-supp-1")?.command as { attachment_refs?: Array<{ id: string }> }).attachment_refs ?? [];
      expect(refs2[0]?.id).toBe(refs1[0]?.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves no staged or permanent files when the assessment is stale", async () => {
    const { runtime, repository, attachmentStore, formal, root } = await fileRuntime("a8b2-stale");
    try {
      const input = supplementInput(formal.assessment);
      const first = await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      expect(first.status).toBe("completed");
      const state = await repository.read();
      await repository.commit(state.revision, (current) => ({ ...current, sources: [sourceRecord("source-1", "Alpha is serene and calm.")] }));

      let caught: { code?: string } | undefined;
      try {
        await runtime.coverageSupplement("director", { ...input, operation_id: "op-supp-stale", url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught?.code).toBe("COVERAGE_ASSESSMENT_STALE");
      expect(await attachmentStore.listStagedSessions()).toHaveLength(0);
      const opFiles = await attachmentStore.listOperationFiles("op-supp-1");
      expect(opFiles).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans up staging when the repository commit conflicts", async () => {
    const { runtime, attachmentStore, formal, root } = await fileRuntime("a8b2-conflict");
    try {
      const input = supplementInput(formal.assessment);
      const results = await Promise.allSettled([
        runtime.coverageSupplement("director", { ...input, operation_id: "op-supp-conflict", url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]),
        runtime.coverageSupplement("director", { ...input, operation_id: "op-supp-conflict", url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]),
      ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const completed = fulfilled.filter((result) => (result as PromiseFulfilledResult<{ replayed?: boolean }>).value.replayed !== true);
    expect(completed).toHaveLength(1);
    const replayed = fulfilled.filter((result) => (result as PromiseFulfilledResult<{ replayed?: boolean }>).value.replayed === true);
    expect(replayed.length).toBeLessThanOrEqual(1);
    expect(await attachmentStore.listStagedSessions()).toHaveLength(0);
      const opFiles = await attachmentStore.listOperationFiles("op-supp-conflict");
      expect(opFiles).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leave files behind when the command is invalid", async () => {
    const { runtime, attachmentStore, formal, root } = await fileRuntime("a8b2-invalid");
    try {
      let caught: { code?: string } | undefined;
      try {
        await runtime.coverageSupplement("director", { ...supplementInput(formal.assessment), operation_id: "op-supp-empty", url: undefined, text: undefined, attachments: undefined }, []);
      } catch (error) {
        caught = error as { code?: string };
      }
      expect(caught).toBeDefined();
      expect(await attachmentStore.listStagedSessions()).toHaveLength(0);
      expect(await attachmentStore.listOperationFiles("op-supp-empty")).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("inspects operation files and never cleans referenced attachments", async () => {
    const { runtime, repository, attachmentStore, formal, root } = await fileRuntime("a8b2-orphan");
    try {
      const input = supplementInput(formal.assessment);
      await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      const state = await repository.read();
      const refs = (state.operations.find((item) => item.id === "op-supp-1")?.command as { attachment_refs?: Array<{ id: string }> }).attachment_refs ?? [];
      const files = await attachmentStore.listOperationFiles("op-supp-1");
      expect(files).toEqual(refs.map((ref) => ref.id));
      const loaded = await attachmentStore.load("op-supp-1", refs as never[]);
      expect(new TextDecoder().decode(loaded[0]?.content)).toBe("補充一");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps staging confined to the project attachment root", async () => {
    const { runtime, repository, formal, root } = await fileRuntime("a8b2-confinement");
    try {
      const input = supplementInput(formal.assessment);
      const first = await runtime.coverageSupplement("director", { ...input, url: undefined, text: undefined, attachments: undefined }, [attachment("note.txt", "補充一")]);
      expect(first.status).toBe("completed");
      const attachmentRoot = path.join(root, "a8b2-confinement", ".workspace", "attachments");
      const entries = await readdir(path.join(attachmentRoot, "op-supp-1"));
      expect(entries).toHaveLength(1);
      void repository;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
