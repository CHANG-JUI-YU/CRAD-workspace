# ST Workspace V3 — 第九次靜態稽核報告

日期：2026-08-16
範圍：`C:\AI\projects\ST-workspace-v3`（唯讀檢查，未更動任何檔案、未執行測試）
基準：git HEAD `f369a66 fix(ci): establish enforceable coverage baseline`
方法：全專案靜態閱讀，重點覆蓋 `packages/server/src/dashboard-*.ts`（伺服器端組裝之 Dashboard 前端）、`routes.ts`、`index.ts`、`mcp-tools.ts`、`http-utils.ts`、`errors.ts`、`runtime-revision.ts`、`tools/*`、`ST-Workspace-Dashboard.cmd`、`opencode.jsonc`、`package.json`、`README.md`。所有發現均經交叉驗證（grep／實際閱讀）後列入。

分級定義：
- **P0**：阻斷核心工作流，或無法通過任何路徑繞過的錯誤。
- **P1**：常見工作流會踩到的錯誤、安全面、或明顯的狀態不一致。
- **P2**：邊緣案例、穩健性、觀感與一致性問題。

---

## 摘要

本次稽核共發現 **23 個 BUG 項目**、**15 個 Dashboard UI/UX 項目**、**13 個整體使用者體驗項目**。最嚴重的一組問題集中在：

1. **Dashboard 區段導覽完全失效**：`updateSectionNav()` 從未被呼叫（`#section-nav` 永遠空白），而較晚宣告的 nav 版 `switchPanel` 遮蔽了 publish 版，導致任何「前往面板」跳轉會把使用者鎖死在單一區段，只能靠「重新整理」逃脫（BUG9-01）。
2. **啟動器健康檢查把逾時誤判為「port 被占用」**：冷啟動回應超過 1.5 秒時，launcher 會關閉自己剛啟動的 server 並回報 `DASHBOARD_PORT_IN_USE`（BUG9-02）。
3. **無認證的遠端 DoS**：HTTP handler 的 catch 區塊重複解析壞掉的 `request.url`，產生 unhandledRejection，Node 15+ 預設會終止整個 process（BUG9-07）。
4. **最近回應/診斷區被短句通知永久覆寫**：錯誤的詳細內容（錯誤碼、影響、下一步）寫入後立刻被 `setNotice` 蓋掉，使用者看不到任何有意義的診斷（BUG9-03）。
5. **發布 CTA 狀態機脆弱**：busy 競態與一般錯誤路徑都可能讓主 CTA 永久卡在「發布中…」且停用（BUG9-10、BUG9-11）。

---

# 一、BUG（BUG9-XX）

## P0 — 阻斷核心工作流

### BUG9-01 區段導覽完全失效；「前往面板」跳轉會把使用者鎖死在單一區段
- 檔案：`packages/server/src/dashboard-nav.ts:83`、`dashboard-nav.ts:104-111`、`dashboard-markup.ts:27`、`dashboard-panels-publish.ts:315`
- 描述：`updateSectionNav()` 全專案僅有定義、零呼叫點（grep 確認），因此 `#section-nav` 永遠空白、六個區段導覽按鈕不存在。同時 `switchPanel` 有兩份宣告：panels-publish.ts:315 版只做 scrollIntoView；nav 版（組裝順序較晚，見 dashboard.ts:34/40，後宣告者勝出）會再呼叫 `syncSectionForPanel` → `switchSection` → `applySectionVisibility`，把目標區段以外的所有 `section.panel` 設 `hidden`。診斷「前往」按鈕（panels-publish.ts:502、799）與 Coverage cell 動作（panels-coverage.ts:825、842、846、858、1189、1446）都會觸發此遮蔽。由於導覽按鈕不存在、`pushHistory:false` 且 popstate 只在 hash 有 `#section:` 時才作用，使用者會被困在單一區段，目前唯一出路是 header 的「重新整理」（renderSession 會把所有 panel 重設為可見，panels-core.ts:245-259）。
- 修正方向：在初始載入時呼叫 `updateSectionNav()`；刪除/合併重複的 `switchPanel`（僅保留捲動行為）；讓 `switchSection` 的 section 過濾與 `renderSession` 的 hidden 邏輯互相協調（目前每次 refresh 都會推翻區段過濾）。

### BUG9-02 啟動器健康檢查把 1.5 秒逾時誤判為「port 被占用」，可能自我毀滅
- 檔案：`packages/server/src/dashboard-launcher.ts:50-93`（觸發於 `:229-231`、`:177-182`）
- 描述：`probeDashboardService` 用 AbortController 設 1.5 秒 timeout；fetch abort 時丟出的 `AbortError`（DOMException）`code` 是數字 20 而非字串，`errorCode()`（:50-58）只認字串型 `code`，因此一律落入 catch 的 `{ status: "occupied" }`。後果有二：(1) 啟動後健康檢查迴圈（:218-234）若自啟動的 server 首回應超過 1.5 秒（冷機、防毒掃描、慢磁碟），launcher 會**關閉自己剛建立的 server**（:230）並拋 `DASHBOARD_PORT_IN_USE`，啟動失敗且訊息完全誤導；(2) 初始 probe（:170-182）把回應較慢的既有健康 Dashboard 當成「不相容服務占用 port」。
- 修正方向：`errorCode()` 同時檢查 `name === "AbortError"`；probe 結果新增 `timeout`/`error` 狀態；健康迴圈對 timeout 重試，只有真正收到 HTTP 回應或 EADDRINUSE 才判定 occupied。

