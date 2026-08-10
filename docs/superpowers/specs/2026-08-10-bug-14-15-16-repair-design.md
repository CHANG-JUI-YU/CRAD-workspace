# 設計：修復 BUG-14/15/16（world timing 落地、source-adaptation policy、fact review 一致性）

日期：2026-08-10
範圍：BUG-14（world timing 與 source-adaptation policy 只保存或被硬編碼）、BUG-15（自動抽取 fact 在 strict path 無法 accept）、BUG-16（fact review schema、狀態機與衝突流程不一致）

## 背景

- BUG-14：
  1. 獨立 world flow 的 worldConfig 強制 `authoring_timing = "before_characters"`，忽略訪談 `world_timing` 回答。
  2. `world.authoring_timing` 只被保存與透傳（required-artifacts manifest），從未成為 runtime branch 或 gate 條件，角色先寫完再寫世界也能通過 authoring 派發。
  3. `sourceAdaptationIntentFromValues` 把 `canon_policy` 硬編碼為 `canon_inspired`，訪談沒有任何 canon_policy 問題。
  4. 二創多人卡仍只有一份全局 subject/medium/identifier，無法表達每名角色來自不同作品來源。
- BUG-15：`factFromSentence` 自動候選的 `coverage` 為空陣列，`assertStrictFactQuality` 要求 coverage 非空，review decision schema 沒有 coverage 修補欄位——自動抽取 → reviewer 裁決 → 創作上下文的主鏈中斷。
- BUG-16：
  1. `factDecisionSchema` 讓 `fact_id` 與 `candidate_occurrence_id` 同時 optional，strict runtime 卻在缺 occurrence id 時 throw。
  2. schema 欄位是 `evidence`（文字），template guide 範例卻使用 `evidence_refs`，strict schema 拒絕自己的範例。
  3. run 狀態機 `complete = 所有 occurrence 有 accepted/rejected` 與 `blocked = 有 needs_evidence/conflict` 排列組合使 blocked 幾乎不可達（有 needs_evidence/conflict 時 complete 恆 false，run 永遠停在 open）。
  4. 已 settled（accepted/rejected）occurrence 在競態下 throw `FACT_CANDIDATE_NOT_ACTIVE` 中止整批，設計文件期待跳過並繼續。
  5. conflict 沒有公開 Director resolve 操作，普通 reviewer 被禁止覆寫 conflict。
  6. 沒有實作 accepted facts 間 subject+predicate 矛盾的自動 conflict 偵測。

## 設計原則

1. 向後相容：既有問題 key 與單人流程不變；新增 canon_policy 問題與 per-character 來源問題僅在 source_adaptation 流程出現。
2. 逐角色來源以角色 id 為 key 前綴（`source_subject:character-2`），subject_id/subject_label 帶在問題上。
3. world authoring order 是 runtime gate（recoverable CoreError），不改變 publish 閘門語意（manifest 已雙向要求 world + characters）。
4. fact review 的修補與偵測都落在 KnowledgeService 內部，runtime 只新增公開操作入口。

## BUG-14：world timing 與 source-adaptation policy

### BUG-14.1：world flow 尊重訪談 world_timing

`packages/runtime/src/index.ts` `worldConfig`：

- 移除 `interview.flow === "world"` 強制 `before_characters` 的分支。
- 一律解析訪談值 `world_timing`：之前/after 前綴 → `before_characters`、之後/after → `after_characters`、未回答 → 不回傳 `authoring_timing`。
- 既有兩個 runtime world 測試回答「之前」，仍期待 `before_characters`，不需修改。

### BUG-14.2：authoring_timing 成為 runtime gate

`packages/domain/src/authoring.ts`：

- 匯出 `inferAuthoringKind`（包裝既有 `inferKind`，import 需要時直接用 `export { inferKind }` 或新增具名匯出）。

`packages/runtime/src/index.ts` 新增私有 gate：

- `ensureWorldAuthoringOrder(state, kind)`：
  - 僅在 `interviewRequired` 且 workflowBacked（interview complete 或專案 ready/published）且 `blueprint.world?.enabled === true` 時作用。
  - `timing = blueprint.world.authoring_timing ?? "before_characters"`。
  - `before_characters`：kind 為 `character`/`zhuji`/`palette`/`wardrobe` 且沒有任何 `world_lore` artifact → throw `WORLD_AUTHORING_ORDER`（「世界設定需在角色創作之前完成；請先建立世界設定。」）。
  - `after_characters`：kind 為 `world_lore` 且沒有任何 character 側 artifact（character/zhuji/palette/wardrobe）→ throw `CHARACTER_AUTHORING_ORDER`（「角色設定需在世界設定之前完成；請先完成角色創作。」）。
