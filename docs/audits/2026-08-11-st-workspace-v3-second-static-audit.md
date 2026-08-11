# ST-workspace-v3 第二次靜態稽核：BUG 與使用者體驗

- 稽核日期：2026-08-11
- 稽核版本：Git `main`，HEAD `cab23f8485ce2cf46cf78d742e151ff36c41b90d`
- 基準 Commit：`V3.14: 實作 CARD-03 角色圖像管線(DS)`
- 第一份報告：`docs/audits/2026-08-10-st-workspace-v3-comprehensive-static-audit.md`
- 稽核範圍：第一次 audit 修復後的 core、domain、runtime、compiler、CCv3/PNG adapters、server、Dashboard、project manager、檔案 materialization、operation recovery、import，以及 BUG／UX／CARD-03 修復設計與現有測試程式碼
- 本次目標：只尋找 BUG 與使用者體驗缺口；不評估程式碼精簡化／重構優化，也不新增角色卡功能
- 方法：靜態追蹤資料流、狀態轉換與跨模組合約，並將現行程式與修復設計、測試案例交叉核對
- 限制：依要求沒有執行 build、typecheck、單元測試、整合測試或 Tavern 實機載入，也沒有修改任何程式碼。本報告只列出能由現行程式碼直接證明的問題；外部宿主或特定環境才會出現的問題仍需實測發現。

## 一、結論摘要

第一次 audit 後的修復量很大，而且多數主要骨架確實已從「缺功能」前進到「有實作」：Required Artifact Manifest、逐角色訪談、逐項 precheck、四級 Quality Profile、typed operation command、transaction journal、operation lease、semantic mode renderer、canonical import、Dashboard、Tavern verifier 與圖片管線都已出現。

但目前不能把 BUG-01～35、UX-01～12 與 CARD-03 視為已可靠關閉。第二次靜態稽核確認：

| 分級 | 數量 | 判定 |
|---|---:|---|
| P0 | 3 | 會遺失目前輸出、讓未審查內容發布，或使 gate 的核心保證失效 |
| P1 | 14 | 常見工作流會錯誤完成、錯誤阻擋、錯誤復原，或 Dashboard 會操作錯誤目標 |
| P2 | 6 | 邊界、安全、匯入相容性、證據累積與識別碰撞問題 |
| 合計 | 23 | 均可由目前程式碼直接建立證據鏈 |

另外整理出 12 項第二輪 UX 改良。UX 項目會與部分 BUG 症狀重疊，因此不另外加入 BUG 數量。

最重要的六個結論是：

1. 最新發布的 PNG 會在下一次 repository read 時被當成 legacy export 移入備份區；開啟 Dashboard 或讀取狀態即可觸發。
2. Required Manifest 可能選到最舊的 Character revision，導致目前最新版角色設定完全不需 review 就能進入 compiler。
3. workflow gate 與 compiler 沒有使用同一份 artifact 集合；未審查 plugin、Blueprint 已停用的 world／relationships，以及 roster 外模式模組仍可能被打包。
4. operation 雖已有 lease API 與 typed command，但 worker 不續租、domain commit 不驗 lease、execution agent 未保存，崩潰復原仍可能換身分或重複執行。
5. continue／existing-world 仍是「在臨時專案做完整訪談，最後只切換到目標專案」；訪談生成的 Blueprint 不會套入目標專案，卻回報 completed。
6. Dashboard 的 operation、issue、image 按鈕存在 JavaScript closure 錯誤；多列畫面上的按鈕都會作用到最後一列，並可能取消已完成 operation、處理錯誤 issue 或移除錯誤圖片。

因此目前最合理的狀態是：

> 可以繼續由人工監督進行小範圍全新專案測試，但尚不能把「發布內容就是已審查集合」、「最新 PNG 一定留在 exports」、「崩潰後會以同一 agent 安全重播」或「Dashboard 按鈕操作的是所見項目」視為可靠保證。

## 二、基準核對與本次不重複列出的項目

### 2.1 目前確實已有的能力

以下能力已存在，不應沿用第一次 audit 前的舊結論：

- typed Zhuji／Palette semantic renderer 會保存標題、key 與巢狀層級，不再只是 leaf-value 串接。
- compiler 已支援 Blueprint `label`／`display_name` 與明示 `primary_character_id`。
- Quality Profile 已有 none／light／normal／strict、policy snapshot、issue override 與 audit 欄位；publish gate 也不再要求 review 必須是 `passed`，而是依 open issue 的 effective severity 判定。這項語意是已批准設計，本報告不把 partial／failed review 本身列為 BUG。
- fact review 已有 Review Run、decision、conflict／needs-evidence 與 accepted projection。
- CCv3 JSON envelope、PNG card metadata、世界書、greeting、relationships、wardrobe 與 mode 模組投影仍符合目前已批准的打包方向。
- CARD-03 已有圖片 blob、PNG 驗證、裁切、Dashboard 上傳／預覽、compiler image injection 與 build 選圖的基本路徑。
- plugin generator 已產生 typed contribution、helper／regex／lore 投影與 trace。本次沒有 Tavern 宿主實測，因此不把「外部宿主是否真正執行 helper runtime」列為已確認 BUG；這仍是需要 E2E 驗證的風險。

### 2.2 修復編號說明

使用者描述的完成範圍是 BUG-01～32；目前 Git 歷史另有 `fac182f V3.12: 修復 BUG-31/32/33/34/35(DS)`。本報告以現行 HEAD 為準，不以 commit 訊息判定完成，也不假設 BUG-33～35 未處理。

