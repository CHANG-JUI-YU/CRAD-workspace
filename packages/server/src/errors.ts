export interface ErrorPayload {
  code: string;
  category: string;
  recoverable: boolean;
  message_zh: string;
  impact: string;
  next_actions: string[];
  error: string;
}

interface ErrorCatalogEntry {
  category: string;
  message_zh: string;
  impact: string;
  next_actions: string[];
}

const FALLBACK_NEXT_ACTIONS = ["確認輸入與目前狀態後重試。"];

const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = {
  UNAUTHORIZED: {
    category: "auth",
    message_zh: "缺少或無效的存取權杖。",
    impact: "此請求未執行，未產生任何變更。",
    next_actions: ["使用帶有正確權杖的網址（?token=...）重新整理頁面。", "或為所有 API 請求帶上 Authorization: Bearer 權杖。"],
  },
  EXTERNAL_HOST_AUTH_REQUIRED: {
    category: "auth",
    message_zh: "對外開放的主機必須設定認證權杖。",
    impact: "server 無法啟動。",
    next_actions: ["啟動時提供 authToken，避免未認證公開所有讀寫端點。"],
  },
  NOT_FOUND: {
    category: "input",
    message_zh: "找不到對應的資源或端點。",
    impact: "此請求未執行。",
    next_actions: ["確認網址與 server 版本後重新整理。"],
  },
  REQUEST_INVALID_JSON: {
    category: "input",
    message_zh: "請求內容不是有效 JSON。",
    impact: "此請求未執行。",
    next_actions: ["確認輸入格式後重新送出。"],
  },
  REQUEST_INVALID_UTF8: {
    category: "input",
    message_zh: "請求內容不是有效 UTF-8 文字。",
    impact: "此請求未執行。",
    next_actions: ["改用正確編碼的文字後重新送出。"],
  },
  REQUEST_TOO_LARGE: {
    category: "input",
    message_zh: "請求內容超過 10 MiB 上限。",
    impact: "此請求未執行。",
    next_actions: ["縮短內容或改用較小的附件後重新送出。"],
  },
  REQUEST_REQUIRED: {
    category: "input",
    message_zh: "缺少 request 欄位。",
    impact: "此請求未執行。",
    next_actions: ["在請求中加入要執行的自然語言指令。"],
  },
  ANSWER_REQUIRED: {
    category: "input",
    message_zh: "缺少 answer 欄位。",
    impact: "此請求未執行。",
    next_actions: ["在請求中加入訪談問題的回答。"],
  },
  PROJECT_REQUIRED: {
    category: "project",
    message_zh: "缺少 project 欄位。",
    impact: "此請求未執行。",
    next_actions: ["從專案清單選擇一個專案後重試。"],
  },
  PROJECT_MANAGER_REQUIRED: {
    category: "project",
    message_zh: "此操作需要專案管理員。",
    impact: "此請求未執行。",
    next_actions: ["以具備專案管理功能的 server 啟動方式重試。"],
  },
  OPERATION_ID_REQUIRED: {
    category: "operation",
    message_zh: "缺少 operation_id 欄位。",
    impact: "此請求未執行。",
    next_actions: ["在請求中加入 operation_id。"],
  },
  OPERATION_NOT_FOUND: {
    category: "operation",
    message_zh: "找不到指定的 operation。",
    impact: "此請求未執行，未產生任何變更。",
    next_actions: ["重新整理後確認 operation 清單。"],
  },
  OPERATION_NOT_CANCELLABLE: {
    category: "operation",
    message_zh: "此 operation 的目前狀態無法取消。",
    impact: "此請求未執行，operation 狀態保持不變。",
    next_actions: ["只有 created／resolving／running／partial／needs_input 的 operation 可以取消。"],
  },
  OPERATION_LEASE_LOST: {
    category: "operation",
    message_zh: "此 operation 的租約已失效，可能已被其他實例接管。",
    impact: "此請求未執行，避免重複副作用。",
    next_actions: ["重新整理後確認 operation 目前狀態。"],
  },
  ISSUE_UPDATE_REQUIRED: {
    category: "review",
    message_zh: "issue 更新參數不完整。",
    impact: "此請求未執行。",
    next_actions: ["提供 issue_id、action 與 reason 後重試。"],
  },
  QUALITY_LEVEL_REQUIRED: {
    category: "quality",
    message_zh: "缺少有效的品質等級。",
    impact: "此請求未執行。",
    next_actions: ["提供 none／light／normal／strict 其中一個等級。"],
  },
  FACT_DECISIONS_REQUIRED: {
    category: "review",
    message_zh: "缺少事實裁決。",
    impact: "此請求未執行。",
    next_actions: ["至少提供一筆 decision（含 claim、decision 與 reason）。"],
  },
  SOURCE_SELECTION_REQUIRED: {
    category: "source",
    message_zh: "缺少來源選擇。",
    impact: "此請求未執行。",
    next_actions: ["提供至少一筆 decisions（candidate_id＋approve／reject）。"],
  },
  ADAPTATION_DECISION_REQUIRED: {
    category: "source",
    message_zh: "缺少改編決策參數。",
    impact: "此請求未執行。",
    next_actions: ["提供 topic、choice 與 rationale 後重試。"],
  },
  TEMPLATE_KIND_REQUIRED: {
    category: "template",
    message_zh: "缺少有效的模板種類。",
    impact: "此請求未執行。",
    next_actions: ["提供正確的 kind（如 character、zhuji、world）。"],
  },
  IMAGE_ID_REQUIRED: {
    category: "image",
    message_zh: "缺少 image_id 欄位。",
    impact: "此請求未執行。",
    next_actions: ["在請求中加入 image_id。"],
  },
  IMAGE_NOT_FOUND: {
    category: "image",
    message_zh: "找不到指定的角色圖。",
    impact: "此請求未執行。",
    next_actions: ["重新整理後確認圖片清單。"],
  },
  BLUEPRINT_PRECHECK_REQUIRED: {
    category: "blueprint",
    message_zh: "工作區缺少 Blueprint 預檢。",
    impact: "操作被阻擋。",
    next_actions: ["在訪談中完成角色與世界設定的預檢確認。"],
  },
  ARTIFACT_REVIEW_REQUIRED: {
    category: "review",
    message_zh: "工作區缺少 artifact review。",
    impact: "發布被阻擋。",
    next_actions: ["目前 revision 需要不同 reviewer 通過，請送交對應 Critic 或重新審查。"],
  },
  REQUIRED_WORLD_ARTIFACT_MISSING: {
    category: "blueprint",
    message_zh: "世界設定尚未建立。",
    impact: "操作被阻擋。",
    next_actions: ["先建立世界設定，再繼續角色創作。"],
  },
  BLUEPRINT_BINDING_STALE: {
    category: "blueprint",
    message_zh: "artifact 綁定到舊版 Blueprint。",
    impact: "此 artifact 不納入本次輸出。",
    next_actions: ["依目前 Blueprint 重新建立該 artifact。"],
  },
  FACT_REVIEW_RUN_MISSING: {
    category: "review",
    message_zh: "事實尚未進入審查。",
    impact: "操作被阻擋。",
    next_actions: ["先整理來源並自動抽取事實。"],
  },
  FACT_REVIEW_COVERAGE_INCOMPLETE: {
    category: "review",
    message_zh: "事實審查未完成。",
    impact: "操作被阻擋。",
    next_actions: ["所有候選都需要 accepted 或 rejected 裁決。"],
  },
  FACT_REVIEW_NEEDS_EVIDENCE: {
    category: "review",
    message_zh: "事實缺少證據。",
    impact: "裁決無法完成。",
    next_actions: ["補上來源引文後重新送審。"],
  },
  FACT_REVIEW_CONFLICT: {
    category: "review",
    message_zh: "事實裁決衝突。",
    impact: "此候選需要 Director 裁決。",
    next_actions: ["使用衝突裁決功能處理。"],
  },
  FACT_REVIEW_CONTRADICTION: {
    category: "review",
    message_zh: "已接受的事實彼此矛盾。",
    impact: "新事實無法直接接受。",
    next_actions: ["送交 Director 裁決哪一筆為真。"],
  },
  SOURCE_RESEARCH_NOT_INGESTED: {
    category: "source",
    message_zh: "來源研究候選尚未入庫。",
    impact: "操作被阻擋。",
    next_actions: ["批准候選來源並執行入庫。"],
  },
  SOURCE_RESEARCH_OFFICIAL_REQUIRED: {
    category: "source",
    message_zh: "缺少官方來源。",
    impact: "操作被阻擋。",
    next_actions: ["搜尋並入庫至少一個官方來源。"],
  },
  WORLD_AUTHORING_ORDER: {
    category: "blueprint",
    message_zh: "世界設定需在角色創作之前完成。",
    impact: "此提交被阻擋。",
    next_actions: ["先建立世界設定。"],
  },
  CHARACTER_AUTHORING_ORDER: {
    category: "blueprint",
    message_zh: "角色創作需在世界設定之前完成。",
    impact: "此提交被阻擋。",
    next_actions: ["先建立角色設定。"],
  },
  AGENT_READ_ONLY: {
    category: "agent",
    message_zh: "該 agent 是唯讀角色。",
    impact: "此操作未執行。",
    next_actions: ["改由 director 或其他可寫角色執行此操作。"],
  },
  AGENT_CAPABILITY_DENIED: {
    category: "agent",
    message_zh: "該 agent 沒有此操作能力。",
    impact: "此操作未執行。",
    next_actions: ["選擇具備對應能力的 agent。"],
  },
  AGENT_UNKNOWN: {
    category: "agent",
    message_zh: "找不到指定的 agent。",
    impact: "此操作未執行。",
    next_actions: ["檢查 agent 名稱與別名後重試。"],
  },
  REVISION_CONFLICT: {
    category: "storage",
    message_zh: "狀態版本衝突。",
    impact: "此操作未套用。",
    next_actions: ["先重新整理目前狀態，再重試這個操作。"],
  },
  SOURCE_DECODE_FAILED: {
    category: "source",
    message_zh: "來源內容不是有效 UTF-8。",
    impact: "此來源無法入庫。",
    next_actions: ["改用正確編碼的檔案或文字。"],
  },
  TEMPLATE_SCHEMA_INVALID: {
    category: "template",
    message_zh: "提交的結構化內容不符合 schema。",
    impact: "此提交未套用。",
    next_actions: ["由專屬 Creator 依 context 重新產生。"],
  },
  IMAGE_CHARACTER_NOT_IN_ROSTER: {
    category: "image",
    message_zh: "角色不在目前 Blueprint 的角色名單中。",
    impact: "圖片未上傳。",
    next_actions: ["確認角色 ID，或先更新 Blueprint 再加入。"],
  },
  CARD_IMAGE_MISSING: {
    category: "build",
    message_zh: "缺少卡面圖片。",
    impact: "本次輸出將使用內建佔位圖。",
    next_actions: ["上傳主要角色的圖片後重新打包。"],
  },
  BUILD_CARD_INCOMPLETE: {
    category: "build",
    message_zh: "角色卡內容不完整，無法打包。",
    impact: "本次打包未完成。",
    next_actions: ["補齊必要模組與設定後重新打包。"],
  },
  REPAIR_PLAN_STALE: {
    category: "repair",
    message_zh: "修復計畫已變更。",
    impact: "修復未執行。",
    next_actions: ["重新預覽修復計畫後再執行。"],
  },
  INTERVIEW_OPERATION_NOT_FOUND: {
    category: "project",
    message_zh: "找不到進行中的訪談 operation。",
    impact: "回答未套用。",
    next_actions: ["重新整理後確認訪談狀態。"],
  },
  BLUEPRINT_CHARACTER_NOT_IN_ROSTER: {
    category: "blueprint",
    message_zh: "角色不在目前 Blueprint 的角色名單中。",
    impact: "此提交被阻擋。",
    next_actions: ["確認角色 ID 或先更新 Blueprint。"],
  },
  BLUEPRINT_MODE_MISMATCH: {
    category: "blueprint",
    message_zh: "提交的模式與 Blueprint 宣告的模式不符。",
    impact: "此提交被阻擋。",
    next_actions: ["確認角色在 Blueprint 中的模式後重試。"],
  },
  AUTHORING_PREVIOUS_MODULE_REQUIRED: {
    category: "blueprint",
    message_zh: "前置模組尚未完成。",
    impact: "此提交被阻擋。",
    next_actions: ["先完成前置模組後再建立目前模組。"],
  },
  ATTACHMENT_NOT_FOUND: {
    category: "storage",
    message_zh: "找不到附件。",
    impact: "此操作無法繼續。",
    next_actions: ["重新上傳附件後重試。"],
  },
  EXECUTION_IDENTITY_RECOVERY_REQUIRED: {
    category: "operation",
    message_zh: "無法還原此操作的原執行代理。",
    impact: "復原未執行，未產生任何副作用。",
    next_actions: ["重新指定執行代理後重試。"],
  },
};

