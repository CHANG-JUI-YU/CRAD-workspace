import { describe, expect, it } from "vitest";

import {
  agentRegistrySchema,
  blueprintSchema,
  handoffSchema,
  personalityProfileSchema,
  proposalSchema,
  registeredContractReferences,
  resolveContractSchema,
  reviewReportSchema,
  toolPolicySchema,
  taskFailureCategorySchema,
  workflowDefinitionsSchema,
  workflowTaskSchema,
} from "../src/index.js";

const hash = `sha256:${"b".repeat(64)}`;
const corpus = "我會直接把自己的想法和感受告訴你，不用旁人替我解釋，也不會用含糊的場景敘述遮掩真正立場。當我靠近你時，每句話都會維持相同的語氣、詞彙與情緒脈絡，讓你清楚知道我正在期待、抗拒或猶豫什麼；即使關係與處境改變，我仍會以自己的聲音完整說完，而不是突然退回冷淡的履歷介紹。";
const body = {
  schema_version: 1 as const,
  mode: "zhuji" as const,
  module: "trait_dialogue" as const,
  title: "特質語料",
  data: {
    人物說話節奏: "先短句試探，再用長句完整表態。",
    人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直接", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
    扮演關鍵要點: ["維持第一人稱聲線"],
    Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index + 1}`, Embodiments: ["直接表達"], instant: [corpus, corpus, corpus], Results: ["維持一致聲線"] })),
  },
};

const selfIntroduction = {
  schema_version: 1 as const,
  mode: "zhuji" as const,
  module: "self_introduction" as const,
  title: "第一人稱自我介紹",
  data: {
    核心標籤與特質的風格表現: {
      角色說話節奏: "先短句試探，再用長句完整表態。", 角色語言習慣: "使用直接而具情緒的第一人稱語句。",
      扮演關鍵要點: [corpus], 標籤: [{ 標籤名稱: "直接", 第一人稱語料: corpus }], 核心特質: [{ 特質名稱: "坦率", 第一人稱語料: corpus }],
    },
    "對 {{user}}": { 初始關係與態度: corpus, 初始認知與在意程度: corpus, 是否想要進一步關係: corpus },
    外評觀價: { 對自己容貌的評價: corpus, 對自己身材的評價: corpus, 對自己對異性吸引力的評價: corpus, 服裝風格偏好: { 風格定位: corpus, 穿著目的: corpus } },
    性格基礎: {
      自我與人生觀: { 對自己性格的評價與認識: corpus, 對世界的核心態度: corpus, 對道德的認識: corpus, 生命意義的認識: corpus, 內心禁忌: corpus },
      動機系統: { 核心訴求與實現方式: corpus, 當下追求: corpus, 實現路徑: corpus },
      處事哲學: { 對衝突的看法與反應: corpus, 如何自我保護: corpus, 如何面對失敗: corpus },
      極端情緒: { 絕對無法接受的事情: corpus, 絕對無法失去的東西: corpus, 如果真的發生後的反應: corpus },
    },
    能力興趣: { 職業: corpus, 技能與特長: corpus, 日常興趣: corpus, 喜歡的事物: [corpus, corpus, corpus], 討厭厭惡的事物: [corpus, corpus, corpus], 嗜好: corpus },
    背景設定與成長經歷: { 家庭環境: corpus, 成長經歷: corpus, 重要的人: corpus, 自己對社會身份的看法: corpus, 自己對社會職能的看法: corpus },
    人際關係: {
      角色需求: { 角色自身的社交模式: corpus, 最渴望的關係: corpus, 社交圈類型: corpus, 人際關係的依賴程度: corpus, 對工作對象的態度: corpus, 特殊感情對象: corpus },
      人物關係初始化模式: { 對新接觸者會怎麼表現: corpus, 希望留下什麼印象: corpus, 對新接觸者的態度與信任程度: corpus, 喜歡親近什麼人: corpus, 討厭什麼樣的人: corpus, 好感度表現: corpus },
    },
    性相關: { 個人性癖: corpus, 性癖對人格的影響: corpus, 性幻想: corpus, 性經歷: corpus, 性生活: corpus, 第一次性交對象: corpus },
  },
};

const blueprint = {
  schema_version: 1 as const,
  project_id: "demo",
  entry_kind: "original" as const,
  purpose: "建立角色卡",
  characters: [{ id: "alice", display_name: "愛麗絲", mode: "zhuji" as const, core_concept: "核心", fact_refs: ["fact-1"] }],
  world: { enabled: true, authoring_timing: "before_characters" as const, categories: ["concepts" as const], fact_refs: ["fact-2"] },
  greetings: { enabled: true, character_ids: ["alice"], requirements: ["保留玩家自由度"] },
  fact_refs: ["fact-1", "fact-2"],
  unresolved_decisions: [{ id: "tone", question: "語氣？", impact: "影響對白" }],
  approved_revision: 4,
};

describe("Blueprint、Handoff、Proposal 與 Review", () => {
  it("Blueprint 涵蓋模式、世界觀、greetings、facts、決策與批准 revision", () => {
    expect(blueprintSchema.parse({ ...blueprint, collaboration_mode: "assisted" })).toMatchObject({ collaboration_mode: "assisted", approved_revision: 4, world: { authoring_timing: "before_characters" } });
    expect(blueprintSchema.parse(blueprint).collaboration_mode).toBe("free");
    expect(blueprintSchema.safeParse({ ...blueprint, collaboration_mode: "automatic" }).success).toBe(false);
    expect(blueprintSchema.parse({ ...blueprint, world: { enabled: true } }).world.authoring_timing).toBeUndefined();
    expect(blueprintSchema.parse(blueprint).relationships).toEqual({ enabled: false, character_ids: [], requirements: [], extensions: {} });
    expect(blueprintSchema.safeParse({ ...blueprint, relationships: { enabled: true, character_ids: ["alice"] } }).success).toBe(false);
    expect(blueprintSchema.safeParse({ ...blueprint, relationships: { enabled: true, character_ids: ["alice", "missing"] } }).success).toBe(false);
  });

  it("proposal union 解析 relationships 且 registry 註冊 relationships@1", () => {
    const document = {
      schema_version: 1 as const,
      team_code: "ABC123",
      character_ids: ["alice", "bob"],
      character_summaries: [{ character_id: "alice", summary: "A" }, { character_id: "bob", summary: "B" }],
      perspectives: [
        { source_character_id: "alice", target_character_id: "alice", summary: "AA" },
        { source_character_id: "alice", target_character_id: "bob", summary: "AB" },
        { source_character_id: "bob", target_character_id: "alice", summary: "BA" },
        { source_character_id: "bob", target_character_id: "bob", summary: "BB" },
      ],
      summary: { network_character: "N", inter_group_relations: "I", stability: "S" },
    };
    expect(proposalSchema.parse({
      schema_version: 1,
      id: "proposal-relationships",
      owner: "relationship-creator",
      base_workflow_revision: 1,
      value: { kind: "relationships", document },
    }).value.kind).toBe("relationships");
    expect(registeredContractReferences).toContain("relationships@1");
    expect(resolveContractSchema("relationships@1").safeParse(document).success).toBe(true);
  });

  it("Task clarification 僅接受一致的 pending/resolved 狀態", () => {
    const task = { id: "task-a", kind: "create", status: "needs_user_decision", assigned_agent: "creator", capabilities: [], input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 1, max_attempts: 3, extensions: {}, clarifications: [{
      id: "clarification-a", status: "pending", question: "選哪一種？", reason: "影響核心", uncertainty: "high", impact: "high", affected_modules: ["extension"], options: [{ id: "a", label: "A", consequence: "結果A" }, { id: "b", label: "B", consequence: "結果B" }], requested_at: "2026-07-14T00:00:00.000Z",
    }] };
    expect(workflowTaskSchema.safeParse(task).success).toBe(true);
    expect(workflowTaskSchema.safeParse({ ...task, clarifications: [{ ...task.clarifications[0], selected_option: "a" }] }).success).toBe(false);
    expect(workflowTaskSchema.safeParse({ ...task, clarifications: [{ ...task.clarifications[0], status: "resolved", resolved_at: "2026-07-14T00:01:00.000Z", answer: "A", selected_option: "missing" }] }).success).toBe(false);
  });

  it("Task failure metadata 使用 typed category 並相容 legacy failure", () => {
    const task = {
      id: "task-failed", kind: "create", status: "failed", assigned_agent: "creator", capabilities: [],
      input_artifacts: [], output_contract: "proposal@1", dependencies: [], attempt: 3, max_attempts: 3,
      failure_summary: "Provider timed out", failure: {
        category: "provider_timeout", summary: "Provider timed out", failed_at: "2026-07-18T00:00:00.000Z",
        failed_by: "creator", attempt: 3,
      }, extensions: {},
    };
    expect(workflowTaskSchema.parse(task).failure).toEqual(task.failure);
    expect(taskFailureCategorySchema.safeParse("semantic_failure").success).toBe(true);
    expect(taskFailureCategorySchema.safeParse("made_up").success).toBe(false);
    expect(workflowTaskSchema.safeParse({ ...task, failure: undefined }).success).toBe(true);
    expect(workflowTaskSchema.safeParse({ ...task, failure: { ...task.failure, category: "made_up" } }).success).toBe(false);
  });

  it("Blueprint 不接受角色或 greetings Token 預算，但保留世界設定預算", () => {
    expect(blueprintSchema.safeParse({
      ...blueprint,
      characters: [{ ...blueprint.characters[0], token_budget: 4096 }],
    }).success).toBe(false);
    expect(blueprintSchema.safeParse({
      ...blueprint,
      greetings: { ...blueprint.greetings, token_budget: 1024 },
    }).success).toBe(false);
    expect(blueprintSchema.safeParse({
      ...blueprint,
      world: { ...blueprint.world, token_budget: 2048 },
    }).success).toBe(true);
  });

  it("Handoff 只接受公開摘要欄位，不接受私密思維鏈", () => {
    const valid = {
      schema_version: 1,
      task_id: "task-1",
      agent_id: "zhuji-creator",
      project_id: "demo",
      workflow_revision: 2,
      requirements: ["撰寫模組7"],
      evidence: [{ summary: "已批准藍圖", artifact: { id: "blueprint", revision: hash } }],
      assumptions: [],
      decision_summaries: ["採珠璣模式"],
      artifacts: [],
    };
    expect(handoffSchema.safeParse(valid).success).toBe(true);
    expect(handoffSchema.safeParse({ ...valid, chain_of_thought: "private" }).success).toBe(false);
  });

  it("Proposal 有 owner、base revision 與 typed value，拒絕 path/shell/patch", () => {
    const valid = {
      schema_version: 1,
      id: "proposal-1",
      owner: "zhuji-creator",
      base_workflow_revision: 2,
      value: { kind: "zhuji", character_id: "alice", module: body },
    };
    expect(proposalSchema.parse(valid).value.kind).toBe("zhuji");
    expect(proposalSchema.safeParse({ ...valid, path: "C:\\absolute", shell: "rm", patch: [] }).success).toBe(false);
    expect(proposalSchema.safeParse({
      ...valid,
      value: { kind: "zhuji", character_id: "alice", module: { ...body, data: undefined, content: "legacy" } },
    }).success).toBe(false);
  });

  it("模組7只通過 Zhuji proposal，不會通過 greetings contract", () => {
    const common = { schema_version: 1, id: "proposal-7", owner: "zhuji-creator", base_workflow_revision: 2 };
    expect(proposalSchema.safeParse({ ...common, value: { kind: "zhuji", character_id: "alice", module: selfIntroduction } }).success).toBe(true);
    expect(proposalSchema.safeParse({ ...common, value: { kind: "greetings", document: selfIntroduction } }).success).toBe(false);
  });

  it("Review finding 保存 severity、evidence、hint、overridability 與 target revision", () => {
    expect(reviewReportSchema.parse({
      schema_version: 1,
      id: "review-1",
      reviewer: "character-critic",
      target_id: "proposal-1",
      target_revision: hash,
      findings: [{ id: "finding-1", severity: "warning", summary: "重複", evidence: [{ source: "proposal", excerpt: "內容" }], hint: "精簡", overridable: true }],
      summary: "需修訂",
    }).findings[0]?.overridable).toBe(true);
  });
});

describe("Agent configs 與 schema registry", () => {
  it("所有 config schemas strict", () => {
    expect(agentRegistrySchema.safeParse({ schema_version: 1, agents: [], unknown: true }).success).toBe(false);
    expect(toolPolicySchema.safeParse({ schema_version: 1, rules: [], unknown: true }).success).toBe(false);
    expect(workflowDefinitionsSchema.safeParse({ schema_version: 1, definitions: [], unknown: true }).success).toBe(false);
    expect(personalityProfileSchema.safeParse({ schema_version: 1, id: "neutral", tone: "中性", style: [], unknown: true }).success).toBe(false);
  });

  it("穩定 registry 可解析全部已註冊 contract 並拒絕未知版本", () => {
    expect(registeredContractReferences).toContain("facts-curation-summary@1");
    expect(registeredContractReferences).toContain("fact-register@1");
    expect(registeredContractReferences).toContain("conflict-register@1");
    for (const reference of registeredContractReferences) {
      expect(resolveContractSchema(reference)).toBeDefined();
    }
    expect(() => resolveContractSchema("proposal@2")).toThrow("Unknown contract reference");
  });
});
