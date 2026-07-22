import { z } from "zod";

import { authorDocumentBodySchema, compileOverrideSchema, defaultCompileOverride, provenanceRefSchema } from "./author-common.js";
import { jsonObjectSchema } from "./json.js";

export const zhujiModuleKindSchema = z.enum([
  "appearance",
  "inner_nature",
  "extension",
  "trait_refinement",
  "trait_dialogue",
  "scene_dialogue",
  "self_introduction",
]);

export const legacyZhujiModuleKindSchema = z.enum([
  "appearance",
  "inner_nature",
  "extension",
  "expanded_extension",
  "trait_refinement",
  "trait_dialogue",
  "scene_dialogue",
  "self_introduction",
]);

const legacyZhujiModuleSchema = authorDocumentBodySchema
  .extend({
    schema_version: z.literal(1),
    mode: z.literal("zhuji"),
    module: legacyZhujiModuleKindSchema,
  })
  .strict();

const structuredModuleBase = {
  schema_version: z.literal(1),
  mode: z.literal("zhuji"),
  title: z.string().min(1),
  compile: compileOverrideSchema.default(defaultCompileOverride),
  provenance: z.array(provenanceRefSchema).default([]),
  extensions: jsonObjectSchema.default({}),
};

const text = z.string().trim().min(1);
const textList = z.array(text);
const corpusBoundary = /[，。！？；：,.!?;:\n…]/u;
const readableCorpus = text
  .refine((value) => [...value].length >= 20, "語料必須至少 20 字")
  .refine((value) => corpusBoundary.test(value), "語料必須使用自然標點斷句")
  .refine(
    (value) => value.split(corpusBoundary).every((segment) => [...segment].length <= 60),
    "語料不得連續超過 60 字而沒有斷句",
  );
const namedText = (name: string, value: string) => z.object({ [name]: text, [value]: text }).strict();

const bodyPartSchema = z.object({ 外觀概述: text, 觸感: text, 氣味: text, 裝飾: text.optional() }).strict();

const reproductiveOrganSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const legacyKey = "濕潤狀態變化與敏感度";
  const canonicalKey = "勃起/濕潤狀態變化與敏感度";
  if (!(legacyKey in source) || canonicalKey in source) return value;
  const normalized: Record<string, unknown> = { ...source, [canonicalKey]: source[legacyKey] };
  delete normalized[legacyKey];
  return normalized;
}, z.object({
  外觀特點: text,
  "長度與硬度/深度與柔軟緊密度": text,
  "勃起/濕潤狀態變化與敏感度": text,
  敏感性表現與接觸反應模式: text,
  氣味特點: text,
  體液: text,
}).strict());

