# Agents Workflow

## 目的

OpenCode Director 是 Card Workspace 的對話入口，但不是工作流權威。TypeScript Workflow Engine 唯一決定 stage、gate、task、lease、revision、retry 與 artifact 套用；Agent 只處理已指派 task 的語意工作，Forge MCP 只把受權限約束的操作轉接到既有 libraries。

```text
使用者
  -> OpenCode Director
  -> Workflow Engine / task / gate
  -> identity-bound Forge MCP process
  -> 專職 Agent + 單一 Skill
  -> proposal 或 review envelope
  -> schema / ownership / provenance / revision validation
  -> atomic apply / preview / publish
```

## 設定來源

- `workflow/agent-registry.yaml`：Agent ID、kind、Agent 檔、Skill、personality、capabilities 與 contracts。
- `workflow/tool-policy.yaml`：capability 對 tool、stage、mutation、task 與 gate 限制。
- `workflow/workflow-definitions.yaml`：四種入口的階段、gates 與 task templates。
- `workflow/personalities/default-neutral.yaml`：只控制簡潔、直接、可追溯的表達。
- `opencode.jsonc`：OpenCode 註冊、MCP process identity 與最小前端權限，不重複工作流規則。

YAML 設定不能擴張 TypeScript tool registry 或不可覆寫 invariant。`agent-lint` 會檢查跨檔引用、schema、capability、工具、Creator/Critic 隔離、循環與孤兒資源。

## Director

Director 每輪先讀 workflow status，再執行唯一合法下一步。若需要補充需求，一次只問一個會影響後續的問題；回答由 engine 記錄為 decision/revision。Director 不生成完整角色模組、greetings、世界設定或 facts，也不直接改作者檔、workflow、journal、`.build` 或 exports。

初始化前已確認的 intake 訪談由 `project_initialize.intake_answers` 與 foundation 同交易保存。`workflow_start` 依入口專屬 definition 推進至下一個實際 stage、初始化四道 gates（非必要 gate 明確記為 `not_required`）並建立該 stage tasks。原創入口的 `create-blueprint` 是唯一正式指派給 Director 的產出 task；Director 可在 lease 下整理 Blueprint proposal，但仍不可代替角色、世界設定或 Greetings Creator。

Facts、Blueprint、Content、Publish gate 都必須向使用者呈現並停下。Director 只能轉交使用者明確的 approve/reject；不能自行成為批准 actor。輸入 revision 改變後，舊 review、preview 與 approval 由 engine 判為 stale 或 superseded。

## 專職 Agents

| Agent | 單一輸出責任 |
| --- | --- |
| Fact Curator | 有 evidence 的 fact candidate batch |
| Zhuji Creator | 珠璣模式七模組 proposal |
| Palette Creator | 調色盤模式 proposal |
| Character Critic | 角色唯讀 review report |
| Greetings Creator | 專案級 greetings proposal |
| Greetings Critic | greetings 唯讀 review report |
| Mode Conversion | 完整目標模式與 mapping/provenance proposal |
| Card Import Analyst | importer envelope 的 mapping analysis |
| World Lore Creator | 分類世界設定 proposal |
| World Lore Critic | 世界設定唯讀 review report |

珠璣模組7固定是 `self_introduction` 角色自我介紹常態設定，只進角色世界書；專案級開場白只能由 Greetings Creator 產生。

## Creator/Critic 物理隔離

每個 Agent 只有一個 Skill，且 OpenCode permission 預設全部 deny，只開放該 Agent 的 identity-bound MCP prefix 與自己的 Skill。Creator references 只放生成方法；Critic references 只放負面規則與失敗模式。Critic registry capability 沒有任何 `*.propose`，Creator 沒有 `review.submit`。Critic 即使知道 tool 名稱，也同時受 OpenCode permission、process identity、registry、目前 task、stage 與 lease 阻擋，不能寫正式作者產物。

Proposal 只保存為 task result。正式路徑由 task ownership 推導，Agent 自報 path、ID、hash、revision、stage 或 capability 都不可信。Engine 驗證 proposal 後才以 project transaction 原子套用。

## MCP 身分與權限

`opencode.jsonc` 為 Director 與十個 Agent 各啟動一個 local MCP registration。所有 registrations 執行同一命令：

```text
node packages/mcp-server/dist/index.js
```

每個 process 的 `CARD_WORKSPACE_AGENT_ID` 固定為對應 registry ID，`CARD_WORKSPACE_ROOT` 為 workspace root。Tool arguments 不能提供或覆蓋 caller identity。Server 端授權取以下交集：

```text
Agent Registry capabilities
intersection Current Task capabilities
intersection Current Workflow Stage capabilities
intersection Valid Task Lease
```

OpenCode 層全域拒絕 `forge_*`，再於各 Agent 僅允許自己的 server prefix。這是縮小可見工具面的前置限制，不取代 MCP 的 domain authorization。

## 四種入口

1. Original：明確記錄 Facts `not_required` decision，再進 Blueprint、作者內容、Critic、Content Gate、preview 與 Publish Gate。
2. Source Adaptation：source snapshot、chunks、candidates、Facts Gate 後，才提供 accepted facts 給角色與世界設定 tasks。
3. Card Import：importer envelope 先交 Analyst mapping，經 Blueprint Gate 後重建並 round-trip 驗證。
4. Mode Conversion：以已批准來源模式建立完整目標模式；保留 mode-history、mapping/provenance 與 expected loss，批准後才切換 active mode。

Creator/Critic 自動修訂最多兩輪；再失敗則進 `needs_user_decision`，不強制放行。

## 維護與驗證

Agent、Skill、reference、fixture、registry 或 OpenCode 設定異動後執行：

```powershell
npx --yes pnpm@10.34.5 agent-lint
npx --yes pnpm@10.34.5 check
```

修改 `opencode.jsonc`、`.opencode/prompts/` 或 `.agents/skills/` 後必須完整退出並重啟 OpenCode。既有 session 不保證重新載入 Agent、Skill、permission 或 MCP process environment；重啟不會丟失持久化 workflow/task 狀態。
