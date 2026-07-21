# Card Workspace vNext Agents and Workflow 實作計畫

日期：2026-07-14  
狀態：實作與自動化驗收完成  
依據：`docs/superpowers/specs/2026-07-14-card-workspace-vnext-agents-workflow-design.md`

## 1. 目標與邊界

本計畫把已完成的 Project、Sources/Facts、Compiler 與 Diagnostics libraries 接成 OpenCode-first 的持久工作流：

```text
OpenCode Director
→ Workflow Engine / Tasks / Gates
→ identity-bound Forge MCP instance
→ 專職 Agent + 專用 Skill
→ Proposal / Review Envelope
→ Schema / Ownership / Provenance / Revision Validation
→ Atomic Apply / Preview / Publish
```

本階段建立 Workflow Engine、MCP、Director、十個專職 Agent、Skills、OpenCode 設定與四條 deterministic E2E。Dashboard、plugins、PDF/DOCX、未受控 crawler 與 Agent personality 調校不在本計畫內。

## 2. 實作不變量

- TypeScript Workflow Engine 是 stage、gate、task、lease、revision、retry 與 decision 的唯一權威。
- Agent、Skill、YAML policy 與 `opencode.jsonc` 不得形成第二套狀態機。
- Agent 不直接寫正式作者檔、workflow、journal、`.build` 或 exports。
- Proposal 路徑由 task ownership 推導，不信任 Agent 提交的 path。
- Creator 與 Critic 的工具、references、輸出契約和寫入權限物理隔離。
- 四道 gate 依序為 Facts、Blueprint、Content、Publish；Director 不得代替使用者批准。
- 自動 Creator/Critic 修訂最多兩次，之後進入 `needs_user_decision`。
- Workflow logical journal 與 workflow projection 同一 project transaction 更新。
- Preview 與 Publish 以相同 input revision、artifact hashes 與 approved gate 鎖定；stale approval 自動失效。
- 單一 MCP package 實作可啟動多個 identity-bound stdio instances。身分只從 `CARD_WORKSPACE_AGENT_ID` 啟動環境取得，不接受 tool argument 自報。
- MCP 授權是 Agent Registry、Current Task、Current Stage、Valid Lease 的交集。
- MCP adapter 只呼叫既有 library API，不複製 Project、Ingestion、Compiler 或 Diagnostics 邏輯。
- 所有 mutation 要求 expected revision/CAS，失敗不得留下部分正式產物。
- 模組7永遠是角色自我介紹常態設定，不是 greeting。
- Agent personality 保持中性，且不得改變 schema、權限、工具或 gate。

## 3. Package Graph

```text
@card-workspace/schemas
├─ @card-workspace/project
├─ @card-workspace/ingestion
├─ @card-workspace/compiler
├─ @card-workspace/diagnostics
└─ @card-workspace/workflow
   ├─ project
   ├─ ingestion
   ├─ compiler
   └─ diagnostics

@card-workspace/mcp-server
├─ workflow
├─ ingestion
├─ compiler
├─ diagnostics
├─ project
└─ @modelcontextprotocol/sdk

OpenCode Agents / Skills
└─ identity-bound MCP registrations
```

`project` 不得依賴 `workflow`。Workflow schemas 放在 `schemas`，使 Project loader 可解析而不形成 package cycle。

## 4. 里程碑

### M1：Workflow Foundation

完成 Tasks 1–9。Workflow v2、migration、journal、tasks、gates、proposal apply、mode conversion 與 preview locking 可由 library 獨立驗證。

### M2：MCP 與契約設定

完成 Tasks 10–14。Registry、policy、static linter、identity-bound MCP lifecycle、authorization 與全部 domain tools 可測試使用。

### M3：OpenCode 與 E2E

完成 Task 15。Director、十個 Agent、十一個 Skills、OpenCode 註冊、四條工作流 E2E 與所有品質閘門完成。

## 5. Tasks

### Task 1：Workflow v2 與 deterministic migration

新增：

- `packages/schemas/src/workflow-contracts.ts`
- `packages/schemas/test/workflow-v2.test.ts`

修改：

- `packages/schemas/src/workflow.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/validation.ts`

先寫失敗測試：

