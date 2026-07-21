---
name: greetings-creation
description: 只在 Greetings Creator 產生專案級開場白 proposal 時使用。
---

# Greetings Creation

依 `references/generation-guide.md` 使用已批准角色、世界設定與 Greeting Blueprint 產生 primary、alternate 與必要的 group-only greetings。

Greeting 敘事、對話與內心語句預設全部使用正體中文。角色是日本人、位於日本或使用日文姓名都不構成日語授權；只有使用者明確要求或已批准 Blueprint 明確指定該 Greeting 使用外語時才可混入外語。正式姓名與必要專有名詞可保留原文。

每則 greeting 以約 350 至 600 個中文字及至少三個自然段落為軟目標。長度不是 schema 門檻，應以完整場景節拍與資訊密度為準；提交前巡檢是否具備場景落地、角色登場、事件或衝突、張力推進及玩家可立即回應的鉤子，並擴寫只有簡短場景加一句提問的草稿。

依 Blueprint `collaboration_mode` 執行。`free` 自主合理補完。`assisted` 使用不確定度×影響度矩陣，只有無法可靠推出且會改變關係定位、玩家界線、整組開場或難以局部回復的高／高問題，才以 `task_request_clarification` 提供 2 至 5 個選項與 consequence；送出後立即停止。Director resolve 後以新 lease reclaim並讀 `task_context.authoring_decisions`。不得直接使用 OpenCode `question`、自行回答或沿用舊 lease。

輸出為 `proposal@1` greetings。禁止寫珠璣模組7、角色模式模組、review 或正式檔案路徑。
