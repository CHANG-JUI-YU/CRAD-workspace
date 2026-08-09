# Blueprint-first choice interview implementation plan

## Status

實作已完成；TypeScript、agent/skill registry、完整測試與 coverage 驗證均已通過。

> 對應 spec：`docs/superpowers/specs/2026-08-09-blueprint-first-choice-interview-design.md`
>
> 這份計畫只在設計已確認後執行。實作期間不改變 CCv3/PNG compiler 或跨實例 CAS。

## 1. 盤點現有合約與建立回歸基線

- 讀取並固定目前 `InterviewState`、`BlueprintPrecheckRecord`、Zhuji/Palette proposal
  schema 與 MCP interview tools 的公開形狀。
- 確認現有舊狀態中 `zhuji_intro:*` 答案可載入，且新的 interview state 不會因缺少
  新欄位而無法解析。
- 先執行既有 `pnpm typecheck`、`pnpm test -- --maxWorkers=1`、`pnpm agent:lint`
  與 `pnpm test:coverage -- --maxWorkers=1`，記錄基線。

## 2. 重構 Interview engine：訪談只收 Blueprint 意圖

目標檔案：

- `packages/core/src/interview.ts`
- `packages/core/src/index.ts`
- `packages/runtime/src/index.ts`
- 對應 core/runtime/server interview tests

工作內容：

- 移除新流程中 `authoring_mode → zhuji_intro:*` 的八題長文分支。
- 建立模式中立、以角色設定為主的 Blueprint 方向問題；使用既有 `workspace_interview_answer` 的自然語言
  answer 介面，不要求使用者提交 option id 或任何底層欄位。
- 保留 `choice` 的公開語意與 `options` 顯示能力；若需要辨識「整體方向」與「單項覆寫」，
  只增加內部 question metadata，不能把內部 metadata 變成使用者必填參數。
- 將方向選擇、重新生成、混合／自行描述與單項覆寫保存為 intake evidence；同一題重試
  必須可恢復，不得重置整個訪談。
- 對舊狀態保留相容讀取：歷史 `zhuji_intro:*` 只被視為既有 intake evidence，
  不再被當作正式模組。
- 保留空答案、短答案（只對真正需要長度的非方向問題）與非 active interview 的既有錯誤合約。

驗收：新專案選珠璣或調色盤時都先出現 Blueprint 方向流程，不能再要求使用者輸入八段
30 字自我介紹。

## 3. Blueprint synthesis 與 precheck 接線

目標檔案：

- `packages/runtime/src/index.ts`
- `packages/core/src/index.ts`
- `packages/domain/src/workflow-gate.ts`
- 必要時 `packages/domain/src/authoring.ts`

工作內容：

- 將選定方向與來源 intake answers 合併進候選 Blueprint，而不是建立 zhuji/palette artifact。
- 讓 `BlueprintPrecheckRecord.candidate_blueprint`、revision、checks 與 audit 能追溯
  方向選項的來源與使用者決定。
- Blueprint 未完成或 precheck 尚待確認時，禁止建立任何正式模式模組；既有 gate 行為保持
  fail-closed。
- 方向重生成或單項覆寫要建立新的候選／precheck revision，保留前一版歷史，不覆蓋已發布快照。
- 對 published 專案的方向性修改沿用現有 editable-publish 流程：回到 ready、標記受影響
  downstream artifact/preview stale，舊發布仍可回溯。

驗收：讀取專案狀態可以看到方向決定與 Blueprint revision，但 artifacts 中沒有由訪談直接
產生的 zhuji 或 palette 內容。

## 4. Director agent／skill 的混合式選項規則

目標檔案：

- `.agents/agents/director.md`
- `.agents/skills/director-orchestration/SKILL.md`
- `.agents/skills/director-orchestration/references/workflow-routing.md`
- Director prompt（若該工作區存在）與相關 lint fixture

工作內容：