const CATEGORY_BY_PREFIX: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^REQUEST_/u, category: "input" },
  { pattern: /^AGENT_/u, category: "agent" },
  { pattern: /^PROJECT_/u, category: "project" },
  { pattern: /^INTERVIEW_/u, category: "project" },
  { pattern: /^BLUEPRINT_/u, category: "blueprint" },
  { pattern: /^ISSUE_/u, category: "review" },
  { pattern: /^FACT_/u, category: "review" },
  { pattern: /^SOURCE_/u, category: "source" },
  { pattern: /^TEMPLATE_/u, category: "template" },
  { pattern: /^ZHUJI_/u, category: "template" },
  { pattern: /^PALETTE_/u, category: "template" },
  { pattern: /^IMAGE_/u, category: "image" },
  { pattern: /^CARD_/u, category: "build" },
  { pattern: /^BUILD_/u, category: "build" },
  { pattern: /^QUALITY_/u, category: "quality" },
  { pattern: /^CONVERSION_/u, category: "import" },
  { pattern: /^IMPORT_/u, category: "import" },
  { pattern: /^OPERATION_/u, category: "operation" },
  { pattern: /^REPAIR_/u, category: "repair" },
  { pattern: /^AUTHORING_/u, category: "blueprint" },
  { pattern: /^REVISION_/u, category: "storage" },
  { pattern: /^ATTACHMENT_/u, category: "storage" },
  { pattern: /^EXECUTION_/u, category: "operation" },
  { pattern: /^UNAUTHORIZED$/u, category: "auth" },
  { pattern: /^EXTERNAL_/u, category: "auth" },
];

export function categoryFor(code: string): string {
  for (const entry of CATEGORY_BY_PREFIX) {
    if (entry.pattern.test(code)) return entry.category;
  }
  return "unknown";
}

export function structuredError(error: unknown): ErrorPayload {
  if (error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    const code = (error as { code: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    const recoverable = "recoverable" in error && (error as { recoverable?: unknown }).recoverable === true;
    const cataloged = ERROR_CATALOG[code];
    if (cataloged !== undefined) {
      return { code, category: cataloged.category, recoverable, message_zh: cataloged.message_zh, impact: cataloged.impact, next_actions: cataloged.next_actions, error: message };
    }
    return {
      code,
      category: categoryFor(code),
      recoverable,
      message_zh: message,
      impact: "操作未完成，未產生任何變更。",
      next_actions: FALLBACK_NEXT_ACTIONS,
      error: message,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "INTERNAL_ERROR",
    category: "internal",
    recoverable: false,
    message_zh: "伺服器發生未預期的內部錯誤。",
    impact: "操作未完成。",
    next_actions: ["查看 server log，修復後重新整理再試。"],
    error: message,
  };
}
