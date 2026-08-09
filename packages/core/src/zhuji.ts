import { z } from "zod";

/**
 * Authoritative Zhuji contract.
 *
 * The outer envelope is deliberately strict: a proposal must identify one of
 * the seven modules and must contain that module's required sections.  Leaf
 * sections are passthrough so creators can add useful detail without having
 * to fight an unnecessarily narrow field list.
 */

const text = z.string().trim().min(1);
const readableCorpus = text
  .refine((value) => [...value].length >= 20, "語料必須至少 20 字")
  .refine((value) => /[，。！？；：,.!?;:\n…]/u.test(value), "語料必須使用自然標點斷句")
  .refine((value) => value.split(/[，。！？；：,.!?;:\n…]/u).every((segment) => [...segment].length <= 60), "語料不得連續超過 60 字而沒有斷句");
const openSection = z.record(z.string(), z.unknown());

function textSection(fields: readonly string[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field, text]))).passthrough();
}

function listSection(fields: readonly string[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field, z.array(text).min(1)]))).passthrough();
}

function corpusGroup(label: string) {
  return z.object({ [label]: text, 語料: z.array(readableCorpus).min(1) }).strict();
}

export const zhujiModuleKindSchema = z.enum([
  "appearance",
  "inner_nature",
  "extension",
  "trait_refinement",
  "trait_dialogue",
  "scene_dialogue",
  "self_introduction",
]);

const structuredModuleBase = {
  schema_version: z.literal(1),
  mode: z.literal("zhuji"),
  title: text,
  compile: z.record(z.string(), z.unknown()).default({}),
  provenance: z.array(z.object({ source_id: text, locator: text.optional(), quote: text.optional() }).strict()).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
};

export const zhujiAppearanceDataSchema = z.object({
  外顯核心: textSection(["姓名", "性別", "種族/民族", "背景與職業", "對人物的整體性概括", "角色外顯的核心標籤", "性愛傾向玩法與偏好"]),
  面貌: z.object({
    基礎內容: textSection(["眼睛", "鼻子耳朵", "嘴唇", "眉毛", "面部輪廓", "髮色", "髮型", "整體性描述"]),
    表情刻畫: textSection(["面部習慣", "表情組合", "情緒反饋", "性交反應"]),
  }).passthrough(),
  身體基礎數據: z.object({
    年齡: z.union([text, z.number().nonnegative()]),
    身高: z.union([text, z.number().positive()]),
    體重: z.union([text, z.number().positive()]),
    三圍: text,
    身材描述: text,
    膚色: text,
    性交人數: z.number().int().nonnegative(),
  }).passthrough(),
  性器官特徵: z.object({
    乳房特徵: textSection(["概括", "敏感度表現", "乳頭與乳暈特點", "氣味特點"]),
    生殖器官: textSection(["外觀特點", "長度與硬度/深度與柔軟緊密度", "勃起/濕潤狀態變化與敏感度", "敏感性表現與接觸反應模式", "氣味特點", "體液"]),
    肛門區域: textSection(["緊緻程度", "外觀特點", "敏感性表現與接觸反應模式", "氣味特點"]),
    敏感區域: textSection(["特殊敏感點分布與身體敏感度地圖", "刺激反應類型", "性喚起表現"]),
  }).passthrough(),
  其他器官特徵: z.object({
    手: textSection(["外觀概述", "觸感"]),
    腳: textSection(["外觀概述", "觸感", "氣味"]),
    腋下: textSection(["外觀概述", "觸感", "氣味"]),
    小腹: textSection(["外觀概述", "觸感", "氣味"]),
    腿: textSection(["外觀概述", "觸感", "氣味"]),
    臀部: textSection(["外觀概述", "觸感", "氣味"]),
  }).passthrough(),
  聲音: z.object({
    聲音特質: text,
    說話節奏: text,
    淫語: text,
    語言習慣: textSection(["自稱", "口頭禪", "特殊詞彙偏好", "方言痕跡", "語氣助詞使用", "語言情感程度", "日常用詞選擇"]),
    扮演關鍵要點: z.array(text).min(1),
    不同情境說話模式: z.array(z.object({ 情境: text, 語氣語調與用詞: text, 背後情感: text, 目的與效果: text, 示例: text.optional() }).strict()).min(1),
  }).passthrough(),
  服裝風格與著裝習慣: z.object({
    風格定位: textSection(["日常", "私下性相關"]),
    個人偏好: text,
    穿著範例: textSection(["上半身", "下半身", "鞋", "內衣"]),
    魅力穿著關鍵描述: text,
  }).passthrough(),
  交互模式: z.object({
    肢體動作語言: z.object({
      習慣動作: textSection(["正常", "性愛"]),
      無意識動作: textSection(["正常", "性愛"]),
      情緒化表現差異: z.array(z.object({ "情境或情緒": text, 表現: text }).strict()).min(1),
      偏好體位: text,
      高潮反應: text,
    }).passthrough(),
    肌肉動作: z.object({
      表情神態: text,
      身體應激反應: text,
      身體發情反應: text,
      對愛人接觸模式: textSection(["日常", "性愛"]),
    }).passthrough(),
  }).passthrough(),
  附屬補充內容: z.object({
    獨特標記: z.array(z.object({ 位置與形狀: text, 類型與內容: text, 特殊功能或意義: text.optional() }).strict()),
    文化印記: z.array(z.object({ 類型: text, 表現: text }).strict()),
  }).passthrough(),
  整體感官體驗: z.object({
    描寫核心: text,
    角色代表性的外顯描寫: z.array(z.object({ 場景: text, 描寫: text }).strict()).min(1),
  }).passthrough(),
}).strict();

