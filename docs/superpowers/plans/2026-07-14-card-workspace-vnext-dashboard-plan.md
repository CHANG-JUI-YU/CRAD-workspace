# Card Workspace vNext Dashboard 實作計畫

日期：2026-07-14  
狀態：實作與自動化驗收進行中  
依據：`docs/superpowers/specs/2026-07-14-card-workspace-vnext-dashboard-design.md`

## 1. 目標

建立純桌面本機工作台：專案總覽、Workflow/Gates、schema editor、Sources/Facts、角色與世界設定、Planner、Token/Trigger、Audit、Preview/Publish及Exports。所有操作重用既有domain APIs。

## 2. 不變量

- 只綁`127.0.0.1`。
- Client不直接碰filesystem或Node domain packages。
- Server不提供generic file、shell或URL fetch。
- Mutation要求session、Origin、CSRF、expected revision。
- 文件編輯只走typed resource、dry-run、RFC 6902與transaction。
- Workflow Engine仍是stage/task/gate唯一權威。
- Publish只接受approved exact preview。
- 不實作mobile布局。

## 3. 里程碑

- M1 Tasks 1–4：Contracts、server安全、domain adapters、SSE。
- M2 Tasks 5–8：React shell、overview/workflow、editor、角色/世界/Greetings。
- M3 Tasks 9–12：Sources/Facts、graphs/simulators、build/release、E2E/驗收。

## 4. Tasks

### Task 1：Dashboard API contracts

新增：

- `packages/schemas/src/dashboard.ts`
- `packages/schemas/test/dashboard.test.ts`

修改：

- `packages/schemas/src/index.ts`

先測：session、resource IDs、project summaries、documents、patch dry-run/apply、workflow、facts、graphs、simulators、builds、diagnostic envelope、pagination。拒絕path欄位、absolute path、未知resource kind。

驗收：Schemas build/typecheck/test全綠。

### Task 2：Dashboard Server與安全啟動

新增：

- `packages/dashboard-server/package.json`
- `packages/dashboard-server/tsconfig.json`
- `packages/dashboard-server/src/{index,server,context,errors}.ts`
- `packages/dashboard-server/src/security/{session,origin,limits}.ts`
- `packages/dashboard-server/test/security.test.ts`

實作Fastify server、loopback hard bind、Host檢查、one-time bootstrap、HttpOnly cookie、CSRF、安全headers、body limits、request IDs、path redaction、stderr logs。

先測：token replay、wrong Origin/Host/CSRF、expired session、oversized body、LAN host option拒絕、restart失效。

### Task 3：Project/Workflow/Document adapters

新增：

- `packages/dashboard-server/src/routes/{projects,workflow,documents}.ts`
- `packages/dashboard-server/src/resources.ts`
- `packages/dashboard-server/test/domain-routes.test.ts`

實作project list/detail、workflow/tasks/gates、typed document read、dry-run、apply、revision conflict。Stable ID推導path；禁止client path。Gate走Workflow service。

先測：library等價、stale CAS、symlink/traversal、export read-only、`.workflow`與Sources/Facts不可editor直改。

### Task 4：Events與其餘Domain adapters

新增：

- `packages/dashboard-server/src/events.ts`
- `packages/dashboard-server/src/routes/{sources,facts,provenance,planner,builds}.ts`
- `packages/dashboard-server/test/events-routes.test.ts`

實作SSE invalidation、sources/facts/conflicts/provenance、plan/simulate、preview/audit/roundtrip/publish/export download。Large resources pagination/range。

先測：SSE reconnect semantics、graph limits、exact preview lock、output hash等價、safe downloads。

### Task 5：React/Vite desktop shell

新增：

- `apps/dashboard/package.json`
- `apps/dashboard/tsconfig*.json`
- `apps/dashboard/vite.config.ts`
- `apps/dashboard/index.html`
- `apps/dashboard/src/main.tsx`
- `apps/dashboard/src/app/*`
- `apps/dashboard/src/styles/*`

