# OpenCode 整合

工作區的 OpenCode 入口由根目錄的 `opencode.jsonc` 設定。設定包含兩個必要部分：

- `st-workspace` local MCP：由 `tools/opencode-mcp.ts` 啟動工作區引擎，將引擎的 JSON-RPC 工具掛載到 OpenCode。
- Director 的 `question: allow` 權限：允許 Director 使用 OpenCode 原生互動式選單。

## 啟動與確認

請從 `C:\AI\projects\ST-workspace-v3` 啟動 OpenCode。工作區 MCP 應顯示為 connected：

```text
opencode mcp list --pure
```

如果先前已經開啟 OpenCode，請重開工作區或重啟 TUI。Agent 與 MCP 工具清單是在會話開始時建立的，舊會話不會自動取得新掛載。

訪談開始後，Director 會先呼叫 `workspace_interview_context`，再使用原生 `question` 一次呈現一題；使用者回答後才呼叫 `workspace_interview_answer`，由引擎保存答案並回傳下一題。

`tools/opencode-mcp.ts` 會優先載入 TypeScript 原始碼，因此修改伺服器後不會誤用舊的 `dist` 快照；只有在原始碼無法載入的乾淨 checkout 才會先執行 `pnpm build`。