- 四種入口 `original | source_adaptation | card_import | mode_conversion`。
- 十階段 vocabulary 與禁止未知 stage。
- Gate 狀態 `pending | approved | rejected | superseded | not_required`。
- Task 狀態、lease、attempt、dependencies、assigned agent、input/output contract。
- Artifact reference、decision、journal revision 與 extensions。
- v2 state 必須 strict，revision 非負且 task/gate IDs 唯一。
- v1→v2 migration 對相同 v1 bytes 產生相同 v2 state與 migration report。
- 無法無損映射的 v1 欄位明列 warning，不靜默刪除。
- 一般 parse 不得暗中修改磁碟上的 v1 state。

實作重點：

- 保留 `workflowStateV1Schema` 作 reader。
- `workflowStateSchema` 指向 v2；新增 `parseWorkflowState()` 與 `migrateWorkflowV1ToV2()`。
- Migration 只產生記憶體結果，實際落盤由 Task 3 的 project migration API 完成。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas test
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas typecheck
```

### Task 2：Blueprint、Handoff、Proposal、Review 與 Agent Config schemas

新增：

- `packages/schemas/src/blueprint.ts`
- `packages/schemas/src/handoff.ts`
- `packages/schemas/src/proposal.ts`
- `packages/schemas/src/review.ts`
- `packages/schemas/src/agent-config.ts`
- `packages/schemas/src/schema-registry.ts`
- `packages/schemas/test/workflow-contracts.test.ts`

修改：

- `packages/schemas/src/index.ts`

先寫失敗測試：

- Blueprint 涵蓋角色、模式、世界觀、greetings、來源 fact refs、未決決策與批准 revision。
- Handoff 只保存需求、證據、假設、決策摘要與產物引用，不提供私密思維鏈欄位。
- Proposal 使用 discriminated output kind：blueprint、character、zhuji、palette、world、greetings、conversion、import analysis。
- Proposal 文件有 owner、base revision、typed value；不可攜帶任意 shell、absolute path 或 generic patch。
- Review report 有 finding ID、severity、evidence、hint、overridability、target revision。
- Agent registry/tool policy/workflow definition/personality schemas strict。
- 穩定 `schema-id@version` registry 可解析所有 contract reference，拒絕未知版本。
- 模組7 proposal 只接受 Zhuji `self_introduction`，不能通過 greetings contract。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas test
npx --yes pnpm@10.34.5 --filter @card-workspace/schemas build
```

### Task 3：Project layout、初始化、migration 與 loader

新增：

- `packages/project/src/workflow-layout.ts`
- `packages/project/src/workflow-migration.ts`
- `packages/project/test/workflow-layout.test.ts`
- `packages/project/test/workflow-migration.test.ts`

修改：

- `packages/project/src/initialize.ts`
- `packages/project/src/load-author-project.ts`
- `packages/project/src/validate.ts`
- `packages/project/src/author-layout.ts`
- `packages/project/src/ownership.ts`
- `packages/project/src/index.ts`
- `packages/testing/fixtures/valid-project/workflow.json`

正式 layout：

```text
blueprint.yaml
.workflow/
  journal.jsonl
  results/<task-id>/<result-revision>.json
  reviews/<task-id>/<review-revision>.json
  previews/<preview-id>.json
  decisions/<decision-id>.json
```

先寫失敗測試：

