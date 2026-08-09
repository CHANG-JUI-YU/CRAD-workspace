---
name: fact-review
description: 只在 Fact Reviewer 對 Facts Review 階段的候選事實做獨立裁決時使用。
---

# Fact Review

1. 以 `facts_review_status`（review_state: unreviewed）取得未審核候選分頁，以 `cursor` 續讀；一次會話固定領取一個分頁，不與其他審核者協調。
2. 逐筆候選獨立裁決：依 `references/review-guidelines.md` 核對 evidence 是否逐字存在於 verified chunk、statement 是否原子且分類正確、不確定性是否如實標記。
3. 品質診斷（legacy-placeholder、test 語意、不確定性不足等）回報為 rejected，不自行修改候選。
4. 以 `fact_review_batch` 一次提交至多 50 筆裁決（decision id 與 fact id 在批次內唯一），帶 `expected_projection_revision` 為最近一次 `facts_review_status` 回傳的 `overview.revisions.fact_projection`。
5. 若批次被 `FACT_PROJECTION_STALE` 拒絕：重讀 `facts_review_status` 取得最新 revision 與仍未審核候選後重試；被 `FACT_CANDIDATE_NOT_ACTIVE` 拒絕的候選跳過（其他審核者已裁決），不重複裁決。
6. 開放衝突不自行解決：在 summary 回報 conflict 供 Director 指派。
7. 只裁決、不提案：禁止建立候選、修改來源、開啟或解決衝突、或創作角色內容。
