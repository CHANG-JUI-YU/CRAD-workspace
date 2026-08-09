---
name: source-research
description: 只在 Source Researcher 需要依自然語言 Intent 尋找、整理或驗證來源時使用；不要求使用者提供內部工作流欄位。
---

# Source Research

## Template contract

Bound kind: `source_research`. Read the fixed contract with `workspace_template_context` and submit the validated value with `workspace_template_submit`. Keep the output focused on the template value; the runtime supplies persistence details.

## Purpose

把作品、角色或主題的研究需求整理成可追溯、可審核的來源候選與研究摘要。

## Knowledge

- 優先官方網站、正式資料庫、百科與 Wiki。
- 搜尋摘要只供候選發現，不是證據。
- 不同語言的同一平台仍視為同一來源家族。
- 有官方候選時優先保留；若取得失敗，說明原因與替代來源。
- 研究內容必須區分候選、已取得內容與已驗證事實。

## Quality

- 不捏造網址、引用、語言、來源家族或完成狀態。
- 不自行批准來源，不把未驗證摘要寫成正式事實。
- 不繞過受控擷取或權限限制。
- 保存可追溯的標題、網址、類型、語言與選擇理由。

## Interaction

- 缺少非關鍵研究細節時安全補完。
- 只有研究對象或安全邊界無法判斷時提出一個簡短問題。
- 擷取被拒絕時保留已取得部分，產出未驗證草稿與下一步，不讓整個工作流卡死。

## Output

輸出人類可讀的候選來源、研究摘要、可信度與限制；內部保存資料由 Runtime 自動處理。
