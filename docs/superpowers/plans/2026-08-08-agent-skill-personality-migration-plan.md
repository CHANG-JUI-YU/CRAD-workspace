# Agent、Skill 與 Personality 遷移實作計畫

- 狀態：已完成
- 日期：2026-08-08
- 目標：將舊工作區的 Agent、Skill 與 personality 遷移到 ST-workspace-v3
- 設計依據：docs/superpowers/specs/2026-08-08-agent-skill-personality-migration-design.md

目前進度：

- [x] Phase 0：資產盤點與封存
- [x] Phase A：建立 .agents 與 personality 複製驗證
- [x] Phase B：registry、alias 與高階 Agent prompt
- [x] Phase C：20 個 Skill 高階化適配
- [x] Phase D：Runtime Agent Adapter 與自然語言路由
- [x] Phase E：agent-lint、相容性測試與 smoke coverage
- [x] Phase F：最終 pnpm check 與乾淨工作區驗收

## 1. 執行邊界

- 只修改 C:\AI\projects\ST-workspace-v3。
- C:\AI\projects\card-workspace 僅作為唯讀來源，不直接修改。
- 不搬移 node_modules、dist、coverage 或任何暫存輸出。
- 先完成一個階段並通過檢查，再進入下一個階段。
- 遷移期間不刪除舊核心功能；若需要簡化，只移除 Agent/Skill 公開契約中的低階欄位。

## 2. 目前基線

在任何程式碼變更前記錄：

1. 新工作區目前的 pnpm check 結果。
2. 目前測試數量、coverage 與 build 輸出。
3. 舊工作區 Agent registry、personality 與 Skill 的檔案清單及雜湊。
4. 新舊工作區的相對路徑與名稱衝突。

產出：

- docs/migration/agent-skill-inventory.json
- docs/migration/agent-skill-map.md

驗收：舊資產數量確認為 22 個 Agent、22 份 personality YAML 加 1 份 runtime 輔助文件、20 個 Skill；每一項都有 migrated、aliased、merged 或 blocked 狀態。

## 3. Phase A：建立資產目錄與 personality 複製

### 工作

1. 建立 .agents/agents、.agents/personalities、.agents/skills。
2. 複製舊 personality YAML，保持內容與繼承關係不變。
3. 建立 personality schema 檢查與繼承鏈檢查。
4. 建立遷移 manifest，記錄來源路徑、目標路徑、雜湊與修改狀態。

### 預計變更

- .agents/personalities/*.yaml
- .agents/migration-manifest.json
- tools/agent-lint.ts

### 驗收

- 22 份 personality YAML 均可解析；runtime 輔助文件同步至 Director active prompt，並保留遷移參考副本。
- 所有 inherits 均能解析且沒有循環。
- 原始 personality 的內容 hash 與目標相同。
- 沒有把人格內容重複貼進 prompt。

## 4. Phase B：建立最小化 registry、alias 與 Agent prompt

### 工作

1. 從舊 workflow/agent-registry.yaml 建立新 .agents/registry.yaml。
2. 只保留 id、role、personality、skills、intents 等路由必要欄位。
3. 將舊名稱寫入 .agents/aliases.yaml。
4. 將舊 prompt 改寫成高階 Intent prompt。
5. 保留 Director、Creator、Critic、Researcher 等角色邊界。
6. 對行為完全相同的 Reviewer 建立共用執行器，但保留舊 alias。

### 預計新增或變更

- .agents/registry.yaml
- .agents/aliases.yaml
- .agents/agents/*.md
- tools/agent-lint.ts

### 明確刪除

Active Agent prompt 不得要求或暴露：

- task、lease、batch、candidate、revision、capability ID
- approval audit 欄位格式
- file_path / bytes_base64 選擇
- 內部 MCP 或 capability 路由名稱

### 驗收

- 22 個舊 Agent 都有新版對應、alias 或明確合併說明。
- 直接以舊 Agent 名稱呼叫仍能被 Router 解析。
- Prompt 只包含高階 Intent、Skill、產出與安全規則。

## 5. Phase C：遷移 20 個 Skill

### 工作

逐一保留舊 Skill 的領域內容，將檔案結構整理為：

- purpose：解決的問題與適用範圍
- knowledge：舊 Skill 的領域知識與工作方法
- quality：必須遵守的品質、可信度與安全規則
- interaction：缺資料、失敗、不確定時的處理方式

移除直接組裝低階 payload 的步驟，改為描述 Agent 應完成的高階工作。特別驗證：

- Source Research 的來源可信度與擷取限制。
- Fact Curator/Reviewer 的可追溯性。
- Creator/Critic 的唯讀與隔離。
- Card、World Lore、Greetings、MVU、EJS、HTML 的創作規則。

### 預計變更

- .agents/skills/*/SKILL.md
- docs/migration/skill-contract-map.md

### 驗收

- 20 個 Skill 都有 active 版本。
- 每個 Skill 都標明適用 Agent 與高階 Intent。
- 可搜尋到的低階名稱只出現在 migration/reference 區域，不出現在操作契約。
- 原有安全規則與品質檢查均有對應段落。

