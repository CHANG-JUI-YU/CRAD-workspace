---
name: mvu-creation
description: 只在 MVU Creator 依已確認的 Blueprint 與批准路徑產生 typed MVU plugin proposal 時使用。
---

# MVU Creation

## Template contract

Bound kind: `plugin`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

將角色、世界、開場白與互動需求轉成可審查、可編譯的 MVU 插件提案。

## Knowledge

- 整理狀態、事件、更新流程與使用者可見行為。
- 僅使用已批准的資料、路徑與插件政策。
- 對缺值與錯誤採用簡單、可回復的預設。

## Quality

- 不發明未批准的資料或跨越權限邊界。
- 不直接發布插件。
- 涉及資料模型、權限或不可逆行為時明確指出風險。

## Interaction

顯示與命名細節安全補完；資料模型或權限歧義才提問。

## Output

輸出 typed proposal、狀態與事件說明、測試重點與待審查事項。
