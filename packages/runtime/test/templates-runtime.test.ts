import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type FactRecord, type SourceRecord } from "@st-workspace/core";
import { WorkspaceRuntime } from "../src/index.js";

const palette = {
  kind: "palette" as const,
  character_id: "demo",
  module: {
    schema_version: 1 as const,
    mode: "palette" as const,
    module: "basic_information" as const,
    title: "Basic information",
    content: "A calm character.",
  },
};

describe("runtime template boundary", () => {
  const source: SourceRecord = {
    id: "source-official",
    candidate_id: "candidate-official",
    title: "Official page",
    canonical_text: "Official source text.",
    original_hash: contentHash("Official source text."),
    revision: contentHash("Official source text."),
    media_type: "text/plain",
    created_at: new Date().toISOString(),
  };

  const acceptedFact: FactRecord = {
    id: "fact-accepted",
    statement: "Yukino has_trait calm",
    subject: "Yukino",
    predicate: "has_trait",
    value: "calm",
    classification: "trait",
    status: "accepted",
    confidence: 0.9,
    source_ids: [source.id],
    evidence: ["Official page — Yukino is calm."],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: "fact-reviewer-1",
  };

  it("returns a fixed context and persists a palette proposal without internal fields", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const context = await runtime.templateContext("palette");
    expect(context.context.kind).toBe("palette");
    expect(JSON.stringify(context.schema)).not.toMatch(/revision|task_id|lease_id/iu);
    const result = await runtime.submitTemplateProposal(palette, { actor: "palette-creator", attachments: [] });
    expect(result.status).toBe("completed");
    expect(result.agent_id).toBe("palette-creator");
    const state = await repository.read();
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]).toMatchObject({ kind: "palette", name: "demo/basic_information", media_type: "application/json" });
    expect(JSON.parse(state.artifacts[0]!.content)).toMatchObject({ kind: "palette", character_id: "demo" });
    expect((await runtime.templateContext("palette")).context.existing).toHaveLength(1);
  });

  it("routes and persists a cross-mode wardrobe Markdown proposal", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const content = `# Demo 的衣櫃\n\n## 衣櫃概況\n- 總件數：2\n\n## 內衣\n| 款式 | 顏色／材質 | 數量 |\n| --- | --- | ---: |\n| 日常款 | 棉質 | 2 |\n\n## 搭配組合\n1. 使用：日常款｜日常\n`;
    const result = await runtime.submitTemplateProposal({ kind: "wardrobe", character_id: "demo", content }, { actor: "wardrobe-creator", attachments: [] });
    expect(result).toMatchObject({ status: "completed", agent_id: "wardrobe-creator" });
    const state = await repository.read();
    expect(state.artifacts[0]).toMatchObject({ kind: "wardrobe", name: "demo/wardrobe", media_type: "text/markdown", content });
    expect((await runtime.templateContext("wardrobe")).context.existing[0]).toMatchObject({ markdown: content, value: { character_id: "demo" } });
  });

  it("injects Blueprint, accepted Facts and adaptation decisions into creator context", async () => {
    const repository = new MemoryProjectRepository("demo");
    const blueprint = JSON.stringify({ kind: "blueprint", flow: "source_adaptation", source_adaptation: { subject_name: "Yukino", adaptation_intent: "A softer personal interpretation" } });
    const blueprintHash = contentHash(blueprint);
    await repository.commit(0, (state) => ({
      ...state,
      sources: [source],
      facts: [acceptedFact],
      artifacts: [{ id: "blueprint-1", key: "blueprint:demo", kind: "blueprint" as const, name: "project-blueprint", content: blueprint, media_type: "application/json", content_hash: blueprintHash, revision: blueprintHash, status: "draft" as const, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "director", operation_id: "interview" }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const decision = await runtime.createAdaptationDecision({ topic: "temperament", choice: "keep_blueprint", fact_refs: [acceptedFact.id], rationale: "The personal interpretation is intentional." }, { actor: "user", attachments: [] });
    expect(decision.status).toBe("completed");
    const context = await runtime.templateContext("character");
    expect(context.context.knowledge?.blueprint?.flow).toBe("source_adaptation");
    expect(context.context.knowledge?.accepted_facts.map((fact) => fact.id)).toEqual([acceptedFact.id]);
    expect(context.context.knowledge?.adaptation_decisions).toHaveLength(1);
    expect(context.context.knowledge?.sources[0]).toMatchObject({ id: source.id, revision: source.revision });
  });

  it("rejects a template that references a non-accepted Fact before creating an artifact", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, facts: [{ ...acceptedFact, id: "fact-pending", status: "candidate" as const }] }));
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.submitTemplateProposal({ kind: "character", document: { schema_version: 1, id: "demo", display_name: "Demo", summary: "A character", fact_refs: ["fact-pending"] } }, { actor: "creator", attachments: [] })).rejects.toMatchObject({ code: "FACT_REFERENCE_INVALID", details: [{ code: "FACT_REFERENCE_NOT_ACCEPTED", fact_id: "fact-pending" }] });
    expect((await repository.read()).artifacts).toHaveLength(0);
  });

  it("registers source candidates while storing the same high-level research template", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    const result = await runtime.submitTemplateProposal({
      kind: "source_research",
      query: "official page",
      candidates: [{ title: "Official page", url: "https://example.test", snippet: "A result" }],
    }, { actor: "source-researcher", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]?.title).toBe("Official page");
    expect(state.artifacts[0]?.kind).toBe("source_research");
  });

  it("executes fact curation and fact review while retaining both template artifacts", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      sources: [{ id: "source-official", candidate_id: "candidate-official", title: "official page", canonical_text: "Yukino is direct.", original_hash: contentHash("Yukino is direct."), revision: contentHash("Yukino is direct."), media_type: "text/plain", created_at: new Date().toISOString() }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    const curated = await runtime.submitTemplateProposal({
      kind: "fact_curation",
      topic: "Yukino",
      claims: [{ subject: "Yukino", predicate: "has_trait", value: "direct", classification: "trait", confidence: 0.9, coverage: ["character", "personality"], evidence: [{ source: "official page", quote: "Yukino is direct." }] }],
      summary: "Candidate fact",
    }, { actor: "fact-curator", attachments: [] });
    expect(curated.status).toBe("completed");
    const afterCuration = await repository.read();
    const fact = afterCuration.facts[0];
    expect(fact?.status).toBe("candidate");
    const reviewContext = await runtime.templateContext("fact_review");
    const reviewKnowledge = reviewContext.context.knowledge?.fact_review;
    const candidate = reviewKnowledge?.candidates[0];
    expect(candidate).toBeDefined();
    const reviewed = await runtime.submitTemplateProposal({
      kind: "fact_review",
      decisions: [{ candidate_occurrence_id: candidate!.candidate_occurrence_id, claim: candidate!.statement, decision: "accept", reason: "Supported by the exact official quote.", evidence: [{ source: "official page", quote: "Yukino is direct." }] }],
      summary: "Accepted fact",
    }, { actor: "fact-reviewer-1", attachments: [] });
    expect(reviewed.status).toBe("completed");
    const state = await repository.read();
    expect(state.facts[0]?.status).toBe("accepted");
    expect(state.artifacts.map((artifact) => artifact.kind)).toEqual(["fact_curation", "fact_review"]);
    expect(reviewed.completed).toContain(fact!.id);
  });

  it("rotates the three trusted reviewer identities over one shared Review Run", async () => {
    const repository = new MemoryProjectRepository("reviewer-rotation");
    const text = "Yukino is direct. Yukino is observant.";
    await repository.commit(0, (state) => ({
      ...state,
      sources: [{ id: "source-rotation", candidate_id: "candidate-rotation", title: "official", canonical_text: text, original_hash: contentHash(text), revision: contentHash(text), media_type: "text/plain", created_at: new Date().toISOString() }],
    }));
    const runtime = new WorkspaceRuntime(repository);
    await runtime.submitTemplateProposal({
      kind: "fact_curation",
      topic: "Yukino",
      claims: [
        { subject: "Yukino", predicate: "is", value: "direct", classification: "trait", confidence: 0.9, coverage: ["character", "personality"], evidence: [{ source: "official", quote: "Yukino is direct." }] },
        { subject: "Yukino", predicate: "is", value: "observant", classification: "trait", confidence: 0.9, coverage: ["character", "personality"], evidence: [{ source: "official", quote: "Yukino is observant." }] },
      ],
      summary: "Two candidates",
    }, { actor: "user", attachments: [] });
    const firstContext = await runtime.templateContext("fact_review");
    const first = firstContext.context.knowledge?.fact_review?.candidates[0]!;
    const firstResult = await runtime.submitTemplateProposal({ kind: "fact_review", decisions: [{ candidate_occurrence_id: first.candidate_occurrence_id, claim: first.statement, decision: "accept", reason: "Exact source quote.", evidence: [{ source: "official", quote: first.statement }] }], summary: "First reviewer decision" }, { actor: "user", attachments: [] });
    expect(firstResult.agent_id).toBe("fact-reviewer-1");
    const secondContext = await runtime.templateContext("fact_review");
    const second = secondContext.context.knowledge?.fact_review?.candidates[0]!;
    const secondResult = await runtime.submitTemplateProposal({ kind: "fact_review", decisions: [{ candidate_occurrence_id: second.candidate_occurrence_id, claim: second.statement, decision: "accept", reason: "Exact source quote.", evidence: [{ source: "official", quote: second.statement }] }], summary: "Second reviewer decision" }, { actor: "user", attachments: [] });
    expect(secondResult.agent_id).toBe("fact-reviewer-2");
    const state = await repository.read();
    expect(new Set(state.fact_review_decisions.map((decision) => decision.reviewer_identity))).toEqual(new Set(["fact-reviewer-1", "fact-reviewer-2"]));
    expect(state.fact_review_runs[0]?.candidate_occurrence_ids).toHaveLength(2);
    expect(state.fact_review_runs[0]?.status).toBe("completed");
  });

  it("routes review template findings into the formal review ledger", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    await runtime.submitTemplateProposal(palette, { actor: "palette-creator", attachments: [] });
    const stateBefore = await repository.read();
    const target = stateBefore.artifacts[0]!;
    const result = await runtime.submitTemplateProposal({
      kind: "review",
      target: { kind: "palette", name: target.name, id: target.id },
      findings: [{ id: "content", severity: "warning", summary: "Add a concrete example.", evidence: [{ source: "palette module", excerpt: "A calm character." }], overridable: true }],
      summary: "Palette review recorded.",
    }, { actor: "palette-critic", attachments: [] });
    expect(result.status).toBe("completed");
    const state = await repository.read();
    expect(state.reviews).toHaveLength(1);
    expect(state.issues[0]).toMatchObject({ artifact_id: target.id, overridable: true, evidence: ["palette module — A calm character."] });
    expect(state.artifacts.some((artifact) => artifact.kind === "review")).toBe(true);
  });

  it("rejects a malformed proposal before creating an operation", async () => {
    const repository = new MemoryProjectRepository("demo");
    const runtime = new WorkspaceRuntime(repository);
    await expect(runtime.submitTemplateProposal({ kind: "greetings", document: { schema_version: 1, greetings: [] } }, { actor: "writer", attachments: [] })).rejects.toMatchObject({ code: "TEMPLATE_SCHEMA_INVALID" });
    expect((await repository.read()).operations).toHaveLength(0);
  });

  it("ignores malformed historical template JSON while building context", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      artifacts: [{ id: "bad", key: "palette:bad", kind: "palette", name: "bad", content: "not-json", media_type: "application/json", content_hash: "a".repeat(64), revision: "b".repeat(64), status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: "test", operation_id: "none" }],
    }));
    expect((await new WorkspaceRuntime(repository).templateContext("palette")).context.existing).toHaveLength(0);
  });
});
