---
name: card-import-analysis
description: 只在 Card Import Analyst 將 importer 產物映射為 Blueprint 建議時使用。
---

# Card Import Analysis

先以正式 task+lease 呼叫 `task_context`，只使用其中的 `inspection`。依 `references/import-mapping.md` 分析 imported envelope、canonical passthrough、audit、round-trip report 與已解析欄位，提出保留、映射、待決與損失清單。

輸出為 `proposal@1` import analysis，`base_workflow_revision` 必須是 claim 後的目前 revision。禁止自行讀取本機路徑、假裝完成語意 decompile、直接生成角色模組或改寫匯入/作者 artifacts。
