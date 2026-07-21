# Card Workspace vNext Dashboard 設計規格

日期：2026-07-14  
狀態：使用者已批准  
依據：`2026-07-13-card-workspace-vnext-master-design.md`、已驗收的 Foundation、Forge Core、Sources/Facts、Agents/Workflow 契約

## 1. 目的

Dashboard 是 Card Workspace 的桌面管理、檢查、微調與審批介面。主要創作入口仍是 OpenCode Director；Dashboard 不取代 Director、Workflow Engine、Forge、CLI 或 MCP。

```text
Director = 訪談、語意創作、Agent 調度
Dashboard = 專案控制台、編輯器、比較器、審批介面
Workflow = stage、task、gate、lease、revision 唯一權威
Forge = 驗證、規劃、模擬、編譯、診斷、發布
```

Dashboard 解決大型專案中只靠對話難以總覽、比較、追蹤與手動微調的問題。

## 2. 範圍

本階段包含：

- 純桌面本機 Dashboard。
- 專案、角色、Workflow、Tasks、Gates 與產物總覽。
- Schema-aware 表單與 Monaco advanced editor。
- RFC 6902 dry-run、semantic diff、revision CAS 與交易式儲存。
- Sources、Facts、Evidence、Conflicts 與 Provenance 視圖。
- 珠璣／調色盤角色編輯與 side-by-side 比較。
- 世界設定、世界書條目、依賴與遞迴圖。
- Greetings 預覽、比較與診斷。
- Token／Trigger 模擬。
- Compile Preview、三層 Audit、Round-trip 與 Exports 管理。
- Facts、Blueprint、Content、Publish 四道 Gate 審批。
- Loopback-only server、session、Origin／CSRF 與路徑安全。
- Desktop Playwright E2E 與 API contract tests。

本階段不包含：

- 手機或平板布局。
- 在 Dashboard 中執行 AI 生成或取代 Director。
- 通用 filesystem、shell、任意 URL fetch。
- MCP process 啟停控制。
- Optional Plugins 的內容編輯器。
- PDF／DOCX adapter、網路搜尋或 Agent personality。

## 3. 成功標準

- 使用者可在單一桌面工作台理解專案健康、目前階段、待辦與正式產物。
- 同一 revision 下，Dashboard、CLI、MCP 與 library 產生相同驗證、規劃、模擬、Audit 與編譯結果。
- Dashboard 編輯不整檔盲寫，不繞過 schema、ownership、provenance、gate 或 preview lock。
- Concurrent edit 不覆蓋別人的變更。
- Dashboard 或 server 失敗不損壞專案，也不影響 OpenCode、CLI、MCP。
- 所有安全與 E2E 測試在三種桌面 viewport 通過。

## 4. 架構

新增：

```text
apps/dashboard/
  React desktop client
  routes and workbench panes
  schema forms and Monaco
  diff, graphs, previews
  typed API client and SSE

packages/dashboard-server/
  local HTTP server
  session/bootstrap/CSRF
  typed route adapters
  SSE event projection
  static asset serving
```

API request/response schemas放入：

```text
packages/schemas/src/dashboard.ts
```

依賴方向：

```text
schemas
  ↑
project / ingestion / compiler / diagnostics / workflow
  ↑
dashboard-server
  ↑ HTTP/SSE
apps/dashboard
```

Dashboard client 不直接 import Node domain packages。Server adapters 只呼叫既有 public API，不重寫 domain logic。

## 5. 技術選擇

Client：

- React + TypeScript + Vite。
- React Router 管理資源 URL 與 deep links。
- TanStack Query 管理 server state、cache 與 invalidation。
- Monaco Editor 提供 advanced YAML／JSON 編輯。
- React Flow 或等價 library 顯示世界書與 provenance 圖。
- 原生 EventSource 接收 SSE。
- CSS variables + scoped styles 建立桌面高密度視覺系統。

Server：

- Node.js + Fastify。
- Zod schemas作 request/response runtime validation。
- 使用現有 `@card-workspace/*` libraries。
- 不 spawn CLI 或 MCP。
- 靜態 client build與API由同一Origin提供。

不引入第二套資料庫。Project files、workflow journals與immutable artifacts仍是唯一持久來源。

## 6. 啟動模型

新增 CLI：

```text
card-workspace dashboard
card-workspace dashboard --no-open
card-workspace dashboard --port <port>
```

規則：

