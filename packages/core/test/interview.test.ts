import { describe, expect, it } from "vitest";
import {
  InterviewError,
  BLUEPRINT_DIRECTION_QUESTION_ID,
  beginInterview,
  createInterviewState,
  normalizeInterviewStateForDisplay,
  workflow_answer_interview,
  type InterviewState,
} from "../src/index.js";

function answer(state: InterviewState, value: string): InterviewState {
  return workflow_answer_interview(state, { answer: value, actor: "user" });
}

describe("project interview engine", () => {
  it("rejects corrupted choice answers without advancing the interview", () => {
    let state = beginInterview(createInterviewState());

    expect(() => answer(state, "????")).toThrowError(expect.objectContaining({ code: "INTERVIEW_CHOICE_INVALID" }));
    expect(state.current?.id).toBe("work_type");
    expect(state.answers).toHaveLength(0);

    state = answer(state, "\u89d2\u8272\u8a2d\u5b9a");
    expect(state.current?.id).toBe("card_shape");
    expect(() => answer(state, "?????")).toThrowError(expect.objectContaining({ code: "INTERVIEW_CHOICE_INVALID" }));
    expect(state.current?.id).toBe("card_shape");

    state = answer(state, "\u55ae\u4eba\u89d2\u8272\u5361");
    expect(state.current?.id).toBe("character_origin");
    expect(() => answer(state, "????")).toThrowError(expect.objectContaining({ code: "INTERVIEW_CHOICE_INVALID" }));
    expect(state.current?.id).toBe("character_origin");
    expect(state.answers).toHaveLength(2);
  });

  it("rejects replacement characters before they can be persisted", () => {
    const state = beginInterview(createInterviewState());
    expect(() => answer(state, "\uFFFD")).toThrowError(expect.objectContaining({ code: "INTERVIEW_ENCODING_INVALID" }));
    expect(state.answers).toHaveLength(0);
  });

  it("keeps the first work-type question fixed and separate from character branches", () => {
    const state = beginInterview(createInterviewState());
    expect(state.current).toMatchObject({
      id: "work_type",
      text: "請選擇哪一種工作類型：角色設定、世界設定、繼續專案、舊卡審核或擴充既有角色卡。",
      kind: "choice",
      options: ["角色設定", "世界設定", "繼續專案", "舊卡審核", "擴充既有角色卡"],
    });
    expect(() => answer(state, "原作改編")).toThrowError(expect.objectContaining({ code: "INTERVIEW_CHOICE_INVALID" }));
  });

  it("asks card shape before original or source adaptation", () => {
    let state = beginInterview(createInterviewState());
    const roleSettingOption = state.current?.options?.find((option) => option.includes("\u89d2\u8272\u8A2D\u5B9A"));
    expect(roleSettingOption).toBeDefined();
    state = answer(state, roleSettingOption!);
    expect(state.current?.id).toBe("card_shape");
    state = answer(state, "單人角色卡");
    expect(state.current?.id).toBe("character_origin");
    expect(state.current?.options).toEqual(expect.arrayContaining([
      "\u5B8C\u5168\u539F\u5275",
      "\u539F\u4F5C\u6539\u7DE8",
    ]));
  });

  it("keeps Zhuji self-introduction out of intake and asks for a Blueprint direction", () => {
    let state = beginInterview(createInterviewState());
    expect(() => answer(state, "   ")).toThrowError(new InterviewError("INTERVIEW_ANSWER_EMPTY", "interview answer 不可為空"));
    state = answer(state, "角色設定");
    state = answer(state, "單角色卡");
    state = answer(state, "完全原創");
    state = answer(state, "zhuji");
    expect(state.current?.id).toBe("concept");
    expect(state.current?.kind).toBe("free_text");
    for (const value of [
      "核心是冷靜而直接的觀察者",
      "在嚴格家庭中成長並學會自立",
      "克制、誠實、重視界線與長期目標",
      "我直接命名",
      "珠璣專案",
      "不需要",
    ]) state = answer(state, value);
    expect(state.current?.id).toBe(BLUEPRINT_DIRECTION_QUESTION_ID);
    expect(state.current?.kind).toBe("blueprint_direction");
    expect(state.current?.text).toContain("角色設定方向");
    expect(state.current?.text).toContain("與 {{user}} 的關係只作為其中一項可能影響");
    state = answer(state, "再給幾個");
    expect(state.current?.id).toBe(BLUEPRINT_DIRECTION_QUESTION_ID);
    expect(state.values[BLUEPRINT_DIRECTION_QUESTION_ID]).toBeUndefined();
    state = answer(state, "外冷內熱、慢熟但對重要的人很忠誠");
    expect(state.current?.id).toBe("collaboration_mode");
  });

  it("walks the delayed-name, world and final-confirmation flow", () => {
    let state = beginInterview(createInterviewState());
    for (const value of [
      "角色設定",
      "單角色卡",
      "完全原創",
      "palette",
      "核心是冷靜而直接的觀察者",
      "在嚴格家庭中成長並學會自立",
      "克制、誠實、重視界線與長期目標",
      "我直接命名",
      "雪乃專案",
      "需要",
      "獨立世界書",
      "世界有清楚規則、地理與時代脈絡的核心設定",
      "之後",
      "外冷內熱、重視界線但願意建立長期信任",
      "協助創作",
    ]) state = answer(state, value);
    expect(state.status).toBe("active");
    expect(state.current?.id).toBe("additional_settings");
    expect(state.values.project_name).toBe("雪乃專案");
    expect(state.values.world_enabled).toBe("需要");
    expect(state.values.world_timing).toBe("之後");
    state = answer(state, "沒有，開始建立");
    expect(state.status).toBe("complete");
    expect(state.confirmed_no_additional_settings).toBe(true);
    expect(state.answers).toHaveLength(16);
  });

  it("accepts the displayed positive and negative final confirmation choices", () => {
    let state = beginInterview(createInterviewState());
    for (const value of [
      "角色設定",
      "單人角色卡",
      "完全原創",
      "palette",
      "核心是冷靜而直接的觀察者",
      "在嚴格家庭中成長並學會自立",
      "克制、誠實、重視界線與長期目標",
      "我直接命名",
      "雪乃專案",
      "不需要",
      "外冷內熱、重視界線但願意建立長期信任",
      "自由創作",
    ]) state = answer(state, value);

    expect(state.current?.id).toBe("additional_settings");
    state = answer(state, "有，繼續補充");
    expect(state.current?.id).toBe("supplement");
    state = answer(state, "補充設定已整理完成");
    expect(state.current?.id).toBe("additional_settings");

    state = answer(state, "沒有，開始建立");
    expect(state.status).toBe("complete");
    expect(state.confirmed_no_additional_settings).toBe(true);
  });

  it("asks the relationships activation questions for a multi-character card", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "多角色卡", "完全原創", "冷靜姐姐、熱情妹妹", "palette", "兩名角色有互補的衝突關係", "背景清楚", "性格有差異"]) state = answer(state, value);
    expect(state.current?.id).toBe("relationships");
    expect(state.characters?.map((character) => character.label)).toEqual(["冷靜姐姐", "熱情妹妹"]);
    state = answer(state, "互相競爭但有共同目標");
    state = answer(state, "啟用");
    expect(state.current?.id).toBe("relationship_scope");
    state = answer(state, "完整 roster");
    expect(state.current?.id).toBe("name_source");
  });

  it("assigns authoring mode one character at a time when a multi-character card requests it", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "多角色卡", "完全原創", "甲、乙", "每名角色分別指定"]) state = answer(state, value);
    expect(state.current?.id).toBe("authoring_mode:character-1");
    expect(state.current?.subject_label).toBe("甲");
    state = answer(state, "zhuji");
    expect(state.current?.id).toBe("authoring_mode:character-2");
    expect(state.current?.subject_label).toBe("乙");
    state = answer(state, "palette");
    expect(state.current?.id).toBe("concept");
    expect(state.values["authoring_mode"]).toBe("每名角色分別指定");
    expect(state.values["authoring_mode:character-1"]).toBe("zhuji");
    expect(state.values["authoring_mode:character-2"]).toBe("palette");
  });

  it("requires valid existing participants for a relationship subset", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "多角色卡", "完全原創", "甲、乙、丙", "palette", "共同概念", "共同背景", "不同性格", "關係已整理", "啟用", "指定 participant subset"]) state = answer(state, value);
    expect(state.current?.id).toBe("relationship_participants");
    expect(() => answer(state, "甲")).toThrowError(expect.objectContaining({ code: "INTERVIEW_PARTICIPANTS_INVALID" }));
    expect(state.current?.id).toBe("relationship_participants");
    state = answer(state, "甲、丙");
    expect(state.current?.id).toBe("name_source");
    expect(state.values.relationship_participants).toBe("甲、丙");
  });

  it("describes world timing without contradictory instructions", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["世界設定", "獨立世界書", "世界規則與地理",]) state = answer(state, value);
    expect(state.current?.id).toBe("world_timing");
    expect(state.current?.text).toBe("世界設定要在角色設定之前完成，還是之後完成？");
  });

  it("does not interpret a natural-language refusal as enabling world settings", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "單人角色卡", "完全原創", "palette", "角色概念", "角色背景", "角色性格", "我直接命名", "專案名稱", "不需要世界設定"]) state = answer(state, value);
    expect(state.current?.id).toBe(BLUEPRINT_DIRECTION_QUESTION_ID);
    expect(state.values.world_enabled).toBe("不需要世界設定");
  });

  it("continues from a world-first character-card branch into the character interview", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["世界設定", "建立含世界的角色卡", "世界規則與角色生活脈絡", "之前"]) state = answer(state, value);
    expect(state.current?.id).toBe("card_shape");
    state = answer(state, "單人角色卡");
    expect(state.current?.id).toBe("character_origin");
    state = answer(state, "完全原創");
    expect(state.current?.id).toBe("authoring_mode");
    expect(state.flow).toBe("world");
  });

  it("asks and stores Blueprint direction independently for each character", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "多角色卡", "完全原創", "甲、乙", "palette", "共同概念", "共同背景", "不同性格", "關係已整理", "不啟用", "我直接命名", "雙人專案", "不需要"]) state = answer(state, value);
    expect(state.current?.id).toBe("blueprint_direction:character-1");
    expect(state.current?.subject_label).toBe("甲");
    state = answer(state, "再給幾個");
    expect(state.current?.id).toBe("blueprint_direction:character-1");
    expect(state.values["blueprint_direction:character-1"]).toBeUndefined();
    state = answer(state, "甲的方向是冷靜、可靠並保留反差");
    expect(state.current?.id).toBe("blueprint_direction:character-2");
    expect(state.current?.subject_label).toBe("乙");
    state = answer(state, "乙的方向是熱烈、直接並有清楚界線");
    expect(state.current?.id).toBe("collaboration_mode");
    expect(state.values["blueprint_direction:character-1"]).toContain("冷靜");
    expect(state.values["blueprint_direction:character-2"]).toContain("熱烈");
  });

  it("supports the world-only, continue, and legacy entry points", () => {
    const finish = (values: string[]): InterviewState => {
      let state = beginInterview(createInterviewState());
      for (const value of values) state = answer(state, value);
      return state;
    };
    const world = finish(["世界設定", "獨立世界書", "一個有清楚規則、地理與時代脈絡的原創世界", "之前", "世界專案", "自由創作", "沒有"]);
    expect(world.status).toBe("complete");
    expect(world.flow).toBe("world");
    expect(world.values.project_name).toBe("世界專案");
    const continued = finish(["繼續專案", "雪乃專案", "雪乃專案", "不需要", "自由創作", "沒有"]);
    expect(continued.status).toBe("complete");
    expect(continued.flow).toBe("continue");
    const legacy = finish(["舊卡審核", "C:/cards/yukino.json", "審核專案", "不需要", "協助創作", "沒有"]);
    expect(legacy.status).toBe("complete");
    expect(legacy.flow).toBe("legacy_review");
  });

  it("keeps derivative-character intake in the source adaptation flow", () => {
    let state = beginInterview(createInterviewState());
    for (const value of [
      "角色設定",
      "單人角色卡",
      "原作改編",
      "某動漫角色與作品",
      "動漫",
      "官方角色頁、角色別名",
      "palette",
      "我心中更克制、溫柔且重視界線的版本",
      "沿用原作背景但調整成適合本專案的生活脈絡",
      "冷靜、觀察力強，面對信任的人會逐步展現柔軟",
      "我直接命名",
      "二創角色專案",
      "不需要",
    ]) state = answer(state, value);
    expect(state.flow).toBe("source_adaptation");
    expect(state.current?.id).toBe(BLUEPRINT_DIRECTION_QUESTION_ID);
    expect(state.values.source_subject).toContain("某動漫角色");
    expect(state.values.source_identifiers).toContain("官方角色頁");
  });

  it("keeps a multi-character source adaptation in the source path and scopes directions", () => {
    let state = beginInterview(createInterviewState());
    for (const value of [
      "角色設定",
      "多角色卡",
      "原作改編",
      "甲與乙來自某部作品",
      "動漫",
      "官方角色頁、作品名稱",
      "甲、乙",
      "palette",
      "共同改編概念",
      "共同背景脈絡",
      "甲冷靜、乙熱烈",
      "關係已整理",
      "不啟用",
      "我直接命名",
      "多人二創專案",
      "不需要",
    ]) state = answer(state, value);
    expect(state.flow).toBe("source_adaptation");
    expect(state.current?.id).toBe("blueprint_direction:character-1");
    state = answer(state, "甲方向：冷靜且可靠");
    expect(state.current?.id).toBe("blueprint_direction:character-2");
    state = answer(state, "乙方向：熱烈但尊重界線");
    expect(state.current?.id).toBe("collaboration_mode");
    expect(state.values.source_subject).toContain("甲與乙");
  });

  it("walks Blueprint direction and character expansion branches", () => {
    let zhuji = beginInterview(createInterviewState());
    for (const value of ["角色設定", "單角色卡", "完全原創", "zhuji", "冷靜而有辨識度的角色概念", "在普通家庭成長並學會獨立生活", "克制直接且重視誠實與界線", "我直接命名", "珠璣專案", "不需要", "冷靜觀察、只對信任的人展現柔軟", "自由創作", "沒有"]) zhuji = answer(zhuji, value);
    expect(zhuji.status).toBe("complete");
    expect(zhuji.answers.some((item) => item.question_id === BLUEPRINT_DIRECTION_QUESTION_ID)).toBe(true);

    let expansion = beginInterview(createInterviewState());
    for (const value of ["擴充既有角色", "新增角色概念", "新增角色背景", "新增角色性格", "palette", "與既有 roster 的互信和衝突界線", "既有專案", "不需要", "新增角色先觀望、再以可靠行動建立信任", "自由創作", "沒有"]) expansion = answer(expansion, value);
    expect(expansion.status).toBe("complete");
    expect(expansion.flow).toBe("character_expansion");
  });

  it("does not introduce the adult self-introduction field unless intake mentions it", () => {
    const legacyQuestion: InterviewState = {
      schema_version: 1,
      status: "active",
      flow: "character",
      current: { id: "zhuji_intro:人際關係與情感模式", text: "legacy", kind: "self_introduction", min_length: 30 },
      answers: [],
      values: {},
    };
    const skipped = answer(legacyQuestion, "這是一段超過三十個字元的角色描述，角色重視信任與界線，也會在長期相處中用穩定行動建立可靠感");
    expect(skipped.current?.id).toBe("concept");

    const explicit = answer(legacyQuestion, "這是一段超過三十個字元的描述，角色有性相關設定，只有在明確信任與雙方同意後才會談及這些私人內容");
    expect(explicit.current?.id).toBe("zhuji_intro:性相關");
    expect(explicit.current?.text).toContain("性相關");

    const persistedSensitive = { ...legacyQuestion, current: { ...legacyQuestion.current!, id: "zhuji_intro:性相關" } };
    expect(normalizeInterviewStateForDisplay(persistedSensitive).current?.id).toBe("concept");
  });

  it("allows relationships to be declined and requires a second confirmation after supplements", () => {
    let state = beginInterview(createInterviewState());
    for (const value of ["角色設定", "多角色卡", "完全原創", "姐姐、妹妹", "palette", "兩名角色的核心概念與互補特徵", "共同成長背景與重要事件", "一方冷靜一方熱烈但都尊重界線", "角色關係已整理", "不啟用", "我直接命名", "雙人專案", "不需要", "姐姐方向：冷靜而可靠", "妹妹方向：熱烈而有界線", "自由創作"]) state = answer(state, value);
    expect(state.current?.id).toBe("additional_settings");
    state = answer(state, "補充一段共同目標與不可違反的界線");
    expect(state.current?.id).toBe("supplement");
    state = answer(state, "補充內容已整理完成");
    expect(state.current?.id).toBe("additional_settings");
    state = answer(state, "沒有");
    expect(state.status).toBe("complete");
    expect(state.confirmed_no_additional_settings).toBe(true);
  });

  it("is idempotent when beginning and rejects answers outside an active interview", () => {
    const idle = createInterviewState();
    expect(beginInterview(beginInterview(idle))).toEqual(beginInterview(idle));
    expect(() => workflow_answer_interview(idle, { answer: "anything", actor: "user" })).toThrowError(expect.objectContaining({ code: "INTERVIEW_NOT_ACTIVE" }));
  });
});