export const zhujiInnerNatureDataSchema = z.object({
  人物核心定義: textSection(["名稱", "人物核心特質", "人物核心缺陷", "人物對自我的定位", "人物隱藏內在的人格定位"]),
  基礎組成: z.object({
    基礎認識: textSection(["稱謂系統", "年齡認知", "認知水平", "性別認同", "社會角色"]),
    性格基礎: textSection(["性格標籤", "主要性格", "次要特質", "行為表現與禁忌", "心靈的意象"]),
  }).passthrough(),
  內在驅動力: openSection,
  情感架構: openSection,
  潛意識與精神衝突: openSection,
  行為偏好與習慣: openSection,
  過去經歷: openSection,
  極端情緒: openSection,
  人際網絡與歸屬感: openSection,
  內質的生動表達: z.object({
    扮演核心: text,
    內心獨白: text,
    台詞範例: textSection(["友好時", "敵對時", "親密時"]),
    人物代表性的場景描寫: z.array(z.object({ 場景: text, 表現: text }).strict()).min(1),
  }).passthrough(),
}).strict();

export const zhujiExtensionDataSchema = z.object({
  人物核心定義: textSection(["名稱", "社會稱謂", "年齡與出生日期", "身份", "與{{user}}的關係", "所在地", "經濟狀況", "所屬社會團體", "簡介", "外延標籤", "人物外在表現的人格定位"]),
  背景設定與成長經歷: openSection,
  人際關係: openSection,
  社會階層與經濟狀況: openSection,
  行為模式: openSection,
  情緒表現特徵: openSection,
  生活習慣與個性特徵: openSection,
  外延的生動表達: z.object({
    扮演核心: text,
    扮演要點: z.array(text).min(1),
    可能存在的扮演誤區: z.array(text).min(1),
    人物代表性的場景描寫: z.array(z.object({ 場景: text, 表現: text }).strict()).min(1),
  }).passthrough(),
  "對 {{user}}": openSection,
  性相關: openSection,
  人物意象: openSection,
  私人空間營造: openSection,
  差異表現補充: openSection,
}).strict();

export const zhujiTraitRefinementDataSchema = z.object({
  性格特質: z.array(z.object({
    特質群名稱: text,
    群描述: text,
    包含特質: z.array(z.object({
      特質名稱: text,
      來源: text,
      心理深度: z.enum(["極深", "深", "中", "淺"]),
      觸發方式: text,
      描述: text,
      外在表現: z.array(text).min(1),
    }).strict()).min(1),
  }).strict()).min(1),
}).strict();