export const zhujiAppearanceDataSchema = z.object({
  外顯核心: z.object({
    姓名: text,
    性別: text,
    "種族/民族": text,
    背景與職業: text,
    對人物的整體性概括: text,
    角色外顯的核心標籤: textList,
    性愛傾向玩法與偏好: text,
  }).strict(),
  面貌: z.object({
    基礎內容: z.object({
      眼睛: text, 鼻子耳朵: text, 嘴唇: text, 眉毛: text, 面部輪廓: text,
      髮色: text, 髮型: text, 其餘: text.optional(), 整體性描述: text,
    }).strict(),
    表情刻畫: z.object({ 面部習慣: text, 表情組合: text, 情緒反饋: text, 性交反應: text }).strict(),
  }).strict(),
  身體基礎數據: z.object({
    年齡: z.union([text, z.number().nonnegative()]),
    身高: z.union([text, z.number().positive()]),
    體重: z.union([text, z.number().positive()]),
    三圍: text,
    身材描述: text,
    膚色: text,
    性交人數: z.number().int().nonnegative(),
  }).strict(),
  性器官特徵: z.object({
    乳房特徵: z.object({ 概括: text, 敏感度表現: text, 乳頭與乳暈特點: text, 氣味特點: text }).strict(),
    生殖器官: reproductiveOrganSchema,
    肛門區域: z.object({ 緊緻程度: text, 外觀特點: text, 敏感性表現與接觸反應模式: text, 氣味特點: text }).strict(),
    敏感區域: z.object({ 特殊敏感點分布與身體敏感度地圖: text, 刺激反應類型: text, 性喚起表現: text }).strict(),
  }).strict(),
  其他器官特徵: z.object({
    手: z.object({ 外觀概述: text, 觸感: text, 氣味: text.optional(), 裝飾: text.optional() }).strict(),
    腳: bodyPartSchema,
    腋下: bodyPartSchema,
    小腹: bodyPartSchema,
    腿: bodyPartSchema,
    臀部: bodyPartSchema,
  }).strict(),
  聲音: z.object({
    聲音特質: text,
    說話節奏: text,
    淫語: text,
    語言習慣: z.object({
      自稱: text, 口頭禪: text, 特殊詞彙偏好: text, 方言痕跡: text,
      語氣助詞使用: text, 語言情感程度: text, 日常用詞選擇: text,
    }).strict(),
    扮演關鍵要點: textList,
    不同情境說話模式: z.array(z.object({
      情境: text, 語氣語調與用詞: text, 背後情感: text, 目的與效果: text, 示例: text.optional(),
    }).strict()),
  }).strict(),
  服裝風格與著裝習慣: z.object({
    風格定位: z.object({ 日常: text, 私下性相關: text }).strict(),
    個人偏好: text,
    穿著範例: z.object({ 上半身: text, 下半身: text, 鞋: text, 內衣: text, 裝飾物: text.optional() }).strict(),
    魅力穿著關鍵描述: text,
  }).strict(),
  交互模式: z.object({
    肢體動作語言: z.object({
      習慣動作: z.object({ 正常: text, 性愛: text }).strict(),
      無意識動作: z.object({ 正常: text, 性愛: text }).strict(),
      情緒化表現差異: z.array(namedText("情境或情緒", "表現")),
      偏好體位: text,
      高潮反應: text,
    }).strict(),
    肌肉動作: z.object({
      表情神態: text, 身體應激反應: text, 身體發情反應: text,
      對愛人接觸模式: z.object({ 日常: text, 性愛: text }).strict(),
    }).strict(),
  }).strict(),
  附屬補充內容: z.object({
    獨特標記: z.array(z.object({ 位置與形狀: text, 類型與內容: text, 特殊功能或意義: text.optional() }).strict()),
    文化印記: z.array(z.object({ 類型: text, 表現: text }).strict()),
  }).strict(),
  整體感官體驗: z.object({
    描寫核心: text,
    角色代表性的外顯描寫: z.array(z.object({ 場景: text, 描寫: text }).strict()).min(3).max(5),
  }).strict(),
}).strict();

