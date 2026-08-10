import { describe, expect, it } from "vitest";
import { MemoryProjectRepository, contentHash, type ArtifactRecord, type BlueprintPrecheckRecord, type OperationRecord, type TemplateProposalValue } from "@st-workspace/core";
import { ConversionService } from "../src/index.js";
import { PALETTE_REQUIRED_MODULES, ZHUJI_REQUIRED_MODULES } from "../src/required-artifacts.js";

type ConversionProposal = Extract<TemplateProposalValue, { kind: "conversion" }>;
type ConversionModule = ConversionProposal["modules"][number];

const readableCorpus = "這是一段符合語料條件、包含自然標點的角色話語。";

function textFields(fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, "穩定而清楚的角色設定。"]));
}

function corpusGroup(label: string): Array<Record<string, unknown>> {
  return [{ [label]: "一般情境", 語料: [readableCorpus] }];
}

function zhujiData(module: (typeof ZHUJI_REQUIRED_MODULES)[number]): unknown {
  if (module === "appearance") {
    const organ = (fields: readonly string[]) => textFields(fields);
    return {
      外顯核心: textFields(["姓名", "性別", "種族/民族", "背景與職業", "對人物的整體性概括", "角色外顯的核心標籤", "性愛傾向玩法與偏好"]),
      面貌: { 基礎內容: textFields(["眼睛", "鼻子耳朵", "嘴唇", "眉毛", "面部輪廓", "髮色", "髮型", "整體性描述"]), 表情刻畫: textFields(["面部習慣", "表情組合", "情緒反饋", "性交反應"]) },
      身體基礎數據: { 年齡: "20", 身高: "170", 體重: "60", 三圍: "90/60/90", 身材描述: "勻稱而健康。", 膚色: "自然膚色。", 性交人數: 0 },
      性器官特徵: {
        乳房特徵: organ(["概括", "敏感度表現", "乳頭與乳暈特點", "氣味特點"]),
        生殖器官: organ(["外觀特點", "長度與硬度/深度與柔軟緊密度", "勃起/濕潤狀態變化與敏感度", "敏感性表現與接觸反應模式", "氣味特點", "體液"]),
        肛門區域: organ(["緊緻程度", "外觀特點", "敏感性表現與接觸反應模式", "氣味特點"]),
        敏感區域: organ(["特殊敏感點分布與身體敏感度地圖", "刺激反應類型", "性喚起表現"]),
      },
      其他器官特徵: {
        手: organ(["外觀概述", "觸感"]),
        腳: organ(["外觀概述", "觸感", "氣味"]),
        腋下: organ(["外觀概述", "觸感", "氣味"]),
        小腹: organ(["外觀概述", "觸感", "氣味"]),
        腿: organ(["外觀概述", "觸感", "氣味"]),
        臀部: organ(["外觀概述", "觸感", "氣味"]),
      },
      聲音: {
        聲音特質: "清晰而平穩。",
        說話節奏: "短句並有停頓。",
        淫語: "克制而直接。",
        語言習慣: textFields(["自稱", "口頭禪", "特殊詞彙偏好", "方言痕跡", "語氣助詞使用", "語言情感程度", "日常用詞選擇"]),
        扮演關鍵要點: ["先觀察再回答。"],
        不同情境說話模式: [{ 情境: "日常", 語氣語調與用詞: "平穩", 背後情感: "信任", 目的與效果: "建立清楚溝通。" }],
      },
      服裝風格與著裝習慣: {
        風格定位: textFields(["日常", "私下性相關"]),
        個人偏好: "簡潔而實用。",
        穿著範例: textFields(["上半身", "下半身", "鞋", "內衣"]),
        魅力穿著關鍵描述: "整潔而符合場合。",
      },
      交互模式: {
        肢體動作語言: {
          習慣動作: textFields(["正常", "性愛"]),
          無意識動作: textFields(["正常", "性愛"]),
          情緒化表現差異: [{ "情境或情緒": "壓力", 表現: "保持專注。" }],
          偏好體位: "尊重彼此節奏。",
          高潮反應: "自然而真實。",
        },
        肌肉動作: { 表情神態: "平靜。", 身體應激反應: "短暫停頓。", 身體發情反應: "依情境變化。", 對愛人接觸模式: textFields(["日常", "性愛"]) },
      },
      附屬補充內容: { 獨特標記: [], 文化印記: [] },
      整體感官體驗: { 描寫核心: "清楚而穩定。", 角色代表性的外顯描寫: [{ 場景: "午後", 描寫: "安靜地觀察周遭。" }] },
    };
  }
  if (module === "inner_nature") {
    return {
      人物核心定義: textFields(["名稱", "人物核心特質", "人物核心缺陷", "人物對自我的定位", "人物隱藏內在的人格定位"]),
      基礎組成: { 基礎認識: textFields(["稱謂系統", "年齡認知", "認知水平", "性別認同", "社會角色"]), 性格基礎: textFields(["性格標籤", "主要性格", "次要特質", "行為表現與禁忌", "心靈的意象"]) },
      內在驅動力: {},
      情感架構: {},
      潛意識與精神衝突: {},
      行為偏好與習慣: {},
      過去經歷: {},
      極端情緒: {},
      人際網絡與歸屬感: {},
      內質的生動表達: { 扮演核心: "保持清醒。", 內心獨白: "我會先看清楚再決定。", 台詞範例: textFields(["友好時", "敵對時", "親密時"]), 人物代表性的場景描寫: [{ 場景: "會議", 表現: "先整理資訊再回應。" }] },
    };
  }
  if (module === "extension") {
    return {
      人物核心定義: textFields(["名稱", "社會稱謂", "年齡與出生日期", "身份", "與{{user}}的關係", "所在地", "經濟狀況", "所屬社會團體", "簡介", "外延標籤", "人物外在表現的人格定位"]),
      背景設定與成長經歷: {}, 人際關係: {}, 社會階層與經濟狀況: {}, 行為模式: {}, 情緒表現特徵: {}, 生活習慣與個性特徵: {},
      外延的生動表達: { 扮演核心: "延伸而不矛盾。", 扮演要點: ["保留核心設定。"], 可能存在的扮演誤區: ["不要忽略脈絡。"], 人物代表性的場景描寫: [{ 場景: "街道", 表現: "保持觀察。" }] },
      "對 {{user}}": {}, 性相關: {}, 人物意象: {}, 私人空間營造: {}, 差異表現補充: {},
    };
  }
  if (module === "trait_refinement") {
    return { 性格特質: [{ 特質群名稱: "核心", 群描述: "穩定而清楚。", 包含特質: [{ 特質名稱: "冷靜", 來源: "核心設定", 心理深度: "中", 觸發方式: "壓力", 描述: "保持觀察。", 外在表現: ["語氣穩定。"] }] }] };
  }
  if (module === "trait_dialogue") {
    return {
      人物說話節奏: "冷靜、直接，句子短而有明確停頓。",
      人物語言習慣: { 自稱: "我", 口頭禪: "嗯", 特殊詞彙偏好: "精準詞彙", 方言痕跡: "無", 語氣助詞使用: "克制", 語言情感程度: "低調", 用詞程度選擇: "正式" },
      扮演關鍵要點: ["先觀察再回答"],
      Traits: Array.from({ length: 5 }, (_, index) => ({ Trait_Name: `Trait ${index + 1}`, Embodiments: ["在壓力下保持清晰"], instant: [readableCorpus], Results: ["對話保持角色一致"] })),
    };
  }
  if (module === "scene_dialogue") {
    return {
      核心標籤與特質的風格表現: { 角色說話節奏: "平穩。", 角色語言習慣: "精準。", 扮演關鍵要點: ["保持一致。"], 標籤: corpusGroup("標籤名稱") },
      "對 {{user}}": { 初始關係與態度: [readableCorpus], 初始認知與在意程度: [readableCorpus], 是否想要進一步關係: [readableCorpus] },
      場景刻畫: corpusGroup("場景"), 情緒表現: corpusGroup("情緒"), 面對不同對象: corpusGroup("對象"),
    };
  }
  return {
    核心標籤與特質的風格表現: { 角色說話節奏: "平穩。", 角色語言習慣: "精準。", 扮演關鍵要點: [readableCorpus], 標籤: [{ 標籤名稱: "冷靜", 第一人稱語料: readableCorpus }] },
    "對 {{user}}": { 初始關係與態度: readableCorpus, 初始認知與在意程度: readableCorpus, 是否想要進一步關係: readableCorpus },
    外評觀價: { 對自己容貌的評價: readableCorpus, 對自己身材的評價: readableCorpus, 對自己對異性吸引力的評價: readableCorpus, 服裝風格偏好: textFields(["風格定位", "穿著目的"]) },
    性格基礎: { 自我與人生觀: {}, 動機系統: {}, 處事哲學: {}, 極端情緒: {} },
    能力興趣: { 職業: readableCorpus, 技能與特長: readableCorpus, 日常興趣: readableCorpus, 喜歡的事物: [readableCorpus, readableCorpus, readableCorpus], 討厭厭惡的事物: [readableCorpus, readableCorpus, readableCorpus] },
    背景設定與成長經歷: {}, 人際關係: {}, 性相關: {},
  };
}

