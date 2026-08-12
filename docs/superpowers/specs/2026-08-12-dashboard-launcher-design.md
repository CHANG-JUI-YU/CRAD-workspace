# ST Workspace Dashboard 啟動器設計

日期：2026-08-12
狀態：已批准，待實作

## 目標

提供一個可雙擊的 Windows CMD 入口，讓使用者在啟動 OpenCode 前先啟動 ST Workspace 的唯一 HTTP/MCP server，並自動開啟 Dashboard。Dashboard 與 OpenCode 必須共用同一個 runtime、背景 worker、專案根目錄與 MCP endpoint，不能各自啟動 server。

本功能沿用工作區現有 Node.js、pnpm、tsx 與編譯結果，不製作獨立 Node runtime 或完整單檔 EXE。

## 使用方式

工作區根目錄提供：

```text
ST-Workspace-Dashboard.cmd
```

使用者雙擊後：

1. CMD 將目前工作目錄固定切換到自身所在的 ST Workspace 根目錄。
2. 以現有 Node.js 與 tsx 執行 `tools/dashboard-launcher.ts`。
3. Launcher 檢查 `127.0.0.1:8787`。
4. 若尚未有服務，Launcher 在同一個 Node process 內啟動 `startWorkspaceServer()`。
5. `/workspace/health` 回應成功後，以預設瀏覽器開啟 `http://127.0.0.1:8787/`。
6. CMD 視窗保持開啟並顯示目前狀態。
7. 使用者之後自行從另一個終端啟動 OpenCode。
8. 按 `Ctrl+C` 或正常關閉 Launcher 時，停止由本次 Launcher 啟動的 server 與 worker。

Launcher 不自動啟動 OpenCode。

## 架構

### CMD 入口

`ST-Workspace-Dashboard.cmd` 只負責：

- 切換至 `%~dp0` 指向的工作區根目錄。
- 確認 `node` 可執行。
- 呼叫 `node --import tsx/esm tools/dashboard-launcher.ts`。
- 保留錯誤畫面，避免雙擊失敗後視窗立即消失。

所有 port、健康檢查、瀏覽器與生命週期邏輯都放在 TypeScript launcher，避免在 BAT/CMD 中堆疊難以維護的 PowerShell 或程序控制指令。

### TypeScript Launcher

`tools/dashboard-launcher.ts` 是單一啟動協調器，職責限於：

- 解析工作區根目錄與 `projects/` 路徑。
- 檢查必要 runtime 與 server module。
- 探測固定 endpoint。
- 啟動或沿用 ST Workspace server。
- 等待健康檢查。
- 開啟瀏覽器。
- 處理正常關閉與錯誤訊息。

Launcher 直接呼叫 `startWorkspaceServer({ actor: "dashboard-launcher", host: "127.0.0.1", port: 8787, projectRoot })`，不另外 spawn CLI server。這使 server 與 Launcher 屬於同一個 Node process；即使沒有額外 child-process 清理機制，Launcher process 結束後也不會遺留由它建立的 server process。

### OpenCode MCP

`opencode.jsonc` 的 `st-workspace` MCP 設定改為既有 HTTP server：

```jsonc
"st-workspace": {
  "type": "remote",
  "url": "http://127.0.0.1:8787/mcp",
  "enabled": true,
  "oauth": false,
  "timeout": 120000
}
```

移除目前透過 `tools/opencode-mcp.ts` 啟動第二個隨機 port server 的 local MCP 設定。OpenCode 啟動時只連線，不擁有 server 生命週期。

`tools/opencode-mcp.ts` 可保留作為舊版相容或診斷工具，但不再由正式 `opencode.jsonc` 使用；若確認沒有其他引用，可在後續清理工作中移除，本次不強制刪除。

## 固定 Port 與單一實例

正式位置固定為：

```text
Dashboard: http://127.0.0.1:8787/
MCP:       http://127.0.0.1:8787/mcp
Health:    http://127.0.0.1:8787/workspace/health
```

不自動遞增或改用隨機 port，因為 OpenCode 必須連到確定 endpoint。

啟動前探測規則：

1. `8787` 沒有服務：啟動新 server。
2. Health endpoint 回傳可辨識的 ST Workspace 健康資料：視為既有 ST server，直接沿用並開啟 Dashboard。
3. Port 可連線但不是 ST Workspace，或 health 回應不符合契約：停止啟動並顯示 `DASHBOARD_PORT_IN_USE` 中文錯誤。
4. 已沿用既有 ST server 時，本次 Launcher 不擁有該 server；關閉 Launcher 不得停止既有服務。

為了可靠識別，健康回應應提供穩定的服務識別欄位，例如：

```json
{
  "service": "st-workspace-v3",
  "status": "ready"
}
```

保留原本 health 資訊，僅增加識別欄位，不改變既有 consumer。

## 瀏覽器行為

Launcher 只在以下情況開啟一次瀏覽器：