export const zhujiInnerNatureDataSchema = z.object({
  人物核心定義: z.object({ 名稱: text, 人物核心特質: text, 人物核心缺陷: text, 人物對自我的定位: text, 人物隱藏內在的人格定位: text }).strict(),
  基礎組成: z.object({
    基礎認識: z.object({
      稱謂系統: text, 作品來源: text.optional(),
      年齡認知: z.object({ 實際年齡: z.union([text, z.number()]), 心智年齡: z.union([text, z.number()]), 自我感知年齡: z.union([text, z.number()]) }).strict(),
      認知水平: text, 性別認同: text, 社會角色: text,
    }).strict(),
    性格基礎: z.object({
      性格標籤: z.object({ 淺層性格: textList, 內在本質: textList }).strict(),
      主要性格: text, 次要特質: text, 行為表現與禁忌: text,
      心靈的意象: z.object({ 意象: textList, 意義: text }).strict(),
    }).strict(),
  }).strict(),
  內在驅動力: z.object({
    精神核心: z.object({ 對世界的核心態度: text, "人生核心追求/人生優先級": text, 價值取向: text, 道德底線: text, 生命意義: text, 內心禁忌: text }).strict(),
    行動模式: z.object({ 思維模式: text, 決策風格: text, 風險承受度: text, 應對壓力: text, 迴避逃避: text }).strict(),
    動機系統: z.object({
      核心訴求: z.object({ 項目: textList.min(3).max(5), 實現路徑: text }).strict(),
      當下追求: z.object({ 項目: textList.min(3).max(5), 實現路徑: text }).strict(),
    }).strict(),
  }).strict(),
  情感架構: z.object({
    情緒運作: z.object({ 情緒模式: text, 情緒表達: text, 依戀類型: text }).strict(),
    情感與精神世界: z.object({
      精神世界構成: text, 情感變化: z.object({ 觸發點: text, 波動規律: text }).strict(),
      精神寄託: text.optional(), 潛在心理狀態: text.optional(), 恐懼: text.optional(),
    }).strict(),
    愛情觀念: z.object({ 愛情態度: text, 戀愛需求: text, 關係模式: text, 親密行為: text }).strict(),
    性相關觀念: z.object({
      對於性交的態度: text, 個人性癖: textList.min(3).max(8), 性癖成因: text, 性癖對人格的影響: text,
      性幻想: text.optional(), 對性交對象的要求: text, 對性行為的需求程度: text, 希望在性行為中的地位: text,
    }).strict(),
    社會情感: z.object({ 認為最可信的社會關係: text.optional(), 對親情的態度: text, 對友情的定義: text, 對陌生人的信任度: text }).strict(),
  }).strict(),
  潛意識與精神衝突: z.object({
    潛意識: z.object({ 潛在性格: text.optional(), 潛在追求: text.optional(), 潛在恐懼與心理弱點: text.optional() }).strict(),
    內心衝突: z.object({ 信念衝突: text.optional(), 自我矛盾: text.optional(), 隱藏創傷: text.optional() }).strict(),
  }).strict(),
  行為偏好與習慣: z.object({
    日常模式: z.object({
      生活習慣: text, 興趣愛好: textList.min(3).max(5), 自我評價: text, 對待他人方式: text,
      喜歡熱衷的事物: textList.min(3).max(5), 討厭厭惡的事物: textList.min(3).max(5),
    }).strict(),
    處事哲學: z.object({ 反應方式: text, 衝突應對: text, 自我保護機制: text, 失敗後的反應: text }).strict(),
  }).strict(),
  過去經歷: z.object({
    重要事件: z.object({ 童年經歷: text, 重大打擊: text.optional(), 形成信念的關鍵瞬間: text }).strict(),
    心靈成長: z.object({ 曾經信奉的價值觀: text, 重大思想轉變: text.optional(), 如何面對自身改變: text }).strict(),
    社會關係: z.object({ 核心關係: text, 社會認知: text }).strict(),
  }).strict(),
  極端情緒: z.object({
    精神寄託: z.object({ 人生支柱: text, 依賴事物: text, 無法失去的核心存在: text }).strict(),
    可能陷入的極端情緒: z.object({ 何種情況下爆發: text.optional(), 情緒種類: text, 心理折磨: text.optional() }).strict(),
  }).strict(),
  人際網絡與歸屬感: z.object({
    社交需求: z.object({ 喜歡的交流方式: text, 是否容易建立親密關係: text, 對社會地位的敏感度: text }).strict(),
    存在感需求: z.object({ 渴望的社會認可: text, 是否依賴外界評價塑造自我: text, 能否忍受被孤立或否定: text }).strict(),
    核心需求: z.array(z.object({ 需求名稱: text, 需求內容: text, 行為影響: text }).strict()),
  }).strict(),
  內質的生動表達: z.object({
    扮演核心: text, 內心獨白: text,
    台詞範例: z.object({ 友好時: text, 敵對時: text, 親密時: text }).strict(),
    人物代表性的場景描寫: z.array(z.object({ 場景: text, 表現: text }).strict()).min(3).max(5),
  }).strict(),
}).strict();

