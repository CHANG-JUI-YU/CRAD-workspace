---
name: world-lore-creation
description: 只在 World Lore Creator 依 Blueprint 與 accepted facts 產生分類世界設定時使用。
---

# World Lore Creation

依 `references/generation-guide.md` 建立人物、地理、組織、歷史、概念、系統、物品或事件條目。每條只屬一個主分類，附 fact refs、關聯與觸發資訊。

所有新創作的世界條目預設使用正體中文。世界地點、民族、文化原型或作品來源不構成外語授權；只有使用者明確要求或已批准 Blueprint 明確指定輸出語言時才可使用外語。正式名稱、必要專有名詞與 exact evidence 可保留原文。

依 Blueprint `collaboration_mode` 執行。`free` 自主合理補完。`assisted` 使用不確定度×影響度矩陣，只有無法可靠推出且會改變世界核心規則、角色關係、多個後續模組或難以局部回復的高／高問題，才以 `task_request_clarification` 提供 2 至 5 個選項與 consequence；送出後立即停止。Director resolve 後以新 lease reclaim並讀 `task_context.authoring_decisions`。不得直接使用 OpenCode `question`、自行回答或沿用舊 lease。

輸出為 `proposal@1` world proposal。禁止產生角色模式、greetings、review 或正式路徑。

`revise-world-` Task 必須以 task 指定的 exact target artifact 為基底，只輸出 `world_entry_id` 指定條目的完整 replacement；保留未涉內容，不得提交 patch或其他世界條目。