function zhujiModule(module: (typeof ZHUJI_REQUIRED_MODULES)[number]): ConversionModule {
  return { schema_version: 1, mode: "zhuji", module, title: module, data: zhujiData(module), provenance: [], extensions: {} } as ConversionModule;
}

function paletteModule(module: (typeof PALETTE_REQUIRED_MODULES)[number], content = `A stable ${module} module.`): ConversionModule {
  return { schema_version: 1, mode: "palette", module, title: module, content, sections: {}, provenance: [], extensions: {} } as ConversionModule;
}

const completePaletteModules = PALETTE_REQUIRED_MODULES.map((module) => paletteModule(module));
const completeZhujiModules = ZHUJI_REQUIRED_MODULES.map((module) => zhujiModule(module));

function operation(id: string): OperationRecord {
  const timestamp = new Date().toISOString();
  return { id, kind: "authoring", request: "conversion", status: "running", created_at: timestamp, updated_at: timestamp, progress: [] };
}

function artifact(id: string, key: string, kind: "zhuji" | "palette", value: unknown, binding?: Pick<ArtifactRecord, "blueprint_precheck_id" | "blueprint_precheck_revision">): ArtifactRecord {
  const content = JSON.stringify(value);
  const hash = contentHash(content);
  const timestamp = new Date().toISOString();
  return { id, key, kind, name: key, content, media_type: "application/json", content_hash: hash, revision: hash, status: "draft", created_at: timestamp, updated_at: timestamp, created_by: "creator", operation_id: "source-operation", ...binding };
}