- 新專案在單一交易建立 v2 workflow、空 blueprint 與 logical journal。
- v1 專案 load 回 migration-required diagnostic，不暗中覆寫。
- 顯式 migration 使用 raw CAS 並同交易寫 v2 projection、migration journal event與備份引用。
- `.workflow` artifacts 不進作者文件掃描，也不可由一般 RFC 6902 patch 修改。
- Blueprint schema、symlink/junction、精確根路徑與聚合 diagnostics。
- workflow path classifier 只允許固定 artifacts，不成為任意 hidden-directory writer。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/project test
npx --yes pnpm@10.34.5 --filter @card-workspace/project typecheck
```

### Task 4：Workflow package 與純狀態機

新增：

- `packages/workflow/package.json`
- `packages/workflow/tsconfig.json`
- `packages/workflow/src/index.ts`
- `packages/workflow/src/errors.ts`
- `packages/workflow/src/definitions.ts`
- `packages/workflow/src/state-machine.ts`
- `packages/workflow/test/state-machine.test.ts`

修改：

- `vitest.config.ts`
- `pnpm-lock.yaml`

先寫失敗測試：

- 四入口各自 deterministic stage plan。
- 合法 transitions 與禁止跳階、倒退、重複 publish。
- `not_required` 只能由 definition 加顯式 decision 產生。
- Artifact、gate、task與 diagnostics preconditions。
- Stage transition actor capability與 expected workflow revision。
- 同一 state/event得到相同 next state；非法 event不變更 input。

驗收：

```powershell
npx --yes pnpm@10.34.5 install --no-frozen-lockfile
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow typecheck
```

### Task 5：Logical journal、repository、projector 與 recovery

新增：

- `packages/workflow/src/journal.ts`
- `packages/workflow/src/projector.ts`
- `packages/workflow/src/repository.ts`
- `packages/workflow/test/journal.test.ts`
- `packages/workflow/test/recovery.test.ts`

先寫失敗測試：

- Event sequence、prior semantic revision、payload hash與 event ID。
- Timestamp 不參與 semantic revision。
- Workflow projection與 journal whole-file replacement同一 project transaction。
- expected workflow revision與 raw revision雙 CAS。
- Duplicate retry idempotent；同 event ID不同 payload拒絕。
- Journal truncation、reordering、hash corruption fail closed。
- `verifyWorkflowProjection()` 與 `rebuildWorkflowProjection()` deterministic。
- Physical transaction recovery後可由 intact logical journal重建 projection。
- Rebuild失敗不改現有 workflow。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- journal recovery
```

### Task 6：Task queue、Lease、Retry 與 Supersede

新增：

- `packages/workflow/src/tasks.ts`
- `packages/workflow/src/leases.ts`
- `packages/workflow/src/retry.ts`
- `packages/workflow/test/tasks.test.ts`

先寫失敗測試：

- `pending → claimed → submitted → accepted/rejected` 合法轉移。
- Lease owner、ID、expiry與注入式 clock。
- Expired lease可reclaim，未過期不可搶占。
- Late、stale、superseded result拒絕且不改state。
- Task result ID/revision idempotency。
- Dependencies未完成不得claim。
- Attempt單調、max attempts與錯誤摘要。
- Creator/Critic自動修訂最多兩輪；第三次進 `needs_user_decision`。
- 只有engine可建立後繼task；Agent不可指定任意assignee/capability。
- Workflow task與ingestion chunk task以adapter引用，不合併儲存schema。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- tasks
```

### Task 7：Interview、Decisions 與四道 Gates

新增：

- `packages/workflow/src/interview.ts`
- `packages/workflow/src/decisions.ts`
- `packages/workflow/src/gates.ts`
- `packages/workflow/test/gates.test.ts`

先寫失敗測試：

- Facts、Blueprint、Content、Publish gate順序固定。
- 原創入口可透過顯式使用者decision將Facts設為 `not_required`。
- Gate decision保存actor、input revisions、摘要、選項、影響與timestamp。
- Director只能提交回答/呈現gate，不能作為批准actor。
- Gate依賴artifact或input revision變更後自動 `superseded`。
- Normative/schema/provenance error阻止批准且不可override。
- 可override workspace finding需保存明確理由與actor。
- Rejected gate產生下一合法task，不自行改寫作者檔。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- gates
```

### Task 8：Proposal ownership、驗證與 atomic apply

新增：

- `packages/workflow/src/proposal-ownership.ts`
- `packages/workflow/src/proposal-validation.ts`
- `packages/workflow/src/proposal-apply.ts`
- `packages/workflow/test/proposal-apply.test.ts`

修改：

- `packages/project/src/ownership.ts`

先寫失敗測試：