- Host固定 `127.0.0.1`，不能由CLI改為LAN地址。
- Port預設自動選擇可用loopback port。
- 啟動時產生高熵one-time bootstrap token。
- CLI開啟 `http://127.0.0.1:<port>/#bootstrap=<token>`。
- Fragment不送入HTTP logs；client讀取後立即清除URL fragment。
- Client以bootstrap token交換HttpOnly、SameSite=Strict session cookie與記憶體CSRF token。
- Bootstrap token使用一次後失效。
- Server重啟產生新session，專案狀態從workspace恢復。

## 7. 桌面工作台

最低設計寬度為1280px。不提供mobile breakpoint或抽屜式導航。

```text
┌ Project/Character ─ Stage ─ Gate ─ Validate/Preview/Publish ┐
├──────────┬──────────────────────────────┬───────────────────┤
│ Nav Tree │ Main Workspace               │ Inspector         │
│          │ Form / Monaco / Diff / Graph │ Diagnostics       │
│          │ Preview / Table              │ Provenance        │
│          │                              │ Token / Revision  │
├──────────┴──────────────────────────────┴───────────────────┤
│ Task / Validation / Build Event Console                    │
└─────────────────────────────────────────────────────────────┘
```

Pane可調整寬度並保存於browser local preferences；不得把project資料或API credentials放進localStorage。

## 8. 視覺語言

- 深色「編輯室」風格，高資訊密度。
- 非一般SaaS卡片牆；以pane、table、editor、timeline、graph為主。
- 色彩僅用於error、warning、success、gate與selection。
- Typography區分UI、內容與machine artifact；程式／YAML使用monospace。
- 每個資源固定顯示revision、dirty、validation、review與stale狀態。
- Draft、derived build、export使用不同視覺邊界，防止誤編正式輸出。
- 所有可操作元素支援鍵盤焦點與可讀label。

## 9. 導航與主要視圖

### 9.1 Overview

- 專案健康與目前Workflow Stage。
- 角色、模式、世界觀、Greetings摘要。
- 待處理Gates、失敗／過期Tasks、stale artifacts。
- 最近preview、Audit與export狀態。

### 9.2 Workflow

- 十階段timeline。
- Tasks、assignee、lease、attempt、dependencies與result。
- Decisions與四道Gates。
- Proposal／Review revisions比較。
- 只透過Workflow API approve、reject或supersede。

### 9.3 Sources

- Source、immutable revisions、snapshot metadata。
- Projection、chunk profile與chunk sets。
- Extraction jobs與per-chunk task狀態。
- Verification結果。

### 9.4 Facts

- Candidate、validated、pending、accepted、rejected等生命週期。
- Evidence quote與精確source/chunk/range定位。
- Exact/equivalent/suggested duplicate。
- Conflict members並排比較與六種resolution。
- Accepted fact只能透過既有review/decision API修改。

### 9.5 Characters

- Character identity與relationships。
- 珠璣模式固定七模組；模組7標示「自我介紹，非開場白」。
- 調色盤模式固定四模組。
- Active mode與mode-history。
- 珠璣／調色盤side-by-side diff及conversion mapping report。

### 9.6 World

- 八分類世界設定。
- Stable ID、refs、facts、activation、placement、recursion與token override。
- Author model graph與planned lorebook graph分開顯示。

### 9.7 Greetings

- Primary、alternate、group-only分類。
- 群像角色refs。
- 文字與角色場景預覽。
- Puppeteering、封閉式結尾與workspace diagnostics。

### 9.8 Planner

- Canonical entries與decision trace。
- 世界書順序、position、recursion、dependencies。
- Token constant/worst-case/budget/eviction。
- Conversation輸入與Trigger trace。

### 9.9 Builds

- Compile previews與exact input revision。
- Normative／Compatibility／Workspace三層Audit。
- Round-trip report與expected/unexpected loss。
- JSON、PNG及optional V2 backfill資訊。
- Publish只接受approved且未stale preview。

## 10. 編輯模型

每份可編輯document提供兩種模式：

1. Schema Form：依正式schema顯示欄位、enum、arrays、references與validation。
2. Advanced：Monaco完整YAML／JSON。

兩者操作同一typed draft，不建立兩份內容來源。

儲存流程：

```text
GET document + semantic revision + raw revision
→ local parse
→ server dry-run
→ schema/cross-reference/provenance validation
→ semantic diff + rebuild scopes
→ explicit user confirmation
→ RFC 6902 + expected revision
→ project transaction
→ workflow artifacts/approvals stale
→ SSE invalidation
```

