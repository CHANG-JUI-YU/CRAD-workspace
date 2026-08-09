# 跨模式 Wardrobe 實作計畫

## Status

已完成實作與回歸驗證；本文件保留原始步驟與驗收條件作為交付紀錄。

> 對應 spec：`docs/superpowers/specs/2026-08-09-cross-mode-wardrobe-design.md`
>
> 範圍只涵蓋跨模式 wardrobe 產物；不重寫其他 Agent 正在處理的 CCv3／PNG compiler 內核、交易或跨實例 CAS。若這些元件的公開 canonical payload 尚未穩定，先在其邊界接入 wardrobe，不改變其交易語意。

## 1. 建立回歸基線與盤點公開合約

目標檔案／資料：

- `packages/core/src/index.ts`
- `packages/core/src/templates.ts`
- `packages/runtime/src/index.ts`
- `packages/domain/src/authoring.ts`
- `packages/domain/src/workflow-gate.ts`
- `packages/compiler/src/index.ts`
- `.agents/registry.yaml`
- 目前的 core、runtime、domain、compiler、agent lint 測試

工作內容：

- 記錄現有 `ArtifactKind`、`TemplateKind`、proposal 提交、review gate、canonical compile output 的形狀。
- 確認目前角色模組完成條件與 published editable revision 行為。
- 先執行既有 `pnpm typecheck`、`pnpm test -- --maxWorkers=1`、`pnpm agent:lint`；若 full coverage 有環境性失敗，單獨記錄，不把它誤判為 wardrobe 回歸。
- 對照 CCv3／PNG compiler 目前公開邊界；只採用既有穩定介面，不直接修改其他 Agent 的未完成內核。

驗收：有一份可重現的基線結果，且明確列出 wardrobe 要接入的最小邊界。

## 2. Core：正式 artifact 與 Markdown 解析合約

目標檔案：

- `packages/core/src/index.ts`
- `packages/core/src/templates.ts`
- 新增 `packages/core/src/wardrobe.ts` 或同等獨立模組
- `packages/core/test/templates.test.ts`
- 新增 wardrobe core tests

工作內容：

- 新增 `wardrobe` artifact/template kind，納入所有狀態、context 與 proposal kind 聯合型別。
- 定義模式中立的 wardrobe 內容合約；公開給 Agent 的輸入以自然語言內容為主，不把底層計數器、revision 或檔案路徑變成使用者必填欄位。
- 建立 Markdown parser／normalizer：識別固定標題、衣物種類、款式列、數量、總件數、搭配引用與推導備註。
- 只有完全相同的款式、顏色、材質、版型、用途與狀態才合併數量；同款不同顏色、材質、版型或用途分列。
- 固定完整衣物種類，至少覆蓋上衣、下身、洋裝、外套、內衣、內褲、襪類、睡衣、家居服、制服、工作服、運動服、泳裝、鞋類、包包與配件。
- 對數量採非負整數驗證，檢查分類加總是否等於衣櫃總件數；驗證搭配引用不能指向不存在的款式。
- 產出可供 compiler 使用的 normalized view，但以 Markdown 為持久化與人類編輯主體。

驗收：有效的 `wardrobe.md` 能解析；200 件衣物可由合併款式表達並正確核對；格式、數量或引用錯誤回傳可恢復診斷，不會清空內容。

## 3. Domain：保存、revision 與 workflow gate

目標檔案：

- `packages/domain/src/authoring.ts`
- `packages/domain/src/workflow-gate.ts`
- `packages/domain/src/review.ts`
- 對應 domain tests

工作內容：

- 讓 `wardrobe` 走正式 authoring／artifact revision 路徑，而不是普通備註 artifact。
- 建立每角色一份 wardrobe 的 materialization 路徑：`project/characters/<character-folder>/wardrobe/wardrobe.md` 與歷史 `revisions/`。
- 將 wardrobe 納入內容、review、preview、publish gate；未通過 parser／數量／引用驗證的 revision 不得發布。
- 允許已發布專案建立 successor revision，只標記受影響的 wardrobe 與 downstream preview stale，不重置訪談或其他角色模組。
- 保留上一個有效 revision；任何新 revision 寫入失敗不得破壞既有檔案或已發布快照。
- 讓既有 Character Critic 能讀取 wardrobe normalized view，建立一致性 finding；不新增 Wardrobe Critic。

