# Card Workspace vNext Agents and Workflow 設計規格

日期：2026-07-14  
狀態：使用者已批准  
依據：`2026-07-13-card-workspace-vnext-master-design.md`、Forge Core 與 Sources/Facts 已驗收契約

## 1. 目的

本階段把已完成的確定性 library 接到 OpenCode 的對話式製卡工作流：

```text
Director 訪談與使用者閘門
→ TypeScript Workflow Engine
→ 持久化 Agent Tasks
→ 專職 Agent + 專用 Skill
→ 單一 Forge MCP Server 實作（identity-bound stdio instances）
→ Project / Ingestion / Compiler APIs
→ 驗證後的作者產物與 V3 JSON/PNG
```

主要操作入口是 OpenCode Director。Dashboard 不是本階段前置條件，也不是工作流權威。

## 2. 核心原則

- TypeScript Workflow Engine 是 stage、gate、task、lease、revision 與 retry 的唯一權威。
- Director 負責訪談、調度與彙整，不直接生成完整角色模組。
- Agent 執行語意工作；Forge 執行 schema、權限、I/O、交易、編譯與診斷。
- 所有持久狀態寫入 workspace，不以聊天上下文作唯一進度來源。
- Agent 只能使用所 claim task 授權的領域工具，不能取得任意檔案讀寫。
- Creator 與 Critic 物理隔離；正面生成規則與負面檢查規則分離。
- Agent/Skill 可由使用者編輯，但提示詞不能繞過 schema、權限與 gate。
- 首輪使用中性 personality；性格設計延至核心與 plugins 穩定後。

## 3. 範圍

本階段包含：

- 版本化 workflow schemas 與 deterministic state machine。
- 四種工作流入口與四道使用者閘門。
- 持久化 task queue、claim/lease/retry/supersede 與 crash resume。
- 十個專職 Agent 的工作契約、工具權限與 handoff schemas。
- 每個 Agent 的單一職責 Skill、references 與 fixtures。
- Director Agent。
- 單一 Forge MCP Server 實作、identity-bound stdio instances 與 capability authorization。
- Proposal、review report 與受控 artifact apply。
- `opencode.jsonc`、Agent registry、tool policy 與 workflow definitions。
- Agent/Skill reference linter 與 contract regression tests。
- 原創、來源二創、舊卡匯入與模式轉換 E2E。

本階段不包含：

- Dashboard。
- MVU/EJS/狀態欄/Regex/第二 API plugins。
- Agent personality 調校。
- PDF/DOCX adapters。
- 未受控網路爬蟲。
- 將模型私密思維鏈保存到專案。

## 4. Package 架構

新增：

```text
packages/workflow/
  schemas bridge
  state machine
  task/lease/retry
  gates/decisions
  proposal validation/apply
  workflow journal/projector
  agent registry validation

packages/mcp-server/
  MCP stdio entrypoint
  authenticated agent context
  capability authorization
  tool adapters
  machine diagnostics
```

可編輯設定：

```text
.opencode/prompts/
  director.md
  fact-curator.md
  zhuji-creator.md
  palette-creator.md
  character-critic.md
  greetings-creator.md
  greetings-critic.md
  mode-conversion.md
  card-import-analyst.md
  world-lore-creator.md
  world-lore-critic.md

.agents/skills/<skill-id>/
  SKILL.md
  references/*.md
  fixtures/*

workflow/
  agent-registry.yaml
  tool-policy.yaml
  workflow-definitions.yaml
  personalities/default-neutral.yaml
```

依賴方向：

```text
@card-workspace/schemas
  ↑
project / ingestion / compiler / diagnostics
  ↑
@card-workspace/workflow
  ↑
@card-workspace/mcp-server
  ↑
OpenCode Director / Agents / Skills
```

MCP adapter 不重寫任何 project、Sources/Facts 或 compiler 邏輯。

## 5. Workflow 權威資料

沿用既有 `workflow.json`，不改回 YAML。現有 Foundation workflow schema 升級後至少包含：

