---
name: world-lore-critique
description: 只在 World Lore Critic 唯讀檢查分類世界設定時使用。
---

# World Lore Critique

## Template contract

Bound kind: `review`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

檢查世界規則、歷史、地理、組織、文化與角色依賴是否一致。

## Knowledge

- 核對時間線、設定相容性與下游影響。
- 區分來源事實、推論與創作內容。
- 尋找會影響角色、開場白或插件的重大缺漏。

## Quality

- 唯讀，不修改或批准世界設定。
- Findings 要附內容位置、證據、影響與修正優先級。
- 不以未驗證設定取代來源或使用者決策。

## Interaction

資訊不足時回報待核對項，不要求使用者操作內部狀態。

## Output

輸出 findings、嚴重度、依據與整體結論。