function sourceArtifacts(mode: "zhuji" | "palette", binding?: Pick<ArtifactRecord, "blueprint_precheck_id" | "blueprint_precheck_revision">): ArtifactRecord[] {
  const modules = mode === "zhuji" ? ZHUJI_REQUIRED_MODULES : PALETTE_REQUIRED_MODULES;
  return modules.map((module) => artifact(
    `source-${mode}-${module}`,
    `${mode}:demo-${module}`,
    mode,
    mode === "palette"
      ? { kind: "palette", character_id: "demo", module: paletteModule(module as (typeof PALETTE_REQUIRED_MODULES)[number]) }
      : { kind: "zhuji", character_id: "demo", module: zhujiModule(module as (typeof ZHUJI_REQUIRED_MODULES)[number]) },
    binding,
  ));
}

function recordedBlueprint(id: string, revisionSeed: string): BlueprintPrecheckRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    schema_version: 1,
    project_id: "demo",
    operation_id: `operation-${id}`,
    collaboration_mode: "free",
    candidate_blueprint: { project_id: "demo", characters: [{ id: "demo", label: "Demo", mode: "zhuji" }] },
    candidate_blueprint_revision: contentHash(revisionSeed),
    checks: [{ subject_id: "demo", dimension: "character_core", uncertainty: "low", impact: "high", basis: "explicit", action: "preserve_explicit" }],
    status: "recorded",
    created_at: timestamp,
    created_by: "director",
  };
}