```text
schema_version
workflow_definition_id
entry_kind
stage
revision
artifacts
gates
tasks
decisions
journal_revision
extensions
```

`revision` 每次合法狀態變更單調增加。所有 mutation 要求 expected workflow revision；stale caller 不得覆寫目前狀態。

禁止以檔案存在、Agent 文字聲稱或聊天訊息判定 task/stage 完成。

## 6. 四種工作流入口

### 6.1 Original

使用者原創角色與世界觀。可不建立外部來源分片，但使用者直接輸入仍記錄 user provenance。引擎建立明確的「facts review not required」決策，不靜默略過事實閘門。

### 6.2 Source Adaptation

本機或網路來源先經 snapshot/revision/chunks/jobs，再由 Fact Curator 提交 candidates。只有 accepted facts 可供 Blueprint 與 Creator 使用。

### 6.3 Card Import

V1/V2/V3 JSON/PNG 先由既有 importer 建立 envelope、passthrough 與 loss report，再由 Card Import Analyst 提出欄位、世界書、角色與模式 mapping。不得直接猜測並寫入珠璣或調色盤。

### 6.4 Mode Conversion

從已批准的單一來源模式建立目標模式完整 proposal 與 mapping report。來源模式不被覆蓋；使用者批准後才切換 manifest mode 與目標 artifacts。

## 7. Stage 狀態機

共用主階段：

```text
intake
→ source_processing
→ facts_review
→ blueprint
→ authoring
→ semantic_review
→ content_review
→ compile_preview
→ publish_review
→ published
```

入口可讓部分階段標記為 `not_required`，但必須由 workflow definition 與 decision 記錄，不得由 Director 任意跳階。

合法 stage transition 由 TypeScript transition table 定義。每次 transition 驗證：

- 前置 tasks 均完成或被明確 supersede。
- 目前 gate 狀態符合要求。
- 所需 artifacts 存在且 revision/hash 相符。
- 不存在不可覆寫 diagnostics。
- transition actor 具有 capability。

## 8. 四道使用者閘門

### 8.1 Facts Gate

確認 candidates、dedup proposals、accepted/rejected facts 與 unresolved conflicts。只有 accepted facts 可進正式 Creator inputs。原創入口以明確的 `not_required` decision 通過此 gate。

### 8.2 Blueprint Gate

確認：

- 專案入口與目的。
- 每名角色的珠璣/調色盤模式。
- 角色核心概念與關係定位。
- 可用 facts 與創作補全界線。
- 世界觀與 greetings 範圍。
- 初步 Token 預算。

### 8.3 Content Gate

確認角色、世界觀、greetings 產物，以及 Creator/Critic 各輪差異與尚存 findings。

### 8.4 Publish Gate

確認 compile preview revision、audit、Token/Trigger、round-trip、輸出格式與 artifact hashes。正式 publish 必須使用完全相同的 preview input revision；輸入改變後舊批准自動 supersede。

Gate 狀態：

```text
pending | approved | rejected | superseded | not_required
```

每筆 gate decision 保存 actor、時間、輸入 revisions、摘要、選項與影響，不保存思維鏈。

## 9. Task 與 Lease

Task 狀態：

```text
pending → claimed → completed
                  → failed → retryable → claimed
                  → needs_user_decision
pending/claimed/failed/retryable/needs_user_decision → superseded
```

每個 task 保存：

- stable task ID 與 task kind。
- assigned agent kind。
- capability set。
- input artifact refs/revisions。
- output schema ID/version。
- dependencies。
- lease ID、owner、claimed/expiry time。
- attempt number 與 max automatic attempts。
- result artifact/report revision。
- failure summary 與 diagnostics。

Agent 只能 claim、submit、fail、release。只有 Workflow Engine 可建立後繼 task、完成 stage 或 supersede task。

過期 lease 可重新 claim；舊 lease 的遲到結果明確拒絕。相同 task/result revision 的重試應 idempotent。

