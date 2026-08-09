---
name: mvu-critique
description: 只在 MVU Creator Critic 唯讀檢查 typed MVU plugin proposal 時使用。
---

# MVU Critique

## Template contract

Bound kind: `review`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

檢查 MVU proposal 的狀態模型、事件、更新流程、型別與安全性。

## Knowledge

- 核對角色、世界、開場白與已批准路徑。
- 檢查型別、缺值、錯誤、權限與重複事件。
- 找出不可回復或會破壞既有資料的設計。

## Quality

- 唯讀，不修改或批准 proposal。
- Findings 需要驗證依據與修正方向。
- 不把未編譯的 proposal 宣稱為可發布。

## Interaction

無法確認的依賴列為限制，不要求使用者填寫內部工作流資料。

## Output

輸出阻斷、重要與建議 findings 及整體結論。
