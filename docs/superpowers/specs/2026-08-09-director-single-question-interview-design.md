# Director 單題訪談互動設計

## 問題

訪談引擎本身以 `current` 保存目前唯一問題，但 Director 的提示規範沒有明確禁止預先問卷。Agent 因此可能把工作類型、卡片形態、來源與概念一次提出，造成回答無法依照引擎的分支逐題保存。

## 設計

保留既有 `InterviewFlow` 與原子保存，不增加批次答案介面。由三層契約共同約束互動節奏：

1. Director Skill：每輪只呈現 `workspace_interview_context` 的單一目前問題與其選項，等待回答後才提交 `workspace_interview_answer`。
2. Director Agent prompt 與 workflow routing：禁止合併未來問題、預先收集問卷或在同一回覆要求多個決策；多角色方向也必須逐名、逐題處理。
3. MCP 工具描述：明確標示 context／answer 只處理目前一題，讓模型從工具契約即可辨識正確用法。

使用者主動附帶未來資訊時，Agent 仍只把本輪回答交給目前問題，不自行替引擎填寫後續問題；後續資訊在對應題目出現時再確認。

## 非目標

- 不修改 interview state machine、問題順序或既有答案格式。
- 不新增底層參數，也不要求使用者提供 question id。

## 驗證

- Server contract test 檢查兩個訪談工具的單題描述。
- 既有 runtime interview tests 繼續驗證一次回答只推進一個狀態與一筆答案。
