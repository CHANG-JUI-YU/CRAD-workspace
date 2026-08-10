# ST Workspace v3 Dashboard 獨立前端骨架設計

## 目標

在不改動 workflow、domain、compiler、runtime 或 adapters 語意的前提下，將
`packages/server/src/index.ts` 的內嵌 Dashboard 拆成可維護的專用模組，提供
一個中文、響應式、可離線使用的本機網頁工作台。Dashboard 只呼叫既有 REST
endpoint，並以 API 實際回傳的 schema 為權威；對可能新增或未知的回傳欄位採
容錯呈現，不要求使用者填寫內部 runtime 參數。

## 範圍與非目標

Dashboard 本輪提供：

- 專案清單與切換：`GET /workspace/projects`、`POST /workspace/project/select`
- 目前工作流/專案狀態摘要：`GET /workspace/status`
- Agent 清單與選擇：`GET /workspace/agents`
- 自然語言 request：`POST /workspace/request`
- 單題訪談：`GET /workspace/interview/context`、`POST /workspace/interview/answer`
- 重新整理、執行中 loading/disabled、成功/錯誤提示，以及最近回應的摘要與
  可展開原始 JSON
- 沒有 `projectManager` 時的安全空狀態與可用功能提示

本輪不實作 Publish readiness 裁決、artifact/review/fact 寫入、quality
override、打包模式、operation cancel/retry 或 Tavern compatibility verifier。
這些能力只在畫面上以「後續提供」的 disabled 說明呈現，不會偽裝成可用操作。

## 模組與接線

新增 `packages/server/src/dashboard.ts`，唯一責任是輸出 Dashboard 的靜態
HTML、內嵌 CSS 與原生瀏覽器 JavaScript。模組不依賴前端框架、CDN、外部字型、
網路資源或 build pipeline。

`index.ts` 只做兩個最小接線：匯入 Dashboard renderer，並在既有 `GET /`
處理器中回傳它。既有 REST、MCP、CLI 路由與錯誤流程維持原樣。

## 畫面與資料流

頁面以 CSS grid/flex 與窄螢幕 media query 組成以下區塊：

1. 頁首：工作台名稱、目前狀態提示、Refresh。
2. 專案區：由 projects endpoint 產生 select；使用專案名稱，缺少名稱時才
   以可見資料夾名稱/識別值作顯示與提交 fallback，不建立 project ID/path 等
   低階輸入欄位。
3. 狀態摘要區：優先呈現名稱、狀態、revision、角色/mode、operation 等存在
   的欄位；其他原始欄位以通用 key/value fallback 呈現，完整回應放在 details
   的 JSON 中。
4. Agent 區：由 agents endpoint 填入選擇器與清單，使用 DOM API 顯示 id、role、
   description/intents；Director 仍是 API 回傳的預設路由。
5. 自然語言操作區：只送 `{ request, agent? }`，agent 省略時交給 Director。
6. 訪談區：顯示目前 question/current。相容 `options` 與 `choices` 欄位；選項
   若是字串便以字串作 canonical value，若是物件則優先取 `value`、
   `canonical_value` 或 `id` 作提交值，顯示 label/title/text。選項按鈕直接送
   canonical value，也保留文字回答輸入框並只送 `{ answer }`。
7. 最近回應/診斷區：以人類可讀摘要呈現 status、summary、question、錯誤與
   下一步，原始 JSON 以可展開區塊保存。
8. 後續能力區：以 disabled 說明列出明確 deferred 項目。

Initial load 與 Refresh 會重新讀取 projects、status、agents、interview
context；每個呼叫失敗都保留其他區塊並在診斷區顯示錯誤。任何 request、select、
answer 或 refresh 執行期間，表單 controls 與操作按鈕都 disabled，完成後恢復。

## 安全與錯誤處理

- API 回傳、專案名、Agent 描述、狀態值與訪談文字一律透過
  `textContent`、`createElement`、`append`、DOM property 等方式插入；不使用
  `innerHTML`、`insertAdjacentHTML` 或把不可信值拼接進 HTML。
- fetch 先讀取文字再嘗試 JSON parse。非 2xx 會保留 HTTP status/statusText，並
  顯示回應內的 `error`、`code`、`message`（若存在）與可採取的下一步；無法
  解析 JSON 或網路失敗也會提供本機 server/Refresh 的下一步。
- 伺服器不存在 Project Manager、空 project list、缺少未知欄位或欄位型別不同
  時，畫面顯示安全 fallback，不讓頁面初始化失敗。
- 不新增任何低階 runtime 參數到表單或操作面板。

## 測試策略

新增 Dashboard 專用 server 測試，覆蓋：

- `GET /` 回傳 HTML，含主要工作台區塊與五組既有 endpoint 路徑。
- Dashboard script 使用 DOM API 與 `textContent`，不包含 `innerHTML` 或其他
  以不可信資料直接組 HTML 的路徑，作為 XSS regression guard。
- 現有 server test suite 不退化；`pnpm typecheck` 在乾淨 `e5e78cf` 基底上通過。

不執行整個 workspace 的昂貴 e2e。實作完成後只提交允許範圍內的設計、Dashboard
模組、最小 server 接線、Dashboard 測試與 README Dashboard 使用說明。

