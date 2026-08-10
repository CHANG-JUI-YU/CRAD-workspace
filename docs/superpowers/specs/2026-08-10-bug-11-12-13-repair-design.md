# 設計：修復 BUG-11/12/13（逐角色訪談、逐項 precheck、流程完成行動）

日期：2026-08-10
範圍：BUG-11（逐角色訪談與正式命名）、BUG-12（assisted precheck 逐項確認）、BUG-13（continue / legacy review / character expansion / existing-world 完成後行動）

## 背景

- BUG-11：roster/mode 已 per-character，但 concept/background/personality 仍是全專案單一回答；runtime 把同一批回答套入每個角色的 precheck，可能把所有角色誤判為明確。roster 問題只收集暫時標籤，沒有 per-character 正式命名步驟；單人預設 label 是「角色」。
- BUG-12：assisted precheck 的高影響 pending checks 用單一總確認一次套用，無法逐角色／逐維度確認，回答也不會更新 candidate Blueprint。
- BUG-13：continue 收集路徑但 engine 不完成 project selection；legacy review 只存路徑不載入檔案、不呼叫 ImportService；character expansion 不綁定現有 roster/Blueprint；既有專案補世界可能落入新專案 manager。

## 設計原則

1. 向後相容：單人專案（characters.length === 1）沿用既有問題 key（concept/background/personality、blueprint_direction），既有專案與測試不受影響。
2. 逐角色資料以角色 id 為 key 前綴（`concept:character-2`），subject_id/subject_label 帶在問題上，供 UI 顯示。
3. precheck 確認逐項進行：一個 pending check 一個確認問題，全部完成才產生 Blueprint。
4. 流程完成行動集中在 engine（project-manager / runtime），不依賴外部 agent 攔截。

## BUG-11：逐角色訪談與正式命名

### interview.ts

- 新增問題建構函式 `formalNameQuestion(subject)`：
  - id `formal_name:${subject.id}`，kind "name"（enum 加 "formal_name"？不——沿用 "name"）。
  - subject_id/subject_label 帶上。
  - text：「請為「${label}」提供正式顯示名稱（會作為卡片與 Blueprint 的顯示名稱，之後可在專案內修改）。」
  - 回答不強制（空值或含「稍後/暫用/先不用」仍繼續），Blueprint 生成時以 `values[\`formal_name:${id}\`] ?? label` 為 display_name。
- 逐角色 concept/background/personality（僅多人）：
  - 新增 `characterConceptQuestion(subject)`（id `concept:${subject.id}`、prefix「${displayName} 的角色概念」）、`characterBackgroundQuestion(subject)`、`characterPersonalityQuestion(subject)`；單人沿用原 conceptQuestion/backgroundQuestion/personalityQuestion。
  - nextQuestion 流程：
    - roster（多人）後 → 依序問每名角色的 formal_name → authoringModeQuestion(true)。
    - 單人：card_shape 後 → formalNameQuestion(subjects[0]) → authoringModeQuestion（不變共享語意）。
    - 多人共享模式：authoring_mode 回答後 → 依序問每名角色的 concept → 該角色 background → 該角色 personality → 下一個角色；最後一個角色 personality 後走 nextAfterPersonality。
    - 多人分別模式：每名角色 authoring_mode:${id} 後 → 該角色 concept → background → personality → 下一角色（無下一角色時回共享路徑？不——分別模式所有角色都問完後 → nextAfterPersonality）。
  - 角色順序：interview.characters 陣列序（ordinal）。
  - 進行狀態由 values 判斷：下一個未回答角色的概念題。
- `expansion_name` 問題（kind name）：expansion 流程在 expansion_concept 前問新角色顯示名稱（id "expansion_name"，text「請提供要新增角色的正式顯示名稱。」）。
- `world_project` 問題：world_kind 選「既有專案補世界」後問（id "world_project"，text「請提供要補世界的既有專案名稱或路徑。」free_text），之後 world_concept。
- 既有判別函式新增 `isExistingWorld(value)`：world_kind === "既有專案補世界"。

### runtime buildBlueprintPrecheck

- characters 陣列加 `display_name: values[\`formal_name:${id}\`] ?? label`。
- dimensions 表：character_core/background/personality 的 explicitKeys 改為動態：
  - 多人時該 subject 的 key = [`concept:${id}`]（legacy `concept` 僅在單人時 fallback；expansion flow 用 expansion_concept/expansion_background/expansion_personality/expansion_name）。
  - 單人維持原 key。