## 6. Phase D：建立 Runtime Agent Adapter

### 工作

在現有 packages/runtime 內新增最小 Agent 層，不另拆大型服務：

- packages/runtime/src/agent-contract.ts
- packages/runtime/src/agent-registry.ts
- packages/runtime/src/agent-router.ts
- packages/runtime/src/agent-adapter.ts
- packages/runtime/test/agent-runtime.test.ts

責任分工：

- agent-contract.ts：定義高階 Intent、Agent resolution 與可讀結果型別。
- agent-registry.ts：載入或驗證 registry 與 alias；若需要 YAML 解析，只作為 build/lint 依賴，不把低階 schema 帶入公開 API。
- agent-router.ts：先處理明確 Agent alias，再依高階 Intent 路由到既有 source、knowledge、authoring、review、build、import 服務。
- agent-adapter.ts：隱藏 ID、格式與儲存細節，將 Core/Domain 錯誤轉成高階結果。

### 相容要求

- 保持 WorkspaceRuntime.request(request, context) 現有呼叫方式可用。
- workspace_request 與 workspace_status MCP/REST 工具名稱不變。
- 不新增要求使用者填寫低階參數的 CLI 選項。
- Agent 層失效時仍可退回既有 WorkspaceRuntime 的高階分類流程。

### 錯誤策略

按照以下順序處理：

1. 從文字與目前上下文推斷。
2. 套用安全預設值。
3. 由 Adapter 進行內容格式轉換或內部資料建立。
4. 高風險歧義才產生一個簡短問題。
5. 外部 fetch 或儲存失敗時輸出部分結果與限制，不直接暴露低階 error code。

來源研究不得繞過受控 fetch；只能將可取得內容轉成受支援的內部表示，或明確標記為未驗證草稿。

## 7. Phase E：Lint、測試與相容性驗證

### Lint

tools/agent-lint.ts 檢查：

- registry schema 與 alias 唯一性。
- personality 存在、繼承鏈與 prompt binding。
- Agent 引用的 Skill 存在。
- 低階參數沒有出現在 active prompt 的輸入與操作契約。
- Creator/Critic 的角色隔離設定完整。

### 單元測試

新增或調整：

- packages/runtime/test/agent-runtime.test.ts
- packages/runtime/test/agent-registry.test.ts
- packages/runtime/test/agent-fallback.test.ts

涵蓋：

- alias 解析與未知 Agent fallback。
- Intent 路由到六種既有高階服務。
- 缺少選填資料時使用預設值。
- 高風險歧義只提出一個問題。
- 低階錯誤轉換為部分結果。
- personality binding 與 Creator/Critic 隔離。

### 整合與回歸測試

至少覆蓋以下自然語言流程：

1. 研究官方來源，不輸入 batch/candidate ID。
2. 以自然語言批准或拒絕候選來源。
3. 來源 fetch 被拒絕時產出未驗證草稿與下一步。
4. 上傳或貼上 md/txt/json 內容時自動處理格式。
5. 建立角色、世界設定、珠璣、調色盤、開場白與關係。
6. 產生並審查 MVU、EJS、HTML。
7. 舊 Agent alias 直接呼叫。
8. Critic 不能修改自己的審查對象。

## 8. Phase F：完成驗收

執行：

- pnpm check
- pnpm test:coverage -- --pool=forks --maxWorkers=1

coverage 門檻維持 90% 以上，不以刪除測試排除新 Agent 層。另執行一次乾淨工作區 smoke test，確認：

- .agents 資產可被發現。
- 不需低階 ID 即可完成主要工作。
- 舊 Agent 名稱仍可路由。
- Runtime 與 MCP/REST/CLI 的高階入口沒有回歸。
- 所有失敗訊息都以使用者可理解的方式呈現。

產出：

- docs/migration/agent-skill-inventory.json
- docs/migration/agent-skill-map.md
- docs/migration/skill-contract-map.md
- docs/migration/agent-migration-verification.md

## 9. 回滾策略

- 每個 Phase 獨立提交，避免一次性覆寫。
- 若 personality hash、registry lint 或核心測試失敗，停止該 Phase，不進入下一階段。
- Agent Adapter 可由 Runtime feature flag 關閉，退回既有 WorkspaceRuntime.request 分類流程。
- 舊工作區只讀，因此不需要回滾來源資產。

## 10. 實作順序與停點

實際修改順序固定為：

基線 → 資產複製 → registry/prompt → Skill 適配 → Runtime Adapter → lint/測試 → 完整驗收

每個停點都要回報：已完成檔案、測試結果、剩餘風險與是否需要使用者決策。實作已依此順序完成並通過驗收。

## 11. 實作完成證據

- pnpm agent:lint：通過，22 Agent、20 prompt、22 personality YAML、20 Skill、36 alias。
- pnpm check：通過，11 個 test files、54 個 tests。
- pnpm test:coverage -- --pool=forks --maxWorkers=1：statements 97.18%、branches 90.21%、functions 96.39%、lines 97.18%。
- personality YAML 與舊工作區逐檔 SHA-256 比對：22/22 一致。
