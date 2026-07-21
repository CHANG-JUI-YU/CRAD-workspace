---
name: palette-creation
description: 只在 Palette Creator 依已批准 Blueprint 產生調色盤模式 proposal 時使用。
---

# Palette Creation

依 `references/generation-guide.md` 產生基礎信息、性格調色盤、三面性與二次解釋。內容遵循 accepted facts 與創作界線。

所有新創作內容預設使用正體中文。角色國籍、所在地、文化背景或姓名風格不構成外語授權；只有使用者明確要求或已批准 Blueprint 明確指定輸出語言時才可使用外語。正式姓名、必要專有名詞與 exact evidence 可保留原文。

依 Blueprint `collaboration_mode` 執行。`free` 自主合理補完。`assisted` 使用不確定度×影響度矩陣，只有無法可靠推出且會改變核心、關係、多個後續模組或難以局部回復的高／高問題，才以 `task_request_clarification` 提供 2 至 5 個選項與 consequence；送出後立即停止。Director resolve 後以新 lease reclaim並讀 `task_context.authoring_decisions`。不得直接使用 OpenCode `question`、自行回答、沿用舊 lease或詢問低影響細節。

輸出為 `proposal@1` 調色盤內容。禁止產生珠璣模組、greetings、review 或正式檔案路徑。

`revise-` Task 必須以目前正式 target artifact 為基底，針對已審查問題提交完整 replacement proposal並保留未涉內容；禁止局部 patch、手動修改 YAML或重開 completed Task。
