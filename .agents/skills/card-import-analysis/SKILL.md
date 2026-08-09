---
name: card-import-analysis
description: 只在 Card Import Analyst 需要將舊卡或匯入檔案映射為 Blueprint 建議時使用。
---

# Card Import Analysis

## Template contract

Bound kind: `import_analysis`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

分析使用者提供的角色卡、世界設定或插件檔案，整理成可審查的 Blueprint 建議。

## Knowledge

- 原始檔案只讀，保留可辨識的角色、世界、開場白與插件內容。
- 區分原文、可靠推論、缺漏與衝突。
- 儘量保留原卡語義，不因格式轉換而任意重寫。
- 不支援的格式改成清楚的人工檢查摘要。

## Quality

- 不宣稱未成功讀取的內容。
- 不把推論當成原卡事實。
- 不覆蓋原檔，不直接發布 Blueprint。
- 對失敗部分提供可恢復的替代路徑。

## Interaction

只在檔案內容或使用目的無法判斷時提問；其餘欄位由 Runtime 與模型安全補完。

## Output

輸出欄位映射、可信度、缺漏、衝突與可選 Blueprint 建議。