- 從task output kind、角色、active mode與world category推導合法路徑。
- 忽略或拒絕Agent自報的不一致path；拒absolute/traversal/unknown path。
- Creator只能寫其指定artifact集合；Critic零作者mutation。
- 每份proposal重新跑正式作者schema與cross-reference。
- Existing file要求base raw revision；new file要求expectedAbsent。
- Fact provenance必須accepted且evidence完整；single-value ref不得有unresolved conflict。
- 多作者文件、task result、workflow journal與projection同一交易。
- 任一步schema/CAS/transaction故障時正式作者檔byte-for-byte不變。
- Apply後相關review、preview與gate approval superseded。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- proposal
npx --yes pnpm@10.34.5 --filter @card-workspace/project test
```

### Task 9：Mode history、雙向轉換與 preview/publish 鎖

新增：

- `packages/project/src/mode-history.ts`
- `packages/workflow/src/conversion.ts`
- `packages/workflow/src/preview.ts`
- `packages/workflow/test/conversion.test.ts`
- `packages/workflow/test/preview.test.ts`

修改：

- `packages/project/src/load-author-project.ts`
- `packages/project/src/ownership.ts`
- `packages/compiler/src/build.ts`
- `packages/compiler/src/index.ts`
- `packages/cli/src/program.ts`

Mode archive：

```text
characters/<character-id>/mode-history/<conversion-id>/<source-mode>/...
```

先寫失敗測試：

- 轉換不覆寫來源模式；完整複製到immutable mode-history snapshot。
- Target mode所有固定模組schema-valid後才切manifest mode。
- Archive不被active loader視為`CHARACTER_MODE_MIXED`。
- Mapping report含來源/目標revision、provenance與expected semantic loss。
- 轉回原模式不靜默遺失未映射內容。
- Compile preview保存input revision、workflow revision、options、audit、artifact hashes。
- Publish必須引用approved preview ID與完全相同input/options/hash。
- Source/author/avatar/policy變更會supersede preview與Publish Gate。
- Stale publish與中途重編譯失敗不得修改`.build`或exports。
- CLI、library使用同一preview/publish service。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- conversion preview
npx --yes pnpm@10.34.5 --filter @card-workspace/compiler test
npx --yes pnpm@10.34.5 --filter @card-workspace/cli test
```

### Task 10：Registry、Policy、Definitions 與 static linter

新增：

- `workflow/agent-registry.yaml`
- `workflow/tool-policy.yaml`
- `workflow/workflow-definitions.yaml`
- `workflow/personalities/default-neutral.yaml`
- `packages/workflow/src/config-loader.ts`
- `packages/workflow/src/agent-lint.ts`
- `packages/workflow/src/agent-lint-cli.ts`
- `packages/workflow/test/agent-lint.test.ts`

修改：

- `packages/workflow/package.json`
- 根 `package.json`

先寫失敗測試：

- 十Agent、Director、Skills、schema IDs、capabilities與tools全可cross-reference。
- 未註冊agent/skill/reference/schema/tool回stable diagnostic。
- YAML不能宣告TypeScript tool registry不存在的工具或擴張immutable invariants。
- Creator不得引用Critic negative references；Critic不得引用Creator generation references。
- Agent delegation與Skill reference循環偵測。
- Orphan Agent/Skill/reference/fixture偵測。
- Neutral personality只能影響語氣欄位，不能宣告tools、permissions或schemas。
- Linter輸出machine JSON並以nonzero exit code表示失敗。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/workflow test -- agent-lint
npx --yes pnpm@10.34.5 agent-lint
```

### Task 11：MCP package、stdio lifecycle 與可信 context

新增：

- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json`
- `packages/mcp-server/src/index.ts`
- `packages/mcp-server/src/server.ts`
- `packages/mcp-server/src/context.ts`
- `packages/mcp-server/src/errors.ts`
- `packages/mcp-server/test/lifecycle.test.ts`

修改：

- `vitest.config.ts`
- `pnpm-lock.yaml`

先寫失敗測試：

- MCP initialize/listTools/callTool/close stdio lifecycle。
- `CARD_WORKSPACE_ROOT`、`CARD_WORKSPACE_AGENT_ID`缺失或未知時fail fast。
- Agent identity只能從process environment/context factory取得，tool args中的`agent_id`不影響身分。
- Registry/policy/definitions驗證失敗不啟動server。
- stdout只輸出MCP protocol；log/diagnostic走stderr。
- Tool結果為machine-safe content，不洩漏不必要absolute host path。
- Server restart不丟workflow/task持久狀態。
- MCP SDK版本精確鎖定且Node 20.17相容。

驗收：

```powershell
npx --yes pnpm@10.34.5 install --no-frozen-lockfile
npx --yes pnpm@10.34.5 --filter @card-workspace/mcp-server test
npx --yes pnpm@10.34.5 --filter @card-workspace/mcp-server typecheck
```

### Task 12：Capability authorization matrix

新增：

- `packages/mcp-server/src/authorization.ts`
- `packages/mcp-server/src/tool-registry.ts`
- `packages/mcp-server/test/authorization.test.ts`