- 接入點：
  - `request()` 的 `kind === "authoring"` 分支：`authoring.create` 前，用 `inferAuthoringKind(trimmed)` 判斷 kind 再檢查。
  - `submitTemplateProposal`：對 proposal 種類 world/character/zhuji/palette/wardrobe（`templateArtifactKind` 對應）套用同一檢查。

### BUG-14.3：canon_policy 訪談問題

`packages/core/src/interview.ts`：

- 新增問題 `canonPolicyQuestion(subject?)`：id `canon_policy`（subject-scoped 時 `canon_policy:CHAR`）、kind "choice"、text「二創改編時要採取哪種設定方針？」、options ["參考原作", "二創詮釋", "忠實原作"]。
- `isChoiceAnswerValid` 增加 canon_policy 驗證（選項內含「原作」與「詮釋」/「忠實」即可，或明確比對三選項）。
- 流程插入：
  - 單人：`source_identifiers` → `canon_policy` → `afterCardShape`。
  - 多人：最後一名角色的 `source_identifiers:CHAR` 之後 → `canon_policy` → `authoringModeQuestion`。

`packages/runtime/src/index.ts` `sourceAdaptationIntentFromValues`：

- 讀 `canon_policy`：參考原作 → `reference_only`、二創詮釋 → `canon_inspired`、忠實原作 → `canon_faithful`；未回答 fallback `canon_inspired`。

### BUG-14.4：二創多人卡逐角色來源

`packages/core/src/interview.ts`：

- `card_shape` 分支（flow === "source_adaptation" 且 isSourceAdaptation(work_type)）：多人 → `characterRosterQuestion()`（跳過全局來源問題）；單人 → `sourceSubjectQuestion()`（不變）。
- `character_origin` 分支（flow === "source_adaptation"）：多人 → roster；單人 → `sourceSubjectQuestion()`。
- `formal_name:CHAR` 迴圈結束後：flow === "source_adaptation" 且多人 → 依序進入逐角色來源問題，不再直接 `authoringModeQuestion`。
- 新增 subject-scoped 問題 helper：`sourceSubjectQuestion(subject)` / `sourceMediumQuestion(subject)` / `sourceReferenceQuestion(subject)`（id 為 `source_subject:CHAR` 等，附 subject_id/subject_label）。
- 逐角色來源序列：`source_subject:CHAR` → `source_medium:CHAR`（choice，選項同全局）→ `source_identifiers:CHAR`（free text）→ 下一名角色 `source_subject:next`；全部完成 → `canon_policy` → `authoringModeQuestion`。
- `isChoiceAnswerValid` 的 source_medium 驗證由 `id === "source_medium"` 改為 `id === "source_medium" || id.startsWith("source_medium:")`。

`packages/core/src/authoring-context.ts`：

- `SourceAdaptationIntent` 新增 `subjects?: Array<{ character_id: string; subject_name: string; source_medium?: string; source_identifiers?: string[] }>`。

`packages/runtime/src/index.ts` `sourceAdaptationIntentFromValues`：

- 多人時（values.card_shape 為多人）：由 `source_subject:CHAR`/`source_medium:CHAR`/`source_identifiers:CHAR` 建 `subjects` 陣列；`subject_name` = 該角色 subject ?? 全局 subject；單人維持既有欄位。均附 `canon_policy`。

`packages/domain/src/workflow-gate.ts` `reportFacts` coverage register：

- 比對 fact.subject 時，除 `subject.id`/`subject.label` 外，也對照 `blueprint.source_adaptation.subjects[].subject_name`（建立 alias 集合），讓逐角色 subject 命中 register。

## BUG-15：coverage 修補

`packages/domain/src/knowledge.ts`：

- 新增 `coverageForClassification(classification)`：identity → ["identity"]、trait → ["personality"]、relationship → ["relationships"]、event → ["background"]、world → ["world_context"]、other → []。
- `factFromSentence`：以 `structured.classification` 帶入 `coverage: coverageForClassification(...)`。

`packages/core/src/templates.ts` `factDecisionSchema`：

- 新增 `coverage: z.array(text).default([])`（reviewer 可補 coverage 讓 fact 通過 strict acceptance）。

`packages/domain/src/knowledge.ts` `applyReviewBatch`：

