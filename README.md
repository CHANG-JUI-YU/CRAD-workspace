# ST Workspace v3

獨立重建的 intent-first 角色卡創作與發布平台：以訪談收集意圖、以 Blueprint 約束
工作範圍、以嚴格 schema 驗證產物、以單一 publish gate 把關發布、以 Tavern 相容
CCv3 JSON／PNG 作為最終輸出。

## 結構化合約

所有遷移的 Agent／Skill 輸出都使用 `packages/core/src/templates.ts` 的共享合約
註冊表。先以 `workspace_template_context({ kind })` 讀取固定指南、範例與 JSON
Schema，再以 `workspace_template_submit({ kind, ...value })` 提交；runtime 負責
產生持久化細節並在儲存前驗證 proposal。完整對應記錄在
`docs/migration/skill-contract-map.md`。

## Compiler 與發布輸出

建置路徑是真正的 compiler 管線，而非 artifact 傾印：

- `@st-workspace/compiler` 把 V3 artifacts 與已接受 facts 正規化成確定性專案。
- `@st-workspace/adapters-ccv3` 產出 schema 合法的 CCv3 JSON 與受管理的 Plugin 貢獻。
- `@st-workspace/adapters-png` 以 CRC 驗證寫入／讀取 PNG `ccv3`／`chara` metadata chunk。
- `@st-workspace/plugins` 從 Plugin proposal 產生型別化的 MVU、EJS 與 HTML 貢獻。

檔案型專案發布後，`exports/` 只保留最新使用者面向輸出（
`exports/<專案>-角色卡.json` 或 `exports/<專案>-珠璣角色卡.json` 等，依選定模式
命名）與對應 PNG，以單一 publish transaction 提交；
`.workspace/plugin-build-trace.json` 保持內部。JSON 是 Tavern 可載入的 CCv3
envelope，PNG 內含 `ccv3` metadata 與 `chara` V2 backfill。Blueprint、artifacts、
facts 與 workflow 狀態留在語意化資料夾。物化失敗時保留前一版輸出。

打包前的 mode 決策先於 gate：同時有珠璣與調色盤模組時，每次打包前都詢問模式；
選定模式後以該模式重算 manifest（exact plan）再跑 publish gate，gate 用同一份
plan 驗證與 compile。

### Workflow gate 與可編輯發布

正式專案跑單一 publish gate：阻擋未解決的訪談或 blueprint precheck、跨 artifact
引用缺失、來源 provenance 缺失、fact review quorum 不足、未審查的目前 revision
與有效 blocking issue。Draft authoring 保持開放，未完成的工作可先 preview 修正。
成功 publish 是不可變快照；發布後的 authoring 建立新 draft revision，並在下次
publish 成功前保留舊 publish／exports。

來源研究把 candidate domain policy 與專案保存在一起。擷取拒絕 policy 外的
candidate，若無法吸收已識別的官方 candidate 則回報
`SOURCE_RESEARCH_OFFICIAL_REQUIRED`。Fact-review passes 逐 fact 保存供
reviewer 1/2/3 稽核。相同事實的第二個來源證據會合併進既有 fact 並遞增
fact revision（佐證不丟棄）。

可用 kinds 包含 `character`、`zhuji`、`palette`、`wardrobe`、`greetings`、
`relationships`、`world`、`conversion`、`import_analysis`、`review`、
`source_research`、`fact_curation`、`fact_review`、`plugin` 與
`director_routing`。Artifact key 使用可逆 escape（非字母數字以 `_HHHH` 表示），
world／relationships 以 document_id 為穩定身分，不因第一條 entry 或顯示名稱變動。

## 背景 worker 與 operation 管理

本機 server 自動啟動 `WorkspaceWorker`：恢復持久化的 `created`、`resolving` 與
`running` operation、重試可恢復失敗、把 `needs_input` operation 留給使用者回答。
worker 以 lease／3 週期續租；任何副作用 commit 都受 lease token 保護，失去 lease
立即安靜停止。`GET /workspace/health` 回傳含 `status: "ready"` 與 worker 狀態的
健康回應。server 關閉時 worker 自動停止。

