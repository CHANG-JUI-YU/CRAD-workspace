# 工作區自訂規則修改備忘錄

本備忘錄記錄如何修改 ST-workspace-v3 的訪談、Blueprint、角色設定與驗證規則。

目前 Blueprint 方向的定義是「角色設定方向為主、與 `{{user}}` 的關係為次要影響」。方向選項應先描述角色的外在定位、內在驅動、反差、主要矛盾與聲線，再補充關係起點或互動影響；不得把三個選項都寫成單純的關係方向。

## 一、先分清三層

工作區的規則分成三種：

1. **模型行為規則**：告訴 Agent 如何提問、措辭與創作。
2. **流程引擎規則**：決定問題順序、分支、狀態與資料如何保存。
3. **Schema／驗證規則**：決定欄位、型別與必填資料是否合法。

只修改模型規則通常不會改變資料格式；修改引擎或 Schema 時，必須同步測試與建置。

## 二、訪談規則修改位置

### 1. 修改訪談問題文字、順序、選項與分支

主要檔案：

`packages/core/src/interview.ts`

這裡是訪談引擎的權威定義，包含：

- 問題文字
- 問題種類與選項
- 訪談順序
- 角色／世界／多人角色分支
- 角色設定入口先確認卡片形態，再確認完全原創／原作改編與來源分支
- Blueprint 方向選擇
- 創作模式選擇
- 最後確認與補充流程
- 敏感內容跳過條件
- 空答案與最小字數驗證

如果要讓系統真的改變提問流程，必須修改這個檔案。

對應測試：

`packages/core/test/interview.test.ts`

### 2. 修改 Director 的訪談方式與說話風格

主要檔案：

- `.agents/skills/director-orchestration/SKILL.md`
- `.agents/agents/director.md`

適合修改：

- 一次詢問幾個問題
- 是否提供選項
- 如何解釋 Blueprint
- 什麼情況需要追問
- 缺少低風險資料時是否自動補完
- 對使用者的語氣與說明方式

這些檔案主要影響模型行為，不會單獨改變引擎的實際狀態轉移。

### 3. 修改工作流階段與路由規則

說明文件：

`.agents/skills/director-orchestration/references/workflow-routing.md`

這裡描述 Blueprint、世界設定、角色設定、審查、發布等階段的路由與依賴。

若要改變實際狀態、Blueprint precheck、產物建立或階段推進，還要檢查：

`packages/runtime/src/index.ts`

### 4. 修改暫存專案與正式命名

主要檔案：

`packages/runtime/src/project-manager.ts`

這裡處理：

- `project-序號` 暫存資料夾
- 訪談完成後正式改名
- 專案列出與選擇
- 既有專案續作

### 5. 多角色 roster 與角色級 Blueprint 方向

多角色訪談的 roster、暫稱與逐角色方向由同一個引擎檔案處理：

- `packages/core/src/interview.ts`：`character_roster` 會把自然語言名單轉成穩定的 `character-1`、`character-2` subject；之後的 `blueprint_direction:<subject>` 依序只作用於目前角色。
- `packages/runtime/src/index.ts`：Blueprint candidate 的 `characters[]` 與 Blueprint precheck 的 character dimensions 依 subject 分列；修改方向時必須明確指出角色，不能套用到整張多角色卡。
- `.agents/skills/director-orchestration/SKILL.md` 與 `.agents/agents/director.md`：規定先收 roster、再逐名提出角色設定方向，不要求使用者輸入內部 ID。

單角色仍保留 `blueprint_direction` 舊問題 ID與 mirror，確保舊 state、Creator 與既有測試可讀；新的權威內容是 `characters[]`。

### 6. 專案資料夾與發布輸出

`packages/core/src/index.ts` 的 `FileProjectRepository` 是檔案佈局權威：

- 角色內容：`characters/<character>/character.json`、`zhuji/`、`palette/`、`wardrobe/`。
- Blueprint：`blueprint/blueprint.json`；世界、關係、開場白分別在 `world/`、`relationships/`、`greetings/`。
- 流程型 artifact 不建立公開 `proposals/`，必要資料留在 `.workspace/`。
- `exports/` 只保留最新可直接使用的 JSON 與 PNG；發布 ledger 另在 `.workspace/workflow.json`／state 保存。

