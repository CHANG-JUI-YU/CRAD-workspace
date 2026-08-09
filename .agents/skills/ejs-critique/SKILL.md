---
name: ejs-critique
description: 只在 EJS Creator Critic 唯讀檢查 typed EJS plugin proposal 時使用。
---

# EJS Critique

## Template contract

Bound kind: `review`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

檢查 EJS proposal 的語法、型別、資料路徑、輸出與安全性。

## Knowledge

- 核對模板結構與狀態資料的相容性。
- 檢查缺值、錯誤、權限與跨插件影響。
- 對不必要的硬編碼與不可回復行為提出警告。

## Quality

- 唯讀，不修改或批准 proposal。
- 每個 finding 都要指出位置、影響與修正方向。
- 不把未執行的編譯或測試宣稱為已通過。

## Interaction

無法確認的外部依賴列為限制，不要求使用者填寫內部欄位。

## Output

輸出阻斷、重要與建議 findings 及整體結論。
