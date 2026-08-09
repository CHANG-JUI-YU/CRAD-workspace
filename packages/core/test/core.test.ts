import { describe, expect, it } from "vitest";
import { CoreError, MemoryProjectRepository, buildZhujiTemplateContext, contentHash, createProjectState, structuredZhujiModuleSchema, zhujiProposalJsonSchema, zhujiProposalValueSchema } from "../src/index.js";

describe("core project repository", () => {
  it("commits atomically and increments the project revision", async () => {
    const repository = new MemoryProjectRepository("demo");
    const result = await repository.commit(0, (state) => ({ ...state, candidates: [{ id: "candidate-1", title: "Official", status: "pending" }] }));
    expect(result.revision).toBe(1);
    expect(result.candidates[0]?.id).toBe("candidate-1");
  });

  it("fails closed on a stale expected revision", async () => {
    const repository = new MemoryProjectRepository("demo", createProjectState("demo"));
    await repository.commit(0, (state) => ({ ...state }));
    await expect(repository.commit(0, (state) => ({ ...state }))).rejects.toMatchObject<Partial<CoreError>>({ code: "REVISION_CONFLICT", recoverable: true });
  });

  it("rejects invalid initial state at the core boundary", () => {
    expect(() => new MemoryProjectRepository("demo", { ...createProjectState("demo"), project_id: "" })).toThrowError(/too_small/iu);
  });

  it("backfills deterministic legacy fact decision history without creating a new Review Run", async () => {
    const createdAt = new Date().toISOString();
    const initial = createProjectState("legacy-facts");
    const repository = new MemoryProjectRepository("legacy-facts", {
      ...initial,
      facts: [{ id: "fact-1", statement: "Demo is calm", status: "accepted", confidence: 1, source_ids: [], evidence: ["legacy quote"], created_at: createdAt, updated_at: createdAt, created_by: "curator" }],
      fact_review_passes: [{ id: "pass-1", operation_id: "op-review", reviewer: "fact-reviewer-1", pass: 1, fact_ids: ["fact-1"], decisions_hash: contentHash("pass-1"), created_at: createdAt }],
    });
    const first = await repository.read();
    const second = await repository.read();
    expect(first.fact_review_passes).toHaveLength(1);
    expect(first.fact_review_runs).toHaveLength(0);
    expect(first.fact_review_decisions).toHaveLength(1);
    expect(first.fact_review_decisions[0]?.id).toBe(second.fact_review_decisions[0]?.id);
    expect(first.fact_review_decisions[0]).toMatchObject({ review_run_id: "legacy", decision: "accepted", reviewer_identity: "fact-reviewer-1" });
  });

  it("exposes and enforces the seven-module Zhuji contract", () => {
    const instant = "這是一段符合語料條件、包含自然標點的角色話語。";
    const proposal = {
      kind: "zhuji" as const,
      character_id: "yukino",
      module: {
        schema_version: 1 as const,
        mode: "zhuji" as const,
        module: "trait_dialogue" as const,
        title: "特質對話",
        data: {
          人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
          人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
          扮演關鍵要點: ["先觀察再回答"],
          Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: [instant], Results: ["對話保持角色一致"] })),
        },
      },
    };
    expect(zhujiProposalValueSchema.safeParse(proposal).success).toBe(true);
    expect(structuredZhujiModuleSchema.safeParse({ ...proposal.module, module: "unknown" }).success).toBe(false);
    expect(zhujiProposalValueSchema.safeParse({ ...proposal, module: { ...proposal.module, data: { ...proposal.module.data, Traits: proposal.module.data.Traits.slice(0, 2) } } }).success).toBe(false);
    expect(JSON.stringify(zhujiProposalJsonSchema)).toContain("trait_dialogue");
    expect(JSON.stringify(zhujiProposalJsonSchema)).toContain("self_introduction");
    expect(buildZhujiTemplateContext([{ character_id: "yukino", module: "trait_dialogue", title: "特質對話", content: proposal }]).existing[0]?.character_id).toBe("yukino");
  });
});