第二次 audit 使用 `BUG2-xx`／`UX2-xx`，避免與第一次報告混淆。每項會標明是「第一次修復未閉合」、「修復間整合回歸」或「第二次新發現」。

## 三、第二次確認的 BUG

### 分級定義

- P0：會破壞目前輸出、發布審查邊界或核心資料一致性；擴大實測前應先處理。
- P1：常見路徑可遇到，會造成錯誤完成、錯誤產物、永久阻擋、錯誤復原或顯著誤導。
- P2：較低頻、邊界、安全、匯入相容性或長期資料品質問題。

## 四、P0：輸出與發布邊界

### BUG2-01：目前發布的 PNG 會在下一次 read 被自動封存

性質：修復間整合回歸（blob publish × legacy migration × materialization）。

證據鏈：

- `packages/domain/src/build.ts:193-203` 的新 PublishRecord 保存 `png_ref` 與 `export_png_path`，不再保存 `png_base64`。
- `packages/core/src/index.ts:1566-1577` 的 `archiveExistingLegacyLayout` 只在 `latest.png_base64 !== undefined` 時把 PNG 放進 keep set；使用 `png_ref` 的目前發布不會被保留。
- `packages/core/src/index.ts:1426-1444` 的每次 `FileProjectRepository.read()` 都會呼叫該 archive；Dashboard、status、build readiness 與多數 runtime 操作都會觸發 read。
- `packages/core/src/index.ts:2023-2037` 的 materialization 也只會從 inline `png_base64` 重建 PNG，不會從 `png_ref` blob 重建。
- legacy migration 的 keep 邏輯在 `packages/core/src/index.ts:1522-1527` 有同一問題。

結果：發布當下 PNG 會短暫存在；下一次讀專案時，它會被移到 `.workspace/legacy-layout/migration-*`。JSON 因無條件依 `export_json_path` 保留，通常仍留在 exports，造成「JSON 在、PNG 不見、state 還顯示 published」的不一致。

建議：

- keep 條件應依 `png_ref`、`png_base64` 或已保存的 `export_png_path` 判斷，而不是只看 legacy inline 欄位。
- materialization 應能從 content-addressed blob 還原 JSON／PNG。
- 必須新增 `publish → repository.read/reopen → dashboardSnapshot → exports PNG 仍存在` 的檔案整合案例。

### BUG2-02：Required Manifest 可能選到最舊 Character revision，最新版可逃過 review

性質：BUG-03 修復未閉合。

證據鏈：

- `packages/domain/src/required-artifacts.ts:151-167` 的 `latestCharacterFor` 依匹配分數選角色；只有 `score > bestScore` 才替換。相同角色的後續 revision 通常與舊 revision 同分，因此保留陣列中最早出現的舊 artifact。
- manifest 將舊 artifact id 放進 `in_scope_artifact_ids`（`required-artifacts.ts:262-300`）。
- workflow gate 先以 key 取得最新 artifact（`packages/domain/src/workflow-gate.ts:42-45`），再以 manifest 的 artifact id 過濾（`:144-147`）。最新版 id 不等於 manifest 中的舊 id，因此 Character 會整個消失在 review scope。
- compiler 則會使用 latest-by-key 的最新版（`packages/compiler/src/index.ts:784-800`）。

結果：舊版 Character 有 review、後來建立一個同 key 的新 revision，即使新版未審查，gate 仍可能通過；compiler 打包的卻是新版內容。這直接破壞「發布內容必須審查目前 revision」的核心保證。

建議：先以 key 建立 current artifact projection，再做 roster matching；manifest requirement 應綁定 `artifact_key + exact revision`，gate 不應只以 id 交集判定。

### BUG2-03：workflow gate 與 compiler 使用不同 artifact 集合

性質：BUG-03／BUG-23 修復整合缺陷。

證據鏈：

- manifest 只在 Blueprint `world.enabled`／`relationships.enabled` 為 true 時把對應 artifacts 納入 scope，且只納入 roster 角色的選定 mode；它沒有把 plugin 放進 scope（`packages/domain/src/required-artifacts.ts:304-348`）。
- review 與 blocking issue 只檢查 manifest scope（`packages/domain/src/workflow-gate.ts:219-252`）。
- compiler 的 `isIncludedArtifact` 只排除技術 artifact，對 world、relationships、wardrobe、greeting、plugin 都直接包含；mode artifact 只看全域 mode selection，不檢查 Blueprint roster（`packages/compiler/src/index.ts:756-790`）。
- 相反地，`reportBlueprintBindings` 又對所有 latest artifact 檢查 binding，而不是只檢查 manifest scope（`packages/domain/src/workflow-gate.ts:503-517`）。

可直接推導的錯誤：

- Blueprint 已停用 world 或 relationships，但目前仍有同 revision binding 的舊 artifact：gate 不要求它 review，compiler 仍會打包。
- plugin artifact 永遠不在 manifest review scope，但 compiler 會生成 plugin contribution。
- roster 外的 `zhuji`／`palette` artifact 若符合本次全域模式，不需 review 仍會成為世界書條目。
- 未選模式 artifact 若 binding 已過期，雖不應參與本次 export，仍可被 `BLUEPRINT_BINDING_STALE` 阻擋。

結果：同一批資料可能同時「未審查卻被打包」與「不打包卻阻擋發布」。

建議：建立單一 immutable `BuildPlan`／`PublishPlan`，由 Blueprint、export mode 與 current projection 產生；gate、review、blocking issue、compiler、build trace 與 preview 全部只消費這份 plan。凡 compiler 會讀取的 artifact 都必須出現在 review scope。

## 五、P1：常見工作流與操作錯誤

