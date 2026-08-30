# Workspace 功能擴充路線圖

- 日期：2026-08-19
- 狀態：方向已核准，待逐項建立設計與 issue
- 規劃方式：近期可交付 MVP + 長期擴充
- 產品原則：local-first、可恢復、typed contracts、可追溯、Dashboard 與 Agent 共用同一 Runtime

## 目的

在現有角色卡工作流已能完成訪談、研究、創作、審查、打包與發布的基礎上，優先補足日常使用最需要的資料可攜性、人工修訂、工作流可視性與操作效率，再擴充來源研究、成本觀測、SillyTavern 預覽與跨專案重用。

本文件不取代 Audit issue，也不表示所有候選功能都應同時實作。每個項目在進入開發前需有獨立設計、資料遷移、失敗恢復與驗收規格。

## 現有能力地圖

目前 workspace 已具備：

- 專案建立、選取、延續、擴充與 existing-world 流程。
- 單題訪談、Blueprint precheck 與 project-scoped Runtime。
- Sources、Fact candidates、Fact Review、Coverage Center 與 provenance。
- Character、Zhuji、Palette、Wardrobe、Relationships、Greetings、World 與 Plugin authoring/review。
- Build preview、publish provenance confirmation、JSON/PNG 輸出與 Tavern verification。
- Dashboard、CLI、MCP tools、operation recovery 與 filesystem materialization。

因此下一階段的核心不是再增加另一套平行工作流，而是讓既有資料更容易備份、修訂、搜尋、觀察與重用。

## 開始新增功能前的必要條件

Audit 13 的 P1 正確性與治理問題應先處理，尤其是：

- #203 發布確認 REST 契約。
- #204 projectId filesystem boundary。
- #205 原子新專案配置。
- #206 多列 Dashboard action identity。
- #207 專案切換隔離。
- #208 production DOM navigation contract。
- #211 Audit governance matcher。

這些 issue 會影響資料安全、專案隔離或後續 issue 的正確關閉，不宜被大型新功能掩蓋。#209、#210、#212 可與相應功能階段合併規劃，但其驗收仍應保持獨立可追蹤。

## 架構原則

1. **Domain/Runtime 擁有行為。** Dashboard、CLI 與 MCP 只呼叫同一 typed use case，不各自重做資料規則。
2. **所有高影響寫入可預覽。** Restore、revision rollback、batch execution 與 template apply 先產生 plan/hash，再確認執行。
3. **失敗可恢復。** 涉及多檔案或多 artifact 的操作使用既有 transaction journal／operation model。
4. **專案可攜但不洩漏秘密。** Export 預設排除 token、session、temporary lock 與不必要 cache。
5. **搜尋與觀測不改變真相。** Index、metrics 與 preview 都是 projection；正式 state 與 artifacts 仍是 canonical source。
6. **先做垂直切片。** 每項 MVP 同時提供 Runtime contract、一個主要 UI、測試與文件，避免只完成後端或只有 Dashboard mockup。

## 候選功能總覽

| 優先度 | 功能 | 主要價值 | MVP 邊界 |
|---|---|---|---|
| P0 | 專案備份、還原、複製與完整匯出 | 降低升級、誤操作與跨機器遷移風險 | 單一可驗證 package + dry-run restore |
| P0 | Artifact 編輯、diff 與 revision restore | 讓使用者不必離開 Dashboard 修正小錯誤 | 文字/JSON 編輯、schema validation、單 artifact restore |
| P1 | 全域搜尋與 command palette | 快速找到角色、Fact、Artifact、operation 與功能 | project-scoped search + keyboard navigation |
| P1 | Workflow planner、批次與依賴圖 | 清楚顯示可做、受阻、會失效的下一步 | read-only plan + 一批安全 actions |
| P1 | 來源搜尋 provider | 從意圖直接找候選來源，減少手動貼 URL | provider interface + 一個 provider + 人工選取 |
| P1 | 模型、token、成本與時間觀測 | 找出昂貴或緩慢步驟並支援預算控制 | per-operation usage ledger + Dashboard summary |
| P2 | SillyTavern 預覽 sandbox | 發布前檢查卡片、世界書、greeting 與 plugin 表現 | 隔離的 static/compat preview，不執行不受信任腳本 |
| P2 | 跨專案模板與資產庫 | 重用角色骨架、世界片段、圖片與 prompts | explicit copy/import + provenance；不做隱式共享修改 |