## 10. Creator/Critic 修訂迴圈

- Creator 提交 proposal。
- 引擎先做 schema、path、base revision、provenance 與 ownership 驗證。
- Critic 讀已驗證 proposal、Blueprint、accepted facts 與自己的負面規則，提交 read-only review report。
- 存在可修正 findings 時，Director 讓引擎建立新 Creator revision task。
- 預設最多自動修訂兩次。
- 達上限後轉 `needs_user_decision`，不強制放行。

使用者可選擇：

- 再修訂。
- 接受可覆寫 workspace finding。
- 調整可覆寫 policy。
- 手動提出受控 patch。
- 撤回或 supersede 工作。

Normative schema、provenance、權限、路徑與交易錯誤不可覆寫。使用者手動修改後仍須重新結構驗證與 Critic，不再完全跳過審查。

## 11. Handoff Envelope

共同 envelope：

```yaml
schema_version: 1
task_id: task-stable-id
agent_id: zhuji-creator
project_id: demo
workflow_revision: 12
input_artifacts:
  - id: blueprint
    revision: sha256:...
constraints: {}
output:
  kind: module_proposal
  payload: {}
```

引擎驗證 task、agent、workflow revision、input revisions、output kind 與 payload schema。Agent 輸出的路徑、ID、hash、classification、confidence、stage 或 capability 均不可信，必須重新驗證。

輸出 kinds 至少包含：

- `candidate_batch`
- `blueprint_proposal`
- `module_proposal`
- `world_proposal`
- `greetings_proposal`
- `review_report`
- `conversion_proposal`
- `import_analysis`

## 12. Proposal 套用

Agent proposal 先保存為 task result artifact，不直接寫正式作者檔。套用時驗證：

- task 仍為目前有效 task。
- base workflow/artifact revision 未過期。
- proposal schema 與模式正確。
- 只包含 task ownership 允許的文件與欄位。
- 所有 fact refs accepted 且 provenance 完整。
- 不修改 Sources/Facts projection、journal、snapshot、`.build` 或 exports。
- 交易中的全部作者檔同時成功或全部回滾。

套用成功後更新 workflow artifact revision，並讓舊 review/preview/gate approvals supersede。

## 13. Agent 責任與權限

### 13.1 Fact Curator

讀 chunks、相鄰上下文與來源 metadata；提交 candidate batch、semantic duplicate 與 conflict 建議。不得接受 fact、修改 snapshot 或直接寫角色草稿。

### 13.2 Zhuji Creator

讀 Blueprint、accepted facts 與指定角色上下文；提交七個珠璣模組 proposal。模組7是自我介紹常態設定，不是 greeting。不得寫調色盤或 greetings。

### 13.3 Palette Creator

讀 Blueprint、accepted facts 與指定角色上下文；提交基礎信息、性格調色盤、三面性、二次解釋。不得寫珠璣或 greetings。

### 13.4 Character Critic

讀 Blueprint、accepted facts 與角色 proposal/正式產物；提交 read-only review。不得修改作者產物。

### 13.5 Greetings Creator

讀已批准角色、世界觀與 Greeting Blueprint；提交專案級 primary/alternate/group-only greetings。不得寫模組7。

### 13.6 Greetings Critic

檢查 Puppeteering、封閉式結尾、玩家自由度、群像歸屬與角色一致性；只提交 review。

### 13.7 Mode Conversion

讀來源模式、facts 與轉換需求；提交完整目標模式與 source→target mapping/provenance report。不得覆蓋來源模式。

### 13.8 Card Import Analyst

讀 imported envelope、passthrough 與 loss report；提交 Blueprint/mapping proposal。不得假裝 importer 已完成語意 decompile。

### 13.9 World Lore Creator

讀 Blueprint 與 accepted facts；提交 people/geography/organizations/history/concepts/systems/items/events 分類世界設定。

### 13.10 World Lore Critic

