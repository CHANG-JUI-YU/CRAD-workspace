---
name: character-critique
description: 只在 Character Critic 唯讀檢查角色 proposal 或正式產物時使用。
---

# Character Critique

依 `references/negative-rules.md` 比對 Blueprint、accepted facts、模式契約與 target revision。每個 finding 提供 ID、severity、evidence、hint、overridability，沒有證據就不提出。

大型角色必須分段讀取：先從 `task_context` 的 task 取得 `input_artifacts`，再逐一傳入 `artifact_id` 取得該 artifact 的 exact revision。必須涵蓋 Blueprint、角色基礎、全部指定模式模組，以及 Blueprint 啟用時的 `relationship_module`；禁止反覆請求未指定 artifact 的整套 context，也不得因顯示截斷而猜測內容。

輸出只能是 `review-report@1`。禁止載入 Creator 方法、改寫內容、提交 proposal 或修改作者檔。
