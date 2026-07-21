# 專案交易模型

## 不變量

1. 作者檔案只能位於已解析的 project root 內。
2. Patch 必須提供目標文件的 canonical SHA-256 base revision。
3. Patch 先在記憶體 clone 預演，再通過目標 schema。
4. 實際修改會在同一交易內更新 `workflow.json` revision。
5. No-op 不建立交易，也不增加 workflow revision。
6. `.build/`、`.transactions/`、exports 與未歸屬檔案不可透過 Patch 修改。

## 發布流程

```text
取得 project.lock
→ 驗證 semantic base revision
→ 預演 RFC 6902 patch
→ 驗證 Project/Workflow/Policy schema
→ 驗證所有受影響檔案 raw revision
→ 寫同 volume staged files 並 flush
→ 寫 prepared journal
→ 將舊檔 rename 至 transaction backup
→ 將 staged files rename 至正式位置
→ 寫 committed journal
→ 釋放 project.lock
```

Windows 不允許用 rename 覆蓋既有檔案，因此發布採「舊檔移至交易備份，再將 staged 檔移入」；任一步驟失敗時按反向順序還原。

## Crash Recovery

每個 journal 位於 `<project>/.transactions/<uuid>/journal.json`。若下次取得鎖時發現前一個 lock 的 PID 已不存在，Forge 會掃描 `prepared` journal：

- 有 backup：移除可能已發布的新檔，再把 backup rename 回原位。
- 原檔本來不存在：移除可能已發布的新檔。
- journal 改標為 `recovered`，保留供診斷。

活著的 lock owner 不得被自動接管；第二個 writer 必須收到 `TRANSACTION_LOCKED`。

## Revision 分工

- Canonical revision：`sha256:<64 hex>`，用於單一結構化文件的樂觀鎖。
- Workflow revision：非負整數，代表專案已提交交易次數。
- Raw revision：交易發布前再次比對檔案 bytes，攔截預演後、rename 前的競態修改。

三者用途不同，不得互相冒充。

## Sources/Facts 交易

Sources/Facts 不提供任意檔案 writer。`@card-workspace/ingestion` 只能寫入 ownership allowlist 中的 snapshot、revision、projection、chunk、job、candidate、journal 與目前狀態投影；一般 author patch 不能修改這些路徑。

一次領域動作所需的不可變 artifact、journal event 與可讀投影必須在同一 `runFileTransaction` 發布。例如 intake 同時建立 snapshot/revision/projection、追加 source event 並更新 manifest；fact review 同時追加 decision event並更新 register/conflicts。Create-only artifact 使用 `expectedAbsent`，狀態與 journal 使用 raw revision expectation，避免重試覆蓋或 stale writer。

Snapshot、revision、chunk set、chunk 與 candidate batch 發布後不可原地修改。JSONL 是邏輯 append-only，但實體上仍由交易以完整 canonical 內容替換；禁止繞過交易直接 append。

Crash recovery 只處理 prepared transaction 的完整回滾，不推測領域事件。`verifyFactProjection` 用於檢查 journal/immutable artifacts 與投影等價；`rebuildFactProjection` 只在 journal 完整合法時交易式重建投影。若不可變 artifact 或 journal 損壞，rebuild 必須失敗並保留現場，不得用目前 YAML 反向覆寫歷史。
