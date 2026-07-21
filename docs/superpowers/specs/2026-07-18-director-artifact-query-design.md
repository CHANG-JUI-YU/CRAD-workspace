# Director 受控唯讀 Artifact 查詢設計

## 目標

讓 Director 在沒有一般 filesystem 權限、正式 task 或 lease 的情況下，安全地列出並讀取指定專案的正式產物。這項能力用於角色、世界設定與 Greetings 修訂前的 evidence 核對，也支援檢視 Blueprint、review reports 與 compile preview metadata。

本設計只增加唯讀查詢，不改變 workflow、artifact、gate、task、專案檔案或 export。

## 工具介面

### `project_artifact_list`

輸入：

- `project_id`

輸出每個目前可解析的正式產物描述：

- `artifact_id`
- `kind`
- `contract`（若有）
- `revision`
- `status`

工具不回傳實體或相對檔案路徑，也不接受 glob、prefix 或 filesystem path。

### `project_artifact_read`

輸入：

- `project_id`
- `artifact_id`
- `revision`

輸出：

- 與索引相同的 artifact 描述
- 經 schema 或 typed project loader 解析的 `content`

`revision` 必須與受控索引中的 exact revision 相同。工具每次只讀一個 artifact，不提供任意 JSON Pointer 或 raw file read。

## 可查詢範圍

受控索引包含：

- Blueprint
- 角色 manifest 與珠璣模式／調色盤模式模組
- 多維世界設定條目
- Greetings
- completed workflow task 產生的 review reports
- workflow 已登記的 compile preview metadata

作者產物由 `loadAuthorProject` 及其 `sourceRevisions` 建立索引，不從使用者輸入組合路徑。Review report 必須能由 completed task 的 exact `result` reference 反查。Preview 必須存在於 `workflow.artifacts`，並透過既有 preview reader 驗證 schema 與內容 revision。

Stale preview 仍可列出與讀取，並保留 `status: stale`，供 Director 理解歷史審核依據。若作者產物已被覆寫而舊 revision 不再存在，工具不宣稱該舊內容可讀。

## 授權

- 兩個工具都只授權 Director。
- 所有 workflow stage 均可使用。
- 不需要 active task、task capability 或 lease。
- 工具為純唯讀，不提交 workflow event，也不增加 workflow revision。
- Director 仍禁止一般 `read`、`glob`、`grep`；本工具不是 filesystem 權限旁路。

## 解析流程

1. 驗證呼叫者為 Director，並解析 `project_id`。
2. 使用正式 project loader 載入 manifest、workflow 與作者產物。
3. 由 typed author project、workflow artifacts 與 completed task results 建立 artifact 索引。
4. `project_artifact_list` 回傳索引描述，不載入未請求的 review／preview 內容。
5. `project_artifact_read` 以 exact `artifact_id` 找到 resolver，核對要求的 revision，再讀取並驗證內容。
6. 回傳解析後的結構化內容，不暴露儲存路徑。

Artifact ID 到 resolver 的對應只由伺服器建立。任何 artifact ID 都不能直接插入 path join 或檔案讀取操作。

## 錯誤契約

- `PROJECT_INVALID`：指定專案無法通過正式 loader 驗證。
- `ARTIFACT_NOT_FOUND`：artifact ID 不在受控索引。
- `ARTIFACT_REVISION_CONFLICT`：要求的 revision 不是索引中的 exact revision。
- `ARTIFACT_CONTENT_UNAVAILABLE`：索引存在，但正式內容遺失或無法取得。
- `ARTIFACT_CONTENT_INVALID`：review result 或 preview 的 schema、hash 或登記 revision 不一致。

授權錯誤沿用既有 MCP policy contract。所有錯誤都不得退回 raw filesystem read。

## 測試

回歸測試至少覆蓋：

- 列出並讀取 Blueprint、角色模組、世界條目與 Greetings。
- 讀取 completed task 的 exact review report。
- 讀取有效與 stale compile preview metadata。
- 錯誤 revision 被拒絕。
- 未登記或偽造 artifact ID 被拒絕。
- review／preview 內容與登記 revision 不一致時被拒絕。
- 非 Director 呼叫被拒絕。
- Director 在沒有 active task 與 lease 時仍可查詢。
- 查詢不改變 workflow revision 或任何專案檔案。

驗證命令包含 targeted Vitest、完整 Vitest、TypeScript、ESLint、Agent lint 與 build，並確認 runtime dist 已註冊兩個工具。測試與實作不得修改 `projects/*`。

## 非目標

- 不提供任意檔案、raw path、glob 或全文搜尋。
- 不提供歷史作者檔案版本儲存。
- 不修改 `workflow_status` 回傳內容。
- 不建立 task、lease、decision 或 workflow event。
- 不在本切片處理 Source Adaptation、模式轉換、通用 task recovery 或專案 archive／restore。