先寫失敗測試：

- Registry ∩ Task ∩ Stage ∩ Valid Lease四重交集。
- Director、十Agent逐一allow/deny matrix。
- Director不可批准gate或提交Creator artifact。
- Critic不可取得任何author mutation tool。
- Creator不可取得review decision或publish tool。
- 無task、錯agent、expired lease、superseded task、wrong stage全部拒絕。
- `TOOL_CAPABILITY_DENIED`在任何domain I/O前回傳。
- Tool argument不可擴張task ownership/capability。
- Per-agent instance即使OpenCode permission誤開，server仍做domain authorization。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/mcp-server test -- authorization
```

### Task 13：Workflow 與 Sources/Facts MCP adapters

新增：

- `packages/mcp-server/src/tools/workflow.ts`
- `packages/mcp-server/src/tools/sources.ts`
- `packages/mcp-server/src/tools/facts.ts`
- `packages/mcp-server/test/workflow-tools.test.ts`
- `packages/mcp-server/test/ingestion-tools.test.ts`

工具範圍：

- workflow start/status/interview/gate/task claim-submit-fail-release。
- source local/retrieved intake、chunk creation、chunk task。
- fact candidate submit/query/review、conflict resolve、provenance trace/verify。

先寫失敗測試：

- MCP result與直接library相同revision下語意等價。
- Local source intake只允許Director/使用者工作流；拒glob/symlink/traversal。
- Retrieved source只接收bytes+metadata，不提供任意URL fetch。
- Workflow task lease與ingestion chunk lease分層映射。
- Candidate/evidence stale revision、fact decision與conflict權限維持既有錯誤語意。
- Maintenance-only rebuild API不暴露給一般Agent。
- 所有mutations帶expected revision且重試idempotent。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/mcp-server test -- workflow-tools ingestion-tools
```

### Task 14：Author 與 Forge MCP adapters

新增：

- `packages/mcp-server/src/tools/author.ts`
- `packages/mcp-server/src/tools/forge.ts`
- `packages/mcp-server/test/author-tools.test.ts`
- `packages/mcp-server/test/forge-tools.test.ts`

工具範圍：

- Blueprint/character/world/greetings/conversion proposal。
- Review report與import analysis。
- Project validate/plan/simulate/compile preview/publish。
- Card import/audit/round-trip。

先寫失敗測試：

- Proposal submit只保存task result，正式apply由engine執行。
- Wrong output schema/owner/base revision/lease在任何作者I/O前拒絕。
- Critic review read-only；report target revision stale時拒絕。
- Compile preview不publish；strict failure不改`.build`/exports。
- Publish要求approved preview與相同input revision/hash/options。
- Import Analyst只提交mapping analysis，不假裝完成decompile。
- MCP、CLI、library對相同fixture得到相同audit、IR與artifact hash。
- JSON/PNG路徑限定workspace allowlist及大小限制。

