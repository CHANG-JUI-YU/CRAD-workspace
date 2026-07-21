# Foundation 測試策略

## 品質閘門

每次變更必須依序通過：

```powershell
pnpm build
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm audit --prod --audit-level high
```

CI 在 Windows 與 Linux 各執行一次，安裝一律使用 frozen lockfile。正式 `projects/`、`exports/`、來源文本與秘密不得上傳為測試 artifact。

## 測試隔離

- 所有 I/O 測試使用 OS temp directory。
- Fixture builder 不複製 production parser 或 validator 邏輯。
- 每個測試結束後遞迴清除現場。
- `.legacy-v1/`、正式 `projects/` 與 `exports/` 不得成為測試輸入或輸出。

## 必備風險案例

- Stable ID、路徑 traversal、Windows drive-relative、UNC、alternate data stream。
- Prefix collision 與 symlink/junction 越界。
- YAML 重複 key、JSON/YAML 語法錯誤、UTF-8 與檔案大小限制。
- Canonical JSON 的 key order、Unicode、換行與 property-based 冪等性。
- RFC 6902 base revision、prototype pollution、schema-invalid 結果與 no-op。
- 多檔交易故障注入、advisory lock、stale writer、prepared journal 恢復。
- CLI 的 init、validate、query、dry-run 與 apply 端到端一致性。
- Sources/Facts 的不可變 intake、revision、分片、lease/CAS、精確 evidence、decision journal、projection rebuild 與 provenance gate。
- CLI 的 source add/chunk/status/verify、fact query 與 provenance verify 端到端一致性。

Coverage 是風險指標，不取代上述 fixture。新增安全或交易分支時，必須先加入可重現的失敗測試。

自動門檻為 statements/lines 85%、functions 85%、branches 80%。路徑與交易程式另以必備風險案例作情境門禁，避免為了命中作業系統或 Node 內部錯誤分支而使用脆弱的檔案系統 mock。