### BUG9-03 「最近回應/診斷」的詳細內容被 setNotice 立即覆寫，錯誤說明永遠看不到
- 檔案：`packages/server/src/dashboard-panels-core.ts:801-814`；呼叫端 `dashboard-api.ts:161-167`（refresh）、`183-188`（runTask）、`dashboard-listeners.ts:305`（檢視草稿 → panels-core.ts:547-563）
- 描述：`renderLatest`/`renderLatestError` 與 `setNotice` 寫入同一個元素 `#latest-summary`。runTask 成功時詳細摘要先被寫入、再被 `setNotice("success", label + "完成。")` 整段覆寫；失敗路徑更糟：`renderLatestError` 寫入的結構化錯誤內容（錯誤碼、影響、下一步、recovery cards）立刻被 `setNotice("error", label + "失敗；請查看最近回應/診斷區。")` 蓋掉——而提示叫使用者去看的區塊，內容正是這句被覆寫後的短句。markup 設計文案「人類可讀摘要會保留在這裡」與實際行為直接矛盾。檢視草稿按鈕也有同樣問題：草稿清單寫入後馬上被 notice 覆寫，按鈕形同無效。
- 修正方向：setNotice 使用獨立元素，或改為 append 而不 replace；錯誤資訊保留完整錯誤碼與下一步提示。

## P1 — 常見工作流或安全問題

### BUG9-04 setBusy(false) 強制啟用所有控制項，破壞應保持 disabled 的狀態
- 檔案：`packages/server/src/dashboard-panels-core.ts:816-824`；`updateControls`（:831-841）只恢復少數
- 描述：busy 結束時對全域 `button, select, textarea` 一律設 `disabled = false`，包括本應保持停用的元素：coverage 的「全量缺口研究」按鈕（coverage.ts:1067）、`enabled=false` 的 cell 動作（coverage.ts:815-820）、尚未預覽時的 amend-confirm（core.ts:453、463、510）、被 superseded 的修訂按鈕（core.ts:429）、無問題時的訪談選項（core.ts:838-840）。任何一次 refresh/runTask 循環後，使用者就能點擊本不該可用的操作。
- 修正方向：停用前記錄原本的 disabled 狀態（例如 `data-busy-disabled` 標記），恢復時只重新啟用被 busy 停用的元素；或把 busy 限制在特定表單區塊。

### BUG9-05 就緒檢查的阻擋判定與診斷渲染結構不一致
- 檔案：`packages/server/src/dashboard-listeners.ts:81-82` vs `dashboard-panels-publish.ts:458-673`
- 描述：`hasBlocking` 只認 `structured.rows` 中的 `severity === "error"`；`renderPublishDiagnostics` 卻支援 `structured.groups`（每組 `highest_severity`）與 `structured.summary.error_count` 三種形狀。伺服器回傳 groups 形狀時，畫面顯示「有 N 條阻擋診斷」，stepper 卻標 pass、primary CTA 變成「凍結輸入並準備發布確認」，使用者會一路走到確認發布才被伺服器拒絕。另漏掉 `critical` 嚴重度。
- 修正方向：抽共用函式（同時認得 rows/groups/summary.error_count），讓 triggerCheckReadiness 與 renderPublishDiagnostics 使用同一來源。

### BUG9-06 切換專案後大量跨專案資料殘留（品質/預檢/圖像/發布狀態全部過期）
- 檔案：`packages/server/src/dashboard-api.ts:199-201`（refreshAfterAction 只載入 projects/status/interview/workflow）；`dashboard-actions.ts:31-35`
- 描述：切換專案後不重新載入 loadAgents、loadDashboardData（品質設定、預檢矩陣、角色圖像）、也不重置 publish 狀態：`currentProvenanceConfirmation`、stepper、readiness-list、provenance-summary 仍顯示上一個專案的內容。使用者可能誤以為新專案已通過就緒檢查，或沿用舊專案的品質覆寫。
- 修正方向：selectProject 成功後改為完整 refresh()；或明確重置 publish 區（stepper 回 waiting、清空 readiness/provenance、`currentProvenanceConfirmation = null`）。

### BUG9-07 未認證遠端 DoS：catch 區塊重複解析壞掉的 request.url，產生 unhandledRejection
- 檔案：`packages/server/src/index.ts:42`、`69-71`
- 描述：request handler 是 async 函式，`createServer` 不 await 其 Promise。try 區塊 `new URL(request.url ?? "/", "http://localhost")` 對非法 request target（如 `GET //[ HTTP/1.1`）拋 TypeError 後進入 catch；catch 第 71 行又對同一個壞 URL 再解析一次、再次拋錯。例外發生在 catch 內無處可接 → unhandledRejection → Node 15+ 預設終止 process。且此路徑在 auth 檢查之前，即使有 authToken 也可被未認證者觸發。
- 修正方向：URL 只解析一次並容忍失敗；catch 內改用不拋錯的判斷（如 `request.url?.startsWith("/mcp")`）；handler 的 Promise 掛 `.catch()` 兜底。

### BUG9-08 空字串 authToken 造成靜默認證繞過；非固定時間比較
- 檔案：`packages/server/src/index.ts:43-46`
- 描述：認證啟用條件是 `authToken !== undefined`。若環境誤設 `ST_WORKSPACE_TOKEN=""`，比對變成 `"Bearer "`（攻擊者送 `Authorization: Bearer ` 即可通過）或 `?token=`，完全繞過且啟動時無警告。token 用 `===` 逐字元比較，非 timing-safe。
- 修正方向：啟動時驗證 token 非空（空值視同未設定或拒絕啟動）；改用 `crypto.timingSafeEqual`（先 hash 到等長）。

