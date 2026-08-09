# 專案啟動隔離與 OpenCode 互動式選單設計

## 狀態

已獲使用者確認；已完成實作與驗證（2026-08-09）。

## 背景與問題

目前 `WorkspaceProjectManager` 在沒有明確專案 ID 時，會先把
`project-001` 綁成目前 runtime。若該資料夾已存在，OpenCode 的第一個
`workspace_interview_context` 會直接讀取既有訪談，因此重新開始時可能載入
上一個專案的角色名單、來源與訪談進度。

此外，Director 目前雖然收到引擎的選項，主要仍以一般文字呈現。這會讓
OpenCode 無法顯示舊工作區那種可用方向鍵、Enter、Esc 操作的互動選單，並且
容易讓模型把多題合併成一段前置問卷。

## 目標

1. OpenCode 沒有明確專案選擇時，永遠以新的工作階段開始，不讀取既有專案。
2. 新專案使用下一個未占用的 `project-###` 暫時 ID；完成命名後仍依現有規則移動到正式專案資料夾。
3. 舊專案只能透過明確的「繼續專案」流程、`workspace_project_select` 或
   `ST_WORKSPACE_PROJECT` 載入。
4. Director 將引擎回傳的單一問題轉成 OpenCode 原生 `question` 互動式選單，
   讓使用者可以用方向鍵選擇、Enter 送出、Esc 取消，並在該題允許時使用自訂文字。
5. 保留引擎的題目順序、選項順序與逐題原子保存；互動式選單只是呈現層，不改變
   interview schema 或 workflow 規則。
6. 既有 project API、明確專案環境變數與已完成專案資料不被覆寫或刪除。

## 非目標

- 不建立瀏覽器 dashboard 的新互動元件；本次只處理 OpenCode/TUI 的
  `question` 呈現。
- 不把底層 revision、operation、CAS 或資料夾路徑暴露給使用者選擇。
- 不改變原作改編的 Source/Facts 流程、Blueprint gate 或正式產物格式。
- 不把訪談改成一次提交的批次問卷。

## 使用者體驗

### 新工作階段

1. OpenCode 啟動 Director，且沒有 `ST_WORKSPACE_PROJECT` 或其他明確專案選擇。
2. Director 讀取 `workspace_interview_context`；manager 在這一刻建立一個新的
   暫時 project ID，不會讀取同名的既有資料夾。
3. Director 以 OpenCode `question` 顯示引擎的目前唯一問題。例如首題仍為：
   「這次想進行哪一種工作？」並原樣顯示五個引擎選項：
   「角色設定」「世界設定」「繼續專案」「舊卡審核」「擴充既有角色卡」。
4. 使用者選定後，Director 只把該選擇送到 `workspace_interview_answer`，等待
   下一題，再建立下一次 `question`。不在同一個選單或文字回覆預先要求後續題目。
5. 專案名稱在訪談完成後才寫入；既有命名與資料夾物化規則維持不變。

### 繼續既有專案

1. 使用者在首題選擇「繼續專案」，或明確提出繼續某個專案。
2. Director 先呼叫 `workspace_projects` 取得可選清單，再用 OpenCode `question`
   顯示專案的使用者可讀名稱；必要時提供資料夾名稱作為次要識別，不顯示內部
   revision 或 lease。
3. 選定後才呼叫 `workspace_project_select`。載入成功後，Director 再讀取該專案的
   interview/status，並從保存的目前唯一問題繼續。
4. 使用者按 Esc 或取消時，不改變目前 active project，也不產生新訪談答案。

### 互動式選單契約

- 選項的 label、順序與引擎回傳值保持一對一映射；不可由 Director 自行改寫、合併、
  增加決策選項或加入情色化描述。
- 題目屬於 `free_text` 或引擎明確允許自訂答案時，才開啟 OpenCode 的自訂輸入欄。
  固定選項題仍可由引擎決定是否允許自訂；呈現層不得自行放寬 schema。
- `question` 工具送出後，Director 必須停止本回合。取消、空答案或無效答案交由
  engine 回傳可恢復錯誤，重新顯示同一題，不建立下一個 operation。
- OpenCode 無法提供互動工具時，才退回清楚的純文字選項；退回模式仍須一題一答，
  並在回覆中不假裝已顯示 TUI 選單。

## 技術設計

### Session bootstrap

`WorkspaceProjectManager` 增加「fresh-by-default」啟動策略：

- 沒有明確 `initialProjectId` 時，不把 `project-001` 當成可恢復的 active project。
- manager 第一次需要 runtime（訪談 context、request、answer 或 worker 需要讀取時）
  先列舉受控 projects root，計算下一個未占用的 `project-###`，再建立新的
  `FileProjectRepository` 與 `WorkspaceRuntime`。
- 若同一 manager 已有 active project，後續 context/answer/request 都繼續使用它；
  不因重新呼叫 context 而再建立第二個專案。
- `startNewProject()` 仍可明確呼叫，並以同樣的序號碰撞檢查建立下一個 project。
- `select()` 是唯一的既有專案切換入口。切換前保留目前 session；切換後所有 runtime
  操作都綁定所選 repository。
