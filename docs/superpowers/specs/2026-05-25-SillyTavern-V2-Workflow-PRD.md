## Problem Statement

使用者在建立或重構 SillyTavern 角色卡時，常面臨工具碎片化、LLM 容易因 Context Window 爆滿而產生幻覺，以及生成內容充滿「AI 味」或 OOC (Out of Character) 的問題。舊有流程缺乏結構化的防呆機制、無法在耗費大量 Token 前預覽設定，且高階功能（如狀態變數、動態腳本）與基礎設定過度耦合。此外，系統的 Prompt 規則與核心程式碼混雜，導致後續維護與更新極為困難。

## Solution

建立一個基於「主從式多智能體 (Master-Subagent)」與「MCP 外掛架構」的 V2 角色卡工作流。
透過 Director (主控) 引導流程，強制引入「藍圖規劃 (Blueprint)」、「逐模組線性展開 (Linear Expansion)」以及「Critic 審查迴圈 (Review Loop)」，並在關鍵節點設置使用者確認閘門 (User Gates)。這套解法將內容生成與品質審查分離，確保角色卡品質穩定、無 AI 味，且所有設定規則皆抽離為外部參考文件，大幅提升系統可維護性。

## User Stories

1. As a 角色卡創作者, I want 匯入現有的 PNG/JSON 角色卡並將其解構為原始資料, so that 我能基於舊卡進行 V2 架構的重構，而不需要從頭開始。
2. As a 角色卡創作者, I want 系統先產出一份包含核心關鍵字的 Blueprint 藍圖, so that 我可以在系統進行大量文本生成前，先確認核心世界觀與設定是否符合預期。
3. As a 成本控管者, I want 在 Blueprint 階段就看到 Token 預算的分配, so that 我能確保後續的生成不會超出 LLM 的 Context Window 限制或花費過多 API 成本。
4. As a 角色卡創作者, I want 系統採用逐一模組（如：外觀、性格、第一句話）的方式進行線性展開, so that 每個模組都能獲得足夠的注意力與細節，避免一次性生成導致的品質下降或幻覺。
5. As a 品質要求高的使用者, I want 系統內建 Critic 審查機制來檢測生成的草稿, so that 任何「AI 味」、陳腔濫調或 OOC 的行為都能被自動抓出並要求重寫。
6. As a 系統管理者, I want 所有的審查標準與寫作規則都被獨立存放在外部參考文件中, so that 我可以隨時更新規則而不需要修改核心工作流的程式碼。
7. As a 角色卡創作者, I want 在最終打包前有一個展示完整草稿的確認閘門 (User Gate 2), so that 我能進行最後的把關。
8. As a 角色卡創作者, I want 能夠手動覆寫任何生成的草稿並跳過 Critic 審查, so that 我的個人創意與特殊需求能擁有最高優先級，不受自動化規則限制。
9. As a 進階玩家, I want 能夠在確認最終草稿後，按需 (On-Demand) 呼叫生成高階外掛 (MVU, EJS, HTML), so that 我的卡片可以擁有動態狀態與 UI，且不會在初期干擾核心文本的生成。
10. As a 角色卡創作者, I want 系統在打包前執行嚴格的 Schema 驗證, so that 我輸出的最終卡片保證能完美相容於 SillyTavern V2 系統。
11. As a 角色卡創作者, I want 系統在單一模組寫入失敗時能自動觸發 Fallback 重新生成, so that 整個工作流不會因為單點錯誤而全面中斷。

## Implementation Decisions

為了實現上述需求，我們將建構/修改以下 Deep Modules (深度模組)：

*   **Workflow State Machine (Director Module)**
    *   **職責：** 封裝整個工作流的狀態轉換 (Input -> Blueprint -> Expansion -> Review -> Validation -> Export)。
    *   **設計：** 提供清晰的介面來推進狀態、管理重試計數器 (Retry Counter)，並在遇到 User Gate 時暫停執行並交出控制權。外部呼叫者只需知道「推進到下一步」或「提供使用者反饋」，而不需要了解底層的階段邏輯。
*   **Generative Engine (Creator Module)**
    *   **職責：** 專注於 LLM 的提示詞組裝與生成邏輯。
    *   **設計：** 封裝讀取外部 `references/` 規則的細節。接收 Blueprint 與指定模組名稱後，輸出該模組的 YAML 草稿。這是一個 Deep Module，隱藏了如何讓 LLM 遵守特定心理學模型與格式的複雜度。
*   **Evaluation Engine (Critic Module)**
    *   **職責：** 專注於文本品質檢驗。
    *   **設計：** 接收一段草稿，返回一個嚴格定義的介面（例如：`{ passed: boolean, feedback: string }`）。隱藏了防 AI 味檢測的具體判定邏輯。
*   **Forge Core (MCP Tools Module)**
    *   **職責：** 處理所有與檔案系統和 Schema 相關的實體操作。
    *   **設計：** 提供如 `extractRawData`, `writeDraft`, `validateV2Schema`, `mergeAndExport` 等乾淨的介面。隱藏了 YAML 解析、SillyTavern 特殊 JSON 結構與 PNG 標籤寫入的底層實作細節。

*架構決策：*
*   採用 Master-Subagent 模式，確保流程控制權集中。
*   高階外掛 (MVU/EJS) 採用「延遲按需生成 (On-Demand)」，與核心文本解耦。
*   所有設定規則外部化 (External References)，增強可維護性。

## Testing Decisions

*   **優良測試的定義：** 測試應聚焦於模組的外部行為與介面合約，而非內部實作（例如不測試 LLM 產生的具體字眼，而是測試狀態機是否正確流轉，或 Schema 驗證器是否能正確攔截錯誤格式）。
*   **預計測試的模組：**
    *   **Workflow State Machine:** 撰寫單元測試驗證狀態流轉。給定模擬的 (Mocked) Creator 和 Critic 回應，確保 Director 能正確觸發 User Gate 1 & 2，並在 Critic 失敗兩次後正確強制進入下一階段。
    *   **Forge Core (Schema Validator):** 撰寫單元測試，提供已知的合法 V2 YAML 與各種不合法的 YAML (缺漏必填欄位、型別錯誤)，驗證 `validateV2Schema` 的行為是否正確。
*   **Prior Art (參考前例)：** 參考 codebase 中現有的 `evals/evals.json` 或其他狀態機與 Schema 驗證的測試模式。

## Out of Scope

*   **圖像生成：** 系統不負責生成角色卡的視覺頭像 (Avatar) 或背景圖片。
*   **直接部署/連線至 SillyTavern API：** 系統的終點是輸出合法的 PNG/JSON 檔案，不負責將卡片透過 API 直接推送到運行中的 SillyTavern 伺服器。
*   **多語言自動翻譯：** 本工作流專注於生成高解析度的母語卡片，不包含內建的翻譯工作流。

## Further Notes

*   在 User Gate 2 中，使用者手動覆寫 (User Override) 的權限高於一切。未來的 UI 或 CLI 介面實作時，必須清楚提示使用者「手動修改將不會經過品質檢查」。
*   Token 預算演算法初期可採用簡單的字數/字元估算，後續再迭代為更精準的 Tokenizer 計算。