### BUG9-09 CSRF：多個無 body 的寫入端點可被任意網頁觸發；無 Origin 校驗
- 檔案：`packages/server/src/index.ts:40-77`（無 Origin/Host 校驗、無 CORS 限制）；`routes.ts:284`（project/new）、`routes.ts:418`（fact/review/run）、`routes.ts:592`（repair/run，空 body 被 http-utils.ts:59 當 `{}`）
- 描述：預設部署是 127.0.0.1 且無 token（index.ts:85 只在非本機 host 強制）。這三個端點不需 JSON body，瀏覽器 simple request 規則下可被任何網頁的 form/fetch 直接送出（無 preflight 阻擋）；DNS rebinding 可繞過「本機才有權限」假設。全是寫入操作（新建專案、啟動審查、執行修復）。
- 修正方向：變更類方法校驗 Origin 與 Host 一致或白名單；要求變更端點必須 JSON content-type（觸發 preflight）；或預設要求 authToken。

### BUG9-10 state.busy 競態：確認發布動作被 runTask 靜默丟棄，UI 永久鎖死
- 檔案：`packages/server/src/dashboard-listeners.ts:105-131`；`dashboard-api.ts:172-173`
- 描述：`triggerConfirmPublish` 先同步設 `confirmation.in_flight = true`、停用按鈕、primaryCta 顯示「發布中…」，才呼叫 `runTask`。`runTask` 開頭 `if (state.busy) return undefined;` 靜默返回，不執行 task 也不進入 finally。任何其他 task 在執行時（載入 Artifact、套用品質設定），發布確認就被丟棄且 in_flight 永遠 true、按鈕永久停用。
- 修正方向：runTask 在 busy 時回傳明確的 rejected promise/false，呼叫端據此復原 UI；或在設定 in_flight 前先檢查 state.busy。

### BUG9-11 發布失敗後主 CTA 永久停用
- 檔案：`packages/server/src/dashboard-listeners.ts:127-131、187-198`；`dashboard-panels-publish.ts:140-161`
- 描述：發布失敗落入「一般錯誤」分支時只更新 `provenance-confirm-message`，不呼叫 `updatePublishStepper`；finally 只恢復隱藏的 `confirm-publish` 按鈕。可見的主 CTA 永久卡在 `disabled + 「發布中...」`，且訊息提示「可再次點擊重試」，與實際狀態矛盾，直到重新整理才能恢復。
- 修正方向：一般錯誤分支也呼叫 `updatePublishStepper("provenance_reviewed", "blocked")`；把 CTA 的 disabled/文字恢復邏輯統一收斂進 updatePublishStepper。

### BUG9-12 renderProvenanceComposition 對缺失欄位直接 .slice，legacy 資料使發布準備流程崩潰
- 檔案：`packages/server/src/dashboard-panels-publish.ts:858`、`1084`
- 描述：`fingerprint.slice(0, 16)`、`composition.build_snapshot_hash.slice(0, 16)` 在欄位缺失時拋 TypeError（`firstString` 在缺失時回傳 undefined；同函式 1048 行已證明該欄位可能不存在）。任一欄位缺失使整個 render 崩潰，使用者只看到 runTask 泛用錯誤，無法進入發布確認。
- 修正方向：先做 `typeof === "string"` 檢查與 fallback（如「legacy（無）」）。

### BUG9-13 修復流程 plan_hash 可為 undefined：送出缺參數請求或渲染崩潰
- 檔案：`packages/server/src/dashboard-panels-media.ts:357-358`（`undefined !== ""` 成立，`repairPlanHash` 被設成 undefined）、`390`（`firstString(report, ["plan_hash"]).slice(0, 12)` 拋錯）、`363`（同型態）
- 描述：inspection 缺 plan_hash 時 repairPlanHash 變成 undefined，之後 `runRepair`（listeners.ts:22-28）送出 `{ plan_hash: undefined }`，JSON.stringify 直接丟掉該鍵，伺服器收不到必要參數；renderRepairReport 對缺欄位 .slice 直接崩潰。`repair-run` 按鈕在未執行「檢查殘留」前即可點擊（repairPlanHash 初始 ""）。
- 修正方向：`typeof planHash === "string" && planHash !== ""`；`.slice` 前 fallback 空字串；無 plan hash 時停用 repair-run 按鈕。

### BUG9-14 外部連結 href 未做 scheme 白名單，存在點擊型 XSS 面
- 檔案：`packages/server/src/dashboard-panels-review.ts:220、370、419`
- 描述：`link.href = source.url`／`candidate.url` 直接把伺服器資料當 href。來源候選 URL 可能來自外部搜尋結果（攻擊者可控制內容）；若為 `javascript:` 開頭，點擊「開啟外部來源」即在 Dashboard 頁面上下文中執行任意 JS（Dashboard 持有 auth token，可呼叫所有 workspace API）。已驗證全 dashboard 無 innerHTML（此為正向發現），但 href 直接賦值是唯一實質 XSS 通道。
- 修正方向：統一 URL sanitize（只允許 http/https，其餘顯示純文字）；補 `rel="noopener noreferrer"`。

