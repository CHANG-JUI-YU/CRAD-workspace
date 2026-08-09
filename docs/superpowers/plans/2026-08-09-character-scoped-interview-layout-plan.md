# 角色級訪談與語意資料夾佈局實作計畫

> 依 `docs/superpowers/specs/2026-08-09-character-scoped-interview-layout-design.md` 實作。
> 每一階段先跑該層 targeted tests；失敗時保留上一個有效 revision，不進行破壞性搬移。

## 1. Core：角色 subject 與 interview contract

### 變更

- 在 `packages/core/src/interview.ts` 增加 `InterviewCharacterSubject`、roster parsing helper
  與 `active_character_id` 相容欄位。
- `card_shape` 後，多角色新增自然語言 roster 問題；解析換行、頓號、逗號、分號，產生穩定
  `character-1...` subject；單角色建立一名 subject 但保留目前問法。
- 將 `blueprint_direction` question 變成逐角色動態 question，保留 regenerate、短句修改與
  各角色獨立 history。
- 更新 `packages/core/src/index.ts` 的 interview question／state schema，舊 state 無 roster
  時安全映射為單一 subject。

### 測試

- `packages/core/test/interview.test.ts`：單角色相容、多角色 roster、逐角色方向、A 修改不影響 B、
  舊全域 direction 映射。
- 先執行 `pnpm exec vitest run packages/core/test/interview.test.ts --maxWorkers=1`。

## 2. Runtime／Domain：角色級 Blueprint 與 precheck

### 變更

- `packages/runtime/src/index.ts`：`buildBlueprintPrecheck` 以 roster 與每個動態方向答案建立
  `candidate_blueprint.characters[]`；單角色同時產生 legacy `blueprint_direction` mirror。
- `blueprintContent`、`latestBlueprintSnapshot`、authoring context 與 Blueprint revision 保留
  每名角色的 direction provenance。
- `BlueprintPrecheckCheck.subject_id` 按 spec 分為角色級與 project-level；缺少任一角色方向時
  不建立 recorded precheck。
- 角色方向 revision request 必須能鎖定單一角色；無法安全辨識時只回傳一個簡短選擇問題。
- `.agents/skills/director-orchestration/SKILL.md`、workflow-routing、Director prompt 與相關
  interview 文件更新為 roster → per-character direction。

### 測試

- `packages/runtime/test/project-interview.test.ts`、`packages/runtime/test/runtime.test.ts`：
  多角色 candidate、precheck subject、revision history、舊 Blueprint 相容。
- 執行 runtime／domain 相關 targeted tests 與 typecheck。

## 3. Core repository：語意路徑與 legacy layout 遷移

### 變更

- `packages/core/src/index.ts` 的 `artifactFilePath` 改為：
  `blueprint/`、`world/`、`relationships/`、`greetings/` 與既有 `characters/`、`plugins/`。
- 流程型 artifact 不再落到公開 `artifacts/` 或 `proposals/`；必要內容只保存於 state／audit／
  manifest／register，未知內容移到 `.workspace/artifacts/`。
- materializer 以穩定角色 id 加可讀名稱建立資料夾，新增兩名角色同名／同 module 的隔離測試。
- 新增 idempotent legacy migration：對現有 `proposals/`、exports 子資料夾先 staging、hash
  驗證，再移至語意路徑；無法辨識的檔案放 `.workspace/legacy-layout/unresolved/`；舊檔在
  migration 成功前不刪除，失敗可重跑。
- 不把使用者現有 `projects/` 直接當測試寫入目標；使用臨時 fixture 驗證遷移。

### 測試

- `packages/core/test/file-repository.test.ts`：語意路徑、流程 artifact 隱藏、legacy migration
  no-op／retry／unresolved、兩名角色互不覆寫。
- 確認現有 wardrobe revision 行為仍保留。

## 4. Domain publish：exports 最小輸出

### 變更

- `packages/domain/src/build.ts` 與 `packages/core/src/index.ts` 僅寫最終具名角色卡 JSON 與 PNG。
- 移除 `exports/ccv3.json`、`exports/card.json`、`exports/manifest.json` 與公開 plugin trace；
  trace 留在 `.workspace`。
- 為 PNG 建立與 JSON 相同 stem 的 export path；publish transaction 對舊輸出使用安全 replace，
  失敗時保留上一套 exports 與 project status。
- 更新 `publishedCardExportPath` 相關 helper、write set remove／backup 行為與既有 publish tests。

### 測試

- `packages/domain/test/build-import.test.ts`、`packages/server/test/server.test.ts`、
  `packages/adapters-png/test/card.test.ts`：JSON／PNG 只有最終輸出，失敗不留半套檔案。

## 5. 文件、Agent 與回歸

### 變更

- 同步 `README.md`、`memo.md`、migration map、Director／Creator 文件與新目錄樹。
- 新增 migration／layout 使用說明，明確說明 proposal 不再是公開資料夾。

### 驗證順序

1. Core／runtime targeted tests。
2. `pnpm typecheck`。
3. `pnpm test -- --maxWorkers=1`。
4. `pnpm agent:lint`。
5. 如需 coverage，再記錄既有 branch threshold 與本次新增測試的影響。

## 安全停點

- Interview／Blueprint schema 未通過前，不改 repository layout。
- Repository migration 未通過 hash／rollback 測試前，不觸碰現有 workspace projects。
- Publish output 測試未證明 atomic replace 前，不移除舊 exports 寫入路徑。
- 任一階段失敗只保留新狀態於 staging／測試 fixture，不刪除使用者既有檔案。