export const zhujiExtensionDataSchema = z.object({
  人物核心定義: z.object({
    名稱: text, 社會稱謂: textList, 年齡與出生日期: text, 身份: text, "與{{user}}的關係": text,
    所在地: text, 經濟狀況: text, 所屬社會團體: textList, 簡介: text, 外延標籤: textList.min(5).max(8),
    人物外在表現的人格定位: text,
    能力興趣: z.object({
      職業: text, 天賦: textList, 技能與特長: textList, 日常興趣: textList,
      喜歡的事物: textList.min(3), 討厭厭惡的事物: textList.min(3), 嗜好: textList.min(1),
    }).strict(),
  }).strict(),
  背景設定與成長經歷: z.object({
    背景簡要概括: text,
    家庭環境: z.object({ 當前家庭成員與關係: text, 當前家庭背景: text, 人物對家庭的感受與態度: text }).strict(),
    成長經歷: z.object({ 出生時間地點: text, 童年經歷: text, 教育程度與知識積累: text, 成長軌跡: text, 重要老師或同學: text.optional() }).strict(),
     重要成長經歷: z.array(z.object({ 事件: text, 對人物與社會身份的影響: text }).strict()).min(3),
  }).strict(),
  人際關係: z.object({
    人物需求: z.object({ 人物自身的社交模式: text, 社交圈類型: text, 性格因素造成的依賴程度: text, 社會因素造成的依賴程度: text }).strict(),
    人物傾向: z.object({ 需求人際關係種類傾向: text, 拒絕人際關係種類傾向: text }).strict(),
    人物當前的人際關係: z.object({ 親密的朋友: text.optional(), 個人親密小團體: text.optional(), 服務對象: text.optional(), 使役對象: text.optional(), 特殊感情對象: text.optional() }).strict(),
    人物關係初始化模式: z.object({
      初次接觸時的表現與印象: text, 深入接觸後的表現與實際印象: text, 對新接觸者的態度與信任程度: text,
      容易產生好感的特質: textList, 容易產生厭惡的特質: textList,
    }).strict(),
  }).strict(),
  社會階層與經濟狀況: z.object({
    社會階級地位: z.object({ 社會身份: text, 社會階層與地位: text, 社會評價: text, 自己對社會身份的看法: text }).strict(),
    社會職能: z.object({ 社會權利: text, 社會責任: text, 社會義務: text, 自己對社會職能履行的看法: text }).strict(),
    社會關係: z.object({ 社會主張: text, 盟友: textList, 敵對: textList, 潛在關係: textList }).strict(),
  }).strict(),
  行為模式: z.object({
    社會交互模式: z.object({ 社交傾向: text, 社交語言: text, 社會形象塑造: text, 環境下的差異: text.optional() }).strict(),
    決策與判斷邏輯: z.object({ 行為動機來源: text, 問題解決方式: text, 思想光譜: text }).strict(),
    風險承受能力: z.object({ 面對失敗的態度: text, 失敗後的自我調節: text }).strict(),
    權力與控制欲: z.object({ 權力欲與控制欲: text, 面對權力鬥爭的反應: text }).strict(),
    道德與倫理觀: z.object({ 對道德的態度: text, 利他性: text }).strict(),
  }).strict(),
  情緒表現特徵: z.object({
    情緒模式: z.object({ 情感表達方式: text, 表達途徑: text, 描寫概括: z.array(z.object({ 場景: text, 表現: text }).strict()) }).strict(),
    壓力情緒: z.object({ 面對壓力的情緒反應: text, 壓力承受程度: text }).strict(),
    情緒特質: z.object({
      自信心與自尊: text, 自律與自我約束能力: text, 好奇心與探索欲: text, 對他人的要求與管轄: text,
      創傷與心理陰影: text.optional(), 面對暴力與衝突: text, 反抗與服從傾向: text, 信任與懷疑傾向: text, "信仰/信念與忠誠": text.optional(),
    }).strict(),
  }).strict(),
  生活習慣與個性特徵: z.object({
    生活習慣: z.object({ 生活作息: text, 飲食偏好: text, 衛生與整潔度: text, 特殊習慣或癖好: text.optional() }).strict(),
    好感度表現: z.object({ 心理意識: text, 對好感對象的行為: text, 追求方式: text }).strict(),
  }).strict(),
  外延的生動表達: z.object({
    扮演核心: text, 扮演要點: textList.min(3).max(5), 可能存在的扮演誤區: textList.min(3).max(5),
    人物代表性的場景描寫: z.array(z.object({ 場景: text, 表現: text }).strict()),
  }).strict(),
  "對 {{user}}": z.object({
    初始看法: z.object({
      初始關係: text, 初始感情與態度: text, 初始認知與在意程度: text, 互動表現核心: text,
      互動模式: z.array(z.object({ 模式: text, 心理或關係邏輯: text, 行為影響: text, 示例台詞: text }).strict()).min(5).max(8),
    }).strict(),
    人物經歷: z.object({
      "與{{user}}過去的經歷": text,
      "與{{user}}過去的重要事件": z.array(z.object({ 事件: text, 關係與情感影響: text }).strict()),
      對過去經歷的看法: text,
      "與{{user}}的期望關係": text.optional(),
    }).strict(),
    行為細化: z.object({
      "對{{user}}的稱呼": z.array(z.object({ 情境: text, 稱呼: text, 情感與效果: text }).strict()),
      "對{{user}}的說話模式": z.array(z.object({ 情境: text, 語氣語調與用詞: text, 背後情感: text, 目的效果: text }).strict()),
      "對{{user}}的肢體互動": z.array(z.object({ 情境或關係階段: text, 互動模式: text }).strict()),
    }).strict(),
    情感變化路徑: z.object({
      交往前: z.object({ 行為表現: text, 心理: text, 語氣: text }).strict(),
      交往後: z.object({ 行為表現: text, 心理: text, 語氣: text }).strict(),
      發生性關係後: z.object({ 行為表現: text, 心理: text, 語氣: text }).strict(),
    }).strict(),
  }).strict(),
  性相關: z.object({
    性經驗: z.object({ 性經歷: text, 初次體驗: text, 所有性交對象: text, 性交需求: text, 性伴侶: text, 自慰習慣: text }).strict(),
    性知識: z.object({ 常識性知識: text, 玩法知識: text, 對性知識態度: text }).strict(),
    性習慣: z.object({
      性行為習慣: textList.min(4).max(7), 偏好: textList.min(4).max(7), 擅長技術: textList.min(3).max(5),
      行為反應: z.object({ 發情前後: text, 前戲: text, 性愛過程: text, 事後: text }).strict(),
    }).strict(),
  }).strict(),
  人物意象: z.object({ 專名: text, 氛圍意象: text, 物質意象: text }).strict(),
  私人空間營造: z.object({ 私人空間類型: text.optional(), 私人空間風格: text, 私人空間佈置: text, 人物在私人空間的行為: text }).strict(),
  差異表現補充: z.object({
    環境性表現: z.array(namedText("環境", "表現")).min(3).max(5),
    身份性表現: z.array(z.object({ 身份: text, 面對對象: text, 表現: text }).strict()).min(3).max(5),
    氛圍性表現: z.array(namedText("氛圍或關係定位", "表現")).min(3).max(5),
  }).strict(),
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
      外在表現: textList,
    }).strict()).min(1),
  }).strict()).min(1).superRefine((groups, context) => {
    const count = groups.reduce((total, group) => total + group.包含特質.length, 0);
    if (count < 5 || count > 8) context.addIssue({ code: "custom", message: "全角色必須包含 5 至 8 個特質" });
  }),
}).strict();

