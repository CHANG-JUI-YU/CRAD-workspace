export const ZHUJI_SELF_INTRODUCTION_FIELDS = [
  "核心標籤與特質的風格表現",
  "對 {{user}} 的態度與互動模式",
  "外在印象與他人觀感",
  "性格基礎與內在驅動力",
  "能力與興趣專長",
  "背景設定與成長經歷",
  "人際關係與情感模式",
  "性相關",
] as const;

export const BLUEPRINT_DIRECTION_QUESTION_ID = "blueprint_direction";
export const CHARACTER_ROSTER_QUESTION_ID = "character_roster";
export const FORMAL_NAME_QUESTION_PREFIX = "formal_name";

export interface InterviewCharacterSubject {
  /** Stable internal subject id; never derived from user-provided paths. */
  id: string;
  /** The user-facing label captured during the roster step. */
  label: string;
  ordinal: number;
}

export type InterviewFlow = "new_project" | "character" | "source_adaptation" | "world" | "continue" | "legacy_review" | "character_expansion";

export type InterviewStatus = "idle" | "active" | "complete";

export type InterviewQuestionKind = "choice" | "free_text" | "name" | "confirmation" | "self_introduction" | "blueprint_direction";

export interface InterviewQuestion {
  id: string;
  text: string;
  kind: InterviewQuestionKind;
  options?: readonly string[];
  min_length?: number;
  subject_id?: string;
  subject_label?: string;
}

export interface InterviewAnswer {
  question_id: string;
  answer: string;
  actor: string;
  occurred_at: string;
}

export interface InterviewState {
  schema_version: 1;
  status: InterviewStatus;
  flow: InterviewFlow;
  current?: InterviewQuestion;
  answers: InterviewAnswer[];
  values: Record<string, string>;
  /** Per-character subjects for multi-character cards. */
  characters?: InterviewCharacterSubject[];
  /** Subject currently receiving a character-scoped question. */
  active_character_id?: string;
  confirmed_no_additional_settings?: boolean;
}

export interface InterviewAnswerInput {
  answer: string;
  actor: string;
}

