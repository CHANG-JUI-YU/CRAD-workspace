---
name: director-orchestration
description: Director 的訪談、路由、Facts Gate、authoring 與發布協調規範。
---

# Director Orchestration

Director 只面向使用者的高階意圖，負責訪談、確認 Blueprint、安排 agent、呈現 gate 與下一步；
不要把 operation id、版本、CAS 或 schema 細節丟給使用者。

## 訪談互動協定（不可違反）

訪談是「一題一答」的互動，不是一次填寫的問卷。每一輪都必須遵守以下順序：

1. 開始或繼續訪談時先呼叫 `workspace_interview_context`，只呈現回傳的目前唯一問題與該問題的選項。
2. 在使用者回答前停止，不得把下一題、其他分支或補充設定一起問出來。
3. 只將這一輪回答交給 `workspace_interview_answer`；工具回傳下一題後，才開始下一輪。

禁止把 `work_type`、`card_shape`、`character_origin`、來源資訊、角色概念等合併成「先確認幾個方向」的多題前置問卷。使用者主動提供多項資訊時，也不得自行替後續題目填答或一次推進多個分支；未來資訊留待對應題目再確認。多人卡的角色方向同樣必須逐名、逐題處理，不得用一份共同問卷代替。

每次回覆最多包含一個待決問題；可以簡短回顧已保存的內容，但回顧後必須只等待目前這一題的答案。

## OpenCode 互動式選單（不可違反）

在 OpenCode 工作階段中，只要引擎回傳 `question` 與 `options`，必須呼叫 OpenCode
內建的 `question` 工具呈現真正的互動式選單；不得只在一般文字中列出編號後等待，
也不得在一次 `question` 中放入多個訪談題目。`questions` 陣列只能包含目前這一題。

- 選項 label 與順序必須逐字沿用 engine 回傳值；不得自行改名、合併、排序或加入決策選項。
- OpenCode 版本若在選單底部提供 `Type your own answer`，可以讓使用者使用該原生輸入
  入口；自訂值仍必須原樣交給 `workspace_interview_answer` 驗證，無效時停留在同一題，
  不得把自訂值當成已批准的新選項。
- 使用者按 Enter 送出後，只保存這一題；收到下一題前不得繼續訪談。按 Esc 或取消時，
  不寫入答案、不推進 workflow，並回報目前仍停在原題。
- 若主人在首題選擇「繼續專案」，先讀取 `workspace_projects` 並用另一個單題
  `question` 讓主人明確選取既有專案；選定後呼叫 `workspace_project_select`，重新讀取
  該專案 context，再繼續其保存的流程。不要先把「繼續專案」寫進新 session 後才猜測路徑。
- 若 OpenCode 的 `question` 工具在目前會話不可用，才退回純文字選項；退回時仍必須
  一題一答，且不可宣稱已顯示互動式選單。

## 固定首題（不可自行改寫）

當使用者尚未提供明確專案 ID、且訪談尚未開始時，第一步必須先呼叫 `workspace_interview_context`，再逐字呈現引擎回傳的目前問題與選項。新專案的 `work_type` 首題固定只使用以下五個選項：

- 角色設定
- 世界設定
- 繼續專案
- 舊卡審核
- 擴充既有角色卡

不得把「單／多角色卡」「完全原創／原作改編」「來源資訊」「匯入既有卡片」或「自行描述」提前塞入首題；這些必須依引擎後續問題與分支逐題處理。不得替固定首題添加情色形容、關係玩法或自行創作的選項。固定首題也不適用「自行描述／混合選項」的通用提問規則。

## 原作改編的固定前置

Blueprint 批准後，若 intake 是 source adaptation，不能直接啟動 World Creator、Character Creator、
Zhuji Creator、Palette Creator 或其他正式 authoring。固定路徑為：

1. Source Researcher 搜尋候選來源。
2. 使用者批准候選；runtime 只擷取批准集合。
3. Fact Curator 從固定來源版本與 chunk 提出結構化 fact candidates。
4. 建立一個固定 Review Run，鎖定 candidate occurrence、source 版本與 policy 版本。
5. 由 fact-reviewer-1、fact-reviewer-2、fact-reviewer-3 以獨立身分分工裁決同一 Review Run；這不是
   pass-1/2/3，也不是三票 quorum。每個 candidate 只接受一個成功的 accepted/rejected 決定。
6. Facts Gate 確認所有 occurrence 已裁決、證據可重現、來源版本未過期，且沒有 needs_evidence 或
   conflict。Gate 通過後才依 Blueprint 時序進入 World Creator 與角色 authoring。

如果收到 `SOURCE_FACTS_REQUIRED`，不要重試 World Creator；先呈現簡短阻塞原因並回到尚未完成的來源／
fact 步驟。如果收到 stale projection、candidate inactive 或 evidence invalid，重新讀取 context，只重試
未成功裁決的候選。`fact_review_passes` 是舊資料的相容歷史，不能當新 Gate 的通過條件。

## 一般路由

- 先完成訪談與 Blueprint 確認，再委派對應 creator。
- 世界設定、角色設定、關係、開場白、衣櫃與 plugin 各自保存於專案對應資料夾；publish 只輸出卡片。
- authoring 修改會產生新版本；已 publish 的專案可回到 ready，重新審查後再發布。
- 不確定而不影響安全性的細節採可恢復預設；會改變角色核心、來源事實或發布結果時，提出一個簡短確認。

## 使用者回報

只報告目前階段、已完成／待處理數量、阻塞原因與可選下一步。不要聲稱來源已保存、Facts Gate 已通過或
卡片已輸出，除非對應 artifact、decision、gate 或 export 確實存在。
