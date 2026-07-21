# Dashboard 架構與操作

Dashboard 是 OpenCode Director 的桌面輔助工作台，不是另一套工作流或檔案管理器。

## 啟動

```powershell
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 dashboard
```

CLI固定綁定`127.0.0.1`的可用port，產生一次性bootstrap URL並開啟瀏覽器。使用`--no-open`可只啟動服務；`--port`只能改loopback port。

## 邊界

- Client：`apps/dashboard`，React/Vite桌面工作台。
- Server：`packages/dashboard-server`，Fastify typed adapters與靜態資產。
- Domain authority：Project、Ingestion、Compiler、Diagnostics、Workflow packages。
- Dashboard不直接讀寫filesystem，不spawn CLI/MCP，不fetch任意URL。

## 編輯

可編輯資源以stable resource ref解析。流程是local parse、server dry-run、semantic diff、確認apply。Server使用RFC 6902、schema、ownership及revision CAS；stale edit回衝突，不覆蓋current。

Workflow、Sources/Facts projections、journals、snapshots、chunks、candidate batches、`.build`及exports不可由通用editor修改。Gate與Publish使用Workflow Engine及exact preview lock。

## 安全

- IPv4 loopback only。
- Host與Origin必須匹配目前loopback address。
- Bootstrap token一次性、短效、至少256-bit。
- Session cookie為HttpOnly、SameSite=Strict。
- Mutation另需session-bound CSRF token。
- API/body/graph/range有限制。
- Server重啟使session失效，但專案與Workflow由workspace恢復。

## 視圖

- Overview：健康、角色、Gates、Tasks、recent build。
- Workflow：十階段、Tasks、Decisions、四道Gates。
- Characters：珠璣七模組或調色盤四模組；模組7非greeting。
- World/Greetings：typed editor與diagnostics。
- Sources/Facts：revisions、chunks、evidence、conflicts。
- Planner：entries、依賴圖、Token、Trigger。
- Builds：Preview、Audit、Round-trip、Exports。

## 測試

```powershell
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 test:e2e
```

Playwright固定驗證1280×720、1440×900、1920×1080，並涵蓋原創文件編輯與Gate、Sources/Facts審核、Planner到exact preview發布，以及雙context revision conflict。Dashboard不支援手機viewport。

CI以Windows runner執行build、lint、typecheck、unit/integration、coverage、Agent lint與三種viewport E2E。Audit仍檢查production dependencies；只有registry本身無法服務時使用pnpm官方`--ignore-registry-errors`避免基礎設施故障誤判，實際high/critical advisory仍會使CI失敗。
