# Agent/Skill/Personality 遷移驗證記錄

日期：2026-08-08

## 資產驗證

- registry entries：22
- active Agent prompts：20
- personality YAML：22
- runtime 輔助文件：2（`.agents/personalities/runtime-instructions.md` 為 Director active mount；`docs/migration/legacy-runtime-instructions.md` 為稽核參考）
- active Skill：20
- aliases：36
- 舊 prompt 與舊 Skill 契約：已封存至 docs/migration/legacy-prompts 與 docs/migration/legacy-skills

## 自動檢查

命令：pnpm agent:lint

結果：通過。

檢查內容：

- registry agent ID 與 alias target
- registry entry 的 prompt、personality 與 Skill binding
- prompt 的 personality binding
- prompt 的 Skill binding
- personality 繼承檔案
- Creator/Critic 唯讀隔離
- active prompt/Skill 不含低階操作 token
- Director prompt 的 personality runtime mount 與核心執行規則
- 資產數量

## Runtime 測試

命令：pnpm test

結果：11 個 test files、54 個 tests 全部通過。

新增覆蓋：

- 22 Agent registry 與舊 alias
- Creator/Critic 隔離
- 自然語言 Intent 路由
- 來源、知識、審查、匯入、建置與插件專門路由
- 未知 Agent 的安全 fallback
- Agent Adapter 與既有 WorkspaceRuntime 結果相容

## Coverage

命令：pnpm test:coverage -- --pool=forks --maxWorkers=1

結果：

- statements：97.18%
- branches：90.21%
- functions：96.39%
- lines：97.18%

所有門檻均達到 90% 以上。

## 保留的安全邊界

- 未驗證來源不會被標為正式事實。
- 受控 fetch 或權限限制不會被繞過。
- Critic 仍然唯讀。
- Personality prohibited_behaviors 仍然有效。
- 內部狀態仍由 Runtime 維護，不要求使用者或 Agent 組裝。
