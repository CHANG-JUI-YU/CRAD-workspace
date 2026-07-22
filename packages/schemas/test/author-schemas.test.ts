import { describe, expect, it } from "vitest";

import {
  greetingsDocumentSchema,
  paletteModuleSchema,
  projectManifestSchema,
  requiredPaletteModules,
  requiredZhujiModules,
  relationshipsDocumentSchema,
  structuredZhujiModuleSchema,
  worldEntrySchema,
  zhujiAppearanceDataSchema,
  zhujiModuleSchema,
} from "../src/index.js";

const body = { title: "標題", content: "內容" };

describe("作者模式 schemas", () => {
  it("固定珠璣七模組且模組7是 self_introduction", () => {
    expect(requiredZhujiModules).toEqual([
      "appearance",
      "inner_nature",
      "extension",
      "trait_refinement",
      "trait_dialogue",
      "scene_dialogue",
      "self_introduction",
    ]);
    for (const module of requiredZhujiModules) expect(module).not.toBe("expanded_extension");
    expect(zhujiModuleSchema.safeParse({ schema_version: 1, mode: "zhuji", module: "greeting", ...body }).success).toBe(false);
  });

  it("固定調色盤四模組", () => {
    expect(requiredPaletteModules).toEqual([
      "basic_information",
      "personality_palette",
      "tri_faceted",
      "secondary_interpretation",
    ]);
    for (const module of requiredPaletteModules) {
      expect(
        paletteModuleSchema.parse({ schema_version: 1, mode: "palette", module, ...body }).module,
      ).toBe(module);
    }
  });

  it("自訂 sections、compile override、provenance 與 extensions 可往返", () => {
    const parsed = zhujiModuleSchema.parse({
      schema_version: 1,
      mode: "zhuji",
      module: "appearance",
      ...body,
      sections: [
        {
          id: "custom-detail",
          title: "自訂",
          content: "細節",
          compile: {
            category: "character-detail",
            activation: { type: "keyed", keys: ["別名"] },
          },
          provenance: [{ kind: "fact", ref: "fact-1" }],
          extensions: { vendor: { keep: [1, true] } },
        },
      ],
    });
    if (!("sections" in parsed)) throw new TypeError("預期 legacy Zhuji module");
    expect(parsed.sections[0]?.extensions).toEqual({ vendor: { keep: [1, true] } });
    expect(parsed.sections[0]?.compile.activation).toMatchObject({ type: "keyed", keys: ["別名"] });
  });

  it.each([
    ["appearance", {
      外顯核心: {}, 面貌: {}, 身體基礎數據: {}, 性器官特徵: {}, 其他器官特徵: {},
      聲音: {}, 服裝風格與著裝習慣: {}, 交互模式: {}, 整體感官體驗: {},
    }],
    ["inner_nature", {
      人物核心定義: {}, 基礎組成: {}, 內在驅動力: {}, 情感架構: {}, 潛意識與精神衝突: {},
      行為偏好與習慣: {}, 過去經歷: {}, 極端情緒: {}, 人際網絡與歸屬感: {}, 內質的生動表達: {},
    }],
    ["extension", {
      人物核心定義: {}, 背景設定與成長經歷: {}, 人際關係: {}, 社會階層與經濟狀況: {},
      行為模式: {}, 情緒表現特徵: {}, 生活習慣與個性特徵: {}, 外延的生動表達: {},
    }],
    ["expanded_extension", {
      "對 {{user}}": {}, 性相關: {}, 人物意象: {}, 私人空間營造: {}, 差異表現補充: {},
    }],
    ["trait_refinement", { 性格特質: [] }],
    ["scene_dialogue", { 核心標籤與特質的風格表現: {}, "對 {{user}}": {}, 場景刻畫: [] }],
    ["self_introduction", {
      核心標籤與特質的風格表現: {}, "對 {{user}}": {}, 外評觀價: {}, 性格基礎: {},
    }],
  ] as const)("接受 %s 的原生巢狀 data", (module, data) => {
    const parsed = zhujiModuleSchema.parse({ schema_version: 1, mode: "zhuji", module, title: "標題", data });
    expect("data" in parsed && parsed.data).toEqual(data);
  });

  it("新寫入接受 trait_dialogue 並拒絕 expanded_extension，read union 保留舊格式", () => {
    const corpus = "我知道自己說話總是太直接，但我寧可把真正的想法說清楚，也不願讓你一直猜測。";
    const trait = {
      schema_version: 1, mode: "zhuji", module: "trait_dialogue", title: "特質語料",
      data: {
        人物說話節奏: "節奏", 人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直白", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
        扮演關鍵要點: ["維持聲線"],
        Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index}`, Embodiments: ["定義"], instant: [corpus, corpus, corpus], Results: ["結果"] })),
      },
    };
    expect(structuredZhujiModuleSchema.safeParse(trait).success).toBe(true);
    const expanded = { schema_version: 1, mode: "zhuji", module: "expanded_extension", title: "舊外延", data: { "對 {{user}}": {}, 性相關: {}, 人物意象: {}, 私人空間營造: {}, 差異表現補充: {} } };
    expect(structuredZhujiModuleSchema.safeParse(expanded).success).toBe(false);
    expect(zhujiModuleSchema.safeParse(expanded).success).toBe(true);
  });

  it("語料接受自然分句的短段落，拒絕過短或超長無斷句內容", () => {
    const corpus = "我知道自己說話總是太直接，但我寧可把真正的想法說清楚，也不願讓你一直猜測。";
    const trait = (instant: string) => ({
      schema_version: 1, mode: "zhuji", module: "trait_dialogue", title: "特質語料",
      data: {
        人物說話節奏: "節奏",
        人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "直白", 方言痕跡: "無", 語氣助詞使用: "少", 語言情感程度: "高", 用詞程度選擇: "具體" },
        扮演關鍵要點: ["維持聲線"],
        Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `特質${index}`, Embodiments: ["定義"], instant: [instant, instant, instant], Results: ["結果"] })),
      },
    });
    expect(structuredZhujiModuleSchema.safeParse(trait(corpus)).success).toBe(true);
    expect(structuredZhujiModuleSchema.safeParse(trait("太短了。")).success).toBe(false);
    expect(structuredZhujiModuleSchema.safeParse(trait(`${"這".repeat(61)}。`)).success).toBe(false);
  });

  it("讀取既有外顯資料時正規化女性生殖器官的舊欄位別名", () => {
    const parsed = zhujiAppearanceDataSchema.shape.性器官特徵.shape.生殖器官.parse({
      外觀特點: "外觀",
      "長度與硬度/深度與柔軟緊密度": "深度",
      濕潤狀態變化與敏感度: "濕潤變化",
      敏感性表現與接觸反應模式: "接觸反應",
      氣味特點: "氣味",
      體液: "體液",
    });
    expect(parsed).toEqual({
      外觀特點: "外觀",
      "長度與硬度/深度與柔軟緊密度": "深度",
      "勃起/濕潤狀態變化與敏感度": "濕潤變化",
      敏感性表現與接觸反應模式: "接觸反應",
      氣味特點: "氣味",
      體液: "體液",
    });
  });

  it("拒絕缺少固定區塊或混用其他模組 data", () => {
    const appearance = {
      外顯核心: {}, 面貌: {}, 身體基礎數據: {}, 性器官特徵: {}, 其他器官特徵: {},
      聲音: {}, 服裝風格與著裝習慣: {}, 交互模式: {},
    };
    expect(zhujiModuleSchema.safeParse({
      schema_version: 1, mode: "zhuji", module: "appearance", title: "外顯", data: appearance,
    }).success).toBe(false);
    expect(zhujiModuleSchema.safeParse({
      schema_version: 1, mode: "zhuji", module: "trait_refinement", title: "特質細化", data: { 場景刻畫: [] },
    }).success).toBe(false);
  });
});

describe("世界與 Greetings schemas", () => {
  it.each([
    "people",
    "geography",
    "organizations",
    "history",
    "concepts",
    "systems",
    "items",
    "events",
  ] as const)("接受世界類別 %s", (category) => {
    expect(
      worldEntrySchema.parse({ schema_version: 1, id: `entry-${category}`, category, ...body }).category,
    ).toBe(category);
  });

  it("Greetings 恰有一個 primary 並支援群像", () => {
    const parsed = greetingsDocumentSchema.parse({
      schema_version: 1,
      greetings: [
        { id: "opening", kind: "primary", content: "開場", character_ids: ["alice", "bob"] },
        { id: "alternate", kind: "alternate", content: "替代", character_ids: ["alice"] },
        { id: "group", kind: "group_only", content: "群組", character_ids: ["alice", "bob"] },
      ],
    });
    expect(parsed.greetings.map((greeting) => greeting.kind)).toEqual([
      "primary",
      "alternate",
      "group_only",
    ]);
  });

  it("拒絕零個、多個 primary 與重複 greeting ID", () => {
    expect(
      greetingsDocumentSchema.safeParse({
        schema_version: 1,
        greetings: [{ id: "one", kind: "alternate", content: "A", character_ids: ["alice"] }],
      }).success,
    ).toBe(false);
    expect(
      greetingsDocumentSchema.safeParse({
        schema_version: 1,
        greetings: [
          { id: "same", kind: "primary", content: "A", character_ids: ["alice"] },
          { id: "same", kind: "primary", content: "B", character_ids: ["alice"] },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("共享角色關係 schema", () => {
  const document = {
    schema_version: 1 as const,
    team_code: "ABC123",
    character_ids: ["alice", "bob"],
    character_summaries: [
      { character_id: "alice", summary: "冷靜的領導者" },
      { character_id: "bob", summary: "直率的協作者" },
    ],
    perspectives: [
      { source_character_id: "alice", target_character_id: "alice", summary: "自認理性" },
      { source_character_id: "alice", target_character_id: "bob", summary: "信任但保持戒心" },
      { source_character_id: "bob", target_character_id: "alice", summary: "尊敬但不盲從" },
      { source_character_id: "bob", target_character_id: "bob", summary: "自認坦率" },
    ],
    groups: [{
      id: "core-team",
      name: "核心小組",
      member_ids: ["alice", "bob"],
      formation_cause: "共同目標",
      operating_pattern: "協商決策",
      exclusivity: "對外保守",
      latent_conflicts: ["控制權"],
      joining_conditions: "取得雙方信任",
    }],
    summary: {
      network_character: "互補且緊密",
      inter_group_relations: "目前只有核心小組",
      stability: "穩定但受權力衝突影響",
      conflict_triggers: [{ trigger: "單方面決策", severity: "high" as const }],
      intimacy_opportunities: ["共同承擔風險"],
    },
  };

  it("接受完整 directional matrix、self pairs、groups 與作者共通欄位", () => {
    expect(relationshipsDocumentSchema.parse(document)).toMatchObject({
      team_code: "ABC123",
      compile: { activation: { type: "default" } },
      provenance: [],
      extensions: {},
    });
  });

  it("拒絕非法 team code、缺矩陣 cell、外部群組成員與未知欄位", () => {
    expect(relationshipsDocumentSchema.safeParse({ ...document, team_code: "abc123" }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...document, perspectives: document.perspectives.slice(1) }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({
      ...document,
      groups: [{ ...document.groups[0], member_ids: ["alice", "nobody"] }],
    }).success).toBe(false);
    expect(relationshipsDocumentSchema.safeParse({ ...document, thinking: "hidden" }).success).toBe(false);
  });
});

describe("正式 Project Manifest", () => {
  it("要求 card 契約並拒絕舊 card_profile", () => {
    const base = {
      schema_version: 1,
      id: "demo",
      title: "示範",
      kind: "character_card",
      characters: [{ id: "alice", display_name: "愛麗絲", mode: "zhuji", role: "primary" }],
    };
    expect(
      projectManifestSchema.parse({ ...base, card: { name: "示範卡" } }).card,
    ).toEqual({ name: "示範卡", profile: "minimal_worldbook", avatar: undefined });
    expect(projectManifestSchema.safeParse({ ...base, card_profile: {} }).success).toBe(false);
  });
});