- 新 server 已通過健康檢查；或
- 已確認 8787 上是可用的既有 ST Workspace server。

Windows 使用系統預設 URL handler 開啟 Dashboard，不指定 Chrome、Edge 或其他瀏覽器。

若瀏覽器開啟失敗，server 仍保持執行，並在 CMD 顯示可手動開啟的完整 URL；瀏覽器失敗不應使 server 一起終止。

## 錯誤處理

使用者可見錯誤必須使用中文並包含下一步：

- `DASHBOARD_NODE_MISSING`：找不到 Node.js；提示安裝或修正 PATH。
- `DASHBOARD_DEPENDENCY_MISSING`：找不到 tsx／workspace dependency；提示在工作區執行 `pnpm install`。
- `DASHBOARD_BUILD_MISSING`：若 source import 與 dist fallback 都不可用，提示執行 `pnpm build`。
- `DASHBOARD_PORT_IN_USE`：8787 被非 ST Workspace 程式占用；提示關閉占用程式後重試。
- `DASHBOARD_START_FAILED`：server 啟動失敗；顯示原始錯誤摘要。
- `DASHBOARD_HEALTH_TIMEOUT`：在限制時間內沒有 ready；關閉本次建立的 server 並提示查看錯誤。
- `DASHBOARD_BROWSER_OPEN_FAILED`：只警告，提供手動 URL，不中止 server。

錯誤不得偷偷改 port、建立預設專案或改寫使用者專案資料。

## 關閉語義

若 Launcher 建立了 server：

- `Ctrl+C`、`SIGINT`、`SIGTERM` 與正常 process shutdown 都應嘗試呼叫 `server.close()`。
- `server.close()` 會沿用既有 server 行為停止 WorkspaceWorker。
- 關閉過程應具備一次性 guard，避免重複 close。

若 Launcher 只是沿用既有 server：

- 顯示「已沿用既有 ST Workspace 服務」。
- 關閉 Launcher 不得呼叫遠端 shutdown 或終止其他 process。
- 因 Launcher 沒有需要維持的服務，可在開啟瀏覽器後提示使用者既有服務仍由原程序管理，然後正常結束。

Windows 直接按視窗右上角關閉時無法保證 JavaScript cleanup handler 一定完整執行，但因新 server 與 Launcher 位於同一 process，不會留下另一個 Node child process。

## 安全範圍

- 只綁定 `127.0.0.1`。
- 固定本機模式不要求 auth token。
- 不開放 LAN 或外部 host。
- 不把 token、專案內容或路徑寫入命令列參數。
- Launcher 不修改專案 state，只啟動既有 server/runtime。

## 測試與驗收

### 自動測試

1. Launcher 的 endpoint 判定：沒有服務、有效 ST Workspace health、非 ST health、timeout。
2. Health response 包含穩定的 `service: "st-workspace-v3"`，並保留既有欄位。
3. `opencode.jsonc` 使用 remote MCP `http://127.0.0.1:8787/mcp`，不再啟動 local MCP bridge。
4. Launcher 擁有 server 時會在 shutdown 關閉；沿用 server 時不會關閉它。
5. 瀏覽器開啟失敗不會停止健康 server。
6. CMD 從其他目前工作目錄啟動時仍能定位工作區。

### 手動驗收

1. 雙擊 `ST-Workspace-Dashboard.cmd`。
2. Dashboard 自動在預設瀏覽器開啟。
3. Dashboard 顯示 `projects/` 中的專案且可以正常切換。
4. 另開終端，在工作區啟動 OpenCode。
5. `opencode mcp list` 顯示 `st-workspace` 已連線。
6. OpenCode 可以讀取 workspace status，Dashboard 同步看到 operation／artifact 變化。
7. 系統中只有一個 ST Workspace server/worker。
8. 關閉 Launcher 後，Dashboard 與 OpenCode MCP 連線停止。
9. 先啟動另一個 ST Workspace server 再雙擊 CMD，Launcher 沿用它且不重複啟動。
10. 讓非 ST 程式占用 8787，CMD 顯示明確錯誤且不建立第二個 port。

## 不在本次範圍

- 不封裝 Node.js、pnpm 或整個 workspace 為單一 EXE。
- 不自動安裝 dependencies。
- 不自動執行 OpenCode。
- 不加入系統匣、Windows Service、自動更新或開機啟動。
- 不修改 Dashboard 畫面或角色卡工作流。
- 不處理外部網路存取與 TLS。
- 不讓 Agent 自行啟動或關閉 Dashboard server。

## 完成定義

使用者可透過一個 CMD 雙擊啟動固定的本機 ST Workspace server 和 Dashboard；OpenCode 透過 remote MCP 連到同一個 `/mcp`，不再建立第二個 runtime。錯誤、port 衝突與服務所有權均有明確行為，且關閉 Launcher 不會留下它建立的獨立 server process。