export const zhujiTraitDialogueDataSchema = z.object({
  人物說話節奏: text,
  人物語言習慣: z.object({
    自稱: text, 口頭禪: text, 特殊詞彙偏好: text, 方言痕跡: text,
    語氣助詞使用: text, 語言情感程度: text, 用詞程度選擇: text,
  }).strict(),
  扮演關鍵要點: textList,
  Traits: z.array(z.object({
    Trait_Name: text,
    Embodiments: textList,
    inner_thought_prompt: text.optional(),
    instant: z.array(readableCorpus).min(3).max(5),
    Results: textList,
  }).strict()).min(5).max(8),
}).strict();

const corpusGroup = (name: string) => z.object({ [name]: text, 語料: z.array(readableCorpus).min(1) }).strict();

export const zhujiSceneDialogueDataSchema = z.object({
  核心標籤與特質的風格表現: z.object({
    角色說話節奏: text,
    角色語言習慣: text,
    扮演關鍵要點: textList,
    標籤: z.array(corpusGroup("標籤名稱")).min(3).max(8),
  }).strict(),
  "對 {{user}}": z.object({
    初始關係與態度: z.array(readableCorpus).min(1),
    初始認知與在意程度: z.array(readableCorpus).min(1),
    是否想要進一步關係: z.array(readableCorpus).min(1),
     分階段好感度: z.object({
       初始關係: z.array(readableCorpus).length(3).optional(),
       好朋友: z.array(readableCorpus).length(3).optional(),
       戀人未滿: z.array(readableCorpus).length(3).optional(),
       戀人: z.array(readableCorpus).length(3).optional(),
       摯愛: z.array(readableCorpus).length(3).optional(),
     }).passthrough().optional(),
  }).strict(),
  場景刻畫: z.array(corpusGroup("場景")).min(3),
  情緒表現: z.array(corpusGroup("情緒")).min(3),
  面對不同對象: z.array(corpusGroup("對象")).min(3),
}).strict();