Operation 管理是狀態感知的：terminal operation 沒有動作；`needs_input` 顯示問題
與回答入口；`running` 顯示 lease owner、剩餘時間與 progress；`failed` 依 error
class 區分「可安全重試／需人工重送」；取消是 CAS transition，已完成的 operation
不會被改壞；destructive action 都要二次確認。

## 專案資料夾與訪談

server 啟動時不自動建立任何專案資料夾。首頁提供「建立新專案／開啟既有專案／
舊卡審核」三個入口；只有確認要新專案時才配置 `project-###` 目錄。既有專案流程
（繼續專案、既有專案補世界、擴充既有角色卡）**先選目標專案再訪談**：目標值答出
後立即切換到目標 repository，其後的題目、Blueprint precheck 與合併全部落在目標
專案；找不到目標時流程中止並回 needs_input，placeholder 不留任何產物。

訪談把專案名稱延後到概念明確後才問，相關時問世界與多角色關係問題，最後呈現
mode-neutral Blueprint 方向選擇。方向可選、重新產生、混合或以自然語言修改；
它不會直接變成珠璣或調色盤模組。珠璣 `self_introduction` 的 30 字元規則只由
正式珠璣模組強制，不在訪談階段。

專案完成命名後資料夾安全改名（碰撞時加數字後綴），attachment store 動態追蹤
repository 的目前路徑，改名後續租與恢復不會寫入舊位置。既有專案可經
`workspace_projects`／`workspace_project_select` 列出與選擇；在 OpenCode 中由
Director 以原生 `question` 選單呈現。

角色 Blueprint 與珠璣或調色盤設定就緒後，Director 預設把跨模式 wardrobe 任務
路由給 `wardrobe-creator`。任務可用自然語言跳過、延後或修改，不必重複訪談。

每個產出檔案都留在自己的專案資料夾內：

```text
projects/<name>/
├─ .workspace/       interview、workflow 與 audit 狀態
├─ sources/          來源 manifest
├─ knowledge/        knowledge chunks
├─ facts/            fact 與 issue 註冊表
├─ characters/
│  └─ <character-folder>/
│     ├─ character.json
│     ├─ zhuji/
│     ├─ palette/
│     └─ wardrobe/wardrobe.md
├─ blueprint/blueprint.json
├─ relationships/relationships.json
├─ world/<world-artifact>.json
├─ greetings/greetings.json
├─ plugins/
└─ exports/          最新最終 JSON 與 PNG
```

公開內容樹不建立 `proposals/`；proposal revision 與流程型 artifact 留在
`.workspace/`。讀取舊專案時，舊 root state、`proposals/` 與中間 exports 會先
完整移入 `.workspace/legacy-layout/` 備份，再物化到上述語意路徑。修復工具會先
產生 exact plan（source／target／原因／可回復性與 plan hash），執行時驗證 plan
hash 未過期，逐檔回報 archived／skipped／missing，不把正式 exports 當 legacy。

舊工作區只作唯讀參考，不在本專案的 runtime dependency graph 內，也不會被新
runtime 修改。

## 已完成的核心能力

- `workspace.request(request)`／`workspace.status()` 高階契約；Agent 不需傳
  project ID、revision、capability、stage、steps、file path 或 bytes。
- strict schema、CAS revision、atomic file commit、audit 與失敗後可恢復的 operation；
  idempotency key 去重；lease 續租與單一執行者保證。
- 來源搜尋候選、受控 HTTPS fetch（SSRF／timeout／記憶體防護）、附件 fallback、
  UTF-8/BOM/換行正規化、partial recovery。
- knowledge chunks、facts、evidence/provenance、refresh 與佐證合併；character、
  relationship、world lore、greeting、Blueprint、珠璣、調色盤、跨模式 wardrobe
  與 plugin artifact revision。
- review、self-review 阻擋、effective severity、quality profile 與 per-code
  quality override、issue re-evaluation。
- Blueprint precheck：逐項 user_confirmed 確認、intake value 更新、合併進既有
  Blueprint（character expansion）；precheck Dashboard 顯示唯一 active check 與
  唯讀歷史矩陣。
- 事實審查板：建立 Review Run、逐 fact 裁決（接受／拒絕／需補證據）、Director
  conflict resolution、typed endpoints。