### BUG9-15 disabled 按鈕的「跳轉到前置面板」分支是死碼
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:815-828`
- 描述：`actionOpt.enabled` 為 false 時設 `button.disabled = true`，但原生 disabled button 不派發 click 事件，822-828 行的 `switchPanel(actionOpt.prerequisite.target_panel)` 永遠無法執行。設計意圖（點擊灰階動作跳轉到前置需求所在面板）完全失效，使用者只有 tooltip。
- 修正方向：改用 `aria-disabled` + click 內自行攔截，或包一層可點擊容器處理導覽。

## P2 — 邊緣案例與穩健性

### BUG9-16 多處伺服器資料缺欄時 .slice 拋 TypeError，整塊面板渲染中斷
- 檔案：`dashboard-panels-coverage.ts:901`（assessment_revision）、`1024、1039`（matrix.assessment.revision）、`1048`（matrix.requirement_set.revision）、`1483`（batch 兩個 revision，完全無防護）、`187、918、932、964`（t.id/task.id/ht.assessment_revision/sl.current_attempt.attempt_id）；`dashboard-panels-media.ts:390`；`dashboard-panels-publish.ts:858、1084`
- 描述：任一欄位 undefined 即 TypeError。1483 行在 renderResearchMonitor 批次迴圈內，崩潰使研究監控區整個消失；932/964 行缺一筆資料即中斷整張 cell。
- 修正方向：統一 `safeSlice(value, n)` 回傳 `(value || "").slice(0, n)`，並以「資料不完整」降級顯示。

### BUG9-17 payload.monitor 未防護 null，優雅空狀態被原始錯誤取代
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:1522`
- 描述：`renderCoverageCenter` 明確處理 `payload === null`（1017-1020），但下一行 `renderResearchMonitor(payload.monitor)` 在 payload 為 null 時直接 TypeError，「尚未取得覆蓋矩陣資料」的友善提示被錯誤訊息覆蓋。
- 修正方向：`if (payload && payload.monitor !== undefined) renderResearchMonitor(payload.monitor);`

### BUG9-18 collectionMoreButton 每次 render 重複 addEventListener
- 檔案：`packages/server/src/dashboard-panels-collections.ts:76`
- 描述：每次「載入更多」後 render 又對同一個 button 新增監聽器，監聽器線性累積；點第 N 次同時發出 N 個 fetch（generation guard 只防舊回應覆寫、不防重複請求），亦是記憶體洩漏。
- 修正方向：`button.onclick = ...` 直接指派覆寫，或重建 button 節點。

### BUG9-19 背景輪詢重繪 operation 列表，抹掉使用者正在輸入的回答
- 檔案：`packages/server/src/dashboard-panels-publish.ts:1725-1840`（renderOperationList 全量重建）；`dashboard-api.ts:219-236`（每 3 秒輪詢）
- 描述：有 operation 在 running/resolving/created 時每 3 秒重繪整個列表，needs_input 的文字輸入框被重建。使用者打字中每 3 秒輸入就被清空，無法完成輸入。
- 修正方向：重繪前保存輸入框 value 並復原；或只更新變動的列。

### BUG9-20 草稿儲存：sessionStorage 存取未保護、迭代中刪除跳格、expires_at NaN 永不過期
- 檔案：`packages/server/src/dashboard-draft-store.ts:118-119、130-141、69`
- 描述：(1) `clearProjectDrafts`/`scanDrafts` 直接存取 `window.sessionStorage.length/.key(index)`，儲存被停用（隱私模式、storage partitioning）時拋 SecurityError 未捕獲；(2) scanDrafts 在 for 迴圈內 `removeRaw` 後 key 索引左移、`index++` 跳過下一個草稿（「草稿消失」）；(3) `Date.parse(entry.expires_at) <= Date.now()` 對無法解析的字串回傳 NaN，`NaN <= now` 為 false，損毀 entry 永不過期。另 `loadDraft` 專案不符分支（:105-106）不清理殘留 key；saveDraft 先 trim 造成多行內容尾端空白遺失（:76-77）。
- 修正方向：抽出 `listSessionKeys()` 安全函式；先收集 keys 再刪除；`Number.isFinite(exp)` 驗證。

### BUG9-21 裁切預覽非同步競態與 blob URL 洩漏
- 檔案：`packages/server/src/dashboard-panels-media.ts:52-116`
- 描述：快速連續選檔時前一張 Image 的 onload 可能晚於後一張觸發，把預覽覆寫成舊圖（無 generation token）；`image.onerror` 分支不 revoke URL；元件在載入完成前被重繪時 blob URL 洩漏。
- 修正方向：加入 token 防護；onerror 也 revoke；統一 finally 釋放。

### BUG9-22 CSS selector 字串插值注入風險（querySelector 拋 SyntaxError）
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:849`（`'[data-task-id="' + targetTaskId + '"]'`）；同型態 `dashboard-panels-publish.ts:274`
- 描述：伺服器資料直接插進 selector，id 含 `"` 或 `\` 時拋 SyntaxError；coverageCellId（coverage.ts:869）只清洗 requirement_id 的「.」、character_id 完全未清洗，SillyTavern 角色 id 常含空格與特殊字元，診斷導航靜默失敗。另「a.b」與「a-b」產生相同 DOM id 碰撞。
- 修正方向：`CSS.escape()` 或遍歷 `[data-task-id]` 以 getAttribute 比對；統一編碼函式。