export const zhujiSelfIntroductionDataSchema = z.object({
  核心標籤與特質的風格表現: z.object({
    角色說話節奏: text,
    角色語言習慣: text,
    扮演關鍵要點: z.array(readableCorpus),
    標籤: z.array(z.object({ 標籤名稱: text, 第一人稱語料: readableCorpus }).strict()),
    核心特質: z.array(z.object({ 特質名稱: text, 第一人稱語料: readableCorpus }).strict()).optional(),
  }).strict(),
  "對 {{user}}": z.object({ 初始關係與態度: readableCorpus, 初始認知與在意程度: readableCorpus, 是否想要進一步關係: readableCorpus }).strict(),
  外評觀價: z.object({
    對自己容貌的評價: readableCorpus,
    對自己身材的評價: readableCorpus,
    對自己對異性吸引力的評價: readableCorpus,
    服裝風格偏好: z.object({ 風格定位: readableCorpus, 穿著目的: readableCorpus }).strict(),
  }).strict(),
  性格基礎: z.object({
    自我與人生觀: z.object({ 對自己性格的評價與認識: readableCorpus, 對世界的核心態度: readableCorpus, 對道德的認識: readableCorpus, 生命意義的認識: readableCorpus, 內心禁忌: readableCorpus }).strict(),
    動機系統: z.object({ 核心訴求與實現方式: readableCorpus, 當下追求: readableCorpus, 實現路徑: readableCorpus }).strict(),
    處事哲學: z.object({ 對衝突的看法與反應: readableCorpus, 如何自我保護: readableCorpus, 如何面對失敗: readableCorpus }).strict(),
    極端情緒: z.object({ 絕對無法接受的事情: readableCorpus, 絕對無法失去的東西: readableCorpus, 如果真的發生後的反應: readableCorpus }).strict(),
  }).strict(),
  能力興趣: z.object({
    職業: readableCorpus, 技能與特長: readableCorpus, 日常興趣: readableCorpus,
     喜歡的事物: z.array(readableCorpus).min(3), 討厭厭惡的事物: z.array(readableCorpus).min(3), 嗜好: readableCorpus.optional(),
  }).strict(),
  背景設定與成長經歷: z.object({ 家庭環境: readableCorpus, 成長經歷: readableCorpus, 重要的人: readableCorpus.optional(), 自己對社會身份的看法: readableCorpus, 自己對社會職能的看法: readableCorpus }).strict(),
  人際關係: z.object({
    角色需求: z.object({ 角色自身的社交模式: readableCorpus, 最渴望的關係: readableCorpus, 社交圈類型: readableCorpus, 人際關係的依賴程度: readableCorpus, 對工作對象的態度: readableCorpus, 特殊感情對象: readableCorpus.optional() }).strict(),
    人物關係初始化模式: z.object({ 對新接觸者會怎麼表現: readableCorpus, 希望留下什麼印象: readableCorpus, 對新接觸者的態度與信任程度: readableCorpus, 喜歡親近什麼人: readableCorpus, 討厭什麼樣的人: readableCorpus, 好感度表現: readableCorpus }).strict(),
  }).strict(),
   性相關: z.object({ 個人性癖: readableCorpus, 性癖對人格的影響: readableCorpus, 性幻想: readableCorpus.optional(), 性經歷: readableCorpus, 性生活: readableCorpus, 第一次性交對象: readableCorpus.optional() }).strict(),
}).passthrough();