檢查世界觀衝突、依賴、冗餘、Token 成本與觸發性；只提交 review。

## 14. Skill 結構

每個 Agent 只載入一個同責任 Skill：

```text
.agents/skills/<skill-id>/
  SKILL.md
  references/
  fixtures/
```

`SKILL.md` 僅包含角色責任、啟用條件、必要 references、輸入輸出與禁止事項。長篇方法、正例、反例與品質規則拆入 references。

Creator Skill 只含正面生成方法。Critic Skill 才含反 AI 套路、禁詞、密度與失敗模式。兩者不得互相引用對方的 prompt references。

共用術語引用 `CONTEXT.md`。不可在多份 Skill 複製本體定義。

## 15. Personality 分層

Agent 工作契約與 personality 分離。中性 profile 只定義簡潔、直接、可追溯的表達，不改變：

- capability。
- tools。
- schema。
- gate。
- retry。
- review severity。

本階段只提供 `default-neutral.yaml` 與 profile schema。使用者逐 Agent 性格設定是後續獨立工作項目。

## 16. Director

Director 每次互動：

1. 讀 workflow status。
2. 判斷目前唯一合法下一步。
3. 一次只問一個會影響後續的未決問題。
4. 將回答提交引擎形成 decision/revision。
5. 委派或呈現 task，不自行完成 task。
6. 彙整 Agent 產物、review 差異與使用者選項。
7. 在四道 gate 暫停並等待使用者。
8. 發布前展示 audit、Token/Trigger、round-trip 與 hashes。

Director 不生成完整角色模組、greetings、世界觀或 facts。它也不能直接編輯 workflow、投影、journal 或 exports。

## 17. MCP Server

單一 `@card-workspace/mcp-server` 實作使用 stdio。因 OpenCode 的共享 MCP request 不提供可驗證的 caller Agent 身分，每個 Agent 必須使用獨立的 local MCP registration 與 process instance；所有 instance 執行相同 package，只以不同 server name 與啟動環境 `CARD_WORKSPACE_AGENT_ID` 綁定身分。這是單一程式實作、多個 identity-bound stdio instances，不是多套 MCP 邏輯。

Server 啟動時定位 workspace root、從啟動環境讀取並驗證 `agent_id`，再載入 registry/policies/workflow definitions；缺失、未知或不一致均 fail fast。OpenCode per-agent permissions 只開放該 Agent 專屬 MCP server prefix。不得相信模型在 tool arguments、prompt、task payload 或可讀 token 中自行聲稱的 agent 身分。

授權為三重交集：

```text
Agent Registry capabilities
∩ Current Task capabilities
∩ Current Workflow Stage capabilities
∩ Valid Task Lease
```

不符合時回 `TOOL_CAPABILITY_DENIED`，不執行 I/O。

## 18. MCP 工具面

### 18.1 Workflow

- `workflow_start`
- `workflow_status`
- `workflow_answer_interview`
- `workflow_approve_gate`
- `workflow_reject_gate`
- `task_claim`
- `task_submit`
- `task_fail`
- `task_release`

### 18.2 Sources/Facts

- `source_intake_local`
- `source_intake_retrieved`
- `source_create_chunks`
- `source_get_chunk_task`
- `fact_submit_candidates`
- `fact_query`
- `fact_review`
- `conflict_resolve`
- `provenance_trace`
- `provenance_verify`

### 18.3 Author Artifacts

- `blueprint_submit_proposal`
- `character_submit_proposal`
- `world_submit_proposal`
- `greetings_submit_proposal`
- `review_submit_report`
- `conversion_submit_proposal`
- `import_submit_analysis`

### 18.4 Forge

- `project_validate`
- `project_plan`
- `project_simulate`
- `project_compile_preview`
- `project_publish`
- `card_import`
- `card_audit`
- `roundtrip_verify`

本機 source intake 只允許 Director/使用者工作流。Fact Curator 可提交呼叫端取得的網頁 bytes 與 metadata，但 MCP 不把網路搜尋偽裝成 Forge 能力。