驗收：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/mcp-server test -- author-tools forge-tools
npx --yes pnpm@10.34.5 --filter @card-workspace/cli test
```

### Task 15：Director、十 Agents、Skills、OpenCode 與四條 E2E

新增：

- 根 `opencode.jsonc`
- `.opencode/prompts/director.md`
- `.opencode/prompts/fact-curator.md`
- `.opencode/prompts/zhuji-creator.md`
- `.opencode/prompts/palette-creator.md`
- `.opencode/prompts/character-critic.md`
- `.opencode/prompts/greetings-creator.md`
- `.opencode/prompts/greetings-critic.md`
- `.opencode/prompts/mode-conversion.md`
- `.opencode/prompts/card-import-analyst.md`
- `.opencode/prompts/world-lore-creator.md`
- `.opencode/prompts/world-lore-critic.md`
- `.agents/skills/<skill-id>/SKILL.md`（十一個單一職責 Skill）
- `.agents/skills/<skill-id>/references/*.md`
- `.agents/skills/<skill-id>/fixtures/*`
- `packages/mcp-server/test/e2e/original.test.ts`
- `packages/mcp-server/test/e2e/source-adaptation.test.ts`
- `packages/mcp-server/test/e2e/card-import.test.ts`
- `packages/mcp-server/test/e2e/mode-conversion.test.ts`
- `docs/architecture/agents-workflow.md`

修改：

- 根 `package.json`
- `README.md`
- `.gitignore`

OpenCode 設定要求：

- `$schema` 指向 `https://opencode.ai/config.json`。
- `default_agent` 指向primary Director。
- `skills.paths`明確包含`.agents/skills`。
- 每個Agent使用獨立MCP server name與相同executable，env固定`CARD_WORKSPACE_AGENT_ID`。
- 全域預設deny Forge MCP tools；每Agent只允許自身server prefix與必要built-in tools。
- Director的task permission只允許十個已註冊subagents。
- Agent/Skill/config變更後README明確要求重啟OpenCode。

先寫失敗測試：

- Director一次只提出一個未決問題，且不輸出完整角色模組。
- 十Agent各自只載入其Skill與允許references。
- Creator/Critic正負規則隔離；Critic零正式寫入。
- 模組7永不進greetings。
- 原創：Facts not-required decision→Blueprint→作者內容→Critic→Content Gate→preview→Publish Gate。
- 來源二創：snapshot→chunks→candidates→Facts Gate→角色/世界設定→publish。
- 舊卡：import→Analyst mapping→Blueprint Gate→重建→round-trip。
- 雙向轉換：珠璣→調色盤→珠璣，保留mode-history、mapping/provenance與expected loss。
- MCP process restart/crash後依workflow/task/lease狀態續接。
- Prompt fixtures只驗結構契約，不把真模型輸出放進deterministic CI。

驗收：

```powershell
npx --yes pnpm@10.34.5 agent-lint
npx --yes pnpm@10.34.5 check
```

## 6. 最終品質閘門

依序執行：

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 audit --prod --audit-level high
```

不得降低既有 coverage 門檻：statements/lines/functions 85%、branches 80%。新增 MCP SDK 後 production audit 必須沒有 high 或以上已知弱點。

## 7. 完成定義

- Workflow v2、v1 migration、logical journal、projector與recovery已測試。
- 四入口、十階段、四道gate與task/lease/retry可持久續接。
- Proposal經task ownership、schema、revision、provenance後原子套用。
- Mode conversion保留來源模式並只啟用一套active mode。
- Publish只能發布已批准且未stale的相同preview。
- 單一MCP實作以identity-bound instances啟動，caller identity不取自tool args。
- 十Agent只可執行Registry、Task、Stage、Lease共同允許的工具。
- Director、Creator、Critic的責任與工具隔離可由測試證明。
- Agent/Skill/config可直接維護且static linter全綠。
- 四條deterministic E2E全綠；strict failure不改正式作者檔、`.build`或exports。
- Frozen install、build、lint、typecheck、tests、coverage與production audit全綠。
- 真模型只作可選smoke test；若未執行，最終報告明確列為外部驗收。
- OpenCode設定變更後告知使用者完整重啟OpenCode。

## 8. 實作驗收結果

- Workflow v2、v1 migration、logical journal、tasks、gates、proposal apply、mode history及preview/publish lock已完成。
- `@card-workspace/mcp-server`與34個領域工具已完成；caller identity由`CARD_WORKSPACE_AGENT_ID`綁定。
- Director、十個專職Agents、十一個Skills及identity-bound OpenCode MCP registrations已建立。
- `agent-lint`通過：零diagnostics。
- `pnpm check`通過：48 test files、268 tests。
- Coverage通過：statements/lines 87.27%、branches 80.02%、functions 85.98%。
- Frozen lockfile install通過。
- Production audit：`No known vulnerabilities found`。
- OpenCode設定、Agents及Skills需完整重啟OpenCode後才由新session載入。
- 真模型工作流與真實SillyTavern匯入仍屬外部smoke驗收，不納入deterministic CI。

## 9. 計畫自審

- 15項Task依schema→project→engine→MCP→OpenCode的依賴順序排列。
- MCP caller identity已採可實作的process-bound方案，未依賴共享request的未知metadata。
- Workflow logical journal與Project physical transaction責任分離。
- Preview/Publish、Mode History、Blueprint三個既有缺口已有明確Task與驗收。
- Proposal API不暴露generic patch或任意path。
- Creator/Critic隔離、模組7與greetings分離、兩次retry上限均有測試。
- 沒有把Dashboard、plugins、personality調校或未受控網搜混入本階段。
- 沒有預留空白項目、佔位內容或未決架構選項。