### BUG2-04：打包 mode 決策發生在 gate 之後，且有 Manifest 時可能跳過詢問

性質：BUG-03 與 BUG-24 的整合回歸。

證據鏈：

- `packages/domain/src/build.ts:43-67` 在知道本次 mode selection 前先執行 publish gate。
- 之後才計算 available modes 與 manifest mode（`:75-86`）。若 Blueprint 只有一個選定 mode，`modeSelection` 會直接被指定，即使專案同時具有 Zhuji 與 Palette，也不再詢問。
- 若 Blueprint roster 中同時出現兩種 mode，manifest 的 `export_modes` 是 `both`，build 卻允許使用者再選單一 mode；compiler 隨後會移除另一模式的角色設定。
- `buildRequiredArtifactManifest(state, exportMode)` 的 exportMode 目前只改回傳標籤，沒有依本次選擇重新計算 requirement 與 scope（`packages/domain/src/required-artifacts.ts:340-347`）。

結果：

- 違反已確認的「擁有兩種模式時，每次打包前詢問」需求。
- 使用者選定單一模式前，可能被其實不會打包的另一模式 review 卡住。
- 混合模式多人卡可通過 gate，之後因全域單一 mode 選擇而遺失部分角色設定。

建議：先呈現 mode 選擇，再用該選擇生成 exact plan，然後 gate，最後以同一 plan compile；不要先 gate 再改 compiler 輸入。

### BUG2-05：Manifest 可被缺失 mode、歷史 greeting 與模糊 ID 誤判為完整

性質：BUG-03 修復未閉合。

證據鏈：

- Blueprint character 沒有合法 mode 時，manifest 仍把 Zhuji modules 當 required list，但只在 `mode !== undefined` 時產生 `MODE_MODULES_INCOMPLETE`；`mode_complete: false` 本身不會阻擋（`packages/domain/src/required-artifacts.ts:260-299`）。
- greeting coverage 掃描所有歷史 greeting artifacts，而不是 current revision（`:170-187`）。
- coverage 使用 `id === primaryCharacterId || id.includes(primaryCharacterId)`；例如 `momoka-2` 或 `not-momoka` 都可能被當成 `momoka` 的 greeting。
- world／relationship completeness 同樣以所有歷史 artifacts 的「存在」判定（`:190-196`、`:304-327`）。

結果：缺模式、目前 greeting 已移除 primary、或只有舊版 world／relationships 時仍可能顯示完整。

建議：所有 manifest helper 先使用 current projection；character mode 必須是必要 enum，coverage 只做 exact normalized id matching，並將 `mode_complete === false` 轉成明確 error diagnostic。

### BUG2-06：authoring readiness 仍讀歷史 artifact，且不驗證 roster／選定 mode

性質：BUG-14／BUG-23 修復未閉合。

證據鏈：

- `parsedModeModules` 掃描 `state.artifacts` 全部歷史 revision，沒有 current projection 或 Blueprint binding（`packages/runtime/src/index.ts:129-140`）。
- `ensureBlueprintAuthoringReady` 只檢查前置 module 順序；不確認 `characterId` 在目前 roster，也不確認提交 kind 與該角色 Blueprint mode 相同（`:2580-2606`）。
- wardrobe readiness 只要歷史上存在任一 Zhuji／Palette artifact 就放行（`:2618-2641`）。
- world authoring order 也以任何歷史 world／character-side artifact 判定（`:2644-2673`）。

結果：舊 Blueprint revision 的 module 可解鎖新創作；拼錯 character id 或替 Blueprint 的 Palette 角色提交 Zhuji 仍可進入 authoring。使用者往往做到很後面才在 publish binding gate 被告知要重做。

建議：authoring readiness 直接消費 current manifest requirement；每次提交先驗證 roster、selected mode、current Blueprint binding 與前置 current module。

### BUG2-07：自然語言 review 仍會被 transport actor 誤判為作者自審

性質：BUG-01 修復只接到 typed proposal 路徑。

證據鏈：

- server 預設整個 session 使用固定 actor `server`（`packages/server/src/index.ts:797-812`）。
- typed authoring operation 的 `operation.actor` 保存 session actor；artifact.created_by 才保存 execution agent。
- `ReviewService.review` 除了比較 execution agent，還把建立 operation 的 session actor 與目前 `auditActor` 相同視為 `sameOperator`（`packages/domain/src/review.ts:234-257`）。
- runtime 的自然語言 review 正確傳入 critic agent，但 auditActor 仍是相同 `server`（`packages/runtime/src/index.ts:2119-2133`）。
- generic review 又預設路由到 `fact-reviewer-1`，而 natural-language capability 被明文設計為較寬鬆（`packages/runtime/src/agent-router.ts:23-31`；`agent-registry.ts:143-180`）。

結果：Dashboard／REST 自然語言「審查角色」即使路由到不同 critic，也可能固定回「作者自審」；模糊的「審查」則可能由 fact reviewer 審一般 artifact。typed review proposal 路徑沒有同一錯誤，造成入口行為不一致。

建議：自審只比較 execution agent identity；session actor 另存 initiated_by，不應代替 reviewer。自然語言 review 也必須套用 target-specific capability。

### BUG2-08：operation 未保存 execution agent，復原後身分會漂移

性質：BUG-01／BUG-08 修復未閉合。

證據鏈：

