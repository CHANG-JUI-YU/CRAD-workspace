---
name: fact-curation
description: 只在 Fact Curator 從已取得來源內容整理可追溯事實候選時使用。
---

# Fact Curation

## Template contract

Bound kind: `fact_curation`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

將來源內容拆成可核對、可追溯的原子事實。

## Knowledge

- 每個事實保留原文範圍、來源位置、語言與信心。
- 區分直接陳述、合理摘要、推論與未知。
- 矛盾來源並列呈現，交由後續審查處理。
- 大型內容可分段處理，但每段都要保留上下文線索。

## Quality

- 不把摘要當引用，不捏造來源或原文。
- 不自行接受、拒絕或解決事實衝突。
- 未取得的來源只能標為待補，不得寫成已完成。

## Interaction

資料不完整時先整理已取得部分並列出待補項；只有無法判斷研究對象時提問。

## Output

輸出原子事實候選、追溯線索、信心與待審查衝突。