### BUG9-23 附件 reupload base64 驗證寬鬆、可上傳空附件；btoa 大檔凍結頁面
- 檔案：`packages/server/src/routes.ts:563-572`（伺服器端，`Buffer.from(rawBase64, "base64")` 寬容解碼、`content`/`content_base64` 皆 optional 無二選一約束）；前端 `dashboard-panels-publish.ts:1688-1700`（`String.fromCharCode` 逐字元組 binary string，O(n²) 凍結主執行緒、無大小/數量上限）；`dashboard-panels-coverage.ts:356-375、539-558`（同型態）
- 描述：可上傳零位元組附件；數 MB 附件會凍結主執行緒數秒至數十秒；「重新上傳附件」連點可疊出多個 overlay。
- 修正方向：用 domain 既有 base64 正則驗證並要求非空；前端改用 `FileReader.readAsDataURL`、設大小上限、開啟前檢查 overlay 是否已存在。

---

# 二、Dashboard UI/UX 優化（UX9-XX）

### UX9-01 主導覽列在 12 欄 grid 中只佔 1 欄寬，sticky 完全失效
- 檔案：`packages/server/src/dashboard-markup.ts:27`；`dashboard-css.ts:54-60、222-233`
- 描述：`<nav id="section-nav">` 是 `.dashboard-grid`（repeat(12, 1fr)）的直接子元素，但 `.section-nav` 沒有 `grid-column`（只有 `.panel` span 6、`.panel-wide` 1/-1）。導覽列只佔 1/12 寬（約 90px），按鈕被擠成窄長垂直條；且 `position: sticky` 的 containing block 是該 grid area（僅一行高），吸附效果不成立。這是工作台的主要導覽機制（與 BUG9-01 的按鈕缺失互為表裡）。
- 修正方向：把 nav 移出 `.dashboard-grid`（獨立全寬容器）；為 panel 補 `scroll-margin-top`。

### UX9-02 大量 JS 注入的 class 在 CSS 中完全沒有樣式
- 檔案：`packages/server/src/dashboard-css.ts`（全檔缺失）；使用端 coverage.ts:868/879/982/1081、media.ts:136/150/162/182/187/327/330/370/398、publish.ts:28/30/75/97/1742、review.ts:27/84/125、core.ts:427
- 描述：`.coverage-grid`、`.coverage-cell`、`.coverage-cell-title`、`.coverage-actions`、`.fact-row`、`.image-thumb`、`.row-warn`、`.tavern-check`、`.badge`/`.badge-pass/warn/fail/info`、`.precheck-active`、`.precheck-row`、`.precheck-history`、`.override-row`、`.issue-row`、`.readiness-hint`、`.operation-row`、`.amend-entry`、`.action-link`、`.task-context-desc` 等全部無 CSS 規則，以無邊框、無底色、無間距的純文字堆疊呈現。
- 修正方向：逐一補入 dashboard-css.ts（使用既有設計 token）；或建立「CSS 類別與面板 JS 對照」CI 檢查防再次脫節。

### UX9-03 `.image-thumb` 無樣式，大圖以原始尺寸撐爆版面
- 檔案：`packages/server/src/dashboard-panels-media.ts:159-162`；`dashboard-css.ts`（無此規則）
- 描述：角色圖縮圖以 intrinsic size 顯示，1024px 以上的圖會直接溢出 `.panel`（panel 只有 min-width: 0），窄視窗甚至撐爆頁面產生水平捲動。UX9-02 中最具破壞性的單點。
- 修正方向：至少 `.image-thumb { max-width: 100%; width: 96px; height: auto; border-radius: 0.35rem; border: 1px solid #cbd5e1; }`。

### UX9-04 單一 coverage cell 資訊過載
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:866-1011`
- 描述：每 cell 同時展示 badge、標題、meta、details、當前任務、歷史任務（可無限增長）、補件生命週期（含歷史嘗試清單）、最多 6 顆動作按鈕；整張矩陣可達數十 cell，掃描成本極高。
- 修正方向：歷史任務與生命週期歷史收進 `<details>` 折疊；「僅剩一筆」的常見資料省略冗餘行。

### UX9-05 研究監控區無分頁/折疊，DOM 節點可爆炸
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:1464-1516`
- 描述：所有批次 + 全部血統圖鏈結 + 全部任務一次性渲染。collections.ts 已有成熟 cursor 分頁機制，此處完全未用；任務量大的評估會造成數百上千 DOM 節點與卡頓。
- 修正方向：批次/任務清單採折疊或分頁；血統圖按需求分組折疊。

### UX9-06 深色模式完全沒有支援
- 檔案：`packages/server/src/dashboard-css.ts:3`（`color-scheme: light` 硬編碼）；coverage.ts:50-104、152-298、400-488、930（大量 `style.cssText` 硬編碼顏色）
- 描述：SillyTavern 生態使用者慣用深色主題，此工作台固定淺色且多個對話框用 inline cssText 寫死十六進位色（如 `#0066cc`），未來加 CSS 變數也覆寫不到。
- 修正方向：顏色 token 化為 CSS 自訂屬性，`@media (prefers-color-scheme: dark)` 覆寫；inline 樣式遷回 class。

### UX9-07 可及性不一致：部分對話框有完整 a11y，其餘完全沒有
- 檔案：`packages/server/src/dashboard-panels-coverage.ts:48-130、150-384、398-567`
- 描述：creative completion 與 task-context 對話框有 `role="dialog"`、`aria-modal`、Escape 關閉、焦點還原；research/recovery/supplement 三個對話框完全沒有（開啟後焦點仍在背景、無 Escape）。另多個 overlay 可同時疊加（z-index 9999），無互斥管理。
- 修正方向：抽共用 dialog helper（overlay 管理、focus trap、Escape、aria）統一所有對話框。

