# Legacy v1 隔離清單

隔離日期：2026-07-13

舊系統已移至根目錄 `.legacy-v1/`，並由 `.gitignore` 排除。vNext 沒有相容 shim，也不會載入其中的 MCP、Dashboard、Agent、草稿或輸出。

## 隔離內容

- `drafts/`：13 個頂層專案、478 份 YAML；既有檢查確認 140 份無法解析。
- `exports/`：10 份 JSON、5 份診斷 Markdown。
- `dashboard/`：舊 Next.js Dashboard、lockfile、build cache 與 dependencies。
- `mcp-servers/`：舊 `st-forge` MCP、dist、node_modules 與備份原始碼。
- `.agents/`、`.opencode/`、`translations/`、舊 `opencode.jsonc`。
- 9 個根層一次性 Python/JavaScript 修復與測試腳本及歷史文字檔。

## 關鍵檔 SHA-256

| 隔離檔案 | SHA-256 |
|---|---|
| `.legacy-v1/opencode.jsonc` | `FF6803D84FF4928E6A310C4ACC9F631DBBEBF25FB8F37BD7C11940A097DEB10A` |
| `.legacy-v1/mcp-servers/st-forge/src/index.ts` | `AB7378763DC72964C99CAB65F22DA899B72D190A886E03B28E1BBC186A06BB20` |
| `.legacy-v1/mcp-servers/st-forge/src/tools/assembly.ts` | `02224E0C1B160389079E936A488EBEBA3BABEADF4108E6CFB63C2F494EA53219` |
| `.legacy-v1/dashboard/package-lock.json` | `10638709C7C2787C525976CAC62624ECC53C19A813CCFB5041E7EF1D14998C7E` |

完整使用者資料以使用者在切換前建立的外部備份為權威；此目錄只供重建期間核對，不屬於 vNext 正式資料模型。
