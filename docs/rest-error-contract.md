# REST 錯誤契約

本文件定義 Dashboard HTTP API 的錯誤回應結構、HTTP status 對應規則，以及 idempotent mutation 的約定。對應 issue #146（Normalize REST error bodies and semantic HTTP status mapping）。

## 錯誤回應結構

所有錯誤回應使用單一 envelope（v1，由 `restError()` 產生）：

```json
{
  "code": "REQUEST_REQUIRED",
  "category": "input",
  "recoverable": true,
  "message_zh": "缺少必要輸入。",
  "impact": "此請求未執行。",
  "next_actions": ["補齊必要欄位後重新送出。"],
  "details": {},
  "uncatalogued_code": null
}
```

欄位說明：

- `code`：stable 結構化錯誤碼（與 `ERROR_CATALOG` 一致）。
- `category`：錯誤分類（input/agent/project/blueprint/review/source/template/image/build/quality/import/operation/repair/storage/coverage/auth/internal）。
- `recoverable`：是否可重試／修正後重送。
- `message_zh`：對使用者安全的繁體中文訊息（來自目錄，絕不內含內部例外字串）。
- `impact`：此錯誤對操作狀態的影響。
- `next_actions`：建議的下一步動作。
- `details`（選用）：安全的額外診斷欄位（目錄或例外明確標註為可揭露時才有）。
- `uncatalogued_code`（選用）：僅當例外碼未收錄於目錄時出現，供 client 診斷；回應的 `code` 會是 `INTERNAL_ERROR`。

envelope **不包含**內部例外訊息、stack trace、內部路徑、token 或任何未分類的原始訊息。內部診斷內容只寫入 server console（`[rest-error]` 前綴）。

## HTTP status 對應

由 `httpStatusFor()` 依錯誤碼決定，規則如下：

| 情境 | status | 規則 |
| --- | --- | --- |
| 輸入／schema 驗證失敗 | 400 | `category=input` 或 `recoverable=true` 且無更特定規則 |
| 未授權 | 401 | `UNAUTHORIZED` |
| 權限不足（agent 限制） | 403 | `AGENT_CAPABILITY_DENIED`、`AGENT_READ_ONLY` |
| 找不到資源 | 404 | `NOT_FOUND` 或以 `_NOT_FOUND` 結尾的碼 |
| 資源或狀態衝突 | 409 | `REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT` |
| 請求體過大 | 413 | `REQUEST_TOO_LARGE` |
| 內部非預期錯誤 | 500 | `INTERNAL_ERROR` 或 `recoverable=false` |
| 不支援操作 | 405 | 目前無 route 產生；未來若新增 method 衝突路由時使用 |

mapping 是單一函數（`httpStatusFor`），所有 REST 錯誤統一由此決定 status，不允許 endpoint 特判。

## Idempotent mutation 約定

下列 mutation 對「目標已缺失」採 idempotent 語意（重複執行不視為錯誤，回傳成功與現況）：

- `POST /workspace/images/remove`：目標 image 已不存在時回 `200 { status: "not_found", image_id }`，不視為錯誤。

其餘 mutation 的目標缺失一律以 404 表示（`*_NOT_FOUND`）。

## 診斷對照

每個錯誤回應不帶 correlation id；如需對照 server 診斷，以 `code` 與請求時序即可對應到 `[rest-error]` console 輸出。