const legacyObjectSection = jsonObjectSchema;
const legacyArraySection = z.array(z.unknown());
const legacyDataSchemas = {
  appearance: z.object({
    外顯核心: legacyObjectSection, 面貌: legacyObjectSection, 身體基礎數據: legacyObjectSection,
    性器官特徵: legacyObjectSection, 其他器官特徵: legacyObjectSection, 聲音: legacyObjectSection,
    服裝風格與著裝習慣: legacyObjectSection, 交互模式: legacyObjectSection, 整體感官體驗: legacyObjectSection,
  }).strict(),
  inner_nature: z.object({
    人物核心定義: legacyObjectSection, 基礎組成: legacyObjectSection, 內在驅動力: legacyObjectSection,
    情感架構: legacyObjectSection, 潛意識與精神衝突: legacyObjectSection, 行為偏好與習慣: legacyObjectSection,
    過去經歷: legacyObjectSection, 極端情緒: legacyObjectSection, 人際網絡與歸屬感: legacyObjectSection, 內質的生動表達: legacyObjectSection,
  }).strict(),
  extension: z.object({
    人物核心定義: legacyObjectSection, 背景設定與成長經歷: legacyObjectSection, 人際關係: legacyObjectSection,
    社會階層與經濟狀況: legacyObjectSection, 行為模式: legacyObjectSection, 情緒表現特徵: legacyObjectSection,
    生活習慣與個性特徵: legacyObjectSection, 外延的生動表達: legacyObjectSection,
  }).strict(),
  expanded_extension: z.object({
    "對 {{user}}": legacyObjectSection, 性相關: legacyObjectSection, 人物意象: legacyObjectSection,
    私人空間營造: legacyObjectSection, 差異表現補充: legacyObjectSection,
  }).strict(),
  trait_refinement: z.object({ 性格特質: legacyArraySection }).strict(),
  scene_dialogue: z.object({ 核心標籤與特質的風格表現: legacyObjectSection, "對 {{user}}": legacyObjectSection, 場景刻畫: legacyArraySection }).strict(),
  self_introduction: z.object({ 核心標籤與特質的風格表現: legacyObjectSection, "對 {{user}}": legacyObjectSection, 外評觀價: legacyObjectSection, 性格基礎: legacyObjectSection }).strict(),
} as const;

export const structuredZhujiModuleSchema = z.discriminatedUnion("module", [
  z.object({ ...structuredModuleBase, module: z.literal("appearance"), data: zhujiAppearanceDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("inner_nature"), data: zhujiInnerNatureDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("extension"), data: zhujiExtensionDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("trait_refinement"), data: zhujiTraitRefinementDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("trait_dialogue"), data: zhujiTraitDialogueDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("scene_dialogue"), data: zhujiSceneDialogueDataSchema }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("self_introduction"), data: zhujiSelfIntroductionDataSchema }).strict(),
]);

export const legacyStructuredZhujiModuleSchema = z.discriminatedUnion("module", [
  z.object({ ...structuredModuleBase, module: z.literal("appearance"), data: legacyDataSchemas.appearance }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("inner_nature"), data: legacyDataSchemas.inner_nature }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("extension"), data: legacyDataSchemas.extension }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("expanded_extension"), data: legacyDataSchemas.expanded_extension }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("trait_refinement"), data: legacyDataSchemas.trait_refinement }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("scene_dialogue"), data: legacyDataSchemas.scene_dialogue }).strict(),
  z.object({ ...structuredModuleBase, module: z.literal("self_introduction"), data: legacyDataSchemas.self_introduction }).strict(),
]);

export const zhujiModuleSchema = z.union([structuredZhujiModuleSchema, legacyStructuredZhujiModuleSchema, legacyZhujiModuleSchema]);

export const requiredZhujiModules = zhujiModuleKindSchema.options;

export type ZhujiModule = z.infer<typeof zhujiModuleSchema>;
export type StructuredZhujiModule = z.infer<typeof structuredZhujiModuleSchema>;
export type ZhujiModuleKind = z.infer<typeof zhujiModuleKindSchema>;
export type LegacyZhujiModuleKind = z.infer<typeof legacyZhujiModuleKindSchema>;