讀取舊 root `state.json`、`proposals/` 或中間 exports 時，Repository 先寫入新語意檔案，再把舊內容完整移到 `.workspace/legacy-layout/<migration-id>/`；再次讀取應是 no-op。

## 三、角色設定規則修改位置

## A. 珠璣模式

### 1. 修改珠璣 Creator 的生成規則

主要檔案：

- `.agents/agents/zhuji-creator.md`
- `.agents/skills/zhuji-creation/SKILL.md`
- `.agents/skills/zhuji-creation/references/generation-guide.md`

適合修改：

- 七模組的生成原則
- 模組之間的依賴
- 跨模組一致性
- 內容詳細程度
- Blueprint 如何影響正式模組
- 哪些細節由模型補完、哪些情況要提問

### 2. 修改單一模組的寫法

檔案位置：

`.agents/skills/zhuji-creation/references/module-*.md`

對應七個模組：

1. `module-appearance.md`
2. `module-inner-nature.md`
3. `module-extension.md`
4. `module-trait-refinement.md`
5. `module-trait-dialogue.md`
6. `module-scene-dialogue.md`
7. `module-self-introduction.md`

### 3. 修改珠璣欄位、型別與必填條件

權威 Schema：

`packages/core/src/zhuji.ts`

這裡決定：

- 七個 module kind
- 欄位名稱
- 欄位型別
- 必填欄位
- 最小內容長度
- 語料格式驗證

如果新增、刪除或重新命名欄位，通常還要同步：

`packages/core/src/zhuji-template.ts`

這裡提供：

- 模組順序
- required sections
- 欄位提示
- 範例
- `workspace_zhuji_context` 回傳的 Creator contract

### 4. 修改珠璣模組順序

需要同步檢查：

- `packages/core/src/zhuji-template.ts`
- `packages/runtime/src/index.ts` 的 `ZHUJI_MODULE_ORDER`
- `.agents/skills/zhuji-creation/references/generation-guide.md`

只改其中一處可能造成模型指南、引擎依賴與驗證順序不一致。

## 跨模式衣櫃（Wardrobe）

衣櫃不是珠璣或調色盤的單一模組，而是兩種模式共用、可以獨立修改與發布的正式產物。完成 Blueprint 與角色設定後，Director 預設把工作交給 Wardrobe Creator；使用者也可以用自然語言跳過、延後或要求重新整理。

### 1. 修改衣櫃 Agent 的行為與個性

主要檔案：

- `.agents/agents/wardrobe-creator.md`
- `.agents/skills/wardrobe-creation/SKILL.md`
- `.agents/personalities/wardrobe-creator.yaml`

Agent 應根據 Blueprint、性格、生活方式、經濟狀況、氣候與活動需求推導衣物，不要求使用者填寫數量或底層參數。它要按衣服種類列出完整清單，包含內衣、內褲、襪類、睡衣、家居服、制服、工作服、運動服、泳裝、鞋、包與配件；只有款式、顏色、材質、版型、用途與狀態都相同時才可合併，同款不同顏色必須分列並保留實際數量。

### 2. 修改衣櫃格式與驗證

權威解析器與 proposal schema：

- `packages/core/src/wardrobe.ts`
- `packages/core/src/templates.ts`

`wardrobe.md` 至少包含一級標題、總件數、各種類的 Markdown table、搭配組合與推導備註。新產出的每個表格固定使用「款式、顏色、材質、數量、主要場合、狀態、備註」七欄；每列的描述要具體到版型、色款、面料、使用場合、持有狀態與保養／收納注意事項。同款不同顏色不可合併。引擎會核對清單加總、數量格式與搭配引用。錯誤會形成可修復診斷，不會清空上一個有效版本。

### 3. 檔案位置與修改方式

正式檔案位於：

`projects/<project>/characters/<character-folder>/wardrobe/wardrobe.md`

歷史版本在同一資料夾的 `revisions/`。可以直接編輯 Markdown，也可以對 Director 說「增加兩件冬季外套」等自然語言；Runtime 會建立新的 revision，不重跑訪談、不改寫 Blueprint 或珠璣／調色盤模組。若內容不完整，先保留上一版並只提出必要的簡短問題。

### 4. 編譯與發布邊界

