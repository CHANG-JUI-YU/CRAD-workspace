# Card Workspace vNext 交接手冊

> 適用對象：第一次接觸這個專案、沒有軟體工程背景，也不知道從哪裡開始的人。
>
> 文件基準：2026-07-21，Git `main`，基準 commit `a0a7976`（`Initial card workspace implementation`）。
>
> Repository：<https://github.com/CHANG-JUI-YU/CRAD-workspace.git>
>
> 注意：GitHub repository 名稱是 `CRAD-workspace`，其中 `CRAD` 是目前實際拼法。

---

## 目錄

1. [先看這裡：這個系統是做什麼的](#1-先看這裡這個系統是做什麼的)
2. [新手第一次接手：照著做](#2-新手第一次接手照著做)
3. [五條絕對安全規則](#3-五條絕對安全規則)
4. [名詞白話表](#4-名詞白話表)
5. [整體架構與資料流](#5-整體架構與資料流)
6. [Monorepo：每個 Package 在做什麼](#6-monorepo每個-package-在做什麼)
7. [角色卡專案目錄與檔案所有權](#7-角色卡專案目錄與檔案所有權)
8. [Revision、CAS 與交易](#8-revisioncas-與交易)
9. [Sources、Facts、Evidence 與 Provenance](#9-sourcesfactsevidence-與-provenance)
10. [Workflow、Tasks、Leases、Retries 與 Gates](#10-workflowtasksleasesretries-與-gates)
11. [OpenCode、Director、Agents、Skills 與 MCP](#11-opencodedirectoragentsskills-與-mcp)
12. [MVU、EJS、HTML Plugins](#12-mvuejshtml-plugins)
13. [Compiler、CCv3、PNG、Token、Trigger 與 Audit](#13-compilerccv3pngtokentrigger-與-audit)
14. [Dashboard 使用與安全](#14-dashboard-使用與安全)
15. [CLI 命令與參數字典](#15-cli-命令與參數字典)
16. [環境變數、Scripts 與設定參數](#16-環境變數scripts-與設定參數)
17. [核心 Schema 欄位](#17-核心-schema-欄位)
18. [重要公開 API 函式參數](#18-重要公開-api-函式參數)
19. [Git、GitHub 與本機資料保護](#19-gitgithub-與本機資料保護)
20. [測試、Coverage、E2E 與 CI](#20-測試coveragee2e-與-ci)
21. [修改同步矩陣](#21-修改同步矩陣)
22. [常見錯誤與恢復方法](#22-常見錯誤與恢復方法)
23. [已知缺口與優先級](#23-已知缺口與優先級)
24. [文件權威與過時文件](#24-文件權威與過時文件)
25. [新手 Day 1 與 Week 1 清單](#25-新手-day-1-與-week-1-清單)

---

# 1. 先看這裡：這個系統是做什麼的

Card Workspace vNext 是一套在本機執行的 **SillyTavern Character Card V3 角色卡創作、審核、編譯與發布系統**。

它不是單純的文字編輯器。它同時管理：

- 角色身份、人格、外觀、對話與自我介紹。
- 世界設定、多人關係與開場白。
- 來源資料、人工接受的 Facts 與證據鏈。
- 多個 AI Agent 的工作分派、審查與失敗恢復。
- Facts、Blueprint、Content、Publish 四道人工作業閘門。
- MVU/Zod、EJS、HTML 三種可選功能。
- Token 與 Trigger 模擬。
- CCv3 JSON、角色卡 PNG 與選擇性 V2 backfill。
- Exact Preview、CAS 驗證與原子發布。

一句話理解：

```text
使用者說明想做什麼
→ Director 拆工作
→ 專職 Agent 產生提案
→ Critic 審查
→ 使用者批准 Gate 或 Plugin
→ Compiler 產生 CCv3 JSON/PNG
→ Publish 以交易方式正式寫出
```

系統最重要的設計原則是：

> Agent 不能靠文字宣稱自己完成或獲得批准。所有狀態、權限、審查、revision 與發布都必須由程式驗證。

---

# 2. 新手第一次接手：照著做

## 2.1 需要準備什麼

| 工具 | 必要版本 | 如何確認 | 用錯版本的結果 |
|---|---:|---|---|
| Git | 近期版本 | `git --version` | 無法 clone、commit 或 push |
| Node.js | `>=20.17 <21` | `node --version` | `engine-strict` 會拒絕安裝 |
| pnpm | `10.34.5` | `pnpm --version` | Lockfile 或 workspace 行為可能不一致 |
| Windows PowerShell | 5.1 或更新 | `$PSVersionTable` | 命令語法可能不同 |

建議使用 Node `20.19.5`，它與 CI 設定一致。

## 2.2 從 GitHub 下載

```powershell
git clone https://github.com/CHANG-JUI-YU/CRAD-workspace.git C:\AI\projects\card-workspace
```

進入目錄：

```powershell
Set-Location C:\AI\projects\card-workspace
```

確認狀態：

```powershell
git status
node --version
npx --yes pnpm@10.34.5 --version
```

## 2.3 安裝 dependencies

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
```

`--frozen-lockfile` 表示完全依照 `pnpm-lock.yaml` 安裝，不允許偷偷改版本。

## 2.4 第一次 Build

```powershell
npx --yes pnpm@10.34.5 build
```

這一步不可省略，因為：

- Git 不追蹤 `dist/`。
- CLI 執行 `packages/cli/dist/index.js`。
- OpenCode 的 MCP processes 執行 `packages/mcp-server/dist/index.js`。
- Dashboard server 需要已建置的前後端檔案。

## 2.5 建立第一個本機示範專案

Fresh clone 不含 `projects/`，因為真正角色卡資料刻意不進 Git。先用 CLI 建立：

```powershell
node packages\cli\dist\index.js init demo --title "Demo Character"
```

建立後資料位於：

```text
C:\AI\projects\card-workspace\projects\demo\
```

這個目錄被 Git 忽略，不會被上傳。

## 2.6 啟動 Dashboard

最簡單的方法：

```text
C:\AI\projects\card-workspace\啟動-Dashboard.bat
```

或在 PowerShell 執行：

```powershell
npx --yes pnpm@10.34.5 dashboard
```

Dashboard 只監聽 `127.0.0.1`，會開啟帶一次性 bootstrap token 的網址。

不要把它改成 LAN IP，也不要用 reverse proxy 暴露到網路。

## 2.7 啟動 OpenCode

先確定已 build，再從 workspace root 啟動 OpenCode：

```powershell
Set-Location C:\AI\projects\card-workspace
opencode
```

預設 Agent 是 `director`。

如果剛修改 `opencode.jsonc`、Prompt、Skill、Personality、Agent Registry、Tool Policy 或 MCP 環境，必須完整關閉 OpenCode 後重新啟動。

## 2.8 第一次品質檢查

快速檢查：

```powershell
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 agent-lint
```

完整本機門禁：

```powershell
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 lint
npx --yes pnpm@10.34.5 typecheck
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 agent-lint
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 test:e2e
npx --yes pnpm@10.34.5 audit --prod --audit-level high
```

`pnpm check` 只包含 build、lint、typecheck、test，不包含 agent-lint、coverage、E2E 或 audit。

---

# 3. 五條絕對安全規則

## 規則 1：不要手改 Workflow 狀態

禁止人工修改：

```text
workflow.json
.workflow/**
```

原因：`workflow.json` 是 journal 的投影，不是一般設定檔。手改可能造成 `WORKFLOW_PROJECTION_DIVERGED`，讓後續操作全部停止。

## 規則 2：不要手改 Sources/Facts 投影

禁止人工修改：

```text
sources/**
facts/**
```

尤其不能改：

```text
sources/manifest.yaml
facts/register.yaml
facts/conflicts.yaml
facts/decisions.jsonl
```

這些資料必須由 intake、candidate、review、conflict resolution 與 projector 產生。

## 規則 3：不要手改 Plugin 正式狀態

禁止直接修改：

```text
extensions/<plugin-id>/source.yaml
.workflow/plugin-selection.yaml
.workflow/plugin-artifacts/**
templates/plugins/**
project.yaml 的 plugins 欄位
```

Plugin approval 必須同時更新 source、manifest、selection、artifact、authorization token 與 workflow，缺一不可。

## 規則 4：不要使用 `git clean -fdx`

這個命令會刪除所有被 Git 忽略的資料。此專案被忽略的資料包括：

- 真實 `projects/`。
- `reference/`。
- `exports/`。
- `.legacy-v1/`。
- Build、coverage、transactions。

執行 `git clean -fdx` 可能直接刪除所有本機角色卡專案。

## 規則 5：遇到 stale/conflict 要重讀，不要強制覆蓋

如果看到：

```text
REVISION_CONFLICT
WORKFLOW_REVISION_CONFLICT
*_STALE
TASK_LEASE_EXPIRED
```

正確作法是重新讀取最新資料、重新產生 patch 或重新 claim task。不要手改 revision，不要關掉 CAS。

---

# 4. 名詞白話表

| 名詞 | 白話意思 |
|---|---|
| Workspace | 整個 `card-workspace` 程式碼與資料根目錄 |
| Project | 一張角色卡或一本獨立世界書的完整工作目錄 |
| Blueprint | 創作規格：要做哪些角色、世界、關係、開場與 Plugins |
| Canonical IR | Compiler 內部使用的統一、穩定資料格式 |
| CCv3 | SillyTavern Character Card V3 格式 |
| Source | 使用者提供的原始參考資料及不可變快照 |
| Candidate | Agent 從 Source 擷取出、尚未由人類接受的候選事實 |
| Fact | 經人工決定接受的正式事實 |
| Evidence | Fact 指回原始 Source、revision、chunk 與文字位置的證據 |
| Provenance | 從輸出內容一路追溯到 Fact 與 Source 的完整來源鏈 |
| Workflow | 專案目前處於哪個創作階段、有哪些工作與 Gate |
| Task | 指派給特定 Agent 的正式工作單位 |
| Lease | Agent 暫時擁有 Task 的憑證與有效期限 |
| Gate | 必須由使用者決定是否通過的人工閘門 |
| Revision | 資料版本識別；不同資料使用不同種類的 revision |
| CAS | Compare-And-Swap；只有版本仍相同才允許寫入 |
| Transaction | 多個檔案一起成功或一起失敗的原子操作 |
| Preview | 對 exact input 建立的編譯審查快照 |
| Publish | 將已核准 Preview 原子寫入 `.build` 與 `exports` |
| Plugin | MVU、EJS、HTML 等可選角色卡能力 |
| Artifact | Workflow 記錄並追蹤 revision 的正式產物 |
| Director | 協調工作流程的主 Agent；不能自行批准 Gate |
| Critic | 只負責審查 Creator 提案，不負責改寫正式內容 |

---

# 5. 整體架構與資料流

## 5.1 分層

```text
使用者
  ├─ OpenCode Director
  ├─ CLI
  └─ Dashboard
       ↓
MCP Server / Dashboard Server / CLI adapters
       ↓
Workflow / Project / Ingestion / Compiler domain libraries
       ↓
Schemas、路徑安全、CAS、Transactions
       ↓
projects/<id>/、.build/、exports/<id>/
```

權威邊界：

- Schemas 決定資料是否合法。
- Project package 決定檔案路徑、ownership、CAS 與交易是否合法。
- Ingestion 決定 Sources/Facts/Provenance 是否可信。
- Workflow Engine 決定 stage、task、lease、gate 與 revision。
- Compiler 決定輸出、Token、Trigger、Audit 與 Publish Plan。
- MCP、Dashboard、CLI 只負責把請求送進既有 domain API。
- Dashboard 與 Agent 不是 domain authority。

## 5.2 正式編譯資料流

主要入口：

```text
packages/compiler/src/build.ts
buildProject()
```

順序：

```text
loadAuthorProject
→ normalizeAuthorProject
→ compileActivePlugins
→ buildProvenanceIndex
→ planCanonicalProject
→ simulateTokens
→ simulateTriggers
→ emitCharacterCardV3 / emitLorebookV3
→ auditCharacterCard / auditLorebook
→ optional PNG / V2 backfill
→ PublishPlan
```

## 5.3 四種容易混淆的 Build

| 名稱 | 會做什麼 | 會不會正式發布 |
|---|---|---|
| `pnpm build` | 編譯程式碼與 Dashboard | 不會 |
| `buildProject()` | 在記憶體編譯角色卡，建立 PublishPlan | 不會，`publish:true` 會被拒絕 |
| `createCompilePreview()` | 編譯並持久化 exact preview，更新 workflow | 不會寫 exports |
| `publishApprovedPreview()` | 重建、驗證 exact hashes，原子寫 `.build` 與 `exports` | 會 |

---

# 6. Monorepo：每個 Package 在做什麼

共有 13 個 packages 與 1 個 Dashboard app。

| 元件 | 白話責任 | 主要入口 |
|---|---|---|
| `packages/schemas` | 全系統 Zod 資料契約 | `src/index.ts` |
| `packages/project` | 專案、檔案安全、patch、CAS、transaction、publish | `src/index.ts` |
| `packages/ingestion` | Sources、Facts、Evidence、Provenance | `src/index.ts` |
| `packages/plugins` | MVU/EJS/HTML、template、pin registry | `src/index.ts` |
| `packages/compiler` | Normalize、Plan、Simulation、Build、Audit | `src/build.ts` |
| `packages/adapters-ccv3` | CCv1/V2/V3 import/export、plugin merge | `src/index.ts` |
| `packages/adapters-png` | PNG chunks 與 `ccv3`/`chara` metadata | `src/index.ts` |
| `packages/diagnostics` | Card/Worldbook audit | `src/audit.ts` |
| `packages/workflow` | 唯一 Workflow authority | `src/index.ts` |
| `packages/mcp-server` | Agent 身分綁定與 Forge tools | `src/server.ts` |
| `packages/dashboard-server` | Fastify API、session、CSRF、SSE | `src/server.ts` |
| `packages/cli` | Commander CLI adapter | `src/program.ts` |
| `packages/testing` | Temporary workspace 與 fixtures | `src/index.ts` |
| `apps/dashboard` | React/Vite 工作台 | `src/main.tsx` |

依賴方向大致如下：

```text
schemas
  ↓
project / adapters / plugins
  ↓
ingestion / compiler
  ↓
workflow
  ↓
mcp-server / dashboard-server / cli
  ↓
apps/dashboard
```

不要讓底層 package 反向依賴上層，否則容易形成循環依賴。

---

# 7. 角色卡專案目錄與檔案所有權

## 7.1 標準目錄

```text
projects/<project-id>/
├─ project.yaml
├─ blueprint.yaml
├─ workflow.json
├─ greetings.yaml
├─ relationships.yaml
├─ characters/
│  └─ <character-id>/
│     ├─ character.yaml
│     ├─ zhuji/
│     │  ├─ 01-appearance.yaml
│     │  ├─ 02-inner-nature.yaml
│     │  ├─ 03-extension.yaml
│     │  ├─ 04-trait-refinement.yaml
│     │  ├─ 05-trait-dialogue.yaml
│     │  ├─ 06-scene-dialogue.yaml
│     │  └─ 07-self-introduction.yaml
│     ├─ palette/
│     │  ├─ 01-basic-information.yaml
│     │  ├─ 02-personality-palette.yaml
│     │  ├─ 03-tri-faceted.yaml
│     │  └─ 04-secondary-interpretation.yaml
│     └─ mode-history/
├─ world/
│  ├─ people/
│  ├─ geography/
│  ├─ organizations/
│  ├─ history/
│  ├─ concepts/
│  ├─ systems/
│  ├─ items/
│  └─ events/
├─ policies/
├─ assets/avatar.png
├─ extensions/<plugin-id>/source.yaml
├─ templates/plugins/<plugin-id>/<template-id>/1/
├─ sources/
├─ facts/
├─ .workflow/
├─ .build/
└─ .transactions/
```

正式 exports 在專案目錄外：

```text
exports/<project-id>/
```

## 7.2 可以受控編輯的作者內容

建議透過 Dashboard editor、Creator proposal 或 CLI patch：

- `project.yaml` 的一般顯示與輸出設定。
- `blueprint.yaml`。
- `greetings.yaml`。
- `characters/<id>/character.yaml`。
- 珠璣與調色盤模組。
- `world/<category>/*.yaml`。
- `policies/*.yaml` 或 `.json`。
- `assets/avatar.png`。

## 7.3 只能由 Engine 或專用工具修改

- `workflow.json`、`.workflow/**`。
- `relationships.yaml`。
- `sources/**`、`facts/**`。
- `extensions/*/source.yaml`。
- `templates/plugins/**`。
- `project.yaml.plugins`。
- 角色增刪、模式轉換及 `mode-history`。
- `.transactions/**`、`.build/**`、`exports/**`。

## 7.4 固定模組來源

權威檔案：

```text
packages/project/src/author-layout.ts
```

舊文件中的 `expanded_extension` 是 legacy 名稱。新資料使用：

- `extension`
- `trait_refinement`
- `trait_dialogue`

---

# 8. Revision、CAS 與交易

## 8.1 Revision 種類

| 種類 | 格式 | 用途 | 不可混用原因 |
|---|---|---|---|
| Canonical/Semantic revision | `sha256:<64 hex>` | 結構化文件內容版本 | 不反映原始排版 bytes |
| Raw revision | SHA-256 | 實際檔案 bytes CAS | 排版差異也會改變 |
| Workflow revision | 非負整數 | Workflow mutation 次序 | 不是內容 hash |
| Fact revision | 正整數 | 單一 Fact 版本 | 只適用於該 Fact |
| Job revision | 非負整數 | Ingestion job 狀態 | 只適用於該 job |

## 8.2 CAS 白話流程

```text
讀取文件與 revision
→ 使用者或 Agent準備變更
→ 帶 expected revision 送出
→ Server 重新比對目前 revision
→ 相同才寫入，不同就拒絕
```

它的目的是防止兩個視窗或兩個 Agent 互相覆蓋。

## 8.3 Transaction 流程

核心：

```text
packages/project/src/transaction.ts
runFileTransaction()
```

Windows 實際流程：

```text
取得 project.lock
→ 驗證 expected revisions
→ 寫 staged files 並 flush
→ 寫 prepared journal
→ 舊檔 rename 到 backup
→ staged 檔 rename 到正式位置
→ 寫 committed journal
→ 失敗時反向 rollback
```

不要手刪 lock、journal、staged 或 backup。程序崩潰後，下一次合法交易會嘗試恢復。

## 8.4 Preview 與 Publish

Preview 綁定：

- Input revision。
- Artifact hashes。
- Build options。
- Audit findings。
- Workflow revision。
- Plugin artifacts。

內容改變後，舊 Preview/Gate 必須 stale 或 superseded。

Publish 會重新 build，只有 exact input 與 stable artifact hashes 相同才可寫出。

Runtime timing metadata 仍會寫入 manifest/trace，但不作 stable artifact hash，避免正常重建因毫秒差異被誤判。

---

# 9. Sources、Facts、Evidence 與 Provenance

## 9.1 正式流程

```text
intake source
→ 保存 immutable snapshot/revision/projection
→ 建立 deterministic chunks
→ 建立 extraction job
→ Agent 提交 candidate batch
→ 人工 review candidate
→ accepted Fact 或 Conflict
→ resolve conflict
→ verify projection/provenance
```

## 9.2 Source

Source revision ID 是原始 bytes 的 SHA-256。舊 revision 不會被覆蓋。

重要入口：

- `intakeLocalSource()`
- `intakeRetrievedSource()`
- `createChunkSet()`
- `storeChunkSet()`
- `createExtractionJob()`

## 9.3 Candidate 與 Fact 的差別

- Candidate：Agent 認為可能正確，尚未人工接受。
- Fact：使用者已做 accepted 決定，才能作正式證據。

分類：

- `source_fact`：直接來自 Source，必須有 evidence。
- `reasonable_inference`：合理推論，必須有 evidence。
- `creative_completion`：創作補全，必須有 rationale。

## 9.4 Evidence

Evidence 應精確指向：

- Source ID。
- Source revision。
- Chunk set。
- Chunk ID。
- Quote occurrence。
- Character/line/byte range。

## 9.5 Projection

`facts/register.yaml` 和 `facts/conflicts.yaml` 是 journal 的 projection。它們可閱讀，但不可人工編輯。

只有 immutable artifacts 與 decision journal 完整時，才可安全使用 `rebuildFactProjection()`。

---

# 10. Workflow、Tasks、Leases、Retries 與 Gates

## 10.1 設定來源

```text
workflow/agent-registry.yaml
workflow/tool-policy.yaml
workflow/workflow-definitions.yaml
packages/workflow/src/definitions.ts
packages/workflow/src/runtime.ts
```

## 10.2 四種入口

| Entry kind | 用途 | 現況 |
|---|---|---|
| `original` | 原創角色卡 | 可用 |
| `source_adaptation` | 以來源資料改編 | 可用，含 Facts Gate |
| `card_import` | 匯入舊卡後重建 | 可用 |
| `mode_conversion` | 珠璣/調色盤模式轉換 | Library 存在，但通用 workflow 入口仍 fail closed |

## 10.3 21 個合法 Stages

1. `intake`
2. `source_processing`
3. `facts_review`
4. `blueprint`
5. `pre_world_authoring`
6. `pre_world_review`
7. `authoring`
8. `semantic_review`
9. `post_world_authoring`
10. `post_world_review`
11. `greetings_authoring`
12. `plugin_mvu_authoring`
13. `plugin_mvu_review`
14. `plugin_ejs_authoring`
15. `plugin_ejs_review`
16. `plugin_html_authoring`
17. `plugin_html_review`
18. `content_review`
19. `compile_preview`
20. `publish_review`
21. `published`

不是每個 entry kind 都會經過全部 stages。Blueprint 也會讓不需要的 world、greetings、plugin stages 自動略過。

## 10.4 Tasks 與 Leases

Task 會記錄：

- `id`、`kind`、`status`。
- `assigned_agent`。
- `capabilities`。
- `dependencies`。
- `input_artifacts`。
- `output_contract`。
- `attempt`、`max_attempts`。
- Lease owner、ID、claimed/expires time。

Agent 只能處理指派給自己的 Task，而且 mutation 需要有效 lease。

## 10.5 Retry 與 Recovery

- 一般 task `max_attempts` 目前多為 3。
- Creator/Critic 自動 revision 最多兩輪，定義於 `packages/workflow/src/retry.ts`。
- 暫時性錯誤可走 `task_recovery_begin`。
- 修正外部缺陷後可依規則使用 `task_repair_resume`。
- 不可手改 task status 或 attempts。

## 10.6 四道 Gates

| Gate | 審查內容 | 誰能決定 |
|---|---|---|
| Facts | Facts 是否足夠、衝突是否解決 | 使用者 |
| Blueprint | 創作範圍是否正確 | 使用者 |
| Content | 所有作者與 Plugin artifacts 是否可接受 | 使用者 |
| Publish | Exact Preview 是否正式發布 | 使用者 |

Director 只能呈現選項，不可自行假裝使用者批准。

Gate 必須綁 exact input revisions。輸入改變後舊 Gate 應 superseded。

---

# 11. OpenCode、Director、Agents、Skills 與 MCP

## 11.1 目前數量

- 1 個 OpenCode-only `build` primary Agent。
- 1 個 Forge `director` primary Agent。
- 18 個 Forge 專職 subagents。
- 19 個 Forge identities。
- 19 個 local MCP registrations。

README 中「十個專職 Agent」是舊資訊。

## 11.2 Agent 對照

| Agent | 責任 | Skill |
|---|---|---|
| `director` | 工作流協調與使用者溝通 | `director-orchestration` |
| `source-researcher` | 來源研究 | `source-research` |
| `fact-curator` | Fact 擷取與整理 | `fact-curation` |
| `zhuji-creator` | 珠璣角色模組 | `zhuji-creation` |
| `palette-creator` | 調色盤角色模組 | `palette-creation` |
| `relationship-creator` | 多角色關係 | `relationship-creation` |
| `character-critic` | 角色審查 | `character-critique` |
| `greetings-creator` | 開場白 | `greetings-creation` |
| `greetings-critic` | 開場白審查 | `greetings-critique` |
| `mode-conversion` | 模式轉換提案 | `mode-conversion` |
| `card-import-analyst` | 匯入卡分析 | `card-import-analysis` |
| `world-lore-creator` | 世界設定 | `world-lore-creation` |
| `world-lore-critic` | 世界設定審查 | `world-lore-critique` |
| `mvu-creator` | MVU/Zod typed source | `mvu-creation` |
| `mvu-critic` | MVU 審查 | `mvu-critique` |
| `ejs-creator` | EJS typed source | `ejs-creation` |
| `ejs-critic` | EJS 審查 | `ejs-critique` |
| `html-creator` | HTML typed source | `html-creation` |
| `html-critic` | HTML 審查 | `html-critique` |

## 11.3 三層設定權威

| 層 | 檔案 | 作用 |
|---|---|---|
| OpenCode 前端 | `opencode.jsonc` | Agent、Prompt、Skill、OpenCode permission、MCP process |
| Workflow 設定 | `workflow/*.yaml` | Agent identity、capability、tool/stage policy、definitions |
| TypeScript 不可擴張層 | schemas/workflow/mcp source | 真正合法 tools、stages、contracts、authorization invariants |

YAML 不能新增 TypeScript 尚未註冊的 Tool 或 Stage。

## 11.4 MCP 身分

每個 Agent 的 MCP process 由環境變數綁定：

```text
CARD_WORKSPACE_ROOT
CARD_WORKSPACE_AGENT_ID
```

工具參數裡的 `agent_id` 不能覆寫 process identity。

## 11.5 真正授權交集

```text
OpenCode permission
∩ Agent Registry capability
∩ Tool Policy stage/capability
∩ Current Task capability
∩ Task assignment
∩ Valid lease
∩ Required Gate
```

任一層拒絕就不能執行。放寬 OpenCode permission 不能繞過 MCP server。

## 11.6 修改後何時重啟

修改以下內容必須完整重啟 OpenCode：

- `opencode.jsonc`。
- `.opencode/prompts/**`。
- `.agents/skills/**`。
- `workflow/agent-registry.yaml`。
- `workflow/tool-policy.yaml`。
- `workflow/workflow-definitions.yaml`。
- Personalities。
- MCP environment。
- MCP 原始碼：先 `pnpm build`，再重啟。

---

# 12. MVU、EJS、HTML Plugins

## 12.1 官方 Plugin IDs

- `official.mvu-zod`
- `official.ejs`
- `official.html`

## 12.2 依賴

- EJS 一定依賴 MVU。
- HTML `html.status_bar` 依賴 MVU。
- HTML `message_presentation` 可獨立使用。
- Compile 順序固定 MVU → EJS → HTML。

依賴解析權威：

```text
packages/plugins/src/registry.ts
resolvePluginSelectionDependencies()
```

## 12.3 MVU

MVU canonical source 是 typed data，不是作者任意 TypeScript。

可生成：

- Zod 4 schema source。
- InitVar。
- Variable list。
- Update rules。
- JSON Patch output format。
- UpdateVariable prompt-only regex。
- Runtime/patch path registry。

Runtime read path 含 `stat_data`，AI JSON Patch path 不含 `stat_data`。

## 12.4 EJS

EJS source 是封閉 expression tree，不接受任意 JavaScript。

支援：

- Entry visibility。
- Conditional sections。
- Dynamic text。
- Preprocessing aliases。
- `all`、`any`、`not`、comparison、membership、range。

所有變量 path 必須由 MVU registry 解析。

## 12.5 HTML

HTML source 是 typed components，不接受 raw HTML/CSS/作者 script。

功能：

- Status bar。
- Message presentation。
- Greeting selector。

安全邊界：

- `html-policy@1` 正向 allowlist。
- parse5 與 css-tree reparse。
- Scoped CSS。
- Responsive/reduced-motion。
- 禁止 iframe、script、inline handler、remote URL、host selector、CSS import。
- Writable MVU binding 需要 host CAS 與完整 state validation。

## 12.6 正式生命週期

```text
Blueprint 或 Dashboard 選擇 capabilities
→ Server 計算 dependency closure 與 exact pins
→ immutable plugin-revision-intent
→ Creator task
→ Critic review
→ pending plugin proposal
→ Dashboard session + CSRF + one-time token
→ 使用者 approve/reject
→ approval transaction 原子寫 source/manifest/selection/artifact/token/workflow
→ Content/Preview/Publish evidence stale
```

## 12.7 儲存位置

```text
extensions/<plugin-id>/source.yaml
.workflow/plugin-selection.yaml
.workflow/plugin-artifacts/<artifact-id>.json
templates/plugins/<plugin-id>/<template-id>/1/manifest.yaml
templates/plugins/<plugin-id>/<template-id>/1/payload.yaml
```

目前 Template 是 project-local。部分設計文件曾描述 workspace-level，應以實作為準。

---

# 13. Compiler、CCv3、PNG、Token、Trigger 與 Audit

## 13.1 Compiler 輸出

Character card 可輸出：

- CCv3 JSON。
- `ccv3` metadata PNG。
- 選擇性 V2 backfill `chara` metadata。
- Audit Markdown。
- Build manifest。
- Plugin build trace。

## 13.2 Token Simulation

`simulateTokens()` 會：

- 依 tokenizer 計算 entry tokens。
- 保留 constant entries。
- 依 priority/budget 決定 included/evicted。
- 超預算時產生報告，不會偷偷刪除 constant content。

## 13.3 Trigger Simulation

`simulateTriggers()` 會模擬：

- Keyword activation。
- Regex activation。
- Scan depth。
- Generation type。
- Recursion 與 budget included entries。

錯誤 regex 會產生 diagnostic，而不是執行任意程式碼。

## 13.4 CCv3 Plugin Mapping

Plugin contributions 映射到：

```text
/data/character_book/entries/-
/data/extensions/regex_scripts/-
/data/extensions/tavern_helper/scripts/-
/data/extensions/card-workspace/plugins/<plugin-id>
```

Managed resources 使用 deterministic UUIDv5，未管理陣列順序應保留。相同 ID、不同內容會 fail closed。

## 13.5 PNG

PNG adapter：

- 驗證 PNG signature/chunks/CRC。
- 優先讀 `ccv3`，否則讀 `chara`。
- 寫入前移除舊 `ccv3/chara` metadata。
- 不修改輸入 Buffer，回傳新 Buffer。

## 13.6 Audit

Audit 分為：

- Normative schema。
- SillyTavern compatibility。
- Workspace policy。

`strict` 預設通常為 true。Normative error 不可被 policy override。

---

# 14. Dashboard 使用與安全

## 14.1 頁面

| Section | 功能 |
|---|---|
| Overview | 專案摘要、stage、Gates、診斷 |
| Workflow | Tasks、Decisions、Gate actions |
| Sources | Source 清單與狀態 |
| Facts | Candidate review、Conflict resolution |
| Characters | Character、珠璣、調色盤編輯 |
| World | 世界條目編輯 |
| Greetings | 開場白編輯 |
| Plugins | Capability、revision、proposal approve/reject |
| Planner | 世界書規劃與 trigger 模擬 |
| Builds | Preview、Audit、Publish、Exports、Roundtrip |

## 14.2 安全模型

- 只綁 `127.0.0.1`。
- Bootstrap token 5 分鐘、只能使用一次。
- Session 8 小時，只存在 server 記憶體。
- Cookie 為 HttpOnly、SameSite=Strict。
- Mutation 必須有正確 Origin 與 CSRF。
- CSP、frame deny、no-store。
- 不提供任意 shell、任意路徑或任意 URL fetch。

Server 重啟後所有 session 失效。

## 14.3 Plugin 使用者審查

1. UI 顯示 pending proposal。
2. 使用者選 approve/reject。
3. UI 顯示明確確認。
4. Server 發一次性 decision token。
5. Token 綁 project、proposal、revision、decision、workflow、session、nonce、expiry。
6. Approval transaction 內消耗 token。
7. 重放同一 token 會被拒絕。

## 14.4 Dashboard 是輔助工具，不是權威

即使 UI 顯示可以操作，Server 仍會重新驗證：

- Schema。
- Workflow revision。
- Source/manifest raw CAS。
- Gate snapshot。
- Plugin pin。
- Session/CSRF/token。

## 14.5 已知 UI 限制

- 頂部「驗證」「建立預覽」按鈕目前是靜態視覺元件。
- Workflow timeline 可能仍只顯示舊的部分 stages。
- Sources 頁沒有完整 intake/revise/chunk 工作台。
- 沒有獨立 Provenance 頁。
- SSE 主要 invalidates project summary，部分專用 query 可能短暫 stale。
- Resource Editor dry-run 後若再改 draft，舊確認狀態未必立即清除。
- Publish UI 是 Gate approve 與 publish 兩次 HTTP request。

---

# 15. CLI 命令與參數字典

CLI 入口：

```powershell
node packages\cli\dist\index.js [--workspace-root <path>] <command>
```

## 15.1 全域參數

| 參數 | 合法值 | 預設 | 改變後影響 | 風險 |
|---|---|---|---|---|
| `--workspace-root <path>` | Workspace 路徑 | env 或向上尋找 | 指定所有專案與設定根目錄 | 指錯會找不到專案或讀錯設定 |
| `--help` | 無 | 無 | 顯示 help | 無 |
| `--version` | 無 | `0.1.0` | 顯示版本 | Package 版本未必代表資料 schema 版本 |

Stable ID 規則：

```regex
^[a-z0-9]+(?:[._-][a-z0-9]+)*$
```

最長 96 字元。

## 15.2 主命令速查

| 命令 | 作用 | 是否寫入 | 重要參數/風險 |
|---|---|---|---|
| `dashboard` | 啟動本機 Dashboard | 啟動 server | `--no-open` 不顯示 bootstrap token |
| `init` | 建立專案骨架 | 是 | 已存在不覆蓋 |
| `validate` | 載入整份專案並驗證 | 否 | 輸出可能很大 |
| `query` | 讀文件 JSON Pointer | 否 | 只允許 foundation paths |
| `patch` | RFC 6902 patch | dry-run 否、apply 是 | 必須帶 expected revision |
| `diff` | Semantic diff | 否 | 兩檔都要在 allowlist |
| `plan` | Normalize + canonical planner | 否 | 專案無效就停止 |
| `simulate` | 完整 build 後 trigger 模擬 | 否 | conversation 必須在 workspace |
| `compile` | 建 Preview 或 Publish | 是 | `--no-publish` 仍會寫 preview/workflow |
| `audit` | Audit JSON/PNG | 否 | 輸入必須在 workspace |
| `import` | 匯入卡並顯示 IR | 否 | 輸出可能含完整角色內容 |
| `roundtrip` | 匯入後重新輸出比較 loss | 否 | 不建立正式專案 |

## 15.3 `dashboard`

```powershell
card-workspace dashboard [--no-open] [--port <port>]
```

| 參數 | 預設 | 影響 | 風險 |
|---|---|---|---|
| `--no-open` | false | 不自動開 browser | CLI 輸出不含 bootstrap token，新 session 無法登入 |
| `--port <port>` | `0` | 指定 loopback port；0 由 OS 選 | CLI 只先驗非負整數，過大值由底層拒絕 |

需要手動取得完整 bootstrap URL 時，直接執行：

```powershell
node packages\dashboard-server\dist\index.js
```

## 15.4 `init`

```powershell
card-workspace init <project-id> --title <title> [--character <id:name:mode:role>]
```

`mode`：`zhuji` 或 `palette`。

`role`：`primary` 或 `supporting`。

未傳 character 時，以 project ID 建立一名 primary zhuji 角色。

## 15.5 `query`

```powershell
card-workspace query <project-id> <file> [pointer]
```

`pointer` 使用 RFC 6901；空字串代表整份文件。

## 15.6 `patch`

```powershell
card-workspace patch <project-id> <file> `
  --patch <json-or-@file> `
  --expected-revision <sha256:...> `
  (--dry-run | --apply)
```

必要規則：

- `--dry-run` 與 `--apply` 只能選一個。
- Patch 必須是 RFC 6902 array。
- 套用後必須通過正式 schema。
- 禁止改 ID、kind、mode、module、category 等 ownership 欄位。
- Stale revision 不會自動 rebase。

注意：`patch @file` 可讀程序目前目錄下或絕對路徑，不像 Fact commands 一律限制 workspace-relative。

目前 generic patch 與 workflow journal/stale evidence 有已知一致性風險，正式工作流內容修訂應優先走 Creator revision/proposal。

## 15.7 `simulate`

```powershell
card-workspace simulate <project-id> --conversation <workspace-relative-file>
```

Conversation 若為全部元素都是字串的 JSON array，每個元素視為一則訊息；其他內容視為單一訊息。

它會先做完整 build，因此 provenance/audit 失敗也會阻止 trigger 模擬。

## 15.8 `compile`

```powershell
card-workspace compile <project-id> `
  [--no-publish] [--no-png] [--v2-backfill] `
  [--preview-id <id>] [--token-budget <tokens>]
```

| 參數 | 預設 | 實際行為 | 風險 |
|---|---|---|---|
| publish | true | 預設發布既有 approved preview | 必須傳 `--preview-id` |
| `--no-publish` | false | 建立並持久化 preview | 不是純記憶體，會改 workflow |
| png | true | 產生 PNG | 缺 `assets/avatar.png` 會失敗 |
| `--no-png` | false | 不產 PNG | 只影響新 preview |
| `--v2-backfill` | false | 另寫 `chara` metadata/V2 | V3 功能可能有 loss |
| `--preview-id` | 無 | 發布時指定 exact preview | 不可用 stale/superseded preview |
| `--token-budget` | 無 | 新 preview 的 token budget | 發布既有 preview 時不改原選項 |

## 15.9 Source 子命令

### Add

```powershell
card-workspace source add <project-id> <absolute-file> `
  --source-id <id> --title <title> `
  [--tier <tier>] [--format <format>] `
  [--author <author>] [--language <language>] [--actor <actor>]
```

Tier：`official`、`common_fanon`、`single_author_fanon`、`user_original`、`unknown`。

Format：`text`、`markdown`、`chat`、`json`、`yaml`、`character-card`。

限制：絕對單檔、regular file、非 symlink、最大 64 MiB。

### Revise

```powershell
card-workspace source revise <project-id> <source-id> <absolute-file> `
  --expected-revision <current-source-revision> [metadata options]
```

### List / Status / Verify

```powershell
card-workspace source list <project-id>
card-workspace source status <project-id> <source-id>
card-workspace source verify <project-id> [source-id]
```

### Chunk

```powershell
card-workspace source chunk <project-id> <source-id> `
  --expected-revision <source-revision> [--actor <actor>]
```

## 15.10 Fact 子命令

### Submit

```powershell
card-workspace fact submit <project-id> <inline-json-or-@workspace-file> `
  --expected-revision <job-revision> [--actor <actor>]
```

只保存 candidate batch，不等於 accepted Fact。

### Validate

```powershell
card-workspace fact validate <project-id> <batch-id>
```

### Review

```powershell
card-workspace fact review <project-id> <candidate-id> `
  --decision <accepted|rejected|superseded|withdrawn> `
  --decision-id <id> --fact-id <id> --rationale <text> `
  --expected-revision <fact-projection-revision> `
  [--expected-fact-revision <number>] [--patch <json-or-@file>] `
  [--decided-at <timestamp>] [--actor <actor>]
```

### Conflict

```powershell
card-workspace fact conflicts <project-id> [--status <open|resolved>]
card-workspace fact resolve <project-id> <conflict-id> `
  --decision-file <json-or-@workspace-file> `
  --expected-revision <projection-revision> `
  --expected-fact-revisions <json-object-or-@workspace-file>
```

### Query

```powershell
card-workspace fact query <project-id> `
  [--status <status>] [--subject <subject>] [--predicate <predicate>] `
  [--classification <classification>] [--source-id <source-id>] `
  [--gate-status <clear|blocked_unresolved_conflict>]
```

## 15.11 Provenance

```powershell
card-workspace provenance trace <project-id> <fact-or-fragment-id>
card-workspace provenance verify <project-id>
```

`verify` 遇未解衝突可使用 exit code 3，其他驗證錯誤通常為 2。

## 15.12 CLI Exit Codes

| Code | 意思 |
|---:|---|
| 0 | 成功 |
| 2 | 參數、schema、一般 domain 驗證失敗 |
| 3 | conflict、stale、locked、already exists、superseded |
| 4 | 路徑、symlink、越界、安全錯誤 |
| 5 | 未分類內部錯誤 |

---

# 16. 環境變數、Scripts 與設定參數

## 16.1 環境變數

| 變數 | 合法值 | 預設 | 影響 | 風險 |
|---|---|---|---|---|
| `CARD_WORKSPACE_ROOT` | Workspace 路徑 | CLI 可向上尋找；MCP 無預設 | 決定所有設定與 projects 根 | MCP 缺失會啟動失敗 |
| `CARD_WORKSPACE_AGENT_ID` | Registry 中精確 Agent ID | 無 | 綁定 MCP process identity | 錯字回 `MCP_AGENT_UNKNOWN` |
| `CARD_WORKSPACE_DASHBOARD_PORT` | 非負整數 port | `0` | Dashboard server direct entry port | 衝突或非法 port 會啟動失敗 |

## 16.2 Root Package Scripts

| Script | 實際命令 | 作用 | 不包含什麼 |
|---|---|---|---|
| `pnpm build` | `pnpm -r build` | Build 全 workspace | 不建角色卡 |
| `pnpm typecheck` | `pnpm -r typecheck` | TypeScript 檢查 | 不執行測試 |
| `pnpm lint` | `eslint .` | ESLint | 不含 agent cross-file config lint |
| `pnpm test` | `vitest run` | Unit/integration tests | 不含 Playwright |
| `pnpm test:coverage` | Vitest coverage | Coverage + thresholds | 不含 E2E |
| `pnpm test:watch` | Vitest watch | 開發時持續測試 | 不適合 CI |
| `pnpm test:e2e` | Dashboard Playwright | UI E2E | 目前 API 全 mock |
| `pnpm agent-lint` | Workflow agent lint | Agent/config/prompt/skill一致性 | 不取代 TypeScript lint |
| `pnpm dashboard` | CLI dashboard | 啟動本機 Dashboard | 需先 build |
| `pnpm check` | build+lint+typecheck+test | 基本門禁 | 不含 coverage、agent-lint、E2E、audit |

## 16.3 `opencode.jsonc` 重要參數

| 欄位 | 合法值/預設 | 影響 | 修改風險 |
|---|---|---|---|
| `default_agent` | Agent ID | 新 session 預設入口 | 指向不存在 Agent 會退回/失效 |
| `skills.paths` | 路徑陣列 | Skill 探索位置 | 漏路徑會找不到 Skill |
| `permission` | allow/ask/deny 或 pattern rules | OpenCode 工具前置權限 | 最後符合規則生效 |
| `mcp` | MCP config map | Identity-bound processes | env/名稱須與Agent同步 |
| `agent` | Agent config map | mode/prompt/model/steps/permission | 修改後需重啟 |
| `agent.*.mode` | primary/subagent/all | 可直接對話或只委派 | Director 應為 primary |
| `agent.*.steps` | 正整數 | 最大Agent steps | 太低會提早總結，Director目前100 |
| `agent.*.prompt` | 字串/`{file:...}` | System prompt組合 | 漏Skill/Personality會被agent-lint抓到 |

Permission 規則最後一條符合者生效。通常先 `"*":"deny"`，再放明確 allow。

## 16.4 `agent-registry.yaml`

| 欄位 | 合法值 | 影響 | 必須同步 |
|---|---|---|---|
| `id` | stable ID | MCP identity/task assignment | OpenCode key、MCP env、definitions |
| `kind` | stable ID | Agent分類 | Runtime與lint慣例 |
| `agent_file` | Prompt檔名 | Agent契約 | `opencode.jsonc` prompt |
| `skill` | 已存在Skill ID | Agent唯一職責 | Skill目錄與permission |
| `personality` | Personality ID | 語氣與風格 | YAML與prompt引用 |
| `capabilities` | stable ID array | Server端最大能力 | Tool policy/task capabilities |
| `input_contracts` | contract refs | 可接受契約 | schema registry |
| `output_contracts` | contract refs | 可產出契約 | task output_contract |
| `extensions.delegates` | Agent IDs | Director delegation graph | OpenCode task permission |

## 16.5 `tool-policy.yaml`

| 欄位 | 合法值 | 影響 | 風險 |
|---|---|---|---|
| `capability` | stable ID | 哪種能力可用規則 | 必須存在於Agent/task |
| `tools` | 已註冊tool IDs | 允許哪些工具 | 未註冊會lint失敗 |
| `stages` | 21-stage enum | 可用階段 | 漏stage會被拒絕 |
| `mutation` | boolean | 與工具固定mutability對照 | 不可拿來改handler語意 |
| `requires_task` | boolean | 是否要求task/lease | 輸入不含task時設true會永遠不能用 |
| `requires_gate` | facts/blueprint/content/publish | 前置Gate | 必須符合TypeScript invariant |

## 16.6 `workflow-definitions.yaml`

| 欄位 | 合法值 | 影響 | 風險 |
|---|---|---|---|
| `id` | stable ID | Persisted definition ID | 改名需資料遷移 |
| `entry_kind` | 四種entry | 流程入口 | 不可重複 |
| `stages` | stage array | 推進順序 | 必須同步schema/runtime |
| `required_gates` | gate array | 哪些Gate必要 | 未列者會not_required |
| `tasks[].agent_kind` | Registry Agent kind | Assigned agent | 實務上通常等於Agent ID |
| `tasks[].capabilities` | capability array | Task授權 | 必須和Agent/policy交集 |
| `tasks[].output_contract` | 已註冊contract | 提交資料格式 | Creator與Critic不可混用 |
| `tasks[].max_attempts` | 正整數 | Task失敗上限 | 不等於自動revision兩輪限制 |

部分 Blueprint 後 Tasks 仍由 `packages/workflow/src/runtime.ts` 動態建立，不只由 YAML 決定。

---

# 17. 核心 Schema 欄位

## 17.1 共通規則

- 多數物件是 `.strict()`；拼錯欄位會直接失敗。
- 可擴充資料放 `extensions: {}`。
- Stable ID：小寫英數，以 `. _ -` 分隔，最長96。
- Revision：`sha256:<64個小寫hex>`。
- `schema_version`、ID、kind、mode、module、category 通常不可patch。

## 17.2 `project.yaml`

| 欄位 | 合法值/用途 | 影響 | 風險 |
|---|---|---|---|
| `schema_version` | `1` | Manifest版本 | 不可patch |
| `id` | stable ID | 專案身分/目錄 | 不可patch |
| `title` | 字串 | UI顯示 | 可一般修改 |
| `kind` | `character_card`/`worldbook` | 完整schema/compile路徑 | 不可直接切換 |
| `characters` | 角色陣列 | 應有目錄/模組 | 增刪應走受控流程 |
| `card.avatar` | workspace-relative path | PNG輸出 | 缺檔會build失敗 |
| `output.json/png/v2_backfill` | boolean | 預設輸出 | Preview另可鎖定options |
| `policies.strict_publish` | boolean | Publish嚴格度 | 放寬不會忽略normative errors |
| `plugins` | approved IDs | Active Plugins | 只能由Plugin approval交易改 |

## 17.3 `blueprint.yaml`

重要欄位：

- `project_id`、`project_kind`、`entry_kind`。
- `collaboration_mode`。
- `purpose`。
- `characters[]`：ID、名稱、mode、core concept、fact refs。
- `world`：enabled、timing、categories、scope、token budget。
- `greetings`：enabled、character IDs、requirements。
- `relationships`：enabled、character IDs、requirements。
- `plugins[]`：plugin ID、capabilities、template ID。
- `fact_refs`、`unresolved_decisions`、`approved_revision`。

Blueprint 改變會影響 Tasks、reviews、Gates、Preview 與 Publish。

## 17.4 `workflow.json`

```text
schema_version: 2
project_id
workflow_definition_id
entry_kind
stage
revision
artifacts[]
gates[]
tasks[]
decisions[]
outcome?
journal_revision?
extensions
```

只能由 Workflow Engine 修改。

## 17.5 Character

`character.yaml` 重要欄位：

- `id`、`display_name`、`aliases`、`summary`。
- `relationships`。
- `sections`。
- `provenance`。
- `extensions`。

`id`/`display_name` 必須與 manifest 一致。

## 17.6 World

重要欄位：

- `id`、`category`、`title`、`content`。
- `aliases`、`related_ids`、`sections`。
- `compile`：activation、placement、recursion、priority、token budget。
- `provenance`。

`category` 必須與目錄一致。

## 17.7 Greetings

- `greetings[]` 至少一筆。
- 必須恰好一筆 `primary`。
- `kind`：`primary`、`alternate`、`group_only`。
- 每筆至少一名有效 `character_id`。
- 珠璣 `self_introduction` 不是 greeting。

## 17.8 Relationships

- 只適用 character card、至少兩名角色、Blueprint 明確啟用。
- `team_code` 由 Engine 產生，修訂不可改。
- `perspectives` 是完整方向矩陣，A→B 與 B→A 不相同。
- 目前沒有通用 Dashboard editor，視為受控文件。

## 17.9 Plugin Source

共通：

```text
schema_version
project_kind: character_card
plugin_id
implementation:
  version
  digest
  asset_manifest_id
  asset_manifest_revision
  asset_manifest_hash
template_id?
```

實作 pin 必須 exact match official registry，不允許自動 fall-forward。

---

# 18. 重要公開 API 函式參數

此節只列會影響行為、寫入或安全邊界的公開 API，不逐一列內部小 helper。

## 18.1 Project APIs

| 函式 | 重要參數 | 回傳/副作用 | 主要風險 |
|---|---|---|---|
| `initializeProject()` | `projectsRoot`, `manifest`, `entryKind`, decisions/world/relationships | 交易式建立專案 | 已存在、schema、路徑、交易衝突 |
| `loadAuthorProject()` | `projectsRoot`, `projectId` | 完整唯讀快照與diagnostics | 呼叫端必須檢查`ok` |
| `patchProjectFile()` | `projectRoot`, `relativePath`, operations, expectedRevision, dryRun | dry-run或交易寫入 | ownership、stale、journal一致性缺口 |
| `runFileTransaction()` | `root`, operations, expectations, lockRoots, beforePublish | 原子多檔寫入 | lock、symlink、raw CAS、recovery |
| `publishForgeArtifacts()` | project/exports roots、build/export files、source revisions | 寫`.build`與exports | 任一source drift即全部拒絕 |
| `savePluginTemplateIdempotent()` | manifest、payload、expected raw revisions | created/unchanged/replaced | identity/hash/CAS不符 |

## 18.2 Ingestion APIs

| 函式 | 重要參數 | 副作用 | 主要風險 |
|---|---|---|---|
| `intakeLocalSource()` | projectRoot、sourceId、title、absolute path、tier/format | snapshot/revision/projection/manifest/journal | 64MiB、symlink、TOCTOU |
| `intakeRetrievedSource()` | bytes、requested/canonical URL、fetchedAt | 同上 | URL與SSRF由上游controlled fetch保護 |
| `createChunkSet()` | projection、profile | 無 | tokenizer/profile決定determinism |
| `storeChunkSet()` | projectRoot、artifacts、actor/time | 寫immutable chunks/manifest | identity/hash mismatch |
| `claimChunkTask()` | expected job revision、owner、lease | 更新job | stale/expired lease |
| `submitCandidateBatch()` | batch、expected job revision | 寫immutable candidate | evidence/job/source mismatch |
| `reviewCandidate()` | decision、expected projection/fact revisions | journal+facts/conflicts交易 | stale、candidate非active |
| `resolveConflict()` | decision、expected projection及每個fact revision | 更新facts/conflicts | 漏任何受影響fact revision |

## 18.3 Workflow APIs

| 函式 | 重要參數 | 副作用 | 主要風險 |
|---|---|---|---|
| `startConfiguredWorkflow()` | state、definition、intake decisions、artifacts、time | 純函式 | 缺訪談/入口必要資料 |
| `advanceConfiguredWorkflow()` | state、definition、Blueprint、project kind | 純函式 | 未完成task/gate、不可跳stage |
| `commitWorkflowMutation()` | expected revision、event ID、actor/time、update、operations | journal+projection+domain files原子寫 | revision必須恰好+1 |
| `claimTask()` | task ID、owner、lease ID/duration | 純函式，需commit | dependency/attempt/lease |
| `decideGate()` | gate/action/user actor/exact revisions/findings | 純函式，需commit | Director不可決策、snapshot mismatch |
| `applyProposal()` | task/proposal/event/time/expected artifact revisions | 作者檔+result+workflow交易 | owner、contract、provenance、raw CAS |
| `createCompilePreview()` | project、preview ID、expected workflow revision、build options | preview+workflow | Content Gate或plugin evidence stale |
| `publishApprovedPreview()` | project、preview ID、expected workflow revision | 重build並原子publish | hashes/input/Gate不符 |
| `beginPluginRevision()` | desired selections、server pins、expected state | intent+tasks | closure/pin/source selection不一致 |
| `submitPluginProposal()` | task/lease/proposal/expected revision | pending result+workflow | owner/task/hash/CAS |
| `decidePluginProposal()` | opaque token、session、proposal、decision | 原子approval/reject | token expiry/replay/source/manifest drift |

## 18.4 Compiler/Adapter APIs

| 函式 | 重要參數 | 回傳 | 主要風險 |
|---|---|---|---|
| `buildProject()` | workspaceRoot、projectId、strict、budget、json/png/v2、expected input/hashes | IR、reports、artifacts、PublishPlan | `publish:true`拒絕、provenance/audit/avatar/plugin stale |
| `simulateTokens()` | project、tokenizer、budget | token report | budget必須正整數 |
| `simulateTriggers()` | project、messages、profile、scan depth、generation type | trigger report | regex diagnostic、profile差異 |
| `emitCharacterCardV3()` | canonical project、plugin contributions | CCv3 card | 缺primary greeting、managed collision |
| `writeCardToPng()` | input PNG、V3 card、optional V2 | 新PNG Buffer | PNG/card/V2無效 |
| `readCardFromPng()` | PNG bytes | validated card | metadata/CRC/base64/UTF-8/schema錯誤 |

## 18.5 Plugin APIs

| 函式 | 重要參數 | 回傳 | 主要風險 |
|---|---|---|---|
| `generateActivePluginContributions()` | typed sources、greeting IDs、MVU registry、implementation registry | ordered contributions | duplicate/dependency/pin錯誤 |
| `resolvePluginSelectionDependencies()` | selections/capabilities | dependency closure | 必須與Workflow/Dashboard共用 |
| `materializePluginTemplate()` | manifest、payload、typed overrides | resolved source+hashes | pointer/type/pin/hash不符 |
| `compileMvuSource()` | typed MVU source | schema/entries/regex/metadata | official asset pin、constraints |
| `compileEjsSource()` | typed EJS source、MVU path registry | entries/metadata | 缺MVU、path、overlap/gap/raw delimiter |
| `compileHtmlSource()` | typed HTML source、MVU registry/greeting IDs | markup/CSS/runtime/regex | policy、binding、greeting context |

## 18.6 Server APIs

| 函式 | 重要參數 | 副作用 | 主要風險 |
|---|---|---|---|
| `createMcpServer()` | environment、optional web research deps | 載入config並註冊可見tools | env/Agent/config錯誤 |
| `authorizeTool()` | agent/tool/config/workflow/task/lease/time | authorization grant | 任一交集不符即拒絕 |
| `startDashboard()` | workspaceRoot、port、logger | 綁127.0.0.1 server | 呼叫端需關閉app |
| `createDashboardServer()` | context、bootstrap token、logger、clientDist | 建Fastify app/session/SSE | 不可對外網路暴露 |

---

# 19. Git、GitHub 與本機資料保護

## 19.1 Repository 現況

```text
Branch: main
Remote: origin
URL: https://github.com/CHANG-JUI-YU/CRAD-workspace.git
Initial commit: a0a7976
```

## 19.2 Git 不追蹤什麼

`.gitignore` 會排除：

- `projects/`
- `reference/`
- `.transactions/`
- `.legacy-v1/`
- `node_modules/`
- `dist/`
- `coverage/`
- `*.tsbuildinfo`
- `test-results/`
- `playwright-report/`
- 大部分 `exports/`

這表示：

- Push 程式碼不會上傳角色卡內容。
- Clone 不會下載任何角色卡內容。
- `git status` clean 不代表 local project 沒有變更。
- 重要角色卡資料需要獨立備份。

## 19.3 建議日常 Git 流程

```powershell
git status
git diff
git add <明確檔案>
git diff --cached
git commit -m "描述變更"
git push
```

不要直接 `git add .` 後不檢查內容。

不要使用：

```powershell
git reset --hard
git clean -fdx
git push --force
```

除非非常清楚影響並已備份。

## 19.4 角色卡資料備份

建議定期把以下目錄備份到非Git位置：

```text
projects/
reference/
exports/
```

備份時應保留完整專案目錄，不要只備份作者YAML，因為 workflow journal、source snapshots、facts decisions 與 plugin artifacts 都是恢復必要資料。

---

# 20. 測試、Coverage、E2E 與 CI

## 20.1 測試層次

| 層次 | 命令 | 驗證什麼 |
|---|---|---|
| Build | `pnpm build` | 所有package可編譯 |
| Typecheck | `pnpm typecheck` | TypeScript型別 |
| Lint | `pnpm lint` | 程式規則 |
| Unit/Integration | `pnpm test` | Domain與server整合 |
| Agent lint | `pnpm agent-lint` | Agent/config/prompt/skill一致性 |
| Coverage | `pnpm test:coverage` | 覆蓋率門檻 |
| Dashboard E2E | `pnpm test:e2e` | Browser UI journey |
| Audit | `pnpm audit --prod --audit-level high` | Production dependency漏洞 |

## 20.2 Coverage 門檻

| 指標 | 門檻 |
|---|---:|
| Statements | 85% |
| Lines | 85% |
| Functions | 85% |
| Branches | 80% |

本機 `coverage/` 可能是舊報告，而且被Git忽略。不要把舊日期的報告當目前HEAD證據。

## 20.3 最新書面測試快照

Optional Plugins implementation plan 最近記錄約：

```text
80 test files
616 tests
```

這個數字是實作期間的書面快照，不是本次撰寫交接文件重新執行的結果。接手者應自行跑完整門禁確認目前HEAD。

## 20.4 Playwright 的限制

目前 `apps/dashboard/e2e/workbench.spec.ts` 攔截並 mock `/api/**`。

它驗證：

- React UI journey。
- Viewports。
- UI revision conflict呈現。

它沒有驗證：

- 真 Fastify server。
- 真 session/cookie/CSRF。
- 真 filesystem/transactions。
- 真 preview/publish。

不要稱它為完整 browser-to-filesystem E2E。

安裝 Chromium：

```powershell
npx --yes pnpm@10.34.5 --filter @card-workspace/dashboard exec playwright install chromium
```

## 20.5 CI 已知問題

GitHub Actions 檔案：

```text
.github/workflows/ci.yml
.github/workflows/quality.yml
```

截至首個 push 的已知風險：

- `ci.yml` 可能在安裝 pnpm 前就要求 `setup-node` 使用 pnpm cache。
- `quality.yml` 在root執行Playwright install，但Playwright屬Dashboard workspace。

建議修正後重新確認GitHub Actions，而不是只依賴歷史run狀態。

---

# 21. 修改同步矩陣

| 要修改什麼 | 主要檔案 | 還必須同步 |
|---|---|---|
| Schema/contract | `packages/schemas/src` | exports、schema registry、loader、compiler、MCP/Dashboard types、tests |
| 珠璣模組 | `schemas/zhuji.ts`、`project/author-layout.ts` | normalize、provenance、Creator references/fixtures、tests |
| Workflow stage/task/gate | workflow definitions + `packages/workflow/src` | workflow schemas、runtime、MCP、policy、Director prompt、tests |
| Agent/capability/tool | agent registry | tool policy、personality、Skill、Prompt、OpenCode MCP/permission、tool registry、agent-lint |
| Sources/Facts | `packages/ingestion/src` | schemas、ownership、transactions、CLI、MCP、Dashboard、provenance tests、docs |
| Dashboard API/UI | schemas/dashboard、dashboard-server、dashboard app | frontend types、component tests、Playwright mocks |
| Compiler/CCv3/PNG | compiler、adapters | schemas/IR、audit、workflow preview/publish、CLI/server、roundtrip tests、外部驗收 |
| Plugins | plugins package | schemas、compiler、adapter、workflow lifecycle、MCP、Dashboard、6 plugin agents、pin tests |
| CLI | `packages/cli/src/program.ts` | CLI tests、README/HANDOFF commands、build |
| Dependency/CI | package.json、lockfile、workflow YAML | frozen install、Node/pnpm docs、audit、Playwright install |

## 21.1 新增或改名 Agent

至少同步：

1. `.opencode/prompts/<agent>.md`
2. `.agents/skills/<skill>/SKILL.md`
3. `workflow/personalities/<personality>.yaml`
4. `workflow/agent-registry.yaml`
5. `workflow/tool-policy.yaml`
6. `workflow/workflow-definitions.yaml` 或 runtime task materialization
7. `packages/mcp-server/src/tool-registry.ts`（若新增tool）
8. `packages/workflow/src/agent-lint.ts`
9. `opencode.jsonc` Agent/MCP/env/permission/task/skill/prompt
10. Tests
11. Build 後完整重啟 OpenCode

不要直接改已被現存 workflow/task/journal 引用的 Agent ID；那需要資料遷移。

---

# 22. 常見錯誤與恢復方法

| 症狀/錯誤 | 原因 | 正確恢復 |
|---|---|---|
| `ERR_PNPM_UNSUPPORTED_ENGINE` | Node不是20.17–20.x | 切換Node 20 |
| 找不到`dist/index.js` | Fresh clone未build | `pnpm build`後重啟OpenCode |
| `REVISION_CONFLICT` | 文件已被別人改動 | 重讀最新revision，重新dry-run |
| `WORKFLOW_REVISION_CONFLICT` | Workflow已推進 | 重新讀workflow，不要硬改revision |
| `TASK_LEASE_EXPIRED` | Lease過期 | 依workflow_status重新claim |
| `TASK_LEASE_MISMATCH` | 用錯lease/owner | 使用後端回傳exact task/lease |
| `TRANSACTION_LOCKED` | 另一程序仍持鎖 | 等待或正常停止owner，不手刪lock |
| `TRANSACTION_JOURNAL_MALFORMED` | 交易journal損壞 | 停止寫入、保留現場、從備份/專業診斷恢復 |
| `WORKFLOW_PROJECTION_DIVERGED` | workflow.json與journal不一致 | journal合法時受控rebuild，不手改workflow.json |
| Fact projection不一致 | Projection與decision journal不符 | 先verify；immutable資料完整才rebuild |
| `TOOL_CAPABILITY_DENIED` | Agent/stage/task/lease/gate任一不符 | 核對授權交集，不放寬OpenCode繞過 |
| `MCP_WORKSPACE_ROOT_REQUIRED` | 缺workspace env | 核對opencode MCP env後重啟 |
| `MCP_AGENT_UNKNOWN` | Agent ID與registry不符 | 同步registry/env後重啟 |
| Dashboard bootstrap失敗 | token已用/過期/server重啟 | 使用新server產生的新exact URL |
| CSRF/Origin錯誤 | URL/Host/Token不一致 | 使用`127.0.0.1`原始URL，不改localhost |
| `BUILD_PREVIEW_INPUT_STALE` | 內容或plugin已改 | 重建Preview，重新批准Publish Gate |
| `PUBLISH_PREVIEW_NOT_APPROVED` | Preview未被使用者批准 | 在Dashboard批准exact preview |
| PNG缺avatar | `assets/avatar.png`不存在 | 補avatar或使用`--no-png` |
| Plugin pin錯誤 | Source version/digest/asset pin不在registry | 使用server提供exact pin或explicit migration |
| Plugin token replay | Token已消耗或綁定不同revision | 重新從Dashboard取得一次性token |
| Task attempts耗盡 | 重複失敗 | Director走recovery；修底層後才repair resume |

---

# 23. 已知缺口與優先級

以下不是「一定全部壞掉」，而是尚未完成或有明確風險、接手者應優先驗證的事項。

## P0：優先處理

### 23.1 修復並重新驗證 CI

- 確保 pnpm 在 `setup-node cache: pnpm` 前已可用。
- Playwright install 使用 Dashboard workspace filter。
- 修復後確認 GitHub Actions 真正執行 build/test/coverage/E2E/audit。

### 23.2 Generic Patch 與 Workflow journal/stale evidence 一致性

`patchProjectFile()` 可能直接增加 `workflow.json.revision`，但未走完整 `commitWorkflowMutation()` journal/artifact stale 流程。

風險：

- Projection/journal 分歧。
- 舊 Content/Publish approval 錯誤沿用。
- 舊 artifact revision 未失效。

正式工作流內的內容修訂先走 Creator revision/proposal，不要依賴 generic patch。

### 23.3 Dashboard Facts Gate readiness 一致性

需要確認 Dashboard Facts Gate 是否與 MCP 的 server-derived readiness 完全一致，包括：

- 未審 candidate。
- Open conflicts。
- Quality diagnostics。
- Character coverage。
- Fact projection verification。

### 23.4 Dashboard route project ID/path 安全

部分 Sources/Facts/Provenance/Build routes 曾直接 `path.join(projectsRoot, project_id)`。應統一使用 stable ID 與安全project resolver，補 traversal tests。

## P1：重要但可排在P0後

### 23.5 真 browser-to-filesystem E2E

新增真正啟動 Dashboard server、bootstrap session、CSRF、temporary filesystem、preview/publish 的 Playwright E2E。

### 23.6 Fresh clone 空 projects Dashboard

`projects/`被Git忽略。需要確認沒有任何project時，Dashboard project list能正常回空陣列，不因`ENOENT`失敗。

### 23.7 Relationships 編輯與修訂 UX

目前 Relationship Creator proposal可產生文件，但通用Dashboard resource editor沒有relationships類型。

### 23.8 Dashboard 21-stage timeline

UI應從server vocabulary/definition產生，而不是硬編舊十階段。

### 23.9 `mode_conversion`完整入口

Conversion library存在，但通用workflow entry仍回`WORKFLOW_ENTRY_NOT_IMPLEMENTED`。

### 23.10 真實 SillyTavern 驗收

需在固定版本SillyTavern驗證：

- CCv3 JSON。
- 只有`ccv3`的PNG。
- `ccv3+chara` PNG。
- MVU runtime。
- EJS。
- HTML status/message/greeting功能。

## P2：維護品質與文件

### 23.11 Plugin Template層級差異

設計曾描述workspace-level template；實作是project-local。需決定並統一。

### 23.12 Dashboard UX細節

- 頂部靜態按鈕。
- SSE query invalidation範圍。
- Resource Editor dry-run/draft綁定。
- Source/Provenance完整工作台。
- Gate rejection進階路由。

### 23.13 文件整理

更新README與architecture docs，避免繼續寫十個Agent、舊stage、舊Facts路徑或把mock E2E當完整E2E。

### 23.14 Repository治理文件

目前缺少或需確認：

- LICENSE。
- CONTRIBUTING。
- SECURITY。
- CODEOWNERS。
- CHANGELOG。
- Node version pin檔。

---

# 24. 文件權威與過時文件

## 24.1 查資料的優先順序

1. TypeScript schemas、runtime、tests。
2. `workflow/` 三份現行 YAML。
3. `opencode.jsonc`。
4. 現行 architecture docs。
5. 本 `HANDOFF.md`。
6. 日期化 plans/specs，只作歷史決策參考。

## 24.2 文件狀態

| 文件 | 狀態 | 注意 |
|---|---|---|
| `HANDOFF.md` | 現行總交接 | 仍應以程式碼為最終權威 |
| `README.md` | 部分可信 | Agent數量與compile描述部分過時 |
| `docs/architecture/project-transactions.md` | 高可信 | Transaction模型主要參考 |
| `docs/architecture/sources-facts.md` | 核心可信 | 「Agent/MCP下一階段」已過時 |
| `docs/architecture/agents-workflow.md` | 核心概念可信 | Agent清單/數量過時 |
| `docs/architecture/dashboard.md` | 安全模型可信 | stage/view/E2E描述不完整 |
| `HANDOFF-2026-07-15.md` | 歷史 | 非Git、steps30、353 tests等已過時 |
| `CONTEXT.md` | 歷史語彙 | imported-base、可手改Facts、舊world路徑不適用 |
| `docs/SillyTavern-V3-Workflow-Architecture.md` | Legacy v1 | drafts/st-forge/舊八階段，不作vNext指南 |
| `docs/superpowers/plans/**` | 歷史計畫 | 不是runtime contract |
| `docs/superpowers/specs/**` | 設計決策紀錄 | 若與實作不同，以實作為準 |

---

# 25. 新手 Day 1 與 Week 1 清單

## Day 1：先做到可以安全開發

- [ ] 安裝 Node 20 與 pnpm 10.34.5。
- [ ] Clone正確的`CRAD-workspace` repository。
- [ ] `pnpm install --frozen-lockfile`。
- [ ] `pnpm build`。
- [ ] 建立一個`demo` local project。
- [ ] 啟動Dashboard並理解bootstrap/session流程。
- [ ] 從workspace root啟動OpenCode。
- [ ] 閱讀本文件第3、7、8、10節。
- [ ] 確認知道哪些檔案絕對不能手改。
- [ ] 執行`pnpm check`與`pnpm agent-lint`。

## Day 2–3：理解系統資料流

- [ ] 從`packages/compiler/src/build.ts`追一次完整build。
- [ ] 從`packages/workflow/src/runtime.ts`理解stage/task物化。
- [ ] 從`packages/project/src/transaction.ts`理解原子交易。
- [ ] 從`packages/ingestion/src`追一次Source→Candidate→Fact。
- [ ] 從`packages/workflow/src/preview.ts`理解Preview與Publish。
- [ ] 用temporary fixture測試，不碰真實projects。

## Week 1：可以開始維護

- [ ] 修復/確認CI可完整執行。
- [ ] 為第一個小修改先寫或更新測試。
- [ ] 使用明確檔案`git add`，檢查staged diff再commit。
- [ ] 任何Agent/config修改後跑`agent-lint`。
- [ ] 任何schema修改後跑下游packages與完整test。
- [ ] 任何Workflow修改後補MCP/Dashboard/Runtime整合測試。
- [ ] 任何Compiler/PNG修改後補roundtrip與Publish CAS測試。
- [ ] 不把local projects提交到Git。
- [ ] 不使用`git clean -fdx`。

---

# 附錄 A：常用命令

```powershell
# 安裝
npx --yes pnpm@10.34.5 install --frozen-lockfile

# Build
npx --yes pnpm@10.34.5 build

# 基本門禁
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 agent-lint

# 完整測試
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 test:e2e

# Dashboard
npx --yes pnpm@10.34.5 dashboard

# 初始化專案
node packages\cli\dist\index.js init demo --title "Demo Character"

# 驗證專案
node packages\cli\dist\index.js validate demo

# 建立Preview，不正式發布，但會更新workflow
node packages\cli\dist\index.js compile demo --no-publish --no-png

# Git
git status
git diff
git log --oneline -10
```

# 附錄 B：關鍵檔案索引

```text
README.md
HANDOFF.md
package.json
pnpm-workspace.yaml
opencode.jsonc
workflow/agent-registry.yaml
workflow/tool-policy.yaml
workflow/workflow-definitions.yaml
packages/schemas/src/schema-registry.ts
packages/project/src/load-author-project.ts
packages/project/src/transaction.ts
packages/ingestion/src/intake.ts
packages/ingestion/src/review.ts
packages/compiler/src/build.ts
packages/workflow/src/runtime.ts
packages/workflow/src/repository.ts
packages/workflow/src/preview.ts
packages/workflow/src/plugin-lifecycle.ts
packages/mcp-server/src/authorization.ts
packages/mcp-server/src/tool-registry.ts
packages/dashboard-server/src/server.ts
apps/dashboard/src/app/Workbench.tsx
```

---

如果只記得三件事，請記得：

1. **不要手改受控檔案。**
2. **遇到 revision conflict 就重讀，不要強制覆蓋。**
3. **角色卡資料不在 Git，必須另外備份。**