- deterministic preview/build、blocking issue 驗證、transactional publish、
  publish hash receipt；build preview 顯示 exact package plan（卡名、primary、
  選定模式、greeting 組數、世界書、plugin、輸出路徑）。
- 圖片管理：roster dropdown 綁定、primary badge、crop preview、缺圖 build
  warning、發布後圖片變更 stale banner。
- Repair plan 工具：exact plan hash、逐檔歸檔報告、可回復性說明。
- Tavern verifier：結構化 PASS／WARN／FAIL checks（JSON hash、CCv3 schema、
  worldbook、greetings、plugin、PNG hash／尺寸／內嵌卡解析與比對）。
- JSON card dry-run/import/conversion（含 YAML 完整解析：quoted hash、block
  scalar、list-of-map 續行）；未知欄位保留並列入 report；first_mes／alternate／
  group greetings 與 character_book 轉成正式 artifact。
- 結構化錯誤契約：server 回傳 `{code, category, recoverable, message_zh, impact,
  next_actions}`，HTTP 400/500 與 MCP -32602/-32603 依 recoverable 分類，不靠
  prefix regex；外部 host 無 auth token 拒絕啟動，Dashboard 支援 token bootstrap。
- CLI、REST、MCP 與 Dashboard 共用同一個 runtime；Dashboard、`workspace_agents`
  與 CLI `agents` 都會明確列出 Director 及所有可用 Agent，Director 是預設路由，
  也可被指定。
- 所有 Agent/Skill 都有固定結構化合約：core Zod Schema → MCP
  `workspace_template_submit` JSON Schema → `workspace_template_context` 的指南
  與既有實例 → 對應 Agent/Skill 寫作規則。珠璣七模組仍保留 `workspace_zhuji_*`
  相容入口。

## Agent / Skill / Personality

- `.agents/agents`：21 份高階 Agent prompt；registry 的 23 個 Agent ID 由
  `.agents/registry.yaml` 與 `.agents/aliases.yaml` 保留。
- `.agents/personalities`：23 份 personality YAML 原樣保留；Agent prompt 只引用
  人格，不複製人格內容。
- `.agents/skills`：21 個高階 Skill；領域規則保留，低階操作契約封裝在 Runtime。
- `docs/migration/legacy-prompts` 與 `docs/migration/legacy-skills`：舊版參考，
  不會被新版 Runtime 載入。

驗證 Agent 資產：

```text
pnpm agent:lint
```

可以直接用自然語言呼叫工作，也可以使用舊 Agent 名稱作為相容 alias；不需要輸入
工作流識別資料。

OpenCode 的可見 Agent 另外由專案級設定提供：

- `opencode.jsonc`：註冊 `director (primary)`、將它設為預設 Agent，並以
  `{file:...}` 在 OpenCode 啟動時把 Director prompt、繼承的 `base-adult`、
  `.agents/personalities/director.yaml` 與 `director-orchestration` skill 組合
  成同一份 system prompt。
- `.agents/agents/director.md`、`.agents/personalities/director.yaml`、
  `.agents/skills/director-orchestration/SKILL.md`：分別維護角色職責、人格與細部
  工作規則；修改後下次啟動 OpenCode 即會重新載入。

請從此專案根目錄重新啟動 OpenCode；若 OpenCode 已經開啟，需重開工作區或重啟
TUI 才會重新載入 Agent 清單。

## 使用方式

```text
pnpm install
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

CLI：

```text
pnpm --filter @st-workspace/cli start status
pnpm --filter @st-workspace/cli start "建立角色 Yukino，性格冷靜直接"
pnpm --filter @st-workspace/cli start "匯入角色卡" --attach card.json
pnpm --filter @st-workspace/cli start import-legacy "C:\\AI\\projects\\card-workspace"
pnpm --filter @st-workspace/cli start serve
pnpm --filter @st-workspace/cli start agents
```

HTTP/MCP server 預設在 `http://127.0.0.1:8787`（可用 `ST_WORKSPACE_HOST` 改綁定
host；綁定非本機 host 時必須提供 `--auth-token`，否則拒絕啟動）：

### 頁面與狀態

