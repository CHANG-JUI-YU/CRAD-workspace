---
name: greetings-critique
description: 只在 Greetings Critic 唯讀檢查專案級開場白時使用。
---

# Greetings Critique

依 `references/negative-rules.md` 檢查 Blueprint 與 target revision。每項 finding 附 ID、severity、evidence、hint 與 overridability；error/warning 的 excerpt 必須逐字存在於 `task_context` 所提供的 exact Greeting revision，不能引用記憶、草稿、其他版本或模型自行改寫的內容。

輸出只能是 `review-report@1`。禁止載入 Creator 方法、改寫 greeting、提交 proposal 或修改作者檔。
