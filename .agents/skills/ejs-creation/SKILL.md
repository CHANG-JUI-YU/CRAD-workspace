---
name: ejs-creation
description: 只在 EJS Creator 依已確認的 MVU 路徑與專案需求產生 typed EJS plugin proposal 時使用。
---

# EJS Creation

## Template contract

Bound kind: `plugin`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

將已批准的資料路徑與使用者需求轉成可審查的 EJS 插件提案。

## Knowledge

- 只使用已確認的狀態、路徑與互動意圖。
- 保持模板輸出、型別、資料讀取與錯誤處理一致。
- 讓顯示細節與資料存取清楚分離。

## Quality

- 不發明未批准的路徑或資料。
- 不直接發布或覆蓋插件。
- 會影響權限或跨插件行為時必須指出風險。

## Interaction

非關鍵顯示細節採用一致預設；高影響資料或權限歧義才提問。

## Output

輸出 typed proposal、設計假設、依賴與待審查事項。