- `GET /`：Dashboard（受 auth 保護時可帶 `?token=...` bootstrap）
- `GET /workspace/status`：目前專案與 session 狀態（未選專案時 `selected:false`）
- `GET /workspace/health`：worker 與就緒狀態
- `GET /workspace/dashboard/data`：Dashboard snapshot（artifacts 分組、prechecks、
  issues、facts、review runs、operations、repair、Tavern 報告等）
- `GET /workspace/agents`：檢視 Director 與所有 Agent

### 專案與訪談

- `GET /workspace/projects`：列出 `projects/` 中可選專案（含 revision）
- `POST /workspace/project/new`：建立新專案（未選專案時的首頁入口）
- `POST /workspace/project/select`：`{"project":"可見名稱或資料夾名稱"}`
- `GET /workspace/interview/context`：目前訪談問題與已保存回答
- `POST /workspace/interview/answer`：`{"answer":"..."}`，保存回答並回傳下一題

### 高階操作

- `POST /workspace/request`：`{"request":"...", "agent":"director"}`（`agent` 可省略）
- `GET /workspace/zhuji/context?character_id=...`：珠璣 Schema、七模組指南與既有模組
- `POST /workspace/zhuji`：提交符合珠璣 Schema 的模組 proposal
- `GET /workspace/template/context?kind=...`：模板指南與 JSON Schema
- `POST /workspace/template`：提交符合模板 Schema 的 proposal
- `GET /workspace/authoring/context`：authoring 準備狀態（roster、前置模組等）

### 來源與知識

- `GET /workspace/source/candidates`：來源搜尋候選
- `POST /workspace/source/select`：`{"candidate_ids":[...]}` 選定來源
- `POST /workspace/adaptation/decision`：adaptation decisions
- `POST /workspace/fact/review/run`：建立事實 Review Run
- `POST /workspace/fact/review/batch`：`{"decisions":[...], "reviewer_identity":...}`
  逐 fact 裁決
- `POST /workspace/fact/review/conflict`：Director conflict resolution

### 品質、審查與操作

- `POST /workspace/issue`：`{"issue_id":"...", "action":"resolve|ignore|override",
  "reason":"...", "severity":...}`（含理由與 severity 驗證）
- `POST /workspace/quality/profile`：`{"level":"...", "overrides":{code: severity}}`
- `POST /workspace/operation/recover`：`{"operation_id":"..."}` 恢復操作
- `POST /workspace/operation/fail`：`{"operation_id":"..."}` 取消操作（CAS，
  terminal operation 回 400）

### 圖片、打包與修復

- `GET /workspace/publish/preview`：publish gate 預覽
- `GET /workspace/build/preview`：package plan（選定模式、greeting、plugin、輸出路徑）
- `POST /workspace/images`：`{"character_id":..., "aspect_ratio":..., ...}` 上傳角色圖
- `POST /workspace/images/remove`：`{"image_id":"..."}` 移除角色圖
- `GET /workspace/images/:id`：取得圖片 blob
- `GET /workspace/tavern/compat`：Tavern verifier 結構化報告
- `GET /workspace/repair/preview`：修復 plan（exact items 與 plan hash）
- `POST /workspace/repair/run`：`{"plan_hash":"..."}` 執行修復（驗證 plan hash）

### MCP

- `POST /mcp`：標準 JSON-RPC tools/list/tools/call；包含 `workspace_agents`、
  `workspace_zhuji_context`、`workspace_zhuji_submit`、`workspace_projects`、
  `workspace_project_select`、`workspace_status`、`workspace_interview_context` 等。

## Dashboard 使用

Windows 可直接雙擊工作區根目錄的 `ST-Workspace-Dashboard.cmd`。啟動器會在
`127.0.0.1:8787` 啟動唯一的本機 HTTP/MCP server，健康檢查通過後自動開啟
`http://127.0.0.1:8787/`。請保持 CMD 視窗開啟；按 `Ctrl+C` 會停止 server。

OpenCode 的 `st-workspace` MCP 會連到同一個 `http://127.0.0.1:8787/mcp`，不再
自行建立第二個 runtime。因此使用 OpenCode 前應先啟動 Dashboard；若尚未啟動，
OpenCode 會顯示 MCP 無法連線。若 8787 已有 ST Workspace server，啟動器會沿用；
若被其他程式占用則顯示錯誤，不會偷偷改用另一個 port。
未選專案時顯示首頁三入口（建立新專案／開啟既有專案／舊卡審核）。面板包括：