驗收：草稿、審查、預覽、發布與已發布後修改的狀態轉移一致，且 revision 可追溯。

## 4. Runtime：自動建立、路由與自然語言修訂

目標檔案：

- `packages/runtime/src/index.ts`
- `packages/runtime/src/agent-router.ts`
- `packages/runtime/src/agent-registry.ts`
- `packages/runtime/src/project-manager.ts`
- `packages/runtime/test/project-interview.test.ts`
- `packages/runtime/test/agent-runtime.test.ts`
- 新增 wardrobe runtime tests

工作內容：

- 在 Blueprint confirmed 且珠璣／調色盤角色設定完成後，預設建立 wardrobe authoring task。
- 支援 Director 以自然語言跳過、延後或重新啟用 wardrobe；不要求新增問卷欄位。
- 建立 wardrobe template context，向 Agent 提供 Blueprint、角色模組、世界設定、accepted facts、既有 wardrobe revision 與修改要求。
- 將 wardrobe 路由至 `wardrobe-creator`，並保留 Character Critic 的唯讀檢查路徑。
- 支援局部修改：只更新受影響的衣服種類與搭配，重新解析並核對總件數；不要重新建立整個角色。
- 在 context 與使用者可見訊息中隱藏 task、lease、revision id、schema 欄位與檔案路徑等底層細節。
- 對缺少推導資料使用可恢復預設；無法安全修復時回傳簡短 needs-input，而非通用例外或流程卡死。

驗收：珠璣與調色盤都能在同一流程產生 wardrobe；自然語言修改能產生新 revision；跳過或延後不會阻塞其他角色內容。

## 5. Agent／Skill／Personality 與 registry

目標檔案：

- `.agents/agents/wardrobe-creator.md`
- `.agents/skills/wardrobe-creation/SKILL.md`
- `.agents/skills/wardrobe-creation/references/`
- `.agents/personalities/wardrobe-creator.yaml`
- `.agents/registry.yaml`
- `.agents/aliases.yaml`
- 若有 generated prompt／opencode 設定，同步更新對應檔案

工作內容：

- 建立 Wardrobe Creator 的角色邊界：只生成或修訂 wardrobe，不改寫 Blueprint、模式模組或其他 artifact。
- 明確要求以 Markdown 產出，按衣服種類分區、同款合併數量、列出完整私人衣物類別，並確保總數可核對。
- 明確規定根據性格、經濟狀況、生活方式、氣候與角色設定推導，而不是憑空列一份通用服裝清單。
- 將不確定值標為推導／創作補完，優先採用可恢復預設；不可安全判定才請使用者補充。
- 為 Agent 掛載獨立 personality，遵循現有 registry 的 prompt／personality／skill 三者一致檢查。
- 加入 `wardrobe` alias 與 `wardrobe-authoring` intent；不新增底層參數型 intent。

驗收：`pnpm agent:lint` 通過，Agent 能理解跨模式輸入且不會要求使用者填 schema 欄位。

## 6. Compiler：canonical payload 與卡片輸出接入

目標檔案：

- `packages/compiler/src/index.ts`
- `packages/compiler/test/compile.test.ts`
- `packages/compiler/test/semantic.test.ts`
- 如 canonical payload 合約需要，才修改 `packages/adapters-ccv3/src/index.ts`、`packages/adapters-png/src/index.ts`

工作內容：