### UX9-08 文字輸入框與檔案輸入框完全沒有樣式
- 檔案：`packages/server/src/dashboard-css.ts:11、29-36`；`dashboard-markup.ts:243、400-401`；動態輸入框 review.ts:99、publish.ts:48/1793
- 描述：`input[type="text"]`、`input[type="file"]` 以 UA 預設樣式渲染，與相鄰 select/button 風格不一致，且無 `font: inherit`。
- 修正方向：把 input 加入與 select/textarea 相同的樣式規則。

### UX9-09 全域 `button { min-height: 2.5rem }` 破壞文字型按鈕
- 檔案：`packages/server/src/dashboard-css.ts:12`；受影響 843-852（`.task-link-btn`）、853-861（`.action-link-small`）、611-623（`.copy-chip`）、214-220（`.recovery-dismiss`）
- 描述：設計為文字連結/小晶片的按鈕被強制 40px 高，嵌入文字流時把行高撐爆、與相鄰文字垂直錯位。
- 修正方向：為這些 class 明確覆寫 `min-height: auto`，或 button 選擇器排除之。

### UX9-10 prefers-reduced-motion 對 JS 平滑捲動無效
- 檔案：`packages/server/src/dashboard-css.ts:963-970、350-355`；使用端 listeners.ts:43、coverage.ts:851、publish.ts:1826、workflow.ts:30
- 描述：CSS `scroll-behavior: auto !important` 無法覆寫 JS 的 `scrollIntoView({ behavior: "smooth" })`；四個呼叫點漏掉 `reducedMotion()` 判斷。且 css 350-355 把 scroll-behavior 設在捲動目標元素上（屬性放錯對象）。
- 修正方向：統一由 JS 端 reducedMotion() 控制；把 scroll-behavior 設在 `html`。

### UX9-11 Stepper 無語意標記；badge 直接顯示英文狀態字串
- 檔案：`packages/server/src/dashboard-markup.ts:177-183`；`dashboard-panels-publish.ts:129-133`
- 描述：`#publish-stepper` 以純 div 呈現進度狀態機，無 `role="list"/"listitem"`、無 `aria-current`；step-badge 直接顯示原始 status 字串（"current"、"waiting"），未在地化。
- 修正方向：加 role/aria-current；badge 用中文標籤對照表。

### UX9-12 對比度與焦點樣式不足
- 檔案：`packages/server/src/dashboard-css.ts:930-936`（`.history-tag` 白字 #fff 於 #9ca3af 底，對比約 2.5:1，WCAG AA 不及格）；全檔無 `:focus-visible` 樣式
- 描述：0.75rem 小字加低對比，可讀性差；`.task-link-btn`、`.action-link-small`、`.recovery-dismiss` 等無背景按鈕僅靠瀏覽器預設 outline。
- 修正方向：加深底色或改深字色；補全域 `:focus-visible` outline。

### UX9-13 `.form-actions` 內的 select 因 `width:100%` 強佔整列
- 檔案：`packages/server/src/dashboard-css.ts:30`；`dashboard-markup.ts:185、244`
- 描述：`.form-actions` 是 flex-wrap 容器，select 的 width:100% 獨佔一整列，把同列按鈕擠到下一行，與「模式選擇 + 按鈕同列」意圖不符。
- 修正方向：`.form-actions select { width: auto; min-width: 10rem; }`。

### UX9-14 圖像表單列缺 label、樣式衝突
- 檔案：`packages/server/src/dashboard-markup.ts:385-402`
- 描述：`#image-character`/`#image-ratio` 兩個 width:100% select 塞在同一 flex `.field-row` 互相擠壓（該 class 是 dl 專用、還套 border-bottom 等 dd 規則）；且這四個欄位無 `<label>` 或 `aria-label`，無障礙名稱缺失。
- 修正方向：建立專用 `.image-fields` class，補 label。

### UX9-15 無 `.home-actions`、`.danger`、`.publish-completion` 樣式
- 檔案：`packages/server/src/dashboard-markup.ts:19、101、201`
- 描述：首頁三按鈕無 flex/gap（與 `.form-actions` 不一致）；「捨棄草稿」按鈕的 `.danger` 無任何破壞性視覺；`.publish-completion` 無樣式。
- 修正方向：補對應規則；`.danger` 至少給紅色邊框/文字。

---

# 三、整體使用者體驗（USER9-XX）

### USER9-01 啟動器在「port 被占用」與「逾時」之間給出錯誤診斷
- 檔案：`packages/server/src/dashboard-launcher.ts:71、79-80、88-90`
- 描述：所有非 ECONNREFUSED 錯誤（timeout、ENOTFOUND、EPIPE）都被歸類為 occupied；health 非 2xx、非 JSON、未 ready、甚至 8787 上有 auth token 的 ST Workspace（health 回 401）一律宣稱「non-matching service」。使用者依訊息排除故障會完全走錯方向。
- 修正方向：probe 結果區分「HTTP 狀態」「service 不符」「未 ready」「無回應」四種 detail，錯誤訊息對應真實原因。

### USER9-02 非 Windows 平台錯誤訊息誤導（實際只有「自動開瀏覽器」是 Windows-only）
- 檔案：`packages/server/src/dashboard-launcher.ts:96-110`
- 描述：`openDashboardBrowser` 對非 win32 直接 throw「supports Windows only」，被包裝成 `DASHBOARD_BROWSER_OPEN_FAILED` 後，macOS/Linux 使用者會誤以為整個啟動器失敗（server 本身跨平台）。
- 修正方向：非 win32 用 `open`/`xdg-open` fallback；至少改為「無法自動開瀏覽器，請手動開啟 URL」並附 URL。