- `OperationCommand` 沒有 `execution_agent_id`（`packages/core/src/index.ts:429-435`）；agent id 只存在 operation-created audit details。
- `recoverOperation` 會重新依簡化後的 `operation.request` 做 routing（`packages/runtime/src/index.ts:1125-1140`）。
- review proposal 的 persisted request 只是 `create review`，復原時很容易重新路由為 `fact-reviewer-1`，而不是原本 target critic。
- legacy natural authoring／review replay 直接把 worker context actor 傳給 domain service（`:1392-1423`），沒有使用已解析 agent 建立 created_by／reviewer。
- fact reviewer rotation 也可能在重啟後重新計算成不同 reviewer。

結果：同一 operation 正常執行與 crash replay 會得到不同 creator／reviewer 身分，影響 self-review、capability、audit 與 fact reviewer 獨立性。

建議：在 operation 建立時保存已驗證的 execution agent、capability 與必要 policy snapshot；replay 只能使用原值，不能再次猜測。

### BUG2-09：source selection 的 typed recovery payload 形狀不一致

性質：BUG-08 修復中的明確欄位錯誤。

證據鏈：

- 建立 operation 時保存 `payload: { decisions }`（`packages/runtime/src/index.ts:1497-1513`）。
- replay 卻把整個 payload cast 成 `SourceSelectionDecision[]`，並直接讀 `.length`（`:1352-1360`）。

結果：如果程序在 operation 寫入後、selection domain commit 前崩潰，replay 看到的是 object 而不是 array，會錯誤進入 needs_input，要求使用者重送本來已保存的選擇。

建議：為每個 command type 建立 strict discriminated schema；source_select replay 讀取 `payload.decisions`，並加入 crash-window round-trip 測試。

### BUG2-10：worker 沒有續租，也沒有以 lease token 保護副作用 commit

性質：BUG-07 修復未達第一批設計的完成條件。

證據鏈：

- runtime 提供 `renewOperationLease`（`packages/runtime/src/index.ts:1093-1106`），但 production code 沒有任何呼叫；只有測試直接呼叫該方法。
- worker claim 後直接等待整個 `recoverOperation` 完成，最後才 release（`packages/runtime/src/worker.ts:182-211`）。預設 lease 為 60 秒。
- domain services 的 side-effect commit 不帶 lease token，也不在 commit callback 確認 ownership。
- `idempotency_key` 只有型別與 schema，production code 沒有設定或消費。
- 同步路徑預先寫入 lease 欄位後直接執行，完成時多數 `updateOperation` 不清除 lease；Dashboard 會永久顯示已失效的 lease metadata。

結果：擷取、import、build 或任何超過 60 秒的復原可被另一實例重新 claim；舊 owner 仍能完成後續 commit。lease 因此只是「避免短時間拾取」，還不是 single-executor 保證。

建議：worker 以小於 lease/3 的週期續租；每個副作用 commit 都驗 owner+token；失去 lease 立即停止；terminal transition 原子清除 lease；真正使用 idempotency key 去重。

### BUG2-11：continue／existing-world／character-expansion 仍會錯誤完成

性質：BUG-13 只修到「切換專案」，沒有把訪談結果套入目標。

證據鏈：

- manager 先在 fresh placeholder 完成整份 interview；runtime 已在 placeholder 建立 precheck／Blueprint。
- `answerInterview` 完成後，continue 與 existing-world 只呼叫 `select(target)`，然後把 placeholder 的 completed result 換上目標 project id（`packages/runtime/src/project-manager.ts:182-213`）。沒有 transaction 將 Blueprint、answers 或 precheck 套到目標。
- 現有 project-manager tests 只驗最後 selected project id，沒有比較目標專案 artifacts／revision。
- character expansion 訪談沒有先詢問目標 project；若先選一個已完成訪談的專案，runtime 也沒有公開入口重新啟動 expansion interview。
- legacy review 是例外：目前會讀檔並呼叫 import，因此不再列為同一缺陷。

結果：continue／補世界畫面可回 completed，但目標專案沒有任何新增設定；placeholder 的工作被留在隱藏專案。expansion 在一般 Dashboard／server 入口也無法可靠啟動於既有 Blueprint。

建議：先選目標，再在目標 repository 啟動對應子流程；或明確實作帶 expected target revision 的 merge transaction。不得在最後只替換回應中的 project id。

### BUG2-12：專案重新命名後，durable attachment store 仍指向舊 placeholder

性質：第二次新發現，BUG-08／BUG-27 整合缺陷。

證據鏈：

- `FileAttachmentStore` 在建構時固定保存 `projectId`，之後以該值組路徑（`packages/core/src/index.ts:2697-2733`）。
- manager runtime 在 placeholder id 建立 store（`packages/server/src/index.ts:806-812`）。
- `finalizeIfNamed` 會 relocate repository 並修改 project id，但不重建 runtime 或 attachment store（`packages/runtime/src/project-manager.ts:144-168`）。

結果：專案從 `project-001` 改名後，同一 session 後續上傳的 operation attachment 仍寫入舊 `project-001/.workspace/attachments`，甚至重新建立舊資料夾。重啟後新 runtime 會到正式專案資料夾找附件，typed recovery 回 `ATTACHMENT_NOT_FOUND`。

建議：attachment store 應由 repository 的目前 projectDirectory 動態解析路徑，或 relocate 後重建 runtime/store；加入 `rename → upload → restart → recover` 測試。

### BUG2-13：Dashboard 多列 action 會操作最後一列，cancel 還會改壞歷史狀態

性質：UX-06／UX-09／CARD-03 的前端整合 BUG。

證據鏈：