- 訪談：逐題回答，continue／world／expansion 流程先選目標專案（含 revision 與
  修改範圍說明）再繼續。
- Blueprint precheck：唯一 active check 大字卡（確認沿用或補充輸入），歷史矩陣
  唯讀。
- Artifact 工作台：一個 key 一列目前版本（current badge），可展開原始／格式化
  內容、與前一版差異，並送審或下載；顯示建立者、Blueprint binding 與審查者。
- 品質門檻：level 選擇與 per-code override editor（含 effective → target 預覽）。
- Issue 清單：只對 open 且合法的 issue 顯示動作，一律要求原因，override 需低於
  effective 的 severity。
- 事實審查板：候選來源、來源（chunks／chars／url）、事實（revision、證據、
  locator）、Review Run 建立與逐 fact 裁決、Director conflict 解析。
- 圖片：roster dropdown 綁定、crop preview、來源／授權警告、stale banner。
- Operation 管理：狀態 filter、回答入口、lease 資訊、進度、可安全重試／需人工
  重送、取消二次確認。
- Repair：plan hash、逐檔歸檔報告。Tavern：PASS／WARN／FAIL 逐項 checks。

Dashboard 會在每次操作期間顯示 loading 並暫停重複操作；失敗時顯示結構化錯誤
（錯誤代碼、說明、影響與下一步）。沒有 project manager 或沒有可切換專案時，仍
可使用自然語言 request、狀態與 Agent 功能。

## 設計邊界

柔性只存在 runtime 邊界；進入 core 後仍會嚴格驗證 schema、身份、CAS、交易完整
性與 publish policy。遇到不能安全推斷的值，系統會建立一個 `needs_input`
operation，只問一個可恢復的高階問題，不要求使用者補底層參數。error boundary
以 CoreError.recoverable 分類 HTTP 400／500 與 MCP -32602／-32603，未知錯誤一律
回 INTERNAL_ERROR。

## Legacy 策略與收束

Legacy 能力只保留在明確的 import／migration／repair 邊界，新專案一律走
Blueprint 路徑（訪談 → precheck → Blueprint → plan gate → compiler），不會進入
任何 legacy fallback：

- **保留：舊卡導入**。`ImportService`（YAML／CCv3 V1/V2/V3）與訪談的「舊卡審核」
  流程（`importLegacyCard`）會把卡片正規化為 Character／Greeting／World artifact。
- **保留：舊 state migration**。`FileProjectRepository` 讀取時自動歸檔 legacy
  layout（root `state.json`／`proposals/`／舊 exports），寫入 `migration.json`；
  v2 `fact_review_passes` 會在載入時 backfill 為 `fact_review_decisions`
  （不開啟新的 Review Run）。
- **保留：repair／migration adapter**。`repairPreview`／`repairRun`（plan hash +
  `REPAIR_PLAN_STALE`）、CLI `repair-export`（`compileWorkspaceBundle` 投影舊
  bundle）、`inspectLegacyProject`（唯讀 legacy 目錄掃描）、
  `applyLegacyFactReview`（v2 fact review 相容 adapter）皆為唯讀或一次性搬遷
  工具；新審查流量只走 FactReviewRun／FactReviewDecision。
- **新專案防護**。managed 專案（`interviewRequired`）必須先完成 precheck 確認才
  能建置；`workflow-gate` 對未確認 precheck 回 `BLUEPRINT_PRECHECK_REQUIRED`，
  authoring readiness 驗證 Blueprint roster／mode／前置模組。無 Blueprint 的
  full-artifact gate 只服務 legacy／unmanaged 專案的相容性。
- **已移除的 dead code**。compiler 的 `legacyArtifactEntries` 與
  `buildProject`／`normalizeAuthorProject` aliases、runtime 的恆真
  `hasUsableArtifact`、`AgentResolution.fallback` 旗標、重複的
  `resolveExecutionContext`／`executionContextFor` 實作、knowledge.ts 中註解掉的
  舊 `applyReview` 實作，均已清除。
