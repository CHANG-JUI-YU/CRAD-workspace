# OpenCode remote MCP 整合

本 repository 的正式 topology 是單一 server：

```text
Windows Dashboard launcher 或 direct CLI/server
        ↓
唯一的 ST Workspace HTTP/MCP server
        ↓
Dashboard 與 OpenCode remote MCP client 共用
```

OpenCode 不會啟動第二個 ST Workspace runtime，也不負責停止 server。
OpenCode 設定中的 `st-workspace` 是 remote MCP：

```text
http://127.0.0.1:8787/mcp
```

## A. Windows Dashboard launcher

從工作區根目錄雙擊 `ST-Workspace-Dashboard.cmd`，或在命令提示字元執行：

```text
ST-Workspace-Dashboard.cmd
```

launcher 會先檢查 Node.js >= 20、pnpm 與 root `tsx`，再執行 `pnpm -r build`。
build 失敗時不會啟動 server。成功後，`tools/dashboard-launcher.ts` 使用固定的
`127.0.0.1:8787`，提供：

- Dashboard：`http://127.0.0.1:8787/`
- health：`http://127.0.0.1:8787/workspace/health`
- MCP：`http://127.0.0.1:8787/mcp`

launcher 先 probe health 與 runtime revision：

- 沒有服務：建立唯一 server；launcher process 擁有該 server。
- 已有相同 revision 的 ST Workspace server：沿用它；既有 server process 擁有
  server，launcher 關閉不會停止它。
- revision 缺失或不同：回報 `DASHBOARD_SERVICE_STALE`，要求關閉舊 Dashboard
  後重啟。
- port 被其他服務占用、HTTP 回應不是 ST Workspace 或 probe 逾時：回報
  `DASHBOARD_PORT_IN_USE` 或 `DASHBOARD_HEALTH_TIMEOUT`，不會偷偷換 port。
- build、Node.js 或 pnpm 問題：回報對應 `DASHBOARD_*` 錯誤，不啟動服務。
- launcher 沒有提供 auth token；若 8787 上的是需要認證的 server，health probe
  會被視為不相容服務而失敗。

只有 launcher 自己建立 server 且收到 `SIGINT`／`SIGTERM` 時，`tools/dashboard-launcher.ts`
才會關閉該 server 與 worker。因此 `Ctrl+C` 只保證嘗試停止 launcher 自己擁有的
server；reuse 情形的既有 server 必須由它原本的 owner 停止。browser 開啟失敗只會
顯示 warning，不會關閉已經 ready 的 server。

## B. Direct CLI/server launch

先建立 workspace，再選擇其中一個正式命令：

```text
pnpm build
pnpm --filter @st-workspace/cli start serve
```

或直接執行 server package：

```text
pnpm --filter @st-workspace/server start
```

兩者都由目前的 terminal process 擁有 server；以 `Ctrl+C` 或終止該 process
停止它，server close 時會停止 worker。預設是：

- host：`127.0.0.1`
- port：`8787`
- project root：`projects`
- MCP endpoint：`http://127.0.0.1:8787/mcp`

可用環境變數：

- `ST_WORKSPACE_HOST`：direct CLI/server 的 bind host；Windows launcher 不讀取它。
- `ST_WORKSPACE_PORT`：direct CLI/server 的 port；Windows launcher 固定使用 8787。
- `ST_WORKSPACE_PROJECT_ROOT`：projects root。
- `ST_WORKSPACE_PROJECT`：選定既有 project。

非 loopback host 會被 `startWorkspaceServer` 拒絕，除非呼叫端以 API option
`authToken` 提供非空 token。現有 CLI 與 package `start` 命令沒有 `--auth-token`
或 token 環境變數入口；因此不要把 `ST_WORKSPACE_HOST` 改成外部 bind 後，誤以為
README 中不存在的 flag 可以啟用認證。若由程式以 `authToken` 啟動，請以
`Authorization: Bearer <token>` 呼叫；Dashboard 的 GET bootstrap 也依 server
目前行為支援 query token。token 不得寫入 repository。

若 direct server 使用自訂 port，Dashboard 可以用該 port，但 checked-in
`opencode.jsonc` 仍指向 8787；OpenCode remote MCP 設定也必須在不提交 secret 的
前提下同步改成相同 endpoint。

## C. OpenCode remote MCP

`opencode.jsonc` 的 `mcp.st-workspace` 使用：

```jsonc
{
  "type": "remote",
  "url": "http://127.0.0.1:8787/mcp",
  "enabled": true,
  "oauth": false
}
```

正確順序是：

1. 先啟動 Windows launcher 或 direct CLI/server。
2. 確認 `GET /workspace/health` ready。
3. 再從工作區根目錄啟動或重啟 OpenCode。
4. 用 `opencode mcp list --pure` 檢查 remote MCP 狀態。

server 尚未啟動、port 不同或 server 被 firewall／auth 擋住時，OpenCode 只會顯示
MCP 無法連線；它不會啟動 fallback local runtime。若設定或 prompt mount 修改，
已開啟的 OpenCode session 需要重開工作區或重啟 TUI，才會重新載入工具與 Agent。

checked-in config 是 loopback、`oauth: false` 的無 secret 預設。repository 不保存
Bearer token；若部署使用者的 OpenCode 版本提供 remote MCP credential/header 設定，
應在 OpenCode 的使用者層設定，並與 server 的 `authToken` 配對，而不是修改提交檔案
寫入 secret。

## D. Legacy helper

`tools/opencode-mcp.ts` 是保留的 legacy／diagnostic stdio bridge。它會啟動一個
短生命週期的本機 server，再把 stdin JSON-RPC 轉送到 ephemeral MCP endpoint，僅供
診斷舊整合或手動 protocol 測試；它不是主要安裝、啟動或 `opencode.jsonc` 路徑。

正式整合只使用上一節的 remote MCP 與既有 Dashboard/direct server owner。除非
repository-wide search 證明沒有任何 legacy/diagnostic 使用者，否則不刪除這個 helper。