- operation loop 使用 function-scoped `var operation`，所有 callback 最後讀到同一個 operation（`packages/server/src/dashboard.ts:1249-1277`）。
- issue loop 同樣使用 `var issue`（`:1301-1329`）。
- image loop 同樣使用 `var image`（`:1401-1424`）。
- override 按鈕不傳 severity（`:1332-1338`），但 domain 明確要求 override severity（`packages/domain/src/review.ts:155-180`）。
- 每個 operation，不分 terminal／active，都顯示重試與取消。cancel endpoint 呼叫 `failOperation`；該方法會把 matching operation 設為 `failed`，server 卻回 `status: cancelled`。不存在的 id 也回成功並新增 failed audit（`packages/server/src/index.ts:607-625`；`packages/runtime/src/index.ts:1143-1161`）。

結果：使用者可按第一列卻取消最後一列、處理錯誤 issue、刪除最後一張圖片；已完成 operation 也能被改成 failed。override 點擊必定失敗並留下 running／retry operation。

建議：每列以 block-scoped binding 或 action factory 捕捉 immutable id；依狀態只顯示合法 action；cancel 使用專屬 CAS transition；override 先收集 severity/reason；以瀏覽器或 jsdom 實際點擊多列 fixture。

### BUG2-14：Blueprint precheck Dashboard 的資料合約不相容

性質：UX-03 名義完成、實際不可用。

證據鏈：

- `dashboardSnapshot()` 只回 precheck id、status、revision、checks_count，沒有回 `checks`（`packages/runtime/src/index.ts:2222-2224`）。
- Dashboard renderer 卻讀 `latest.checks`（`packages/server/src/dashboard.ts:1100-1113`），所以畫面固定顯示「最新預檢沒有檢查項目」。
- 即使補回 checks，core check schema 沒有 `check.status`；UI 卻依 status 顯示待處理／已確認（`dashboard.ts:1134-1138`）。真正狀態存在 action 與 user_answer。
- 每一列「標記確認」都只提交目前 interview 的通用回答「確認」，沒有帶 clicked subject／dimension（`:1140-1144`）。

結果：precheck matrix 目前既看不到逐項內容，也不能可靠確認指定列。

建議：建立明確 DashboardPrecheckViewModel，包含 subject、dimension、derived status、basis、answer 與 action availability；確認 endpoint 必須帶 precheck/check identity 或只允許操作目前 active check。

### BUG2-15：Repair preview 把目前 exports 當 legacy，run report 也不可信

性質：UX-11 修復工具合約錯誤。

證據鏈：

- `inspectRepair()` 只要 `exports/` 目錄存在，就把整個目錄列為 legacy file（`packages/core/src/index.ts:1373-1386`），但目前正式輸出本來就在 exports。
- `.workspace/legacy-layout` 下每一個 directory 都被列為 orphan backup，沒有檢查 journal、migration marker 或 reference（`:1387-1397`）。
- `runRepair()` 先呼叫 `read()`；read 本身已自動 archive，再以最初 inspection 的名稱宣稱 archived，沒有回報實際逐檔動作，也不處理 orphan_backups（`:1400-1408`）。
- 因為一般 read 已有 mutation，使用者看到 preview 前，server startup 或 Dashboard snapshot 可能早已移動檔案。

結果：正常專案幾乎必然被顯示需要修復；按下修復後的報告不代表實際移動內容，且會與 BUG2-01 疊加。

建議：preview 產生 exact immutable plan（source、target、reason、recoverability），不把目前 export directory 當 legacy；run 只能執行使用者確認的 plan hash，並保存 operation/audit/report。

### BUG2-16：Tavern compatibility verifier 會產生固定假陰性與假陽性

性質：UX-12 實作合約錯誤。

證據鏈：

- `readCardFromPng` 回傳完整 CCv3 envelope；verifier 卻將 `decoded.card` 與 `parsed.data ?? parsed` 比較（`packages/runtime/src/index.ts:2386-2393`）。正常 JSON 有 data，因此是 envelope 對 inner data，合法 export 也會被報不一致。
- plugin detection 只尋找 `data.extensions` 頂層 key 是否以 `plugin.` 開頭（`:2366-2368`）；實際 plugin trace 位於 `extensions["card-workspace"].plugins`，helper／regex 也有其他正式位置。
- 只要圖片尺寸為 512×768 就判為內建 placeholder（`:2379-2383`）；使用者真正圖片若剛好是標準尺寸會被誤報。
- JSON 路徑只做 `JSON.parse`，沒有使用 CCv3 schema 驗證。

結果：valid card 常被報 PNG/JSON 不一致、plugin 依賴永遠顯示無、真圖可能被說成 placeholder；使用者無法把此面板當作發佈前證據。

建議：兩邊都 parse 成完整 CharacterCardV3 後做 canonical compare；依正式 extension 路徑列 plugin；placeholder 以 known hash 或 ImageRecord 判斷；加入至少一個正向 publish fixture。

### BUG2-17：圖片選擇、發布狀態與缺圖診斷仍不一致

性質：CARD-03 基本功能已做，但跨 Blueprint／publish lifecycle 未閉合。

證據鏈：

- build 選圖只讀 Blueprint roster 第一名，忽略明示 `primary_character_id`（`packages/domain/src/build.ts:116-129`）。
- `character_id` 上傳欄位是任意文字，runtime 不驗證 roster；找不到 primary-bound image 時無條件使用最後一張，拼字錯誤的綁定仍可能成為卡面。
- image blob 遺失時靜默 fallback placeholder（`build.ts:130-135`），沒有 CARD_IMAGE_MISSING warning；這與 CARD-03 設計中保守 warning 的決策不符。
- 新增／移除圖片只改 `state.images`，不把 `published` 改回 `ready`，也沒有 operation/audit（`packages/runtime/src/index.ts:2414-2482`）。
- Dashboard 用只接受 string 的 `firstString` 讀 numeric width／height，因此列表顯示 `?×?`（`packages/server/src/dashboard.ts:503-510`、`:1412`）。