- 明確規定核心概念、背景、性格與關係資料收集後，先提出 3 個模式中立的 Blueprint 方向。
- 每個選項要有簡短標題、自然語言摘要、主要取捨／後續影響；保留重新生成、混合與自行描述。
- 只有使用者要求調整或真的存在未決高影響分支時，才切換成單一維度的 2–5 個選項。
- Director 只整理 intake／Blueprint，不生成珠璣模組、調色盤模組或自我介紹語料。
- 不向使用者顯示 task、revision、lease、artifact path 或 schema 欄位名稱。

驗收：agent lint 通過；prompt 不再要求 Director 逐一詢問珠璣八個 self-introduction 欄位。

## 5. Zhuji／Palette creator 邊界與順序

目標檔案：

- `.agents/agents/zhuji-creator.md`
- `.agents/skills/zhuji-creation/SKILL.md`
- `.agents/skills/zhuji-creation/references/generation-guide.md`
- `.agents/skills/zhuji-creation/references/module-self-introduction.md`
- `.agents/agents/palette-creator.md`
- `.agents/skills/palette-creation/SKILL.md`
- `.agents/skills/palette-creation/references/generation-guide.md`

工作內容：

- Zhuji Creator 改為只依 Blueprint、accepted facts 與已完成的前置模組產生 proposal。
- 固定並測試珠璣順序：`appearance → inner_nature → extension → trait_refinement →
  trait_dialogue → scene_dialogue → self_introduction`。
- `self_introduction` 的 30 字、第一人稱、聲線與正式 schema 規則只在模組七執行。
- Palette Creator 採用同一個 Blueprint-first 邊界，固定其四模組順序：
  `basic_information → personality_palette → tri_faceted → secondary_interpretation`。
- 若 runtime 尚未阻止跳過前置模組，加入最小的順序 guard；既有模組修訂仍可讀取前置
  exact revisions，不得因重新發布而遺失既有內容。

驗收：直接提交後段模組而缺少前段 Blueprint／模組輸入時，系統回傳可恢復的 needs_input；
正常順序提交則維持既有 schema 驗證與 artifact revision 行為。

## 6. API、儲存與相容性測試

新增或更新測試：

- `packages/core/test/interview.test.ts`：方向選項、重新生成／覆寫、舊 `zhuji_intro:*`
  相容讀取、空答案、流程完成，以及使用者未主動提及時跳過成人欄位的敏感內容邊界。
- `packages/runtime/test/project-interview.test.ts`、`runtime.test.ts`：Blueprint precheck
  收錄方向、未確認時阻擋、確認後才可 author、published 修改建立 successor，以及 runtime
  context 不暴露舊狀態的成人欄位。
- `packages/server/test/server.test.ts`、`project-manager-server.test.ts`：context 回傳選項、
  answer 仍只需自然語言字串、MCP/REST 行為一致。
- Zhuji／Palette authoring tests：訪談不建立模組、前置模組順序、最後才產生
  `self_introduction`、調色盤四模組共用 Blueprint。
- agent lint fixtures：所有角色定義、prompt、skill、personality 綁定完整。

## 7. 文件與使用者說明

- 更新 `README.md` 及相關 workflow 文件，明確展示：
  `訪談 → Blueprint → 模式 Creator → 逐模組 authoring → review → preview → publish`。
- 說明使用者只需選方向或給短修改；模組欄位、30 字限制與 schema 由 Agent／引擎處理。
- 說明珠璣 `self_introduction` 是最後一個正式模組，不是訪談表單。

## 8. 完整驗證與交付

- 驗證結果：`pnpm typecheck`、`pnpm agent:lint` 均通過。
- 驗證結果：28 個測試檔、154 個測試全部通過；coverage 為 statements 95.41%、
  branches 90.10%、functions 95.17%、lines 95.41%。
- 以一個珠璣與一個調色盤的端到端 fixture 驗證：方向選擇只進 Blueprint，正式模組依序
  產生，最後可進入既有 review／preview／publish。
- 回報修改檔案、測試結果與任何仍需使用者決定的行為；本計畫已完成。