限制：

- 不提供整檔任意write endpoint。
- 不允許client指定workspace filesystem path。
- Server由resource kind與stable ID推導路徑。
- `.workflow`、Sources/Facts projections、journals、snapshots、chunks、candidate batches、`.build`、exports不可由editor直接修改。
- Export永遠read-only。

## 11. Revision Conflict

遇到stale revision：

- Server回 `DASHBOARD_REVISION_CONFLICT`。
- 回應包含base revision、current revision與可安全顯示的semantic diff reference。
- Client顯示Base／Current／Yours三欄比較。
- 不自動覆蓋current。
- 使用者可重新載入、重新套用patch或放棄。
- Rebase後必須重新dry-run與validate。

## 12. Gate與Publish

Gate畫面顯示：

- Gate種類與目前狀態。
- Input artifacts及exact revisions。
- Blocking與overridable findings。
- Proposal、Critic report與差異。
- 決策影響與下一步。

規則：

- Director與Dashboard都不能繞過Workflow Engine。
- Facts→Blueprint→Content→Publish順序固定。
- Normative/schema/provenance errors不可override。
- Publish confirmation顯示preview ID、input revision、artifact hashes、Audit summary與輸出路徑別名。
- 發布前server重新驗exact preview；stale即拒絕。

## 13. Graph模型

Dashboard提供兩種graph：

- Provenance：fragment→fact→evidence→chunk→revision→snapshot。
- Lorebook：entry→reference/dependency/recursion/activation。

Graph資料由server使用既有index/planner結果轉為paged nodes/edges。Client不自行重建語意。

大型graph：

- 初始只載摘要與目前selection鄰接節點。
- 支援按類型、角色、category、activation與finding過濾。
- 超過節點限制時顯示截斷提示，不讓browser無界載入。

## 14. Token與Trigger模擬

- Token報告直接來自compiler simulator。
- Trigger輸入是使用者提供的測試conversation，不寫入角色卡。
- Report標示profile、tokenizer ID/version、budget與approximation狀態。
- Activation trace顯示plain/regex/secondary/group/recursion/budget決策。
- Dashboard不得宣稱模擬未知SillyTavern版本的完整runtime。

## 15. Typed API

API分組：

```text
/api/session/*
/api/projects/*
/api/workflow/*
/api/documents/*
/api/sources/*
/api/facts/*
/api/provenance/*
/api/planner/*
/api/builds/*
/api/events
```

原則：

- Request／response均由Zod schema驗證。
- Response envelope包含`ok`、`data`或stable diagnostics。
- Large text、chunks、graphs、events使用pagination/range。
- Mutation要求CSRF token、expected revision與resource identity。
- API不接受absolute path或任意relative path。
- Server不回傳不必要absolute host path。

## 16. SSE與同步

SSE事件只傳輕量invalidations：

```text
project.changed
workflow.changed
task.changed
gate.changed
source.changed
facts.changed
preview.changed
build.published
diagnostics.changed
```

事件包含project ID、resource kind、resource ID與revision，不包含整份敏感內容。

SSE斷線：

- Client exponential reconnect。
- 超時後退回增量polling。
- Mutation仍使用HTTP request與CAS，不透過SSE。
- 重連後以revision重新同步，不假設事件完整保存。

## 17. 本機安全

### 17.1 Network

- 只綁IPv4 loopback `127.0.0.1`。
- 拒絕Host不是目前loopback host/port的request。
- 不提供LAN、remote或production deployment模式。

### 17.2 Session與CSRF

- Bootstrap token至少256-bit entropy，one-time且短效。
- Session cookie HttpOnly、SameSite=Strict、Path=/。
- Mutation與session bootstrap檢查Origin。
- Mutation另要求session-bound CSRF token。
- Session只保存在記憶體；server重啟全部失效。

### 17.3 Input與Output

- JSON body、text editor、PNG preview及graph query有大小上限。
- Content-Type allowlist。
- 所有LLM／作者字串預設以text rendering。
- Rich text需要allowlist sanitizer，不使用不受控`innerHTML`。
- Download以固定artifact ID解析，禁止path輸入。

### 17.4 Filesystem

- 使用既有`resolveWithin`、realpath與symlink/junction防禦。
- 所有寫入經domain ownership與transaction。
- Dashboard server不增加generic filesystem API。

