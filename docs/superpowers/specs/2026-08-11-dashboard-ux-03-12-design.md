# UX-03~12 Dashboard 擴展設計（V3.13）

- 日期：2026-08-11
- 範圍：packages/server/src/{index.ts,dashboard.ts}、packages/server/test/dashboard.test.ts、packages/runtime/src/index.ts、packages/core/src/index.ts（repair 方法）、docs 設計文件
- Commit：`V3.13: 實作 Dashboard UX-03~12(DS)`

## 背景

Dashboard 基礎（UX-01/02）已由獨立 Agent 完成並合併（dashboard.ts 924 行、dashboard.test.ts、設計文件 2026-08-10-dashboard-independent-design.md）。UX-03~12 未做或部分完成。本批在既有 dashboard 架構上擴展：新增聚合資料端點、修復與相容性能力、並以純 DOM API（textContent/createElement，無 innerHTML）擴充面板。

## 設計原則

- 單一聚合端點 `GET /workspace/dashboard/data`（runtime.dashboardSnapshot()）供 UI 一次載入；寫入動作各自獨立端點。
- 不新增前端框架；沿用 makeElement/textContent 安全模式（dashboard.test.ts 會驗證無 innerHTML）。
- 修復能力放在 repository 層（inspectRepair/runRepair），dashboard 只負責展示與觸發。
- UX-12 為純靜態檢查（讀取最新 publish blob + PNG），不執行 compiler、不呼叫 LLM。

## 新端點（server/src/index.ts）

| 端點 | 動作 | 對應 UX |
|---|---|---|
| GET /workspace/dashboard/data | dashboardSnapshot() 聚合 | 03/04/05/06/07/09/11 |
| GET /workspace/publish/preview | validateWorkflow(state,"publish") diagnostics | UX-04 |
| GET /workspace/tavern/compat | tavernCompat() 靜態相容性 | UX-12 |
| POST /workspace/quality/profile | configureQualityProfile(level, ctx, overrides) | UX-06 |
| POST /workspace/operation/recover | recoverOperation(operation_id) | UX-09 |
| POST /workspace/operation/fail | failOperation(operation_id) | UX-09 |
| GET /workspace/repair/preview | inspectRepair() | UX-11 |
| POST /workspace/repair/run | runRepair() | UX-11 |

## runtime 新方法（packages/runtime/src/index.ts）

- `dashboardSnapshot()`：read state 聚合——project（id/name/status/revision/interview）、blueprint（prechecks、characters）、artifacts（id/key/kind/name/revision/status/binding）、facts、sources、candidates、operations（含 lease/attempt/last_error）、issues、quality、review_runs、publishes、builds、repair（委派 repository.inspectRepair()）。
- `publishPreview()`：read → validateWorkflow(state, "publish") → {ok, diagnostics}。
- `buildReadiness()`：read → manifest 可用模式（zhuji/palette）、primary character、entries（world/relationship/wardrobe/greeting/plugin 條目）、missing modules。
- `tavernCompat()`：latest publish → content_ref/png_ref blob → CCv3 檢查（spec/version、character_book 名稱與 entry 數、greeting 數量、PNG 解回比對、IHDR 圖尺寸、extensions plugin 需求）。
- `repairPreview()`/`repairRun()`：委派 repository。

## repository 新方法（packages/core/src/index.ts）

- ProjectRepository 加 `inspectRepair(): Promise<{legacy_files: string[]; orphan_backups: string[]}>`、`runRepair(): Promise<{archived: string[]}>`。
- FileProjectRepository：inspect 用 stat/readdir 檢查 root state.json/proposals/exports 與 .workspace/legacy-layout；run 執行 read()（觸發 migrate/archive/reconcile）後再對殘留 legacy 檔呼叫既有 archiveExistingLegacyLayout 路徑；回報 archived。
- MemoryProjectRepository：兩者回空陣列。

## dashboard.ts 新面板

- UX-03：precheck 矩陣（角色 × 維度，依 precheck checks 渲染，每項含 status 分類字樣）。
- UX-04：readiness 清單（GET /workspace/publish/preview；每條 diagnostic 顯示 code/severity/訊息；blocking 標記）。
- UX-05：artifact 工作台（revision/binding/creator/status/raw JSON；歷史列表）。
- UX-06：quality profile（level 選擇 none/light/normal/strict＋blocking severity 說明＋overrides 表＋發布預覽快照）。
- UX-07：來源與事實審查板（candidates 分類、facts 分類與 quote/source/chunk 資訊）。
- UX-08：打包選擇與預覽（buildReadiness：modes/primary/entries/missing）。
- UX-09：operation 管理（列表含 attempt/lease/last_error；recover/fail 按鈕）。
- UX-10：錯誤訊息中文化（error code→中文說明＋下一步；保留 code）。
- UX-11：修復入口（repair preview/run 按鈕＋報告）。
- UX-12：Tavern 相容性摘要。

## 測試策略

- dashboard.test.ts：新面板字串存在、無 innerHTML 維持、dashboard/data 端點聚合、publish preview、tavern compat（fixture publish blob）、repair preview/run（fixture legacy 檔）。
- runtime 測試：dashboardSnapshot 聚合、tavernCompat（blob fixture）、buildReadiness。
- 全量 pnpm build + typecheck + vitest + agent:lint 全綠後 commit。

## 驗證

pnpm build、pnpm typecheck、pnpm vitest run（317 基準）、pnpm agent:lint。
