# Card Workspace vNext

SillyTavern Character Card V3 作者工作區。目前包含 Foundation、Forge Core、Sources/Facts、Agents/Workflow 與桌面 Dashboard：版本化作者 schema、安全專案 I/O、Canonical IR、世界書規劃、Token/Trigger 模擬、三層診斷、CCv3 JSON/PNG、交易式發布、來源證據鏈、持久 Agent 工作流，以及本機管理與微調介面。

> 修改 `opencode.jsonc`、`.opencode/prompts/` 或 `.agents/skills/` 後，必須完整退出並重啟 OpenCode；既有 session 不會可靠地熱載入 Agent、Skill、permission 或 identity-bound MCP 環境。

## 環境

- Node.js `>=20.17 <21`
- pnpm `10.34.5`

```powershell
npx --yes pnpm@10.34.5 install
npx --yes pnpm@10.34.5 check
```

## CLI

```powershell
node packages/cli/dist/index.js init demo --title "示範角色"
node packages/cli/dist/index.js validate demo
node packages/cli/dist/index.js query demo project.yaml /title
node packages/cli/dist/index.js patch demo project.yaml --patch '@patch.json' --expected-revision 'sha256:...' --dry-run
node packages/cli/dist/index.js patch demo project.yaml --patch '@patch.json' --expected-revision 'sha256:...' --apply
node packages/cli/dist/index.js plan demo
node packages/cli/dist/index.js simulate demo --conversation conversations/demo.txt
node packages/cli/dist/index.js compile demo --no-publish --no-png
node packages/cli/dist/index.js compile demo --v2-backfill
node packages/cli/dist/index.js audit imports/card.png
node packages/cli/dist/index.js import imports/card.json
node packages/cli/dist/index.js roundtrip imports/card.png
node packages/cli/dist/index.js source add demo C:\sources\novel.md --source-id novel --title "原作小說" --tier official
node packages/cli/dist/index.js source chunk demo novel --expected-revision 'sha256:...'
node packages/cli/dist/index.js source status demo novel
node packages/cli/dist/index.js source verify demo novel
node packages/cli/dist/index.js fact query demo --status accepted
node packages/cli/dist/index.js provenance verify demo
node packages/cli/dist/index.js dashboard --no-open --port 4317
```

`compile` 預設依 `project.yaml` 發布設定執行；PNG 輸出需要 `assets/avatar.png`，尚無頭像時使用 `--no-png`。正式產物會以單一交易寫入 `projects/<project-id>/.build/` 與 `exports/<project-id>/`，strict 失敗不會留下半套輸出。

正式專案位於 `projects/<project-id>/`。每名角色可獨立使用珠璣模式或調色盤模式；專案級 `greetings.yaml` 負責所有開場白，珠璣模組7只會成為角色世界書內容。舊系統隔離在 `.legacy-v1/`，不會被 vNext 載入。

## Sources/Facts

Sources/Facts 採 OpenCode-first：所有核心能力由 `@card-workspace/ingestion` public API 提供，不需要 Dashboard。工作流是 intake 不可變 snapshot/revision、建立 deterministic chunk set、提交具精確 evidence 的 candidate、人工 review/resolve，最後以 fact/provenance verify 供 Forge 使用。OpenCode、CLI 及下一階段 Agent/MCP 都必須呼叫同一 library API，不直接改專案資料。

`sources/manifest.yaml`、`facts/register.yaml` 與 `facts/conflicts.yaml` 雖是可讀 YAML，仍是受控投影，禁止人工修改。Snapshot、revision、projection、chunk、candidate batch 與 journals 同樣不可手改；所有 mutation 必須走 expected revision 與專案交易。驗證失敗時先執行只讀 verify；只有 journal 與 immutable artifacts 完整時才可 rebuild 投影，交易中斷則交由 project transaction recovery。

完整心智模型、檔案所有權、verify/rebuild/recovery 與 Agent/MCP 契約見 [`docs/architecture/sources-facts.md`](docs/architecture/sources-facts.md)。可重用測試資料由 `@card-workspace/testing` 的 source/fact builders 提供；大型文本、CRLF、card PNG 與破損案例皆程式生成，不提交巨大二進位 fixture。

## Agents 工作流

OpenCode 預設入口為 Director。Director 一次只問一個未決問題，負責委派十個專職 Agent 與呈現 Facts、Blueprint、Content、Publish 四道使用者閘門，不直接生成完整角色模組。每個 Agent 以獨立 Forge MCP process 綁定 registry 身分，並只載入一個單職責 Skill；Creator 與 Critic 的工具、references 與輸出契約保持隔離。

珠璣模組7是角色自我介紹常態設定，不是 greeting。完整 Agent 責任、權限交集、四種入口、修訂上限與維護方式見 [`docs/architecture/agents-workflow.md`](docs/architecture/agents-workflow.md)。

## Dashboard

```powershell
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 dashboard
```

也可直接執行`card-workspace dashboard`；`--no-open`禁止自動開啟瀏覽器，`--port`指定loopback port。Dashboard只綁`127.0.0.1`，以one-time bootstrap、HttpOnly session、Origin與CSRF保護mutation。它用於專案總覽、Workflow/Gates、角色與世界設定微調、Sources/Facts、Token/Trigger、Audit、Preview/Publish及Exports；不取代Director，也不提供任意檔案、shell、URL fetch或MCP程序控制。完整模型見 [`docs/architecture/dashboard.md`](docs/architecture/dashboard.md)。最低桌面寬度1280px，不提供手機布局。

## 品質門禁

```powershell
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 check
npx --yes pnpm@10.34.5 test:coverage
npx --yes pnpm@10.34.5 test:e2e
npx --yes pnpm@10.34.5 audit --prod --audit-level high
```

真實 SillyTavern 對 V3 JSON、只有 `ccv3` 的 PNG、以及 `ccv3+chara` PNG 的人工匯入仍屬外部驗收，不以 schema 或 round-trip 測試代替。
