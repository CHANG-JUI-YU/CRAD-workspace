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
    await expect(service.applyReviewBatch("op-review-duplicate-strict", [decision], "fact-reviewer-2", "fact-reviewer-2", run.id)).rejects.toMatchObject({ code: "FACT_REVIEW_RUN_CLOSED" });
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

  it("creates a revision and does not duplicate identical authoring content", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "info", PLACEHOLDER_REMAINS: "info" } }, operations: [operation("op-author", "authoring")] }));
    const service = new AuthoringService(repository);
    const request = "Create character: Yukino. Personality: calm, direct, and observant.";
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

  it("supports the remaining artifact kinds through the same flexible authoring service", async () => {
    const repository = new MemoryProjectRepository("demo");
    const kinds = ["relationship", "world", "greeting", "blueprint", "palette", "plugin"] as const;
    await repository.commit(0, (state) => ({ ...state, operations: kinds.map((_, index) => operation(`op-kind-${index}`, "authoring")) }));
    const service = new AuthoringService(repository);
    for (const [index, kind] of kinds.entries()) {
      const result = await service.create(`op-kind-${index}`, `${kind} content. This is enough content for the artifact.`, "writer");
      expect(result.status).toBe("completed");
    }
    expect((await repository.read()).artifacts).toHaveLength(kinds.length);
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

  it("creates a new revision from an existing key and normalizes punctuation-only names", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-rev-1", "authoring"), operation("op-rev-2", "authoring"), operation("op-punctuation", "authoring")] }));
    const service = new AuthoringService(repository);
    const first = await service.create("op-rev-1", "character name: Yukino。 First complete content.", "writer");
    const second = await service.create("op-rev-2", "character name: Yukino。 Second complete content.", "writer");
    expect(first.artifact_id).not.toBe(second.artifact_id);
    expect((await service.create("op-punctuation", "name: !!!。 character content is complete.", "writer")).status).toBe("completed");
    expect((await repository.read()).artifacts.find((item) => item.key.endsWith(":default"))?.key).toContain("default");
  });

  it("blocks self-review and lets a different reviewer record issues", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, quality_profile: { blocking_severity: "error", overrides: { CONTENT_TOO_SHORT: "info", PLACEHOLDER_REMAINS: "info" } }, operations: [operation("op-author", "authoring")] }));
    const authoring = await new AuthoringService(repository).create("op-author", "Create character: Short. TODO", "writer");
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
});
