import type { ZhujiModuleKind } from "./zhuji.js";
import { AUTHORING_KNOWLEDGE_RULES, type AuthoringKnowledgeContext } from "./authoring-context.js";

export interface ZhujiTemplateInstance {
  readonly character_id: string;
  readonly module: ZhujiModuleKind;
  readonly title: string;
  readonly content: unknown;
  readonly revision?: string;
  readonly artifact_id?: string;
}

export const ZHUJI_MODULE_GUIDES = [
  {
    order: 1,
    module: "appearance",
    title: "外觀",
    purpose: "建立角色可被看見、觸碰、聽見與辨識的外顯身體和互動表現；不要只寫靜態外貌。",
    required_sections: ["外顯核心", "面貌", "身體基礎數據", "性器官特徵", "其他器官特徵", "聲音", "服裝風格與著裝習慣", "交互模式", "附屬補充內容", "整體感官體驗"],
    field_hints: {
      聲音: ["聲音特質", "說話節奏", "語言習慣", "扮演關鍵要點", "不同情境說話模式"],
      交互模式: ["習慣動作", "無意識動作", "情緒化表現差異", "偏好體位", "高潮反應"],
    },
    example: "data.聲音.說話節奏要能直接影響台詞生成；data.整體感官體驗要提供至少一個可演出的場景。",
  },
  {
    order: 2,
    module: "inner_nature",
    title: "內在本質",
    purpose: "定義角色的核心人格、價值觀、驅動力、情緒、衝突、經歷與內心聲音，作為所有後續模組的性格根基。",
    required_sections: ["人物核心定義", "基礎組成", "內在驅動力", "情感架構", "潛意識與精神衝突", "行為偏好與習慣", "過去經歷", "極端情緒", "人際網絡與歸屬感", "內質的生動表達"],
    field_hints: { 人物核心定義: ["名稱", "人物核心特質", "人物核心缺陷", "人物對自我的定位", "人物隱藏內在的人格定位"], 內質的生動表達: ["扮演核心", "內心獨白", "台詞範例", "人物代表性的場景描寫"] },
    example: "data.內在驅動力與 data.情感架構要說明角色為何行動，而非只列形容詞。",
  },
  {
    order: 3,
    module: "extension",
    title: "延伸設定",
    purpose: "把核心人格延伸到身分、背景、社會位置、生活、關係、對 user 的互動與私密空間。",
    required_sections: ["人物核心定義", "背景設定與成長經歷", "人際關係", "社會階層與經濟狀況", "行為模式", "情緒表現特徵", "生活習慣與個性特徵", "外延的生動表達", "對 {{user}}", "性相關", "人物意象", "私人空間營造", "差異表現補充"],
    field_hints: { "對 {{user}}": ["初始看法", "過去經歷", "稱呼", "說話模式", "肢體互動", "情感變化路徑"], 差異表現補充: ["環境性表現", "身份性表現", "氛圍性表現"] },
    example: "同一個角色在學校、私人空間、陌生人面前與面對 user 時，應能產生可辨識的差異。",
  },
  {
    order: 4,
    module: "trait_refinement",
    title: "特質細化",
    purpose: "把人格形容詞拆成可觸發、可觀察、可在行為與台詞中呈現的 5 至 8 個特質。",
    required_sections: ["性格特質"],
    field_hints: { 性格特質: ["特質群名稱", "群描述", "特質名稱", "來源", "心理深度", "觸發方式", "描述", "外在表現"] },
    example: "每個特質都要有觸發方式與外在表現，不能只寫『溫柔』『傲嬌』等標籤。",
  },
  {
    order: 5,
    module: "trait_dialogue",
    title: "特質對話",
    purpose: "把特質轉成模型可直接使用的說話節奏、用詞習慣、內心提示、即時語料與結果。",
    required_sections: ["人物說話節奏", "人物語言習慣", "扮演關鍵要點", "Traits"],
    field_hints: { 人物語言習慣: ["自稱", "口頭禪", "特殊詞彙偏好", "方言痕跡", "語氣助詞使用", "語言情感程度", "用詞程度選擇"], Traits: ["Trait_Name", "Embodiments", "inner_thought_prompt", "instant", "Results"] },
    example: "Traits 必須有 5 至 8 個，每個 instant 都是自然、有標點且能直接模仿的角色語料。",
  },
  {
    order: 6,
    module: "scene_dialogue",
    title: "場景對話",
    purpose: "提供不同場景、情緒、對象與關係階段的可直接演出語料，讓角色不會只在單一語境說話。",
    required_sections: ["核心標籤與特質的風格表現", "對 {{user}}", "場景刻畫", "情緒表現", "面對不同對象"],
    field_hints: { "核心標籤與特質的風格表現": ["角色說話節奏", "角色語言習慣", "扮演關鍵要點", "標籤"], "對 {{user}}": ["初始關係與態度", "初始認知與在意程度", "是否想要進一步關係", "分階段好感度"] },
    example: "至少提供場景、情緒、對象三種維度；每筆語料要能看出觸發條件與角色反應。",
  },
  {
    order: 7,
    module: "self_introduction",
    title: "自我介紹",
    purpose: "用角色第一人稱整理常態自我介紹與自我認知；這是角色模組，不是專案級 greeting。",
    required_sections: ["核心標籤與特質的風格表現", "對 {{user}}", "外評觀價", "性格基礎", "能力興趣", "背景設定與成長經歷", "人際關係", "性相關"],
    field_hints: { "核心標籤與特質的風格表現": ["角色說話節奏", "角色語言習慣", "扮演關鍵要點", "標籤", "核心特質"], "對 {{user}}": ["初始關係與態度", "初始認知與在意程度", "是否想要進一步關係"] },
    example: "所有第一人稱語料都要符合角色聲線；不得把 self_introduction 當作 greeting 或第三人稱摘要。",
  },
] as const satisfies ReadonlyArray<{
  readonly order: number;
  readonly module: ZhujiModuleKind;
  readonly title: string;
  readonly purpose: string;
  readonly required_sections: readonly string[];
  readonly field_hints: Readonly<Record<string, readonly string[]>>;
  readonly example: string;
}>;

export const zhujiCreatorContract = {
  role: "Zhuji Creator",
  goal: "依角色核心與既有決策，產出一個完整、可驗證、可直接供模型演出的珠璣模組；七個模組合起來才是完整珠璣角色。",
  order: ZHUJI_MODULE_GUIDES.map((guide) => guide.module),
    rules: [
      "先讀取珠璣 context 與既有模組，維持同一角色的聲線、關係與世界設定。",
      "一次提交一個 module；module 必須使用七個固定 kind 之一。",
      "不可把 trait_dialogue、scene_dialogue 或 self_introduction 合併成自由文字。",
      "self_introduction 是角色自我介紹常態設定，不是專案級 greeting。",
      "內容可以擴充，但不得省略該模組的 required_sections。",
      ...AUTHORING_KNOWLEDGE_RULES,
    ],
} as const;

export function buildZhujiTemplateContext(existing: readonly ZhujiTemplateInstance[] = [], knowledge?: AuthoringKnowledgeContext) {
  return {
    contract_version: 1,
    creator_contract: zhujiCreatorContract,
    module_order: ZHUJI_MODULE_GUIDES.map((guide) => guide.module),
    modules: ZHUJI_MODULE_GUIDES,
    existing,
    ...(knowledge === undefined ? {} : { knowledge }),
  };
}