結果：多人卡可使用非 primary 角色圖片；圖片改完仍顯示 published；缺 blob 也會輸出佔位圖而沒有提示。

建議：使用 Required Manifest 的 primary，驗證 character_id；缺 blob 產生 build warning；圖片變更標記輸出 stale/ready 並追加 audit；Dashboard 正確顯示 numeric dimensions。

## 六、P2：邊界、安全與長期資料品質

### BUG2-18：不裁切可繞過 2048 上限，裁切解壓也缺輸出上限

性質：CARD-03 邊界缺口。

- 2048×2048 限制只存在 `cropPngCover`（`packages/adapters-png/src/index.ts:235-244`）。Dashboard 選「不裁切」時，`setProjectImage` 只讀 IHDR，任何更大 dimensions 都可入庫。
- crop 對 IDAT 使用無 max-output 的 `inflateSync`，解壓後才比對最小預期長度（`:252-256`）；壓縮炸彈可先消耗大量記憶體。
- PNG filter switch 的 default 同時承擔合法 filter 0 與非法 5～255，因此非法 filter 不會被拒絕（`:258-293`）。

建議：尺寸上限放在所有圖片入口；inflate 設 expected/max output；filter 只接受 0～4；將格式錯誤轉成 recoverable 4xx。

### BUG2-19：後續相同事實的佐證來源會被丟棄

性質：BUG-21 修復未完整。

- refresh 只會合併同一批次中的 duplicate；若 fact key 已存在於 current facts，直接 continue（`packages/domain/src/knowledge.ts:362-379`）。
- applyCuration 對既有 key 同樣直接跳過（`:416-443`）。

結果：第二個官方來源出現相同事實時，不會增加 source_ids／evidence_refs，也不會產生新 candidate revision；事實仍只有第一來源的 provenance，使用者看不到 corroboration。

建議：將「內容 identity」與「evidence revision」分離；新證據應合併並增加 fact revision，必要時觸發 successor Review Run，而不是靜默丟棄。

### BUG2-20：SourceService 會把暫時 CAS conflict 記成永久 failed

性質：BUG-35 實作與修復設計不一致。

- `SourceService.execute` 逐 candidate 做 read/acquire/commit，而不是修復設計所述的單一 semantic transaction（`packages/domain/src/index.ts:291-394`）。
- catch 捕捉所有錯誤；若目前 candidate 仍是 approved，就把非 `SOURCE_FETCH_BLOCKED` 的錯誤標成 failed（`:395-423`）。`REVISION_CONFLICT` 也會走這條路。

結果：來源下載本身成功，但剛好有另一個不相關 commit 使 revision 改變時，candidate 會被永久標成 failed，而不是重試 CAS。

建議： acquisition failure 與 repository conflict 分類；REVISION_CONFLICT 不改 candidate domain status，只重試整個 current-state judgment。

### BUG2-21：YAML 與 CCv3 import 仍會遺失常見內容

性質：BUG-26 修復只覆蓋簡化格式；目前匯入不是自用主路徑，因此列 P2。

- custom YAML parser 先以 `#.*$` 移除註解，不理解 quoted `#`；沒有 block scalar `|`／`>`；list-of-map 的續行縮排判定也要求錯誤層級（`packages/domain/src/import.ts:76-157`）。常見角色 YAML 的多行 description 與 worldbook entries 會失敗或錯位。
- CCv3 的 personality、scenario、system_prompt、mes_example 通常位於 `data`；`toCharacterProposal` 只有 description 會 fallback 到 data，其餘只讀 top level（`:160-188`）。
- first_mes、alternate greetings、group-only greetings 與 character_book 沒有轉成正式 greeting/world artifacts，只被保留在 character extension 的 raw import_source。

結果：PNG／JSON card 雖顯示 imported，正式 Character artifact 可能只有 description summary，後續 Creator context 看不到大部分原卡內容。

建議：使用成熟 YAML parser；先正規化 V2／V3 envelope，再建立 Character、Greetings、World、Plugin import plan，preview 應列出每個欄位的 target 或 preserved-only 狀態。

### BUG2-22：Artifact key 正規化仍可碰撞，World identity 依第一條 entry

性質：BUG-34 修復未完全。

- template id schema 允許 `.`, `_`, `-`（`packages/core/src/templates.ts:15-20`）。
- key normalizer 會把所有非字母數字序列統一為 `-`（`packages/domain/src/authoring.ts:79-81`）；`alice.a`、`alice_a`、`alice-a` 因而共用 key。
- world artifact name/key 使用 `entries[0].id`（`authoring.ts:111-132`）；只是調整 entry 順序或更換第一條，就可能被當成另一個 current world artifact，兩份都進 compiler。

結果：不同合法角色 id 會互相覆蓋 latest projection；同一份 world 內容重排可殘留重複世界書條目。

建議：key 使用可逆 escape 或 hash(identity tuple)；World／Relationships 應有獨立穩定 document id，不由顯示名稱、team code 或第一條 entry 推導。

### BUG2-23：server auth 與 error boundary 沒有完全落實

性質：BUG-32 修復未閉合；預設 localhost 風險較低。

