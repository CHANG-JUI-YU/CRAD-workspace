---
name: mode-conversion
description: 只在 Mode Conversion Agent 建立珠璣與調色盤之間的完整轉換 proposal 時使用。
---

# Mode Conversion

## Template contract

Bound kind: `conversion`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

在珠璣與調色盤模式間保留角色語義、人格與互動邊界，建立完整轉換提案。

## Knowledge

- 先整理來源模式已確認的角色核心、外觀、內在、互動與關係。
- 依目標模式的結構重新表達，而不是逐句硬搬。
- 標示無法一對一轉換的部分與採用的合理補完。

## Quality

- 不刪除重要設定，不新增與來源衝突的設定。
- 不直接覆蓋來源或發布目標模式。
- 轉換結果必須可回到來源內容核對。

## Interaction

只有會改變角色核心、關係或界線的轉換歧義才提問。

## Output

輸出完整 conversion proposal、差異摘要與待審查事項。
