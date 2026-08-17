export interface ErrorPayload {
  code: string;
  category: string;
  recoverable: boolean;
  message_zh: string;
  impact: string;
  next_actions: string[];
  error: string;
  details?: Record<string, unknown>;
  uncatalogued_code?: string;
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
  SOURCE_SEARCH_PROVIDER_UNAVAILABLE: {
    category: "source",
    message_zh: "Runtime 尚未注入 SourceSearchProvider。",
    impact: "無法在 runtime_provider 模式下執行自動搜尋。",
    next_actions: ["在 Runtime 配置注入搜尋 Provider，或將搜尋模式切換為 agent_managed 由 Source Researcher Agent 搜尋。"],
  },
  SOURCE_SEARCH_DISABLED: {
    category: "source",
    message_zh: "來源搜尋功能已停用。",
    impact: "無法執行任何來源搜尋。",
    next_actions: ["直接提供來源 URL 或上傳附件材料。"],
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
  INTERVIEW_MULTI_ROSTER_INCOMPLETE: {
    category: "project",
    message_zh: "多人角色卡至少需要兩名角色。",
    impact: "Blueprint 尚未建立，現有訪談答案仍保留。",
    next_actions: ["回到角色名單步驟，列出至少兩名角色後繼續訪談。"],
  },
  INTERVIEW_ANSWER_NOT_FOUND: {
    category: "project",
    message_zh: "找不到可修訂的訪談答案。",
    impact: "修訂未套用。",
    next_actions: ["確認問題 ID 後重試，或重新整理訪談歷史。"],
  },
  INTERVIEW_AMENDMENT_REPLAY_FAILED: {
    category: "project",
    message_zh: "訪談紀錄無法安全重放，修訂被拒絕。",
    impact: "為避免改寫歷史，修訂未套用。",
    next_actions: ["確認回答符合該問題的格式或選項後重試。"],
  },
  INTERVIEW_CHOICE_INVALID: {
    category: "project",
    message_zh: "訪談回答不在目前的選項範圍內。",
    impact: "此回答未套用，訪談狀態不變。",
    next_actions: ["依目前問題提供的選項重新回答。"],
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
  COVERAGE_ASSESSMENT_STALE: {
    category: "coverage",
    message_zh: "Coverage 評估已過期。",
    impact: "此操作未執行；評估內容與目前狀態不符。",
    next_actions: ["重新執行 formal coverage assessment 後重試。"],
  },
  COVERAGE_ASSESSMENT_REQUIRED: {
    category: "coverage",
    message_zh: "需要先建立通過 Fact Review 的 formal coverage assessment。",
    impact: "此操作未執行。",
    next_actions: ["完成來源處理與 Fact Review 後重新執行 formal assessment。"],
  },
  COVERAGE_ASSESSMENT_INVALID: {
    category: "coverage",
    message_zh: "Coverage assessment 內容無效。",
    impact: "此操作未執行。",
    next_actions: ["檢查 assessment 項目與狀態後重試。"],
  },
  COVERAGE_RESOLUTION_INVALID: {
    category: "coverage",
    message_zh: "Coverage resolution 無效。",
    impact: "此操作未執行；resolution 與目前評估或範圍不符。",
    next_actions: ["確認評估 revision、角色範圍與來源後重試。"],
  },
  COVERAGE_RESOLUTION_REQUIRED: {
    category: "coverage",
    message_zh: "仍有未解決的 coverage requirement。",
    impact: "發布或 authoring 被阻擋。",
    next_actions: ["為每個 missing 項目選擇來源研究、使用者補充或創意補全。"],
  },
  COVERAGE_RESEARCH_REQUIRED: {
    category: "coverage",
    message_zh: "需要先建立來源研究批次。",
    impact: "此操作未執行。",
    next_actions: ["為 current assessment 建立 research batch 後重試。"],
  },
  COVERAGE_RESEARCH_TASK_STALE: {
    category: "coverage",
    message_zh: "研究任務已過期或不存在。",
    impact: "此操作未執行。",
    next_actions: ["重新載入研究任務狀態後重試。"],
  },
  COVERAGE_RESEARCH_TASK_TERMINAL: {
    category: "coverage",
    message_zh: "研究任務已終結，不能再修改。",
    impact: "此操作未執行。",
    next_actions: ["以 revise/recover 建立 successor 任務，或改用 resolution 流程。"],
  },
  COVERAGE_RESEARCH_TASK_LEASE_LOST: {
    category: "coverage",
    message_zh: "研究任務的租約已失效或 generation 不符。",
    impact: "此提交被阻擋。",
    next_actions: ["重新 claim 任務後重試。"],
  },
  COVERAGE_RESEARCH_EXHAUSTED: {
    category: "coverage",
    message_zh: "研究任務已耗盡搜尋。",
    impact: "此操作未執行。",
    next_actions: ["選擇 revise query、revise constraints、手動提供來源或 resolution。"],
  },
  COVERAGE_RESEARCH_CAPABILITY_DENIED: {
    category: "coverage",
    message_zh: "此代理沒有研究任務權限。",
    impact: "此操作未執行。",
    next_actions: ["使用具有 researcher 權限的代理執行。"],
  },
  COVERAGE_RESEARCH_TARGET_INELIGIBLE: {
    category: "coverage",
    message_zh: "目標內容不符合研究資格。",
    impact: "此操作未執行。",
    next_actions: ["確認目標為可研究的來源或候選內容後重新送出。"],
  },
  COVERAGE_RESOLUTION_DUPLICATE: {
    category: "coverage",
    message_zh: "此決議已經存在。",
    impact: "此操作未執行。",
    next_actions: ["確認目前的決議狀態，避免重複送出。"],
  },
  COVERAGE_RESEARCH_APPROVAL_REQUIRED: {
    category: "coverage",
    message_zh: "來源尚未經使用者或 Director 批准。",
    impact: "此操作未執行。",
    next_actions: ["先批准候選來源再提取。"],
  },
  COVERAGE_SUPPLEMENT_REQUIRED: {
    category: "coverage",
    message_zh: "缺少使用者補充內容。",
    impact: "此操作未執行。",
    next_actions: ["提供補充文字、URL 或附件。"],
  },
  COVERAGE_USER_DECISION_INVALID: {
    category: "coverage",
    message_zh: "Coverage 使用者決定無效。",
    impact: "此操作未執行。",
    next_actions: ["以合法的 action 與 requirement 重新提交決定。"],
  },
  INTERNAL_ERROR: {
    category: "internal",
    message_zh: "伺服器發生未預期的內部錯誤。",
    impact: "操作未完成。",
    next_actions: ["查看 server log，修復後重新整理再試。"],
  },
  ADAPTATION_DECISION_FACT_INVALID: {
    category: "review",
    message_zh: "改編決定參照的事實無效。",
    impact: "此操作未執行。",
    next_actions: ["以合法的事實參照重新提交改編決定。"],
  },
  ATTACHMENT_REQUIRED: {
    category: "storage",
    message_zh: "此操作需要至少一個附件。",
    impact: "此請求未執行。",
    next_actions: ["附上檔案後重新送出。"],
  },
  BLUEPRINT_CHARACTER_REQUIRED: {
    category: "blueprint",
    message_zh: "Blueprint 缺少角色定義。",
    impact: "此操作未執行。",
    next_actions: ["確認 Blueprint 包含角色後重試。"],
  },
  BLUEPRINT_REQUIRED: {
    category: "blueprint",
    message_zh: "缺少 Blueprint 內容。",
    impact: "此操作未執行。",
    next_actions: ["確認 Blueprint 已建立後重試。"],
  },
  BUILD_MODE_INVALID: {
    category: "build",
    message_zh: "指定的建置模式無效。",
    impact: "此請求未執行。",
    next_actions: ["以支援的模式重新送出。"],
  },
  CARD_IMAGE_DECODE_FAILED: {
    category: "image",
    message_zh: "卡片圖片無法解碼。",
    impact: "此操作未執行。",
    next_actions: ["確認圖片格式正確後重新送出。"],
  },
  CARD_IMAGE_REQUIRED: {
    category: "image",
    message_zh: "建置卡片需要圖片。",
    impact: "此操作未執行。",
    next_actions: ["補上卡片圖片後重試。"],
  },
  CHARACTER_SETTINGS_REQUIRED: {
    category: "blueprint",
    message_zh: "角色設定內容缺失。",
    impact: "此操作未執行。",
    next_actions: ["確認角色設定完整後重試。"],
  },
  COVERAGE_RESEARCH_TASK_ALREADY_RECOVERED: {
    category: "coverage",
    message_zh: "此研究任務已完成恢復。",
    impact: "此操作未執行。",
    next_actions: ["重新整理後確認目前任務狀態。"],
  },
  DASHBOARD_CURSOR_INVALID: {
    category: "input",
    message_zh: "分頁游標格式無效。",
    impact: "此請求未執行。",
    next_actions: ["移除或修正游標參數後重新送出。"],
  },
  DASHBOARD_CURSOR_STALE: {
    category: "input",
    message_zh: "分頁游標已過期。",
    impact: "此請求未執行。",
    next_actions: ["回到第一頁重新取得最新游標。"],
  },
  DASHBOARD_FILTER_INVALID: {
    category: "input",
    message_zh: "Dashboard 篩選參數無效。",
    impact: "此請求未執行。",
    next_actions: ["修正篩選參數後重新送出。"],
  },
  DASHBOARD_PATH_INVALID: {
    category: "input",
    message_zh: "Dashboard 資源識別碼無效。",
    impact: "此請求未執行。",
    next_actions: ["確認資源識別碼後重新送出。"],
  },
  DASHBOARD_QUERY_INVALID: {
    category: "input",
    message_zh: "Dashboard 查詢參數無效。",
    impact: "此請求未執行。",
    next_actions: ["修正查詢參數後重新送出。"],
  },
  FACT_REFERENCE_INVALID: {
    category: "review",
    message_zh: "事實參照無效。",
    impact: "此操作未執行。",
    next_actions: ["以合法的事實參照重新送出。"],
  },
  IDEMPOTENCY_CONFLICT: {
    category: "storage",
    message_zh: "重複提交與既有操作衝突。",
    impact: "此請求未執行。",
    next_actions: ["沿用既有操作的結果，或等待其完成後再重試。"],
  },
  INTERVIEW_ANSWER_EMPTY: {
    category: "project",
    message_zh: "訪談答案不可為空白。",
    impact: "此請求未執行。",
    next_actions: ["輸入答案後重新送出。"],
  },
  INTERVIEW_PRECHECK_INVALID: {
    category: "project",
    message_zh: "訪談預檢內容無效。",
    impact: "此操作未執行。",
    next_actions: ["確認預檢內容後重試。"],
  },
  INTERVIEW_PRECHECK_STALE: {
    category: "project",
    message_zh: "訪談預檢已過期。",
    impact: "此操作未執行。",
    next_actions: ["重新產生預檢後再送出。"],
  },
  INTERVIEW_REQUIRED: {
    category: "project",
    message_zh: "此操作需要先完成訪談。",
    impact: "此請求未執行。",
    next_actions: ["完成訪談後重試。"],
  },
  LEGACY_CARD_NOT_FOUND: {
    category: "import",
    message_zh: "找不到指定的舊版角色卡。",
    impact: "此操作未執行。",
    next_actions: ["確認角色卡檔案存在後重試。"],
  },
  LEGACY_CARD_UNREADABLE: {
    category: "import",
    message_zh: "舊版角色卡無法讀取。",
    impact: "此操作未執行。",
    next_actions: ["確認角色卡格式正確後重試。"],
  },
  MODE_SELECTION_REQUIRED: {
    category: "build",
    message_zh: "此專案需要選擇建置模式。",
    impact: "此請求未執行。",
    next_actions: ["先選擇模式（zhuji/palette/both）再送出。"],
  },
  OPERATION_COMMAND_INVALID: {
    category: "operation",
    message_zh: "操作指令無效。",
    impact: "此請求未執行。",
    next_actions: ["確認指令內容後重新送出。"],
  },
  OPERATION_NOT_RECOVERABLE: {
    category: "operation",
    message_zh: "此操作無法恢復。",
    impact: "此請求未執行。",
    next_actions: ["確認操作狀態後重試。"],
  },
  OPERATION_NOT_RESUMABLE: {
    category: "operation",
    message_zh: "此操作無法繼續。",
    impact: "此請求未執行。",
    next_actions: ["確認操作狀態後重試。"],
  },
  PROJECT_NOT_FOUND: {
    category: "project",
    message_zh: "找不到指定的專案。",
    impact: "此請求未執行。",
    next_actions: ["確認專案識別碼後重新送出。"],
  },
  PROJECT_SELECTION_AMBIGUOUS: {
    category: "project",
    message_zh: "專案選擇不明確。",
    impact: "此請求未執行。",
    next_actions: ["以唯一的專案識別碼重新送出。"],
  },
  PROJECT_SELECTION_INVALID: {
    category: "project",
    message_zh: "專案選擇無效。",
    impact: "此請求未執行。",
    next_actions: ["確認專案識別碼後重新送出。"],
  },
  PROVENANCE_CONFIRMATION_STALE: {
    category: "build",
    message_zh: "發布確認已過期。",
    impact: "此請求未執行。",
    next_actions: ["重新預覽並確認發布。"],
  },
  PUBLISH_DOWNLOAD_HASH_MISMATCH: {
    category: "build",
    message_zh: "下載內容與記錄不符。",
    impact: "此請求未執行。",
    next_actions: ["重新建置並下載。"],
  },
  PUBLISH_DOWNLOAD_KIND_INVALID: {
    category: "build",
    message_zh: "下載類型無效。",
    impact: "此請求未執行。",
    next_actions: ["以支援的下載類型重新送出。"],
  },
  PUBLISH_DOWNLOAD_LEGACY: {
    category: "build",
    message_zh: "此發布使用舊版格式，無法下載。",
    impact: "此請求未執行。",
    next_actions: ["重新發布後再下載。"],
  },
  PUBLISH_DOWNLOAD_MISSING: {
    category: "build",
    message_zh: "發布的產物已不存在。",
    impact: "此請求未執行。",
    next_actions: ["重新發布後再下載。"],
  },
  PUBLISH_DOWNLOAD_PATH_INVALID: {
    category: "build",
    message_zh: "下載路徑無效。",
    impact: "此請求未執行。",
    next_actions: ["確認下載路徑後重新送出。"],
  },
  PUBLISH_ID_REQUIRED: {
    category: "build",
    message_zh: "需要發布識別碼。",
    impact: "此請求未執行。",
    next_actions: ["帶上發布識別碼後重新送出。"],
  },
  PUBLISH_NOT_FOUND: {
    category: "build",
    message_zh: "找不到指定的發布記錄。",
    impact: "此請求未執行。",
    next_actions: ["確認發布識別碼後重新送出。"],
  },
  REQUEST_EMPTY: {
    category: "input",
    message_zh: "請求內容為空白。",
    impact: "此請求未執行。",
    next_actions: ["輸入請求內容後重新送出。"],
  },
  SOURCE_SELECTION_EMPTY: {
    category: "source",
    message_zh: "來源選擇為空白。",
    impact: "此請求未執行。",
    next_actions: ["選擇至少一個來源後重新送出。"],
  },
  URL_CONTENT_EMPTY: {
    category: "source",
    message_zh: "取得的網址內容為空白。",
    impact: "此操作未執行。",
    next_actions: ["確認網址可正常存取後重試。"],
  },
  URL_CONTENT_INVALID: {
    category: "source",
    message_zh: "取得的網址內容無效。",
    impact: "此操作未執行。",
    next_actions: ["確認網址內容後重試。"],
  },
  URL_FETCH_FAILED: {
    category: "source",
    message_zh: "無法取得網址內容。",
    impact: "此操作未執行。",
    next_actions: ["確認網路與網址後重試。"],
  },
  URL_FETCHER_UNAVAILABLE: {
    category: "source",
    message_zh: "網址取得服務不可用。",
    impact: "此操作未執行。",
    next_actions: ["確認服務設定後重試。"],
  },
  ZHUJI_SCHEMA_INVALID: {
    category: "template",
    message_zh: "主機模板內容不符合 schema。",
    impact: "此操作未執行。",
    next_actions: ["修正內容後重新送出。"],
  },
  CHARACTER_ID_REQUIRED: {
    category: "blueprint",
    message_zh: "需要角色識別碼。",
    impact: "此請求未執行。",
    next_actions: ["帶上角色識別碼後重新送出。"],
  },
  COVER_SELECT_REQUIRED: {
    category: "image",
    message_zh: "需要選擇封面圖片。",
    impact: "此請求未執行。",
    next_actions: ["選擇封面圖片後重新送出。"],
  },
  IMAGE_INPUT_REQUIRED: {
    category: "image",
    message_zh: "需要圖片輸入。",
    impact: "此請求未執行。",
    next_actions: ["附上圖片後重新送出。"],
  },
  INTERVIEW_AMEND_PREVIEW_REQUIRED: {
    category: "project",
    message_zh: "需要修訂預覽內容。",
    impact: "此請求未執行。",
    next_actions: ["帶上修訂預覽內容後重新送出。"],
  },
  INTERVIEW_AMEND_REQUIRED: {
    category: "project",
    message_zh: "需要修訂內容。",
    impact: "此請求未執行。",
    next_actions: ["帶上修訂內容後重新送出。"],
  },
  PROVENANCE_CONFIRMATION_REQUIRED: {
    category: "build",
    message_zh: "需要發布確認。",
    impact: "此請求未執行。",
    next_actions: ["帶上發布確認後重新送出。"],
  },
  SOURCE_IDS_REQUIRED: {
    category: "source",
    message_zh: "需要來源識別碼。",
    impact: "此請求未執行。",
    next_actions: ["帶上來源識別碼後重新送出。"],
  },
  DASHBOARD_ARTIFACT_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定的成品記錄。",
    impact: "此請求未執行。",
    next_actions: ["確認成品識別碼後重新送出。"],
  },
  DASHBOARD_ARTIFACT_COVERAGE_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定成品的 Coverage 資料。",
    impact: "此請求未執行。",
    next_actions: ["確認成品與 Coverage 狀態後重新送出。"],
  },
  DASHBOARD_SOURCE_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定的來源記錄。",
    impact: "此請求未執行。",
    next_actions: ["確認來源識別碼後重新送出。"],
  },
  DASHBOARD_CANDIDATE_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定的候選來源。",
    impact: "此請求未執行。",
    next_actions: ["確認候選識別碼後重新送出。"],
  },
  DASHBOARD_OPERATION_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定的操作記錄。",
    impact: "此請求未執行。",
    next_actions: ["確認操作識別碼後重新送出。"],
  },
  DASHBOARD_REVIEW_RUN_NOT_FOUND: {
    category: "input",
    message_zh: "找不到指定的事實審查記錄。",
    impact: "此請求未執行。",
    next_actions: ["確認審查識別碼後重新送出。"],
  },
  TRANSACTION_RECOVERY_REQUIRED: {
    category: "storage",
    message_zh: "交易無法安全回滾，需要復原程序介入。",
    impact: "此操作未完成，可能留下未完成的交易記錄。",
    next_actions: ["查看 server log 中的交易識別碼，確認目前專案狀態後重試。"],
  },
  TRANSACTION_RECOVERY_UNCERTAIN: {
    category: "storage",
    message_zh: "交易復原結果不確定，無法確認檔案狀態。",
    impact: "此操作未完成，檔案狀態可能未完全還原。",
    next_actions: ["查看 server log 中的交易識別碼與路徑，確認檔案後重試。"],
  },
  REQUEST_TARGET_INVALID: {
    category: "input",
    message_zh: "請求目標格式無效，無法解析。",
    impact: "此請求未執行。",
    next_actions: ["確認請求的網址格式正確後重新送出。"],
  },
  AUTH_TOKEN_BLANK: {
    category: "auth",
    message_zh: "認證權杖不得為空白。",
    impact: "server 無法啟動。",
    next_actions: ["設定非空白的認證權杖後重新啟動。"],
  },
  CSRF_DENIED: {
    category: "security",
    message_zh: "已拒絕跨站或跨來源的變更請求。",
    impact: "此操作未執行，未產生任何變更。",
    next_actions: ["從 Dashboard 頁面重新操作，或確認請求來源符合 server 主機。"],
  },
  CSRF_CONFIRMATION_REQUIRED: {
    category: "security",
    message_zh: "高影響操作需要明確的確認。",
    impact: "此操作未執行。",
    next_actions: ["在確認對話框明確確認後重新送出操作。"],
  },
};

