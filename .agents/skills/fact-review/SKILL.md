---
name: fact-review
description: 在固定 Review Run 中，對已分派的事實候選逐筆做獨立、可追溯裁決。
---

# Fact Review

## Template contract

Bound kind: `fact_review`. 先讀取 `workspace_template_context` 的
`knowledge.fact_review`，再以 `workspace_template_submit` 提交通過 schema 的
`fact_review` proposal。不要自行猜測 candidate occurrence、source 版本或
chunk hash；context 沒有提供的資料不可填造。

## Review Run contract

- `fact-reviewer-1`、`fact-reviewer-2`、`fact-reviewer-3` 是三個獨立的 reviewer 身分，
  不是 pass-1/pass-2/pass-3，也不是需要三票 quorum 的輪次。
- 三位 reviewer 讀同一個固定 Review Run：同一批 candidate occurrence、同一批 source
  版本、同一個 policy 版本。只處理 context 指派的 occurrence。
- 每個 occurrence 只有一個目前有效的成功裁決。已 `accepted` 或 `rejected` 的 occurrence
  不得再次改寫；`needs_evidence` 可在補足證據後重試，`conflict` 只能交由 Director
  解決。任何競態或 stale projection 都停止並要求重新讀取 context。
- 舊的 `fact_review_passes` 只作歷史相容資料，不得當作新 Gate 的通過條件。

## Decision rules

1. `accept`：必須有至少一筆精確 evidence reference，且 source id、source 版本、quote、
   chunk id/hash（若 context 提供）全部與目前知識庫一致。quote 必須能在來源原文與指定
   chunk 找到；無法驗證就選 `needs_evidence`。
2. `reject`：說明拒絕原因；若引用來源，仍填精確 evidence reference。不要把推測當拒絕證據。
3. `needs_evidence`：資料可能正確但證據不足。不得讓它變成 accepted，並在 reason 說明缺少什麼。
4. `conflict`：來源互相矛盾或無法裁決。不要自行投票或挑一邊，交由 Director。

每筆 decision 都要填 `candidate_occurrence_id`（以 context 為準）、`claim`、`decision`、
`reason`；接受事實時優先使用 context 提供的完整 `evidence_refs`。

## Independent quality checklist

- 分開判斷 identity、trait、event、relationship、world 與 other；不得只因句子通順就接受。
- 檢查 subject/predicate/value/classification 是否彼此一致，並檢查候選的角色／世界覆蓋範圍。
- 引文必須可定位、可重現、不可只寫「官方頁面」等模糊描述。
- 不修改來源、不重抽取、不替其他 occurrence 做決定，不跳過 evidence 或 stale 檢查。

## Output

只提交 schema 要求的 proposal。向使用者回報時只說批次進度、完成數與是否需要補證據／Director
裁決；不要暴露 operation id、版本、CAS 細節，除非使用者明確要求診斷。