正式 publish 要求 approved publish gate 與相同 preview/input revision。

## 19. Registry 與 Policy

`agent-registry.yaml` 定義 agent ID、kind、agent file、Skill、personality、capabilities、input/output schemas。

`tool-policy.yaml` 定義 capability→tool mapping、stage constraints、mutation/read-only、需要 task/gate 的條件。

`workflow-definitions.yaml` 定義四種入口、stage transitions、required gates、task templates 與 retry policy。

這三份 YAML 是可編輯設定，但必須通過 schema 與 cross-reference linter。它們不能擴張 TypeScript 未註冊的工具或繞過不可覆寫 invariant。

## 20. OpenCode 設定

根 `opencode.jsonc` 只包含：

- Director 與專職 Agents 註冊。
- 同一 Forge MCP executable 的 identity-bound local registrations；每個 registration 使用唯一 server name 與固定 `CARD_WORKSPACE_AGENT_ID`。
- 最小必要 permission。
- workspace-local 路徑。
- `skills.paths` 對 `.agents/skills` 的明確註冊。

創作規則、Critic 規則、工具說明與 workflow stages 不放進 `opencode.jsonc`。

Agent Markdown 包含工作契約、允許 Skill、輸出 envelope 與禁止事項；不複製 registry 作為第二權威來源。OpenCode 設定、Agent 或 Skill 檔案變更後必須重啟 OpenCode，因設定不會在既有 session 中熱載入。

## 21. Static Linter

`agent-lint` 檢查：

- registry agent file 存在。
- Skill 與所有 references/fixtures 存在。
- schema ID/version 存在。
- capability 與 tool 已註冊。
- workflow task 使用已存在 agent/capability/schema。
- Creator/Critic 禁止交叉 references。
- reference graph 無循環。
- 沒有未註冊 Agent、Skill 或孤兒 reference。
- `opencode.jsonc` 引用名稱與 registry 一致。

錯誤輸出 stable code、location、evidence、hint 與 fixability。

## 22. Error Model

### 22.1 Contract

Handoff、proposal、review 或 registry schema 不合法時，不完成 task；保留 diagnostics 並允許合法重試。

### 22.2 Authorization

Agent、task、stage 或 capability 不符時回穩定拒絕，不執行領域 API。

### 22.3 Concurrency

Workflow/artifact revision stale、lease 過期、task superseded 或 preview 改變時拒絕遲到結果。

### 22.4 Quality

可覆寫 workspace finding 進使用者決策；normative/schema/provenance/permission/path/transaction error 永遠阻斷。

所有失敗保存 attempt、輸入 revisions、錯誤摘要與續接狀態。不保存模型私密思維鏈。

## 23. Journal 與 Recovery

Workflow 使用 append-only logical journal 與目前 `workflow.json` 投影。每個 event 保存 sequence、prior semantic revision、payload hash、actor 與 event kind；timestamp 不參與 semantic revision。

Workflow event、artifact apply 與目前投影在同一 project transaction 提交。Crash recovery 先恢復 project transaction，再由 journal verify/projector 檢查投影。Journal 損壞時停止 mutation，不以目前投影反向改寫歷史。

## 24. 安全

- MCP 所有路徑都經 workspace/project allowlist。
- Agent 不取得 shell 或任意 filesystem mutation capability。
- Tool arguments 的 ID、path、hash、revision、classification 與 agent ID 全部不可信。
- Source external path 規則沿用 ingestion explicit regular-file intake。
- 網頁 bytes 仍須建立 immutable snapshot。
- Secret 不寫入角色卡、project artifacts、Agent files 或 personality。
- Tool 回應不包含模型思維鏈、秘密或不必要的原始全文。

## 25. 測試策略

### 25.1 Workflow Unit Tests

- 四種入口與合法 transition。
- 非法跳階、gate 缺失、artifact stale。
- revision/CAS、lease expiry、retry、supersede、idempotency。
- 兩次修訂上限與 `needs_user_decision`。
- journal verify/projector rebuild/crash recovery。