## 18. Error Handling

API error包含：

- Stable code。
- Severity。
- Human message。
- Resource/location。
- Evidence或details。
- Retryable flag。
- Safe next actions。

Client error boundaries以pane為單位。Monaco、graph或preview pane崩潰不使整個workbench失效。

Server restart後：

- 未提交client draft仍留在記憶體，顯示session失效並禁止提交。
- 持久Workflow／Project狀態重新載入。
- 交易恢復仍由Project transaction recovery處理。

## 19. Observability

- Server log只寫stderr或指定local log sink。
- Log包含request ID、route、duration、status與domain error code。
- 不記錄session/bootstrap/CSRF token、完整作者內容或binary payload。
- Dashboard Event Console顯示可安全暴露的Workflow、validation與build events。
- 不偽造MCP health或PID；本階段不提供MCP程序控制UI。

## 20. 測試策略

### 20.1 Contracts與Server

- 所有route request/response schemas。
- Session bootstrap、one-time token、cookie、Origin、CSRF。
- Host spoof、path traversal、absolute path、symlink/junction。
- Body/content type/range/graph limits。
- Stable diagnostics與path redaction。

### 20.2 Editing

- Form與Monaco對相同typed value產生相同patch語意。
- Dry-run、diff、schema、cross-reference與provenance errors。
- Concurrent edits與stale revision。
- Transaction rollback及workflow stale propagation。
- Draft/export資源隔離。

### 20.3 Domain Equivalence

- Workflow、facts、conflicts、provenance、planner、simulators、audit、round-trip與publish。
- Dashboard server與直接library對相同revision輸出等價。
- Publish exact preview lock。

### 20.4 Client

- Router deep links、project switch與selection reset。
- Query cache invalidation與SSE reconnect。
- Pane error boundaries。
- Keyboard navigation及主要accessibility assertions。

### 20.5 Desktop E2E

Playwright Chromium：

- `1280×720`
- `1440×900`
- `1920×1080`

流程：

1. 原創專案總覽→編輯→dry-run→commit→Content Gate。
2. Source/Facts→evidence→conflict resolve→Facts Gate。
3. Planner→Token/Trigger→Compile Preview→Audit→Publish Gate→Export。
4. Concurrent browser contexts造成revision conflict並安全rebase。

不建立mobile viewport測試。

## 21. 品質門檻

- Root build、lint、typecheck、tests全綠。
- 既有statements/lines/functions 85%、branches 80%不得降低。
- Playwright desktop E2E全綠。
- Production audit high無已知弱點。
- Client production build無外部CDN runtime依賴。
- Server security regression suite全綠。

## 22. 實作里程碑

### M1 Server Foundation

- Dashboard API schemas。
- Loopback server、session、CSRF、安全headers。
- Project/workflow/document read與patch dry-run/apply。
- SSE invalidation。

### M2 Desktop Workbench

- Shell、navigation、panes、theme。
- Overview、Workflow、Characters、World、Greetings。
- Schema Form、Monaco、Diff、revision conflict。

### M3 Analysis與Release

- Sources/Facts/Provenance。
- Graph、Planner、Token/Trigger。
- Preview、Audit、Round-trip、Exports。
- Gates、Playwright、security、coverage與docs。

## 23. 完成定義

- Dashboard能管理、檢視、比較、微調與審批完整專案。
- 所有mutation經schema、ownership、revision與transaction。
- Sources/Facts與derived artifacts不被直接手改。
- Workflow Engine仍是stage/task/gate唯一權威。
- Publish只接受approved exact preview。
- Dashboard與CLI/MCP/library結果等價。
- Loopback/session/Origin/CSRF/path安全測試全綠。
- 三個desktop viewport的核心E2E全綠。
- Dashboard失敗不影響OpenCode、CLI、MCP或正式專案。
- README與architecture文件包含啟動、恢復、安全與限制。

## 24. 自審結論

- Dashboard定位為輔助工作台，沒有取代Director。
- 沒有加入generic filesystem、shell、URL fetch或MCP假狀態。
- 編輯模型使用typed resource、dry-run、patch與CAS，不整檔盲寫。
- Sources/Facts、journals、builds與exports ownership清楚。
- 安全模型符合loopback-only本機工具。
- 已明確排除mobile設計與測試。
- 架構分成client、server與既有domain APIs，沒有重寫核心邏輯。
- 範圍可由三個里程碑獨立驗收。