- accept 時若 `decision.coverage` 非空：以修補後 fact（`{...target, coverage: decision.coverage}`）取代 target 做 `strictEvidenceReferences` 與 `assertStrictFactQuality`；commit 的 fact 更新合併 `decision.coverage`（去重）；`record.candidate_revision` 仍記原始（審查標的），`fact_revision` 照常 +1。

## BUG-16：fact review schema、狀態機與衝突流程

### 16.1：target 解析一致性

`packages/core/src/templates.ts` `factDecisionSchema`：

- 加 `.superRefine`：`fact_id` 與 `candidate_occurrence_id` 至少其一，否則報錯。
- TEMPLATE_GUIDES.fact_review 的 required 改為 "decisions[] must include candidate_occurrence_id (or fact_id)"。

`packages/domain/src/knowledge.ts` `applyReviewBatch`：

- 514-516 改為兩者皆無才 throw `FACT_CANDIDATE_OCCURRENCE_REQUIRED`（讓既有 fact_id fallback 生效）。

### 16.2：schema 與 guide 一致

`factDecisionSchema` 新增 `evidence_refs: z.array(factEvidenceReferenceSchema).default([])`；TEMPLATE_GUIDES.fact_review 範例原樣即可合法。

### 16.3：run 狀態機

`applyReviewBatch` run 狀態計算改為：

- `complete = run.candidate_occurrence_ids.every(id => latestByOccurrence.has(id))`（任何 decision 皆視為 settled）。
- `blocked = 任一 latest decision 為 needs_evidence/conflict`。
- `status = complete ? (blocked ? "blocked" : "completed") : "open"`。
- workflow-gate 既有檢查相容（missing 只看無 accepted/rejected 的 occurrence；blocked decisions → NEEDS_EVIDENCE/CONFLICT；無 blocked 且未 completed → RUN_INCOMPLETE）。

### 16.4：settled occurrence 跳過

`applyReviewBatch`：previousDecision 為 accepted/rejected 的目標 → 跳過（不 throw、不記錄、計入 skipped）。runtime `replayTemplateProposal` 既有 catch 保留為保險。

### 16.5：Director resolve conflict

- `packages/domain/src/knowledge.ts`：KnowledgeService 新增公開方法 `resolveFactConflict(operationId, decisions, actor, reviewerIdentity, reviewRunId, expectedProjectionRevision)`——director 專用，內部複用 `applyReviewBatch`（conflict 覆寫權限既有邏輯已允許 director）。
- `packages/runtime/src/index.ts`：新增 `submitConflictResolution(proposal, context)`，強制 agent "director" 後走既有 fact_review 提交路徑。

### 16.6：矛盾自動偵測

`packages/domain/src/knowledge.ts`：

- 新增匯出 `contradictingAcceptedFacts(facts)`：對 accepted facts 兩兩比對，normalized(subject) 相同 + normalized(predicate) 相同 + normalized(value) 不同 → 回傳矛盾 pairs。
- `applyReviewBatch` accept 時：對既有 accepted facts 檢查矛盾，若矛盾 → 該 decision 記為 conflict（reason 標註矛盾對象 fact id），由 Director 裁決。
- workflow-gate publish：對 accepted facts 掃描矛盾（legacy 保險）→ 新增 diagnostic code `FACT_REVIEW_CONTRADICTION`（error，附 fact_ids）。

## 測試策略

- `packages/runtime/test/project-interview.test.ts`：新增 world flow 回答「之後」→ `after_characters`；source_adaptation 多人卡逐角色來源 + canon_policy 流程（blueprint.source_adaptation.subjects 與 canon_policy 值）；world order gate（before/after 兩向拒絕與放行）。
- `packages/domain/test/knowledge.test.ts`（或對應檔案）：自動 fact coverage 非空；reviewer 以 decision.coverage 修補後 accept 成功；settled occurrence 跳過不 throw；blocked 可達（needs_evidence 後 run status blocked）；conflict 自動偵測；director resolve；evidence_refs schema 合法。
- `packages/core/test/templates.test.ts`（或對應）：factDecisionSchema 接受 evidence_refs/coverage、拒絕無 target id。
- `packages/domain/test/workflow-gate.test.ts`：coverage register alias；FACT_REVIEW_CONTRADICTION。

## 驗證

`pnpm build && pnpm typecheck && pnpm vitest && pnpm agent:lint` 全綠後 commit「V3.6: 修復 BUG-14/15/16(DS)」。
