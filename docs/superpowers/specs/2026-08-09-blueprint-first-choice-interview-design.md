# Blueprint-first choice interview design

## Status

設計已確認，已實作並通過目前回歸測試。這份變更只定義「訪談如何協助建立 Blueprint」與
「Blueprint 如何餵給後續 Agent」；不把訪談答案直接當成任何正式珠璣或調色盤模組。

## 背景與問題

目前訪談引擎在選擇珠璣模式後，會直接逐題要求八個
`self_introduction` 欄位，且每題要求至少 30 個 Unicode 字元。這造成兩個問題：

1. 使用者被迫處理本來應由 Agent 完成的長篇內容與格式要求。
2. 訪談邊界與正式模組邊界混在一起；調色盤模式則沒有同等的選項式協助流程。

舊版的 Agent clarification 已證明「提供 2 至 5 個選項、說明差異、讓使用者選擇」
比要求使用者直接填底層欄位更合適。本設計把這種互動提升為所有模式共用的
Blueprint-first 流程。

## 目標

- 使用者只接觸角色方向、偏好與取捨，不接觸模組 schema、欄位名稱、長度限制或儲存參數。
- 訪談先產生可確認的 Blueprint，再開始任何正式內容創作。
- 珠璣與調色盤都使用相同的混合式選項體驗。
- 保留完整的選擇、重生成、短句修正與逐項覆寫能力。
- 正式模組仍由對應 Creator 依 Blueprint 與前置模組逐步產生，並通過既有 schema、review 與 gate。
- 既有已發布專案可以修改 Blueprint 並建立下游修訂，不需要重新開始整個專案。

## 非目標

- 不把 `self_introduction` 加到調色盤 schema。
- 不把訪談選項原文直接複製成珠璣語料或調色盤模組。
- 不取消珠璣七模組、調色盤四模組或其正式驗證規則。
- 不要求使用者選擇 task id、artifact id、revision、lease、檔案路徑或其他底層參數。

## 核心原則

### 1. 訪談資料是 Blueprint 意圖，不是模組內容

Agent 提出的選項只描述角色的高階設定方向，例如外在定位、核心氣質、內在驅動、
主要矛盾、聲線、自我認知、互動張力與對使用者的關係影響；角色設定是主軸，
對使用者的關係只是其中一個子面向，不得讓整題退化成關係玩法。選擇結果保存為
intake decision／Blueprint provenance，
不能直接形成 `zhujiProposalValueSchema` 或 `paletteProposalValueSchema`。

訪談完成後，Director 將所有 intake answers、選擇與補充整理成候選 Blueprint，
再經 Blueprint precheck 與使用者確認。只有確認後才建立 authoring tasks。

### 2. 混合式選項互動

預設採用整體方向選擇：

1. Agent 依已收集的概念、背景、性格與關係資料提出 3 個互相區分、以角色設定為主的方向。
2. 每個方向只顯示自然語言標題、簡短摘要、主要取捨與可能影響；不顯示底層欄位。
3. 使用者可以選擇一個、要求重新生成、提出短句修改，或選擇「混合／自行描述」。
4. 若使用者只不滿意一個維度，Agent 才針對該維度提出 2 至 5 個選項，不重新要求整份長文。

選項必須一次只處理一個真正未決的方向，且不得覆蓋使用者已明確提供的設定。
選項數量、內部 option id 與 provenance 由 Agent／引擎管理，使用者只需以自然語言
選擇或描述意見。

### 3. Blueprint 確認後才進入模式專用創作

#### 珠璣模式

Blueprint 確認後，依固定順序建立七個 module task：

1. `appearance`
2. `inner_nature`
3. `extension`
4. `trait_refinement`
5. `trait_dialogue`
6. `scene_dialogue`
7. `self_introduction`

每一個 task 都以已確認 Blueprint、可用的 accepted facts 與前面已完成模組的
exact revision 為輸入。最後的 `self_introduction` 才負責產生角色第一人稱自我介紹
語料；它不是訪談階段的輸出。

#### 調色盤模式

Blueprint 確認後，依調色盤的四個正式模組建立 authoring tasks：

1. `basic_information`
2. `personality_palette`
3. `tri_faceted`
4. `secondary_interpretation`

調色盤 Creator 同樣以 Blueprint 為主要依據，並可讀取已完成的前置模組；
選項式訪談只提供方向，不直接寫入這四個模組。

## Blueprint 方向的資料與追溯

- `interview.answers` 繼續保存使用者的自然語言答案，並以既有原子保存機制寫入。
- 新增的方向選擇以內部 decision/provenance 保存：包含來源問題、候選摘要、使用者選擇、
  生成時間與所依據的 intake revision。
- `BlueprintPrecheckRecord.candidate_blueprint` 保存合成後的候選 Blueprint，並使用既有
  `candidate_blueprint_revision`、checks 與確認流程。
- Creator proposal 的 provenance 應指向 Blueprint／accepted fact／前置模組 revision，
  不應把選項卡片當成正式模組來源。
- 選項卡片可保留在專案紀錄供回溯，但不是必須由 Agent 手動填寫的公開參數。

## 修改與發布後彈性

- 若使用者在 authoring 或 published 階段提出的是方向性修改，Director 建立 Blueprint
  revision／successor，而不是直接覆寫某個模組。
- 受影響的下游模組、review、content gate 與 compile preview 依現有 revision 規則標記
  stale 或建立修訂 tasks；未受影響的內容可保留。
- 既有發布快照不被破壞；新 Blueprint 與模組完成後才建立新的 publish snapshot。

## 相容性與遷移

- 新專案不得再產生 `zhuji_intro:*` 形式的八題長文訪談。
- 既有含 `zhuji_intro:*` 的狀態仍可讀取；遷移時將它們視為歷史 intake evidence，
  由 Director 整理進 Blueprint，不自動宣稱它們已是正式 `self_introduction` 模組。
- `self_introduction` 的正式 schema、30 字與第一人稱品質規則只在 Zhuji Creator
  產生模組時執行。
- 調色盤既有四模組 schema 與既有 artifact 不變。

### 訪談敏感內容邊界

- 角色概念訪談預設不主動詢問性相關或成人內容，與舊版 Director 的訪談風格一致。
- 只有使用者先在回答中明確提及相關內容時，才可在相同脈絡下追問；追問沿用既有直接
  措辭，不改用額外的委婉欄位名稱或新 schema。
- 舊 `zhuji_intro:*` 相容流程同樣跳過 `性相關` 欄位，除非既有 intake evidence 已表明
  使用者主動提供相關內容；內部 schema 欄位與正式 Creator 模組保持不變。

## 驗收條件

1. 新珠璣訪談不再要求使用者逐題輸入八段 30 字自我介紹，而是先提供整體方向選項。
2. 調色盤訪談具有相同的整體方向選項與逐項覆寫能力。
3. 選擇、重生成或短句修正只會更新 intake／Blueprint，不會建立 zhuji 或 palette artifact。
4. Blueprint 確認前不能建立正式 authoring tasks；Blueprint precheck 與 gate 仍有效。
5. 珠璣 `self_introduction` 只能在模組七階段由 Blueprint 加前置模組產生。
6. 調色盤四模組只能在 Blueprint 確認後由 Palette Creator 產生。
7. 方向性修改會建立可追溯 Blueprint revision，並正確使必要的下游產物失效或進入修訂。
8. 舊狀態可讀取，新流程不要求使用者提供底層參數。
9. 單元測試、整合測試、typecheck、agent lint 與 coverage 維持目前門檻。