- 多人時某角色無該 key 值 → uncertainty high；assisted 下 needs confirmation（修正誤判）。

## BUG-12：assisted precheck 逐項確認

### runtime answerInterview 確認分支（取代現有總確認）

- pending precheck（status needs_input）存在時：
  - 從 interview.current?.id 解析進度：無確認問題 → 取第一個 action==="user_confirmed" 的 check 產生問題 id `precheck_confirm:${check.subject_id ?? "project"}:${check.dimension}`（kind "confirmation"，text 含「${dimension}（${subject label 或專案}）：${basis}」引導「確認沿用此方向」或補充）。
  - 每次回答：
    - 回答被視為補充（isNo/isYes 語意之外的非簡短確認——統一規則：回答等於「確認/是/沒有/不用/就用這個」任一短確認 → user_answer 原樣；否則視為補充內容）→ 把該 check 的 user_answer 填上，若為補充 → 同時更新 candidateBlueprint.intake_values 對應 dimension 的 value key（依 check.subject_id/dimension 映射到 `concept:${id}`/`background:${id}`/`personality:${id}` 或 project key：relationships/relationship_enable/world_concept/world_enabled/world_kind/world_timing/authoring_mode/card_shape）並重算 candidate_blueprint_revision。
    - 下一個 pending check 或全部完成 → status recorded + createBlueprintArtifact（沿用現有 commit 內容，audit 事件同）。
    - interview.current 設為下一個確認問題（未完成）或清空（完成）；interview.status 保持 complete。
  - 回傳：未完成 → needs_input + interview_question；完成 → completed。

## BUG-13：流程完成行動

### runtime

- answerInterview 回傳加 `flow` 欄位（result 物件加 flow: state.interview.flow）。
- character_expansion 完成分支（workflowComplete）：改用 mergeExpansionIntoBlueprint 取代 createBlueprintArtifact：
  - 讀 latest kind==="blueprint" artifact + 最後 recorded precheck。
  - merged candidateBlueprint：既有 characters + 新角色（id `character-${既有數量+1}`、label values.expansion_name ?? "新角色"、display_name values.expansion_name、mode values.expansion_mode、direction 沿用既有 primary 的 direction 或無）、world/relationships 沿用既有、primary_character_id 沿用既有、intake_values 為既有+新值、schema_version/flow 沿用。
  - 新 precheck（checks 沿用既有 recorded checks + 新角色 dimensions check，或不重建——簡化：沿用既有 recorded precheck 的 checks）→ new precheck id，status recorded。
  - 新 blueprint artifact（based_on 既有 artifact id/revision）。

### project-manager

- answerInterview 完成後依 result.flow 分流：
  - `continue`：values.continue_project 比對 listProjects（project_id/project_name/basename）→ 找到 select；找不到 → CoreError PROJECT_NOT_FOUND（recoverable）提示；不回 startNewProject（避免誤建）。
  - `legacy_review`：values.import_path → fs 讀檔（ENOENT/權限 → CoreError recoverable）→ 同一專案內 runtime.request("匯入舊卡進行審核", {attachments:[{name: basename, content: bytes, media_type}], actor}) → 合併 interview 結果 + import 結果回傳。
  - `world` + values.world_kind === "既有專案補世界"：values.world_project 比對 select（找不到 → PROJECT_NOT_FOUND recoverable）。
  - 其他 flow：維持現狀（finalizeIfNamed）。

## 測試策略

- interview 單元：多人逐角色 concept/background/personality key、formal_name 問題順序、expansion_name/world_project 問題出現。
- runtime：多人訪談完成後 precheck 有 per-character concept check（缺值 → assisted needs_input）；逐項確認流程（3 個 pending → 3 次回答 → completed + blueprint；補充回答更新 candidate_blueprint_revision）；expansion 完成後 blueprint artifact 含既有角色 + 新角色（based_on 既有 revision）。
- project-manager：continue 完成後 select 既有專案；legacy_review 完成後 imports 記錄產生；world 既有專案補世界 select 既有專案；找不到目標 → PROJECT_NOT_FOUND。
- 既有測試全數保留（單人路徑不變）。

## 完成條件

- pnpm build + typecheck + 全量 vitest 全綠 + agent:lint ok。
- 不修改受保護未追蹤檔案。
- commit 訊息含 (DS) 後綴。
