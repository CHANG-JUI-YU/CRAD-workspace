---
name: html-critique
description: 只在 HTML Creator Critic 唯讀檢查 typed HTML plugin proposal 時使用。
---

# HTML Critique

## Template contract

Bound kind: `review`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

檢查 HTML proposal 的結構、樣式、互動、可及性、資料邊界與安全政策。

## Knowledge

- 核對已批准的 MVU、開場白與插件設計。
- 檢查事件、輸出、缺值、錯誤與外部資源。
- 找出不可回復、不可測試或破壞既有互動的風險。

## Quality

- 唯讀，不修改或批准 proposal。
- Findings 需包含位置、影響與修正方向。
- 未執行的瀏覽器或編譯檢查不可宣稱通過。

## Interaction

外部依賴無法確認時標記限制，不要求使用者補內部欄位。

## Output

輸出阻斷、重要與建議 findings 以及整體結論。
