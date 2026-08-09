# Fact Review legacy alignment

V3 保留 `fact_review_passes` 以便讀取舊專案，但它只代表歷史事件，不再代表新的 pass-1/2/3 quorum。
讀取舊 state 時，Core 會以穩定的 legacy decision id 補出 `fact_review_decisions` 歷史；不會猜測
candidate occurrence、建立 Review Run，或把舊通過紀錄升級成新的成功裁決。缺少可重現的 source revision、
quote 或 chunk evidence 的舊 accepted fact，仍會被新 Facts Gate 阻擋。

新流程保存：

- `fact_review_runs`：固定候選 occurrence、source revision 與 policy revision。
- `fact_review_decisions`：reviewer identity、逐筆決定、candidate revision、projection revision 與結構化 evidence。
- `facts/register.json`：同時輸出現行 facts、legacy pass history、Review Run 摘要與 decision history。

若要把舊專案帶入新流程，請重新建立來源／chunk lineage，啟動新的 Review Run，並由三個獨立 reviewer
分工裁決；系統不會在背景自動合併或覆寫舊資料。