## Now：可靠性與日常可操作性

### 1. 專案 package：備份、還原、複製、搬移

#### 使用價值

- 在 schema migration、批次修訂或發布前建立可驗證還原點。
- 將專案移到另一台機器，或複製為實驗分支而不共用 directory。
- 對目前 scattered materialized files 提供一致的匯入／匯出入口。

#### MVP

- 匯出單一 versioned package，包含 canonical state、必要 blobs、attachments、artifacts、materialization manifest 與內容雜湊。
- 預設排除 locks、staging、browser session、auth token、可重建 cache 與 coverage 產物。
- Import/restore 先執行 dry-run：顯示來源版本、project identity、檔案數、缺失 blob、衝突、需要的 migration 與預計 target path。
- `clone` 必須建立新 project ID 與獨立 operation history；`restore in place` 則要求 revision/plan hash 確認。

#### 驗收重點

- Round trip 後 canonical state、artifact revisions 與 blobs hash 相同。
- 損壞、截斷、版本過新、缺 blob 或 target 衝突時 fail closed。
- Restore 中斷可恢復或安全回滾，不留下半套專案。
- Windows/Linux path、Unicode filename 與大型附件有測試。

### 2. 原生 Artifact editor、diff 與 revision restore

#### 使用價值

目前 Dashboard 能檢視 raw、diff、送審與下載，但小型修正仍需要外部工具或重新生成。MVP 應讓使用者在保留 provenance 與 review gate 的前提下修正正式內容。

#### MVP

- 支援 JSON structured editor 與 Markdown/text editor；依 artifact kind 顯示 schema/格式錯誤。
- Save 永遠建立新 revision，不覆寫歷史 blob。
- 顯示 base revision 與最新 revision；若編輯期間已有新 revision，回傳 conflict 並提供三方比較所需資料。
- Restore 是「以舊內容建立新 revision」，不是移除較新的歷史。
- Save/restore 後以既有 invalidation projection 顯示哪些 review、build、publish 會失效。

#### 驗收重點

- Invalid JSON、schema error、stale base revision 與權限/確認錯誤都有可恢復 UI。
- 每次修改保留 actor、來源 revision、原因與 operation audit。
- Critic/review 狀態不會被舊 revision 的批准錯誤繼承。

### 3. 與 CI 對齊的本機 preflight

將 #212 作為 Now 的開發體驗項目：保留快速 `pnpm check`，另提供單一完整 preflight，並在 Dashboard/README 清楚區分 local-equivalent 與 remote-only gates。它不直接增加產品功能，但能降低後續多批實作的回歸成本。

## Next：效率、規劃與觀測

### 1. 全域搜尋與 command palette

#### MVP

- 搜尋目前專案的角色、World entry、Fact、Source、Artifact、Review issue、Operation 與 Publish Record。
- 結果使用 stable object identity，點擊後透過 canonical panel registry 導航到正確 section/object。
- Command palette 只暴露既有有權限且目前可執行的 actions；高影響 action 仍走 preview/confirm。
- 支援鍵盤操作、結果分類、最近使用與空結果建議。

#### 邊界

Index 是 projection，可重建且不得成為 canonical data。專案切換時必須遵守 #207 的 generation isolation。

### 2. Workflow planner、依賴圖與安全批次

#### MVP

- 將現有 workflow stages、invalidations、coverage prerequisites 與 operation 狀態整合成 read-only execution plan。
- 每個節點顯示：輸入、輸出、阻擋原因、會使哪些下游失效、是否可重試。
- 第一版 batch 只允許沒有使用者選擇分支、具 idempotency identity 的安全 actions。
- 執行前固定 plan hash；任何依賴 revision 改變就要求重新預覽。

#### 不在 MVP

- 不讓模型自行批准高影響操作。
- 不建立另一套與 Runtime workflow 平行的 Dashboard-only state machine。

### 3. 來源搜尋 provider

#### MVP