- 明確提供 `initialProjectId` 或 `ST_WORKSPACE_PROJECT` 時，維持目前的直接選取行為，
  以支援腳本、CI 與既有專案修訂。

序號分配必須在實際建立前重新檢查目錄與 state，避免兩個 OpenCode/Server instance
同時啟動時選到同一個 ID。碰撞時只重算下一個 ID，不覆寫任何現有資料夾。

### Server/CLI 整合

- `startWorkspaceServer` 在未選取專案時使用 manager 的 fresh-by-default 策略；
  HTTP/MCP 路由不再於啟動階段讀取 `project-001` 的訪談。
- `/workspace/interview/context`、`workspace_interview_context`、`/workspace/request`
  與 MCP `workspace_request` 都走同一個 lazy bootstrap 路徑。
- `/workspace/projects` 仍列出所有可選既有專案，但不把尚未開始的新 session
  當成舊專案自動選取。
- 明確選取後，HTTP 與 MCP 都回傳被選專案的可讀名稱、狀態與目前問題；不暴露內部
  儲存細節。
- CLI 在沒有 `ST_WORKSPACE_PROJECT` 時採用相同策略，避免 CLI 與 OpenCode 啟動結果不同。

### Director/OpenCode 整合

更新 Director 的 orchestration contract 與 prompt：

1. 每次開始／繼續訪談先讀 `workspace_interview_context`。
2. 若回傳有 `question` 與 `options`，呼叫 OpenCode 內建 `question`，以一個問題、
   一組選項呈現；不在一般文字中模擬多題問卷。
3. 使用者回答後只呼叫 `workspace_interview_answer`，再依下一題重複流程。
4. 「繼續專案」路徑先讀 `workspace_projects`，再用 `question` 讓使用者選擇，最後
   才呼叫 `workspace_project_select`。
5. `question` 取消或引擎拒絕時，保持目前狀態並用同一題重試；禁止自行替使用者選值。

OpenCode `question` 的具體參數由目前 OpenCode 版本提供的工具 schema 決定；工作區
只負責提供穩定的題目文字、選項 label/value 與可否自訂的標記，不在專案內複製一套
TUI 實作。

## 相容性與錯誤處理

- 舊的 `project-001`、已命名專案與現有資料夾完全保留。
- 明確選取不存在的專案仍回傳可恢復的 `PROJECT_NOT_FOUND`；不會退回讀取其他專案。
- `ST_WORKSPACE_PROJECT` 指向既有專案時，fresh-by-default 不生效，確保自動化流程可
  精確重現。
- OpenCode `question` 不可用時退回純文字，但必須記錄呈現模式並維持一題一答。
- 無效選項、編碼錯誤、空答案與取消都不會推進訪談、不會建立第二份答案。
- 啟動流程若在建立新 ID 前失敗，不會刪除或改寫既有專案；下一次啟動可重新計算 ID。

## 測試與驗收

### Project manager/runtime

- root 已有 active `project-001` 時，無明確 project ID 的第一次 interview context
  必須使用新 ID，且回傳首題，不得回傳 `project-001` 的舊 answers/characters。
- root 已有多個 project 時，新 session 使用最小未占用序號；既有目錄內容不變。
- 同一 manager 的第二次 context、answer 與 request 維持同一新 project ID。
- 明確 `select("project-001")` 後能讀回舊狀態；不存在的選取回傳 `PROJECT_NOT_FOUND`。
- `ST_WORKSPACE_PROJECT` 與 `initialProjectId` 仍可直接載入指定專案。
- 兩個並行的新 session 不會覆寫同一 project directory。

### Server/CLI

- server 啟動後第一次 `/workspace/interview/context` 不會自動載入舊 project。
- MCP 與 HTTP 的新 session 行為一致。
- `/workspace/projects` 可列出舊專案，選取後才切換 active project。
- CLI 在相同 projects root 下與 server 使用相同的 fresh-by-default 行為。

### Director/OpenCode

- 首題以 `question` 一次顯示五個固定選項，順序和值與 engine 一致。
- 每次只提交一個答案；多角色仍逐角色逐題。
- 「繼續專案」會先以 `question` 顯示清單，選取後才呼叫 project select。
- Esc/取消、空答案、無效答案會留在原題，不會寫入答案。
- `question` 不可用時純文字 fallback 可完成同一流程，且不會宣稱有 TUI。

## 風險與取捨

- 新 session 會讓每次未指定專案的 OpenCode 啟動都產生一個新的暫時專案；這是避免
  舊專案誤載入的必要代價。未完成的暫時專案仍可由 project list 找到並明確繼續。
- OpenCode 內建 `question` 的 UI schema 可能在版本間變化，因此只在 Director prompt
  描述語意契約，不把 UI 細節寫死在 runtime API。
- 直接使用 server HTTP API 的客戶端不會自動取得 TUI；它們仍可使用同一個逐題 JSON
  contract，這保持了 API 相容性。