- 解析正式 wardrobe artifact／Markdown normalized view，將其掛入 canonical character payload 的 `wardrobe` 欄位。
- 保留完整可讀 Markdown；若下游格式沒有原生 wardrobe 欄位，使用受控文字 fallback，不丟失原始內容。
- 不改變珠璣／調色盤既有 module-to-card mapping，也不把 wardrobe 偷塞進 appearance、personality 或 scenario。
- 與其他 Agent 的 CCv3／PNG compiler 工作以公開 payload 邊界整合；若對方已提供正式 extension 欄位，採用該欄位，不另造第二套格式。
- 驗證未發布或未通過 gate 的 wardrobe 不會進入輸出；重新發布使用最新有效 revision。

驗收：同一份 wardrobe 在珠璣與調色盤編譯結果都可直接被角色卡／Agent 使用；JSON 與 PNG 相關輸出測試通過。

## 7. 專案檔案與使用者文件

目標檔案：

- `README.md`
- `memo.md`
- `docs/wardrobe-sample.md`
- 相關 workflow／publish 說明
- 專案 fixture 與 sample `wardrobe.md`

工作內容：

- 說明 `訪談 → Blueprint → 角色設定 → wardrobe.md → review → compile → publish`。
- 說明衣櫃按種類與款式合併，數量可核對，以及如何用自然語言修訂。
- 說明 `wardrobe.md` 是可閱讀與可手動調整的正式內容；不要求使用者處理 schema、revision 或 compiler 參數。
- 補一份含內衣、睡衣、運動服與 200 件總數的 fixture，供文件與測試共用。

驗收：新使用者只看 README／memo 即能知道衣櫃檔案位置、內容格式與修改方式。

## 8. 測試矩陣與完成檢查

新增／更新測試：

- Core：Markdown parser、固定標題、衣服種類、款式合併、數量總和、搭配引用、錯誤診斷。
- Domain：artifact、revision、review／publish gate、失敗保留上一版。
- Runtime：自動生成、珠璣／調色盤共用、跳過／延後、自然語言局部修訂、context 邊界。
- Agent：registry、prompt、skill、personality 綁定與 lint fixture。
- Compiler：canonical `wardrobe` 欄位、完整 Markdown 保留、JSON／PNG 輸出、published revision。
- Regression：既有訪談、Blueprint、珠璣、調色盤、source、fact、plugin 與交易／CAS 測試不可回歸。

交付前執行：

1. `pnpm typecheck`
2. 受影響 package 的 targeted tests
3. `pnpm test -- --maxWorkers=1`
4. `pnpm agent:lint`
5. `pnpm test:coverage -- --maxWorkers=1`（若有環境性失敗，分別記錄原因與受影響範圍）

## 9. 實作順序與安全停點

實作順序固定為：

1. Core 合約與 parser
2. Domain artifact／revision／gate
3. Runtime context／路由／修訂
4. Agent／skill／personality／registry
5. Compiler canonical payload
6. 文件、fixtures 與完整測試

每一步完成後先跑該層 targeted tests；只有通過才進入下一層。任何 parser、revision 或 compiler 邊界不確定時，先保留上一個有效版本並停在該步，不以破壞既有角色資料換取進度。

## 10. 實作結果

- Core：`wardrobe` artifact/template、Markdown parser、總件數與搭配引用驗證完成。
- Domain：正式 authoring、revision、角色引用與 publish gate 驗證完成。
- Runtime：衣櫃 context、`wardrobe-creator` 路由、Blueprint／角色設定前置檢查與自然語言修訂路徑完成。
- Agent：prompt、skill、personality、registry、alias 與 OpenCode mount 完成。
- Compiler：canonical `wardrobe` 欄位、完整 Markdown lore fallback、project metadata 與 PNG round-trip 完成。
- 文件：README、memo 與本 spec 的實際檔案路徑已同步。
- 驗證：`pnpm typecheck`、完整 `pnpm test -- --maxWorkers=1`（31 files／179 tests）與 `pnpm agent:lint` 通過；既有 coverage baseline 的 lines 為 95.74%，但全專案 branches 為 87.45%，仍低於既有 90% threshold，需另行補既有分支測試。
