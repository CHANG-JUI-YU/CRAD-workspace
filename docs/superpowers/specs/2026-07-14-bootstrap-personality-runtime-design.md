# Bootstrap、Personality 與 Runtime 修正設計

日期：2026-07-14

## 目標

修正三個彼此相關的執行期缺口：

1. Director 在專案不存在時無法建立合法專案，所有 Forge 工具卻都要求專案已存在。
2. Agent registry 的 personality 僅通過設定檢查，未進入 OpenCode 實際 system prompt。
3. 專案全域 deny 連帶停用內建 Build Agent，且 MCP runtime 使用的 `dist` 可能落後於 `src`。

## 不變條件

- Director 與專職 Agent 不取得一般 workspace 讀寫或 shell 權限。
- 所有 project-scoped 工具繼續受 schema、capability、stage、task、lease、gate、ownership、provenance 與 transaction 約束。
- 初始化不得覆寫既有專案、不得越過 `projects/` 根目錄，也不得以人工 mkdir 取代正式 project foundation。
- Personality 只影響語氣與創作風格，不得改寫工具、權限、schema、gate、ownership、provenance 或工作契約。
- Build Agent 只恢復一般程式開發工具，不得取得任何 `forge_*` 工具。

## 架構

### Workspace Bootstrap

新增 Director 專用 Forge 工具 `project_initialize`。它是 workspace-scoped bootstrap 工具，不依賴既有 project foundation；其餘 Forge 工具仍是 project-scoped，必須先通過 `validateProject()`。

`project_initialize` 接受 `project_id`、專案標題與角色清單，使用既有 manifest schema 驗證輸入，再呼叫 `@card-workspace/project` 的 `initializeProject()` 建立完整專案。初始化邏輯不在 MCP server 重寫，以 CLI 與 Forge 共用同一個 authoritative implementation。

Director registry 增加明確 bootstrap capability。MCP server 同時檢查呼叫者為 Director 且具該 capability；其他 Agent 即使直接呼叫工具也會被拒絕。成功後 Director 必須另外呼叫既有 `workflow_start`，初始化不隱含開始 workflow。

### Personality Prompt Binding

每個 OpenCode Agent 的 `prompt` 使用兩個原生 file substitutions 組合：

```text
{file:./.opencode/prompts/<agent-id>.md}

{file:./workflow/personalities/<personality-id>.yaml}
```

OpenCode 1.17.20 已驗證可將兩個檔案內容展開成同一個實際 prompt。Agent markdown 保留角色工作契約，YAML 保持 personality 的單一真實來源；不建立生成檔，也不複製 profile 文字。

Agent lint 增加 prompt binding invariant：registry 的 `agent_file` 與 `personality` 必須分別出現在對應 OpenCode Agent prompt。這可防止 profile 存在且 registry cross-reference 正確，但實際 prompt 指向錯誤檔案。

### Build Agent 權限

在 `opencode.jsonc` 明確定義內建 `build` Agent 的一般開發權限，以覆蓋專案全域 deny。允許 read、edit、bash、glob、grep、list、lsp、task、webfetch、skill、question 與 todo 類開發能力；不加入 `forge_*` allow，因此全域 Forge deny 仍生效。

Director 與 10 個專職 Agent 的既有隔離權限不放寬。

### Runtime Build

完成原始碼修改後執行正式 workspace build，更新 MCP command 實際載入的 package `dist`。驗證不能只執行 `tsc --noEmit`。

## 資料流

1. 使用者要求 Director 建立專案，提供 project id、標題與至少一個角色。
2. Director 呼叫 `project_initialize`。
3. MCP bootstrap authorization 驗證 Agent identity 與 capability。
4. Manifest schema 與 project path 驗證通過後，`initializeProject()` 以 transaction 建立完整 foundation。
5. MCP 回傳已建立的 project id 與 foundation 狀態。
6. Director 呼叫 `workflow_start`，此時走原有 project validation 與 policy authorization。
7. 後續 task、proposal、review、gate、preview、publish 流程完全不變。

OpenCode 啟動時則分別展開 Agent 契約與 registry 指定 personality，兩者共同構成該 Agent 的 system prompt。

## 錯誤行為

- 不合法 project id、空標題、空角色清單或不合法角色資料：回傳 schema/input error，不建立任何檔案。
- project path 越界：拒絕初始化。
- project 已存在：保留既有 `PROJECT_EXISTS` 行為，不覆寫、不合併。
- 非 Director 或缺少 bootstrap capability：回傳 authorization error。
- 初始化 transaction 失敗：不留下部分 foundation。
- personality 或 agent file 遺失、registry/profile/prompt 不一致：agent lint 失敗。
- `dist` 未更新導致 runtime 與 source 不一致：正式 build 與 runtime smoke test 必須偵測。

## 驗證

- 單元或整合測試證明 Director 能初始化新專案。
- 測試其他 Agent 呼叫初始化會被拒絕。
- 測試既有專案不覆寫、路徑越界拒絕、無效輸入不留下部分檔案。
- 測試初始化後可執行 `workflow_start`。
- 測試 11 個 registry Agent 的 prompt 同時綁定正確 agent file 與 personality file。
- 用 `opencode debug agent` smoke test 確認實際 prompt 包含對應 personality。
- 用 `opencode debug agent build` 確認一般開發工具可用且 Forge 工具不可用。
- 執行 agent lint、workspace build、ESLint、所有 package typecheck 與全 repo Vitest。

## 非目標

- 不讓 Director 或專職 Agent直接讀寫 workspace。
- 不新增第二套 project initializer。
- 不把 personality 搬進 Agent markdown 或複製成生成 prompt。
- 不改變既有 workflow stages、gates、proposal ownership 或 publish transaction。