const conversion: ConversionProposal = {
  kind: "conversion",
  character_id: "demo",
  source_mode: "zhuji",
  target_mode: "palette",
  modules: completePaletteModules,
  mappings: [{ source: "appearance", target: "basic_information", summary: "Maps the stable appearance core.", provenance: "authored", expected_loss: "none" }],
  unmapped: [],
};

describe("mode conversion materialization", () => {
  it("materializes target drafts without changing the source and reuses identical revisions", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-convert" )],
      artifacts: sourceArtifacts("zhuji"),
    }));
    const before = await repository.read();
    const sourceContentBefore = before.artifacts.find((item) => item.id === "source-zhuji-appearance")!.content;
    const service = new ConversionService(repository);
    const first = await service.materialize("op-convert", conversion, "mode-conversion");
    const afterFirst = await repository.read();
    const sourceBefore = afterFirst.artifacts.find((item) => item.id === "source-zhuji-appearance")!;
    const target = afterFirst.artifacts.find((item) => item.kind === "palette" && item.name === "demo/basic_information")!;
    expect(first.target_artifact_ids).toHaveLength(PALETTE_REQUIRED_MODULES.length);
    expect(target.status).toBe("draft");
    expect(target.based_on).toBeUndefined();
    expect(JSON.parse(target.content).module.extensions["card-workspace"].conversion.mapping_digest).toBeDefined();
    expect(JSON.parse(target.content).module.extensions["card-workspace"].conversion.source_artifacts).toHaveLength(ZHUJI_REQUIRED_MODULES.length);
    expect(sourceBefore.content).toBe(sourceContentBefore);
    expect(afterFirst.audit.at(-1)?.event).toBe("conversion.materialized");

    await repository.commit(afterFirst.revision, (state) => ({ ...state, operations: [...state.operations, operation("op-convert-again")] }));
    const second = await service.materialize("op-convert-again", conversion, "mode-conversion");
    const afterSecond = await repository.read();
    expect(second.artifact_ids).toEqual(first.artifact_ids);
    expect(afterSecond.artifacts.filter((item) => item.kind === "palette")).toHaveLength(PALETTE_REQUIRED_MODULES.length);
  });

  it("fails closed when the source mode is absent and writes nothing", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-missing-source")] }));
    const before = await repository.read();
    await expect(new ConversionService(repository).materialize("op-missing-source", conversion, "mode-conversion")).rejects.toMatchObject({ code: "CONVERSION_SOURCE_NOT_FOUND" });
    const after = await repository.read();
    expect(after.revision).toBe(before.revision);
    expect(after.artifacts).toEqual(before.artifacts);
  });

  it("materializes the reverse palette-to-zhuji direction", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-reverse")],
      artifacts: sourceArtifacts("palette"),
    }));
    const reverse: Extract<TemplateProposalValue, { kind: "conversion" }> = {
      kind: "conversion",
      character_id: "demo",
      source_mode: "palette",
      target_mode: "zhuji",
      modules: completeZhujiModules,
      mappings: [{ source: "basic_information", target: "trait_dialogue", summary: "Maps the palette baseline into dialogue behavior." }],
      unmapped: [],
    };
    const result = await new ConversionService(repository).materialize("op-reverse", reverse, "mode-conversion");
    const state = await repository.read();
    expect(result.target_artifact_ids).toHaveLength(ZHUJI_REQUIRED_MODULES.length);
    const traitDialogueId = result.target_artifact_ids.find((id) => state.artifacts.find((candidate) => candidate.id === id)?.name === "demo/trait_dialogue");
    expect(state.artifacts.find((item) => item.id === traitDialogueId)).toMatchObject({ kind: "zhuji", name: "demo/trait_dialogue", status: "draft" });
  });

  it("uses only the latest revision for each source logical key in provenance", async () => {
    const repository = new MemoryProjectRepository("demo");
    const oldSource = artifact("source-appearance-old", "zhuji:demo-appearance", "zhuji", { kind: "zhuji", character_id: "demo", module: { ...zhujiModule("appearance"), title: "Old" } });
    const latestSource = artifact("source-appearance-latest", "zhuji:demo-appearance", "zhuji", { kind: "zhuji", character_id: "demo", module: { ...zhujiModule("appearance"), title: "Latest" } });
    const otherSources = sourceArtifacts("zhuji").filter((item) => item.key !== "zhuji:demo-appearance");
    await repository.commit(0, (state) => ({ ...state, operations: [operation("op-latest")], artifacts: [oldSource, ...otherSources, latestSource] }));

    await new ConversionService(repository).materialize("op-latest", conversion, "mode-conversion");
    const state = await repository.read();
    const report = state.artifacts.find((item) => item.kind === "conversion")!;
    const references = JSON.parse(report.content).source_artifacts as Array<{ artifact_id: string; revision: string }>;
    expect(references).toEqual(expect.arrayContaining([expect.objectContaining({ artifact_id: latestSource.id, revision: latestSource.revision })]));
    expect(references.some((reference) => reference.artifact_id === oldSource.id)).toBe(false);
  });

  it("rejects an incomplete source mode with a recoverable missing-module diagnostic", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({
      ...state,
      operations: [operation("op-incomplete-source")],
      artifacts: sourceArtifacts("zhuji").slice(0, 2),
    }));
    await expect(new ConversionService(repository).materialize("op-incomplete-source", conversion, "mode-conversion")).rejects.toMatchObject({
      code: "CONVERSION_SOURCE_INCOMPLETE",
      recoverable: true,
      details: { missing_modules: expect.arrayContaining(["extension", "trait_dialogue", "scene_dialogue", "self_introduction"]) },
    });
  });

  it("rejects incomplete, duplicate, wrong-mode, and unknown target module sets", async () => {
    const run = async (operationId: string, proposal: ConversionProposal): Promise<unknown> => {
      const repository = new MemoryProjectRepository("demo");
      await repository.commit(0, (state) => ({ ...state, operations: [operation(operationId)], artifacts: sourceArtifacts("zhuji") }));
      return new ConversionService(repository).materialize(operationId, proposal, "mode-conversion");
    };
    await expect(run("op-target-missing", { ...conversion, modules: completePaletteModules.slice(0, -1) })).rejects.toMatchObject({ code: "CONVERSION_TARGET_INCOMPLETE", recoverable: true });
    await expect(run("op-target-duplicate", { ...conversion, modules: [...completePaletteModules, completePaletteModules[0]!] })).rejects.toMatchObject({ code: "CONVERSION_TARGET_DUPLICATE", recoverable: true });
    const wrongMode = { ...completePaletteModules[0]!, mode: "zhuji" as const } as unknown as ConversionModule;
    await expect(run("op-target-wrong-mode", { ...conversion, modules: [wrongMode, ...completePaletteModules.slice(1)] })).rejects.toMatchObject({ code: "CONVERSION_SCHEMA_INVALID", recoverable: true });
    const unknownModule = { ...completePaletteModules[0]!, module: "unknown_module" } as unknown as ConversionModule;
    await expect(run("op-target-unknown", { ...conversion, modules: [unknownModule, ...completePaletteModules.slice(1)] })).rejects.toMatchObject({ code: "CONVERSION_SCHEMA_INVALID", recoverable: true });
  });

  it("rejects stale source Blueprint bindings and binds current report and targets", async () => {
    const current = recordedBlueprint("precheck-current", "current-blueprint");
    const stale = { blueprint_precheck_id: "precheck-old", blueprint_precheck_revision: contentHash("old-blueprint") };
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, blueprint_prechecks: [current], operations: [operation("op-stale")], artifacts: sourceArtifacts("zhuji", stale) }));
    const before = await repository.read();
    await expect(new ConversionService(repository).materialize("op-stale", conversion, "mode-conversion")).rejects.toMatchObject({ code: "CONVERSION_SOURCE_BLUEPRINT_STALE", recoverable: true });
    const afterRejected = await repository.read();
    expect(afterRejected.revision).toBe(before.revision);
    expect(afterRejected.artifacts).toEqual(before.artifacts);

    const boundRepository = new MemoryProjectRepository("demo");
    const binding = { blueprint_precheck_id: current.id, blueprint_precheck_revision: current.candidate_blueprint_revision };
    await boundRepository.commit(0, (state) => ({ ...state, blueprint_prechecks: [current], operations: [operation("op-bound")], artifacts: sourceArtifacts("zhuji", binding) }));
    await new ConversionService(boundRepository).materialize("op-bound", conversion, "mode-conversion");
    const bound = await boundRepository.read();
    const report = bound.artifacts.find((item) => item.kind === "conversion")!;
    expect(report).toMatchObject(binding);
    expect(JSON.parse(report.content)).toMatchObject(binding);
    expect(bound.artifacts.filter((item) => item.kind === "palette")).toHaveLength(PALETTE_REQUIRED_MODULES.length);
    expect(bound.artifacts.filter((item) => item.kind === "palette").every((item) => item.blueprint_precheck_id === current.id && item.blueprint_precheck_revision === current.candidate_blueprint_revision)).toBe(true);
  });

  it("keeps published projects published for repeated no-op conversion and reopens them for a real draft", async () => {
    const repository = new MemoryProjectRepository("demo");
    await repository.commit(0, (state) => ({ ...state, project_status: "published", operations: [operation("op-published-first")], artifacts: sourceArtifacts("zhuji") }));
    const service = new ConversionService(repository);
    const first = await service.materialize("op-published-first", conversion, "mode-conversion");
    const afterFirst = await repository.read();
    expect(afterFirst.project_status).toBe("ready");

    await repository.commit(afterFirst.revision, (state) => ({ ...state, project_status: "published", operations: [...state.operations, operation("op-published-noop")] }));
    const beforeNoop = await repository.read();
    const second = await service.materialize("op-published-noop", conversion, "mode-conversion");
    const afterNoop = await repository.read();
    expect(afterNoop.project_status).toBe("published");
    expect(afterNoop.artifacts).toHaveLength(beforeNoop.artifacts.length);
    expect(afterNoop.audit.at(-1)?.details).toMatchObject({ noop: true });
    expect(second.artifact_ids).toEqual(first.artifact_ids);

    await repository.commit(afterNoop.revision, (state) => ({ ...state, project_status: "published", operations: [...state.operations, operation("op-published-change")] }));
    const changed: ConversionProposal = {
      ...conversion,
      modules: conversion.modules.map((module) => module.module === "basic_information" ? { ...module, content: "A materially changed basic module." } as ConversionModule : module),
    };
    const changedResult = await service.materialize("op-published-change", changed, "mode-conversion");
    const afterChange = await repository.read();
    expect(afterChange.project_status).toBe("ready");
    expect(afterChange.artifacts.length).toBeGreaterThan(afterNoop.artifacts.length);
    expect(changedResult.target_artifact_ids).not.toEqual(first.target_artifact_ids);
  });
});