建立Router、TanStack Query、bootstrap/session client、SSE、error boundaries、三pane shell、bottom console、dark editorial theme。最低1280px；不做mobile。

先測：bootstrap、deep links、project switch selection reset、SSE cache invalidation、pane crash isolation。

### Task 6：Overview、Workflow與Gates

新增：

- `apps/dashboard/src/features/overview/*`
- `apps/dashboard/src/features/workflow/*`
- `apps/dashboard/src/features/gates/*`

實作health summary、stage timeline、tasks/lease/retry、decisions、proposal/review diff、Gate approve/reject/supersede、publish confirmation。

先測：Director不能代批語意、blocking findings、stale gate、exact input revisions。

### Task 7：Schema Form、Monaco、Diff與Conflict

新增：

- `apps/dashboard/src/features/editor/*`
- `apps/dashboard/src/features/diff/*`

實作typed draft共享模型、schema form、Monaco YAML/JSON、local parse、server dry-run、semantic diff、confirm apply、Base/Current/Yours conflict UI。

先測：Form/Monaco patch等價、invalid YAML、schema errors、stale revision、安全rebase、dirty navigation guard。

### Task 8：Characters、World與Greetings

新增：

- `apps/dashboard/src/features/characters/*`
- `apps/dashboard/src/features/world/*`
- `apps/dashboard/src/features/greetings/*`

實作珠璣七模組、調色盤四模組、mode-history、conversion diff、八分類世界設定、refs/activation、Greetings分類與診斷。模組7明示非greeting。

先測：模式不可混用、module7隔離、group greeting refs、export不可編輯。

### Task 9：Sources、Facts與Provenance

新增：

- `apps/dashboard/src/features/sources/*`
- `apps/dashboard/src/features/facts/*`
- `apps/dashboard/src/features/provenance/*`

實作source revisions/chunks/jobs、candidate/evidence、duplicate/conflict、六種resolution、accepted fact review、paged provenance graph。

先測：精確quote/range呈現、immutable artifacts、conflict decision、single-value gate、graph截斷。

### Task 10：Planner、Graphs、Token與Trigger

新增：

- `apps/dashboard/src/features/planner/*`
- `apps/dashboard/src/features/graphs/*`
- `apps/dashboard/src/features/simulation/*`

實作planned entries、decision trace、position/recursion graph、Token budget/eviction、conversation trigger trace與filters。

先測：library report等價、invalid regex、budget eviction、graph paging、profile/version標示。

### Task 11：Builds、Audit、Round-trip與Exports

新增：

- `apps/dashboard/src/features/builds/*`
- `apps/dashboard/src/features/audit/*`
- `apps/dashboard/src/features/exports/*`

實作preview列表、三層Audit、round-trip loss、JSON/PNG/V2資訊、approved publish、safe artifact download。

先測：strict block、stale preview、hash mismatch、publish rollback、PNG/JSON metadata。

### Task 12：CLI、Playwright、文件與最終驗收

新增：

- `apps/dashboard/playwright.config.ts`
- `apps/dashboard/e2e/*.spec.ts`
- `docs/architecture/dashboard.md`

修改：

- `packages/cli/src/program.ts`
- `packages/cli/package.json`
- 根`package.json`
- `README.md`
- CI config

新增`card-workspace dashboard`。Playwright測1280×720、1440×900、1920×1080：原創編輯/Gate、Sources/Facts、Planner→Preview→Publish、雙context revision conflict。

## 5. 最終命令

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 --filter @card-workspace/dashboard e2e
npx --yes pnpm@10.34.5 audit --prod --audit-level high
```

## 6. 完成定義

- 12 Tasks與三里程碑完成。
- Desktop workbench覆蓋完整專案管理、微調、審批、分析與發布。
- Server security、revision/transaction、domain equivalence全綠。
- 三種desktop viewport E2E全綠。
- Coverage門檻維持statements/lines/functions 85%、branches 80%。
- Dashboard失敗不影響OpenCode、CLI、MCP或正式專案。