- 建立 provider-neutral interface：query、domain/language constraints、結果 metadata、fetch capability、rate-limit/error mapping。
- 先接一個可替換 provider；使用者仍需選擇候選來源，Source Researcher 不可把搜尋摘要直接當 accepted Fact。
- 保存 query、provider、URL、擷取時間、content hash 與授權/來源資訊。
- 網路不可用、robots/policy 拒絕、付費牆、內容變更與 duplicate source 都有明確狀態。

### 4. 模型、token、成本與時間觀測

#### MVP

- 每個 operation 記錄 provider/model identity、開始/結束時間、輸入/輸出 token、重試、cache 命中與可用時的估算成本。
- Dashboard 提供 project、agent、operation kind 與時間範圍的彙總，不記錄或展示 secret。
- 價格表帶版本與估算標記；無法取得價格時顯示 usage 而非捏造成本。
- 可設定 soft budget warning；hard stop 必須是顯式使用者設定，且不能中斷已進入不可安全停止的 commit 階段。

## Later：預覽與跨專案重用

### 1. SillyTavern 預覽 sandbox

- 顯示實際 card fields、primary/alternate/group greetings、worldbook entries、cover 與 plugin manifest。
- 使用與 Compiler 相同的 build output，不在 Dashboard 另做近似投影。
- 不直接執行匯入卡片或 plugin 內的不受信任 script；HTML/plugin preview 使用隔離 origin、嚴格 CSP 與受控 fixture API。
- 與 Tavern verifier 結果連結，讓 PASS/WARN/FAIL 可定位到預覽中的具體物件。

### 2. 跨專案模板與資產庫

- 可重用範圍：訪談 preset、Character skeleton、World fragment、Relationship group pattern、Wardrobe set、圖片與 approved prompt fragment。
- 套用時執行 explicit copy/import，產生新 project-local identity 並保留來源 provenance。
- 原模板後續更新不得靜默修改既有專案；使用者可選擇比較與升級。
- Asset 必須保存授權、來源與內容 hash；刪除 library item 不影響已複製的專案資料。

## 建議實作順序

1. 完成 Audit 13 P1 issues，先恢復發布、filesystem、project isolation、row action、project switching、navigation 與 governance 的可信基線。
2. 建立 project package export/verify，再做 dry-run import/restore，最後補 clone 與 in-place restore。
3. 建立 artifact revision write API，再做 editor、conflict diff 與 restore-as-new-revision。
4. 建立 canonical object locator/search projection，接上 global search 與 command palette。
5. 將 workflow/coverage/invalidation 投影整合為 planner，再開放受限 batch actions。
6. 建立 operation usage ledger，完成時間/token 觀測後再加入成本與 budget。
7. 接入 source provider；先保證 provenance 與人工選取，再擴充 provider 數量。
8. 以真實 build output 建立 SillyTavern sandbox preview。
9. 最後建立跨專案模板與資產庫，避免在 migration/identity 尚未穩定前引入共享資料。

## 不建議現在做的事

- 不建立第二套 project database 或 Dashboard-only artifact store。
- 不先做任意腳本 plugin marketplace；目前安全與隔離成本高於收益。
- 不讓批次工作流自動跨越 interview、review、publish confirmation 等人工 gate。
- 不把搜尋 index、preview cache、metrics aggregate 當成可修改的正式資料。
- 不以 zip/unzip 檔案複製取代具 manifest、hash、migration 與 restore transaction 的 project package。

## 路線圖完成標準

- [ ] 每個功能都有唯一 Domain/Runtime owner，Dashboard、CLI 與 MCP 不重複商業規則。
- [ ] 所有高影響寫入都有 preview、plan identity、確認與 recovery 測試。
- [ ] Project export/import 不包含 credential/session，且 round trip 可驗證。
- [ ] Artifact 修訂永遠保留 revision/provenance，不做 destructive overwrite。
- [ ] 搜尋、planner、metrics 與 preview 都能從 canonical state 重建。
- [ ] 新功能遵守 project switching isolation、auth、Origin/Host 與 no-store policy。
- [ ] 每個階段都有至少一個從 Dashboard 或 MCP 走到 Runtime 的端到端驗收案例。
