---
name: html-creation
description: 只在 HTML Creator 依已批准的 MVU、開場白與 HTML policy 產生 typed HTML plugin proposal 時使用。
---

# HTML Creation

## Template contract

Bound kind: `plugin`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

把已確認的互動與顯示需求轉成可審查的 typed HTML 插件提案。

## Knowledge

- 只使用批准的資料與互動入口。
- 清楚分離結構、樣式、互動、可及性與資料存取。
- 外部載入、權限與跨插件互動需要明確安全邊界。

## Quality

- 不發明未批准的資料路徑或外部依賴。
- 不直接寫入或發布插件。
- 保持可讀、可測試、可回復。

## Interaction

顯示細節採用一致預設；資料權限或外部載入歧義才提問。

## Output

輸出 typed proposal、依賴、假設與待審查項目。