### 25.2 Authorization Tests

- 十個 Agent 的 allow/deny matrix。
- Agent 知道工具名稱仍不能越權。
- Creator 不能讀 Critic 負面 references。
- Critic 不能寫作者 artifacts。
- Director 不能自行批准 gate 或生成 Creator artifact。

### 25.3 Contract Tests

- 每種 handoff/output schema。
- Proposal base revision、ownership、path、mode 與 provenance。
- Registry/Skill/reference/schema/tool cross-reference。
- 循環、失效名稱、孤兒文件。

### 25.4 MCP Integration

- MCP 與直接 library/CLI 對相同 revision 結果等價。
- Machine diagnostics 與 stable error codes。
- stdio initialize/list/call lifecycle。
- MCP restart 後可依 workflow/tasks 續接。

### 25.5 E2E

1. 原創角色：Blueprint → 珠璣/調色盤產物 → Critic → Greetings → preview/publish。
2. 來源二創：source → chunks → candidates → facts gate → 角色與世界設定。
3. 舊卡：import → Analyst mapping → gate → 重建 → round-trip。
4. 模式轉換：珠璣 → 調色盤 → 珠璣，驗 mapping/provenance 與預期語意損失。

Prompt/Skill 使用 fixture 與結構回歸。真實模型輸出只作可選 smoke test，不進 deterministic CI。

維持 statements/lines/functions 85%、branches 80%，以及 production audit high 無已知弱點。

## 26. 實作里程碑

### M1 Workflow and MCP Foundation

- workflow schemas/state machine/journal。
- 四道 gates。
- task/lease/retry/decision。
- handoff schemas。
- proposal apply transaction。
- 單一 Forge MCP 實作、identity-bound stdio instances 與 capability authorization。

### M2 Agents and Skills

- Director 與十個中性 Agent。
- 專用 Skills/references/fixtures。
- Creator/Critic 修訂迴圈。
- agent registry/tool policy/workflow definitions。
- static linter 與 contract tests。

### M3 OpenCode and E2E

- `opencode.jsonc` 正式註冊。
- MCP stdio lifecycle。
- 原創、來源二創、舊卡匯入與模式轉換 E2E。
- recovery、frozen install、check、coverage、audit。

## 27. 完成定義

- TypeScript 引擎是工作流唯一權威。
- 四種入口與四道 gate 均可持久續接。
- 十個 Agent 只能執行其 task/capability 授權操作。
- Director 一次一題且不直接創作完整模組。
- Proposal 經 schema/revision/provenance/ownership 後交易式套用。
- Creator/Critic 隔離，兩次重試後不強制放行。
- MCP 不暴露任意檔案工具，與 library/CLI 結果等價。
- MCP caller 身分只由 process 啟動環境綁定，不接受 tool argument 自報身分。
- Agent/Skill 可編輯且引用 linter 全綠。
- OpenCode 重啟後可從 workflow/task 狀態續接。
- 四條 E2E 全綠，strict failure 不修改正式 artifacts/exports。
- Build、lint、typecheck、tests、coverage、frozen install 與 production audit 全綠。
- Personality 維持中性，個性調校明確留待後續。

## 28. 自審結論

- 本規格沒有把 Agent 提示詞當成權限或狀態機。
- 沒有讓 MCP 重寫既有 project/ingestion/compiler 邏輯。
- 沒有讓 Director、Creator 或 Critic直接修改受控投影與輸出。
- 模組7與 greetings 保持分離。
- 四道 gate、兩次 retry、不可覆寫錯誤與正式 publish revision 已明確。
- Agent personality 與工作契約保持分離。
- MCP 身分模型已明確採單一實作、多 identity-bound stdio instances，不依賴共享 request 的未知 caller metadata。
- 範圍可分三個里程碑驗收，不與 Dashboard 或 plugins 混合。