### USER9-03 固定埠 8787 無備援；錯誤指引無法執行
- 檔案：`packages/server/src/dashboard-launcher.ts:8、144`；`tools/dashboard-launcher.ts:7`
- 描述：埠被佔只能要求「關閉該服務」，無 `--port` 覆寫；stale 錯誤指示「關閉舊 Dashboard 視窗」，但舊服務可能是背景程序啟動（無視窗），使用者無從關閉。reuse 路徑直接 return，CMD 視窗閃一下消失，使用者看不到任何訊息（對應 `ST-Workspace-Dashboard.cmd:35-36`）。
- 修正方向：launchDashboard 增加 options.port；reuse 時輸出明確訊息並由 cmd 端 pause；錯誤訊息附偵測到的服務資訊（revision）。

### USER9-04 closeDashboardServer 無逾時，可能永久懸掛
- 檔案：`packages/server/src/dashboard-launcher.ts:112-120`；呼叫端 222、230、236
- 描述：`server.close()` 在瀏覽器 keep-alive 連線存在時等到全部結束才回呼；錯誤收尾路徑可能無限等待，整個啟動器掛住。
- 修正方向：Node 18.2+ 用 `closeIdleConnections()`/`closeAllConnections()`，或加 2-3 秒逾時強制 resolve。

### USER9-05 未宣告 Node 版本需求；`.cmd` 不檢查版本
- 檔案：`packages/server/../package.json`（無 engines）；`ST-Workspace-Dashboard.cmd:33`（`--import tsx/esm` 需 Node ≥ 20.6）
- 描述：Node 18 使用者會得到 `--import` 未知選項的晦澀錯誤；README 也未說明。cmd 依賴根 node_modules 的 tsx hoist 位置，未來結構變動會誤報「未安裝」。
- 修正方向：package.json 加 `"engines": { "node": ">=20.6" }`；cmd 加版本檢查；README 補前提。

### USER9-06 README 指引與實際行為不一致
- 檔案：`README.md:213-214、280-287`；`opencode.jsonc:4-11`
- 描述：(1) README 宣稱 `ST_WORKSPACE_HOST` 可改綁定 host，但啟動器硬編碼 host/port 並顯式傳給 startWorkspaceServer，該變數僅對 CLI serve 有效；(2) opencode.jsonc 的 MCP remote URL 硬編碼 8787，使用者依 README 改 port 後 MCP 連線失敗；(3) README「按 Ctrl+C 會停止 server」在 reuse 情形不成立；(4) README 未標註 tools/opencode-mcp.ts 為 legacy（docs/opencode-integration.md 仍將其描述為整合路徑，與 README「不再自行建立第二個 runtime」矛盾）。
- 修正方向：README 註明各環境變數適用範圍；opencode.jsonc 的 URL 可參照環境變數或文件；標註 legacy 工具地位。

### USER9-07 錯誤目錄覆蓋不全，錯誤訊息中英混雜
- 檔案：`packages/server/src/errors.ts:21-442`（缺 `DASHBOARD_*_NOT_FOUND`、`PUBLISH_*`、`BUILD_MODE_INVALID`、`PROJECT_NOT_FOUND`、`PROJECT_SELECTION_INVALID` 等條目）；`routes.ts:244`（message 直接塞 code 字串）
- 描述：未收錄錯誤碼的 fallback 使 `message_zh` 直接顯示英文原始訊息；`TEMPLATE_KIND_REQUIRED` 的 message 是無意義 code 字串。
- 修正方向：補齊 catalog；message 一律使用人類可讀文字。

### USER9-08 API 錯誤體有四種形狀；狀態碼語意貧乏
- 檔案：`packages/server/src/routes.ts:221`（`{ error: "IMAGE_NOT_FOUND" }`）vs `:63`（`{ code, message }`）vs `index.ts:68`（`{ error: "NOT_FOUND" }`）vs structuredError payload
- 描述：client 難以統一解析。所有 CoreError 一律 400（`OPERATION_NOT_FOUND` 應 404、`OPERATION_NOT_CANCELLABLE`/`OPERATION_LEASE_LOST` 應 409）；方法不符一律 404 而非 405；`/workspace/images/remove` 對不存在 image 回 200。
- 修正方向：統一錯誤體形狀；依錯誤類別對應狀態碼；補 405。

### USER9-09 多個 POST 端點未在 HTTP 邊界做 schema 驗證
- 檔案：`packages/server/src/routes.ts:367、373、593-594`；MCP 側 `:624-628、641-645`
- 描述：`body()` 回傳可為 null/陣列/字串，直接傳入 runtime；非物件輸入的 TypeError 被包成 500，正確語意是 400。MCP 的兩個 submit 工具參數原樣傳入，型別錯誤被判 -32603 而非 -32602；`tools/call` 的 params 非物件時誤報 -32601 tool not found（routes.ts:770）。
- 修正方向：統一使用 parseRequest 風格驗證；MCP 邊界驗證後回 -32602。