- 修復設計要求 non-localhost host 必須有 auth token；`startWorkspaceServer` 現行程式沒有此 guard（`packages/server/src/index.ts:797-815`）。呼叫者可用 `0.0.0.0` 無認證公開所有讀寫端點。
- 開啟 auth 時 middleware 連 `GET /` 一起要求 Authorization header（`:389-400`），但普通瀏覽器導覽與 Dashboard fetch 沒有 token 注入機制，受保護 Dashboard 實際不可用。
- HTTP 只把少數 error prefix 視為 recoverable 400；BUILD_、SOURCE_、CARD_IMAGE_、QUALITY_、CONVERSION_、IMPORT_ 等正常輸入錯誤會成為 500（`:782-790`）。
- MCP catch 將所有 runtime error 回成 `-32603` internal error，無法區分 recoverable input。

建議：啟動時強制 external-host auth；Dashboard 使用安全 session/cookie 或明確 token bootstrap；error response 依 `CoreError.recoverable` 與類型分類，不依不完整 prefix regex。

## 七、第二輪使用者體驗改良

以下使用 `UX2-xx`，表示在 UX-01～12 名義完成後，從實際旅程發現的下一輪缺口。

### UX2-01：加入真正的「未選專案」首頁與「建立新專案」按鈕

目前 server startup 會立刻 `ensureRuntime()`；若 `project-001` 已存在，manager 自動建立下一個空 placeholder。每次只開 server 都可能多一個隱藏 `project-00N` 資料夾。Dashboard 只有 project selector，沒有明確 New Project action。

建議：初始狀態不建立資料夾；首頁顯示「新專案／開啟既有專案／舊卡審核」三個主要入口，只有使用者確認新專案時才配置 directory。

### UX2-02：既有專案流程先選目標，再開始訪談

continue、補世界、擴充角色目前先做完整訪談，最後才切 project，導致 false completion。UX 上應在第一步顯示可搜尋的 project list、目標 revision 與將修改的範圍；確認目標後才問該流程特有問題。

### UX2-03：Precheck 顯示「目前待確認的一項」，歷史矩陣只供瀏覽

逐項 precheck 的 domain 流程已經存在。介面不應讓每個歷史 row 都有相同「標記確認」按鈕；應突出唯一 active check，顯示原依據、影響、目前候選值、確認／補充輸入，完成後才移入歷史矩陣。

### UX2-04：Build preview 改成實際 Package Plan

目前 build readiness：

- primary 取 roster 第一名，不是明示 primary；
- modes 代表 Blueprint 意圖，不代表完整可用模式；
- entries 掃描所有 artifact revisions，數量與 token estimate 可重複；
- greeting_entries 算 greeting artifact 數，不是 greeting 數；
- `png_expected` 在 world-only 卡會是 false，但 compiler 仍輸出 PNG。

建議預覽直接顯示本次 exact plan：卡名、primary、選定 mode、核心欄位留白、first greeting、alternate/group greeting 數、世界書名稱、每個 entry 名稱／來源 revision、圖片、plugin、JSON/PNG 輸出路徑與阻擋原因。使用者先確認 plan 再發布。

### UX2-05：Artifact 工作台應顯示 current revision、內容與 diff，不是平面 metadata

Dashboard snapshot 沒回 artifact content；畫面只顯示 metadata 與 Blueprint JSON。所有歷史 revision 混在同一列表，沒有 current badge、diff、重新生成、送審或開啟 materialized file。

建議：預設一個 key 一列 current artifact；展開才看 revision history。提供 raw/rendered view、previous diff、binding、fact refs、creator/reviewer、重新生成、送審與開啟檔案。

### UX2-06：Issue／Quality 操作需要合法性與理由表單

Issue snapshot 沒有 `overridable`、override baseline 或 policy snapshot；UI 無法知道 Ignore／Override 是否可用，也沒有 severity/reason 輸入。Quality panel可選 level，但沒有真正的 per-code override editor。

建議：只有合法 action 可點；resolve／ignore／override 皆顯示原因欄與效果預覽，override 顯示 current effective → target severity，並在發布預覽中即時重算。

### UX2-07：來源與事實面板改成可完成工作的審查板

目前面板只能看 counts、狀態與第一段 quote，沒有 approve/reject candidate、開啟 source、查看 chunk locator、建立 Review Run、逐 fact 裁決、補證據或 Director conflict resolution。

建議依 Source → Chunk → Fact occurrence → Reviewer decisions 顯示完整 trace；每個 action 使用正式 typed endpoint，並標示哪些 facts 已被哪些角色／世界 artifact 引用。

### UX2-08：Operation 管理只顯示當前可執行 action

terminal operation 不應有 Retry／Cancel；needs_input 應顯示問題與回答入口；running 顯示 lease owner、剩餘時間與 progress items；failed 顯示 error class 與「安全重試／需人工重送」區分。歷史列表需狀態 filter，且所有 destructive action 要二次確認。

### UX2-09：圖片流程使用 roster dropdown、primary badge 與 crop preview

目前 character id 是自由文字，容易拼錯；選擇比例後沒有真正 crop preview；圖片變更後也沒有「需重新打包」提示。

建議用 Blueprint roster dropdown、標示 primary／project cover、先在瀏覽器預覽裁切框與輸出尺寸，顯示來源／授權缺失警告，並在發布後變更時顯示 stale export banner。

### UX2-10：Repair 與 Tavern 結果要能作為證據

Repair 應列 exact source/target、原因、可回復性與 plan hash；Tavern verifier 應列每項 PASS／WARN／FAIL、檢查的 blob hash、JSON/PNG path、CCv3 schema 結果、worldbook/greeting/plugin/image 摘要，而不是自然語言混合列表。

### UX2-11：錯誤訊息由 server 回傳結構化 next action