- `packages/domain/src/authoring.ts`：正式 artifact 與 successor revision。
- `packages/domain/src/workflow-gate.ts`：衣櫃 parser、角色引用與 review gate。
- `packages/runtime/src/index.ts`：衣櫃 context、前置條件與 proposal 路由。
- `packages/compiler/src/index.ts`、`packages/adapters-ccv3/src/index.ts`：將完整 Markdown 放入 canonical `wardrobe` 欄位，並以 lore fallback 保留內容。

衣櫃與模式無關；珠璣和調色盤使用同一份內容。未通過驗證或尚未 review 的 revision 不會進入正式輸出，已發布版本則會保留到下一次發布成功。

## B. 調色盤模式

### 1. 修改調色盤生成規則

主要檔案：

- `.agents/agents/palette-creator.md`
- `.agents/skills/palette-creation/SKILL.md`
- `.agents/skills/palette-creation/references/generation-guide.md`

目前四個模組順序為：

`basic_information → personality_palette → tri_faceted → secondary_interpretation`

### 2. 修改調色盤欄位與模組種類

主要檔案：

`packages/core/src/templates.ts`

這裡的 `paletteModuleKindSchema` 與 `paletteModuleSchema` 是調色盤提案的驗證來源。

若改變模組種類或順序，還要檢查：

`packages/runtime/src/index.ts` 的 `PALETTE_MODULE_ORDER`

## C. 一般角色文件

如果使用的是一般 `character` 文件，而不是珠璣或調色盤模式，主要驗證在：

`packages/core/src/templates.ts`

相關 Schema 包含：

- `characterDocumentTemplateSchema`
- `characterProposalValueSchema`
- relationship 欄位
- sections 與 provenance

## 四、審查規則修改位置

### 模型審查指引

- `.agents/agents/character-critic.md`
- `.agents/skills/character-critique/SKILL.md`
- `.agents/skills/character-critique/references/negative-rules.md`

### 引擎審查規則

`packages/domain/src/review.ts`

這裡決定自動審查會產生哪些 findings，例如內容過短、placeholder 或缺少性格描述。

### 發布 gate 與品質門檻

- `packages/domain/src/workflow-gate.ts`
- `packages/core/src/index.ts`

如果修改的是「什麼情況可以發布」，不要只改 Critic 的文字指引，必須同步修改 gate 或品質設定。

## 五、修改範例

### 想新增一題訪談問題

修改：

1. `packages/core/src/interview.ts`
2. `packages/core/test/interview.test.ts`
3. 若涉及 Director 的提問原則，再同步 `.agents/skills/director-orchestration/SKILL.md` 與 `.agents/agents/director.md`

### 想改訪談語氣，但不改流程

修改：

1. `.agents/skills/director-orchestration/SKILL.md`
2. `.agents/agents/director.md`

不需要先改 `interview.ts`。

### 想讓珠璣新增一個必填區塊

至少同步：

1. `packages/core/src/zhuji.ts`
2. `packages/core/src/zhuji-template.ts`
3. 對應的 `module-*.md`
4. `zhuji-creator.md` 或 `SKILL.md`
5. 相關測試

### 想讓某個欄位不再必填

先改 Schema，再同步 Creator contract 與 reference；否則模型可能仍然被指南要求填寫，或引擎與模型產生不一致。

## 六、不要直接修改的檔案

以下是建置或測試產物，不是規則來源：

- `packages/*/dist/**`
- `coverage/**`
- `node_modules/**`

文件資料夾中的 spec、plan、migration 文件只影響說明與紀錄，不會直接改變 Runtime 行為。

## 七、修改後驗證

在工作區根目錄執行：

```powershell
pnpm typecheck
pnpm agent:lint
pnpm test:coverage -- --maxWorkers=1
```

如果修改了 Schema、訪談流程或模組順序，必須同時更新對應測試，不要只確認 TypeScript 編譯成功。

## 八、最安全的修改順序

1. 先修改 Skill／reference，確認模型應該怎麼做。
2. 若流程本身要改，再修改 `packages/core/src` 或 `packages/runtime/src`。
3. 若資料形狀要改，再同步 Schema、template context 與 Agent 指引。
4. 更新測試。
5. 執行 typecheck、agent lint 與完整測試。