const CATEGORY_BY_PREFIX: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^REQUEST_/u, category: "input" },
  { pattern: /^CSRF_/u, category: "security" },
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
  { pattern: /^TRANSACTION_/u, category: "storage" },
  { pattern: /^ATTACHMENT_/u, category: "storage" },
  { pattern: /^EXECUTION_/u, category: "operation" },
  { pattern: /^COVERAGE_/u, category: "coverage" },
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
    const details = "details" in error && typeof (error as { details?: unknown }).details === "object" && (error as { details?: unknown }).details !== null
      ? (error as { details: Record<string, unknown> }).details
      : undefined;
    const cataloged = ERROR_CATALOG[code];
    if (cataloged !== undefined) {
      return {
        code,
        category: cataloged.category,
        recoverable,
        message_zh: cataloged.message_zh,
        impact: cataloged.impact,
        next_actions: cataloged.next_actions,
        error: message,
        ...(details === undefined ? {} : { details }),
      };
    }
    return {
      code: "INTERNAL_ERROR",
      category: "internal",
      recoverable,
      message_zh: "伺服器發生未預期的內部錯誤。",
      impact: "操作未完成。",
      next_actions: FALLBACK_NEXT_ACTIONS,
      error: message,
      ...(details === undefined ? {} : { details }),
      uncatalogued_code: code,
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

export function httpStatusFor(payload: ErrorPayload): number {
  if (payload.code === "UNAUTHORIZED" || payload.code === "EXTERNAL_HOST_AUTH_REQUIRED") return 401;
  if (
    payload.code === "AGENT_CAPABILITY_DENIED" ||
    payload.code === "AGENT_READ_ONLY" ||
    payload.code === "CSRF_DENIED" ||
    payload.code === "CSRF_CONFIRMATION_REQUIRED"
  )
    return 403;
  if (payload.code === "REQUEST_TOO_LARGE") return 413;
  if (payload.code === "REVISION_CONFLICT" || payload.code === "IDEMPOTENCY_CONFLICT") return 409;
  if (payload.code === "NOT_FOUND" || payload.code.endsWith("_NOT_FOUND")) return 404;
  if (payload.code === "INTERNAL_ERROR" || !payload.recoverable) return 500;
  return 400;
}