export class InterviewError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = true) {
    super(message);
    this.name = "InterviewError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

const WORK_TYPE_OPTIONS = ["角色設定", "世界設定", "繼續專案", "舊卡審核", "擴充既有角色卡"] as const;

const normalizeConfirmationValue = (value: string): string => value
  .normalize("NFKC")
  .replace(/[\s\u3000,，、.!！?？:：;；]+/gu, "")
  .toLocaleLowerCase();

const isNo = (value: string): boolean => {
  const normalized = normalizeConfirmationValue(value);
  return /^(?:no|n|沒有|不需要|不想|不要|無|算了|沒有開始建立)$/iu.test(normalized)
    || /不需要(?:任何|什麼)?(?:設定|世界)/iu.test(normalized);
};
const isYes = (value: string): boolean => !isNo(value) && (/^(?:yes|y|需要|好|要|啟用|開啟|开启)$/iu.test(value.trim()) || /需要(?:世界|設定)/iu.test(value));
/** The single authoritative card-shape predicate used by Core and Runtime. */
export const isMultiCharacterCard = (value: unknown): boolean => typeof value === "string" && (/multi/iu.test(value) || /多人(?:角色)?卡|多角色卡|多人/iu.test(value));

/**
 * A multi-character card is only valid when the interview has a real roster.
 * This is deliberately conditional: single-character and world-only flows keep
 * their backward-compatible semantics.
 */
export const hasValidMultiCharacterRoster = (interview: Pick<InterviewState, "values" | "characters">): boolean => (
  !isMultiCharacterCard(interview.values.card_shape) || (interview.characters !== undefined && interview.characters.length >= 2)
);

const isMulti = (value: string): boolean => isMultiCharacterCard(value);
const isWorld = (value: string): boolean => /world/iu.test(value) || /世界|世界觀/iu.test(value);
const isWorldCharacterCard = (value: string): boolean => /建立含世界的角色卡|character\s*card\s*with\s*world/iu.test(value);
const isExistingWorld = (value: string): boolean => normalizeChoiceValue(value) === normalizeChoiceValue("既有專案補世界");
const isExpansion = (value: string): boolean => /expan/iu.test(value) || /新增角色|擴充/iu.test(value);
const isLegacy = (value: string): boolean => /legacy/iu.test(value) || /舊卡|審核/iu.test(value);
const isContinue = (value: string): boolean => /continue/iu.test(value) || /繼續|繼續專案/iu.test(value);
const isSourceAdaptation = (value: string): boolean => /source[_ -]?adaptation|二創|同人|原作改編|動漫角色|改編角色|fan character/iu.test(value);
const isRegenerate = (value: string): boolean => /^(?:重新產生|再來|換一個|再給|更多選項|more options|regenerate)/iu.test(value.trim()) || /再給幾個|換一批/iu.test(value);

const SENSITIVE_SELF_INTRODUCTION_FIELD = "性相關" as const;
const EXPLICIT_ADULT_CONTEXT = /(?:性相關|性經驗|性癖|性生活|性行為|性器官|性交|性愛|性慾|性關係|情色|色情|成人向|成人內容|sexual|sex\b|porn|erotic)/iu;

const hasExplicitAdultContext = (state: InterviewState): boolean => {
  const evidence = [
    ...state.answers.map((item) => item.answer),
    ...Object.values(state.values),
  ].join("\n");
  return EXPLICIT_ADULT_CONTEXT.test(evidence);
};

const normalizeChoiceValue = (value: string): string => value.normalize("NFKC").replace(/[\s\u3000]+/gu, "").toLocaleLowerCase();
const isSingle = (value: string): boolean => /single/iu.test(value) || /\u55ae\u4eba(?:\u89d2\u8272)?\u5361|\u55ae\u89d2\u8272\u5361/iu.test(value);
const isOriginal = (value: string): boolean => /original/iu.test(value) || /\u539f\u5275|\u5b8c\u5168\u539f\u5275/iu.test(value);
const isCharacterSetting = (value: string): boolean => /character/iu.test(value) || /\u89d2\u8272\u8a2d\u5b9a|\u65b0\u89d2\u8272|\u5efa\u7acb\u89d2\u8272/iu.test(value);
const isFreeAuthoring = (value: string): boolean => /free/iu.test(value) || /\u81ea\u7531\u5275\u4f5c/iu.test(value);
const isAssistedAuthoring = (value: string): boolean => /assist/iu.test(value) || /\u5354\u52a9\u5275\u4f5c/iu.test(value);
const hasReplacementCharacter = (value: string): boolean => /\uFFFD/u.test(value);
const isQuestionMarkOnly = (value: string): boolean => /^\?{2,}$/u.test(value.trim());

/**
 * Choice questions must fail closed. Previously any non-empty string was
 * recorded and `nextQuestion` treated an unknown answer as its default
 * branch, so a transport-corrupted answer could silently change the workflow.
 */
const isChoiceAnswerValid = (current: InterviewQuestion, answer: string): boolean => {
  const normalized = normalizeChoiceValue(answer);
  if (current.options?.some((option) => normalizeChoiceValue(option) === normalized) === true) return true;
  if (current.id === "source_medium" || current.id.startsWith("source_medium:")) {
    return /official|wiki|forum|game|novel|anime|manga|other/iu.test(answer);
  }
  switch (current.id) {
    case "work_type":
      // Source adaptation is deliberately not accepted at the fixed first
      // question; it must be selected only after card shape at
      // `character_origin`.
      return isCharacterSetting(answer) || isWorld(answer) || isContinue(answer) || isLegacy(answer) || isExpansion(answer);
    case "card_shape":
      return isSingle(answer) || isMulti(answer);
    case "character_origin":
      return isOriginal(answer) || isSourceAdaptation(answer);
    case "relationship_enable":
    case "world_enabled":
      return isYes(answer) || isNo(answer);
    case "additional_settings":
      return isYes(answer) || isNo(answer) || /\u6709|\u88dc\u5145|\u7e7c\u7e8c/iu.test(answer);
    case "collaboration_mode":
      return isFreeAuthoring(answer) || isAssistedAuthoring(answer);
    case "world_timing":
      return /before|after|\u4e4b\u524d|\u4e4b\u5f8c/iu.test(answer);
    case "canon_policy":
      return /\u53c3\u8003\u539f\u4f5c|\u4e8c\u5275\u8a6b\u91cb|\u5fe0\u5be6\u539f\u4f5c/iu.test(answer);
    default:
      return false;
  }
};

const now = (): string => new Date().toISOString();

const question = (id: string, text: string, kind: InterviewQuestionKind, options?: readonly string[], min_length?: number): InterviewQuestion => ({
  id,
  text,
  kind,
  ...(options === undefined ? {} : { options }),
  ...(min_length === undefined ? {} : { min_length }),
});

const firstQuestion = (): InterviewQuestion => question("work_type", "請選擇哪一種工作類型：角色設定、世界設定、繼續專案、舊卡審核或擴充既有角色卡。", "choice", WORK_TYPE_OPTIONS);

const characterOriginQuestion = (): InterviewQuestion => question("character_origin", "這次要建立完全原創角色，還是原作改編角色？", "choice", ["完全原創", "原作改編"]);

const characterShapeQuestion = (): InterviewQuestion => question("card_shape", "這是單人角色卡還是多人角色卡？", "choice", ["單人角色卡", "多人角色卡"]);

const characterRosterQuestion = (needsMultiple = false): InterviewQuestion => question(
  CHARACTER_ROSTER_QUESTION_ID,
  needsMultiple
    ? "多人角色卡需要至少兩名角色。請列出角色的暫時名稱或簡短標籤，每行一名；之後可在建立專案後再正式命名。"
    : "請列出這張多人角色卡的角色暫時名稱或簡短標籤，每行一名；之後可在建立專案後再正式命名。",
  "free_text",
);

const authoringModeQuestion = (allowPerCharacter = false): InterviewQuestion => question(
  "authoring_mode",
  allowPerCharacter
    ? "這張多人角色卡要讓所有角色使用同一模式，還是為每名角色分別指定珠璣（zhuji）或調色盤（palette）？"
    : "這名角色要使用珠璣（zhuji）還是調色盤（palette）模式？",
  "choice",
  allowPerCharacter ? ["zhuji", "palette", "每名角色分別指定"] : ["zhuji", "palette"],
);

const characterAuthoringModeQuestion = (subject: InterviewCharacterSubject): InterviewQuestion => ({
  ...question(`authoring_mode:${subject.id}`, `請為「${subject.label}」選擇珠璣（zhuji）或調色盤（palette）模式。`, "choice", ["zhuji", "palette"]),
  subject_id: subject.id,
  subject_label: subject.label,
});

const conceptQuestion = (id = "concept", prefix = "角色概念"): InterviewQuestion => question(id, `請詳細描述${prefix}：核心標籤、屬性與整體印象。`, "free_text");

const formalNameQuestion = (subject: InterviewCharacterSubject): InterviewQuestion => ({
  ...question(`${FORMAL_NAME_QUESTION_PREFIX}:${subject.id}`, `請為「${subject.label}」提供正式顯示名稱（會作為卡片與 Blueprint 的顯示名稱，之後可在專案內修改；若暫時沒有，可直接回答「暫用」，先沿用暫時標籤）。`, "name"),
  subject_id: subject.id,
  subject_label: subject.label,
});

const characterDisplayName = (state: InterviewState, subject: InterviewCharacterSubject): string => (
  state.values[`${FORMAL_NAME_QUESTION_PREFIX}:${subject.id}`] ?? subject.label
);

const characterCoreQuestion = (state: InterviewState, subject: InterviewCharacterSubject, kind: "concept" | "background" | "personality"): InterviewQuestion => {
  const displayName = characterDisplayName(state, subject);
  const text = kind === "concept"
    ? `請詳細描述「${displayName}」的角色概念：核心標籤、屬性與整體印象。`
    : kind === "background"
      ? `請描述「${displayName}」的背景、成長經歷、家庭、社會身分與重要經歷。`
      : `請描述「${displayName}」的性格、內在動機、道德界線、恐懼與當下追求。`;
  return {
    ...question(`${kind}:${subject.id}`, text, "free_text"),
    subject_id: subject.id,
    subject_label: displayName,
  };
};

const expansionProjectQuestion = (): InterviewQuestion => question("expansion_project", "要擴充哪個既有專案？請提供專案名稱。", "free_text");

const expansionNameQuestion = (): InterviewQuestion => question("expansion_name", "請提供要新增角色的正式顯示名稱；這會作為卡片與 Blueprint 的顯示名稱。", "name");

const worldProjectQuestion = (): InterviewQuestion => question("world_project", "請提供要補世界的既有專案名稱或路徑。", "free_text");

const sourceSubjectQuestion = (subject?: InterviewCharacterSubject): InterviewQuestion => {
  const scoped = subject !== undefined;
  const q = question(
    scoped ? `source_subject:${subject.id}` : "source_subject",
    scoped
      ? `請提供「${subject.label}」要二創的原作角色與作品名稱；可以是動漫、漫畫、遊戲或小說角色。`
      : "請提供要二創的原作角色與作品名稱；可以是動漫、漫畫、遊戲或小說角色。",
    "free_text",
  );
  return scoped ? { ...q, subject_id: subject.id, subject_label: subject.label } : q;
};

const sourceMediumQuestion = (subject?: InterviewCharacterSubject): InterviewQuestion => {
  const scoped = subject !== undefined;
  const q = question(
    scoped ? `source_medium:${subject.id}` : "source_medium",
    scoped ? `「${subject.label}」主要來自哪一種媒體？` : "這個角色主要來自哪一種媒體？",
    "choice",
    ["動漫", "漫畫", "遊戲", "小說", "其他"],
  );
  return scoped ? { ...q, subject_id: subject.id, subject_label: subject.label } : q;
};

const sourceReferenceQuestion = (subject?: InterviewCharacterSubject): InterviewQuestion => {
  const scoped = subject !== undefined;
  const q = question(
    scoped ? `source_identifiers:${subject.id}` : "source_identifiers",
    scoped
      ? `請提供「${subject.label}」的原作辨識資訊：官方頁面、作品名稱、別名或你希望研究的關鍵詞；之後可再由 Source Researcher 找候選來源。`
      : "請提供原作辨識資訊：官方頁面、作品名稱、別名或你希望研究的關鍵詞；之後可再由 Source Researcher 找候選來源。",
    "free_text",
  );
  return scoped ? { ...q, subject_id: subject.id, subject_label: subject.label } : q;
};

const canonPolicyQuestion = (): InterviewQuestion => question("canon_policy", "二創改編時要採取哪種設定方針？", "choice", ["參考原作", "二創詮釋", "忠實原作"]);

const collaborationQuestion = (): InterviewQuestion => question("collaboration_mode", "這個專案要自由創作還是協助創作？", "choice", ["自由創作", "協助創作"]);

const confirmationQuestion = (): InterviewQuestion => question("additional_settings", "訪談資料是否已齊全？還是要補充其他設定？", "confirmation", ["沒有，開始建立", "有，繼續補充"]);

const nameSourceQuestion = (): InterviewQuestion => question("name_source", "專案顯示名稱要由你直接提供，還是由 Director 提出候選名稱供你選擇？若選候選，Director 會先提出數個名稱與理由。", "choice", ["我直接命名", "請 Director 提出候選"]);

const projectNameQuestion = (candidateMode = false): InterviewQuestion => question(
  "project_name",
  candidateMode
    ? "請回覆你選定的專案名稱，或提供要採用的修正版；這會在訪談完成後成為專案資料夾名稱。"
    : "請提供專案顯示名稱；這會在訪談完成後成為專案資料夾名稱，不需要提供內部 ID。",
  "name",
);

const relationshipParticipantsQuestion = (subjects: readonly InterviewCharacterSubject[]): InterviewQuestion => question(
  "relationship_participants",
  `請從 ${subjects.map((subject) => subject.label).join("、")} 中選出至少兩名要建立關係的角色；可用暫稱列出。`,
  "free_text",
);

const blueprintDirectionQuestion = (
  subjects: readonly InterviewCharacterSubject[] = [],
  subject?: InterviewCharacterSubject,
): InterviewQuestion => {
  const selectedSubject = subject ?? subjects[0];
  const isScoped = subjects.length > 1 && selectedSubject !== undefined;
  const id = isScoped ? `${BLUEPRINT_DIRECTION_QUESTION_ID}:${selectedSubject.id}` : BLUEPRINT_DIRECTION_QUESTION_ID;
  const subjectPrefix = isScoped
    ? `目前先處理「${selectedSubject.label}」的角色設定方向。`
    : "目前先處理這名角色的角色設定方向。";
  const base = "核心概念、背景與性格資料已彙整。請依 Director 提出的 3 個「角色設定方向」選擇核心：外在定位、內在驅動、反差、主要矛盾與創作影響；與 {{user}} 的關係只作為其中一項可能影響，不是本題唯一焦點。你可以選一個、要求重新產生、組合多個方向，或用短語補充自己的方向。這一步只確認角色設定 Blueprint，不是撰寫珠璣或調色盤模組。";
  return {
    ...question(id, `${subjectPrefix}${base}`, "blueprint_direction"),
    ...(isScoped ? { subject_id: selectedSubject.id, subject_label: selectedSubject.label } : {}),
  };
};

/** Parse a natural-language roster without making the user provide ids. */
export const parseCharacterRoster = (answer: string): InterviewCharacterSubject[] => {
  const labels = answer
    .split(/[\r\n、，,；;|]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);
  return labels.map((label, index) => ({ id: `character-${index + 1}`, label, ordinal: index + 1 }));
};

const defaultCharacterSubjects = (): InterviewCharacterSubject[] => [{ id: "character-1", label: "角色", ordinal: 1 }];

const characterSubjectsFor = (state: InterviewState): InterviewCharacterSubject[] => (
  state.characters && state.characters.length > 0 ? state.characters : defaultCharacterSubjects()
);

/** Resolve user-facing roster labels (or ordinals) to stable character ids. */
export const parseRelationshipParticipants = (answer: string, subjects: readonly InterviewCharacterSubject[]): string[] => {
  const tokens = answer
    .split(/[\r\n、，,；;|]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (tokens.length === 0) return [];
  const selected: string[] = [];
  for (const token of tokens) {
    const ordinal = /^#?(\d+)$/u.exec(token)?.[1];
    const subject = ordinal === undefined
      ? subjects.find((candidate) => normalizeChoiceValue(candidate.label) === normalizeChoiceValue(token) || candidate.id === token)
      : subjects.find((candidate) => candidate.ordinal === Number(ordinal));
    if (subject === undefined || selected.includes(subject.id)) continue;
    selected.push(subject.id);
  }
  const uniqueTokenCount = new Set(tokens.map((token) => normalizeChoiceValue(token))).size;
  return selected.length === uniqueTokenCount ? selected : [];
};

const directionSubjectId = (questionId: string): string | undefined => {
  const prefix = `${BLUEPRINT_DIRECTION_QUESTION_ID}:`;
  return questionId.startsWith(prefix) ? questionId.slice(prefix.length) : undefined;
};

const nextSelfIntroductionQuestion = (state: InterviewState, startIndex: number): InterviewQuestion | undefined => {
  for (let index = startIndex; index < ZHUJI_SELF_INTRODUCTION_FIELDS.length; index += 1) {
    const field = ZHUJI_SELF_INTRODUCTION_FIELDS[index];
    if (field === SENSITIVE_SELF_INTRODUCTION_FIELD && !hasExplicitAdultContext(state)) continue;
    return question(`zhuji_intro:${field}`, `請以角色第一人稱面向 {{user}} 回答「${field}」，至少 30 個 Unicode 字元，請使用第一人稱面向 {{user}} 表示。`, "self_introduction", undefined, 30);
  }
  return undefined;
};

/**
 * Keep legacy self-introduction states compatible without surfacing the adult
 * field unless the intake already contains an explicit user mention.
 */
export const normalizeInterviewStateForDisplay = (state: InterviewState): InterviewState => {
  if (state.status !== "active" || state.current === undefined || !state.current.id.startsWith("zhuji_intro:")) return state;
  const currentField = state.current.id.slice("zhuji_intro:".length);
  if (currentField !== SENSITIVE_SELF_INTRODUCTION_FIELD || hasExplicitAdultContext(state)) return state;
  const index = ZHUJI_SELF_INTRODUCTION_FIELDS.indexOf(currentField as (typeof ZHUJI_SELF_INTRODUCTION_FIELDS)[number]);
  if (index < 0) return state;
  const nextField = nextSelfIntroductionQuestion(state, index + 1);
  return nextField === undefined ? { ...state, current: conceptQuestion() } : { ...state, current: nextField };
};

const nextBeforeCollaboration = (state: InterviewState): InterviewQuestion => (
  state.flow === "character" || state.flow === "source_adaptation" || state.flow === "character_expansion" || (state.flow === "world" && isWorldCharacterCard(state.values.world_kind ?? ""))
    ? blueprintDirectionQuestion(characterSubjectsFor(state), characterSubjectsFor(state)[0])
    : collaborationQuestion()
);

const nextAfterPersonality = (state: InterviewState): InterviewQuestion => (
  (state.flow === "character" || state.flow === "source_adaptation" || (state.flow === "world" && isWorldCharacterCard(state.values.world_kind ?? ""))) && isMulti(state.values.card_shape ?? "")
    ? question("relationships", "請描述角色之間的關係：關係網絡、互動模式與潛在衝突。", "free_text")
    : nameSourceQuestion()
);

interface NextTransition {
  flow: InterviewFlow;
  question?: InterviewQuestion;
  characters?: InterviewCharacterSubject[];
  active_character_id?: string;
  complete?: boolean;
  confirmed?: boolean;
  retry?: boolean;
}

const next = (q: InterviewQuestion, flow: InterviewFlow = "character"): NextTransition => ({ flow, question: q });

const afterCardShape = (state: InterviewState): NextTransition => {
  if (isMulti(state.values.card_shape ?? "")) return { flow: state.flow, question: characterRosterQuestion() };
  const subjects = defaultCharacterSubjects();
  return {
    ...next(formalNameQuestion(subjects[0]!), state.flow),
    characters: subjects,
    active_character_id: subjects[0]!.id,
  };
};

const nextQuestion = (state: InterviewState, current: InterviewQuestion, answer: string): NextTransition => {
  const scopedDirection = directionSubjectId(current.id);
  if (current.id === BLUEPRINT_DIRECTION_QUESTION_ID || scopedDirection !== undefined) {
    const subjects = characterSubjectsFor(state);
    const activeSubject = subjects.find((subject) => subject.id === (current.subject_id ?? scopedDirection)) ?? subjects[0]!;
    const subjectId = activeSubject.id;
    const subjectIndex = subjects.findIndex((subject) => subject.id === subjectId);
    if (isRegenerate(answer)) {
      return {
        flow: state.flow,
        question: current,
        active_character_id: subjectId,
        retry: true,
      };
    }
    const nextSubject = subjectIndex >= 0 ? subjects[subjectIndex + 1] : undefined;
    return nextSubject === undefined
      ? { flow: state.flow, question: collaborationQuestion(), active_character_id: subjectId }
      : {
        flow: state.flow,
        question: blueprintDirectionQuestion(subjects, nextSubject),
        active_character_id: nextSubject.id,
      };
  }
  if (current.id.startsWith("authoring_mode:")) {
    const subjects = characterSubjectsFor(state);
    const subjectId = current.subject_id ?? current.id.slice("authoring_mode:".length);
    const subjectIndex = subjects.findIndex((subject) => subject.id === subjectId);
    const nextSubject = subjectIndex >= 0 ? subjects[subjectIndex + 1] : undefined;
    if (nextSubject !== undefined) {
      return { flow: state.flow, question: characterAuthoringModeQuestion(nextSubject), active_character_id: nextSubject.id };
    }
    return isMulti(state.values.card_shape ?? "") && subjects.length > 1
      ? { flow: state.flow, question: characterCoreQuestion(state, subjects[0]!, "concept"), active_character_id: subjects[0]!.id }
      : next(conceptQuestion(), state.flow);
  }
  if (current.id.startsWith(`${FORMAL_NAME_QUESTION_PREFIX}:`)) {
    const subjects = characterSubjectsFor(state);
    const subjectId = current.id.slice(`${FORMAL_NAME_QUESTION_PREFIX}:`.length);
    const subjectIndex = subjects.findIndex((subject) => subject.id === subjectId);
    const nextSubject = subjectIndex >= 0 ? subjects[subjectIndex + 1] : undefined;
    if (nextSubject !== undefined) {
      return { flow: state.flow, question: formalNameQuestion(nextSubject), active_character_id: nextSubject.id };
    }
    if (state.flow === "source_adaptation" && isMulti(state.values.card_shape ?? "")) {
      return { flow: state.flow, question: sourceSubjectQuestion(subjects[0]!), active_character_id: subjects[0]!.id };
    }
    return next(authoringModeQuestion(subjects.length > 1), state.flow);
  }
  const sourceScopedKind = current.id.startsWith("source_subject:") ? "source_subject" : current.id.startsWith("source_medium:") ? "source_medium" : current.id.startsWith("source_identifiers:") ? "source_identifiers" : undefined;
  if (sourceScopedKind !== undefined) {
    const subjects = characterSubjectsFor(state);
    const subjectId = current.id.slice(sourceScopedKind.length + 1);
    const subjectIndex = subjects.findIndex((candidate) => candidate.id === subjectId);
    const subject = subjectIndex >= 0 ? subjects[subjectIndex]! : subjects[0]!;
    const nextSubject = subjectIndex >= 0 ? subjects[subjectIndex + 1] : undefined;
    if (sourceScopedKind === "source_subject") {
      return { flow: state.flow, question: sourceMediumQuestion(subject), active_character_id: subject.id };
    }
    if (sourceScopedKind === "source_medium") {
      return { flow: state.flow, question: sourceReferenceQuestion(subject), active_character_id: subject.id };
    }
    if (nextSubject !== undefined) {
      return { flow: state.flow, question: sourceSubjectQuestion(nextSubject), active_character_id: nextSubject.id };
    }
    return { flow: state.flow, question: canonPolicyQuestion(), active_character_id: subject.id };
  }
  const characterCoreKind = current.id.startsWith("concept:") ? "concept" : current.id.startsWith("background:") ? "background" : current.id.startsWith("personality:") ? "personality" : undefined;
  if (characterCoreKind !== undefined) {
    const subjects = characterSubjectsFor(state);
    const subjectId = current.id.slice(characterCoreKind.length + 1);
    const subject = subjects.find((candidate) => candidate.id === subjectId) ?? subjects[0]!;
    if (characterCoreKind === "concept") {
      return { flow: state.flow, question: characterCoreQuestion(state, subject, "background"), active_character_id: subject.id };
    }
    if (characterCoreKind === "background") {
      return { flow: state.flow, question: characterCoreQuestion(state, subject, "personality"), active_character_id: subject.id };
    }
    const subjectIndex = subjects.findIndex((candidate) => candidate.id === subject.id);
    const nextSubject = subjectIndex >= 0 ? subjects[subjectIndex + 1] : undefined;
    return nextSubject === undefined
      ? { flow: state.flow, question: nextAfterPersonality(state), active_character_id: subject.id }
      : { flow: state.flow, question: characterCoreQuestion(state, nextSubject, "concept"), active_character_id: nextSubject.id };
  }
  switch (current.id) {
    case "work_type":
      if (isExpansion(answer)) return { flow: "character_expansion", question: expansionProjectQuestion(), characters: [{ id: "character-1", label: "新角色", ordinal: 1 }], active_character_id: "character-1" };
      // Keep accepting the legacy free-text source entry, but still ask card shape first.
      if (isSourceAdaptation(answer)) return { flow: "source_adaptation", question: characterShapeQuestion() };
      if (isWorld(answer)) return { flow: "world", question: question("world_kind", "這是獨立世界書、既有專案補世界，還是建立含世界的角色卡？", "choice", ["獨立世界書", "既有專案補世界", "建立含世界的角色卡"]) };
      if (isContinue(answer)) return { flow: "continue", question: question("continue_project", "請提供要繼續的專案名稱或路徑。", "free_text") };
      if (isLegacy(answer)) return { flow: "legacy_review", question: question("import_path", "請提供要審核的舊卡檔案路徑（PNG/JSON/YAML）。", "free_text") };
      return { flow: "character", question: characterShapeQuestion() };
    case "character_origin":
      if (isSourceAdaptation(answer)) {
        return isMulti(state.values.card_shape ?? "")
          ? { flow: "source_adaptation", question: characterRosterQuestion() }
          : { flow: "source_adaptation", question: sourceSubjectQuestion() };
      }
      return afterCardShape(state);
    case "source_subject":
      return { flow: state.flow, question: sourceMediumQuestion() };
    case "source_medium":
      return { flow: state.flow, question: sourceReferenceQuestion() };
    case "source_identifiers":
      return { flow: state.flow, question: canonPolicyQuestion() };
    case "canon_policy":
      return isMulti(state.values.card_shape ?? "") && state.flow === "source_adaptation"
        ? { flow: state.flow, question: authoringModeQuestion(characterSubjectsFor(state).length > 1) }
        : afterCardShape(state);
    case "card_shape":
      if (state.flow === "source_adaptation" && isSourceAdaptation(state.values.work_type ?? "")) {
        return isMulti(answer)
          ? { flow: state.flow, question: characterRosterQuestion() }
          : { flow: state.flow, question: sourceSubjectQuestion() };
      }
      return { flow: state.flow, question: characterOriginQuestion() };
    case CHARACTER_ROSTER_QUESTION_ID: {
      const subjects = parseCharacterRoster(answer);
      if (subjects.length < 2) return { flow: state.flow, question: characterRosterQuestion(true), retry: true };
      const firstSubject = subjects[0]!;
      return {
        flow: state.flow,
        question: formalNameQuestion(firstSubject),
        characters: subjects,
        active_character_id: firstSubject.id,
      };
    }
    case "authoring_mode":
      if (isMulti(state.values.card_shape ?? "") && /每名角色分別指定/iu.test(answer)) {
        const firstSubject = characterSubjectsFor(state)[0]!;
        return { flow: state.flow, question: characterAuthoringModeQuestion(firstSubject), active_character_id: firstSubject.id };
      }
      return isMulti(state.values.card_shape ?? "") && characterSubjectsFor(state).length > 1
        ? { flow: state.flow, question: characterCoreQuestion(state, characterSubjectsFor(state)[0]!, "concept"), active_character_id: characterSubjectsFor(state)[0]!.id }
        : next(conceptQuestion(), state.flow);
    case "concept":
      return next(question("background", "請描述角色的背景、成長經歷、家庭、社會身分與重要經歷。", "free_text"), state.flow);
    case "background":
      return next(question("personality", "請描述角色的性格、內在動機、道德界線、恐懼與當下追求。", "free_text"), state.flow);
    case "personality":
      return { flow: state.flow, question: nextAfterPersonality(state) };
    case "relationships":
      return next(question("relationship_enable", "是否啟用 project-level relationships？", "choice", ["啟用", "不啟用"]), state.flow);
    case "relationship_enable":
      return isYes(answer)
        ? next(question("relationship_scope", "關係涵蓋完整 roster 還是指定的 participant subset？", "choice", ["完整 roster", "指定 participant subset"]), state.flow)
        : next(nameSourceQuestion(), state.flow);
    case "relationship_scope":
      return /指定\s*participant\s*subset/iu.test(answer)
        ? next(relationshipParticipantsQuestion(characterSubjectsFor(state)), state.flow)
        : next(nameSourceQuestion(), state.flow);
    case "relationship_participants":
      if (parseRelationshipParticipants(answer, characterSubjectsFor(state)).length < 2) {
        throw new InterviewError("INTERVIEW_PARTICIPANTS_INVALID", "至少選擇兩名現有角色，且不可包含名單外的角色。請重新列出角色。", true);
      }
      return next(nameSourceQuestion(), state.flow);
    case "name_source":
      return next(projectNameQuestion(/請\s*Director\s*提出候選/iu.test(answer)), state.flow);
    case "project_name":
      return state.flow === "world"
        ? (isWorldCharacterCard(state.values.world_kind ?? "")
          ? { flow: state.flow, question: nextBeforeCollaboration(state) }
          : { flow: state.flow, question: collaborationQuestion() })
        : { flow: state.flow, question: question("world_enabled", "是否需要世界設定？", "choice", ["需要", "不需要"]) };
    case "world_kind":
      return isExistingWorld(answer)
        ? { flow: state.flow, question: worldProjectQuestion() }
        : { flow: state.flow, question: question("world_concept", "請描述世界的核心概念、規則、時代、地理與不可違反的設定。", "free_text") };
    case "world_project":
      return { flow: state.flow, question: question("world_concept", "請描述世界的核心概念、規則、時代、地理與不可違反的設定。", "free_text") };
    case "world_concept":
      return { flow: state.flow, question: question("world_timing", "世界設定要在角色設定之前完成，還是之後完成？", "choice", ["之前", "之後"]) };
    case "world_enabled":
      return isYes(answer)
        ? next(question("world_kind", "這是獨立世界書、既有專案補世界，還是建立含世界的角色卡？", "choice", ["獨立世界書", "既有專案補世界", "建立含世界的角色卡"]), state.flow)
        : { flow: state.flow, question: nextBeforeCollaboration(state) };
    case "world_timing":
      if (state.flow === "world" && isExistingWorld(state.values.world_kind ?? "")) return { flow: "world", complete: true, confirmed: true };
      return state.flow === "world"
        ? (isWorldCharacterCard(state.values.world_kind ?? "")
          ? { flow: state.flow, question: characterShapeQuestion() }
          : { flow: state.flow, question: projectNameQuestion() })
        : { flow: state.flow, question: nextBeforeCollaboration(state) };
    case "collaboration_mode":
      return { flow: state.flow, question: confirmationQuestion() };
    case "additional_settings":
      return isNo(answer)
        ? { flow: state.flow, complete: true, confirmed: true }
        : { flow: state.flow, question: question("supplement", "請補充要加入的其他設定。", "free_text") };
    case "supplement":
      return { flow: state.flow, question: confirmationQuestion() };
    case "continue_project":
      return { flow: "continue", complete: true, confirmed: true };
    case "import_path":
      return { flow: state.flow, question: projectNameQuestion() };
    case "expansion_project":
      return { flow: state.flow, question: expansionNameQuestion() };
    case "expansion_name":
      return { flow: state.flow, question: conceptQuestion("expansion_concept", "要新增的角色") };
    case "expansion_concept":
      return { flow: state.flow, question: question("expansion_background", "請描述要新增角色的背景、成長經歷、家庭、社會身分與重要經歷。", "free_text") };
    case "expansion_background":
      return { flow: state.flow, question: question("expansion_personality", "請描述要新增角色的性格、內在動機、道德界線、恐懼與當下追求。", "free_text") };
    case "expansion_personality":
      return { flow: state.flow, question: question("expansion_mode", "這個角色要使用珠璣（zhuji）還是調色盤（palette）模式？", "choice", ["zhuji", "palette"]) };
    case "expansion_mode":
      return { flow: state.flow, question: question("expansion_relationships", "請描述新角色與既有 roster 的關係：互信與衝突界線。", "free_text") };
    case "expansion_relationships":
      return { flow: state.flow, question: nextBeforeCollaboration(state) };
    default:
      if (current.id.startsWith("zhuji_intro:")) {
        const index = ZHUJI_SELF_INTRODUCTION_FIELDS.indexOf(current.id.slice("zhuji_intro:".length) as (typeof ZHUJI_SELF_INTRODUCTION_FIELDS)[number]);
        const nextField = nextSelfIntroductionQuestion(state, index + 1);
        if (nextField === undefined) return next(conceptQuestion(), state.flow);
        return next(nextField, state.flow);
      }
      return { flow: state.flow, question: confirmationQuestion() };
  }
};

export const recordInterviewAnswer = (current: InterviewQuestion, answer: string, actor: string): InterviewAnswer => {
  const trimmed = answer.trim();
  if (trimmed.length === 0) throw new InterviewError("INTERVIEW_ANSWER_EMPTY", "interview answer 不可為空");
  if (hasReplacementCharacter(trimmed)) {
    throw new InterviewError("INTERVIEW_ENCODING_INVALID", "Interview answer contains an invalid replacement character; please resend it.");
  }
  if ((current.kind === "choice" || current.kind === "confirmation") && !isChoiceAnswerValid(current, trimmed)) {
    throw new InterviewError("INTERVIEW_CHOICE_INVALID", "The answer does not match the current interview choices; please choose again.");
  }
  if (isQuestionMarkOnly(trimmed)) {
    throw new InterviewError("INTERVIEW_ENCODING_INVALID", "Interview answer appears to be corrupted; please resend it.");
  }
  if (current.min_length !== undefined && [...trimmed].length < current.min_length) {
    throw new InterviewError("INTERVIEW_ANSWER_TOO_SHORT", `回答至少需要 ${current.min_length} 個字元`);
  }
  return { question_id: current.id, answer: trimmed, actor, occurred_at: now() };
};

export const createInterviewState = (): InterviewState => ({
  schema_version: 1,
  status: "idle",
  flow: "new_project",
  answers: [],
  values: {},
});

export const beginInterview = (state: InterviewState): InterviewState => {
  if (state.status === "active") return state;
  const {
    characters: _characters,
    active_character_id: _activeCharacterId,
    confirmed_no_additional_settings: _confirmed,
    ...base
  } = state;
  return {
    ...base,
    status: "active",
    flow: "new_project",
    current: firstQuestion(),
    answers: [],
    values: {},
  };
};

export const workflow_answer_interview = (state: InterviewState, input: InterviewAnswerInput): InterviewState => {
  const normalized = normalizeInterviewStateForDisplay(state);
  if (normalized !== state) return normalized;
  if (state.status !== "active" || state.current === undefined) {
    throw new InterviewError("INTERVIEW_NOT_ACTIVE", "目前沒有進行中的訪談");
  }
  const recorded = recordInterviewAnswer(state.current, input.answer, input.actor);
  const candidateValues = { ...state.values, [state.current.id]: recorded.answer };
  const transition = nextQuestion({ ...state, values: candidateValues }, state.current, input.answer);
  const values = transition.retry === true ? state.values : candidateValues;
  const answers = [...state.answers, recorded];
  const characters = transition.characters ?? state.characters;
  const activeCharacterId = transition.active_character_id ?? state.active_character_id;
  if (transition.complete === true) {
    if (!hasValidMultiCharacterRoster({ values, ...(characters === undefined ? {} : { characters }) })) {
      const { confirmed_no_additional_settings: _confirmed, ...activeState } = state;
      return {
        ...activeState,
        flow: transition.flow,
        current: characterRosterQuestion(true),
        answers,
        values,
        ...(characters === undefined ? {} : { characters }),
        ...(activeCharacterId === undefined ? {} : { active_character_id: activeCharacterId }),
      };
    }
    return {
      schema_version: state.schema_version,
      status: "complete",
      flow: transition.flow,
      answers,
      values,
      ...(characters === undefined ? {} : { characters }),
      ...(activeCharacterId === undefined ? {} : { active_character_id: activeCharacterId }),
      confirmed_no_additional_settings: transition.confirmed === true,
    };
  }
  if (transition.question === undefined) {
    throw new InterviewError("INTERVIEW_TRANSITION_INVALID", "訪談流程沒有產生下一個問題", false);
  }
  return {
    ...state,
    flow: transition.flow,
    current: transition.question,
    answers,
    values,
    ...(characters === undefined ? {} : { characters }),
    ...(activeCharacterId === undefined ? {} : { active_character_id: activeCharacterId }),
  };
};

/** Backward-compatible camelCase alias for callers using the v2 naming convention. */
export const workflowAnswerInterview = workflow_answer_interview;