### USER9-10 MCP 協定瑕疵：通知被回應、全域 catch 丟失 id
- 檔案：`packages/server/src/index.ts:72`；`routes.ts:773`
- 描述：MCP 全域 catch 一律回 `id: null`，即使請求 id 已解析成功（client 無法關聯回應）；JSON-RPC 通知（無 id，如 `notifications/initialized`）也會收到錯誤回應，違反規範。另 `tools/opencode-mcp.ts:86` 多餘的 `notifications/` 前綴條件使帶 id 且 method 以此開頭的合法請求永不回應；轉發 fetch 無 timeout（:88-92）；通知回應 body 未消費，undici 連線無法重用（:93）。
- 修正方向：catch 回傳已解析的 id；無 id 請求不回應；移除多餘前綴條件；加 AbortController timeout。

### USER9-11 圖片 id 未做 URL 解碼，與 dashboard 端點不一致
- 檔案：`packages/server/src/routes.ts:219`（對照 `http-utils.ts:100-106`）
- 描述：client 依慣例 `encodeURIComponent` 後，含非 ASCII、`%`、`/` 的 image id 在 `/workspace/images/:id` 永遠查無（已查證是記憶體查表，無穿越風險，屬功能 bug）。
- 修正方向：與 dashboardPathId 一致地 `decodeURIComponent`。

### USER9-12 發布完成回饋薄弱、成功視覺不足
- 檔案：`packages/server/src/dashboard-panels-publish.ts`（完成訊息只停在 `provenance-confirm-message`）
- 描述：對比錯誤會進「最近回應/診斷」區（理應如此），成功時卻只有一個 aria-live 短句，缺少醒目完成視覺；發布完成下載用同步 `URL.revokeObjectURL`（publish.ts:1158-1163），Firefox 可能因非同步下載被中止。
- 修正方向：完成卡片加醒目視覺（publish-completion 元素已存在但無樣式，見 UX9-15）；revoke 延遲 1 秒。

### USER9-13 開發工具可發現性不足
- 檔案：`tools/audit-truncation-scan.ts`（整檔無 npm script 亦無 README 記載）；`tools/agent-lint.ts:120、165-167`（23/21/23 硬編碼數量契約）；`package.json:9`（typecheck 先 build 再 typecheck 可能重複）
- 描述：audit-truncation-scan 新使用者難以發現，且預設路徑不存在時靜默回報 0 檔、exit 0（:4、27-29）；agent-lint 以字串切片定位 opencode.jsonc 的 director 區塊（:98-100），格式調整即失效且失敗訊息誤導。
- 修正方向：工具加 npm script/README；路徑不存在報錯；agent-lint 改 JSON 解析、以 registry 推導期望值。

---

# 四、正向觀察（無需處理）

- 全 Dashboard bundle 零 `innerHTML`/`insertAdjacentHTML`/`eval`，DOM 一律 `createElement` + `textContent`，XSS 面收斂良好（唯一例外是 BUG9-14 的 href 賦值）。
- 多處正確使用 `aria-live`、`aria-busy`、`aria-label`、`aria-current`、`rel="noopener"`；setBusy 同步 `document.body` 的 aria-busy。
- `requestJson` 的錯誤正規化（kind/code/status/details/impact/next_actions）與中文提示、codeHint 對照表完整。
- token 會從 URL 移除（replaceState）；圖片端點以 Bearer fetch blob 而非把 token 放進 src。
- operation monitor 有 generation guard、visibilitychange/online 事件補輪詢；collections 的 cursor 分頁機制成熟。
- draft store 有 schema 版本、TTL、長度上限與部分例外防護。
- launcher 各失敗路徑皆有 closeDashboardServer 清理；cmd 批次語法（setlocal、cd /d "%~dp0"、call pnpm、%ERRORLEVEL% 捕獲）正確。
- 已查證的疑似路徑穿越（dashboardPathId 解碼、project select、image id）目前皆安全（記憶體查表 + basename 防護），屬隱性契約，建議未來加白名單約束。

---

# 五、建議處理順序

**第一批（P0 + 高風險 P1，DASHBOARD_PORT_IN_USE 與導覽失效直接影響使用者開機體驗）**
- BUG9-01 區段導覽失效與 switchPanel 遮蔽（連帶 UX9-01 nav grid 佈局）
- BUG9-02 啟動器逾時誤判 occupied
- BUG9-03 setNotice 覆寫詳細錯誤內容
- BUG9-07 未認證 unhandledRejection DoS（index.ts catch 重複解析 URL）
- BUG9-08 空字串 token 繞過

**第二批（發布工作流狀態機與安全）**
- BUG9-04 setBusy 破壞 disabled 狀態
- BUG9-05 阻擋判定結構不一致
- BUG9-10 busy 競態丟棄確認發布
- BUG9-11 發布失敗後 CTA 永久停用
- BUG9-09 CSRF 無 Origin 校驗
- BUG9-14 href scheme 白名單

**第三批（資料穩健性與跨專案狀態）**
- BUG9-06 切換專案資料殘留
- BUG9-12、BUG9-13、BUG9-16 缺欄 .slice 崩潰族
- BUG9-17 payload.monitor null 防護
- BUG9-15 disabled 按鈕跳轉死碼
- BUG9-19 輪詢抹掉輸入、BUG9-18 collections 重複監聽

**第四批（UI/UX 與整體體驗）**
- UX9-02/UX9-03 CSS 脫節與縮圖
- UX9-04/UX9-05 coverage 資訊過載與分頁
- UX9-06 深色模式、UX9-07 對話框 a11y 統一
- USER9-01~06 啟動器與 README 一致性
- USER9-07~09 API 錯誤形狀與邊界驗證
- USER9-10 MCP 協定修正、USER9-11 圖片 id 解碼
