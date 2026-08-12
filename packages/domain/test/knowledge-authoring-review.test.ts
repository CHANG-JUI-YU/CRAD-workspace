import { describe, expect, it } from "vitest";
import {
  MemoryProjectRepository,
  contentHash,
  internalId,
  qualityProfileForLevel,
  type ZhujiProposalValue,
  type FactClaim,
  type FactDecision,
  type FactRecord,
  type OperationRecord,
  type SourceRecord,
  type BlueprintPrecheckRecord,
} from "@st-workspace/core";
import { AuthoringService, KnowledgeService, ReviewService, validateWorkflow } from "../src/index.js";

function operation(id: string, kind: OperationRecord["kind"]): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind, request: kind, status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function zhujiProposal(): ZhujiProposalValue {
  const instant = "這是一段符合語料條件、包含自然標點的角色話語。";
  return {
    kind: "zhuji",
    character_id: "yukino",
    module: {
      schema_version: 1,
      mode: "zhuji",
      module: "trait_dialogue",
      title: "特質對話",
      data: {
        人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
        人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
        扮演關鍵要點: ["先觀察再回答"],
        Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: [instant], Results: ["對話保持角色一致"] })),
      },
    },
  };
}

describe("knowledge, authoring and review services", () => {
  it("refreshes source chunks and traceable fact candidates", async () => {
    const repository = new MemoryProjectRepository("demo");
    const text = "Yukino has_trait direct. Yukino belongs to Sobu High School. Yukino comes from Japan. She values direct and honest conversations.";
    const source: SourceRecord = {
      id: "source-1",
      candidate_id: "candidate-1",
      title: "official",
      canonical_text: text,
      original_hash: contentHash(text),
      revision: contentHash(text),
      media_type: "text/plain",
      created_at: new Date().toISOString(),
    };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-knowledge", "knowledge")] }));
    const result = await new KnowledgeService(repository).refresh("op-knowledge", "整理知識", "curator");
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.knowledge_chunks[0]?.source_id).toBe("source-1");
    expect(state.facts.every((fact) => fact.source_ids.includes("source-1"))).toBe(true);
    expect(state.facts[0]).toMatchObject({ subject: expect.any(String), predicate: expect.any(String), value: expect.any(String), classification: expect.any(String) });
  });

  it("applies structured fact curation and adjudicates by exact id", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-curation", "authoring"), operation("op-fact-review", "review")], sources: [{ id: "source-official", candidate_id: "candidate-official", title: "official page", canonical_text: "Official source text.", original_hash: contentHash("Official source text."), revision: contentHash("Official source text."), media_type: "text/plain", created_at: new Date().toISOString() }] }));
    const claim: FactClaim = {
      subject: "Yukino",
      predicate: "has_trait",
      value: "direct",
      classification: "trait",
      confidence: 0.92,
      coverage: ["character"],
      evidence: [{ source: "official page", quote: "Yukino is direct." }, { source: "unmatched source", quote: "A second quote." }],
    };
    const service = new KnowledgeService(repository);
    const curated = await service.applyCuration("op-curation", [claim], "fact-curator");
    expect(curated.facts).toHaveLength(1);
    const afterCuration = await repository.read();
    const fact = afterCuration.facts[0];
    expect(fact).toMatchObject({ subject: "Yukino", predicate: "has_trait", value: "direct", status: "candidate" });
    expect(fact?.source_ids).toEqual(["source-official"]);
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-curation-duplicate", "authoring")] }));
    expect((await service.applyCuration("op-curation-duplicate", [claim], "fact-curator")).facts).toHaveLength(0);
    const decision: FactDecision = { fact_id: fact!.id, claim: fact!.statement, decision: "accept", reason: "The evidence supports the claim.", evidence: [] };
    const reviewed = await service.applyReview("op-fact-review", [decision], "fact-reviewer-1");
    expect(reviewed.fact_ids).toEqual([fact!.id]);
    expect((await repository.read()).facts[0]?.status).toBe("accepted");
    expect((await repository.read()).audit.at(-1)?.event).toBe("fact.review.applied");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-fact-review-duplicate", "review")] }));
    await expect(service.applyReview("op-fact-review-duplicate", [decision, decision], "fact-reviewer-1")).rejects.toMatchObject({ code: "FACT_REVIEW_TARGET_DUPLICATE" });
  });

  it("uses one fixed Review Run with strict evidence and CAS-safe final decisions", async () => {
    const repository = new MemoryProjectRepository("strict-review");
    const text = "Yukino is direct.";
    const source: SourceRecord = {
      id: "source-strict",
      candidate_id: "candidate-strict",
      title: "official",
      canonical_text: text,
      original_hash: contentHash(text),
      revision: contentHash(text),
      media_type: "text/plain",
      created_at: new Date().toISOString(),
    };
    await repository.commit(0, (state) => ({
      ...state,
      sources: [source],
      operations: [operation("op-refresh-strict", "knowledge"), operation("op-review-strict", "review")],
    }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-strict", "refresh new sources", "fact-curator");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      facts: state.facts.map((fact) => ({ ...fact, coverage: ["character", "personality"] })),
    }));
    // A run is created explicitly, so its projection is stable for all three reviewer identities.
    const run = await service.beginFactReviewRun("op-review-strict", "fact-reviewer-1");
    const context = await service.factReviewContext();
    expect(context.run?.id).toBe(run.id);
    const candidate = context.candidates[0]!;
    const evidence = candidate.evidence_refs?.[0];
    expect(evidence?.chunk_id).toBeDefined();
    const decision: FactDecision = {
      candidate_occurrence_id: candidate.candidate_occurrence_id,
      claim: candidate.statement,
      decision: "accept",
      reason: "The exact sentence appears in the current official source chunk.",
      evidence: [{ source: source.title, quote: candidate.statement }],
    };
    const applied = await service.applyReviewBatch("op-review-strict", [decision], "fact-reviewer-1", "fact-reviewer-1", run.id, context.projection_revision);
    expect(applied.status).toBe("completed");
    const after = await repository.read();
    expect(after.facts.find((fact) => fact.id === candidate.fact_id)).toMatchObject({ status: "accepted", review_run_id: run.id, decision_id: expect.any(String) });
    expect(after.fact_review_decisions).toContainEqual(expect.objectContaining({ review_run_id: run.id, candidate_occurrence_id: candidate.candidate_occurrence_id, reviewer_identity: "fact-reviewer-1", decision: "accepted" }));
    expect(after.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("completed");

    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-review-duplicate-strict", "review")] }));
    const skipped = await service.applyReviewBatch("op-review-duplicate-strict", [decision], "fact-reviewer-2", "fact-reviewer-2", run.id);
    expect(skipped).toMatchObject({ applied: 0, skipped: 1, conflicts: 0, status: "completed" });
  });

  it("blocks an accepted decision when quote-level evidence is missing", async () => {
    const repository = new MemoryProjectRepository("strict-evidence");
    const text = "Yukino is direct.";
    const source: SourceRecord = { id: "source-evidence", candidate_id: "candidate-evidence", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-refresh-evidence", "knowledge"), operation("op-review-evidence", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-evidence", "refresh new sources", "fact-curator");
    const run = await service.beginFactReviewRun("op-review-evidence", "fact-reviewer-2");
    const candidate = (await service.factReviewContext()).candidates[0]!;
    await expect(service.applyReviewBatch("op-review-evidence", [{ candidate_occurrence_id: candidate.candidate_occurrence_id, claim: candidate.statement, decision: "accept", reason: "No quote supplied.", evidence: [] }], "fact-reviewer-2", "fact-reviewer-2", run.id)).rejects.toMatchObject({ code: "FACT_REVIEW_EVIDENCE_INVALID" });
    expect((await repository.read()).facts[0]?.status).toBe("candidate");
  });

  it("rejects ambiguous fact review claims without changing any fact", async () => {
    const repository = new MemoryProjectRepository("demo");
    const timestamp = new Date().toISOString();
    const duplicate = (id: string) => ({ id, statement: "Yukino is calm", subject: "Yukino", predicate: "is", value: "calm", classification: "trait" as const, coverage: [], status: "candidate" as const, confidence: 0.5, source_ids: [], evidence: ["quote"], created_at: timestamp, updated_at: timestamp, created_by: "curator" });
    await repository.commit(0, (state) => ({ ...state, facts: [duplicate("fact-a"), duplicate("fact-b")], operations: [operation("op-ambiguous", "review")] }));
    const service = new KnowledgeService(repository);
    await expect(service.applyReview("op-ambiguous", [{ claim: "Yukino is calm", decision: "accept", reason: "unclear", evidence: [] }], "reviewer")).rejects.toMatchObject({ code: "FACT_REVIEW_TARGET_INVALID" });
    expect((await repository.read()).facts.every((fact) => fact.status === "candidate")).toBe(true);
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-no-match", "review")] }));
    await expect(service.applyReview("op-no-match", [{ claim: "No such fact", decision: "accept", reason: "missing", evidence: [] }], "reviewer")).rejects.toMatchObject({ code: "FACT_REVIEW_TARGET_INVALID" });
  });

  it("maps every fact review decision to its corresponding status", async () => {
    const repository = new MemoryProjectRepository("demo");
    const timestamp = new Date().toISOString();
    const makeFact = (id: string, value: string): FactRecord => ({ id, statement: `Yukino ${value}`, subject: "Yukino", predicate: "has_trait", value, classification: "trait", coverage: [], status: "candidate", confidence: 0.5, source_ids: [], evidence: ["quote"], created_at: timestamp, updated_at: timestamp, created_by: "curator" });
    const legacy: FactRecord = { id: "fact-legacy", statement: "A legacy statement", status: "candidate", confidence: 0.5, source_ids: [], evidence: ["quote"], created_at: timestamp, updated_at: timestamp, created_by: "curator" };
    await repository.commit(0, (state) => ({ ...state, facts: [makeFact("fact-accept", "accept"), makeFact("fact-reject", "reject"), makeFact("fact-conflict", "conflict"), makeFact("fact-needs", "needs"), makeFact("fact-unmatched", "unmatched"), legacy], operations: [operation("op-decisions", "review")] }));
    await new KnowledgeService(repository).applyReview("op-decisions", [
      { fact_id: "fact-accept", claim: "unused", decision: "accept", reason: "supported", evidence: [] },
      { fact_id: "fact-reject", claim: "unused", decision: "reject", reason: "not supported", evidence: [] },
      { fact_id: "fact-conflict", claim: "unused", decision: "conflict", reason: "sources disagree", evidence: [] },
      { fact_id: "fact-needs", claim: "unused", decision: "needs_evidence", reason: "needs a quote", evidence: [{ source: "new source", quote: "pending" }] },
    ], "fact-reviewer-2");
    const state = await repository.read();
    expect(state.facts.map((fact) => fact.status)).toEqual(["accepted", "rejected", "conflict", "candidate", "candidate", "candidate"]);
    expect(state.facts[3]?.evidence).toContain("new source — pending");
  });

  it("refreshes only new sources when requested and asks when none are available", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-empty", "knowledge")], sources: [] }));
    const service = new KnowledgeService(repository);
    expect((await service.refresh("op-empty", "refresh knowledge", "curator")).status).toBe("needs_input");
    const longText = `${"A long sentence about a stable fact. ".repeat(40)} Another fact is here.`;
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      sources: [{ id: "source-new", candidate_id: "candidate-new", title: "new", canonical_text: longText, original_hash: contentHash(longText), revision: contentHash(longText), media_type: "text/plain", created_at: new Date().toISOString() }],
      operations: [...state.operations, operation("op-refresh", "knowledge")],
    }));
    const result = await service.refresh("op-refresh", "refresh new sources", "curator");
    expect(result.chunks.length).toBeGreaterThan(1);
    expect((await repository.read()).facts.length).toBeGreaterThan(0);
  });

  it("creates a revision and does not duplicate identical draft-note content", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "info", PLACEHOLDER_REMAINS: "info" } }, operations: [operation("op-author", "authoring")] }));
    const service = new AuthoringService(repository);
    const request = "Draft note: Create character: Yukino. Personality: calm, direct, and observant.";
    const first = await service.create("op-author", request, "writer");
    expect(first.status).toBe("completed");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-author-2", "authoring")] }));
    const second = await service.create("op-author-2", request, "writer");
    expect(second.summary).toContain("沿用");
    expect((await repository.read()).artifacts).toHaveLength(1);
  });

  it("asks for clarification for unknown or too-short authoring intent", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-unknown", "authoring"), operation("op-short", "authoring")] }));
    const service = new AuthoringService(repository);
    expect((await service.create("op-unknown", "make something", "writer")).status).toBe("needs_input");
    expect((await service.create("op-short", "建立角色", "writer")).status).toBe("needs_input");
    await expect(service.create("missing-authoring", "character content", "writer")).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("requires typed proposals for formal artifact kinds and keeps free text as draft notes", async () => {
    const repository = new MemoryProjectRepository("demo");
    const kinds = ["relationship", "world", "greeting", "blueprint", "palette", "plugin", "character"] as const;
    await repository.commit(0, (state) => ({ ...state, operations: kinds.map((_, index) => operation(`op-kind-${index}`, "authoring")) }));
    const service = new AuthoringService(repository);
    for (const [index, kind] of kinds.entries()) {
      const result = await service.create(`op-kind-${index}`, `${kind} content. This is enough content for the artifact.`, "writer");
      expect(result.status).toBe("needs_input");
    }
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-note", "authoring")] }));
    const note = await service.create("op-note", "筆記：先記錄 Yukino 的設定想法，之後再正式建立角色。", "writer");
    expect(note.status).toBe("completed");
    expect(note.artifact_id).toBeDefined();
    expect((await repository.read()).artifacts).toHaveLength(1);
  });

  it("requires a structured Zhuji proposal and validates it before writing", async () => {
    const repository = new MemoryProjectRepository("demo");
    const precheck: BlueprintPrecheckRecord = {
      id: "precheck-zhuji",
      schema_version: 1,
      project_id: "demo",
      operation_id: "op-interview",
      collaboration_mode: "free",
      candidate_blueprint: { project_id: "demo" },
      candidate_blueprint_revision: contentHash("candidate"),
      checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
      status: "recorded",
      created_at: new Date().toISOString(),
      created_by: "director",
    };
    await repository.commit(0, (state) => ({ ...state, blueprint_prechecks: [precheck], operations: [operation("op-zhuji-text", "authoring"), operation("op-zhuji", "authoring")] }));
    const service = new AuthoringService(repository);
    expect((await service.create("op-zhuji-text", "zhuji content. This is not a module.", "writer")).status).toBe("needs_input");
    const created = await service.createZhuji("op-zhuji", zhujiProposal(), "writer");
    expect(created.status).toBe("completed");
    expect((await repository.read()).artifacts[0]).toMatchObject({ blueprint_precheck_id: precheck.id, blueprint_precheck_revision: precheck.candidate_blueprint_revision });
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-zhuji-same", "authoring")] }));
    expect((await service.createZhuji("op-zhuji-same", zhujiProposal(), "writer")).summary).toContain("沿用");
    expect((await repository.read()).artifacts[0]).toMatchObject({ kind: "zhuji", media_type: "application/json", name: "yukino/trait_dialogue" });
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-zhuji-invalid", "authoring")] }));
    await expect(service.createZhuji("op-zhuji-invalid", { ...zhujiProposal(), module: { ...zhujiProposal().module, module: "bad" } } as never, "writer")).rejects.toMatchObject({ code: "ZHUJI_SCHEMA_INVALID" });
  });

  it("creates a new revision from an existing key and escapes punctuation-only names", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-rev-1", "authoring"), operation("op-rev-2", "authoring"), operation("op-punctuation", "authoring")] }));
    const service = new AuthoringService(repository);
    const first = await service.create("op-rev-1", "draft character name: Yukino。 First complete content.", "writer");
    const second = await service.create("op-rev-2", "draft character name: Yukino。 Second complete content.", "writer");
    expect(first.artifact_id).not.toBe(second.artifact_id);
    expect((await service.create("op-punctuation", "draft name: !!!。 character content is complete.", "writer")).status).toBe("completed");
    expect((await repository.read()).artifacts.map((item) => item.key)).toContain("draft_note:_0021_0021_0021");
  });

  it("blocks self-review and lets a different reviewer record issues", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "info", PLACEHOLDER_REMAINS: "info" } }, operations: [operation("op-author", "authoring")] }));
    const authoring = await new AuthoringService(repository).createTemplate("op-author", { kind: "character", document: { schema_version: 1, id: "short", display_name: "Short", summary: "A character document that still contains TODO placeholder content." } }, "writer");
    expect(authoring.artifact_id).toBeDefined();
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [ ...state.operations, operation("op-review-self", "review"), operation("op-review-peer", "review") ] }));
    const service = new ReviewService(repository);
    const self = await service.review("op-review-self", "Review current character", "writer");
    expect(self.status).toBe("blocked");
    const peer = await service.review("op-review-peer", "Review current character", "reviewer");
    expect(peer.status).toBe("completed");
    expect(peer.issue_ids.length).toBeGreaterThan(0);
    expect((await repository.read()).issues[0]?.code).toBe("PLACEHOLDER_REMAINS");
  });

  it("records review proposal findings as formal issues with evidence", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-review-proposal", "review")], artifacts: [{ id: "artifact-target", key: "character:yukino", kind: "character", name: "Yukino", content: "A complete character document.", media_type: "application/json", content_hash: contentHash("A complete character document."), revision: contentHash("A complete character document."), status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "writer", operation_id: "op-author" }] }));
    const result = await new ReviewService(repository).applyProposal("op-review-proposal", {
      target: { kind: "character", name: "Yukino" },
      findings: [{ id: "voice", severity: "warning", summary: "Voice needs more examples.", hint: "Add dialogue examples.", evidence: [{ source: "character document", excerpt: "A complete character document.", path: ["content", 0] }], overridable: true }],
      summary: "One non-blocking voice finding.",
    }, "character-critic");
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.reviews[0]).toMatchObject({ status: "partial", artifact_id: "artifact-target" });
    expect(state.issues[0]).toMatchObject({ code: "FINDING_VOICE", overridable: true, evidence: ["character document — A complete character document. — content.0"] });
    expect(state.audit.at(-1)?.event).toBe("review.proposal.applied");
    await repository.commit((await repository.read()).revision, (current) => ({ ...current, operations: [...current.operations, operation("op-review-proposal-id", "review"), operation("op-review-proposal-invalid", "review"), operation("op-review-proposal-self", "review"), operation("op-review-proposal-duplicate", "review")] }));
    const proposalService = new ReviewService(repository);
    const exact = await proposalService.applyProposal("op-review-proposal-id", { target: { kind: "character", name: "Yukino", id: "artifact-target" }, findings: [], summary: "No additional findings." }, "another-critic");
    expect(exact.status).toBe("completed");
    await expect(proposalService.applyProposal("op-review-proposal-invalid", { target: { kind: "character", name: "Missing" }, findings: [], summary: "Missing target." }, "another-critic")).rejects.toMatchObject({ code: "REVIEW_TARGET_INVALID" });
    await expect(proposalService.applyProposal("op-review-proposal-self", { target: { kind: "character", name: "Yukino", id: "artifact-target" }, findings: [], summary: "Self review." }, "writer")).rejects.toMatchObject({ code: "REVIEW_SELF_BLOCKED" });
    const duplicateFinding = { id: "duplicate", severity: "info" as const, summary: "Duplicate.", evidence: [{ source: "test" }], overridable: false };
    await expect(proposalService.applyProposal("op-review-proposal-duplicate", { target: { kind: "character", name: "Yukino", id: "artifact-target" }, findings: [duplicateFinding, duplicateFinding], summary: "Duplicate finding." }, "another-critic")).rejects.toMatchObject({ code: "REVIEW_FINDING_DUPLICATE" });
  });

  it("re-evaluates effective severity according to the quality profile", async () => {
    const repository = new MemoryProjectRepository("demo");
    const target = { id: "artifact-review", key: "character:test", kind: "character" as const, name: "Test", content: "short", media_type: "text/markdown", content_hash: contentHash("short"), revision: contentHash("short"), status: "draft" as const, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "writer", operation_id: "op-author" };
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [target],
      issues: [{ id: "issue-review", artifact_id: target.id, review_id: "review", code: "CONTENT_TOO_SHORT", message: "short", severity: "warning", effective_severity: "warning", status: "open", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
      quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "error" } },
      operations: [operation("op-reevaluate", "review")],
    }));
    const result = await new ReviewService(repository).reevaluate("op-reevaluate", "reviewer");
    expect(result.status).toBe("completed");
    expect((await repository.read()).issues[0]?.effective_severity).toBe("error");
  });

  it("preserves an issue-scoped override across reevaluation and profile changes", async () => {
    const repository = new MemoryProjectRepository("issue-override-lifecycle");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      issues: [{ id: "issue-lifecycle", artifact_id: "artifact", review_id: "review", code: "FINDING_STYLE", message: "Style", severity: "error", effective_severity: "error", against_effective_severity: "error", overridable: true, status: "open", created_at: timestamp, updated_at: timestamp }],
      operations: [operation("op-lifecycle-override", "review"), operation("op-lifecycle-reevaluate", "review"), operation("op-lifecycle-profile", "review")],
    }));
    const service = new ReviewService(repository);
    await service.updateIssue("op-lifecycle-override", { issue_id: "issue-lifecycle", action: "override", severity: "warning", reason: "Keep the intentional style." }, "director", "session-user");
    await service.reevaluate("op-lifecycle-reevaluate", "reviewer");
    let state = await repository.read();
    expect(state.issues[0]).toMatchObject({ effective_severity: "warning", override: { by: "director", reason: "Keep the intentional style.", against_effective_severity: "error", severity: "warning", policy_snapshot: expect.objectContaining({ blocking_severity: "error" }) } });
    await service.configureQualityProfile("op-lifecycle-profile", "strict", "director");
    state = await repository.read();
    expect(state.issues[0]?.override).toMatchObject({ by: "director", against_effective_severity: "error" });
    expect(state.audit.find((event) => event.event === "quality.profile.updated")?.details).toMatchObject({ preserved_issue_override_ids: ["issue-lifecycle"] });
  });

  it("preserves an issue override under a lenient policy and audits invalidation after a stricter reevaluation", async () => {
    const repository = new MemoryProjectRepository("issue-override-reevaluation");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      issues: [{ id: "issue-reevaluation", artifact_id: "artifact", review_id: "review", code: "FINDING_STYLE", message: "Style", severity: "error", effective_severity: "error", against_effective_severity: "error", overridable: true, status: "open", created_at: timestamp, updated_at: timestamp }],
      operations: [operation("op-reevaluation-override", "review"), operation("op-reevaluation-lenient", "review"), operation("op-reevaluation-strict", "review")],
    }));
    const service = new ReviewService(repository);
    await service.updateIssue("op-reevaluation-override", { issue_id: "issue-reevaluation", action: "override", severity: "warning", reason: "Keep this one intentional style choice." }, "director");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, quality_profile: qualityProfileForLevel("normal", { FINDING_STYLE: "warning" }) }));
    await service.reevaluate("op-reevaluation-lenient", "director");
    expect((await repository.read()).issues[0]).toMatchObject({ effective_severity: "warning", override: { severity: "warning", against_effective_severity: "error" } });
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, quality_profile: qualityProfileForLevel("normal", { FINDING_STYLE: "critical" }) }));
    await service.reevaluate("op-reevaluation-strict", "director");
    const state = await repository.read();
    expect(state.issues[0]).toMatchObject({ effective_severity: "critical" });
    expect(state.issues[0]?.override).toBeUndefined();
    expect(state.audit.find((event) => event.event === "review.issue.override.invalidated")?.details).toMatchObject({ issue_id: "issue-reevaluation", against_effective_severity: "error", policy_effective_severity: "critical" });
  });

  it("returns recoverable results when there is nothing to review", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-review-empty", "review"), operation("op-reevaluate-empty", "review")] }));
    const service = new ReviewService(repository);
    expect((await service.review("op-review-empty", "review", "reviewer")).status).toBe("needs_input");
    expect((await service.reevaluate("op-reevaluate-empty", "reviewer")).summary).toContain("沒有待重新評估");
  });

  it("supports audited issue resolve, ignore and severity override actions", async () => {
    const repository = new MemoryProjectRepository("issue-actions");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      issues: [{ id: "issue-action", artifact_id: "artifact", review_id: "review", code: "FINDING_STYLE", message: "Style", severity: "error", effective_severity: "error", against_effective_severity: "error", overridable: true, status: "open", created_at: timestamp, updated_at: timestamp }],
      operations: [operation("op-override", "review"), operation("op-ignore", "review")],
    }));
    const service = new ReviewService(repository);
    await service.updateIssue("op-override", { issue_id: "issue-action", action: "override", severity: "warning", reason: "The project intentionally keeps this style." }, "critic", "session-user");
    expect((await repository.read()).issues[0]).toMatchObject({ effective_severity: "warning", status: "open", override: { by: "critic", reason: "The project intentionally keeps this style.", against_effective_severity: "error" } });
    expect((await repository.read()).quality_profile.overrides.FINDING_STYLE).toBeUndefined();
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, quality_profile: qualityProfileForLevel("normal", { FINDING_STYLE: "info" }) }));
    await service.updateIssue("op-ignore", { issue_id: "issue-action", action: "ignore", reason: "Reviewed and accepted for this release." }, "critic", "session-user");
    const state = await repository.read();
    expect(state.issues[0]?.status).toBe("ignored");
    expect(state.quality_profile.overrides.FINDING_STYLE).toBe("info");
    expect(state.audit.slice(-2).map((event) => event.event)).toEqual(["review.issue.updated", "review.issue.updated"]);
    expect(state.audit.slice(-2).every((event) => event.actor === "session-user")).toBe(true);
    expect(state.audit.at(-1)?.details).toMatchObject({ action: "ignore", reason: "Reviewed and accepted for this release.", operator: "critic", agent_id: "critic", original_severity: "error", effective_severity: "info" });
  });

  it("requires an overridable issue and rejects override escalation or no-op", async () => {
    const repository = new MemoryProjectRepository("issue-override-invariants");
    const timestamp = new Date().toISOString();
    await repository.commit(0, (state) => ({
      ...state,
      issues: [
        { id: "issue-non-overridable", artifact_id: "artifact", review_id: "review", code: "HARD_RULE", message: "Hard", severity: "error", effective_severity: "error", against_effective_severity: "error", overridable: false, status: "open", created_at: timestamp, updated_at: timestamp },
        { id: "issue-overridable", artifact_id: "artifact", review_id: "review", code: "STYLE_RULE", message: "Style", severity: "error", effective_severity: "error", against_effective_severity: "error", overridable: true, status: "open", created_at: timestamp, updated_at: timestamp },
      ],
      operations: [operation("op-non-overridable", "review"), operation("op-escalation", "review"), operation("op-noop", "review"), operation("op-stricter-policy", "review")],
    }));
    const service = new ReviewService(repository);
    await expect(service.updateIssue("op-non-overridable", { issue_id: "issue-non-overridable", action: "override", severity: "warning", reason: "Try to bypass a hard rule." }, "director")).rejects.toMatchObject({ code: "ISSUE_NOT_OVERRIDABLE" });
    await expect(service.updateIssue("op-escalation", { issue_id: "issue-overridable", action: "override", severity: "critical", reason: "Escalation is invalid." }, "director")).rejects.toMatchObject({ code: "ISSUE_OVERRIDE_SEVERITY_ESCALATION" });
    await expect(service.updateIssue("op-noop", { issue_id: "issue-overridable", action: "override", severity: "error", reason: "No change." }, "director")).rejects.toMatchObject({ code: "ISSUE_OVERRIDE_SEVERITY_ESCALATION" });
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, quality_profile: qualityProfileForLevel("normal", { STYLE_RULE: "critical" }) }));
    await service.updateIssue("op-stricter-policy", { issue_id: "issue-overridable", action: "override", severity: "error", reason: "Downgrade from the current critical policy baseline." }, "director");
    expect((await repository.read()).issues.find((issue) => issue.id === "issue-overridable")).toMatchObject({ effective_severity: "error", override: { severity: "error", against_effective_severity: "critical" } });
  });

  it("accepts a fact by repairing coverage through the review decision", async () => {
    const repository = new MemoryProjectRepository("coverage-repair");
    const text = "Yukino is direct.";
    const source: SourceRecord = { id: "source-coverage", candidate_id: "candidate-coverage", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-refresh-coverage", "knowledge"), operation("op-review-coverage", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-coverage", "refresh new sources", "fact-curator");
    await repository.commit((await repository.read()).revision, (state) => ({
      ...state,
      facts: state.facts.map((fact) => ({ ...fact, coverage: [] })),
    }));
    const run = await service.beginFactReviewRun("op-review-coverage", "fact-reviewer-1");
    const context = await service.factReviewContext();
    const candidate = context.candidates[0]!;
    const decision: FactDecision = {
      candidate_occurrence_id: candidate.candidate_occurrence_id,
      claim: candidate.statement,
      decision: "accept",
      reason: "The exact sentence appears in the current official source chunk.",
      coverage: ["character", "background"],
      evidence: [{ source: source.title, quote: candidate.statement }],
    };
    const applied = await service.applyReviewBatch("op-review-coverage", [decision], "fact-reviewer-1", "fact-reviewer-1", run.id, context.projection_revision);
    expect(applied.status).toBe("completed");
    const after = await repository.read();
    expect(after.facts.find((fact) => fact.id === candidate.fact_id)).toMatchObject({ status: "accepted", coverage: ["character", "background"] });
  });

  it("skips already-adjudicated candidates in a later batch instead of failing", async () => {
    const repository = new MemoryProjectRepository("skip-settled");
    const text = "Yukino has_trait direct. Yukino belongs to Sobu High School.";
    const source: SourceRecord = { id: "source-skip", candidate_id: "candidate-skip", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-refresh-skip", "knowledge"), operation("op-review-skip", "review"), operation("op-review-skip-2", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-skip", "refresh new sources", "fact-curator");
    const run = await service.beginFactReviewRun("op-review-skip", "fact-reviewer-1");
    const candidates = (await service.factReviewContext()).candidates;
    expect(candidates).toHaveLength(2);
    const first = candidates[0]!;
    const second = candidates[1]!;
    const decisionFor = (candidate: (typeof candidates)[number]): FactDecision => ({
      candidate_occurrence_id: candidate.candidate_occurrence_id,
      claim: candidate.statement,
      decision: "accept",
      reason: "The exact sentence appears in the current official source chunk.",
      coverage: ["character", "personality"],
      evidence: [{ source: source.title, quote: candidate.statement }],
    });
    await service.applyReviewBatch("op-review-skip", [decisionFor(first)], "fact-reviewer-1", "fact-reviewer-1", run.id);
    const secondBatch = await service.applyReviewBatch("op-review-skip-2", [decisionFor(first), decisionFor(second)], "fact-reviewer-2", "fact-reviewer-2", run.id);
    expect(secondBatch.status).toBe("completed");
    expect(secondBatch.summary).toContain("skipped 1 already-adjudicated candidates.");
    const after = await repository.read();
    expect(after.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("completed");
    const facts = after.facts.filter((fact) => [first.fact_id, second.fact_id].includes(fact.id));
    expect(facts).toHaveLength(2);
    expect(facts.every((fact) => fact.status === "accepted")).toBe(true);
  });

  it("marks a run blocked when every candidate is needs_evidence", async () => {
    const repository = new MemoryProjectRepository("blocked-run");
    const text = "Yukino has_trait direct. Yukino has_trait calm.";
    const source: SourceRecord = { id: "source-blocked", candidate_id: "candidate-blocked", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-refresh-blocked", "knowledge"), operation("op-review-blocked", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-blocked", "refresh new sources", "fact-curator");
    const run = await service.beginFactReviewRun("op-review-blocked", "fact-reviewer-1");
    const candidates = (await service.factReviewContext()).candidates;
    expect(candidates).toHaveLength(2);
    const applied = await service.applyReviewBatch(
      "op-review-blocked",
      candidates.map((candidate) => ({ candidate_occurrence_id: candidate.candidate_occurrence_id, claim: candidate.statement, decision: "needs_evidence" as const, reason: "Quote-level evidence is required before acceptance.", evidence: [] })),
      "fact-reviewer-1",
      "fact-reviewer-1",
      run.id,
    );
    expect(applied.status).toBe("needs_input");
    const after = await repository.read();
    const updatedRun = after.fact_review_runs.find((item) => item.id === run.id)!;
    expect(updatedRun.status).toBe("blocked");
    expect(updatedRun.completed_at).toBeDefined();
  });

  it("flags contradicting accepted facts as conflict and lets the director resolve them", async () => {
    const repository = new MemoryProjectRepository("conflict-director");
    const text = "Yukino has_trait direct. Yukino has_trait calm.";
    const source: SourceRecord = { id: "source-conflict", candidate_id: "candidate-conflict", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-refresh-conflict", "knowledge"), operation("op-review-conflict", "review"), operation("op-review-conflict-2", "review")] }));
    const service = new KnowledgeService(repository);
    await service.refresh("op-refresh-conflict", "refresh new sources", "fact-curator");
    const run = await service.beginFactReviewRun("op-review-conflict", "fact-reviewer-1");
    const candidates = (await service.factReviewContext()).candidates;
    expect(candidates).toHaveLength(2);
    const decisionFor = (candidate: (typeof candidates)[number]): FactDecision => ({
      candidate_occurrence_id: candidate.candidate_occurrence_id,
      claim: candidate.statement,
      decision: "accept",
      reason: "The exact sentence appears in the current official source chunk.",
      coverage: ["character", "personality"],
      evidence: [{ source: source.title, quote: candidate.statement }],
    });
    await service.applyReviewBatch("op-review-conflict", [decisionFor(candidates[0]!)], "fact-reviewer-1", "fact-reviewer-1", run.id);
    const applied = await service.applyReviewBatch("op-review-conflict-2", [decisionFor(candidates[1]!)], "fact-reviewer-2", "fact-reviewer-2", run.id);
    expect(applied.status).toBe("needs_input");
    const after = await repository.read();
    expect(after.facts.find((fact) => fact.id === candidates[1]!.fact_id)).toMatchObject({ status: "conflict" });
    expect(after.fact_review_decisions).toContainEqual(expect.objectContaining({ candidate_occurrence_id: candidates[1]!.candidate_occurrence_id, decision: "conflict", reviewer_identity: "fact-reviewer-2" }));
    expect(after.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("blocked");
    const directorDecision: FactDecision = {
      candidate_occurrence_id: candidates[1]!.candidate_occurrence_id,
      claim: candidates[1]!.statement,
      decision: "accept",
      reason: "Director overrides the reviewer conflict after weighing both claims.",
      coverage: ["character", "personality"],
      evidence: [{ source: source.title, quote: candidates[1]!.statement }],
    };
    await expect(service.resolveFactConflict("op-review-conflict-2", [directorDecision], "director", "fact-reviewer-1", run.id)).rejects.toMatchObject({ code: "FACT_REVIEW_CONFLICT_DIRECTOR_REQUIRED" });
    const resolved = await service.resolveFactConflict("op-review-conflict-2", [directorDecision], "director", "director", run.id);
    expect(resolved.status).toBe("completed");
    const resolvedState = await repository.read();
    expect(resolvedState.facts.find((fact) => fact.id === candidates[1]!.fact_id)).toMatchObject({ status: "accepted" });
    expect(resolvedState.fact_review_runs.find((item) => item.id === run.id)?.status).toBe("completed");
  });

  it("does not rebuild duplicate chunks on repeated refresh", async () => {
    const repository = new MemoryProjectRepository("demo");
    const text = "Yukino has_trait direct. Yukino belongs to Sobu High School.";
    const source: SourceRecord = { id: "source-1", candidate_id: "candidate-1", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source], operations: [operation("op-k1", "knowledge")] }));
    const service = new KnowledgeService(repository);
    const first = await service.refresh("op-k1", "整理知識", "curator");
    expect(first.status).toBe("completed");
    expect(first.chunks.length).toBeGreaterThan(0);
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-k2", "knowledge")] }));
    const second = await service.refresh("op-k2", "整理知識", "curator");
    expect(second.chunks).toHaveLength(0);
  });

  it("merges corroborating evidence from a second source instead of dropping it", async () => {
    const repository = new MemoryProjectRepository("demo");
    const text = "Yukino is direct.";
    const mk = (id: string): SourceRecord => ({ id, candidate_id: `candidate-${id}`, title: id, canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() });
    await repository.commit(0, (state) => ({ ...state, sources: [mk("source-a"), mk("source-b")], operations: [operation("op-k1", "knowledge")] }));
    const result = await new KnowledgeService(repository).refresh("op-k1", "整理知識", "curator");
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]!.source_ids).toEqual(expect.arrayContaining(["source-a", "source-b"]));
  });

  it("returns the chunks created by structured curation", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-curation-2", "authoring")], sources: [{ id: "source-official", candidate_id: "candidate-official", title: "official page", canonical_text: "Yukino is direct and calm.", original_hash: contentHash("x"), revision: contentHash("x"), media_type: "text/plain", created_at: new Date().toISOString() }] }));
    const claim: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.9, coverage: ["character", "personality"], evidence: [{ source: "official page", quote: "Yukino is direct and calm." }] };
    const result = await new KnowledgeService(repository).applyCuration("op-curation-2", [claim], "curator");
    expect(result.status).toBe("completed");
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("keys character artifacts by document id so renames do not create new keys", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-c1", "authoring"), operation("op-c2", "authoring")] }));
    const service = new AuthoringService(repository);
    const first = await service.createTemplate("op-c1", { kind: "character", document: { schema_version: 1, id: "yukino", display_name: "雪乃", summary: "A calm character." } }, "writer");
    expect(first.artifact_key).toBe("character:yukino");
    const second = await service.createTemplate("op-c2", { kind: "character", document: { schema_version: 1, id: "yukino", display_name: "雪乃改", summary: "A calm character." } }, "writer");
    expect(second.artifact_key).toBe("character:yukino");
    const state = await repository.read();
    expect(state.artifacts.filter((item) => item.key === "character:yukino")).toHaveLength(2);
  });

  it("does not let a review target its own review artifact", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "info", PLACEHOLDER_REMAINS: "info" } }, operations: [operation("op-author", "authoring")] }));
    const authoring = await new AuthoringService(repository).createTemplate("op-author", { kind: "character", document: { schema_version: 1, id: "yukino", display_name: "Yukino", summary: "A complete character document with enough content." } }, "writer");
    expect(authoring.artifact_id).toBeDefined();
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, operations: [...state.operations, operation("op-review-1", "review"), operation("op-review-2", "review")] }));
    const service = new ReviewService(repository);
    const first = await service.review("op-review-1", "Review current character", "reviewer");
    expect(first.status).toBe("completed");
    const characterArtifact = (await repository.read()).artifacts.find((item) => item.kind === "character")!;
    const second = await service.review("op-review-2", "Review current character", "reviewer");
    expect(second.status).toBe("completed");
    const state = await repository.read();
    const secondReview = state.reviews.at(-1)!;
    expect(secondReview.artifact_id).toBe(characterArtifact.id);
    expect(state.artifacts.find((item) => item.kind === "review")?.id).not.toBe(secondReview.artifact_id);
  });

  it("merges corroborating evidence from a second source into an existing fact", async () => {
    const repository = new MemoryProjectRepository("demo");
    const text1 = "Yukino has a direct personality.";
    const source1: SourceRecord = { id: "source-1", candidate_id: "candidate-1", title: "official", canonical_text: text1, original_hash: contentHash(text1), revision: contentHash(text1), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit(0, (state) => ({ ...state, sources: [source1], operations: [operation("op-k1", "knowledge")] }));
    const service = new KnowledgeService(repository);
    const first = await service.refresh("op-k1", "整理知識", "curator");
    expect(first.facts).toHaveLength(1);
    const text2 = "Yukino has a direct personality.";
    const source2: SourceRecord = { id: "source-2", candidate_id: "candidate-2", title: "second official", canonical_text: text2, original_hash: contentHash(text2), revision: contentHash(text2), media_type: "text/plain", created_at: new Date().toISOString() };
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, sources: [...state.sources, source2], operations: [...state.operations, operation("op-k2", "knowledge")] }));
    const second = await service.refresh("op-k2", "整理知識", "curator");
    expect(second.status).toBe("completed");
    expect(second.facts).toHaveLength(0);
    expect(second.summary).toContain("merged 1 corroborating evidence");
    const state = await repository.read();
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]?.source_ids).toEqual(["source-1", "source-2"]);
    expect(state.facts[0]?.fact_revision).toBe(2);
    expect(state.audit.some((entry) => entry.event === "knowledge.refreshed" && entry.details.merged_count === 1)).toBe(true);
  });

  it("merges corroborating curation evidence into an existing fact", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-curation-a", "authoring")], sources: [{ id: "source-a", candidate_id: "candidate-a", title: "official page", canonical_text: "Yukino is direct.", original_hash: contentHash("Yukino is direct."), revision: contentHash("Yukino is direct."), media_type: "text/plain", created_at: new Date().toISOString() }] }));
    const claim: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.92, coverage: ["character"], evidence: [{ source: "official page", quote: "Yukino is direct." }] };
    const service = new KnowledgeService(repository);
    await service.applyCuration("op-curation-a", [claim], "fact-curator");
    await repository.commit((await repository.read()).revision, (state) => ({ ...state, sources: [...state.sources, { id: "source-b", candidate_id: "candidate-b", title: "second official page", canonical_text: "Yukino is direct.", original_hash: contentHash("Yukino is direct."), revision: contentHash("Yukino is direct."), media_type: "text/plain", created_at: new Date().toISOString() }], operations: [...state.operations, operation("op-curation-b", "authoring")] }));
    const claim2: FactClaim = { ...claim, evidence: [{ source: "second official page", quote: "Yukino is direct." }] };
    const result = await service.applyCuration("op-curation-b", [claim2], "fact-curator");
    expect(result.facts).toHaveLength(0);
    expect(result.summary).toContain("merged 1 corroborating evidence");
    const state = await repository.read();
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0]?.source_ids).toEqual(["source-a", "source-b"]);
    expect(state.facts[0]?.fact_revision).toBe(2);
  });

  it("keeps distinct artifact keys for names that differ only in punctuation", async () => {
    const repository = new MemoryProjectRepository("key-escape");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-ka", "authoring"), operation("op-kb", "authoring"), operation("op-kc", "authoring")] }));
    const service = new AuthoringService(repository);
    const first = await service.createTemplate("op-ka", { kind: "character", document: { schema_version: 1, id: "alice.a", display_name: "A", summary: "One." } }, "writer");
    const second = await service.createTemplate("op-kb", { kind: "character", document: { schema_version: 1, id: "alice_a", display_name: "B", summary: "Two." } }, "writer");
    const third = await service.createTemplate("op-kc", { kind: "character", document: { schema_version: 1, id: "alice-a", display_name: "C", summary: "Three." } }, "writer");
    expect(first.artifact_key).not.toBe(second.artifact_key);
    expect(second.artifact_key).not.toBe(third.artifact_key);
    expect(first.artifact_key).not.toBe(third.artifact_key);
    const state = await repository.read();
    const keys = state.artifacts.map((item) => item.key);
    expect(keys).toContain("character:alice_002ea");
    expect(keys).toContain("character:alice_005fa");
    expect(keys).toContain("character:alice-a");
    const aliceDot = state.artifacts.filter((item) => item.key === "character:alice_002ea");
    expect(aliceDot).toHaveLength(1);
    expect(aliceDot[0]?.name).toBe("A");
    expect(keys).toHaveLength(3);
  });

  it("updates a world artifact by its stable document id instead of the first entry", async () => {
    const repository = new MemoryProjectRepository("world-id");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-w1", "authoring"), operation("op-w2", "authoring"), operation("op-w3", "authoring")] }));
    const service = new AuthoringService(repository);
    const world = (entries: Array<{ id: string; title: string }>) => ({ kind: "world" as const, document_id: "harbor-network", entries: entries.map((entry) => ({ schema_version: 1, id: entry.id, category: "geography", title: entry.title, content: `${entry.title} content.` })) });
    const first = await service.createTemplate("op-w1", world([{ id: "harbor", title: "Harbor" }]), "world-lore-creator");
    const second = await service.createTemplate("op-w2", world([{ id: "docks", title: "Docks" }, { id: "harbor", title: "Harbor" }]), "world-lore-creator");
    expect(second.artifact_key).toBe(first.artifact_key);
    let state = await repository.read();
    expect(state.artifacts.filter((item) => item.key === first.artifact_key)).toHaveLength(2);
    const different = await service.createTemplate("op-w3", { kind: "world", document_id: "coastal-network", entries: [{ schema_version: 1, id: "harbor", category: "geography", title: "Harbor", content: "Same entry, new world." }] }, "world-lore-creator");
    expect(different.artifact_key).not.toBe(first.artifact_key);
    state = await repository.read();
    expect(state.artifacts.map((item) => item.key)).toContain("world_lore:coastal-network");
  });

  describe("BUG3-05: curation batch deduplication", () => {
    it("deduplicates identical claims within the same curation proposal (BUG3-05)", async () => {
      const repository = new MemoryProjectRepository("demo-dedup-same");
      await repository.commit(0, (state) => ({ ...state, operations: [operation("op-c1", "authoring")], sources: [{ id: "src-1", candidate_id: "cand-1", title: "doc1", canonical_text: "Yukino is direct.", original_hash: contentHash("x"), revision: contentHash("x"), media_type: "text/plain", created_at: new Date().toISOString() }] }));
      const claim1: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.9, coverage: ["character"], evidence: [{ source: "doc1", quote: "Yukino is direct." }] };
      const claim2: FactClaim = { ...claim1 };
      const service = new KnowledgeService(repository);
      const result = await service.applyCuration("op-c1", [claim1, claim2], "fact-curator");
      expect(result.status).toBe("completed");
      const state = await repository.read();
      expect(state.facts).toHaveLength(1);
    });

    it("merges claims with different sources within the same curation proposal (BUG3-05)", async () => {
      const repository = new MemoryProjectRepository("demo-dedup-multi");
      await repository.commit(0, (state) => ({ ...state, operations: [operation("op-c2", "authoring")], sources: [
        { id: "src-a", candidate_id: "cand-a", title: "page A", canonical_text: "Yukino is direct.", original_hash: contentHash("a"), revision: contentHash("a"), media_type: "text/plain", created_at: new Date().toISOString() },
        { id: "src-b", candidate_id: "cand-b", title: "page B", canonical_text: "Yukino is direct.", original_hash: contentHash("b"), revision: contentHash("b"), media_type: "text/plain", created_at: new Date().toISOString() },
      ] }));
      const claim1: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.9, coverage: ["character"], evidence: [{ source: "page A", quote: "Yukino is direct." }] };
      const claim2: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.95, coverage: ["character"], evidence: [{ source: "page B", quote: "Yukino is direct." }] };
      const service = new KnowledgeService(repository);
      const result = await service.applyCuration("op-c2", [claim1, claim2], "fact-curator");
      expect(result.status).toBe("completed");
      const state = await repository.read();
      expect(state.facts).toHaveLength(1);
      expect(state.facts[0]?.source_ids).toEqual(["src-a", "src-b"]);
    });

    it("merges new curation evidence into an accepted fact, increments revision and resets status to candidate (BUG3-04)", async () => {
      const repository = new MemoryProjectRepository("demo-accepted-candidate");
      await repository.commit(0, (state) => ({
        ...state,
        operations: [operation("op-c1", "authoring"), operation("op-c2", "authoring")],
        sources: [
          { id: "src-1", candidate_id: "cand-1", title: "Doc 1", canonical_text: "Yukino is calm.", original_hash: contentHash("1"), revision: contentHash("1"), media_type: "text/plain", created_at: new Date().toISOString() },
          { id: "src-2", candidate_id: "cand-2", title: "Doc 2", canonical_text: "Yukino is calm.", original_hash: contentHash("2"), revision: contentHash("2"), media_type: "text/plain", created_at: new Date().toISOString() },
        ],
      }));
      const service = new KnowledgeService(repository);
      const claim1: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "calm", classification: "trait", confidence: 0.9, coverage: ["character"], evidence: [{ source: "Doc 1", quote: "Yukino is calm." }] };
      await service.applyCuration("op-c1", [claim1], "fact-curator");

      // Mark fact as accepted manually
      let state = await repository.read();
      await repository.commit(state.revision, (s) => ({
        ...s,
        facts: s.facts.map((f) => ({ ...f, status: "accepted" as const })),
      }));

      // Apply second curation with new evidence
      const claim2: FactClaim = { subject: "Yukino", predicate: "has_trait", value: "calm", classification: "trait", confidence: 0.9, coverage: ["character"], evidence: [{ source: "Doc 2", quote: "Yukino is calm." }] };
      await service.applyCuration("op-c2", [claim2], "fact-curator");

      state = await repository.read();
      expect(state.facts).toHaveLength(1);
      expect(state.facts[0]?.status).toBe("candidate");
      expect(state.facts[0]?.fact_revision).toBe(2);
    });
  });

  describe("re-extraction and paginated fact review context", () => {
    function sourceRecord(id: string, text: string): SourceRecord {
      return { id, candidate_id: `candidate-${id}`, title: id, canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() };
    }

    it("re-extracts known sources with the extractor revision stamped on chunks", async () => {
      const repository = new MemoryProjectRepository("demo-reextract");
      const text = "Yukino has a direct personality.";
      await repository.commit(0, (state) => ({
        ...state,
        operations: [operation("op-k1", "knowledge"), operation("op-k2", "knowledge")],
        sources: [sourceRecord("source-1", text)],
      }));
      const service = new KnowledgeService(repository);
      const first = await service.refresh("op-k1", "整理知識", "curator");
      expect(first.status).toBe("completed");
      const second = await service.reextract("op-k2", ["source-1"], "curator");
      expect(second.status).toBe("completed");
      expect(second.summary).toContain("Re-extracted");
      const state = await repository.read();
      const chunks = state.knowledge_chunks.filter((chunk) => chunk.source_id === "source-1");
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.every((chunk) => chunk.extractor_revision === "extractor-v1")).toBe(true);
      expect(state.audit.some((entry) => entry.event === "knowledge.reextracted" && entry.details.extractor_revision === "extractor-v1")).toBe(true);
    });

    it("stamps chunks with a custom extractor revision when one is provided", async () => {
      const repository = new MemoryProjectRepository("demo-reextract-v2");
      const text = "Yukino has a direct personality.";
      await repository.commit(0, (state) => ({
        ...state,
        operations: [operation("op-k1", "knowledge")],
        sources: [sourceRecord("source-1", text)],
      }));
      const service = new KnowledgeService(repository);
      await service.reextract("op-k1", ["source-1"], "curator", "extractor-v2");
      const state = await repository.read();
      expect(state.knowledge_chunks.every((chunk) => chunk.extractor_revision === "extractor-v2")).toBe(true);
    });

    it("rejects missing sources and empty source id lists", async () => {
      const repository = new MemoryProjectRepository("demo-reextract-errors");
      await repository.commit(0, (state) => ({ ...state, operations: [operation("op-k1", "knowledge")], sources: [sourceRecord("source-1", "Yukino is calm.")] }));
      const service = new KnowledgeService(repository);
      await expect(service.reextract("op-k1", ["missing-source"], "curator")).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
      await expect(service.reextract("op-k1", [], "curator")).rejects.toMatchObject({ code: "SOURCE_IDS_REQUIRED" });
    });

    it("paginates fact review candidates with an opaque cursor and triage filters", async () => {
      const repository = new MemoryProjectRepository("demo-fact-paging");
      const now = new Date().toISOString();
      const facts: FactRecord[] = [
        { id: "fact-1", candidate_occurrence_id: "occ-1", statement: "Yukino is calm.", subject: "Yukino", predicate: "is", value: "calm", classification: "trait", coverage: ["character"], status: "candidate", confidence: 0.7, source_ids: ["source-a"], evidence: ["source-a"], fact_revision: 1, created_at: now, updated_at: now, created_by: "curator" },
        { id: "fact-2", candidate_occurrence_id: "occ-2", statement: "Yukino comes from the north.", subject: "Yukino", predicate: "comes from", value: "the north", classification: "event", coverage: ["background"], status: "candidate", confidence: 0.7, source_ids: ["source-b"], evidence: ["source-b"], fact_revision: 1, created_at: now, updated_at: now, created_by: "curator" },
        { id: "fact-3", candidate_occurrence_id: "occ-3", statement: "The academy is ancient.", subject: "the academy", predicate: "is", value: "ancient", classification: "world", coverage: ["world_context"], status: "candidate", confidence: 0.7, source_ids: ["source-c"], evidence: ["source-c"], fact_revision: 1, created_at: now, updated_at: now, created_by: "curator" },
      ];
      await repository.commit(0, (state) => ({ ...state, operations: [operation("op-k1", "knowledge")], facts }));
      const service = new KnowledgeService(repository);
      const page1 = await service.factReviewContext({ limit: 2 });
      expect(page1.candidates).toHaveLength(2);
      expect(page1.next_cursor).toBeDefined();
      const page2 = await service.factReviewContext({ cursor: page1.next_cursor });
      expect(page2.candidates).toHaveLength(1);
      expect(page2.next_cursor).toBeUndefined();
      const bySource = await service.factReviewContext({ source_id: "source-b" });
      expect(bySource.candidates.map((candidate) => candidate.candidate_occurrence_id)).toEqual(["occ-2"]);
      const byClassification = await service.factReviewContext({ classification: "world" });
      expect(byClassification.candidates.map((candidate) => candidate.candidate_occurrence_id)).toEqual(["occ-3"]);
      const unlimited = await service.factReviewContext();
      expect(unlimited.candidates).toHaveLength(3);
      expect(unlimited.next_cursor).toBeUndefined();
    });
  });
});