Dashboard 現在用少量前端 hardcoded code→hint 對照；未列 code 只有原始訊息。建議 error contract 統一 `{code, category, recoverable, message_zh, impact, next_actions, field_errors}`，HTTP、MCP、Dashboard 共用，避免各入口自行猜。

### UX2-12：更新 README 與移除畫面中的矛盾「後續提供」

- `README.md:192-195` 仍說 Publish readiness、operation cancel/retry 與 Tavern verifier 尚未提供。
- Dashboard `packages/server/src/dashboard.ts:459-467` 也把同一批已顯示面板列為「後續提供」。
- README endpoint 清單沒有補上大部分 Dashboard、quality、image、repair 與 compatibility endpoints。

這會讓使用者無法判斷哪些能力是真的、哪些只是 UI placeholder。文件與 UI 應由同一 capability list 生成或至少在每次功能 commit 同步更新。

## 八、為什麼現有測試沒有攔到

本次沒有執行測試；以下是從測試程式碼本身確認的 coverage blind spots：

1. `packages/domain/test/build-import.test.ts:94-102` 在 publish 後立刻直接讀 exports；沒有再呼叫 repository.read／reopen，因此未觸發 BUG2-01。
2. Dashboard tests 主要檢查 HTML 字串、endpoint 存在與 no-innerHTML（`packages/server/test/dashboard.test.ts:46-132`），沒有在 DOM 中建立多列並實際點擊，無法發現 `var` closure。
3. precheck endpoint test 只確認 array 存在，沒有驗證 `checks` view model 能被 renderer 消費。
4. project-manager tests 只驗 continue／existing-world 最後切到正確 project id（`packages/runtime/test/project-manager.test.ts:111-197`），沒有驗證目標專案 revision、Blueprint 或 artifacts 是否改變。
5. worker tests直接驗 `renewOperationLease` API 可呼叫，但沒有驗 worker 在長任務中定期呼叫它。
6. 沒有 `FileAttachmentStore + relocate + restart` 案例。
7. 沒有 Tavern verifier 的正向完整 publish fixture；目前 server test 只驗尚未 publish 時 `available === false`。
8. workflow gate 的 out-of-scope 測試使用 current binding 的 Palette artifact，沒有再檢查 compiler 是否同樣排除 disabled world／plugin／roster 外 module，也沒有 stale out-of-scope binding 案例。
9. Required Manifest 沒有「同 key 兩個等分 Character revision」與「最新版 greeting 不再覆蓋 primary」案例。

第二輪修復時，測試重點不應只是再增加 method-level assertions，而是固定跨層不變量：

> 使用者在 preview 看到的 exact plan = gate 審查的集合 = compiler 讀取的集合 = publish trace 保存的集合 = reopen 後仍存在的輸出。

## 九、建議修復順序

### 第一批：恢復輸出與發布正確性

1. BUG2-01：PNG keep/materialize from blob。
2. BUG2-02、03：current projection + 單一 Build/Publish Plan。
3. BUG2-04、05：mode 先選、再生成 exact manifest/gate。
4. BUG2-06：authoring readiness 改讀同一 plan/manifest。
5. BUG2-17：primary image、missing warning、published stale lifecycle。

這一批完成前，不建議以「publish 成功」代表輸出內容已全部被正確審查。

### 第二批：關閉 operation 與既有專案工作流

1. BUG2-07、08：session actor／execution agent／recovery identity 完整分層。
2. BUG2-09、10：typed command round-trip、heartbeat、token-guarded commit、idempotency。
3. BUG2-11、12：在目標專案執行 continue/world/expansion，修正 rename 後 attachment path。
4. BUG2-20：來源 CAS conflict 不污染 candidate status。

### 第三批：讓 Dashboard 結果可相信

1. BUG2-13：先停止錯誤目標與 terminal status mutation。
2. BUG2-14：precheck view model／active check。
3. BUG2-15、16：repair plan 與 Tavern verifier 正確性。
4. UX2-04～11：以 exact plan 與 structured actions 取代展示型面板。

### 第四批：邊界與低優先相容性

- BUG2-18、19、21、22、23。
- 之後再做原本延後的程式碼精簡化／重構；目前先重構可能把尚未統一的不同行為封裝得更深。

## 十、最終判定

### 1. 第一次 audit 的修復是否全部可靠完成？

否。多數缺口已有實作，但 Required Manifest、operation protocol、project-manager flow 與 Dashboard 的跨層合約仍有未閉合或修復間回歸。不能只依 commit 名稱把 BUG-01～35 判定為關閉。

### 2. 現在能否開始自用測試？

可以，但要維持人工監督，且應先避免把 exports PNG、Dashboard repair／operation action、自然語言 review 與 crash recovery 當作可靠功能。最少先修 BUG2-01～04，再擴大打包與發布測試。

### 3. UX-01～12 是否已完整？

面板與 endpoint 大多已出現，但數個仍是展示型或資料合約錯接；operation／issue／image action 還會操作錯誤目標。因此比較準確的說法是「Dashboard 功能框架完成，互動可靠性與工作閉環未完成」。

### 4. 程式碼優化是否應現在做？

不建議。使用者原先把程式碼精簡化排到最後是合理的。先讓同一份 Publish Plan、同一個 execution identity 與同一套 operation protocol成為真實單一來源，再做去重與重構，效益會更高且風險更低。

整體而言，V3 現在的主要風險已不是「沒有功能」，而是「同一功能在 manifest、gate、compiler、recovery 與 Dashboard 各自有一份相近但不同的真相」。第二輪最重要的工作，是先把這些真相合併成可驗證的單一路徑。