export const zhujiTraitDialogueDataSchema = z.object({
  人物說話節奏: text,
  人物語言習慣: textSection(["自稱", "口頭禪", "特殊詞彙偏好", "方言痕跡", "語氣助詞使用", "語言情感程度", "用詞程度選擇"]),
  扮演關鍵要點: z.array(text).min(1),
  Traits: z.array(z.object({
    Trait_Name: text,
    Embodiments: z.array(text).min(1),
    inner_thought_prompt: text.optional(),
    instant: z.array(readableCorpus).min(1),
    Results: z.array(text).min(1),
  }).strict()).min(5).max(8),
}).strict();

export const zhujiSceneDialogueDataSchema = z.object({
  核心標籤與特質的風格表現: z.object({
    角色說話節奏: text,
    角色語言習慣: text,
    扮演關鍵要點: z.array(text).min(1),
    標籤: z.array(corpusGroup("標籤名稱")).min(1),
  }).passthrough(),
  "對 {{user}}": z.object({
    初始關係與態度: z.array(readableCorpus).min(1),
    初始認知與在意程度: z.array(readableCorpus).min(1),
    是否想要進一步關係: z.array(readableCorpus).min(1),
    分階段好感度: openSection.optional(),
  }).passthrough(),
  場景刻畫: z.array(corpusGroup("場景")).min(1),
  情緒表現: z.array(corpusGroup("情緒")).min(1),
  面對不同對象: z.array(corpusGroup("對象")).min(1),
}).strict();

export const zhujiSelfIntroductionDataSchema = z.object({
  核心標籤與特質的風格表現: z.object({
    角色說話節奏: text,
    角色語言習慣: text,
    扮演關鍵要點: z.array(readableCorpus).min(1),
    標籤: z.array(z.object({ 標籤名稱: text, 第一人稱語料: readableCorpus }).strict()).min(1),
    核心特質: z.array(z.object({ 特質名稱: text, 第一人稱語料: readableCorpus }).strict()).optional(),
  }).passthrough(),
  "對 {{user}}": z.object({ 初始關係與態度: readableCorpus, 初始認知與在意程度: readableCorpus, 是否想要進一步關係: readableCorpus }).passthrough(),
  外評觀價: z.object({
    對自己容貌的評價: readableCorpus,
    對自己身材的評價: readableCorpus,
    對自己對異性吸引力的評價: readableCorpus,
    服裝風格偏好: textSection(["風格定位", "穿著目的"]),
  }).passthrough(),
  性格基礎: z.object({
    自我與人生觀: openSection,
    動機系統: openSection,
    處事哲學: openSection,
    極端情緒: openSection,
  }).passthrough(),
  能力興趣: z.object({
    職業: readableCorpus,
    技能與特長: readableCorpus,
    日常興趣: readableCorpus,
    喜歡的事物: z.array(readableCorpus).min(3),
    討厭厭惡的事物: z.array(readableCorpus).min(3),
    嗜好: readableCorpus.optional(),
  }).passthrough(),
  背景設定與成長經歷: openSection,
  人際關係: openSection,
  性相關: openSection,
}).passthrough();

export const structuredZhujiModuleSchema = z.discriminatedUnion("module", [
  z.object({ ...structuredModuleBase, module: z.literal("appearance"), data: zhujiAppearanceDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("inner_nature"), data: zhujiInnerNatureDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("extension"), data: zhujiExtensionDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("trait_refinement"), data: zhujiTraitRefinementDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("trait_dialogue"), data: zhujiTraitDialogueDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("scene_dialogue"), data: zhujiSceneDialogueDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("self_introduction"), data: zhujiSelfIntroductionDataSchema }).strict(),
]);

export const zhujiProposalValueSchema = z.object({
  kind: z.literal("zhuji"),
  character_id: z.string().trim().min(1),
  module: structuredZhujiModuleSchema,
}).strict();

export const zhujiProposalJsonSchema = z.toJSONSchema(zhujiProposalValueSchema);

export const requiredZhujiModules = zhujiModuleKindSchema.options;

export type StructuredZhujiModule = z.infer<typeof structuredZhujiModuleSchema>;
export type ZhujiModuleKind = z.infer<typeof zhujiModuleKindSchema>;
export type ZhujiProposalValue = z.infer<typeof zhujiProposalValueSchema>;
